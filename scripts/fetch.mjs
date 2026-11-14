// Scarica tutte le fonti (da Supabase, riserva sources.json) e genera site/data/feed.json.
// Gira su GitHub Actions (nessun PC necessario). Nessuna dipendenza esterna: Node 20+.
import { readFile, writeFile, mkdir } from 'node:fs/promises';

const ROOT = new URL('..', import.meta.url);
const OUT = new URL('site/data/feed.json', ROOT);
const MAX_PER_SOURCE = 15;
const MAX_PER_CATEGORY = 150;
const UA = 'Mozilla/5.0 (Linux; Android 14) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0 Mobile Safari/537.36';

// Le fonti stanno su Supabase (modificabili dall'app); sources.json resta come riserva.
const SB_URL = 'https://ngbibctqhcsinjcnsjxw.supabase.co';
const SB_KEY = 'sb_publishable_MOXuqItRDGEboFnyKY9T6A_sT916c90';
let config;
try {
  const r = await fetch(`${SB_URL}/rest/v1/mytaste_config?select=config&id=eq.1`, { headers: { apikey: SB_KEY } });
  if (!r.ok) throw new Error('HTTP ' + r.status);
  config = (await r.json())[0]?.config;
  if (!config?.categories) throw new Error('nessuna configurazione');
  console.log('Fonti lette da Supabase');
} catch (e) {
  console.warn('Supabase non disponibile (' + e.message + '): uso sources.json');
  config = JSON.parse(await readFile(new URL('sources.json', ROOT), 'utf8'));
}

async function get(url, { json = false, headers = {} } = {}) {
  const ctrl = new AbortController();
  const t = setTimeout(() => ctrl.abort(), 20000);
  try {
    const res = await fetch(url, { headers: { 'User-Agent': UA, ...headers }, signal: ctrl.signal });
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    return json ? res.json() : res.text();
  } finally {
    clearTimeout(t);
  }
}

