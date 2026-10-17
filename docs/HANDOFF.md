# CyberFrog — handoff

Documento per riprendere il lavoro in una nuova chat. Incollalo (o chiedi di leggere `docs/HANDOFF.md`) all'inizio.

Ultimo aggiornamento: 2026-10-17.

## Cos'è

CyberFrog è un crawler SEO desktop: una ricostruzione **clean-room** di Screaming Frog SEO Spider. È di Daniele Zecca (Cyberzec).

- **Regola clean-room:** mai decompilare né leggere codice o risorse interne di Screaming Frog (la EULA lo vieta). Si usano solo documentazione pubblica, comportamento osservabile e nomi delle librerie open source. Mappa delle funzionalità: [clean-room-map.md](clean-room-map.md).
- **Sito di test:** https://cyberzec.it (sito dell'autore, circa 130 URL).

## Stack

| Parte | Tecnologia |
|---|---|
| App desktop | Tauri 2 (macOS arm64; bundle id `com.cyberzec.cyberfrog`) |
| Crawler | Rust: tokio, reqwest (rustls), scraper, texting_robots, regex, serde_json |
| Storage | SQLite (rusqlite bundled), un file `.sqlite` per crawl in `~/Library/Application Support/com.cyberzec.cyberfrog/crawls/` |
| UI | React 19 + TypeScript + Vite, TanStack Table **v9** (API nuova: `useTable`, `tableFeatures`, `table.FlexRender`) + TanStack Virtual |
| Lingua UI | Italiano (inglese previsto) |

## Struttura

```
src-tauri/src/crawler.rs   crawl BFS, parsing HTML, schema SQLite, verifiche link esterni/immagini, sitemap, test
src-tauri/src/report.rs    letture in sola lettura: link esterni, link rotti, link di una pagina, immagini, hreflang, dati strutturati
src-tauri/src/lib.rs       comandi Tauri (start_crawl, open_crawl, page_links, image_pages, save_crawl_as, list_crawls, write_text_file), Settings
src-tauri/examples/crawl.rs  crawl da terminale senza UI
src/App.tsx                shell, tab, riepilogo, apertura/salvataggio
src/DataTable.tsx          tabella generica: filtri, export CSV, ordinamento, virtualizzazione, selezione riga
src/DetailPanel.tsx        pannello Inlink/Outlink di un URL
src/ImagePanel.tsx         pagine che usano un'immagine
src/SettingsDialog.tsx     finestra Impostazioni
src/pages.ts               tipi (rispecchiano le struct Rust), filtri, controlli SEO, CSV, sitemap XML
src/settings.ts            impostazioni + salvataggio in localStorage
scripts/pages.check.ts     self-check della logica TS (node scripts/pages.check.ts)
docs/clean-room-map.md     funzionalità di riferimento
```

**Compatibilità:** i crawl salvati con versioni precedenti restano apribili. Per le colonne nuove `read_pages` usa `newer(...)` e `report.rs` usa `compiles(...)`. Ogni colonna nuova deve seguire questo schema.

## Funzionalità fatte (tutte con commit su `main`, solo in locale)

1. **MVP:** crawl dello stesso host, robots.txt, redirect, concorrenza, SQLite, tab Interni/Codici di risposta/Title/Meta description/H1 con filtri (mancante/duplicato/lungo/corto), export CSV (`;`, BOM, protezione dalle formule), Apri/Salva come/Crawl recenti, avanzamento live.
2. **Indicizzabilità:** noindex/nofollow (meta + X-Robots-Tag), canonical (auto, mancante, verso URL non 200).
3. **Link:** link esterni verificati (HEAD, poi GET se HEAD dà errore, perché Google risponde 404 a HEAD), link rotti con pagina di origine e anchor, pannello Inlink/Outlink.
4. **Immagini:** alt mancante/vuoto, width/height, peso (oltre 100 KB), pannello con le pagine che le usano.
5. **Sitemap XML:** lettura da robots.txt o `/sitemap.xml` (con indici), URL presenti solo in sitemap, orfane, generazione di `sitemap.xml`.
6. **Impostazioni:** limite URL, concorrenza, user agent (CyberFrog/Googlebot/Bingbot/personalizzato), robots on/off, verifiche on/off, esclusioni regex.
7. **Prestazioni:** tempo di risposta e peso pagina, tempo mediano.
8. **Hreflang:** codice non valido, senza return link, alternative non 200, senza auto-riferimento, senza x-default.
9. **Dati strutturati:** JSON-LD (anche `@graph`) e microdata; JSON non valido; proprietà richieste da Google mancanti per alcuni tipi.

