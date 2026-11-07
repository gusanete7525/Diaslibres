import { existsSync } from 'node:fs';

// Approximate country of the visitor, only to choose which promotions to show.
// Nothing is stored. Sources, in order: a country header set by our own proxy
// (Cloudflare's CF-IPCountry, or X-Country from nginx GeoIP), then a local
// DB-IP Lite country database (GEOIP_DB, .mmdb). Without either, null.
const VALID = /^[A-Z]{2}$/;
const IGNORED = new Set(['XX', 'T1', 'A1', 'A2', 'O1', 'EU', 'AP']);

export function makeCountryLookup({ file = process.env.GEOIP_DB, trustHeaders = process.env.GEO_TRUST_HEADERS !== '0' } = {}) {
  let reader = null;
  const ready = (async () => {
    if (!file || !existsSync(file)) return;
    try {
      const { default: maxmind } = await import('maxmind');
      reader = await maxmind.open(file, { watchForUpdates: true });
    } catch (err) {
      console.error('[geoip]', err.message);
    }
  })();
  const clean = (code) => {
    const c = String(code || '').trim().toUpperCase();
    return VALID.test(c) && !IGNORED.has(c) ? c : null;
  };
  const lookup = (req) => {
    if (trustHeaders) {
      const header = clean(req.get?.('cf-ipcountry')) || clean(req.get?.('x-country'));
      if (header) return header;
    }
    if (!reader || !req.ip) return null;
    try {
      const found = reader.get(req.ip.replace(/^::ffff:/, ''));
      return clean(found?.country?.iso_code);
    } catch { return null; }
  };
  lookup.ready = ready;
  return lookup;
}
