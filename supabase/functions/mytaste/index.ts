// MyTaste – funzione Supabase: cerca canali, mostra subito gli ultimi contenuti e salva le fonti.
// Le fonti stanno nella tabella mytaste_config (una riga con tutto il JSON), leggibile da tutti e
// scrivibile solo da qui. Ogni salvataggio tiene una copia in mytaste_config_history.
import { createClient } from "jsr:@supabase/supabase-js@2";

const cors = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
  "Access-Control-Allow-Methods": "GET, POST, OPTIONS",
};
const json = (data: unknown, status = 200) =>
  new Response(JSON.stringify(data), { status, headers: { ...cors, "Content-Type": "application/json" } });

const db = createClient(Deno.env.get("SUPABASE_URL")!, Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!);
const YT_HEADERS = { "User-Agent": "Mozilla/5.0", "Accept-Language": "it-IT,it;q=0.9", Cookie: "SOCS=CAI; CONSENT=YES+1" };

async function get(url: string, headers: Record<string, string> = {}) {
  const ctrl = new AbortController();
  const t = setTimeout(() => ctrl.abort(), 12000);
  try {
    const r = await fetch(url, { headers: { "User-Agent": "Mozilla/5.0 (Linux; Android 14) Chrome/124 Mobile", ...headers }, signal: ctrl.signal, redirect: "follow" });
    if (!r.ok) throw new Error(`HTTP ${r.status}`);
    return { text: await r.text(), url: r.url, type: r.headers.get("content-type") || "" };
  } finally {
    clearTimeout(t);
  }
}

// ---------- ricerca canali YouTube ----------
function walk(o: unknown, key: string, out: any[]) {
  if (Array.isArray(o)) o.forEach((x) => walk(x, key, out));
  else if (o && typeof o === "object") {
    if ((o as any)[key]) out.push((o as any)[key]);
    Object.values(o).forEach((x) => walk(x, key, out));
  }
}
async function searchYouTube(q: string) {
  const { text } = await get(`https://www.youtube.com/results?search_query=${encodeURIComponent(q)}&sp=EgIQAg%253D%253D`, YT_HEADERS);
  const m = text.match(/var ytInitialData = (\{.*?\});<\/script>/s);
  if (!m) throw new Error("ricerca non disponibile");
  const found: any[] = [];
  walk(JSON.parse(m[1]), "channelRenderer", found);
  return found.slice(0, 8).map((c) => {
    const thumbs = c.thumbnail?.thumbnails || [];
    let avatar = thumbs[thumbs.length - 1]?.url || "";
    if (avatar.startsWith("//")) avatar = "https:" + avatar;
    return {
      type: "youtube",
      name: c.title?.simpleText || "",
      channelId: c.channelId,
      handle: (c.subscriberCountText?.simpleText || "").startsWith("@") ? c.subscriberCountText.simpleText : "",
      subs: (c.videoCountText?.simpleText || c.subscriberCountText?.simpleText || "").replace(/^@\S+$/, ""),
      avatar,
    };
  });
}
async function channelFromUrl(input: string) {
  let u = input.trim();
  const id = u.match(/(UC[\w-]{22})/)?.[1];
  if (!id) {
    if (!u.startsWith("http")) u = "https://www.youtube.com/" + (u.startsWith("@") ? u : "@" + u);
    const { text } = await get(u, YT_HEADERS);
    const cid = text.match(/"externalId":"(UC[\w-]+)"/)?.[1] || text.match(/channel_id=(UC[\w-]+)/)?.[1];
    if (!cid) throw new Error("Canale YouTube non trovato");
    const name = text.match(/<meta property="og:title" content="([^"]+)"/)?.[1] || "";
    const avatar = text.match(/<meta property="og:image" content="([^"]+)"/)?.[1] || "";
    const handle = u.match(/@[\w.-]+/)?.[0] || "";
    return { type: "youtube", name: decode(name), channelId: cid, handle, avatar: avatar.replace(/=s\d+-/, "=s96-"), subs: "" };
  }
  return { type: "youtube", name: "", channelId: id, handle: "", avatar: "", subs: "" };
}