// ---------- mini parser RSS/Atom ----------
const decode = (s = '') =>
  s
    .replace(/<!\[CDATA\[([\s\S]*?)\]\]>/g, '$1')
    .replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/&quot;/g, '"')
    .replace(/&#39;|&apos;/g, "'").replace(/&#(\d+);/g, (_, n) => String.fromCodePoint(+n))
    .replace(/&#x([0-9a-f]+);/gi, (_, n) => String.fromCodePoint(parseInt(n, 16)))
    .replace(/&amp;/g, '&');
const stripTags = (s = '') => decode(s).replace(/<[^>]*>/g, ' ').replace(/\s+/g, ' ').trim();
const tag = (xml, name) => {
  const m = xml.match(new RegExp(`<${name}(?:\\s[^>]*)?>([\\s\\S]*?)</${name}>`, 'i'));
  return m ? m[1] : '';
};
const attr = (xml, name, a) => {
  const m = xml.match(new RegExp(`<${name}\\b[^>]*\\b${a}="([^"]*)"`, 'i'));
  return m ? decode(m[1]) : '';
};

function parseFeed(xml) {
  const items = [];
  const blocks = xml.match(/<item\b[\s\S]*?<\/item>/gi) || xml.match(/<entry\b[\s\S]*?<\/entry>/gi) || [];
  for (const b of blocks) {
    let link = stripTags(tag(b, 'link'));
    if (!link) {
      const links = b.match(/<link\b[^>]*>/gi) || [];
      const alt = links.find((l) => /rel="alternate"/i.test(l)) || links.find((l) => !/rel=/i.test(l)) || links[0] || '';
      link = (alt.match(/href="([^"]*)"/i) || [])[1] || '';
    }
    const date = stripTags(tag(b, 'pubDate') || tag(b, 'published') || tag(b, 'updated') || tag(b, 'dc:date'));
    let image =
      attr(b, 'media:thumbnail', 'url') ||
      attr(b, 'media:content', 'url') ||
      (b.match(/<enclosure\b[^>]*type="image[^"]*"[^>]*url="([^"]*)"/i) || b.match(/<enclosure\b[^>]*url="([^"]*\.(?:jpe?g|png|webp)[^"]*)"/i) || [])[1] ||
      (decode(tag(b, 'description') || tag(b, 'content:encoded')).match(/<img[^>]+src="([^"]+)"/i) || [])[1] ||
      '';
    const summary = stripTags(tag(b, 'description') || tag(b, 'summary') || tag(b, 'media:description') || tag(b, 'content')).slice(0, 280);
    items.push({
      title: stripTags(tag(b, 'title')),
      link: decode(link),
      date: date && !isNaN(Date.parse(date)) ? new Date(date).toISOString() : null,
      image: image ? decode(image) : '',
      summary,
    });
  }
  return items.filter((i) => i.title && i.link);
}

// ---------- tipi di fonte ----------
const ytCache = {};
async function youtubeChannelId(src) {
  if (src.channelId) return src.channelId;
  let h = (src.handle || src.url || '').trim();
  const m = h.match(/channel\/(UC[\w-]+)/);
  if (m) return m[1];
  if (/^UC[\w-]{20,}$/.test(h)) return h;
  if (!h.startsWith('http')) h = 'https://www.youtube.com/' + (h.startsWith('@') ? h : '@' + h);
  if (ytCache[h]) return ytCache[h];
  const html = await get(h, { headers: { Cookie: 'SOCS=CAI; CONSENT=YES+1', 'User-Agent': 'Mozilla/5.0' } });
  const id = (html.match(/"externalId":"(UC[\w-]+)"/) || html.match(/channel_id=(UC[\w-]+)/) || [])[1];
  if (!id) throw new Error('canale YouTube non trovato');
  return (ytCache[h] = id);
}

async function youtubeAvatar(id) {
  try {
    const html = await get(`https://www.youtube.com/channel/${id}`, { headers: { Cookie: 'SOCS=CAI; CONSENT=YES+1', 'User-Agent': 'Mozilla/5.0' } });
    const m = html.match(/<meta property="og:image" content="([^"]+)"/);
    return m ? m[1].replace(/=s\d+-/, '=s96-') : '';
  } catch { return ''; }
}

function sourceIcon(src) {
  try {
    const u = src.type === 'rss' ? src.url : '';
    return u ? `https://www.google.com/s2/favicons?domain=${new URL(u).hostname}&sz=64` : '';
  } catch { return ''; }
}

async function loadSource(src) {
  let url, kind = 'article';
  if (src.type === 'youtube') {
    url = `https://www.youtube.com/feeds/videos.xml?channel_id=${await youtubeChannelId(src)}`;
    kind = 'video';
  } else if (src.type === 'news') {
    url = `https://news.google.com/rss/search?q=${encodeURIComponent(src.query)}&hl=it&gl=IT&ceid=IT:it`;
  } else {
    url = src.url;
  }
  let items = parseFeed(await get(url));
  if (src.filter) {
    // filtro facoltativo: tiene solo gli elementi che contengono una delle parole (separate da virgola)
    const words = src.filter.toLowerCase().split(',').map((w) => w.trim()).filter(Boolean);
    items = items.filter((i) => words.some((w) => (i.title + ' ' + i.summary).toLowerCase().includes(w)));
  }
  items = items.slice(0, MAX_PER_SOURCE);
  return items.map((i) => {
    let title = i.title;
    let source = src.name;
    if (src.type === 'news') {
      // Google News: "Titolo - Testata"
      const k = title.lastIndexOf(' - ');
      if (k > 0) { source = title.slice(k + 3); title = title.slice(0, k); }
      i.summary = '';
    }
    if (kind === 'video') {
      const vid = (i.link.match(/[?&]v=([\w-]+)/) || [])[1];
      if (vid && !i.image) i.image = `https://i.ytimg.com/vi/${vid}/hqdefault.jpg`;
    }
    return { ...i, title, source, kind, via: src.name };
  });
}

// ---------- calcio (ESPN, nessuna chiave necessaria) ----------
const ESPN = 'https://site.api.espn.com/apis';
const LEAGUE_NAMES = { 'ita.1': 'Serie A', 'uefa.champions': 'Champions League', 'uefa.europa': 'Europa League', 'uefa.europa.conf': 'Conference League', 'ita.coppa_italia': 'Coppa Italia', 'ita.super_cup': 'Supercoppa' };
function mapEvent(e, lg) {
  const c = e.competitions?.[0] || {};
  const team = (x) => ({
    name: x.team?.shortDisplayName || x.team?.displayName,
    logo: x.team?.logos?.[0]?.href || x.team?.logo || '',
    score: x.score?.displayValue ?? (typeof x.score === 'string' ? x.score : null),
    id: x.team?.id,
  });
  const home = c.competitors?.find((x) => x.homeAway === 'home');
  const away = c.competitors?.find((x) => x.homeAway === 'away');
  return {
    date: e.date,
    competition: LEAGUE_NAMES[lg] || e.seasonType?.abbreviation || '',
    venue: c.venue?.fullName || '',
    status: c.status?.type?.state, // pre | in | post
    statusText: c.status?.type?.shortDetail || '',
    home: home ? team(home) : null,
    away: away ? team(away) : null,
  };
}
async function loadFootball(f) {
  const out = { team: f.teamName, results: [], fixtures: [], standings: [] };
  const leagues = f.leagues || [f.league];
  for (const lg of leagues) {
    try {
      const r = await get(`${ESPN}/site/v2/sports/soccer/${lg}/teams/${f.espnTeamId}/schedule`, { json: true });
      out.results.push(...(r.events || []).map((e) => mapEvent(e, lg)).filter((e) => e.status === 'post'));
    } catch (e) { console.warn('risultati', lg, e.message); }
    try {
      const r = await get(`${ESPN}/site/v2/sports/soccer/${lg}/teams/${f.espnTeamId}/schedule?fixture=true`, { json: true });
      out.fixtures.push(...(r.events || []).map((e) => mapEvent(e, lg)).filter((e) => e.status !== 'post'));
    } catch (e) { console.warn('calendario', lg, e.message); }
  }
  const seen = new Set();
  const uniq = (a) => a.filter((e) => { const k = e.date + e.home?.id; if (seen.has(k)) return false; seen.add(k); return true; });
  out.results = uniq(out.results.sort((a, b) => b.date.localeCompare(a.date))).slice(0, 8);
  out.fixtures = uniq(out.fixtures.sort((a, b) => a.date.localeCompare(b.date))).slice(0, 8);
  try {
    const s = await get(`${ESPN}/v2/sports/soccer/${f.league}/standings`, { json: true });
    const entries = s.children?.[0]?.standings?.entries || [];
    const stat = (en, n) => en.stats.find((x) => x.name === n)?.displayValue ?? '';
    out.standings = entries
      .map((en) => ({
        rank: +stat(en, 'rank'),
        team: en.team.shortDisplayName || en.team.displayName,
        logo: en.team.logos?.[0]?.href || '',
        played: stat(en, 'gamesPlayed'),
        points: stat(en, 'points'),
        gd: stat(en, 'pointDifferential'),
        mine: en.team.id === String(f.espnTeamId),
      }))
      .sort((a, b) => a.rank - b.rank);
  } catch (e) { console.warn('classifica', e.message); }
  // Sintesi video delle ultime partite (ricerca YouTube, preferendo i canali ufficiali)
  await Promise.all(
    out.results.slice(0, f.highlightsCount ?? 6).map(async (m) => {
      try { m.highlight = await findHighlight(m, f.highlightChannels || []); } catch (e) { console.warn('sintesi', e.message); }
    })
  );
  return out;
}

const norm = (s = '') => s.normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase();
// "Inter Milan" -> "inter", "AS Roma" -> "roma", "Milan" -> "milan"
const teamKey = (n = '') => norm(n).replace(/\b(as|ac|ss|ssc|us|fc|cfc|calcio|1907|1913)\b/g, '').replace(/\s+milan$/, '').trim().split(' ').pop();

async function findHighlight(m, trusted) {
  const h = m.home?.name, a = m.away?.name;
  if (!h || !a) return null;
  const q = `${h} ${a} highlights sintesi`;
  const html = await get(`https://www.youtube.com/results?search_query=${encodeURIComponent(q)}&sp=EgIQAQ%253D%253D`, {
    headers: { Cookie: 'SOCS=CAI; CONSENT=YES+1', 'Accept-Language': 'it-IT,it;q=0.9', 'User-Agent': 'Mozilla/5.0' },
  });
  const mm = html.match(/var ytInitialData = (\{.*?\});<\/script>/s);
  if (!mm) return null;
  const vids = [];
  (function walk(o) {
    if (Array.isArray(o)) return o.forEach(walk);
    if (o && typeof o === 'object') {
      if (o.videoRenderer) {
        const v = o.videoRenderer;
        vids.push({
          id: v.videoId,
          title: v.title?.runs?.map((r) => r.text).join('') || '',
          channel: v.ownerText?.runs?.[0]?.text || '',
          age: v.publishedTimeText?.simpleText || '',
          length: v.lengthText?.simpleText || '',
        });
      }
      Object.values(o).forEach(walk);
    }
  })(JSON.parse(mm[1]));
  const kh = teamKey(h), ka = teamKey(a);
  const daysAgo = (Date.now() - Date.parse(m.date)) / 864e5;
  const ok = vids.filter((v) => {
    const t = norm(v.title);
    if (!t.includes(kh) || !t.includes(ka)) return false;
    if (/ann[oi] fa|years? ago/.test(v.age)) return false;
    if (daysAgo < 25 && /mes[ei] fa|months? ago/.test(v.age)) return false;
    return true;
  });
  const score = (v) =>
    (trusted.some((c) => norm(v.channel) === norm(c)) ? 10 : 0) + (/highlight|sintesi/i.test(v.title) ? 3 : 0) + (/extended/i.test(v.title) ? 1 : 0);
  ok.sort((x, y) => score(y) - score(x));
  const v = ok[0];
  return v ? { url: `https://www.youtube.com/watch?v=${v.id}`, title: v.title, channel: v.channel, length: v.length, image: `https://i.ytimg.com/vi/${v.id}/hqdefault.jpg` } : null;
}

// ---------- main ----------
const result = { updated: new Date().toISOString(), categories: [], errors: [] };
for (const cat of config.categories) {
  const items = [];
  await Promise.all(
    (cat.sources || []).map(async (src) => {
      try {
        items.push(...(await loadSource(src)));
      } catch (e) {
        result.errors.push(`${cat.name} › ${src.name}: ${e.message}`);
      }
    })
  );
  const seen = new Set();
  const dedup = items
    .sort((a, b) => (b.date || '').localeCompare(a.date || ''))
    .filter((i) => { const k = i.title.toLowerCase().slice(0, 70); if (seen.has(k)) return false; seen.add(k); return true; })
    .slice(0, MAX_PER_CATEGORY);
  const sources = await Promise.all(
    (cat.sources || []).map(async (src) => ({
      name: src.name,
      type: src.type,
      avatar: src.type === 'youtube' ? await youtubeChannelId(src).then(youtubeAvatar).catch(() => '') : sourceIcon(src),
      count: dedup.filter((i) => i.via === src.name).length,
    }))
  );
  const entry = { id: cat.id, name: cat.name, icon: cat.icon || '⭐', sources, items: dedup };
  if (cat.football) {
    try { entry.football = await loadFootball(cat.football); } catch (e) { result.errors.push(`${cat.name} › calcio: ${e.message}`); }
  }
  result.categories.push(entry);
  console.log(`${cat.name}: ${dedup.length} elementi`);
}
if (result.errors.length) console.warn('Errori:\n' + result.errors.join('\n'));
await mkdir(new URL('site/data/', ROOT), { recursive: true });
await writeFile(OUT, JSON.stringify(result));
console.log('Scritto', OUT.pathname);
