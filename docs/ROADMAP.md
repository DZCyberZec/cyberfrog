# CyberFrog — roadmap

Cosa manca, in ordine di priorità. Aggiornata al 2026-10-18 (v0.9.0). Ciò che è già fatto è in [HANDOFF.md](HANDOFF.md); com'è costruito in [ARCHITECTURE.md](ARCHITECTURE.md).

## 1. Prossimi lavori (chiesti dall'utente)

### Google Search Console — in attesa di una scelta dell'utente
Clic, impressioni, CTR, posizione e query per ogni pagina, accanto ai dati del crawl. Usi previsti:
- pagine con molte impressioni ma CTR basso, con l'AI che riscrive title e meta;
- query su cui due pagine del sito si fanno concorrenza (cannibalizzazione su dati reali di Google);
- pagine con traffico ma senza link interni, pagine in Search Console mai trovate dal crawl.

Accesso, da decidere con l'utente:
- **Login Google (OAuth), consigliato:** l'autore crea una volta un client OAuth "App desktop" su Google Cloud; ogni utente accede con il proprio account e vede solo le proprie proprietà. Token nel Portachiavi, scope in sola lettura `webmasters.readonly`, revocabile dall'account Google. Flusso loopback + PKCE, senza nuove dipendenze pesanti (aws-lc-rs è già presente per la cifratura). Finché Google non verifica l'app (gratuito, qualche settimana, serve una pagina privacy): avviso "app non verificata" e massimo 100 utenti.
- **Service account (file JSON), opzione avanzata nelle Impostazioni:** l'utente crea un account di servizio, lo aggiunge come utente alla proprietà e carica il JSON. La chiave privata va solo nel Portachiavi e il file originale va cancellato. È meno sicuro: la chiave non scade, finché non viene revocata.

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