// ---------- siti e feed RSS ----------
const decode = (s = "") =>
  s.replace(/<!\[CDATA\[([\s\S]*?)\]\]>/g, "$1").replace(/&lt;/g, "<").replace(/&gt;/g, ">").replace(/&quot;/g, '"')
    .replace(/&#39;|&apos;/g, "'").replace(/&#(\d+);/g, (_, n) => String.fromCodePoint(+n)).replace(/&amp;/g, "&");
const strip = (s = "") => decode(s).replace(/<[^>]*>/g, " ").replace(/\s+/g, " ").trim();
const tag = (x: string, n: string) => x.match(new RegExp(`<${n}(?:\\s[^>]*)?>([\\s\\S]*?)</${n}>`, "i"))?.[1] || "";
const attr = (x: string, n: string, a: string) => decode(x.match(new RegExp(`<${n}\\b[^>]*\\b${a}="([^"]*)"`, "i"))?.[1] || "");

function parseFeed(xml: string) {
  const blocks = xml.match(/<item\b[\s\S]*?<\/item>/gi) || xml.match(/<entry\b[\s\S]*?<\/entry>/gi) || [];
  return blocks.map((b) => {
    let link = strip(tag(b, "link"));
    if (!link) {
      const links = b.match(/<link\b[^>]*>/gi) || [];
      const alt = links.find((l) => /rel="alternate"/i.test(l)) || links.find((l) => !/rel=/i.test(l)) || links[0] || "";
      link = alt.match(/href="([^"]*)"/i)?.[1] || "";
    }
    const date = strip(tag(b, "pubDate") || tag(b, "published") || tag(b, "updated") || tag(b, "dc:date"));
    const image = attr(b, "media:thumbnail", "url") || attr(b, "media:content", "url") ||
      b.match(/<enclosure\b[^>]*url="([^"]*\.(?:jpe?g|png|webp)[^"]*)"/i)?.[1] ||
      decode(tag(b, "description") || tag(b, "content:encoded")).match(/<img[^>]+src="([^"]+)"/i)?.[1] || "";
    return { title: strip(tag(b, "title")), link: decode(link), date: date && !isNaN(Date.parse(date)) ? new Date(date).toISOString() : null, image: decode(image) };
  }).filter((i) => i.title && i.link);
}
async function siteToFeed(input: string) {
  let u = input.trim();
  if (!/^https?:/.test(u)) u = "https://" + u;
  const r = await get(u);
  if (/xml|rss|atom/.test(r.type) || /^\s*<\?xml|<rss|<feed/.test(r.text.slice(0, 500))) {
    return { type: "rss", url: r.url, name: strip(tag(r.text, "title")) || new URL(r.url).hostname };
  }
  const links = r.text.match(/<link\b[^>]*type="application\/(?:rss|atom)\+xml"[^>]*>/gi) || [];
  let href = links[0]?.match(/href="([^"]+)"/i)?.[1];
  if (!href) {
    for (const p of ["/feed", "/rss", "/feed/", "/rss.xml", "/index.xml"]) {
      try {
        const t = await get(new URL(p, r.url).href);
        if (/<rss|<feed/.test(t.text.slice(0, 800))) { href = t.url; break; }
      } catch { /* prova il prossimo */ }
    }
  }
  if (!href) throw new Error("Questo sito non ha un feed RSS: prova con la ricerca notizie");
  const feed = new URL(decode(href), r.url).href;
  const title = strip(tag(r.text, "title")).split(/[|\-–·]/)[0].trim();
  return { type: "rss", url: feed, name: title || new URL(r.url).hostname };
}

// ---------- anteprima: ultimi contenuti di una fonte ----------
async function preview(src: any) {
  let url = src.url, kind = "article";
  if (src.type === "youtube") {
    const id = src.channelId || (await channelFromUrl(src.handle || src.url)).channelId;
    url = `https://www.youtube.com/feeds/videos.xml?channel_id=${id}`;
    kind = "video";
  } else if (src.type === "news") {
    url = `https://news.google.com/rss/search?q=${encodeURIComponent(src.query)}&hl=it&gl=IT&ceid=IT:it`;
  }
  const items = parseFeed((await get(url)).text).slice(0, 15);
  return items.map((i) => {
    let title = i.title, source = src.name;
    if (src.type === "news") { const k = title.lastIndexOf(" - "); if (k > 0) { source = title.slice(k + 3); title = title.slice(0, k); } }
    if (kind === "video" && !i.image) { const v = i.link.match(/[?&]v=([\w-]+)/)?.[1]; if (v) i.image = `https://i.ytimg.com/vi/${v}/hqdefault.jpg`; }
    return { ...i, title, source, kind, via: src.name, summary: "" };
  });
}

// ---------- salvataggio ----------
function validConfig(c: any) {
  if (!c || !Array.isArray(c.categories) || c.categories.length > 30) return false;
  for (const cat of c.categories) {
    if (typeof cat.id !== "string" || typeof cat.name !== "string" || !Array.isArray(cat.sources) || cat.sources.length > 60) return false;
    for (const s of cat.sources) if (typeof s.name !== "string" || !["youtube", "rss", "news"].includes(s.type)) return false;
  }
  return JSON.stringify(c).length < 200_000;
}

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: cors });
  try {
    const body = req.method === "POST" ? await req.json() : Object.fromEntries(new URL(req.url).searchParams);
    switch (body.action) {
      case "config": {
        const { data, error } = await db.from("mytaste_config").select("config, updated_at").eq("id", 1).single();
        if (error) throw error;
        return json(data);
      }
      case "find": {
        const q = String(body.q || "").trim().slice(0, 200);
        if (!q) return json({ results: [] });
        if (/youtu\.?be|^@|^UC[\w-]{22}$/.test(q)) return json({ results: [await channelFromUrl(q)] });
        if (/^https?:\/\/|^[\w-]+(\.[\w-]+)+(\/|$)/.test(q)) return json({ results: [await siteToFeed(q)] });
        let results: any[] = [];
        let warning = "";
        try { results = await searchYouTube(q); } catch (e) { warning = String((e as Error).message); }
        return json({ results, warning });
      }
      case "preview":
        return json({ items: await preview(body.source) });
      case "save": {
        if (!validConfig(body.config)) return json({ error: "Configurazione non valida" }, 400);
        const { data: old } = await db.from("mytaste_config").select("config").eq("id", 1).single();
        if (old) await db.from("mytaste_config_history").insert({ config: old.config, note: String(body.note || "").slice(0, 200) });
        const { error } = await db.from("mytaste_config").upsert({ id: 1, config: body.config, updated_at: new Date().toISOString() });
        if (error) throw error;
        return json({ ok: true });
      }
      default:
        return json({ error: "Azione sconosciuta" }, 400);
    }
  } catch (e) {
    return json({ error: (e as Error).message || "Errore" }, 500);
  }
});
