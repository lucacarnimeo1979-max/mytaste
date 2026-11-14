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
const WORKFLOW = 'update.yml';

const state = { data: null, sources: null, tab: store.get('tab', null), filter: {}, shown: {}, lastLoad: 0 };

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
      fetch('sources.json?t=' + Date.now(), { cache: 'no-store' }).then((r) => (r.ok ? r.json() : null)).catch(() => null),
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
  $('#updated').textContent = d ? 'Aggiornato ' + ago(d.updated) : '';
  const cats = d?.categories || [];
  const tabs = [...cats.map((c) => ({ id: c.id, name: c.name, icon: c.icon })), { id: '_src', name: 'Fonti', icon: '⚙️' }];
  if (!tabs.some((t) => t.id === state.tab)) state.tab = tabs[0].id;
  $('#tabs').innerHTML = tabs
    .map((t) => `<button class="tab ${t.id === state.tab ? 'active' : ''}" data-tab="${esc(t.id)}"><span class="ic">${esc(t.icon)}</span>${esc(shortName(t.name))}</button>`)
    .join('');
  const v = $('#view');
  if (state.tab === '_src') return renderSources(v);
  if (!d) { v.innerHTML = '<div class="empty">Nessun dato ancora. Il primo aggiornamento automatico arriva entro pochi minuti dall\'attivazione.</div>'; return; }
  const cat = cats.find((c) => c.id === state.tab);
  v.innerHTML = (cat.football ? footballHTML(cat.football) : '') + channelsHTML(cat) + newsHTML(cat);
}
const shortName = (n) => (n.length > 12 ? n.split(' ')[0] : n);

function itemHTML(i) {
  const img = i.image ? `<img class="thumb" loading="lazy" src="${esc(i.image)}" alt="" onerror="this.remove()">` : '';
  return `<a class="card item ${i.kind}" href="${esc(i.link)}" target="_blank" rel="noopener">${img}
    <div class="body"><div class="title">${esc(i.title)}</div>
    <div class="meta">${i.kind === 'video' ? '<span class="badge">Video</span>' : ''}<span>${esc(i.source)}</span><span>·</span><span>${esc(ago(i.date))}</span></div></div></a>`;
}

// Ultimo video di ciascun canale preferito
function channelsHTML(cat) {
  const seen = new Set();
  const latest = cat.items.filter((i) => i.kind === 'video' && !seen.has(i.via) && seen.add(i.via));
  if (!latest.length) return '';
  return `<h2>Dai tuoi canali</h2><div class="hscroll">${latest
    .map((i) => `<a class="card" href="${esc(i.link)}" target="_blank" rel="noopener">
      <div class="hl" style="margin:0"><img loading="lazy" src="${esc(i.image)}" alt=""><div class="play"><span>▶</span></div>
      <div class="cap">${esc(i.title)}</div></div>
      <div class="notice" style="padding:8px 10px"><b>${esc(i.via)}</b> · ${esc(ago(i.date))}</div></a>`)
    .join('')}</div>`;
}

