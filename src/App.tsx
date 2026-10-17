// App shell: crawl state and actions, header, start screen or reports, dialogs and the status bar.
import { useCallback, useEffect, useMemo, useState, type FormEvent } from "react";
import { Channel, invoke } from "@tauri-apps/api/core";
import { open, save } from "@tauri-apps/plugin-dialog";
import { openUrl } from "@tauri-apps/plugin-opener";
import cyberzecShield from "./assets/cyberzec-shield.png";
import cyberfrogLogo from "./assets/cyberfrog-logo.png";
import { SettingsDialog } from "./SettingsDialog";
import { ListDialog, countUrls } from "./ListDialog";
import { SchedulesDialog } from "./SchedulesDialog";
import { CommandPalette, type Command } from "./CommandPalette";
import { CrawlForm, type Mode } from "./CrawlForm";
import { Menu } from "./Menu";
import { Reports, type Jump } from "./Reports";
import { RunningScreen, StartScreen } from "./StartScreen";
import { Sidebar } from "./Sidebar";
import { GearIcon, MoreIcon, SearchIcon } from "./icons";
import { isAiReady, type AiStatus } from "./AiSettings";
import { loadSettings, saveSettings, type Settings } from "./settings";
import { EMPTY_CRAWL, STAGE_LABEL, hostOf, type CrawlData, type CrawlSummary, type Progress } from "./crawl";
import { useAnalysis } from "./useAnalysis";
import { TABS, type Tab } from "./nav";
import { buildSitemapXml, type CrawlSnapshot } from "./pages";
import { LANG, LOCALE, setLang, tr, trError } from "./i18n";
import "./App.css";

const SQLITE_FILTER = [{ name: "Crawl CyberFrog", extensions: ["sqlite"] }];
const fmt = new Intl.NumberFormat(LOCALE, { maximumFractionDigits: 1 });
const IS_MAC = navigator.platform.toUpperCase().includes("MAC");