## In corso al momento del handoff

10. **Contenuti duplicati.**
    - **Fatto (Rust):** `content_hash` (FNV-1a del testo principale) e `simhash` (SimHash a 64 bit su shingle di 3 parole). Il testo esclude nav e footer, e anche `word_count` ora li esclude. I test passano (13).
    - **Da fare:**
      - UI: tab "Duplicati" con filtri esatti, quasi duplicati (similarità ≥ 90%, cioè al massimo 6 bit diversi), contenuto scarso (< 200 parole); solo pagine HTML 200 indicizzabili.
      - Self-check in `scripts/pages.check.ts`.
      - Verifica su cyberzec.it e commit.

## Roadmap

**Prossime funzioni SEO (candidate):**
- header di sicurezza (HSTS, CSP, X-Frame-Options), contenuto misto
- rendering JavaScript (Chromium headless)
- integrazioni Google Search Console / PageSpeed Insights (richiedono credenziali: chiedere all'utente)
- confronto tra due crawl
- visualizzazione della struttura del sito

**Rifinitura e pubblicazione** (l'utente ha chiesto di farla dopo aver finito l'app):
1. Logo/icona dell'app: chiedere all'utente la direzione grafica, poi `npx tauri icon <png 1024>`.
2. Interfaccia IT/EN con selettore di lingua.
3. README in inglese, con screenshot e nota clean-room.
4. Licenza da scegliere con l'utente: **Apache-2.0** (attribuzione + NOTICE, permessi anche usi chiusi) oppure **GPL-3.0** (i derivati devono restare open source).
5. Pubblicazione sul GitHub dell'utente, **solo dopo il suo ok esplicito**.
6. Valutare il nome: "CyberFrog" somiglia a "Screaming Frog", quindi fare un controllo sul marchio o scegliere un nome diverso.

## Come lavorare (preferenze dell'utente)

- Lavorare **in autonomia**: sviluppare, testare da soli, fare commit locale, passare alla funzione successiva senza chiedere "procedo?". Fermarsi solo per decisioni vere (push, servizi a pagamento, credenziali, logo, licenza).
- Rispondere in **italiano**, in formato adatto all'ADHD: prima l'azione, passi numerati e brevi, stato sempre esplicito.
- Codice minimo e completo (stile "ponytail"): niente astrazioni non richieste. I `shortcut:` nei commenti segnano limiti noti.

## Comandi

```bash
# test Rust (crawler, report, settings)
cd src-tauri && cargo test && cargo clippy --all-targets

# self-check logica TypeScript + typecheck
node scripts/pages.check.ts && npx tsc --noEmit

# crawl reale da terminale (stesso codice dell'app)
cd src-tauri && cargo run --example crawl -- https://cyberzec.it /tmp/cz.sqlite

# app in sviluppo
npm run tauri dev

# app di test pilotabile (macOS)
npx tauri build --debug --bundles app
open src-tauri/target/debug/bundle/macos/CyberFrog.app
```

## Come testare la UI senza la finestra

- `computer-use` sull'app `com.cyberzec.cyberfrog` funziona solo con il bundle `.app`. Il binario di `tauri dev` non è pilotabile.
- I dialoghi file nativi non accettano clic in background: per testare l'apertura usare "Crawl recenti".
- Se la cattura dello schermo fallisce ("acquisizione audio/video non riuscita", tipicamente con lo schermo bloccato):
  1. Avvia Vite dal browser di anteprima (`.claude/launch.json`, configurazione `vite`).
  2. Simula `window.__TAURI_INTERNALS__.invoke` con dati JSON estratti da un `.sqlite` reale.
  3. Elimina il file mock da `public/` dopo l'uso.
- `form_input` sulle checkbox non scatena l'`onChange` di React: usare clic veri.