function newsHTML(cat) {
  const f = state.filter[cat.id] || 'all';
  const sources = [...new Set(cat.items.map((i) => i.via))];
  const hasVideo = cat.items.some((i) => i.kind === 'video');
  const chips = [['all', 'Tutto'], ...(hasVideo ? [['video', '▶ Video'], ['article', 'Notizie']] : []), ...sources.map((s) => ['src:' + s, s])];
  let items = cat.items;
  if (f === 'video' || f === 'article') items = items.filter((i) => i.kind === f);
  else if (f.startsWith('src:')) items = items.filter((i) => i.via === f.slice(4));
  const n = state.shown[cat.id + f] || 20;
  return `<h2>${cat.football ? 'Notizie e video' : esc(cat.name)}</h2>
    <div class="chips">${chips.map(([k, l]) => `<button class="chip ${k === f ? 'active' : ''}" data-filter="${esc(k)}" data-cat="${esc(cat.id)}">${esc(l)}</button>`).join('')}</div>
    <div class="list">${items.slice(0, n).map(itemHTML).join('') || '<div class="empty">Niente da mostrare</div>'}</div>
    ${items.length > n ? `<button class="more" data-more="${esc(cat.id + f)}">Mostra altri</button>` : ''}`;
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
  const next = f.fixtures[0];
  if (next) {
    h += `<h2>Prossima partita</h2><div class="card match">
      <div class="comp"><span>${esc(next.competition)}</span><span>${esc(next.venue)}</span></div>
      <div class="teams">
        <div class="team"><img src="${esc(next.home.logo)}" alt="">${esc(next.home.name)}</div>
        <div class="score vs">${next.status === 'in' ? `${esc(next.home.score)} – ${esc(next.away.score)}` : 'vs'}</div>
        <div class="team"><img src="${esc(next.away.logo)}" alt="">${esc(next.away.name)}</div>
      </div>
      <div class="countdown">${esc(fmtMatch(next.date))} · ${esc(countdown(next.date))}</div></div>`;
  }
  const hls = f.results.filter((r) => r.highlight);
  if (hls.length) {
    h += `<h2>Sintesi delle partite</h2><div class="hscroll">${hls
      .map((r) => `<a class="card" href="${esc(r.highlight.url)}" target="_blank" rel="noopener">
        <div class="hl" style="margin:0"><img loading="lazy" src="${esc(r.highlight.image)}" alt=""><div class="play"><span>▶</span></div>
        <div class="cap">${esc(r.home.name)} ${esc(r.home.score)}–${esc(r.away.score)} ${esc(r.away.name)}${r.highlight.length ? ' · ' + esc(r.highlight.length) : ''}</div></div>
        <div class="notice" style="padding:8px 10px">${esc(r.highlight.channel)} · ${esc(r.competition)} · ${esc(fmtShort(r.date))}</div></a>`)
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
  const token = store.get('token');
  const r = repoInfo();
  const errs = state.data?.errors || [];
  v.innerHTML = `
    <h2>Le mie fonti</h2>
    ${!token ? `<div class="card notice warn" style="margin-bottom:12px">Per aggiungere o togliere fonti dal telefono collega GitHub una volta sola: <b>Impostazioni → Collega GitHub</b> qui sotto.</div>` : ''}
    ${s ? s.categories.map((c, ci) => `
      <div class="card src-cat"><header><span>${esc(c.icon || '⭐')}</span><span class="grow">${esc(c.name)}</span>
        <button class="btn sm" data-add="${ci}">+ Fonte</button>
        ${c.football ? '' : `<button class="x" title="Elimina categoria" data-delcat="${ci}">🗑</button>`}</header>
        ${(c.sources || []).map((x, si) => `<div class="src"><div class="grow">${esc(x.name)}<small>${esc(TYPE_LABEL[x.type] || x.type)} · ${esc(srcDetail(x))}</small></div>
          <button class="x" title="Rimuovi" data-del="${ci}:${si}">✕</button></div>`).join('')}
      </div>`).join('') : '<div class="empty">Elenco fonti non disponibile</div>'}
    <div class="row"><button class="btn ghost" data-newcat="1">+ Nuova categoria (es. Tecnologia, Viaggi…)</button></div>

    <h2>Aggiornamenti</h2>
    <div class="card notice">I contenuti si scaricano <b>da soli ogni ora</b> sui server di GitHub, anche a telefono e PC spenti.
      Ultimo aggiornamento: <b>${state.data ? esc(new Date(state.data.updated).toLocaleString('it-IT')) : '—'}</b>.
      ${errs.length ? `<br><br>Fonti con problemi all'ultimo giro:<br>${errs.map(esc).join('<br>')}` : ''}</div>
    <div class="row" style="margin-top:10px"><button class="btn" data-dispatch="1" ${token ? '' : 'disabled'}>Aggiorna adesso</button>
      <a class="btn ghost" href="https://github.com/${esc(r.owner)}/${esc(r.name)}/actions" target="_blank" rel="noopener">Vedi su GitHub</a></div>

    <h2>Impostazioni</h2>
    <div class="card notice">
      ${token ? `GitHub collegato ✅ (repository <b>${esc(r.owner)}/${esc(r.name)}</b>)` : 'GitHub non collegato.'}
      <div class="row" style="margin-top:10px"><button class="btn ${token ? 'ghost' : ''}" data-token="1">${token ? 'Cambia token' : 'Collega GitHub'}</button>
      ${token ? '<button class="btn ghost" data-logout="1">Scollega</button>' : ''}</div>
    </div>`;
}

function openSheet(html) { $('#sheet-card').innerHTML = html; $('#sheet').classList.remove('hidden'); }
function closeSheet() { $('#sheet').classList.add('hidden'); }

function addSourceForm(ci) {
  const c = state.sources.categories[ci];
  openSheet(`<h3>Aggiungi a ${esc(c.name)}</h3>
    <label>Tipo di fonte</label>
    <select id="f-type"><option value="youtube">Canale YouTube</option><option value="rss">Sito web / feed RSS</option><option value="news">Ricerca notizie (Google News)</option></select>
    <label id="f-vl">Nome del canale, @handle o link</label><input id="f-val" placeholder="es. @nomecanale oppure https://youtube.com/@..." autocapitalize="off">
    <label>Nome da mostrare (facoltativo)</label><input id="f-name" placeholder="es. Mario Rossi">
    <div class="row" style="margin-top:16px"><button class="btn" id="f-ok">Salva</button><button class="btn ghost" data-close="1">Annulla</button></div>`);
  const ph = { youtube: ['Nome del canale, @handle o link', 'es. @nomecanale oppure https://youtube.com/@...'], rss: ['Indirizzo del sito o del feed RSS', 'https://...'], news: ['Parole chiave', 'es. Rafael Leão'] };
  $('#f-type').onchange = (e) => { const [l, p] = ph[e.target.value]; $('#f-vl').textContent = l; $('#f-val').placeholder = p; };
  $('#f-ok').onclick = async () => {
    const type = $('#f-type').value;
    const val = $('#f-val').value.trim();
    if (!val) return toast('Scrivi la fonte');
    const src = { name: $('#f-name').value.trim() || val.replace(/^https?:\/\/(www\.)?/, '').replace(/^@/, ''), type };
    if (type === 'youtube') src.handle = /^https?:|^@|^UC[\w-]{20,}$/.test(val) ? val : '@' + val.replace(/\s+/g, '');
    else if (type === 'news') src.query = val;
    else src.url = /^https?:/.test(val) ? val : 'https://' + val;
    await saveSources((cfg) => { cfg.categories[ci].sources.push(src); }, `Aggiunta fonte "${src.name}"`);
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

function tokenForm() {
  const r = repoInfo();
  const url = `https://github.com/settings/personal-access-tokens/new`;
  openSheet(`<h3>Collega GitHub</h3>
    <div class="notice" style="padding:6px 0">Serve un “token” personale, si crea una volta sola dal telefono:<br>
    1. Apri <a style="color:var(--accent)" href="${url}" target="_blank" rel="noopener"><b>questa pagina di GitHub</b></a><br>
    2. Nome: <b>MyTaste</b> · Scadenza: quella che preferisci<br>
    3. <b>Repository access</b> → <i>Only select repositories</i> → <b>${esc(r.name)}</b><br>
    4. <b>Permissions</b> → <b>Contents</b>: Read and write · <b>Actions</b>: Read and write<br>
    5. <b>Generate token</b>, copialo e incollalo qui sotto.<br>
    Il token resta salvato solo su questo telefono.</div>
    <label>Token</label><input id="t-val" placeholder="github_pat_..." autocapitalize="off" autocomplete="off">
    <label>Repository</label><input id="t-repo" value="${esc(r.owner + '/' + r.name)}" autocapitalize="off">
    <div class="row" style="margin-top:16px"><button class="btn" id="t-ok">Salva</button><button class="btn ghost" data-close="1">Annulla</button></div>`);
  $('#t-ok').onclick = async () => {
    const t = $('#t-val').value.trim();
    const [owner, name] = $('#t-repo').value.trim().split('/');
    if (!t || !owner || !name) return toast('Compila token e repository');
    try {
      const res = await gh(`/repos/${owner}/${name}`, {}, t);
      store.set('token', t);
      store.set('repo', { owner, name, branch: res.default_branch });
      closeSheet();
      toast('GitHub collegato ✅');
      render();
    } catch (e) { toast('Token non valido: ' + e.message, 5000); }
  };
}

async function gh(path, opts = {}, token = store.get('token')) {
  const res = await fetch('https://api.github.com' + path, {
    ...opts,
    headers: { Accept: 'application/vnd.github+json', Authorization: 'Bearer ' + token, 'X-GitHub-Api-Version': '2022-11-28', ...(opts.headers || {}) },
  });
  if (!res.ok) throw new Error((await res.json().catch(() => ({}))).message || 'HTTP ' + res.status);
  return res.status === 204 ? null : res.json();
}
const b64 = (str) => btoa(String.fromCharCode(...new TextEncoder().encode(str)));
const unb64 = (b) => new TextDecoder().decode(Uint8Array.from(atob(b.replace(/\n/g, '')), (c) => c.charCodeAt(0)));

async function branch() {
  const r = repoInfo();
  if (r.branch) return r.branch;
  const info = await gh(`/repos/${r.owner}/${r.name}`);
  store.set('repo', { ...r, branch: info.default_branch });
  return info.default_branch;
}

async function saveSources(mutate, message) {
  if (!store.get('token')) { closeSheet(); return tokenForm(); }
  const r = repoInfo();
  try {
    const br = await branch();
    const file = await gh(`/repos/${r.owner}/${r.name}/contents/sources.json?ref=${encodeURIComponent(br)}`);
    const cfg = JSON.parse(unb64(file.content));
    mutate(cfg);
    await gh(`/repos/${r.owner}/${r.name}/contents/sources.json`, {
      method: 'PUT',
      body: JSON.stringify({ message: message + ' (da MyTaste)', content: b64(JSON.stringify(cfg, null, 2) + '\n'), sha: file.sha, branch: br }),
    });
    state.sources = cfg;
    closeSheet();
    render();
    toast('Salvato ✅ I nuovi contenuti arrivano tra 2-3 minuti', 5000);
  } catch (e) {
    toast('Errore: ' + e.message, 6000);
  }
}

async function dispatch() {
  const r = repoInfo();
  try {
    await gh(`/repos/${r.owner}/${r.name}/actions/workflows/${WORKFLOW}/dispatches`, { method: 'POST', body: JSON.stringify({ ref: await branch() }) });
    toast('Aggiornamento avviato: pronto tra 2-3 minuti', 5000);
  } catch (e) { toast('Errore: ' + e.message, 6000); }
}

// ---------- eventi ----------
document.addEventListener('click', async (e) => {
  const t = e.target.closest('button, .sheet');
  if (!t) return;
  const ds = t.dataset;
  if (t.id === 'sheet' && e.target === t) return closeSheet();
  if (ds.close) return closeSheet();
  if (ds.tab) { state.tab = ds.tab; store.set('tab', ds.tab); render(); window.scrollTo(0, 0); return; }
  if (ds.filter) { state.filter[ds.cat] = ds.filter; render(); return; }
  if (ds.more) { state.shown[ds.more] = (state.shown[ds.more] || 20) + 20; render(); return; }
  if (ds.std) { state.shown._std = !state.shown._std; render(); return; }
  if (ds.add) return addSourceForm(+ds.add);
  if (ds.newcat) return newCategoryForm();
  if (ds.token) return tokenForm();
  if (ds.logout) { store.del('token'); store.del('repo'); render(); return; }
  if (ds.dispatch) return dispatch();
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
document.addEventListener('visibilitychange', () => { if (!document.hidden && Date.now() - state.lastLoad > 5 * 60e3) load(); });

if ('serviceWorker' in navigator) navigator.serviceWorker.register('sw.js').catch(() => {});
state.data = store.get('cache');
if (state.data) render();
load();
