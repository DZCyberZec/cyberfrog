# CyberFrog — handoff

Documento per riprendere il lavoro in una nuova chat: chiedi di leggere `docs/HANDOFF.md`, poi [ARCHITECTURE.md](ARCHITECTURE.md) (com'è fatto) e [ROADMAP.md](ROADMAP.md) (cosa manca).

Ultimo aggiornamento: 2026-10-19 (v0.11.0).

## Cos'è

CyberFrog – Another SEO Tool: crawler SEO e GEO desktop di Daniele Zecca (CyberZec), ricostruzione **clean-room** di Screaming Frog SEO Spider con funzioni nuove per la visibilità nelle AI.

- **Repository:** https://github.com/DZCyberZec/cyberfrog (pubblico, Apache-2.0), release con DMG per Apple silicon. App installata in `/Applications/CyberFrog.app`.
- **Regola clean-room:** mai decompilare né leggere codice o risorse di Screaming Frog. Solo documentazione pubblica e comportamento osservabile ([clean-room-map.md](clean-room-map.md)).
- **Sito di test:** https://cyberzec.it (dell'autore, circa 130 URL). Non scansionare siti di terzi di propria iniziativa.

## Stack

| Parte | Tecnologia |
|---|---|
| App | Tauri 2, macOS arm64, bundle id `com.cyberzec.cyberfrog` |
| Backend | Rust: tokio, reqwest (rustls), scraper, texting_robots, regex, rusqlite (bundled), serde_json |
| UI | React 19 + TypeScript + Vite, TanStack Table v9 + Virtual, nessuna libreria di icone |
| Dati | Un file SQLite per crawl in `~/Library/Application Support/com.cyberzec.cyberfrog/crawls/` |
| AI | Claude Code CLI, Codex CLI o API Anthropic (chiave nel Portachiavi) |
| Lingue | Italiano (testi sorgente) e inglese (`src/i18n.ts`) |

Dettagli di moduli, dati, motori AI e sicurezza: [ARCHITECTURE.md](ARCHITECTURE.md).

## Dove siamo (v0.11.0)

| Versione | Funzionalità |
|---|---|
| 0.1.0 | Crawl stesso host (robots.txt, redirect, concorrenza, Stop), report Interni / Codici / Title / Meta / H1 con filtri, indicizzabilità, link esterni e rotti, immagini, sitemap XML (lettura, orfane, generazione), impostazioni, prestazioni, hreflang, dati strutturati, contenuti duplicati, tab Problemi, export CSV, IT/EN, icona e "Powered by Daniele Zecca – CyberZec" |
| 0.2.0 | Link non scansionabili, confronto tra crawl, server MCP `cyberfrog --mcp` |
| 0.3.0 | Estrazione personalizzata e ricerca nel sorgente, catene di redirect, barra laterale a gruppi |
| 0.4.0 | Link Score (PageRank interno), vista Struttura, rendering JavaScript opzionale, assistente AI (title/meta, spiegazione problemi, piano d'azione) |
| 0.5.0 | Modalità lista, crawl pianificati (launchd + notifica), assistente AI tramite Claude Code |
| 0.6.0 | Report GEO "Visibilità nelle AI": 12 crawler AI, llms.txt, Content-Signal, citabilità 0–100 per pagina |
| 0.7.0 | Rifacimento UX: schermata iniziale, Riepilogo con salute SEO 0–100, header con menu ⋯, ricerca ⌘K; `App.tsx` diviso in componenti |
| 0.8.0 | Report "Argomenti e link": cluster, cannibalizzazione, link interni da aggiungere (TF-IDF locale) |
| 0.9.0 | **Competitor** (confronto su 13 indicatori, argomenti mancanti ed esclusivi, azioni per superarlo, piano AI); **tracker AI** (l'AI con ricerca web ti cita? in che posizione? chi cita al posto tuo? con storico); **Codex** come terzo motore AI, con stato di connessione e passaggi per collegare ogni motore; **report per il cliente** (HTML da stampare in PDF); **generatori** di llms.txt e schema FAQ; **aiuto "?"** su ogni report; **MCP** con `geo_report`, `topics_report`, `content_gap` |
| 0.10.0 | **Accesso a Claude Code e Codex dalle Impostazioni** (pulsante "Accedi", senza Terminale, stato aggiornato da solo); **Google Search Console:** accesso Google (OAuth + PKCE, token nel Portachiavi) o service account (opzione avanzata); report con clic, impressioni, CTR e posizione per pagina accanto al crawl, filtri CTR basso / quasi in prima pagina / non trovate dal crawl / senza impressioni, query in cannibalizzazione, riscrittura title e meta con AI |
| 0.11.0 | **Più account Google** per Search Console (login Google e service account insieme; ogni proprietà usa l'account che la legge, scelta automatica per il sito del crawl); **colonne ridimensionabili** in tutte le tabelle (trascina il bordo, doppio clic adatta al testo, larghezze ricordate per report) con scroll orizzontale; **riepilogo GEO comprimibile** in una riga |

**Verificato dal vivo su cyberzec.it:** salute SEO 82/100, citabilità media 87/100, tutti i crawler AI aperti, llms.txt valido, 8 cluster, 3 casi di cannibalizzazione, 12 link da aggiungere. Claude Code (account Claude Pro) e Codex sono collegati e provati dal vivo; il tracker trova cyberzec.it citato al 1° posto con Claude e al 2° con Codex per "consulenza cybersecurity PMI Senigallia", mentre per "migliori consulenti SEO Marche" l'AI cita solo altri siti.

**Test:** 59 test Rust, `scripts/pages.check.ts`, clippy senza avvisi.

Cosa manca e cosa va ancora verificato dal vivo: [ROADMAP.md](ROADMAP.md).

## Come lavorare (preferenze dell'utente)

- **Autonomia:** sviluppare, testare da soli, fare commit, rilasciare, passare alla funzione successiva senza chiedere "procedo?". Fermarsi solo per decisioni vere: credenziali, servizi a pagamento, account da creare, licenze.
- **Più agenti per andare più veloci (permesso dall'utente il 2026-10-18):** dividere i lavori indipendenti tra sotto-agenti con un modello più economico (Sonnet), ognuno in un worktree isolato. Al termine l'agente principale controlla, unisce i rami e rimuove i worktree (`.claude/worktrees/` è in `.gitignore`).
- **Sicurezza prima di tutto** (l'utente lavora in cybersecurity) e **niente file monolitici:** moduli piccoli, logica pura nei `.ts` e testata, input non fidati validati, segreti mai in argv/URL/file, sottoprocessi senza shell e con timeout, privilegi minimi.
- **Leggerezza:** niente dipendenze nuove se non indispensabili.
- **Lingue:** commit, note di release e README in inglese; chat e documenti in `docs/` in italiano. Mai force-push senza richiesta esplicita. Le email dei commit usano l'indirizzo noreply di GitHub (già nella configurazione git locale).
- **Stile:** codice minimo e completo; i commenti spiegano solo il perché.

## Comandi

```bash
# test Rust e lint
cd src-tauri && cargo test && cargo clippy --all-targets

# self-check della logica TypeScript e typecheck
node scripts/pages.check.ts && npx tsc --noEmit -p .

# crawl da terminale con lo stesso codice dell'app
cd src-tauri && cargo run --example crawl -- https://cyberzec.it /tmp/cz.sqlite

# app in sviluppo
npm run tauri dev
```

**Nuova versione:**
1. Alza la versione in `package.json`, `src-tauri/Cargo.toml` e `src-tauri/tauri.conf.json`.
2. Esegui `npx tauri build`.
3. Chiudi l'app con `pkill -x cyberfrog` (il processo ha il nome minuscolo) e copia il bundle in `/Applications`.
4. `gh release create vX.Y.Z src-tauri/target/release/bundle/dmg/*.dmg --notes-file <note in inglese>`.

## Come testare la UI

- `computer-use` sull'app installata, se la cattura dello schermo funziona; spesso fallisce ("acquisizione audio/video non riuscita").
- **Alternativa affidabile:**
  1. Avvia Vite nel browser di anteprima (`.claude/launch.json`, configurazione `vite`).
  2. Simula `window.__TAURI_INTERNALS__.invoke` con dati estratti da un `.sqlite` reale (un esempio temporaneo in `src-tauri/examples/` che stampa `read_pages`, i report, `geo::read` e `topics::analyze` in JSON).
  3. Elimina `public/__mock.*` e ripristina `index.html` dopo l'uso.
- I campi React controllati si impostano con il setter nativo di `value` più un evento `input`, perché `form_input` e `type` dello strumento di test non aggiornano lo stato.
