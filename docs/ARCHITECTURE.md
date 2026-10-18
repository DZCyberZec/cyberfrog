# CyberFrog — architettura

Come è fatto CyberFrog e perché. Aggiornato alla v0.9.0 (2026-10-18). Per lo stato del progetto e cosa manca: [HANDOFF.md](HANDOFF.md) e [ROADMAP.md](ROADMAP.md).

## In una frase

App desktop **Tauri 2**: un backend **Rust** che scansiona i siti e salva ogni crawl in un **file SQLite**, e un'interfaccia **React + TypeScript** che legge quei dati e calcola report e problemi. Le funzioni AI passano da **Claude Code**, **Codex** o dall'**API Anthropic**; un **server MCP** espone gli stessi dati agli assistenti AI.

```
                  ┌──────────────────────────── UI (React, src/) ─────────────────────────────┐
 utente ─────────►│ App.tsx → StartScreen / Sidebar / Reports → report (DataTable, viste)     │
                  │ useAnalysis: problemi, salute, GEO, argomenti   (logica pura in *.ts)    │
                  └───────────────▲──────────────────────────────┬──────────────────────────┘
                                  │ invoke (comandi Tauri)        │ dati del crawl (JSON)
                  ┌───────────────┴──────────────── Rust (src-tauri/src/) ────────────────────┐
                  │ lib.rs: comandi, validazione impostazioni                                 │
                  │ crawler.rs → crawl.sqlite ← report.rs, geo/, topics/ (sola lettura)       │
                  │ ai/ (Claude Code, Codex, API)   schedule.rs (launchd)   mcp.rs (stdio)    │
                  └──────────────────────────────────────────────────────────────────────────┘
```

## Backend Rust (`src-tauri/src/`)

| Modulo | Cosa fa |
|---|---|
| `main.rs` | Punto d'ingresso: `--mcp` avvia il server MCP, `--scheduled <id>` un crawl pianificato, altrimenti la finestra |
| `lib.rs` | Comandi Tauri, `Settings` → `Config` (limiti, regex di esclusione, regole personalizzate validate) |
| `crawler.rs` | Crawl BFS stesso host o modalità lista, robots.txt per origine, redirect, fetch HTTP, parsing HTML (scraper), rendering JS opzionale (`Renderer`: Chrome/Brave/Edge headless), verifica link esterni e immagini, sitemap, schema e scrittura SQLite, `read_pages` (con Link Score) |
| `report.rs` | Letture in sola lettura per i report: link esterni e rotti, link di una pagina, immagini, hreflang, dati strutturati, link non scansionabili, estrazioni personalizzate, `link_scores` (PageRank) |
| `geo/` | GEO: `bots.rs` (12 crawler AI e verdetto robots.txt, Content-Signal), `llms.rs` (controllo formato llms.txt), `signals.rs` (segnali di citabilità per pagina), `faq.rs` (schema FAQ da una pagina), `mod.rs` (lettura per il report) |
| `topics/` | Argomenti: `terms.rs` (tokenizer + stopword IT/EN), `corpus.rs` (vettori TF-IDF, coppie simili con indice invertito, cluster attorno a un hub), `mod.rs` (cluster, cannibalizzazione, link da aggiungere), `gap.rs` (confronto di contenuti con un competitor) |
| `ai/` | `mod.rs` (scelta motore, stato connessione, ricerca web), `claude_code.rs`, `codex.rs`, `api.rs` (Messages API), `keychain.rs` (chiave nel Portachiavi) |
| `schedule.rs` | Crawl pianificati: plist launchd, esecuzione headless, confronto col giro precedente, notifica macOS |
| `tracker.rs` | Storico del tracker di visibilità AI (`ai_tracker.json`) |
| `mcp.rs` | Server MCP su stdio: `crawl_site`, `list_crawls`, `crawl_summary`, `query_crawl`, `page_details`, `geo_report`, `topics_report`, `content_gap` |

**Comandi Tauri:** `start_crawl`, `stop_crawl`, `open_crawl`, `page_links`, `image_pages`, `save_crawl_as`, `list_crawls`, `write_text_file`, `find_browser`, `list_schedules`, `add_schedule`, `remove_schedule`, `content_gap`, `ai_status`, `ai_set_key`, `ai_complete`, `ai_search`, `tracker_load`, `tracker_save`, `faq_schema`.

## Interfaccia (`src/`)

Regola: la **logica sta in file `.ts` puri e testati** (`scripts/pages.check.ts`), i componenti `.tsx` solo mostrano.

