# CyberFrog — mappa clean-room di Screaming Frog SEO Spider

Riferimento: Screaming Frog SEO Spider 24.0.0 (macOS arm64), osservato il 2026-10-17.

## Regole clean-room

- Fonti ammesse: documentazione pubblica, uso dell'app come utente, nomi e versioni delle librerie open source incluse (metadati), file esportati dall'app.
- Fonti escluse: bytecode, codice decompilato, risorse interne dell'app (icone, testi UI, file di configurazione proprietari).
- Niente nomi, marchi, testi o grafica di Screaming Frog in CyberFrog.
- Il codice di CyberFrog si scrive solo da questa mappa e da specifiche nostre.

## 1. Stack osservato (dai metadati)

| Area | Cosa usa SF | Indica |
|---|---|---|
| Runtime | Java 25 (JRE incluso), Maven, main `SeoSpider` | App desktop Java autonoma |
| GUI | JavaFX 25, ControlsFX, RichTextFX (flowless/reactfx), NSMenuFX | UI desktop nativa con tabelle grandi |
| HTTP crawl | Apache HttpClient + cache, OkHttp, commons-net | Fetch con cache, retry, proxy |
| Resilienza | resilience4j (circuit breaker), guava-retrying | Retry e limitazione errori |
| Parsing HTML/CSS | jsoup, HtmlCleaner, ph-css | DOM, link, metadati, CSS |
| Rendering JS | `sf-chrome` + Chrome DevTools client, `sf-node` | Chromium headless + Node (Lighthouse/axe) |
| Storage crawl | Apache Derby, SQLite, RoaringBitmap, fastutil, HPPC | Modalità database su disco |
| Ricerca/duplicati | Lucene, MinHash, aho-corasick | Near-duplicates, ricerca nel sorgente |
| Lingua | LanguageTool (~30 lingue), Hunspell, Morfologik, OpenNLP, HanLP, lucene-gosen | Spelling/grammar, leggibilità, CJK |
| Dati strutturati | Apache Jena, RDF4J, Any23, Semargl, Titanium JSON-LD, SHACL/ShEx, OWL API | Estrazione JSON-LD/Microdata/RDFa e validazione |
| Export | Apache POI (xls/xlsx), OpenCSV, commons-csv, PDFBox, jwarc, zip4j | Excel/CSV, testo PDF, archivio WARC |
| Integrazioni Google | API Analytics v3, Search Console, Sheets, Drive, Gmail, OAuth2 | GA, GSC, export Sheets/Drive, email |
| Integrazioni Microsoft | Microsoft Graph, MSAL | Probabile OneDrive/Outlook |
| Server locale | Spring Boot + Tomcat embedded, libreria `mcp` | API locale e server MCP |
| Osservabilità | Micrometer, Prometheus client, OpenTelemetry | Metriche interne |
| Altro | Tika (MIME), ICU4J, Saxon-HE (XPath 3), JNA | Custom extraction XPath, encoding |

Elenco completo: ~400 JAR in `Contents/Java/lib`. Rigenerarlo con:

```bash
ls "/Applications/Screaming Frog SEO Spider.app/Contents/Java/lib"
```

## 2. Feature (da documentazione pubblica)

### Crawling
- Spider breadth-first da URL iniziale; modalità List (lista di URL); modalità Sitemap
- User agent: Googlebot, Bingbot, crawler AI, custom; header custom (cookie, Accept-Language)
- robots.txt: rispetto, download, modifica e test di una versione custom
- Rendering JavaScript con Chromium headless; confronto raw vs rendered (dipendenza da JS)
- Login tramite form; salvataggio HTML raw e rendered; screenshot
- Configurazione: limiti, include/exclude regex, velocità, profondità

### Analisi
- Codici di risposta: 4xx, 5xx, nessuna risposta; link esterni con stato
- Redirect: 3xx, JS, meta refresh, catene, loop; audit migrazioni da lista
- Title e meta description: mancanti, duplicati, lunghi, corti, multipli
- Heading H1/H2: mancanti, duplicati, multipli, fuori sequenza
- Contenuto: word count, leggibilità, pagine poco pertinenti, spelling/grammar
- Duplicati: esatti (MD5), near-duplicates, semantici (embedding), parziali
- Indicizzabilità: meta robots, X-Robots-Tag, canonical (tag e header), rel next/prev
- hreflang: return tag mancanti, codici non validi, target non-200
- URL: non-ASCII, underscore, maiuscole, parametri, lunghezza
- Sicurezza: mixed content, form insicuri, header di sicurezza mancanti
- Immagini: dimensioni, alt mancante, attributi size
- Anchor text: aggregato e per link, anchor non descrittivi
- Dati strutturati: estrazione e validazione schema.org e rich results Google
- AMP, mobile usability (Lighthouse), accessibilità (axe/WCAG)
- Link interni: crawl depth, inlinks/outlinks, Link Score; pagine orfane

### Estrazione
- Custom extraction: XPath, CSS selector, regex
- Ricerca nel sorgente (testo o codice)
- JavaScript custom durante il crawl
- Prompt AI durante il crawl (OpenAI, Gemini, Ollama, Anthropic)

### Output e visualizzazione
- Generazione sitemap XML e immagini
- Diagrammi force-directed e ad albero della struttura
- Issues con tipo e priorità, spiegazione e azione suggerita
- Segmentazione degli URL

### Integrazioni
- Google Analytics, Search Console (Search Analytics + URL Inspection), PageSpeed Insights/CrUX
- Metriche link: Majestic, Ahrefs, Moz
- Looker Studio (report automatici)

### Automazione
- Scheduling di crawl singoli o ricorrenti con export automatico
- CLI e modalità headless
- Confronto tra crawl; confronto staging vs produzione con URL mapping

### Licenza (modello di business)
- Free: limite 500 URL per crawl
- A pagamento: ~€245/anno, nessun limite oltre RAM e disco

## 3. Formati di export e storage

| Tipo | Formati |
|---|---|
| Tabelle (tab, filtri, bulk export, report) | CSV, XLS, XLSX, Google Sheets |
| Limite Sheets | ~5M celle (circa 90k righe per Internal) |
| Solo file locali | screenshot, archivio sito (WARC), sorgente e testo pagina, PDF e testo PDF, sitemap XML, visualizzazioni |
| Dati strutturati | triple RDF |
| Crawl salvati | `.dbseospider` (modalità database), `.seospider` (modalità memoria, importabile in entrambe) |
| Scheduling | file `.task` trasferibili |

Bulk export: inlinks/outlinks, anchor text, link esterni, liste per codice di risposta, sorgente, header HTTP, cookie, dati strutturati, URL Inspection, accessibilità, issues.

Report: panoramica crawl, redirect e catene, canonical, paginazione, 7 report hreflang, contenuti insicuri, riepilogo SERP, pagine orfane, dati strutturati, PageSpeed, log console JS, mobile, accessibilità, riepilogo header HTTP e cookie, crawl path.

Multi-Export: più tab e report in un'azione, salvabili come preset per GUI, scheduling e CLI.

Storage:
- Database (default): su disco, autosave, ~4 GB RAM per ~2M URL
- Memoria (legacy): ~2 GB RAM, 10k–100k URL, salvataggio manuale

## Fonti

- https://www.screamingfrog.co.uk/seo-spider/
- https://www.screamingfrog.co.uk/seo-spider/user-guide/general/
- Nomi dei JAR in `/Applications/Screaming Frog SEO Spider.app/Contents/Java/lib` e `MANIFEST.MF` (solo metadati)
