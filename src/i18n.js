// Idiomas de la web. Los textos se escriben en español y se traducen con
// diccionarios { 'frase en español': 'traducción' } en public/i18n/<idioma>.js
// (los mismos que usa el navegador). Lo que falta en un diccionario sale en español.
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { join, dirname } from 'node:path';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');

// prefix: delante de cada dirección; hotels/flights: la palabra de la dirección.
export const LANGS = {
  es: { name: 'Español', locale: 'es-ES', og: 'es_ES', prefix: '', hotels: 'hoteles', flights: 'vuelos' },
  en: { name: 'English', locale: 'en-GB', og: 'en_GB', prefix: '/en', hotels: 'hotels', flights: 'flights' },
  fr: { name: 'Français', locale: 'fr-FR', og: 'fr_FR', prefix: '/fr', hotels: 'hotels', flights: 'vols' },
  de: { name: 'Deutsch', locale: 'de-DE', og: 'de_DE', prefix: '/de', hotels: 'hotels', flights: 'fluege' },
  it: { name: 'Italiano', locale: 'it-IT', og: 'it_IT', prefix: '/it', hotels: 'hotel', flights: 'voli' },
  pt: { name: 'Português', locale: 'pt-PT', og: 'pt_PT', prefix: '/pt', hotels: 'hoteis', flights: 'voos' },
  nl: { name: 'Nederlands', locale: 'nl-NL', og: 'nl_NL', prefix: '/nl', hotels: 'hotels', flights: 'vluchten' },
};
export const LANG_CODES = Object.keys(LANGS);
export const isLang = (x) => Object.hasOwn(LANGS, x);

// Los diccionarios son módulos del navegador («export default {...}»): se leen como JSON.
const DICTS = { es: {} };
for (const code of LANG_CODES.slice(1)) {
  try {
    const src = readFileSync(join(root, 'public', 'i18n', `${code}.js`), 'utf8');
    DICTS[code] = JSON.parse(src.slice(src.indexOf('{'), src.lastIndexOf('}') + 1));
  } catch {
    DICTS[code] = {};
  }
}
export const dict = (lang) => DICTS[lang] || {};

const fill = (s, vars) => Object.entries(vars).reduce((out, [k, v]) => out.replaceAll(`{${k}}`, v), s);

// Frases con huecos ({n}, {city}…) para traducir textos ya rellenados (p. ej. errores del servidor).
const patterns = new Map();
function patternsOf(lang) {
  if (!patterns.has(lang)) {
    const list = [];
    for (const [key, value] of Object.entries(dict(lang))) {
      const names = [...key.matchAll(/\{(\w+)\}/g)].map((m) => m[1]);
      if (!names.length) continue;
      const re = new RegExp('^' + key.split(/\{\w+\}/).map((x) => x.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')).join('(.+?)') + '$', 's');
      list.push({ re, names, value });
    }
    patterns.set(lang, list);
  }
  return patterns.get(lang);
}

// t('Hoteles en {city}', { city }) en el idioma pedido.
export function tr(lang, s, vars = {}) {
  return fill(dict(lang)[s] ?? s, vars);
}

// Traduce un texto ya montado: exacto, o por una frase con huecos (los huecos también se traducen).
export function trText(lang, text) {
  if (lang === 'es' || typeof text !== 'string') return text;
  const d = dict(lang);
  if (d[text] != null) return d[text];
  for (const { re, names, value } of patternsOf(lang)) {
    const m = text.match(re);
    if (m) return fill(value, Object.fromEntries(names.map((n, i) => [n, trText(lang, m[i + 1])])));
  }
  return text;
}

const escAttr = (s) => String(s).replace(/&/g, '&amp;').replace(/"/g, '&quot;').replace(/</g, '&lt;');

// Traduce index.html: elementos con data-i18n (su HTML entero es la clave), textos sueltos
// entre etiquetas y los atributos de texto. No toca <script> ni <style>.
export function translateHtml(html, lang) {
  if (lang === 'es') return html;
  const d = dict(lang);
  let out = html.replace(/<(\w+)([^>]*?)\sdata-i18n>([\s\S]*?)<\/\1>/g, (all, tag, attrs, inner) => {
    const v = d[inner.trim()];
    return v != null ? `<${tag}${attrs} data-i18n data-done>${v}</${tag}>` : all;
  });
  out = out.replace(/(<(script|style)\b[\s\S]*?<\/\2>)|(<[^>]*\sdata-done>[\s\S]*?<\/)|>([^<>]+)(?=<)/g, (all, block, _t, done, text) => {
    if (block || done || !text?.trim()) return all;
    const key = text.trim();
    return d[key] != null ? '>' + text.replace(key, () => d[key]) : all;
  });
  out = out.replace(/\s(placeholder|aria-label|title|data-default)="([^"]*)"/g, (all, attr, value) =>
    d[value] != null ? ` ${attr}="${escAttr(d[value])}"` : all);
  return out.replace(/ data-done>/g, '>').replace('<html lang="es">', `<html lang="${lang}">`);
}

// Idioma de una petición a la API: cabecera X-Lang que pone el navegador.
export const langOf = (req) => (isLang(req.get?.('x-lang')) ? req.get('x-lang') : 'es');
