# MyTaste – i miei interessi sul telefono

Web-app da installare sul telefono (icona nella schermata Home) con:

- **⚽ AC Milan**: prossima partita con conto alla rovescia, **sintesi video** delle ultime partite, risultati, calendario, classifica di Serie A, notizie e video da Pellegatti, Vitiello, Fabrizio Romano, Francesco Letizia, Di Marzio, MilanNews e canale ufficiale.
- **🤖 Intelligenza Artificiale**: video di Antonio Guadagno, Bernardo Mascellani, Riccardo Belli Contarini, Andrea Ciraolo, Michele Cotti e notizie IA.
- **➕ Aggiungi una fonte con un tocco**: scrivi il nome di un canale (es. "Mandrake"), scegli quello giusto dalla lista con foto e iscritti, e i suoi video compaiono subito. Funziona anche con link YouTube, indirizzi di siti (trova da solo il feed RSS) e ricerche di notizie. Si possono anche rinominare o togliere fonti e creare nuove sezioni.

Tutto si aggiorna **da solo ogni ora** su GitHub Actions: non serve il PC acceso.

## Attivazione (una volta sola, anche da telefono)

1. Su GitHub apri il repository → **Settings → Pages** → in *Build and deployment / Source* scegli **GitHub Actions**.
2. Vai su **Actions** → *Aggiorna MyTaste* → **Run workflow** (oppure aspetta il prossimo giro orario).
3. Apri `https://<tuo-utente>.github.io/mytaste/` dal telefono:
   - **iPhone** (Safari): Condividi → *Aggiungi alla schermata Home*
   - **Android** (Chrome): menu ⋮ → *Installa app* / *Aggiungi a schermata Home*

## Come funziona

| File | Cosa fa |
|---|---|
| Supabase `mytaste_config` | Elenco delle sezioni e delle fonti, modificato dall'app (ogni versione precedente resta in `mytaste_config_history`) |
| `supabase/functions/mytaste` | Funzione che cerca i canali, mostra subito i loro contenuti e salva le fonti |
| `sources.json` | Copia di riserva delle fonti, usata se Supabase non risponde |
| `scripts/fetch.mjs` | Scarica feed RSS, YouTube, Google News, risultati/classifica (ESPN) e cerca le sintesi su YouTube |
| `.github/workflows/update.yml` | Esegue lo script ogni ora e pubblica il sito su GitHub Pages |
| `site/` | L'app (HTML/CSS/JS, installabile, funziona anche offline con gli ultimi dati) |

Tipi di fonte in `sources.json`: `youtube` (`handle`: `@canale`), `rss` (`url`), `news` (`query`: parole chiave). Il campo facoltativo `filter` tiene solo gli articoli che contengono quelle parole.

Nota: GitHub sospende i workflow programmati dopo 60 giorni senza modifiche al repository; in quel caso arriva una email e basta premere *Enable workflow* nella scheda Actions (anche aggiungere una fonte dall'app conta come modifica).
