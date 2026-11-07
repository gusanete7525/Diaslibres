import { readFileSync, writeFileSync, mkdirSync, renameSync } from 'node:fs';
import { dirname } from 'node:path';

// Hoteles reales de cualquier ciudad desde OpenStreetMap (sin registro ni clave):
//   1. Nominatim convierte el nombre de la ciudad en un área (bounding box).
//   2. Overpass devuelve los elementos tourism=hotel con nombre dentro del área.
// Los resultados se guardan en caché (memoria + fichero) durante una semana para
// respetar las políticas de uso de ambos servicios públicos.

const NOMINATIM = process.env.NOMINATIM_URL || 'https://nominatim.openstreetmap.org/search';
const OVERPASS = process.env.OVERPASS_URL || 'https://overpass-api.de/api/interpreter';
const USER_AGENT = process.env.OSM_USER_AGENT || 'DiasLibres/1.0 (agencia de reservas demo)';
const TTL = 7 * 24 * 3600 * 1000;
const MAX_HOTELS = 30;

// Precio orientativo por noche según categoría (sin estrellas: 85 €).
const PRICE_BY_STARS = { 1: 50, 2: 65, 3: 90, 4: 130, 5: 260 };
const EMOJI_BY_STARS = { 1: '🛏️', 2: '🛏️', 3: '🏨', 4: '🏨', 5: '👑' };

const norm = (s) =>
  String(s ?? '')
    .toLowerCase()
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '')
    .trim();

function hash(s) {
  let h = 0;
  for (const ch of s) h = (Math.imul(h, 31) + ch.charCodeAt(0)) | 0;
  return Math.abs(h);
}

export class OsmHotels {
  constructor({ file = null, fetchImpl = globalThis.fetch } = {}) {
    this.file = file;
    this.fetch = fetchImpl;
    this.cache = {}; // ciudad normalizada -> { at, hotels }
    this.pending = new Map();
    this.queue = Promise.resolve(); // serializa peticiones (máx. ~1/s a Nominatim)
    if (file) {
      try {
        this.cache = JSON.parse(readFileSync(file, 'utf8'));
      } catch {
        this.cache = {};
      }
    }
  }

  // Todos los hoteles conocidos (para poder reservar tras reiniciar el servidor).
  known() {
    return Object.values(this.cache).flatMap((c) => c.hotels);
  }

  async hotelsFor(city) {
    const key = norm(city);
    if (key.length < 2) return [];
    const hit = this.cache[key];
    if (hit && Date.now() - hit.at < TTL) return hit.hotels;
    if (!this.pending.has(key)) {
      const job = this.#throttled(() => this.#load(city))
        .then((hotels) => {
          this.cache[key] = { at: Date.now(), hotels };
          this.#save();
          return hotels;
        })
        .finally(() => this.pending.delete(key));
      this.pending.set(key, job);
    }
    return this.pending.get(key);
  }

  #throttled(fn) {
    const run = this.queue.then(fn);
    this.queue = run.catch(() => {}).then(() => new Promise((r) => setTimeout(r, 1100)));
    return run;
  }

  async #load(city) {
    const place = await this.#geocode(city);
    if (!place) return [];
    const [s, n, w, e] = place.boundingbox.map(Number);
    // Áreas enormes (países, regiones) => nos quedamos con ~15 km alrededor del centro.
    const lat = Number(place.lat), lon = Number(place.lon);
    const bbox = n - s > 0.4 || e - w > 0.5 ? [lat - 0.12, lon - 0.15, lat + 0.12, lon + 0.15] : [s, w, n, e];
    const query = `[out:json][timeout:25];nwr["tourism"="hotel"]["name"](${bbox.map((x) => x.toFixed(5)).join(',')});out center tags 200;`;
    const res = await this.fetch(OVERPASS, {
      method: 'POST',
      headers: { 'Content-Type': 'application/x-www-form-urlencoded', 'User-Agent': USER_AGENT },
      body: 'data=' + encodeURIComponent(query),
    });
    if (!res.ok) throw new Error(`Overpass respondió ${res.status}`);
    const data = await res.json();
    const cityName = place.address?.city || place.address?.town || place.address?.village || place.name || city;
    const country = place.address?.country || '';
    return toHotels(data.elements || [], cityName, country);
  }

  async #geocode(city) {
    const url = `${NOMINATIM}?format=jsonv2&limit=1&addressdetails=1&accept-language=es&q=${encodeURIComponent(city)}`;
    const res = await this.fetch(url, { headers: { 'User-Agent': USER_AGENT } });
    if (!res.ok) throw new Error(`Nominatim respondió ${res.status}`);
    const [place] = await res.json();
    return place || null;
  }

  #save() {
    if (!this.file) return;
    mkdirSync(dirname(this.file), { recursive: true });
    const tmp = this.file + '.tmp';
    writeFileSync(tmp, JSON.stringify(this.cache));
    renameSync(tmp, this.file);
  }
}

export function toHotels(elements, city, country) {
  const seen = new Set();
  const hotels = [];
  for (const el of elements) {
    const t = el.tags || {};
    const name = t.name?.trim();
    if (!name || seen.has(norm(name))) continue;
    seen.add(norm(name));
    const stars = Number.parseInt(t.stars, 10);
    const validStars = stars >= 1 && stars <= 5 ? stars : null;
    const street = [t['addr:street'], t['addr:housenumber']].filter(Boolean).join(', ');
    const address = [street, [t['addr:postcode'], t['addr:city'] || (street ? city : '')].filter(Boolean).join(' ')].filter(Boolean).join(', ');
    const website = t.website || t['contact:website'] || null;
    const tags = ['ciudad'];
    if (t.swimming_pool === 'yes' || t['leisure'] === 'swimming_pool') tags.push('piscina');
    if (t.spa === 'yes' || t.sauna === 'yes') tags.push('spa');
    if (validStars >= 5) tags.push('lujo');
    if (validStars && validStars <= 2) tags.push('económico');
    const id = `osm-${el.type?.[0] || 'x'}${el.id}`;
    hotels.push({
      id,
      name,
      city,
      country,
      stars: validStars,
      address: address || null,
      website: /^https?:\/\//i.test(website || '') ? website : null,
      basePrice: PRICE_BY_STARS[validStars] || 85,
      rooms: 4 + (hash(id) % 5),
      tags,
      image: EMOJI_BY_STARS[validStars] || '🏨',
      description: `Hotel en ${city} registrado en OpenStreetMap${validStars ? ` como ${validStars} estrellas` : ''}. Precio orientativo según su categoría.`,
      source: `https://www.openstreetmap.org/${el.type}/${el.id}`,
      origin: 'osm',
    });
  }
  // Primero los que tienen más información (estrellas, web, dirección).
  const score = (h) => (h.stars ? 2 : 0) + (h.website ? 1 : 0) + (h.address ? 1 : 0);
  return hotels.sort((a, b) => score(b) - score(a)).slice(0, MAX_HOTELS);
}
