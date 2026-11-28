// MotoPulse link page: decodes the "v1" payload from the # of the URL and draws it. This page calls no server and tracks nothing.
// decodeShareLink and buildIcs must stay equal to src/portability/share_link.ts and group_invite.ts (test/link_page.test.ts).
// plecare-C3: a planned ride (code c) is also on the MotoPulse server; its short page answers „Vin / Poate” without the app.
const ALPHABET = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789-_';
const DAY = 86400000;
/** Where Android sends people who do not have the app (the intent fallback and „Instalează MotoPulse”). */
export const INSTALL_URL = 'https://play.google.com/store/apps/details?id=com.motopulse.app';
/** The groups Worker; keep equal to SHORT_LINK_BASE in src/online/groups_config.ts (test/link_short.test.ts). */
export const SHORT_BASE = 'https://motopulse-groups.sebastiantronaru2.workers.dev';

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

/** GR-2 / I29: the join code (and optional 256-bit E2E key) of "<page>#g.<CODE>[.<KEY>]" or "motopulse://open/g/<CODE>[.<KEY>]", or null (same rule as decodeGroupInvite in share_link.ts). */
export function groupInvite(urlOrFragment) {
  const match = /^(?:.*#|motopulse:\/\/open\/?#?|motopulse:\/\/open\/)?g[./]([A-HJ-NP-Za-hj-np-z2-9]{8})(?:\.([A-Za-z0-9_-]{43}))?\/?$/s.exec(String(urlOrFragment).trim());
  return match ? { code: match[1].toUpperCase(), key: match[2] ?? null } : null;
}
export function groupCode(urlOrFragment) {
  return groupInvite(urlOrFragment)?.code ?? null;
}
// Without the app, Android opens the fallback (the install page) instead of doing nothing.
// For E2E group invites, KEY stays on-device in the intent URI (never sent to any HTTP server or rendered as text).
const FALLBACK = `S.browser_fallback_url=${encodeURIComponent(INSTALL_URL)};`;
export const groupIntentUrl = (code, key = null) => `intent://open/g/${key ? `${code}.${key}` : code}#Intent;scheme=motopulse;package=com.motopulse.app;${FALLBACK}end`;
export const intentUrl = part => `intent://open/v1/${part}#Intent;scheme=motopulse;package=com.motopulse.app;${FALLBACK}end`;
/** The short page of a planned ride on the Worker: the answer from any browser, iPhone included. */
export const shortUrl = code => `${SHORT_BASE}/r/${code}`;
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

export const TEXT = {
  ro: { invite: 'Invitație la tură de grup', ride: 'Tură', dist: 'Distanță', when: 'Când', where: 'Întâlnire', note: 'Notă', open: 'Deschide în MotoPulse', install: 'Instalează MotoPulse', answer: 'Răspunde: Vin / Poate', noApp: 'Poți răspunde și fără aplicație.', ios: 'MotoPulse e deocamdată doar pentru Android.', group: 'Invitație într-un grup MotoPulse', code: 'Cod de grup', e2eLabel: 'Confidențialitate', e2eValue: 'Criptat de la un capăt la altul', privGroupE2e: 'Cheia grupului stă doar în link, pe telefon, și nu ajunge la niciun server.', cal: 'Adaugă în calendar', maps: 'Întâlnirea în Google Maps', invalid: 'Link invalid. Cere să ți se trimită din nou.', noMap: 'Harta nu s-a putut încărca. Datele turei sunt mai sus.', priv: 'Datele turei stau în link, nu pe un server.', privServer: 'Tura e păstrată și pe serverul MotoPulse, ca să poți răspunde. Oricine are linkul o vede.' },
  en: { invite: 'Group ride invitation', ride: 'Ride', dist: 'Distance', when: 'When', where: 'Meeting point', note: 'Note', open: 'Open in MotoPulse', install: 'Install MotoPulse', answer: 'Answer: I’m in / Maybe', noApp: 'You can answer without the app.', ios: 'MotoPulse is Android-only for now.', group: 'Invitation to a MotoPulse group', code: 'Group code', e2eLabel: 'Privacy', e2eValue: 'End-to-end encrypted', privGroupE2e: 'The group key stays only in the link, on your phone, and never reaches any server.', cal: 'Add to calendar', maps: 'Meeting point in Google Maps', invalid: 'Invalid link. Ask for it to be sent again.', noMap: 'The map could not be loaded. The ride details are above.', priv: 'The ride data lives in the link, not on a server.', privServer: 'The ride is also kept on the MotoPulse server, so you can answer. Anyone with the link can see it.' },
};
const STYLE = 'https://tiles.openfreemap.org/styles/liberty';

/** Which actions the page offers (pure, tested): the short page answers from any browser; the app opens only on Android, where its absence falls back to the install page. */
export function actionsFor(kind, rideCode, userAgent) {
  const android = /Android/i.test(userAgent), ios = /iPhone|iPad|iPod/i.test(userAgent);
  return { answer: !!rideCode && kind === 'invite', open: android, install: !ios, iosNote: ios && !(rideCode && kind === 'invite') };
}

function init() {
  const $ = id => document.getElementById(id);
  const tx = TEXT[(navigator.language || 'en').toLowerCase().startsWith('ro') ? 'ro' : 'en'];
  document.documentElement.lang = (navigator.language || 'en').toLowerCase().startsWith('ro') ? 'ro' : 'en';
  const button = (id, href, label) => { const a = $(id); a.textContent = label; a.href = href; a.hidden = false; };
  const note = text => { $('needapp').textContent = text; $('needapp').hidden = false; };
  const now = Date.now(), hash = location.hash, grp = groupInvite(hash);
  if (grp) {
    $('map').hidden = true; $('kind').textContent = 'MotoPulse'; $('title').textContent = tx.group; document.title = `${tx.group} · MotoPulse`;
    const dt = document.createElement('dt'), dd = document.createElement('dd'); dt.textContent = tx.code; dd.textContent = grp.code; $('facts').append(dt, dd);
    if (grp.key) {
      const eDt = document.createElement('dt'), eDd = document.createElement('dd');
      eDt.textContent = tx.e2eLabel; eDd.textContent = tx.e2eValue;
      $('facts').append(eDt, eDd);
      $('privacy').textContent = tx.privGroupE2e;
    }
    const act = actionsFor('group', null, navigator.userAgent);
    if (act.open) button('open', groupIntentUrl(grp.code, grp.key), tx.open);
    if (act.install) button('install', INSTALL_URL, tx.install);
    if (act.iosNote) note(tx.ios);
    return;
  }
  const p = decodeShareLink(hash, now);
  if (!p) { $('map').hidden = true; $('error').textContent = tx.invalid; $('error').hidden = false; return; }
  // A ride with a code is kept on the server too: the line about the link would not be true for it.
  $('privacy').textContent = p.c ? tx.privServer : tx.priv;
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
  const part = payloadPart(hash), act = actionsFor(p.k === 'i' ? 'invite' : 'ride', p.c ?? null, navigator.userAgent);
  if (act.answer) { button('web', shortUrl(p.c), tx.answer); note(tx.noApp); }
  if (act.open) button('open', intentUrl(part), tx.open);
  if (act.install) button('install', INSTALL_URL, tx.install);
  if (act.iosNote) note(tx.ios);
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
