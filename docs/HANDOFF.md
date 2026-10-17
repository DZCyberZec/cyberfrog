# CyberFrog — handoff

Documento per riprendere il lavoro in una nuova chat. Incollalo (o chiedi di leggere `docs/HANDOFF.md`) all'inizio.

Ultimo aggiornamento: 2026-10-17 (v0.4.0).

## Cos'è

CyberFrog è un crawler SEO desktop: una ricostruzione **clean-room** di Screaming Frog SEO Spider. È di Daniele Zecca (Cyberzec).

- **Regola clean-room:** mai decompilare né leggere codice o risorse interne di Screaming Frog (la EULA lo vieta). Si usano solo documentazione pubblica, comportamento osservabile e nomi delle librerie open source. Mappa delle funzionalità: [clean-room-map.md](clean-room-map.md).
- **Sito di test:** https://cyberzec.it (sito dell'autore, circa 130 URL).

## Stack

| Parte | Tecnologia |
|---|---|
| App desktop | Tauri 2 (macOS arm64; bundle id `com.cyberzec.cyberfrog`) |
| Crawler | Rust: tokio, reqwest (rustls), scraper, texting_robots, regex, serde_json; Chromium headless opzionale per il rendering JS |
| AI | Claude Messages API via reqwest, chiave nel Portachiavi macOS |
| Storage | SQLite (rusqlite bundled), un file `.sqlite` per crawl in `~/Library/Application Support/com.cyberzec.cyberfrog/crawls/` |
| UI | React 19 + TypeScript + Vite, TanStack Table **v9** (API nuova: `useTable`, `tableFeatures`, `table.FlexRender`) + TanStack Virtual |
| Lingua UI | Italiano e inglese (`src/i18n.ts`, selettore IT/EN) |

## Struttura

```
src-tauri/src/crawler.rs   crawl BFS, parsing HTML, schema SQLite, verifiche link esterni/immagini, sitemap, test
src-tauri/src/report.rs    letture in sola lettura: link esterni, link rotti, link di una pagina, immagini, hreflang, dati strutturati
src-tauri/src/lib.rs       comandi Tauri (start_crawl, open_crawl, page_links, image_pages, save_crawl_as, list_crawls, find_browser, ai_has_key, ai_set_key, ai_complete, write_text_file), Settings
src-tauri/src/ai.rs        assistente AI: chiave nel Portachiavi (`security -i` via stdin), chiamata alla Messages API (claude-opus-5-5, fallbacks "default")
src-tauri/src/mcp.rs       server MCP (`cyberfrog --mcp`)
src-tauri/examples/crawl.rs  crawl da terminale senza UI
src/App.tsx                shell, tab, riepilogo, apertura/salvataggio
src/DataTable.tsx          tabella generica: filtri, export CSV, ordinamento, virtualizzazione, selezione riga
src/DetailPanel.tsx        pannello Inlink/Outlink/Assistente AI di un URL
src/SiteStructure.tsx      URL per profondità + albero delle cartelle
src/ai.ts, src/AiAssist.tsx  prompt per Claude, hook useAi e output con Copia
src/ImagePanel.tsx         pagine che usano un'immagine
src/SettingsDialog.tsx     finestra Impostazioni
src/pages.ts               tipi (rispecchiano le struct Rust), filtri, controlli SEO, CSV, sitemap XML
src/settings.ts            impostazioni + salvataggio in localStorage
scripts/pages.check.ts     self-check della logica TS (node scripts/pages.check.ts)
docs/clean-room-map.md     funzionalità di riferimento
```

**Compatibilità:** i crawl salvati con versioni precedenti restano apribili. Per le colonne nuove `read_pages` usa `newer(...)` e `report.rs` usa `compiles(...)`. Ogni colonna nuova deve seguire questo schema.

## Dove siamo (v0.5.0, 2026-10-17)

App pubblicata: https://github.com/DZCyberZec/cyberfrog (Apache-2.0), ultima release [v0.5.0](https://github.com/DZCyberZec/cyberfrog/releases/tag/v0.5.0) con DMG per Apple silicon. Installata in `/Applications/CyberFrog.app`. 31 test Rust + `scripts/pages.check.ts`, clippy pulito.

### Fatto

