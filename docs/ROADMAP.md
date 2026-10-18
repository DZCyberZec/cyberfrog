# CyberFrog — roadmap

Cosa manca, in ordine di priorità. Aggiornata al 2026-10-18 (v0.10.0). Ciò che è già fatto è in [HANDOFF.md](HANDOFF.md); com'è costruito in [ARCHITECTURE.md](ARCHITECTURE.md).

## 1. Prossimi lavori (chiesti dall'utente)

### Google Search Console — fatto in v0.10.0, da completare
Fatti: login Google (OAuth + PKCE) e service account, report con pagine, CTR basso, "quasi in prima pagina", pagine non trovate dal crawl, query in cannibalizzazione, riscrittura title/meta con AI. Da fare:
- **Client OAuth integrato nella release:** compilare con `CYBERFROG_GOOGLE_CLIENT_ID` e `CYBERFROG_GOOGLE_CLIENT_SECRET`, così chi scarica l'app clicca solo "Accedi con Google".
- **Verifica dell'app su Google** (pagina privacy, dominio, video demo) per togliere l'avviso "app non verificata" e il limite di 100 utenti.
- Problemi Search Console nel tab Problemi e nel report per il cliente; dati salvati nel file del crawl e disponibili via MCP.

### Aggiornamento automatico
L'app controlla le release su GitHub e si aggiorna da sola (plugin updater di Tauri). Serve una coppia di chiavi per firmare gli aggiornamenti: la chiave privata deve restare all'autore, fuori dal repository.

### Dividere `crawler.rs`
Il file ha circa 2700 righe: va diviso in `crawler/` con fetch, parse, store, render, robots e checks, senza cambiare il comportamento (i test esistenti fanno da rete).

## 2. Idee pronte (proposte, non ancora richieste)

- **Tracker AI pianificato:** verifiche settimanali automatiche (launchd, come i crawl pianificati) con notifica quando il sito entra o esce dalle risposte AI.
- **Più competitor** a confronto, e monitoraggio periodico dei loro nuovi argomenti.
- **Header di sicurezza e contenuto misto:** HSTS, CSP, X-Frame-Options, risorse http su pagine https.
- **PageSpeed Insights / Core Web Vitals** per URL (serve una chiave API Google).
- **Assistente AI in blocco:** title e meta suggeriti per tutte le pagine con problemi, esportabili in CSV.
- **Grafo visuale dei link interni**, colorato per Link Score o argomento.
- **Leggibilità, ortografia, accessibilità** di base (lang, label, contrasto).
- **Stemming leggero italiano/inglese** per gli argomenti, così "servizio" e "servizi" contano come la stessa parola.

## 3. Distribuzione

- Firma e notarizzazione Apple (serve un account Apple Developer dell'autore, 99 $/anno): oggi macOS chiede "Apri comunque" al primo avvio.
- Build per Mac Intel e Windows (oggi solo Apple silicon).
- Pagina privacy (serve anche per la verifica Google di Search Console).

## 4. Da verificare dal vivo

- **Claude Code:** sul Mac dell'autore il login del terminale è scaduto (`claude` → `/login`). Codex invece è collegato e provato dal vivo (risposte e ricerca web).
- **Pianificazioni:** il runner `--scheduled` e launchd sono provati a mano; manca un giro completo creato dall'app installata.
- **Rendering JS** su un sito che usa davvero JavaScript (cyberzec.it è server-side).
- **Schema FAQ e llms.txt** generati dall'app installata (finora provati con test e typecheck).
