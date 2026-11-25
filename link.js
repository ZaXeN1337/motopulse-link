// MotoPulse link page: decodes the "v1" payload from the # of the URL and draws it. No server, no tracking.
// decodeShareLink and buildIcs must stay equal to src/portability/share_link.ts and group_invite.ts (test/link_page.test.ts).
const ALPHABET = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789-_';
const DAY = 86400000;

function fromB64Url(b64) {
  if (b64.length % 4 === 1) throw Error('base64');
  const bytes = [];
  let acc = 0, bits = 0;
  for (const ch of b64) {
    const v = ALPHABET.indexOf(ch);
    if (v < 0) throw Error('base64');
    acc = (acc << 6) | v; bits += 6;
    if (bits >= 8) { bits -= 8; bytes.push((acc >> bits) & 255); acc &= (1 << bits) - 1; }
  }
  return decodeURIComponent(bytes.map(b => '%' + (b < 16 ? '0' : '') + b.toString(16)).join(''));
}
function decodePolyline(s) {
  const out = [];
  let i = 0, lat = 0, lon = 0;
  const get = () => {
    let shift = 0, v = 0, c;
    do {
      if (i >= s.length) throw Error('polyline');
      c = s.charCodeAt(i++) - 63;
      if (c < 0 || c > 63) throw Error('polyline');
      v |= (c & 0x1f) << shift; shift += 5;
    } while (c >= 0x20 && shift < 35);
    if (c >= 0x20) throw Error('polyline');
    return v & 1 ? ~(v >> 1) : v >> 1;
  };
  while (i < s.length) { lat += get(); lon += get(); out.push({ lat: lat / 1e5, lon: lon / 1e5 }); }
  return out;
}
const num = (v, min, max) => typeof v === 'number' && Number.isFinite(v) && v >= min && v <= max;
const str = (v, max) => typeof v === 'string' && v.length <= max;
/** The b64 part of "<page>#v1.<b64>" or "motopulse://open/v1/<b64>", or null. */
export function payloadPart(urlOrFragment) {
  const match = /^(?:.*#|motopulse:\/\/open\/)?v1[./]([A-Za-z0-9_-]+)\/?$/s.exec(String(urlOrFragment).trim());
  return match && match[1].length <= 12000 ? match[1] : null;
}
export function decodeShareLink(urlOrFragment, nowMs) {
  try {
    const part = payloadPart(urlOrFragment);
    if (!part) return null;
    const o = JSON.parse(fromB64Url(part));
    if (!o || typeof o !== 'object' || Array.isArray(o) || (o.k !== 'r' && o.k !== 'i') || !str(o.n, 60) || typeof o.p !== 'string' || o.p.length > 6000 || !num(o.d, 0, 100000)) return null;
    const points = decodePolyline(o.p);
    if (points.length < 2 || points.length > 500 || points.some(p => !num(p.lat, -90, 90) || !num(p.lon, -180, 180))) return null;
    const out = { k: o.k, n: o.n, points, d: o.d };
    if (o.s !== undefined) {
      if (o.k !== 'r' || !Array.isArray(o.s) || o.s.length > 6 || !o.s.every(e => Array.isArray(e) && e.length === 2 && str(e[0], 24) && str(e[1], 24))) return null;
      out.s = o.s;
    }
    if (o.m !== undefined) {
      const m = o.m;
      if (o.k !== 'i' || !m || typeof m !== 'object' || !num(m.a, -90, 90) || !num(m.o, -180, 180) || !str(m.l, 60)) return null;
      out.m = { a: m.a, o: m.o, l: m.l };
    }
    if (o.t !== undefined) { if (o.k !== 'i' || !num(o.t, nowMs - DAY, nowMs + 400 * DAY)) return null; out.t = o.t; }
    if (o.x !== undefined) { if (o.k !== 'i' || !str(o.x, 200)) return null; out.x = o.x; }
    if (o.g !== undefined) {
      const g = o.g;
      if (!g || typeof g !== 'object' || !num(g.a, -90, 90) || !num(g.o, -180, 180) || !str(g.l, 60)) return null;
      out.g = { a: g.a, o: g.o, l: g.l };
    }
    if (o.c !== undefined) { if (o.k !== 'i' || typeof o.c !== 'string' || !/^[A-HJ-NP-Z2-9]{8}$/.test(o.c)) return null; out.c = o.c; }
    return out;
  } catch { return null; }
}

/** GR-2: the join code of "<page>#g.<CODE>" or "motopulse://open/g/<CODE>", or null (same rule as decodeGroupLink in share_link.ts). */
export function groupCode(urlOrFragment) {
  const match = /^(?:.*#|motopulse:\/\/open\/)?g[./]([A-HJ-NP-Za-hj-np-z2-9]{8})\/?$/s.exec(String(urlOrFragment).trim());
  return match ? match[1].toUpperCase() : null;
}
export const groupIntentUrl = code => `intent://open/g/${code}#Intent;scheme=motopulse;package=com.motopulse.app;end`;
export const intentUrl = part => `intent://open/v1/${part}#Intent;scheme=motopulse;package=com.motopulse.app;end`;
export const mapsUrl = m => `https://www.google.com/maps/search/?api=1&query=${m.a},${m.o}`;
const esc = s => s.replace(/\\/g, '\\\\').replace(/;/g, '\\;').replace(/,/g, '\\,').replace(/\r\n?|\n/g, '\\n'); // a lone CR ends a line too
const utc = ms => new Date(ms).toISOString().replace(/[-:]/g, '').replace(/\.\d{3}/, '');
export function buildIcs(p, nowMs, uid) {
  const lines = ['BEGIN:VCALENDAR', 'VERSION:2.0', 'PRODID:-//MotoPulse//Invite//EN', 'BEGIN:VEVENT', `UID:${uid}`, `DTSTAMP:${utc(nowMs)}`, `DTSTART:${utc(p.t)}`, `DTEND:${utc(p.t + 3 * 3600000)}`, `SUMMARY:${esc(p.n)}`];
  if (p.m) lines.push(`LOCATION:${esc(`${p.m.l} (${p.m.a},${p.m.o})`)}`);
  if (p.x) lines.push(`DESCRIPTION:${esc(p.x)}`);
  lines.push('END:VEVENT', 'END:VCALENDAR');
  return lines.join('\r\n') + '\r\n';
}

const TEXT = {
  ro: { invite: 'Invitație la tură de grup', ride: 'Tură', dist: 'Distanță', when: 'Când', where: 'Întâlnire', note: 'Notă', open: 'Deschide în MotoPulse', confirm: 'Confirmă în MotoPulse', needApp: 'Ca să confirmi că vii, ai nevoie de MotoPulse.', group: 'Invitație într-un grup MotoPulse', code: 'Cod de grup', cal: 'Adaugă în calendar', maps: 'Întâlnirea în Google Maps', invalid: 'Link invalid. Cere să ți se trimită din nou.', noMap: 'Harta nu s-a putut încărca. Datele turei sunt mai sus.', priv: 'Datele turei stau în link, nu pe un server.' },
  en: { invite: 'Group ride invitation', ride: 'Ride', dist: 'Distance', when: 'When', where: 'Meeting point', note: 'Note', open: 'Open in MotoPulse', confirm: 'Confirm in MotoPulse', needApp: 'To confirm you are coming, you need MotoPulse.', group: 'Invitation to a MotoPulse group', code: 'Group code', cal: 'Add to calendar', maps: 'Meeting point in Google Maps', invalid: 'Invalid link. Ask for it to be sent again.', noMap: 'The map could not be loaded. The ride details are above.', priv: 'The ride data lives in the link, not on a server.' },
};
const STYLE = 'https://tiles.openfreemap.org/styles/liberty';

function init() {
  const $ = id => document.getElementById(id);
  const tx = TEXT[(navigator.language || 'en').toLowerCase().startsWith('ro') ? 'ro' : 'en'];
  document.documentElement.lang = (navigator.language || 'en').toLowerCase().startsWith('ro') ? 'ro' : 'en';
  $('privacy').textContent = tx.priv;
  const now = Date.now(), hash = location.hash, code = groupCode(hash);
  if (code) {
    $('map').hidden = true; $('kind').textContent = 'MotoPulse'; $('title').textContent = tx.group; document.title = `${tx.group} · MotoPulse`;
    const dt = document.createElement('dt'), dd = document.createElement('dd'); dt.textContent = tx.code; dd.textContent = code; $('facts').append(dt, dd);
    if (/Android/i.test(navigator.userAgent)) { const a = $('open'); a.textContent = tx.open; a.href = groupIntentUrl(code); a.hidden = false; }
    return;
  }
  const p = decodeShareLink(hash, now);
  if (!p) { $('map').hidden = true; $('error').textContent = tx.invalid; $('error').hidden = false; return; }
  const fmt = new Intl.DateTimeFormat(navigator.language, { dateStyle: 'full', timeStyle: 'short' });
  $('title').textContent = p.n || (p.k === 'i' ? tx.invite : tx.ride);
  document.title = `${p.n || tx.ride} · MotoPulse`;
  $('kind').textContent = p.k === 'i' ? tx.invite : tx.ride;
  const facts = $('facts');
  const fact = (label, value) => { const dt = document.createElement('dt'), dd = document.createElement('dd'); dt.textContent = label; dd.textContent = value; facts.append(dt, dd); };
  fact(tx.dist, `${p.d.toLocaleString(navigator.language, { maximumFractionDigits: 1 })} km`);
  for (const [label, value] of p.s ?? []) fact(label, value);
  if (p.t !== undefined) fact(tx.when, fmt.format(new Date(p.t)));
  if (p.m) fact(tx.where, p.m.l);
  if (p.x) fact(tx.note, p.x);
  const button = (id, href, label) => { const a = $(id); a.textContent = label; a.href = href; a.hidden = false; };
  const part = payloadPart(hash);
  if (/Android/i.test(navigator.userAgent)) button('open', intentUrl(part), p.c ? tx.confirm : tx.open);
  if (p.c) { $('needapp').textContent = tx.needApp; $('needapp').hidden = false; }
  if (p.t !== undefined) {
    const ics = URL.createObjectURL(new Blob([buildIcs(p, now, `${p.t}-${part.slice(-12)}@motopulse`)], { type: 'text/calendar' }));
    const a = $('cal'); a.download = 'motopulse.ics'; button('cal', ics, tx.cal);
  }
  if (p.m) button('maps', mapsUrl(p.m), tx.maps);
  try {
    const lons = p.points.map(q => q.lon), lats = p.points.map(q => q.lat);
    const map = new maplibregl.Map({ container: 'map', style: STYLE, bounds: [[Math.min(...lons), Math.min(...lats)], [Math.max(...lons), Math.max(...lats)]], fitBoundsOptions: { padding: 40, maxZoom: 15 }, attributionControl: false });
    let loaded = false;
    map.on('load', () => {
      loaded = true;
      map.addSource('route', { type: 'geojson', data: { type: 'Feature', geometry: { type: 'LineString', coordinates: p.points.map(q => [q.lon, q.lat]) } } });
      map.addLayer({ id: 'route-casing', type: 'line', source: 'route', paint: { 'line-color': '#ffffff', 'line-width': 8, 'line-opacity': 0.9 }, layout: { 'line-cap': 'round', 'line-join': 'round' } });
      map.addLayer({ id: 'route', type: 'line', source: 'route', paint: { 'line-color': '#7c3aed', 'line-width': 4.5 }, layout: { 'line-cap': 'round', 'line-join': 'round' } });
      if (p.m) new maplibregl.Marker({ color: '#7c3aed' }).setLngLat([p.m.o, p.m.a]).addTo(map);
    });
    map.on('error', () => { if (loaded) return; $('mapnote').textContent = tx.noMap; $('mapnote').hidden = false; });
  } catch { $('mapnote').textContent = tx.noMap; $('mapnote').hidden = false; }
}
if (typeof document !== 'undefined') init();