export default function App() {
  const [crawl, setCrawl] = useState<CrawlData>(EMPTY_CRAWL);
  const [url, setUrl] = useState("https://");
  const [selected, setSelected] = useState<string | null>(null);
  /** Crawl file the current crawl is compared with, and its loaded data. */
  const [baseline, setBaseline] = useState<string | null>(null);
  const [baselineData, setBaselineData] = useState<CrawlSnapshot | null>(null);
  const [recent, setRecent] = useState<CrawlSummary[]>([]);
  const [progress, setProgress] = useState<Progress | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [running, setRunning] = useState(false);
  /** The user pressed Stop during the last crawl. */
  const [stopped, setStopped] = useState(false);
  const [elapsed, setElapsed] = useState<number | null>(null);
  const [tab, setTab] = useState<Tab>("overview");
  const [jump, setJump] = useState<Jump>({ tab: null, filter: null, seq: 0 });
  const [settings, setSettings] = useState<Settings>(loadSettings);
  const [mode, setMode] = useState<Mode>("spider");
  const [listText, setListText] = useState("");
  const [dialog, setDialog] = useState<"settings" | "list" | "schedules" | "palette" | null>(null);
  const [aiStatus, setAiStatus] = useState<AiStatus>({ has_key: false, claude_code: null });
  const listCount = countUrls(listText);
  const hasCrawl = crawl.pages.length > 0;
  // duplicates compare every pair of pages, so only where they're shown
  const a = useAnalysis(crawl, tab === "duplicates" || tab === "issues");

  const refreshAi = useCallback(() => {
    invoke<AiStatus>("ai_status").then(setAiStatus, () => setAiStatus({ has_key: false, claude_code: null }));
  }, []);
  useEffect(refreshAi, [refreshAi]);
  const refreshRecent = useCallback(() => {
    invoke<CrawlSummary[]>("list_crawls").then(setRecent, () => setRecent([]));
  }, []);
  useEffect(refreshRecent, [refreshRecent]);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if ((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === "k") {
        e.preventDefault();
        setDialog((d) => (d === "palette" ? null : "palette"));
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, []);

  useEffect(() => {
    setBaselineData(null);
    if (!baseline) return;
    let current = true; // a newer choice may land first
    invoke<CrawlData>("open_crawl", { path: baseline }).then(
      (d) => current && setBaselineData(d),
      (err) => current && setError(trError(String(err))),
    );
    return () => {
      current = false;
    };
  }, [baseline]);

  const go = useCallback((t: Tab, filter: string | null = null) => {
    setTab(t);
    setJump((j) => ({ tab: filter ? t : null, filter, seq: j.seq + 1 }));
  }, []);

  function show(data: CrawlData) {
    setCrawl({ ...EMPTY_CRAWL, ...data });
    setSelected(null);
    go("overview");
    if (data.pages[0]) setUrl(data.pages[0].url);
    pickBaseline(data);
  }

  function newCrawl() {
    setCrawl(EMPTY_CRAWL);
    setSelected(null);
    setBaseline(null);
    setError(null);
    setNotice(null);
    setElapsed(null);
    refreshRecent();
  }

  /** Compare with the latest earlier crawl of the same host, like an automatic crawl comparison. */
  function pickBaseline(data: CrawlData) {
    setBaseline(null);
    const host = hostOf(data.pages[0]?.url);
    invoke<CrawlSummary[]>("list_crawls").then(
      (list) => {
        setRecent(list);
        const self = list.find((c) => c.path === data.path);
        const earlier = list.find(
          (c) => c.path !== data.path && hostOf(c.start_url) === host && (!self || c.modified_ms < self.modified_ms),
        );
        setBaseline(earlier?.path ?? null);
      },
      () => setRecent([]),
    );
  }

  async function start(e: FormEvent) {
    e.preventDefault();
    if (mode === "list" && listCount === 0) {
      setDialog("list");
      return;
    }
    setRunning(true);
    setError(null);
    setNotice(null);
    setElapsed(null);
    setStopped(false);
    setProgress({ stage: "pages", done: 0, pending: 1 });
    const onProgress = new Channel<Progress>();
    onProgress.onmessage = setProgress;
    const t0 = performance.now();
    try {
      const list = mode === "list" ? listText : null;
      const data = await invoke<CrawlData>("start_crawl", { url, settings, list, onProgress });
      show(data);
      setElapsed((performance.now() - t0) / 1000);
      // a low limit saved by mistake looks like a broken crawl, so say why it stopped
      if (data.pages.length >= settings.max_urls)
        setNotice(tr("Crawl fermato al limite di {n} URL impostato: puoi alzarlo in Impostazioni.", { n: settings.max_urls.toLocaleString(LOCALE) }));
    } catch (err) {
      setError(trError(String(err)));
    } finally {
      setRunning(false);
      setProgress(null);
    }
  }

  function stopCrawl() {
    setStopped(true);
    invoke("stop_crawl").catch((err) => setError(trError(String(err))));
  }

  async function openCrawl(path?: string) {
    setError(null);
    setNotice(null);
    const picked = path ?? (await open({ multiple: false, directory: false, filters: SQLITE_FILTER }));
    if (typeof picked !== "string") return;
    try {
      show(await invoke<CrawlData>("open_crawl", { path: picked }));
      setElapsed(null);
    } catch (err) {
      setError(trError(String(err)));
    }
  }

  /** Writes a file chosen in the native save dialog and reports where it went. */
  async function saveAs(defaultPath: string, filters: { name: string; extensions: string[] }[], write: (to: string) => Promise<unknown>, done: string) {
    setError(null);
    setNotice(null);
    const to = await save({ defaultPath, filters });
    if (!to) return;
    try {
      await write(to);
      setNotice(tr(done, { path: to }));
    } catch (err) {
      setError(trError(String(err)));
    }
  }
  const saveSitemap = () =>
    saveAs("sitemap.xml", [{ name: "Sitemap XML", extensions: ["xml"] }], (to) => invoke("write_text_file", { path: to, contents: buildSitemapXml(crawl.pages) }), "Sitemap salvata in {path}");
  const saveCrawlAs = () => saveAs(`${a.host}.sqlite`, SQLITE_FILTER, (to) => invoke("save_crawl_as", { from: crawl.path, to }), "Crawl salvato in {path}");
  const switchLang = () => setLang(LANG === "it" ? "en" : "it");
  const otherLang = LANG === "it" ? "English" : "Italiano";

  const reportCommands = useMemo(
    (): Command[] =>
      hasCrawl
        ? [
            ...TABS.map((t) => ({ id: `tab:${t.id}`, group: tr("Report"), label: t.label, run: () => go(t.id) })),
            ...a.issues.map((i) => ({
              id: `issue:${i.tab}:${i.filter}`,
              group: tr("Problemi"),
              label: i.label,
              hint: tr("{n} URL", { n: i.count.toLocaleString(LOCALE) }),
              run: () => go(i.tab as Tab, i.filter),
            })),
          ]
        : [],
    [hasCrawl, a.issues, go],
  );
  const actionCommands: Command[] = [
    { id: "new", group: tr("Azioni"), label: tr("Nuova scansione"), run: newCrawl },
    { id: "open", group: tr("Azioni"), label: tr("Apri crawl…"), run: () => openCrawl() },
    ...(hasCrawl ? [{ id: "save", group: tr("Azioni"), label: tr("Salva crawl come…"), run: saveCrawlAs }] : []),
    { id: "schedule", group: tr("Azioni"), label: tr("Crawl pianificati…"), run: () => setDialog("schedules") },
    { id: "settings", group: tr("Azioni"), label: tr("Impostazioni"), run: () => setDialog("settings") },
    { id: "lang", group: tr("Azioni"), label: tr("Lingua: {lang}", { lang: otherLang }), run: switchLang },
  ];

  const form = {
    mode,
    onMode: setMode,
    url,
    onUrl: setUrl,
    listCount,
    onEditList: () => setDialog("list"),
    running,
    stopped,
    onStart: start,
    onStop: stopCrawl,
  };
  const statusText = running
    ? `${STAGE_LABEL[progress?.stage ?? "pages"]}: ${(progress?.done ?? 0).toLocaleString(LOCALE)}` +
      (progress && progress.pending > 0 ? tr(" · {n} in coda", { n: progress.pending.toLocaleString(LOCALE) }) : "")
    : hasCrawl
      ? tr("{n} URL · {host}", { n: crawl.pages.length.toLocaleString(LOCALE), host: a.host }) +
        (elapsed !== null ? tr(stopped ? " · interrotto dopo {s} s" : " · completato in {s} s", { s: fmt.format(elapsed) }) : "")
      : tr("Pronto");

  return (
    <main className="app">
      <header className="toolbar">
        <button type="button" className="brand" onClick={newCrawl} disabled={running} title={tr("Nuova scansione")}>
          <img className="logo" src={cyberfrogLogo} alt="" width={30} height={30} />
          <span className="brand-text">
            CyberFrog
            <small>Another SEO Tool</small>
          </span>
        </button>
        {hasCrawl || running ? <CrawlForm {...form} /> : <span className="spacer" />}
        <div className="tools">
          <button type="button" className="search-btn" onClick={() => setDialog("palette")}>
            <SearchIcon size={14} />
            <span>{tr("Cerca")}</span>
            <kbd>{IS_MAC ? "⌘K" : "Ctrl K"}</kbd>
          </button>
          <button type="button" className="icon-btn" onClick={() => setDialog("settings")} disabled={running} aria-label={tr("Impostazioni")} title={tr("Impostazioni")}>
            <GearIcon />
          </button>
          <Menu
            label={tr("Altro")}
            icon={<MoreIcon />}
            items={[
              { label: tr("Nuova scansione"), onSelect: newCrawl, disabled: running },
              { label: tr("Apri crawl…"), onSelect: () => openCrawl(), disabled: running },
              { label: tr("Salva crawl come…"), onSelect: saveCrawlAs, disabled: running || !hasCrawl },
              "separator",
              { label: tr("Crawl pianificati…"), onSelect: () => setDialog("schedules") },
              "separator",
              { label: tr("Lingua: {lang}", { lang: otherLang }), onSelect: switchLang, disabled: running },
            ]}
          />
        </div>
      </header>
      <div className={`progress ${running ? "on" : ""}`} aria-hidden />

      <CommandPalette open={dialog === "palette"} onClose={() => setDialog(null)} commands={[...reportCommands, ...actionCommands]} />
      <SchedulesDialog open={dialog === "schedules"} url={url} settings={settings} onClose={() => setDialog(null)} />
      <ListDialog
        open={dialog === "list"}
        text={listText}
        onSave={(t) => {
          setListText(t);
          setDialog(null);
        }}
        onClose={() => setDialog(null)}
      />
      <SettingsDialog
        open={dialog === "settings"}
        settings={settings}
        onSave={(s) => {
          setSettings(s);
          saveSettings(s);
          setDialog(null);
        }}
        onClose={() => setDialog(null)}
        aiStatus={aiStatus}
        onAiStatusChange={refreshAi}
      />

      {error && (
        <p className="error" role="alert">
          {error}
        </p>
      )}
      {notice && (
        <p className="notice" role="status">
          {notice}
        </p>
      )}

      {running ? (
        <RunningScreen progress={progress} />
      ) : !hasCrawl ? (
        <StartScreen form={form} recent={recent} onOpen={(p) => openCrawl(p)} onBrowse={() => openCrawl()} />
      ) : (
        <div className="main">
          <Sidebar tab={tab} issues={a.issues} onSelect={(t) => go(t)} />
          <Reports
            tab={tab}
            jump={jump}
            go={go}
            crawl={crawl}
            a={a}
            selected={selected}
            select={setSelected}
            baseline={baseline}
            baselineData={baselineData}
            setBaseline={setBaseline}
            recent={recent}
            aiEngine={settings.ai_engine}
            aiReady={isAiReady(settings.ai_engine, aiStatus)}
            onSaveSitemap={saveSitemap}
          />
        </div>
      )}
      <footer className="statusbar">
        <span role="status">{statusText}</span>
        <button type="button" className="powered" onClick={() => openUrl("https://cyberzec.it")}>
          {tr("Powered by")}
          <img src={cyberzecShield} alt="" width={18} height={18} />
          <strong>Daniele Zecca – CyberZec</strong>
        </button>
      </footer>
    </main>
  );
}
