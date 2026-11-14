'use strict';
// MyTaste – app per i propri interessi. I dati vengono generati ogni ora da GitHub Actions (data/feed.json).

const $ = (s, el = document) => el.querySelector(s);
const esc = (s = '') => String(s).replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
const store = {
  get(k, d = null) { try { const v = localStorage.getItem('mt.' + k); return v == null ? d : JSON.parse(v); } catch { return d; } },
  set(k, v) { try { localStorage.setItem('mt.' + k, JSON.stringify(v)); } catch {} },
  del(k) { try { localStorage.removeItem('mt.' + k); } catch {} },
};

// Repository GitHub: ricavato dall'indirizzo (utente.github.io/repo), modificabile nelle impostazioni.
function repoInfo() {
  const saved = store.get('repo');
  if (saved) return saved;
  const m = location.hostname.match(/^([^.]+)\.github\.io$/);
  const repo = location.pathname.split('/').filter(Boolean)[0];
  if (m && repo) return { owner: m[1], name: repo };
  return { owner: 'lucacarnimeo1979-max', name: 'mytaste' };
}
// Archivio delle fonti su Supabase: l'app salva da sola, senza passaggi su GitHub.
// Chiave pubblica "anon": serve solo a chiamare la funzione e a leggere le fonti.
const SB_URL = 'https://ngbibctqhcsinjcnsjxw.supabase.co';
const SB_KEY = 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6Im5nYmliY3RxaGNzaW5qY25zanh3Iiwicm9sZSI6ImFub24iLCJpYXQiOjE3OTE2MTA0ODUsImV4cCI6MjEwNzE4NjQ4NX0.N7SvHvhdW8UKhimPprXXmmCf4IsWxLQmct5numWxll8';
async function api(action, payload = {}) {
  const r = await fetch(`${SB_URL}/functions/v1/mytaste`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', Authorization: 'Bearer ' + SB_KEY, apikey: SB_KEY },
    body: JSON.stringify({ action, ...payload }),
  });
  const j = await r.json().catch(() => ({}));
  if (!r.ok || j.error) throw new Error(j.error || 'Servizio non raggiungibile');
  return j;
}
async function fetchConfig() {
  const r = await fetch(`${SB_URL}/rest/v1/mytaste_config?select=config&id=eq.1`, { headers: { apikey: SB_KEY, Authorization: 'Bearer ' + SB_KEY }, cache: 'no-store' });
  if (!r.ok) throw new Error('HTTP ' + r.status);
  const rows = await r.json();
  if (!rows[0]?.config) throw new Error('vuoto');
  return rows[0].config;
}

const state = { data: null, sources: null, tab: store.get('tab', null), filter: {}, shown: {}, lastLoad: 0 };

// Ultima visita: tutto ciò che è uscito dopo è "nuovo"
const prevVisit = store.get('visit', Date.now() - 864e5);
const markVisit = () => store.set('visit', Date.now());
const isNew = (i) => i.date && Date.parse(i.date) > prevVisit;

// Colore e motivo di ogni sezione. Le nuove categorie prendono un colore dalla tavolozza.
const THEMES = {
  milan: { c: '#d7141a', on: '#ffffff', ink: '#b3101a', p: 'stripes' },
  ai: { c: '#0b8a7a', on: '#ffffff', ink: '#08705f', p: 'dots' },
  divertimento: { c: '#ffbf1f', on: '#231a00', ink: '#8a6200', p: 'wave' },
};
const PALETTE = [
  { c: '#2f5bea', on: '#ffffff', ink: '#2449c4' }, { c: '#e2541f', on: '#ffffff', ink: '#b8410f' },
  { c: '#7a3cc9', on: '#ffffff', ink: '#6630ad' }, { c: '#1f8f4d', on: '#ffffff', ink: '#17733d' },
  { c: '#d6337a', on: '#ffffff', ink: '#b02462' }, { c: '#0a7fb0', on: '#ffffff', ink: '#08688f' },
];
function themeOf(id) {
  if (THEMES[id]) return THEMES[id];
  const h = [...String(id)].reduce((a, ch) => (a * 31 + ch.charCodeAt(0)) >>> 0, 7);
  return { ...PALETTE[h % PALETTE.length], p: ['dots', 'wave'][h % 2] };
}
function applyTheme(id) {
  const t = id === '_src' ? { c: '#3a3f4a', on: '#ffffff', ink: '#3a3f4a' } : themeOf(id);
  const r = document.documentElement.style;
  r.setProperty('--cat', t.c); r.setProperty('--on-cat', t.on); r.setProperty('--cat-ink', t.ink);
  document.querySelector('meta[name="theme-color"]')?.setAttribute('content', t.c);
}
function greeting() {
  const h = new Date().getHours();
  const name = store.get('name', '');
  const g = h < 5 ? 'Buonanotte' : h < 13 ? 'Buongiorno' : h < 18 ? 'Buon pomeriggio' : 'Buonasera';
  $('#greet').textContent = name ? `${g}, ${name}` : g;
  $('#today').textContent = new Date().toLocaleDateString('it-IT', { weekday: 'long', day: 'numeric', month: 'long' });
}