| Versione | Funzionalità |
|---|---|
| 0.1.0 | Crawl stesso host (robots.txt, redirect, concorrenza, Stop), SQLite per crawl, Interni / Codici di risposta / Title / Meta description / H1 con filtri, indicizzabilità (noindex, canonical, X-Robots-Tag), link esterni e rotti, pannello Inlink/Outlink, immagini (alt, dimensioni, peso), sitemap XML (lettura, orfane, generazione), impostazioni (limite, velocità, user agent, esclusioni), prestazioni, hreflang, dati strutturati, contenuti duplicati (hash + SimHash), tab Problemi con priorità, export CSV, interfaccia IT/EN, icona, branding "Powered by Daniele Zecca – CyberZec" |
| 0.2.0 | Link non scansionabili, confronto tra crawl (automatico col precedente), server MCP `cyberfrog --mcp` |
| 0.3.0 | Estrazione personalizzata e ricerca nel sorgente (CSS / regex / testo), catene di redirect, barra laterale a gruppi |
| 0.5.0 | Modalità lista (solo gli URL incollati, qualsiasi dominio, robots.txt per dominio), crawl pianificati (launchd + `cyberfrog --scheduled <id>`, notifica con le differenze dal giro precedente), assistente AI anche tramite Claude Code (abbonamento, nessun costo API), modulo `ai/` diviso in keychain/api/claude_code |
| 0.4.0 | Link Score (PageRank interno 0–100), vista Struttura (profondità + albero cartelle), rendering JavaScript opzionale (Chrome/Chromium/Brave/Edge headless, report JavaScript), assistente AI con Claude (title/meta, spiegazione problemi, piano d'azione; chiave nel Portachiavi), limite URL che non scende più a 1 da solo, home con solo gli ultimi 5 crawl |

Dettagli tecnici utili:
- Colonne nuove nei crawl: leggerle con `newer(...)` in `read_pages` o `compiles(...)` in `report.rs`, così i crawl vecchi restano apribili.
- Problemi: `ISSUES` in `src/pages.ts`; `allIssues`, `pageIssues`, `withExamples` usano gli stessi report.
- Rendering JS: `Renderer` in `crawler.rs` (`--dump-dom`, max 4 browser, profilo temporaneo, timeout 30 s).
- AI: `src-tauri/src/ai/` (`claude_code.rs`: `claude -p --tools ""` senza MCP né sessione, prompt su stdin; `api.rs`: `claude-opus-5-5` con `fallbacks: "default"`; `keychain.rs`), prompt in `src/ai.ts`, impostazioni in `src/AiSettings.tsx`.
- Pianificazioni: `src-tauri/src/schedule.rs`, file `schedules.json` nella cartella dati dell'app, plist in `~/Library/LaunchAgents/com.cyberzec.cyberfrog.schedule.<id>.plist`.

### Da verificare

- **Assistente AI dal vivo:** testato solo con risposte finte. Il Claude Code del terminale sul Mac dell'utente non ha il login attivo (sessione OAuth scaduta): serve `claude` e poi `/login` nel Terminale. Poi: Interni → clic su una pagina → tab "Assistente AI".
- **Pianificazione dal vivo:** il runner `--scheduled` e la registrazione in launchd sono provati a mano; manca un giro completo creato dall'app installata.
- Rendering JS su un sito che usa davvero JavaScript (React/Vue): cyberzec.it è server-side, quindi lì non cambia nulla.

## Roadmap (cosa manca)

**Richieste dall'utente (2026-10-17), in quest'ordine:**
1. Funzioni SEO e **GEO** (ottimizzazione per motori AI) nuove e innovative, con codice veloce e leggero.
2. **Rifacimento UX**: l'interfaccia sembra complicata e da software vecchio.
3. **Aggiornamento automatico** da GitHub Releases.
4. **Sicurezza e modularità:** niente file monolitici. Da dividere: `crawler.rs` (~2700 righe) e `App.tsx` (~1200).

**Altre funzioni candidate:**
1. **Header di sicurezza e contenuto misto:** HSTS, CSP, X-Frame-Options, risorse http su pagine https. Basso sforzo, solo crawler e report.
2. **Grafo visuale dei link interni** (force-directed, colorato per Link Score o profondità).
3. **Google Search Console e PageSpeed Insights:** clic, impressioni e Core Web Vitals per URL. Richiedono le credenziali dell'utente: chiedere prima.
4. **Assistente AI in blocco:** title/meta suggeriti per tutte le pagine con problemi, esportabili in CSV (Batch API, costo 50% più basso).
5. **Ortografia e leggibilità** dei testi, **accessibilità** di base (lang, label, contrasto).

**Distribuzione:**
- Firma e notarizzazione Apple (serve un account Apple Developer dell'utente, 99 $/anno): oggi macOS chiede "Apri comunque" al primo avvio.
- Build per Mac Intel e Windows (oggi solo Apple silicon).

**Per una nuova versione:** alza la versione in `package.json`, `src-tauri/Cargo.toml` e `src-tauri/tauri.conf.json`, `npx tauri build`, chiudi l'app con `pkill -x cyberfrog` (il processo è minuscolo), copia in `/Applications`, poi `gh release create vX.Y.Z src-tauri/target/release/bundle/dmg/*.dmg --notes-file <note in inglese>`.

## Come lavorare (preferenze dell'utente)

- Commit e note di release **in inglese**, risposte in chat in italiano. Mai force-push senza richiesta esplicita.
- Lavorare **in autonomia**: sviluppare, testare da soli, fare commit, passare alla funzione successiva senza chiedere "procedo?". Fermarsi solo per decisioni vere (push, servizi a pagamento, credenziali, logo, licenza).
- Rispondere in **italiano**: prima l'azione, passi numerati e brevi, stato sempre esplicito.
- **Sicurezza prima di tutto e moduli piccoli** (l'utente lavora in cybersecurity): input non fidati validati ai confini, segreti mai in argv/URL, sottoprocessi senza shell e con timeout, privilegi minimi.
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
