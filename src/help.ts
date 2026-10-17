// Short how-to for each report: what it shows, how to read it, what to do with it.
// Every claim mirrors what the code computes (src/health.ts, src/geo.ts, src/pages.ts, src-tauri/src/topics/).
import { tr } from "./i18n.ts";

export const HELP: Record<string, { what: string; read: string; act: string }> = {
  overview: {
    what: tr("Il quadro d'insieme del crawl: punteggio di salute SEO, codici di risposta, numeri chiave e i problemi da sistemare per primi."),
    read: tr("La salute parte da 100 e perde punti per ogni tipo di problema: fino a 30 se Alta, 12 se Media, 4 se Bassa, in proporzione alle pagine coinvolte. Da 80 è buona, sotto 50 è critica. Un clic su un numero apre il report."),
    act: tr("Parti da «Da sistemare per primo»: è ordinato per priorità e numero di URL. Dopo le correzioni rifai il crawl e controlla che il punteggio salga."),
  },
  issues: {
    what: tr("L'elenco di tutti i problemi trovati, uno per riga, con priorità, numero di URL coinvolti e report in cui vedere le pagine."),
    read: tr("Alta: impedisce a pagine di essere trovate o indicizzate (errori 4xx/5xx, link rotti, title mancante). Media: costa posizionamento. Bassa: rifinitura. La colonna URL dice quante pagine sono interessate."),
    act: tr("Lavora dall'alto: prima le Alta, poi le Media. Un clic sulla riga apre il report già filtrato sulle pagine da correggere. «Piano d'azione AI» ne ricava un piano (serve l'AI configurata nelle Impostazioni)."),
  },
  compare: {
    what: tr("Confronta questo crawl con uno precedente dello stesso sito: pagine nuove o rimosse, e cosa è cambiato in stato, indicizzabilità, title, meta description, H1, canonical e problemi."),
    read: tr("Scegli il crawl di riferimento dal menu «Confronta con». Ogni riga è una differenza, con il valore prima e dopo; la riga Problema mostra come cambia il numero di URL di quel problema. I filtri isolano un tipo di cambiamento."),
    act: tr("Dopo una modifica al sito o un rilascio, rifai il crawl e confrontalo: i problemi devono calare, e non devono comparire pagine rimosse, redirect o noindex per errore."),
  },
  competitor: {
    what: tr("Mette a confronto il tuo sito con quello di un competitor: stessi indicatori affiancati, argomenti che copre lui e tu no, e i passi per superarlo."),
    read: tr("Inserisci l'URL del competitor (o scegli un crawl già fatto): viene analizzato con le tue impostazioni. Nella tabella è evidenziato chi è avanti su ogni indicatore. Le azioni sono ordinate per priorità e divise in SEO, GEO e Contenuti."),
    act: tr("Parti dalle azioni Alta. Per ogni argomento che il competitor copre e tu no, crea una pagina; dove lui scrive molto di più su un tema comune, approfondisci. «Piano AI» ne ricava un piano a fasi."),
  },
  internal: {
    what: tr("Tutti gli URL del sito trovati dal crawl, con i dati principali di ciascuno: stato, indicizzabilità, title, meta description, H1, canonical, parole, link e tempi."),
    read: tr("Ogni riga è un URL; scorri a destra per le colonne. Profondità = clic dalla pagina iniziale. Inlink = link interni che la puntano. Link Score = importanza interna da 0 a 100. Clic sulla riga per il dettaglio."),
    act: tr("Ordina le colonne per trovare pagine senza title, con poche parole, molto profonde o con pochi inlink. Le pagine importanti dovrebbero avere Link Score alto. Esporta in CSV per lavorarci altrove."),
  },
  structure: {
    what: tr("La forma del sito: quanti URL ci sono a ogni livello di profondità e come sono distribuiti nelle cartelle."),
    read: tr("In alto, gli URL per profondità: «Livello n» sono i clic dalla pagina iniziale, «Solo sitemap» gli URL che il crawl non ha raggiunto con i link. Nell'albero, per ogni cartella: URL totali, indicizzabili e Link Score massimo."),
    act: tr("Le pagine importanti dovrebbero stare entro 3-4 livelli: avvicina quelle troppo profonde con link dal menu o da pagine forti. Controlla chi è solo in sitemap: nessuna pagina lo collega."),
  },
  codes: {
    what: tr("Il codice di risposta di ogni URL, cioè cosa ha risposto il server quando CyberFrog lo ha richiesto."),
    read: tr("2xx = funziona. 3xx = reindirizza altrove. 4xx = errore del client (es. 404, pagina inesistente). 5xx = errore del server. «Bloccati» sono esclusi da robots.txt, «Nessuna risposta» sono timeout o errori di rete."),
    act: tr("Sistema prima 5xx e 4xx: ripristina la pagina o reindirizzala (301) e aggiorna i link che la puntano. Per i 5xx controlla hosting e log. Verifica che i bloccati da robots.txt lo siano di proposito."),
  },
  redirects: {
    what: tr("Dove finisce ogni URL che reindirizza, seguendo tutti i passaggi fino alla destinazione finale."),
    read: tr("Hop = quanti redirect vengono seguiti; Catena è il percorso e Stato finale la risposta della destinazione. Il filtro Catene è 2 o più hop, Loop un percorso che si chiude su se stesso, «Verso URL non scansionati» uno che esce dal crawl."),
    act: tr("Risolvi prima i loop. Per le catene, fai puntare il primo URL direttamente alla destinazione finale e aggiorna i link interni, così eviti hop inutili. Ogni redirect dovrebbe arrivare a una pagina che risponde 200."),
  },
  index: {
    what: tr("Quali pagine un motore di ricerca può indicizzare e perché le altre no: noindex, canonical, robots.txt, redirect ed errori."),
    read: tr("«Non indicizzabili» mostra il motivo di ogni URL. Una pagina «Canonicalizzata» dichiara che l'originale è un altro URL; il canonical dovrebbe puntare a una pagina che risponde 200. «Canonical auto-referenziale» punta a se stessa, ed è normale."),
    act: tr("Controlla che nessuna pagina importante sia noindex o canonicalizzata per sbaglio. Aggiungi un canonical auto-referenziale alle pagine che ne sono prive e correggi quelli che puntano a URL non 200."),
  },
  perf: {
    what: tr("Quanto rispondono velocemente le pagine e quanto pesa il loro HTML, misurato da CyberFrog durante il crawl."),
    read: tr("Il tempo (ms) è la risposta del server misurata dal crawler, non il caricamento completo nel browser. I filtri isolano le pagine sopra 1 s, sopra 3 s e con HTML sopra 512 KB. Il tempo mediano del sito è nel Riepilogo."),
    act: tr("Per le pagine lente attiva la cache, verifica l'hosting e le query lente. Per quelle pesanti riduci l'HTML e gli script inseriti nella pagina. Controlla prima le pagine più visitate."),
  },
  js: {
    what: tr("Cosa cambia quando la pagina viene eseguita in un browser con JavaScript, rispetto all'HTML che il server invia."),
    read: tr("Serve il Rendering JavaScript attivo nelle Impostazioni. Confronta parole e link nell'HTML con quelli dopo il rendering: «Parole da JS» e «Link da JS» sono ciò che esiste solo dopo. Il filtro contenuto scatta se è almeno un quinto del testo (e 50+ parole)."),
    act: tr("Metti contenuto e link importanti nell'HTML del server (rendering lato server o pre-rendering): chi non esegue JavaScript, come i crawler AI, non li vede, e Google li legge più tardi. Controlla anche le pagine con errore di rendering."),
  },
  duplicates: {
    what: tr("Pagine con lo stesso testo o quasi, e pagine con troppo poco contenuto."),
    read: tr("«Duplicati esatti» hanno testo identico. «Quasi duplicati» sono simili almeno al 90%; Similarità max è la più alta con un'altra pagina e Pagina più simile dice quale. «Contenuto scarso» è sotto 200 parole. Si guardano solo pagine indicizzabili."),
    act: tr("Per i duplicati unisci le pagine oppure indica la principale con un canonical. Per i quasi duplicati differenzia i testi. Per i contenuti scarsi arricchiscili o valuta un noindex."),
  },
  geo: {
    what: tr("Quanto il sito è pronto per le risposte delle AI (ChatGPT, Claude, Perplexity): cosa possono leggere e quanto ogni pagina è facile da citare."),
    read: tr("In alto: citabilità media, quali crawler AI robots.txt lascia entrare, llms.txt e Content-Signal. La citabilità di una pagina va da 0 a 100 ed è la somma di 10 controlli (risposta in apertura, sottotitoli a domanda, liste, dati, autore, data, fonti…). «Da migliorare» elenca quelli falliti."),
    act: tr("Apri ai bot di ricerca AI in robots.txt, altrimenti non compari nelle risposte. Poi, pagina per pagina, aggiungi ciò che manca: risposta di 20-80 parole in apertura, autore, data, liste. «Genera llms.txt» è facoltativo."),
  },
  tracker: {
    what: tr("Il tracker della visibilità nelle AI: scrivi le domande che le persone fanno e CyberFrog le pone a un'AI con ricerca web, verificando se cita il tuo sito."),
    read: tr("Per ogni domanda vedi se il tuo sito è citato, in che posizione e quali altri siti vengono citati al posto tuo. Lo storico mostra come cambia nel tempo, a ogni nuova verifica."),
    act: tr("Scegli domande reali dei tuoi clienti. Per quelle in cui non compari, guarda chi viene citato e migliora la tua pagina su quel tema (report Visibilità nelle AI). Ripeti la verifica dopo le modifiche."),
  },
  topics: {
    what: tr("Come i contenuti si raggruppano per argomento: cluster di pagine, pagine che si fanno concorrenza e link interni che mancano. Calcolato in locale da title, H1 e testo."),
    read: tr("Cluster: pagine sullo stesso tema attorno a un hub, la più forte per Link Score. Cannibalizzazione: coppie con title/H1 simili almeno al 50% e contenuto al 30%. Link da aggiungere: collegamenti mancanti tra pagine affini, con il testo del link suggerito."),
    act: tr("Per le coppie in cannibalizzazione unisci i contenuti, differenzia title e H1 o indica la principale con un canonical. Aggiungi i link suggeriti: dal hub alle pagine del tema e viceversa."),
  },
  title: {
    what: tr("Il title di ogni pagina indicizzabile: il titolo mostrato nei risultati di Google e nella scheda del browser."),
    read: tr("Lunghezza in caratteri. Il filtro segnala title mancanti, duplicati (stesso testo su più pagine), oltre 60 caratteri (Google lo tronca) e sotto 30 (spazio sprecato). Sono giudicate solo le pagine HTML indicizzabili."),
    act: tr("Scrivi un title unico per pagina, tra 30 e 60 caratteri, con l'argomento principale all'inizio. Parti dai mancanti e dai duplicati, poi dai troppo lunghi o corti."),
  },
  meta_description: {
    what: tr("La meta description di ogni pagina indicizzabile: il testo di anteprima che Google può mostrare sotto il titolo."),
    read: tr("Lunghezza in caratteri. Il filtro segnala mancanti, duplicate, oltre 155 caratteri (viene troncata) e sotto 70 (anteprima povera). Non è un fattore di posizionamento diretto, ma influisce sui clic."),
    act: tr("Scrivi una descrizione diversa per ogni pagina, tra 70 e 155 caratteri, che dica cosa si trova e inviti al clic. Parti dalle pagine principali e da quelle senza descrizione."),
  },
  h1: {
    what: tr("L'H1 di ogni pagina indicizzabile: il titolo principale visibile nella pagina."),
    read: tr("Il filtro segnala H1 mancanti, duplicati (lo stesso su più pagine) e oltre 70 caratteri. Non esiste un minimo. Di norma ogni pagina ha un solo H1, che dice di cosa parla."),
    act: tr("Aggiungi un H1 alle pagine che ne sono prive, con l'argomento principale. Rendi diverso l'H1 delle pagine duplicate e accorcia quelli troppo lunghi."),
  },
  schema: {
    what: tr("I dati strutturati (schema.org) trovati in ogni pagina HTML, che aiutano Google e le AI a capire di cosa tratta la pagina."),
    read: tr("Tipi schema.org e formato (es. JSON-LD) per pagina. «JSON non valido» = blocco che non si legge, Google lo ignora. «Proprietà mancanti» = mancano campi richiesti per i risultati avanzati. Ci sono filtri anche per i tipi più comuni."),
    act: tr("Correggi prima il JSON non valido, poi aggiungi le proprietà mancanti. Dove mancano, aggiungi i tipi utili: Organization, Article, FAQ, Product. Verifica con il test dei risultati avanzati di Google."),
  },
  hreflang: {
    what: tr("Le annotazioni hreflang, che indicano a Google quale versione linguistica o regionale mostrare a ogni utente."),
    read: tr("Per ogni pagina: lingue indicate e problemi. Codice non valido (es. it-IT va bene, it-UK no), senza return link (l'alternativa non rimanda a questa pagina), alternativa non 200, senza auto-riferimento, senza x-default (versione predefinita)."),
    act: tr("Ogni pagina deve elencare se stessa e tutte le alternative, e ogni alternativa deve rimandare indietro. Usa codici lingua-regione ISO e aggiungi x-default. Correggi prima i codici non validi e i return link mancanti."),
  },
  external: {
    what: tr("I link dal tuo sito verso altri siti, con lo stato di risposta di ciascuna destinazione."),
    read: tr("Ogni riga è un URL esterno; Stato è il codice con cui ha risposto, Inlink quante pagine del tuo sito lo linkano. I filtri separano 2xx, 3xx, 4xx, 5xx e le destinazioni che non rispondono."),
    act: tr("Controlla le destinazioni con 4xx, 5xx o senza risposta: sono link rotti per i lettori (vedi anche Link rotti). Per i 3xx aggiorna al nuovo indirizzo. Tieni link utili e affidabili: il report Visibilità nelle AI premia le pagine che citano fonti esterne."),
  },
  broken: {
    what: tr("I link che portano a una pagina che non funziona (errore 4xx/5xx o nessuna risposta), con la pagina in cui si trovano."),
    read: tr("Pagina di origine = dove sta il link; Link rotto = l'URL di destinazione; Anchor text = il testo cliccabile. Il filtro Interni è per i link verso il tuo sito, Esterni verso altri siti. Clic sulla riga per il dettaglio della pagina di origine."),
    act: tr("Per ogni riga correggi l'URL nel link o rimuovilo; per un interno, se la pagina è stata spostata, aggiungi anche un redirect 301. Parti dai link interni: danneggiano sia gli utenti sia la scansione."),
  },
  badlinks: {
    what: tr("I link che i motori di ricerca non riescono a seguire, perché non sono scritti come un normale collegamento."),
    read: tr("«Non scansionabili» sono link in JavaScript o con href su elementi diversi da <a>: Google non li segue. «URL non validi» hanno un indirizzo scritto male. Pagina e Link dicono dove si trova; il motivo è nella colonna Motivo."),
    act: tr("Riscrivi i link come <a href=\"URL\"> con un indirizzo valido. Sono importanti soprattutto nella navigazione: pagine raggiungibili solo così possono non essere scoperte."),
  },
  images: {
    what: tr("Le immagini usate dal sito, con stato, peso, testo alternativo e dimensioni."),
    read: tr("Le colonne dicono in quante pagine compare l'immagine e quante volte manca alt o width/height. I filtri trovano immagini oltre 100 KB, senza alt, con alt vuoto (decorative: va bene), senza dimensioni e con errori. Clic su una riga per l'anteprima."),
    act: tr("Comprimi o converti in WebP/AVIF quelle sopra 100 KB. Descrivi con un alt chiaro le immagini che portano contenuto. Indica width e height per evitare che il layout si sposti mentre carica."),
  },
  sitemap: {
    what: tr("Il confronto tra le pagine trovate dal crawl e quelle elencate nella sitemap XML del sito."),
    read: tr("«Nella sitemap» indica se l'URL è elencato. Il filtro «Indicizzabili non nella sitemap» trova pagine che vorresti far scoprire. «Orfane» sono nella sitemap ma senza inlink. «Non indicizzabili nella sitemap» sono errori, redirect o noindex elencati per sbaglio."),
    act: tr("La sitemap deve contenere solo pagine indicizzabili con risposta 200: togli le altre e aggiungi le mancanti. Collega le orfane da altre pagine. «Genera sitemap XML» crea il file dal crawl."),
  },
  custom: {
    what: tr("I risultati delle regole personalizzate che hai definito: testo da cercare o da estrarre dalle pagine."),
    read: tr("Le regole si creano in Impostazioni, sezione Estrazione e ricerca. Ogni regola ha una colonna: una regola di ricerca mostra quante volte il testo compare nella pagina, una di estrazione i valori trovati."),
    act: tr("Usala per verificare cose specifiche del tuo sito: codici di tracciamento, testi obbligatori, prezzi, SKU. Dopo aver aggiunto o cambiato una regola, rifai il crawl per vederne i risultati."),
  },
};