// ---------- utilità date ----------
const rtf = new Intl.RelativeTimeFormat('it', { numeric: 'auto' });
function ago(iso) {
  if (!iso) return '';
  const s = (Date.parse(iso) - Date.now()) / 1000;
  const a = Math.abs(s);
  if (a < 60) return 'adesso';
  if (a < 3600) return rtf.format(Math.round(s / 60), 'minute');
  if (a < 86400) return rtf.format(Math.round(s / 3600), 'hour');
  if (a < 86400 * 7) return rtf.format(Math.round(s / 86400), 'day');
  return new Date(iso).toLocaleDateString('it-IT', { day: 'numeric', month: 'short' });
}
const fmtMatch = (iso) => new Date(iso).toLocaleString('it-IT', { weekday: 'short', day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit' });
const fmtShort = (iso) => new Date(iso).toLocaleDateString('it-IT', { day: '2-digit', month: '2-digit' });
function countdown(iso) {
  const d = Date.parse(iso) - Date.now();
  if (d <= 0) return 'In corso / appena giocata';
  const g = Math.floor(d / 864e5), h = Math.floor((d % 864e5) / 36e5), m = Math.floor((d % 36e5) / 6e4);
  return g > 0 ? `tra ${g} g ${h} h` : h > 0 ? `tra ${h} h ${m} min` : `tra ${m} min`;
}

function toast(msg, ms = 3200) {
  const t = document.createElement('div');
  t.className = 'toast';
  t.textContent = msg;
  document.body.appendChild(t);
  setTimeout(() => t.remove(), ms);
}

// ---------- caricamento dati ----------
async function load(force = false) {
  const btn = $('#refresh');
  btn.classList.add('spin');
  try {
    const [d, s] = await Promise.all([
      fetch('data/feed.json?t=' + Date.now(), { cache: 'no-store' }).then((r) => { if (!r.ok) throw new Error(r.status); return r.json(); }),
      fetchConfig().catch(() => fetch('sources.json?t=' + Date.now(), { cache: 'no-store' }).then((r) => (r.ok ? r.json() : null)).catch(() => null)),
    ]);
    state.data = d;
    if (s) state.sources = s;
    state.lastLoad = Date.now();
    store.set('cache', d);
  } catch (e) {
    const c = store.get('cache');
    if (c && !state.data) state.data = c;
    if (force) toast('Offline: mostro gli ultimi dati salvati');
  } finally {
    btn.classList.remove('spin');
  }
  render();
}

// ---------- render ----------
function render() {
  const d = state.data;
  greeting();
  $('#updated').innerHTML = d ? `Aggiornato<br>${esc(ago(d.updated))}` : '';
  const cats = d?.categories || [];
  const tabs = [...cats.map((c) => ({ id: c.id, name: c.name, icon: c.icon })), { id: '_src', name: 'Fonti', icon: '⚙️' }];
  if (!tabs.some((t) => t.id === state.tab)) state.tab = tabs[0].id;
  applyTheme(state.tab);
  $('#tabs').innerHTML = tabs
    .map((t) => {
      const th = t.id === '_src' ? { c: '#3a3f4a', on: '#fff' } : themeOf(t.id);
      return `<button class="tab ${t.id === state.tab ? 'active' : ''}" data-tab="${esc(t.id)}" style="--tab-c:${th.c};--tab-on:${th.on}" aria-label="${esc(t.name)}"><span class="ic">${esc(t.icon)}</span><span class="lb">${esc(shortName(t.name))}</span></button>`;
    })
    .join('');
  const v = $('#view');
  if (state.tab === '_src') return renderSources(v);
  if (!d) { v.innerHTML = '<div class="empty">Nessun dato ancora. Il primo aggiornamento automatico arriva entro pochi minuti dall\'attivazione.</div>'; return; }
  const cat = cats.find((c) => c.id === state.tab);
  v.innerHTML = heroHTML(cat) + (cat.football ? footballHTML(cat.football) : '') + newsHTML(cat);
}
const shortName = (n) => (n.length > 13 ? n.split(' ')[0] : n);

// Testata colorata della sezione
function heroHTML(cat) {
  const t = themeOf(cat.id);
  const fresh = cat.items.filter(isNew).length;
  const last = cat.items[0]?.date;
  const srcs = (cat.sources || []).filter((s) => s.avatar);
  const stack = srcs.length ? `<span class="stack">${srcs.slice(0, 5).map((s) => `<img src="${esc(s.avatar)}" alt="" loading="lazy" onerror="this.remove()">`).join('')}</span>` : '';
  const sub = `<div class="sub">${stack}<span>${fresh ? `<b>${fresh} ${fresh === 1 ? 'nuovo' : 'nuovi'}</b> dall'ultima visita` : 'Sei in pari'}</span>${last ? `<span>ultimo ${esc(ago(last))}</span>` : ''}</div>`;
  const f = cat.football;
  const next = f?.fixtures?.[0];
  if (next) {
    const d = Math.max(0, Date.parse(next.date) - Date.now());
    const live = next.status === 'in';
    const clock = live ? '' : `<div class="clock"><div><b>${Math.floor(d / 864e5)}</b><small>giorni</small></div><div><b>${Math.floor((d % 864e5) / 36e5)}</b><small>ore</small></div><div><b>${Math.floor((d % 36e5) / 6e4)}</b><small>min</small></div></div>`;
    const form = f.results.slice(0, 5).reverse().map((r) => outcome(r)).join('');
    return `<section class="hero p-${t.p || 'dots'}">
      <div class="eyebrow">${esc(cat.icon)} ${esc(cat.name)} · ${live ? '<b>in diretta</b>' : 'prossima partita'} · ${esc(next.competition)}</div>
      <div class="fixture">
        <div class="tm"><img src="${esc(next.home.logo)}" alt="">${esc(next.home.name)}</div>
        <div class="mid ${live ? 'live' : ''}">${live ? `${esc(next.home.score)}–${esc(next.away.score)}` : 'VS'}</div>
        <div class="tm"><img src="${esc(next.away.logo)}" alt="">${esc(next.away.name)}</div>
      </div>
      ${clock}
      <div class="when-line">${esc(fmtMatch(next.date))}${next.venue ? ' · ' + esc(next.venue) : ''}</div>
      ${form ? `<div class="form" title="Ultime 5 partite">${form}</div>` : ''}
    </section>`;
  }
  return `<section class="hero p-${t.p || 'dots'}">
    <div class="eyebrow">${esc(cat.icon)} ${(cat.sources || []).length} ${(cat.sources || []).length === 1 ? 'fonte' : 'fonti'}</div>
    <h1>${esc(cat.name)}</h1>${sub}</section>`;
}

function metaHTML(i) {
  return `${isNew(i) ? '<span class="new">Nuovo</span>' : ''}${i.kind === 'video' ? '<span class="badge">Video</span>' : ''}<span class="who">${esc(i.source)}</span><span>· ${esc(ago(i.date))}</span>`;
}
function itemHTML(i) {
  const img = i.image ? `<span class="pic"><img class="thumb" loading="lazy" src="${esc(i.image)}" alt="" onerror="this.parentNode.remove()">${i.kind === 'video' ? '<span class="dur">▶</span>' : ''}</span>` : '';
  return `<a class="card item ${i.kind}" href="${esc(i.link)}" target="_blank" rel="noopener">${img}
    <div class="body"><div class="title">${esc(i.title)}</div><div class="meta">${metaHTML(i)}</div></div></a>`;
}
function featureHTML(i) {
  return `<a class="feature ${i.image ? '' : 'noimg'}" href="${esc(i.link)}" target="_blank" rel="noopener">
    ${i.image ? `<img src="${esc(i.image)}" alt="" onerror="this.parentNode.classList.add('noimg');this.remove()">` : ''}
    <div class="ov"><div class="meta">${metaHTML(i)}</div><div class="title">${esc(i.title)}</div></div></a>`;
}

// Notizie e video con la colonna delle fonti a sinistra (tocca una fonte per filtrare)
const initials = (n) => n.replace(/[^\p{L}\p{N} ]/gu, ' ').split(/\s+/).filter(Boolean).slice(0, 2).map((w) => w[0]).join('').toUpperCase();
function sideBtn(cat, key, label, avatar, active, count, hot) {
  const pic = avatar
    ? `<img src="${esc(avatar)}" alt="" loading="lazy" onerror="this.replaceWith(Object.assign(document.createElement('span'),{className:'av',textContent:'${esc(initials(label))}'}))">`
    : `<span class="av">${esc(avatar === null ? label.slice(0, 2) : initials(label))}</span>`;
  return `<button class="side-btn ${active ? 'active' : ''}" data-filter="${esc(key)}" data-cat="${esc(cat.id)}">${pic}<span class="nm">${esc(label)}</span>${count != null ? `<span class="ct ${hot ? 'hot' : ''}">${count}</span>` : ''}</button>`;
}

function newsHTML(cat) {
  const f = state.filter[cat.id] || 'all';
  const srcs = cat.sources?.length ? cat.sources : [...new Set(cat.items.map((i) => i.via))].map((name) => ({ name }));
  const hasVideo = cat.items.some((i) => i.kind === 'video');
  const hasArt = cat.items.some((i) => i.kind !== 'video');
  let items = cat.items;
  if (f === 'video' || f === 'article') items = items.filter((i) => i.kind === f);
  else if (f.startsWith('src:')) items = items.filter((i) => i.via === f.slice(4));
  const n = state.shown[cat.id + f] || 20;
  const side = [
    sideBtn(cat, 'all', 'Tutto', '', f === 'all').replace('<span class="av">T</span>', '<span class="av">★</span>'),
    ...(hasVideo && hasArt ? [
      sideBtn(cat, 'video', 'Video', '', f === 'video').replace('<span class="av">V</span>', '<span class="av">▶</span>'),
      sideBtn(cat, 'article', 'Notizie', '', f === 'article').replace('<span class="av">N</span>', '<span class="av">📰</span>'),
    ] : []),
    '<hr>',
    ...srcs.map((s) => sideBtn(cat, 'src:' + s.name, s.name, s.avatar || '', f === 'src:' + s.name, s.count, cat.items.some((i) => i.via === s.name && isNew(i)))),
    '<hr>',
    `<button class="side-btn tool" data-addsrc="${esc(cat.id)}"><span class="av plus">+</span><span class="nm">Aggiungi</span></button>`,
    `<button class="side-btn tool ${state.editing === cat.id ? 'on' : ''}" data-edmode="${esc(cat.id)}"><span class="av minus">${state.editing === cat.id ? '✓' : '✎'}</span><span class="nm">${state.editing === cat.id ? 'Fatto' : 'Rinomina'}</span></button>`,
    `<button class="side-btn tool ${state.removing === cat.id ? 'on' : ''}" data-rmmode="${esc(cat.id)}"><span class="av minus">${state.removing === cat.id ? '✓' : '−'}</span><span class="nm">${state.removing === cat.id ? 'Fatto' : 'Togli'}</span></button>`,
  ].join('');
  const title = f === 'all' ? (cat.football ? 'Notizie e video' : 'Ultimi contenuti') : f === 'video' ? 'Video' : f === 'article' ? 'Notizie' : f.slice(4);
  const shown = items.slice(0, n);
  return `<h2 id="feed-top">${esc(title)} <small>${items.length} contenuti</small></h2>
    <div class="split"><aside class="side ${state.removing === cat.id ? 'removing' : ''} ${state.editing === cat.id ? 'editing' : ''}">${side}</aside>
    <div class="feed"><div class="list">${shown.length ? featureHTML(shown[0]) + shown.slice(1).map(itemHTML).join('') : '<div class="empty">Ancora nessun contenuto da questa fonte</div>'}</div>
    ${items.length > n ? `<button class="more" data-more="${esc(cat.id + f)}">Mostra altri</button>` : ''}</div></div>`;
}

function outcome(m, team) {
  const mineHome = /milan/i.test(m.home.name) && !/inter/i.test(m.home.name);
  const a = +m.home.score, b = +m.away.score;
  if (isNaN(a) || isNaN(b)) return '';
  const r = a === b ? 'D' : (a > b) === mineHome ? 'W' : 'L';
  return `<span class="wdl ${r}">${{ W: 'V', D: 'N', L: 'P' }[r]}</span>`;
}

function footballHTML(f) {
  let h = '';
  const hls = f.results.filter((r) => r.highlight);
  if (hls.length) {
    h += `<h2>Sintesi delle partite <small>video highlights</small></h2><div class="hscroll">${hls
      .map((r) => `<a class="card" href="${esc(r.highlight.url)}" target="_blank" rel="noopener">
        <div class="hl" style="margin:0"><img loading="lazy" src="${esc(r.highlight.image)}" alt=""><div class="play"><span>▶</span></div>
        <div class="cap">${esc(r.home.name)} ${esc(r.home.score)}–${esc(r.away.score)} ${esc(r.away.name)}${r.highlight.length ? ' · ' + esc(r.highlight.length) : ''}</div></div>
        <div class="hl-meta"><b>${esc(r.highlight.channel)}</b> · ${esc(r.competition)} · ${esc(fmtShort(r.date))}</div></a>`)
      .join('')}</div>`;
  }
  if (f.results.length) {
    h += `<h2>Ultimi risultati</h2><div class="card">${f.results
      .map((r) => `<div class="res-row">${outcome(r)}<div class="when">${esc(fmtShort(r.date))}</div>
        <div class="vs">${esc(r.home.name)} – ${esc(r.away.name)}<small>${esc(r.competition)}</small></div>
        <div class="sc">${esc(r.home.score)}-${esc(r.away.score)}</div>
        ${r.highlight ? `<a class="hl-btn" href="${esc(r.highlight.url)}" target="_blank" rel="noopener">▶ Sintesi</a>` : ''}</div>`)
      .join('')}</div>`;
  }
  if (f.fixtures.length > 1) {
    h += `<h2>Calendario</h2><div class="card">${f.fixtures
      .slice(1)
      .map((r) => `<div class="res-row"><div class="when">${esc(fmtShort(r.date))}</div>
        <div class="vs">${esc(r.home.name)} – ${esc(r.away.name)}<small>${esc(r.competition)} · ${esc(new Date(r.date).toLocaleTimeString('it-IT', { hour: '2-digit', minute: '2-digit' }))}</small></div></div>`)
      .join('')}</div>`;
  }
  if (f.standings.length) {
    const all = state.shown._std;
    const mineIdx = f.standings.findIndex((s) => s.mine);
    const rows = all ? f.standings : f.standings.filter((s, i) => i < 6 || Math.abs(i - mineIdx) <= 1);
    h += `<h2>Classifica Serie A</h2><div class="card"><table class="std"><tr><th>#</th><th class="t">Squadra</th><th>G</th><th>DR</th><th>Pt</th></tr>${rows
      .map((s) => `<tr class="${s.mine ? 'mine' : ''}"><td>${s.rank}</td><td class="t"><img src="${esc(s.logo)}" alt="">${esc(s.team)}</td><td>${esc(s.played)}</td><td>${esc(s.gd)}</td><td><b>${esc(s.points)}</b></td></tr>`)
      .join('')}</table></div><button class="more" data-std="1">${all ? 'Mostra meno' : 'Classifica completa'}</button>`;
  }
  return h;
}

// ---------- gestione fonti ----------
const TYPE_LABEL = { youtube: 'Canale YouTube', rss: 'Sito / RSS', news: 'Ricerca Google News' };
function srcDetail(s) { return s.type === 'youtube' ? s.handle || s.channelId || s.url : s.type === 'news' ? '“' + s.query + '”' : s.url; }

function renderSources(v) {
  const s = state.sources;
  const r = repoInfo();
  const errs = state.data?.errors || [];
  v.innerHTML = `
    <section class="hero p-dots"><div class="eyebrow">⚙️ ${s ? s.categories.length : 0} sezioni · ${s ? s.categories.reduce((a, c) => a + (c.sources || []).length, 0) : 0} fonti</div><h1>Fonti e impostazioni</h1>
      <div class="sub">Cerca un canale per nome e aggiungilo con un tocco.</div></section>
    <h2>Le mie fonti</h2>
    ${s ? s.categories.map((c, ci) => `
      <div class="card src-cat"><header><span class="dotc" style="background:${themeOf(c.id).c}"></span><span>${esc(c.icon || '⭐')}</span><span class="grow">${esc(c.name)}</span>
        <button class="x" title="Rinomina categoria" data-rencat="${ci}">✎</button>
        <button class="btn sm" data-add="${ci}">+ Fonte</button>
        ${c.football ? '' : `<button class="x" title="Elimina categoria" data-delcat="${ci}">🗑</button>`}</header>
        ${(c.sources || []).map((x, si) => `<div class="src"><div class="grow">${esc(x.name)}<small>${esc(TYPE_LABEL[x.type] || x.type)} · ${esc(srcDetail(x))}</small></div>
          <button class="x" title="Rinomina" data-ren="${ci}:${si}">✎</button><button class="x" title="Rimuovi" data-del="${ci}:${si}">✕</button></div>`).join('')}
      </div>`).join('') : '<div class="empty">Elenco fonti non disponibile</div>'}
    <div class="row"><button class="btn ghost" data-newcat="1">+ Nuova categoria (es. Tecnologia, Viaggi…)</button></div>

    <h2>Aggiornamenti</h2>
    <div class="card notice">I contenuti si scaricano <b>da soli ogni ora</b>, anche a telefono e PC spenti. Quando aggiungi un canale, i suoi ultimi video compaiono subito.
      Ultimo aggiornamento: <b>${state.data ? esc(new Date(state.data.updated).toLocaleString('it-IT')) : '—'}</b>.
      ${errs.length ? `<br><br>Fonti con problemi all'ultimo giro:<br>${errs.map(esc).join('<br>')}` : ''}</div>
    <div class="row" style="margin-top:10px"><a class="btn ghost" href="https://github.com/${esc(r.owner)}/${esc(r.name)}/actions" target="_blank" rel="noopener">Vedi gli aggiornamenti su GitHub</a></div>

    <h2>Impostazioni</h2>
    <div class="card notice" style="margin-bottom:10px">
      <label for="set-name" style="margin-top:0">Il tuo nome, per il saluto (resta solo su questo dispositivo)</label>
      <input id="set-name" value="${esc(store.get('name', ''))}" placeholder="es. Marco" autocomplete="given-name">
    </div>
`;
}

function openSheet(html) { $('#sheet-card').innerHTML = html; $('#sheet').classList.remove('hidden'); }
function closeSheet() { $('#sheet').classList.add('hidden'); }

// Aggiungi una fonte: scrivi un nome (cerca su YouTube), un link a un canale o l'indirizzo di un sito
function addSourceForm(ci) {
  const c = state.sources.categories[ci];
  openSheet(`<h3>Aggiungi a ${esc(c.name)}</h3>
    <div class="notice" style="padding:2px 0 6px">Scrivi il nome di un canale YouTube, oppure incolla un link o l'indirizzo di un sito.</div>
    <form id="f-form" class="search"><input id="f-q" type="search" placeholder="es. Mandrake, @canale, ilpost.it" autocapitalize="off" autocomplete="off" enterkeyhint="search">
    <button class="btn" type="submit">Cerca</button></form>
    <div id="f-res" class="results"></div>`);
  const q = $('#f-q');
  setTimeout(() => q.focus(), 50);
  let found = [];
  const draw = (html) => { $('#f-res').innerHTML = html; };
  $('#f-form').onsubmit = async (e) => {
    e.preventDefault();
    const text = q.value.trim();
    if (!text) return;
    draw('<div class="notice">Cerco…</div>');
    try {
      const r = await api('find', { q: text });
      found = r.results || [];
      const looksLikeLink = /^https?:|\.\w{2,}(\/|$)|^@/.test(text);
      if (!looksLikeLink) found.push({ type: 'news', name: 'Notizie su ' + text, query: text, subs: 'Ricerca su Google News' });
      draw(found.length ? found.map((x, k) => `<button class="res" data-pick="${k}">
          ${x.avatar ? `<img src="${esc(x.avatar)}" alt="" loading="lazy">` : `<span class="av">${x.type === 'news' ? '📰' : x.type === 'rss' ? '🌐' : '▶'}</span>`}
          <span class="grow"><b>${esc(x.name || x.handle || 'Canale')}</b><small>${esc(x.type === 'youtube' ? [x.handle, x.subs].filter(Boolean).join(' · ') || 'Canale YouTube' : x.type === 'rss' ? x.url : x.subs)}</small></span>
          <span class="addp">+</span></button>`).join('') : `<div class="notice">Nessun risultato${r.warning ? ' (' + esc(r.warning) + ')' : ''}. Prova con @nome del canale o con il link.</div>`);
    } catch (err) { draw(`<div class="notice warn">${esc(err.message)}</div>`); }
  };
  $('#f-res').onclick = async (e) => {
    const b = e.target.closest('[data-pick]');
    if (!b) return;
    const x = found[+b.dataset.pick];
    const src = { name: (x.name || x.handle || 'Canale').trim(), type: x.type };
    if (x.type === 'youtube') { src.channelId = x.channelId; if (x.handle) src.handle = x.handle; }
    else if (x.type === 'rss') src.url = x.url;
    else src.query = x.query;
    if (c.sources.some((y) => y.name === src.name || (src.channelId && y.channelId === src.channelId))) return toast('È già tra le tue fonti');
    b.disabled = true; b.querySelector('.addp').textContent = '…';
    await saveSources((cfg) => { cfg.categories.find((k) => k.id === c.id).sources.push(src); }, `Aggiunta fonte "${src.name}"`, { catId: c.id, src, avatar: x.avatar || '' });
  };
}

// Rinomina un canale (si >= 0) o una categoria (si = -1)
function renameForm(ci, si) {
  const c = state.sources.categories[ci];
  const isCat = si < 0;
  const old = isCat ? c.name : c.sources[si].name;
  openSheet(`<h3>${isCat ? 'Rinomina categoria' : 'Rinomina canale'}</h3>
    <label>Nome</label><input id="r-name" value="${esc(old)}">
    ${isCat ? `<label>Icona (emoji)</label><input id="r-icon" value="${esc(c.icon || '')}" maxlength="4">` : ''}
    <div class="row" style="margin-top:16px"><button class="btn" id="r-ok">Salva</button><button class="btn ghost" data-close="1">Annulla</button></div>`);
  const inp = $('#r-name'); inp.focus(); inp.select();
  $('#r-ok').onclick = async () => {
    const name = inp.value.trim();
    const icon = isCat ? $('#r-icon').value.trim() : '';
    if (!name) return toast('Scrivi un nome');
    if (!isCat && c.sources.some((x, i) => i !== si && x.name === name)) return toast('Esiste già una fonte con questo nome');
    await saveSources((cfg) => {
      const cc = cfg.categories.find((x) => x.id === c.id);
      if (isCat) { cc.name = name; if (icon) cc.icon = icon; return; }
      const s = cc.sources.find((x) => x.name === old);
      if (s) s.name = name;
      // aggiorna subito anche i contenuti già scaricati
      const d = state.data?.categories.find((x) => x.id === c.id);
      if (d) {
        d.items.forEach((i) => { if (i.via === old) { i.via = name; if (i.source === old) i.source = name; } });
        (d.sources || []).forEach((x) => { if (x.name === old) x.name = name; });
      }
      if (state.filter[c.id] === 'src:' + old) state.filter[c.id] = 'src:' + name;
    }, isCat ? `Rinominata categoria "${old}" in "${name}"` : `Rinominato "${old}" in "${name}"`);
  };
}

function newCategoryForm() {
  openSheet(`<h3>Nuova categoria</h3>
    <label>Nome</label><input id="c-name" placeholder="es. Tecnologia">
    <label>Icona (emoji)</label><input id="c-icon" placeholder="es. 💻" maxlength="4">
    <div class="row" style="margin-top:16px"><button class="btn" id="c-ok">Crea</button><button class="btn ghost" data-close="1">Annulla</button></div>`);
  $('#c-ok').onclick = async () => {
    const name = $('#c-name').value.trim();
    if (!name) return toast('Scrivi un nome');
    const id = name.toLowerCase().normalize('NFD').replace(/[^\w]+/g, '-').replace(/^-|-$/g, '') || 'cat' + Date.now();
    await saveSources((cfg) => {
      cfg.categories.push({ id, name, icon: $('#c-icon').value.trim() || '⭐', sources: [{ name: 'Google News · ' + name, type: 'news', query: name }] });
    }, `Nuova categoria "${name}"`);
  };
}

async function saveSources(mutate, message, added = null) {
  try {
    let cfg;
    try { cfg = await fetchConfig(); } catch { cfg = JSON.parse(JSON.stringify(state.sources)); }
    mutate(cfg);
    await api('save', { config: cfg, note: message });
    state.sources = cfg;
    syncData(cfg);
    closeSheet();
    if (added) {
      state.filter[added.catId] = 'src:' + added.src.name;
      state.tab = added.catId; store.set('tab', added.catId);
      const d = state.data?.categories.find((k) => k.id === added.catId);
      const s = d?.sources.find((k) => k.name === added.src.name);
      if (s && added.avatar) s.avatar = added.avatar;
      keepSide(render);
      toast('Aggiunto ✅ Carico i contenuti…');
      try {
        const { items } = await api('preview', { source: added.src });
        if (d) {
          d.items = [...items, ...d.items].sort((a, b) => (b.date || '').localeCompare(a.date || ''));
          if (s) s.count = items.length;
          store.set('cache', state.data);
        }
      } catch { toast('Aggiunto. I contenuti arriveranno al prossimo aggiornamento', 4500); }
    } else {
      toast('Salvato ✅');
    }
    keepSide(render);
  } catch (e) {
    toast('Errore: ' + e.message, 6000);
  }
}

function catIndex(id) { return state.sources ? state.sources.categories.findIndex((c) => c.id === id) : -1; }
function keepSide(fn) { const y = $('.side')?.scrollTop || 0; fn(); if ($('.side')) $('.side').scrollTop = y; }

// Mostra subito le modifiche alle fonti, senza aspettare il prossimo aggiornamento
function syncData(cfg) {
  if (!state.data) return;
  for (const c of cfg.categories) {
    let d = state.data.categories.find((x) => x.id === c.id);
    if (!d) { d = { id: c.id, name: c.name, icon: c.icon, items: [], sources: [] }; state.data.categories.push(d); }
    d.name = c.name; d.icon = c.icon || d.icon;
    const names = new Set(c.sources.map((x) => x.name));
    d.items = d.items.filter((i) => names.has(i.via));
    d.sources = c.sources.map((x) => (d.sources || []).find((y) => y.name === x.name) || { name: x.name, type: x.type, avatar: '', count: 0 });
  }
  state.data.categories = state.data.categories.filter((d) => cfg.categories.some((c) => c.id === d.id));
  store.set('cache', state.data);
}

// ---------- eventi ----------
document.addEventListener('click', async (e) => {
  const t = e.target.closest('button, .sheet');
  if (!t) return;
  const ds = t.dataset;
  if (t.id === 'sheet' && e.target === t) return closeSheet();
  if (ds.close) return closeSheet();
  if (ds.tab) { state.tab = ds.tab; store.set('tab', ds.tab); render(); window.scrollTo(0, 0); return; }
  if (ds.addsrc) {
    const ci = catIndex(ds.addsrc);
    if (ci < 0) return toast('Categoria non trovata');
    return addSourceForm(ci);
  }
  if (ds.rmmode) { state.removing = state.removing === ds.rmmode ? null : ds.rmmode; state.editing = null; keepSide(render); return; }
  if (ds.edmode) { state.editing = state.editing === ds.edmode ? null : ds.edmode; state.removing = null; keepSide(render); return; }
  if (ds.filter && state.editing === ds.cat && ds.filter.startsWith('src:')) {
    const ci = catIndex(ds.cat);
    const si = ci < 0 ? -1 : state.sources.categories[ci].sources.findIndex((x) => x.name === ds.filter.slice(4));
    if (si < 0) return toast('Fonte non trovata');
    return renameForm(ci, si);
  }
  if (ds.ren) { const [ci, si] = ds.ren.split(':').map(Number); return renameForm(ci, si); }
  if (ds.rencat) return renameForm(+ds.rencat, -1);
  if (ds.filter && state.removing === ds.cat && ds.filter.startsWith('src:')) {
    const name = ds.filter.slice(4), ci = catIndex(ds.cat);
    const si = ci < 0 ? -1 : state.sources.categories[ci].sources.findIndex((x) => x.name === name);
    if (si < 0) return toast('Fonte non trovata');
    if (confirm(`Togliere "${name}" da questa sezione?`)) {
      await saveSources((cfg) => {
        const c = cfg.categories.find((x) => x.id === ds.cat);
        c.sources = c.sources.filter((x) => x.name !== name);
      }, `Rimossa fonte "${name}"`);
    }
    return;
  }
  if (ds.filter) {
    state.filter[ds.cat] = ds.filter;
    const sideScroll = $('.side')?.scrollTop || 0;
    render();
    if ($('.side')) $('.side').scrollTop = sideScroll;
    const top = $('#feed-top');
    if (top && top.getBoundingClientRect().top < 0) window.scrollTo({ top: window.scrollY + top.getBoundingClientRect().top - 64 });
    return;
  }
  if (ds.more) { state.shown[ds.more] = (state.shown[ds.more] || 20) + 20; render(); return; }
  if (ds.std) { state.shown._std = !state.shown._std; render(); return; }
  if (ds.add) return addSourceForm(+ds.add);
  if (ds.newcat) return newCategoryForm();
  if (ds.del) {
    const [ci, si] = ds.del.split(':').map(Number);
    const s = state.sources.categories[ci].sources[si];
    if (confirm(`Rimuovere "${s.name}"?`)) await saveSources((cfg) => { cfg.categories[ci].sources.splice(si, 1); }, `Rimossa fonte "${s.name}"`);
    return;
  }
  if (ds.delcat) {
    const c = state.sources.categories[+ds.delcat];
    if (confirm(`Eliminare la categoria "${c.name}" e tutte le sue fonti?`)) await saveSources((cfg) => { cfg.categories.splice(+ds.delcat, 1); }, `Eliminata categoria "${c.name}"`);
  }
});
$('#refresh').onclick = () => load(true);
document.addEventListener('input', (e) => { if (e.target.id === 'set-name') { store.set('name', e.target.value.trim()); greeting(); } });
document.addEventListener('visibilitychange', () => { if (document.hidden) markVisit(); });
window.addEventListener('pagehide', markVisit);
document.addEventListener('visibilitychange', () => { if (!document.hidden && Date.now() - state.lastLoad > 5 * 60e3) load(); });

if ('serviceWorker' in navigator) {
  // Quando arriva una nuova versione dell'app, ricarica la pagina da sola
  const hadController = !!navigator.serviceWorker.controller;
  let reloaded = false;
  navigator.serviceWorker.addEventListener('controllerchange', () => { if (hadController && !reloaded) { reloaded = true; location.reload(); } });
  navigator.serviceWorker.register('sw.js', { updateViaCache: 'none' }).then((reg) => {
    document.addEventListener('visibilitychange', () => { if (!document.hidden) reg.update().catch(() => {}); });
  }).catch(() => {});
}
state.data = store.get('cache');
if (state.data) render();
load();