| File | Ruolo |
|---|---|
| `App.tsx` | Guscio: stato del crawl, azioni (avvia, apri, salva, esporta), header, dialoghi, ⌘K |
| `Reports.tsx` | Mostra il report scelto e il pannello dettaglio dell'URL selezionato |
| `nav.ts`, `Sidebar.tsx` | Elenco dei report a gruppi, badge dei problemi |
| `useAnalysis.ts` | Calcoli condivisi: problemi, conteggi, salute, righe GEO, citabilità |
| `pages.ts` | Tipi (rispecchiano Rust), filtri di ogni report, `ISSUES`, `allIssues`, confronto tra crawl, CSV, sitemap |
| `health.ts`, `geo.ts`, `topics.ts`, `competitor.ts`, `tracker.ts`, `llms.ts`, `clientReport.ts`, `ai.ts` | Logica pura per salute, GEO, argomenti, competitor, tracker AI, llms.txt, report per il cliente, prompt AI |
| `Overview.tsx`, `GeoReport.tsx`, `TopicsReport.tsx`, `CompetitorReport.tsx`, `TrackerReport.tsx`, `SiteStructure.tsx` | Viste dei report speciali |
| `DataTable.tsx`, `columns.tsx` | Tabella generica (filtri, ordinamento, virtualizzazione, CSV) e colonne di tutte le tabelle |
| `DetailPanel.tsx`, `ImagePanel.tsx`, `FaqSchema.tsx`, `AiAssist.tsx` | Pannelli di dettaglio, generatore FAQ, output AI |
| `SettingsDialog.tsx`, `AiSettings.tsx`, `ListDialog.tsx`, `SchedulesDialog.tsx` | Dialoghi |
| `CrawlForm.tsx`, `StartScreen.tsx`, `Menu.tsx`, `CommandPalette.tsx`, `HelpButton.tsx` + `help.ts`, `icons.tsx` | Elementi d'interfaccia |
| `i18n.ts` | Testi italiani come chiavi, dizionario inglese, `tr()` e `trError()` |

## Dati

**Un file SQLite per crawl** in `~/Library/Application Support/com.cyberzec.cyberfrog/crawls/crawl-<ms>.sqlite`. Tabelle:

| Tabella | Contenuto |
|---|---|
| `pages` | Un URL per riga: stato, redirect, title, meta, H1, canonical, robots, parole, tempi, peso, hash, SimHash, dati del rendering JS |
| `links` | Link interni ed esterni con anchor |
| `external`, `image_info` | Verifica dei link esterni e delle immagini |
| `images`, `hreflang`, `structured`, `bad_links`, `sitemap` | Immagini per pagina, annotazioni hreflang, dati strutturati, link non scansionabili, URL nelle sitemap |
| `custom_rules`, `custom` | Regole di estrazione e risultati |
| `robots_txt`, `llms_txt`, `geo` | File robots.txt per origine, llms.txt, segnali di citabilità per pagina |
| `keywords` | 30 parole chiave per pagina, per gli argomenti |

**Compatibilità:** ogni tabella o colonna nuova si legge con un controllo (`newer()` in `read_pages`, `compiles()` in `report.rs`, `prepare(...).is_err()` in `geo/` e `topics/`), così i crawl vecchi si aprono sempre.

Altri file nella cartella dati dell'app: `schedules.json` (pianificazioni), `ai_tracker.json` (storico del tracker). Impostazioni dell'interfaccia in `localStorage` della webview.

## Motori AI

| Motore | Come | Costo |
|---|---|---|
| Claude Code | `claude -p --output-format json`, nessuno strumento (`--tools ""`), niente MCP, comandi slash o sessione salvata; per la ricerca solo `WebSearch` | abbonamento Claude |
| Codex | `codex exec` con `--ignore-user-config --ignore-rules`, sandbox in sola lettura, shell/app/browser/computer use/plugin/hook disattivati; per la ricerca `codex --search` | abbonamento ChatGPT |
| API Anthropic | Messages API `claude-opus-5-5`, `fallbacks: "default"`; ricerca con `web_search_20260209` | a consumo, chiave nel Portachiavi |

Lo stato (installato, login fatto) si legge senza spendere token: `claude auth status`, `codex login status`.

## Sicurezza

L'utente lavora in cybersecurity: ogni dato che arriva da fuori è **non fidato**.

- **Pagine scansionate:** possono contenere istruzioni per un'AI (prompt injection). Per questo le CLI AI girano senza strumenti (solo ricerca web per il tracker, dove il prompt è la domanda dell'utente), senza MCP, in una cartella vuota, con timeout e `kill_on_drop`. Verificato a mano che Codex non può leggere un file locale.
- **Segreti:** la chiave API va solo nel Portachiavi, passata a `security` via stdin, mai in argv, URL o file; non arriva mai alla webview.
- **Report per il cliente:** ogni testo del crawl è "escapato" in HTML (test con `<script>`).
- **Schema FAQ:** il JSON-LD neutralizza `</` perché il testo della pagina non possa chiudere il blocco script.
- **Download:** robots.txt e llms.txt limitati a 512 KB, pagine per lo schema FAQ a 2 MB, timeout su ogni richiesta.
- **MCP:** connessione SQLite in sola lettura, solo `SELECT` (massimo 200 righe), percorsi accettati solo dentro la cartella dei crawl.
- **Sottoprocessi:** binari fissi trovati in cartelle note, mai una shell, argomenti separati.
- **Permessi Tauri minimi:** `core`, `opener`, `dialog` di default; nessun permesso di apertura di file arbitrari.

## Test

- `cd src-tauri && cargo test` (crawler su server HTTP locale, report, GEO, argomenti, AI con server e binari finti, MCP, pianificazioni) e `cargo clippy --all-targets` senza avvisi.
- `node scripts/pages.check.ts`: filtri, problemi, salute, GEO, argomenti, competitor, tracker, report cliente, llms.txt, completezza delle traduzioni e dell'aiuto.
- `npx tsc --noEmit -p .`
- Prove reali su https://cyberzec.it (sito dell'autore).
