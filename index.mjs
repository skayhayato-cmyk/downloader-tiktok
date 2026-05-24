import axios         from "axios";
import FormData      from "form-data";
import { CookieJar } from "tough-cookie";
import * as cheerio  from "cheerio";
import vm            from "node:vm";
import crypto        from "node:crypto";
import blessed       from "blessed";
import { spawn }     from "child_process";
import fs            from "node:fs";
import os            from "node:os";
import path          from "node:path";
import https         from "node:https";
import { pipeline }  from "node:stream/promises";
import { createWriteStream } from "node:fs";

const BASE = "https://snaptik.app";
const PAGE = `${BASE}/en2`;
const API  = `${BASE}/abc2.php`;
const LANG = "en2";

const UA =
  "Mozilla/5.0 (Linux; Android 10; K) AppleWebKit/537.36 " +
  "(KHTML, like Gecko) Chrome/147.0.0.0 Mobile Safari/537.36";

const jar = new CookieJar();

function autoToken() {
  const unix = Math.floor(Date.now() / 1000).toString();
  return `ey${Buffer.from(unix).toString("base64")}c`;
}

async function saveCookies(res) {
  for (const c of res.headers["set-cookie"] || [])
    await jar.setCookie(c, BASE);
}

async function getCookieHeader() {
  return jar.getCookieString(BASE);
}

function commonHeaders(extra = {}) {
  return {
    "user-agent"        : UA,
    "accept-language"   : "id-ID,id;q=0.9,en-US;q=0.8,en;q=0.7",
    "sec-ch-ua"         : '"Google Chrome";v="147", "Not.A/Brand";v="8", "Chromium";v="147"',
    "sec-ch-ua-mobile"  : "?1",
    "sec-ch-ua-platform": '"Android"',
    "x-request-id"     : crypto.randomUUID(),
    ...extra
  };
}

function extractToken(html) {
  const $ = cheerio.load(html);
  return $('input[name="token"]').attr("value") || null;
}

async function openHome() {
  const res = await axios.get(PAGE, {
    timeout: 30000,
    validateStatus: () => true,
    headers: commonHeaders({
      accept: "text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8",
      "upgrade-insecure-requests": "1",
      "sec-fetch-site": "none",
      "sec-fetch-mode": "navigate",
      "sec-fetch-user": "?1",
      "sec-fetch-dest": "document"
    })
  });
  await saveCookies(res);
  const html  = String(res.data || "");
  const token = extractToken(html) || autoToken();
  return { status: res.status, token, html };
}

async function submitVideo(url, token) {
  const form = new FormData();
  form.append("url",   url);
  form.append("lang",  LANG);
  form.append("token", token);
  const cookie = await getCookieHeader();
  const res = await axios.post(API, form, {
    timeout: 60000,
    validateStatus: () => true,
    headers: {
      ...commonHeaders({
        accept        : "*/*",
        origin        : BASE,
        referer       : PAGE,
        "sec-fetch-site": "same-origin",
        "sec-fetch-mode": "cors",
        "sec-fetch-dest": "empty",
        priority      : "u=1, i",
        cookie
      }),
      ...form.getHeaders()
    }
  });
  await saveCookies(res);
  return { status: res.status, body: String(res.data || "") };
}

function decodeObfuscatedResponse(body) {
  let decoded = "";
  const context = {
    console, Math, Date, RegExp, String, decodeURIComponent, escape,
    window: { location: { hostname: "snaptik.app" } },
    eval(code) { decoded = String(code || ""); return decoded; }
  };
  try {
    vm.createContext(context);
    vm.runInContext(body, context, { timeout: 3000 });
  } catch {}
  return decoded || body;
}

async function extractResult(decodedJs) {
  const dom       = new Map();
  const fakeDollar = selector => {
    if (!dom.has(selector)) {
      dom.set(selector, {
        innerHTML: "", style: {}, remove() {}, addClass() {},
        removeClass() {}, show() {}, hide() {},
        html(v) { if (v !== undefined) this.innerHTML = String(v); return this.innerHTML; }
      });
    }
    return dom.get(selector);
  };
  const context = {
    console, Math, Date, RegExp, String, setTimeout, clearTimeout,
    document: {
      getElementById() { return { src: "", style: {} }; },
      querySelector()  { return { innerHTML: "", style: {} }; }
    },
    window  : { location: { hostname: "snaptik.app" } },
    gtag()  {},
    fetch   : async () => ({ json: async () => ({}) }),
    $       : fakeDollar
  };
  try {
    vm.createContext(context);
    vm.runInContext(decodedJs, context, { timeout: 3000 });
  } catch {}

  const html  = dom.get("#download")?.innerHTML || decodedJs;
  const $     = cheerio.load(html);
  const links = [];

  $("a[href]").each((_, el) => {
    const text = $(el).text().trim().replace(/\s+/g, " ");
    const href = $(el).attr("href");
    if (!href) return;
    const lc = text.toLowerCase();
    if (lc.includes("download with app"))    return;
    if (lc.includes("download other video")) return;
    if (href === "/")                        return;
    if (href.includes("play.google.com"))    return;
    links.push({ text: text || "Download", url: href });
  });

  return {
    title       : $(".video-title").first().text().trim() || null,
    author      : $(".info span").first().text().trim()   || null,
    thumbnail   : $("#thumbnail").attr("src") || $(".avatar").attr("src") ||
                  $("img").first().attr("src") || null,
    render_token: $(".btn-render").attr("data-token") || null,
    links
  };
}

async function renderVideo(renderToken) {
  if (!renderToken) return null;
  const cookie    = await getCookieHeader();
  const renderRes = await axios.get(`${BASE}/render.php`, {
    timeout: 30000,
    validateStatus: () => true,
    params : { token: renderToken },
    headers: commonHeaders({ accept: "*/*", referer: PAGE, cookie })
  });
  const taskId = renderRes.data?.task_id;
  if (!taskId) return renderRes.data;

  for (let i = 0; i < 30; i++) {
    const poll = await axios.get(`${BASE}/task.php`, {
      timeout: 30000,
      validateStatus: () => true,
      params : { token: taskId },
      headers: commonHeaders({ accept: "*/*", referer: PAGE, cookie: await getCookieHeader() })
    });
    if (poll.data?.download_url) return poll.data;
    if (poll.data?.status !== 0)  return poll.data;
    await new Promise(r => setTimeout(r, 3000));
  }
  return null;
}

async function copyToClipboard(text) {
  const platform = process.platform;
  const errors   = [];
  const tryCmd   = (cmd, args, input) => new Promise((resolve, reject) => {
    const proc = spawn(cmd, args);
    let err = "";
    proc.stdin.write(input);
    proc.stdin.end();
    proc.stderr.on("data", d => { err += d.toString(); });
    proc.on("error", reject);
    proc.on("exit", code =>
      code === 0 ? resolve(true) : reject(new Error(`${cmd} exited ${code}: ${err}`))
    );
  });

  if (platform === "darwin") {
    try { await tryCmd("pbcopy", [], text); return "pbcopy"; } catch (e) { errors.push(`pbcopy: ${e.message}`); }
  } else if (platform === "win32") {
    try { await tryCmd("clip",   [], text); return "clip";   } catch (e) { errors.push(`clip: ${e.message}`); }
  } else {
    // Android / Termux first, then X11
    for (const [cmd, args] of [
      ["termux-clipboard-set", []],
      ["wl-copy",              []],
      ["xclip",                ["-selection", "clipboard"]],
      ["xsel",                 ["--clipboard", "--input"]]
    ]) {
      try { await tryCmd(cmd, args, text); return cmd; } catch (e) { errors.push(`${cmd}: ${e.message}`); }
    }
  }

  try {
    const osc52 = `\x1b]52;c;${Buffer.from(text).toString("base64")}\x07`;
    process.stdout.write(osc52);
    return "osc52";
  } catch (e) { errors.push(`OSC52: ${e.message}`); }

  const tmp = path.join(os.tmpdir(), `tiktok-url-${Date.now()}.txt`);
  fs.writeFileSync(tmp, text, "utf8");
  throw new Error(`Clipboard tools not found. URL saved to:\n${tmp}`);
}

async function directDownload(url, onProgress) {
  const filename = `tiktok_${Date.now()}.mp4`;
  const dest     = path.join(os.homedir(), "Downloads", filename);

  try { fs.mkdirSync(path.dirname(dest), { recursive: true }); } catch {}

  onProgress?.(`Connecting to server…`);

  const res = await axios.get(url, {
    responseType: "stream",
    timeout: 120_000,
    validateStatus: () => true,
    headers: commonHeaders({ referer: BASE })
  });

  const total   = parseInt(res.headers["content-length"] || "0", 10);
  let received  = 0;

  res.data.on("data", chunk => {
    received += chunk.length;
    if (total > 0) {
      const pct = Math.round((received / total) * 100);
      onProgress?.(`Downloading… ${pct}% (${(received / 1024 / 1024).toFixed(1)} MB)`);
    } else {
      onProgress?.(`Downloading… ${(received / 1024 / 1024).toFixed(1)} MB`);
    }
  });

  await pipeline(res.data, createWriteStream(dest));
  return dest;
}

// ═══════════════════════════════════════════════════════════════════════════════
//  BOOT POST MESSAGES
// ═══════════════════════════════════════════════════════════════════════════════

const BOOT_LINES = [
  [40,  "{green-fg}RETRO-DL BIOS v2.0    Copyright (C) 2024 TikTok Downloader Project{/green-fg}"],
  [20,  "{green-fg}═══════════════════════════════════════════════════════════════════{/green-fg}"],
  [20,  ""],
  [160, `{white-fg}CPU Type   :  NodeJS v${process.versions.node}{/white-fg}`],
  [140, `{white-fg}Platform   :  ${process.platform.toUpperCase()} / ${process.arch.toUpperCase()}{/white-fg}`],
  [140, `{white-fg}Base Heap  :  ${Math.round(process.memoryUsage().heapTotal / 1024 / 1024)} MB allocated{/white-fg}`],
  [200, ""],
  [80,  "{yellow-fg}Loading system modules:{/yellow-fg}"],
  [110, "{white-fg}  axios          ···············  {green-fg}[ OK ]{/green-fg}{/white-fg}"],
  [90,  "{white-fg}  cheerio        ···············  {green-fg}[ OK ]{/green-fg}{/white-fg}"],
  [90,  "{white-fg}  tough-cookie   ···············  {green-fg}[ OK ]{/green-fg}{/white-fg}"],
  [90,  "{white-fg}  form-data      ···············  {green-fg}[ OK ]{/green-fg}{/white-fg}"],
  [90,  "{white-fg}  blessed        ···············  {green-fg}[ OK ]{/green-fg}{/white-fg}"],
  [180, ""],
  [120, "{white-fg}Video Display  :  Full-Color CRT Terminal  —  ACTIVE{/white-fg}"],
  [120, "{white-fg}Network Stack  :  SnapTik API Endpoint     —  READY{/white-fg}"],
  [240, ""],
  [80,  "{yellow-fg}Running POST memory test...{/yellow-fg}"],
];

// ═══════════════════════════════════════════════════════════════════════════════
//  MAIN TUI CLASS
// ═══════════════════════════════════════════════════════════════════════════════

class RetroTerminalDownloader {
  constructor() {
    this.screen = blessed.screen({
      smartCSR   : true,
      title      : "TIKTOK-DL v2.0  ::  RETRO TERMINAL",
      mouse      : true,
      cursor     : { artificial: true, shape: "block", blink: true, color: "green" },
      fullUnicode: true
    });

    this.state = {
      processing  : false,
      result      : null,
      selectedLink: 0,
      focus       : "input",
      blinkOn     : true,
    };

    this._timers = [];
    this._showBoot();
  }

  // ── helpers ────────────────────────────────────────────────────────────────

  _sleep(ms) { return new Promise(r => setTimeout(r, ms)); }

  _hline(len = 76) {
    return "{green-fg}" + "─".repeat(len) + "{/green-fg}";
  }

  _buildFkeyBar() {
    const keys = [
      ["F1","DOWNLOAD"],
      ["F2","COPY URL"],
      ["F3","SAVE FILE"],
      ["F4","RESEARCH"],
      ["F9","ABOUT   "],
      ["F10","QUIT   "]
    ];
    return keys.map(([k, lbl]) =>
      `{black-fg}{white-bg}${k}{/white-bg}{/black-fg}` +
      `{black-fg}{cyan-bg}${lbl}{/cyan-bg}{/black-fg}`
    ).join(" ");
  }

  // ── boot POST screen ───────────────────────────────────────────────────────

  async _showBoot() {
    const scr = this.screen;

    const bootBg = blessed.box({
      parent: scr,
      top: 0, left: 0, width: "100%", height: "100%",
      style: { bg: "black" }
    });

    blessed.box({
      parent: bootBg,
      top: 1, left: "center",
      width: 72, height: 7,
      style: { fg: "green", bg: "black" },
      tags: true,
      content: [
        "{green-fg}  ████████╗██╗██╗  ██╗████████╗ ██████╗ ██╗  ██╗   ██████╗ ██╗   {/green-fg}",
        "{green-fg}     ██╔══╝██║██║ ██╔╝╚══██╔══╝██╔═══██╗██║ ██╔╝   ██╔══██╗██║   {/green-fg}",
        "{green-fg}     ██║   ██║█████╔╝    ██║   ██║   ██║█████╔╝    ██║  ██║██║   {/green-fg}",
        "{green-fg}     ██║   ██║██╔══██╗   ██║   ██║   ██║██╔══██╗   ██║  ██║██║   {/green-fg}",
        "{green-fg}     ╚═╝   ╚═╝╚═╝  ╚═╝   ╚═╝    ╚═════╝ ╚═╝  ╚═╝   ╚═════╝╚══════╝{/green-fg}",
        "{yellow-fg}                   [ DOWNLOADER  v2.0 ]  RETRO TERMINAL EDITION        {/yellow-fg}",
        "{green-fg}  ──────────────────────────────────────────────────────────────────  {/green-fg}",
      ].join("\n")
    });

    const bootLog = blessed.log({
      parent: bootBg,
      top: 9, left: 3, width: "100%-6", height: "100%-14",
      style: { fg: "green", bg: "black" },
      tags: true,
      scrollable: true,
      alwaysScroll: true,
    });

    const memBar = blessed.box({
      parent: bootBg,
      bottom: 3, left: 3, width: "100%-6", height: 1,
      style: { fg: "green", bg: "black" },
      tags: true,
      content: ""
    });

    const readyLine = blessed.box({
      parent: bootBg,
      bottom: 1, left: 0, width: "100%", height: 1,
      align: "center",
      style: { fg: "black", bg: "black" },
      tags: true,
      content: ""
    });

    scr.render();

    for (const [delay, msg] of BOOT_LINES) {
      await this._sleep(delay);
      bootLog.log(msg);
      scr.render();
    }

    for (let i = 0; i <= 100; i += 2) {
      const filled = Math.floor(i * 24 / 100);
      const bar    = "█".repeat(filled) + "░".repeat(24 - filled);
      memBar.setContent(
        `{white-fg}Memory Test    : {/white-fg}` +
        `{green-fg}[${bar}] ${String(i).padStart(3)}%{/green-fg}` +
        (i === 100 ? "  {green-fg}── PASS ──{/green-fg}" : "")
      );
      scr.render();
      await this._sleep(22);
    }

    await this._sleep(180);
    memBar.setContent("");
    bootLog.log("{green-fg}Memory Test    :  640K conventional  ──  {white-fg}OK{/white-fg}{/green-fg}");
    bootLog.log("");
    bootLog.log("{green-fg}All systems nominal. Launching interface...{/green-fg}");
    scr.render();
    await this._sleep(350);

    readyLine.style.fg = "black";
    readyLine.style.bg = "green";
    readyLine.setContent("{bold}{black-fg}  System ready. Initializing display adapter...  {/black-fg}{/bold}");
    scr.render();
    await this._sleep(600);

    bootBg.destroy();
    this._initMainUI();
    this._bindKeys();
    this._startClock();
    this._startBlink();

    this._log("{green-fg}System online ─ TikTok Downloader v2.0{/green-fg}");
    this._log("{white-fg}Paste a TikTok URL then press {yellow-fg}[Enter]{/yellow-fg}{white-fg} or {yellow-fg}[F1]{/yellow-fg}{white-fg} to start.{/white-fg}");
    this._log("{cyan-fg}Shortcuts: Ctrl+A=Save  Ctrl+B=Copy  Ctrl+F=Research  Ctrl+H=About  Ctrl+C=Quit{/cyan-fg}");
    this._setStatus("STANDBY", "green");
  }

  // ── main UI ────────────────────────────────────────────────────────────────

  _initMainUI() {
    const scr = this.screen;

    this.root = blessed.box({
      parent: scr,
      top: 0, left: 0, width: "100%", height: "100%",
      style: { bg: "black" }
    });

    // ── Top menu bar ──
    this.menuBar = blessed.box({
      parent: this.root,
      top: 0, left: 0, width: "100%", height: 1,
      style: { fg: "black", bg: "cyan" },
      tags: true,
      content:
        "  {bold}TIKTOK-DL{/bold}  {bold}v2.0{/bold}" +
        "  {bold}│{/bold}  Retro Terminal Edition" +
        "  {bold}│{/bold}  NodeJS " + process.versions.node
    });

    this.clockBox = blessed.box({
      parent: this.root,
      top: 0, right: 0, width: 11, height: 1,
      align: "right",
      style: { fg: "black", bg: "cyan" },
      tags: true,
      content: " 00:00:00 "
    });

    // ── Main outer frame ──
    this.frame = blessed.box({
      parent: this.root,
      top: 1, left: 0, width: "100%", height: "100%-2",
      border: { type: "line" },
      style: { fg: "green", bg: "black", border: { fg: "green" } }
    });

    // ── Title / logo strip ──
    this.titleArea = blessed.box({
      parent: this.frame,
      top: 0, left: 1, width: "100%-2", height: 3,
      style: { fg: "green", bg: "black" },
      tags: true,
      content: [
        " {green-fg}▀█▀ █ █▄▀ ▀█▀ █▀█ █▄▀{/green-fg}  {yellow-fg}◈{/yellow-fg}  {green-fg}█▀▄ █▀█ █░█░█ █▄░█ █░░ █▀█ ▄▀█ █▀▄ █▀▀ █▀█{/green-fg}",
        " {green-fg}░█░ █ █░█  █  █▄█ █░█{/green-fg}  {yellow-fg}◈{/yellow-fg}  {green-fg}█▄▀ █▄█ ▀▄█▄▀ █░▀█ █▄▄ █▄█ █▀█ █▄▀ ██▄ █▀▄{/green-fg}  {white-fg}v2.0{/white-fg}",
        " " + this._hline(76),
      ].join("\n")
    });

    // ── URL input row ──
    this.urlPrompt = blessed.box({
      parent: this.frame,
      top: 4, left: 1, width: 14, height: 1,
      style: { fg: "yellow", bg: "black" },
      tags: true,
      content: "{bold}TARGET URL ▸{/bold}"
    });

    this.inputBox = blessed.textbox({
      parent: this.frame,
      top: 4, left: 15, width: "100%-17", height: 1,
      style: { fg: "green", bg: "black", focus: { fg: "white", bg: "black" } },
      inputOnFocus: true,
      value: "",
      tags: false
    });

    this.inputLine = blessed.box({
      parent: this.frame,
      top: 5, left: 1, width: "100%-2", height: 1,
      style: { fg: "green", bg: "black" },
      tags: true,
      content: " " + this._hline(76)
    });

    // ── Progress row ──
    this.progressPrompt = blessed.box({
      parent: this.frame,
      top: 6, left: 1, width: 12, height: 1,
      style: { fg: "yellow", bg: "black" },
      tags: true,
      content: "{bold}PROGRESS ▸{/bold}"
    });

    this.progressBar = blessed.box({
      parent: this.frame,
      top: 6, left: 13, width: "55%", height: 1,
      style: { fg: "green", bg: "black" },
      tags: true,
      content: "{green-fg}[" + "░".repeat(28) + "]{/green-fg} {white-fg}  0%{/white-fg}"
    });

    this.blinkDot = blessed.box({
      parent: this.frame,
      top: 6, right: 22, width: 2, height: 1,
      style: { fg: "green", bg: "black" },
      tags: true,
      content: "{green-fg}●{/green-fg}"
    });

    this.statusLabel = blessed.box({
      parent: this.frame,
      top: 6, right: 1, width: 20, height: 1,
      align: "right",
      style: { fg: "yellow", bg: "black" },
      tags: true,
      content: "{bold}STANDBY{/bold}"
    });

    this.sep2 = blessed.box({
      parent: this.frame,
      top: 7, left: 1, width: "100%-2", height: 1,
      style: { fg: "green", bg: "black" },
      tags: true,
      content: " " + this._hline(76)
    });

    // ── Column headers (inverted) ──
    this.logHeader = blessed.box({
      parent: this.frame,
      top: 8, left: 1, width: "55%", height: 1,
      align: "center",
      style: { fg: "black", bg: "green" },
      tags: true,
      content: "{bold} ▸ SYSTEM LOG {/bold}"
    });

    this.resultHeader = blessed.box({
      parent: this.frame,
      top: 8, left: "55%+2", width: "44%-3", height: 1,
      align: "center",
      style: { fg: "black", bg: "green" },
      tags: true,
      content: "{bold} ▸ DOWNLOAD LINKS {/bold}"
    });

    // ── Log panel (left column) ──
    this.logPanel = blessed.log({
      parent: this.frame,
      top: 9, left: 1, width: "55%", height: "100%-12",
      style: { fg: "green", bg: "black" },
      tags: true,
      scrollable: true,
      alwaysScroll: true,
      scrollbar: { ch: "│", style: { fg: "green" } }
    });

    // ── Column divider ──
    this.divider = blessed.line({
      parent: this.frame,
      top: 8, left: "55%+1", width: 1, height: "100%-10",
      orientation: "vertical",
      style: { fg: "green", bg: "black" }
    });

    // ── Results panel (right column) ──
    this.resultPanel = blessed.list({
      parent: this.frame,
      top: 9, left: "55%+2", width: "44%-3", height: "100%-12",
      style: {
        fg: "green", bg: "black",
        selected: { fg: "black", bg: "green" }
      },
      tags: true,
      keys: true,
      mouse: true,
      vi: true,
      items: ["{dim-fg}  — no results yet —{/dim-fg}"]
    });

    // ── F-key bar at very bottom ──
    this.fkeyBar = blessed.box({
      parent: this.root,
      bottom: 0, left: 0, width: "100%", height: 1,
      style: { fg: "black", bg: "black" },
      tags: true,
      content: this._buildFkeyBar()
    });

    // initial focus on input
    this.inputBox.focus();
    scr.render();
  }

  // ── bind ALL keyboard shortcuts ────────────────────────────────────────────

  _bindKeys() {
    const scr = this.screen
    
    scr.key(["f1"], () => this._startDownload());
    this.inputBox.key(["enter"], () => this._startDownload());

    scr.key(["C-a", "f3"], () => this._saveSelectedFile());

    scr.key(["C-b", "f2"], () => this._copySelectedUrl());

    scr.key(["C-f", "f4"], () => this._showResearchPanel());

    scr.key(["C-h", "f9"], () => this._showAboutPanel());

    scr.key(["C-c", "f10"], () => this._quit());

    scr.key(["C-l"], () => {
      this.logPanel.setContent("");
      this.screen.render();
    });

    scr.key(["tab"], () => {
      if (this.state.focus === "input") {
        this.state.focus = "results";
        this.resultPanel.focus();
      } else {
        this.state.focus = "input";
        this.inputBox.focus();
      }
      this.screen.render();
    });

    this.resultPanel.on("select item", (_, idx) => {
      this.state.selectedLink = idx;
    });
  }

  _startClock() {
    const tick = () => {
      if (!this.clockBox) return;
      const n   = new Date();
      const pad = v => String(v).padStart(2, "0");
      this.clockBox.setContent(` ${pad(n.getHours())}:${pad(n.getMinutes())}:${pad(n.getSeconds())} `);
      this.screen.render();
    };
    tick();
    const t = setInterval(tick, 1000);
    this._timers.push(t);
  }

  _startBlink() {
    const t = setInterval(() => {
      if (!this.blinkDot) return;
      this.state.blinkOn = !this.state.blinkOn;
      const col = this.state.blinkOn
        ? (this.state.processing ? "yellow" : "green")
        : "black";
      this.blinkDot.setContent(`{${col}-fg}●{/${col}-fg}`);
      this.screen.render();
    }, 600);
    this._timers.push(t);
  }

  _log(msg) {
    const ts = new Date().toLocaleTimeString("id-ID", { hour12: false });
    this.logPanel.log(`{dim-fg}[${ts}]{/dim-fg} ${msg}`);
    this.screen.render();
  }

  _setStatus(label, color = "yellow") {
    this.statusLabel.setContent(`{bold}{${color}-fg}${label}{/${color}-fg}{/bold}`);
    this.screen.render();
  }

  _setProgress(pct, label = "") {
    const filled = Math.floor(pct * 28 / 100);
    const bar    = "█".repeat(filled) + "░".repeat(28 - filled);
    const pctStr = String(pct).padStart(3);
    const extra  = label ? `  {white-fg}${label}{/white-fg}` : "";
    this.progressBar.setContent(
      `{green-fg}[${bar}]{/green-fg} {yellow-fg}${pctStr}%{/yellow-fg}${extra}`
    );
    this.screen.render();
  }

  _updateResultPanel() {
    const r = this.state.result;
    if (!r || !r.links?.length) {
      this.resultPanel.setItems(["{dim-fg}  — no links found —{/dim-fg}"]);
      this.screen.render();
      return;
    }
    const items = r.links.map((l, i) => {
      const num  = `{yellow-fg}[${i + 1}]{/yellow-fg}`;
      const label = l.text.length > 22 ? l.text.slice(0, 20) + "…" : l.text;
      return ` ${num} {green-fg}${label}{/green-fg}`;
    });
    this.resultPanel.setItems(items);
    this.resultPanel.select(0);
    this.state.selectedLink = 0;
    this.screen.render();
  }

  async _startDownload() {
    if (this.state.processing) {
      this._log("{yellow-fg}Already processing, please wait…{/yellow-fg}");
      return;
    }

    const url = this.inputBox.getValue().trim();
    if (!url) {
      this._log("{red-fg}✖ No URL entered. Paste a TikTok link first.{/red-fg}");
      return;
    }
    if (!url.includes("tiktok.com") && !url.includes("vm.tiktok") && !url.includes("vt.tiktok")) {
      this._log("{red-fg}✖ URL does not look like a TikTok link.{/red-fg}");
      return;
    }

    this.state.processing = true;
    this.state.result     = null;
    this._setStatus("WORKING", "yellow");
    this._setProgress(0);
    this.resultPanel.setItems(["{dim-fg}  Fetching…{/dim-fg}"]);
    this.screen.render();

    try {
      this._log("{cyan-fg}→ Opening SnapTik homepage…{/cyan-fg}");
      this._setProgress(10);
      const { token } = await openHome();

      this._log(`{cyan-fg}→ Token acquired: {/cyan-fg}{white-fg}${token.slice(0, 20)}…{/white-fg}`);
      this._setProgress(30);

      this._log("{cyan-fg}→ Submitting video URL to API…{/cyan-fg}");
      const { body } = await submitVideo(url, token);
      this._setProgress(55);

      this._log("{cyan-fg}→ Decoding obfuscated response…{/cyan-fg}");
      const decoded = decodeObfuscatedResponse(body);
      this._setProgress(70);

      this._log("{cyan-fg}→ Extracting download links…{/cyan-fg}");
      const result = await extractResult(decoded);
      this._setProgress(90);

      if (result.render_token) {
        this._log("{cyan-fg}→ Render token found, rendering…{/cyan-fg}");
        const rendered = await renderVideo(result.render_token);
        if (rendered?.download_url)
          result.links.unshift({ text: "No Watermark (rendered)", url: rendered.download_url });
      }

      this.state.result = result;
      this._setProgress(100);
      this._updateResultPanel();

      if (result.title)  this._log(`{white-fg}Title  : {/white-fg}{green-fg}${result.title}{/green-fg}`);
      if (result.author) this._log(`{white-fg}Author : {/white-fg}{cyan-fg}${result.author}{/cyan-fg}`);
      this._log(`{green-fg}✔ Found {/green-fg}{yellow-fg}${result.links.length}{/yellow-fg}{green-fg} download link(s). Use ↑↓ then Ctrl+A to save or Ctrl+B to copy URL.{/green-fg}`);
      this._setStatus("DONE", "green");

    } catch (err) {
      this._log(`{red-fg}✖ Error: ${err.message}{/red-fg}`);
      this._setStatus("ERROR", "red");
      this._setProgress(0);
    } finally {
      this.state.processing = false;
    }
  }

  async _saveSelectedFile() {
    const links = this.state.result?.links;
    if (!links?.length) {
      this._log("{red-fg}✖ No download links. Run a download first.{/red-fg}");
      return;
    }
    if (this.state.processing) {
      this._log("{yellow-fg}⚠ Already processing.{/yellow-fg}");
      return;
    }

    const idx  = this.state.selectedLink;
    const link = links[idx];
    if (!link) {
      this._log("{red-fg}✖ No link selected.{/red-fg}");
      return;
    }

    this.state.processing = true;
    this._setStatus("SAVING", "yellow");
    this._log(`{cyan-fg}→ Downloading: {/cyan-fg}{white-fg}${link.text}{/white-fg}`);
    this._setProgress(0);

    try {
      const dest = await directDownload(link.url, msg => {
        this._log(`{dim-fg}  ${msg}{/dim-fg}`);
        const m = msg.match(/(\d+)%/);
        if (m) this._setProgress(parseInt(m[1], 10));
      });

      this._setProgress(100);
      this._log(`{green-fg}✔ Saved to: {/green-fg}{white-fg}${dest}{/white-fg}`);
      this._setStatus("SAVED", "green");
    } catch (err) {
      this._log(`{red-fg}✖ Save failed: ${err.message}{/red-fg}`);
      this._setStatus("ERROR", "red");
      this._setProgress(0);
    } finally {
      this.state.processing = false;
    }
  }

  async _copySelectedUrl() {
    const links = this.state.result?.links;
    if (!links?.length) {
      this._log("{red-fg}✖ No links available. Download something first.{/red-fg}");
      return;
    }

    const idx  = this.state.selectedLink;
    const link = links[idx];
    if (!link) {
      this._log("{red-fg}✖ No link selected.{/red-fg}");
      return;
    }

    try {
      const method = await copyToClipboard(link.url);
      this._log(`{green-fg}✔ Copied to clipboard via {/green-fg}{cyan-fg}${method}{/cyan-fg}`);
      this._log(`{dim-fg}  ${link.url.slice(0, 70)}…{/dim-fg}`);
    } catch (err) {
      this._log(`{red-fg}✖ Clipboard error: ${err.message}{/red-fg}`);
    }
  }

  _showResearchPanel() {
    const scr   = this.screen;

    const overlay = blessed.box({
      parent: scr,
      top: "center", left: "center",
      width: 72, height: 20,
      border: { type: "line" },
      style: { fg: "green", bg: "black", border: { fg: "cyan" } },
      tags: true,
      label: " {bold}{cyan-fg} RESEARCH / SEARCH {/cyan-fg}{/bold} ",
      shadow: true
    });

    blessed.box({
      parent: overlay,
      top: 0, left: 1, width: "100%-2", height: 2,
      style: { fg: "yellow", bg: "black" },
      tags: true,
      content: "{bold}Search query:{/bold}"
    });

    const searchBox = blessed.textbox({
      parent: overlay,
      top: 2, left: 1, width: "100%-6", height: 1,
      style: { fg: "white", bg: "black", focus: { fg: "white", bg: "black" } },
      inputOnFocus: true,
      border: { type: "line" },
      keys: true
    });

    const resultLog = blessed.log({
      parent: overlay,
      top: 4, left: 1, width: "100%-2", height: 11,
      style: { fg: "green", bg: "black" },
      tags: true,
      scrollable: true,
      alwaysScroll: true,
      scrollbar: { ch: "│", style: { fg: "green" } }
    });

    blessed.box({
      parent: overlay,
      bottom: 0, left: 0, width: "100%", height: 1,
      style: { fg: "black", bg: "cyan" },
      tags: true,
      content: "  {bold}Enter{/bold} = Search   {bold}Esc{/bold} = Close   {bold}Ctrl+F{/bold} = Close"
    });

    resultLog.log("{dim-fg}Type a TikTok username or keyword then press Enter.{/dim-fg}");
    resultLog.log("{dim-fg}Results will open search engines below.{/dim-fg}");
    resultLog.log("");
    resultLog.log("{white-fg}Quick links (press number to open):{/white-fg}");
    resultLog.log("{cyan-fg}  1{/cyan-fg} {white-fg}TikTok Search     https://www.tiktok.com/search{/white-fg}");
    resultLog.log("{cyan-fg}  2{/cyan-fg} {white-fg}SnapTik           https://snaptik.app{/white-fg}");
    resultLog.log("{cyan-fg}  3{/cyan-fg} {white-fg}SaveTok           https://savetok.app{/white-fg}");

    const openUrl = url => {
      const openers = {
        linux  : ["xdg-open", [url]],
        darwin : ["open",     [url]],
        win32  : ["cmd",      ["/c", "start", url]],
        android: ["termux-open-url", [url]]
      };
      const [cmd, args] = openers[process.platform] || openers.linux;
      spawn(cmd, args, { detached: true, stdio: "ignore" }).unref();
    };

    searchBox.key(["enter"], () => {
      const q = searchBox.getValue().trim();
      if (!q) return;
      resultLog.log(`{yellow-fg}→ Searching: {/yellow-fg}{white-fg}${q}{/white-fg}`);
      const url = `https://www.google.com/search?q=${encodeURIComponent("TikTok " + q)}`;
      resultLog.log(`{cyan-fg}  Opening: ${url}{/cyan-fg}`);
      try { openUrl(url); resultLog.log("{green-fg}  ✔ Browser launched.{/green-fg}"); }
      catch { resultLog.log("{red-fg}  ✖ Could not open browser.{/red-fg}"); }
      scr.render();
    });

    const closePanel = () => {
      overlay.destroy();
      this.inputBox.focus();
      scr.render();
    };

    overlay.key(["escape", "C-f"], closePanel);
    searchBox.key(["escape"], closePanel);

    searchBox.focus();
    scr.render();
  }

  _showAboutPanel() {
    const scr = this.screen;

    const overlay = blessed.box({
      parent: scr,
      top: "center", left: "center",
      width: 72, height: 26,
      border: { type: "line" },
      style: { fg: "green", bg: "black", border: { fg: "yellow" } },
      tags: true,
      label: " {bold}{yellow-fg} ABOUT / HELP {/yellow-fg}{/bold} ",
      shadow: true
    });

    overlay.setContent([
      "",
      " {yellow-fg}╔═══════════════════════════════════════════════════════════════╗{/yellow-fg}",
      " {yellow-fg}║{/yellow-fg}  {green-fg}{bold}TikTok Downloader{/bold}{/green-fg}           {yellow-fg}║{/yellow-fg}",
      " {yellow-fg}╚═══════════════════════════════════════════════════════════════╝{/yellow-fg}",
      "",
      "  {white-fg}Author   :{/white-fg} {cyan-fg}acu{/cyan-fg}",
      "  {white-fg}License  :{/white-fg} {green-fg}MIT{/green-fg}",
      "  {white-fg}Runtime  :{/white-fg} {green-fg}NodeJS v" + process.versions.node + "{/green-fg}",
      "  {white-fg}Platform :{/white-fg} {green-fg}" + process.platform + " / " + process.arch + "{/green-fg}",
      "  {white-fg}Backend  :{/white-fg} {green-fg}SnapTik API  (snaptik.app){/green-fg}",
      "",
      " {green-fg}─────────────────────  KEYBOARD SHORTCUTS  ──────────────────────{/green-fg}",
      "",
      "  {yellow-fg}Ctrl+A {/yellow-fg} / {yellow-fg}F3 {/yellow-fg}  {white-fg}Download selected link → ~/Downloads{/white-fg}",
      "  {yellow-fg}Ctrl+B {/yellow-fg} / {yellow-fg}F2 {/yellow-fg}  {white-fg}Copy selected URL to clipboard{/white-fg}",
      "  {yellow-fg}Ctrl+F {/yellow-fg} / {yellow-fg}F4 {/yellow-fg}  {white-fg}Open Research / search panel{/white-fg}",
      "  {yellow-fg}Ctrl+H {/yellow-fg} / {yellow-fg}F9 {/yellow-fg}  {white-fg}Show this About panel{/white-fg}",
      "  {yellow-fg}Ctrl+C {/yellow-fg} / {yellow-fg}F10{/yellow-fg}  {white-fg}Quit application{/white-fg}",
      "  {yellow-fg}Ctrl+L {/yellow-fg}         {white-fg}Clear log panel{/white-fg}",
      "  {yellow-fg}Tab    {/yellow-fg}         {white-fg}Toggle focus: input ↔ link list{/white-fg}",
      "  {yellow-fg}↑ / ↓  {/yellow-fg}         {white-fg}Navigate download links{/white-fg}",
      "  {yellow-fg}F1 / Enter{/yellow-fg}      {white-fg}Start download{/white-fg}",
      "",
    ].join("\n"));

    blessed.box({
      parent: overlay,
      bottom: 0, left: 0, width: "100%", height: 1,
      style: { fg: "black", bg: "yellow" },
      tags: true,
      content: "  {bold}Press any key or Esc to close{/bold}"
    });

    const close = () => {
      overlay.destroy();
      this.inputBox.focus();
      scr.render();
    };

    overlay.key(["escape", "enter", "space", "C-h", "q"], close);
    overlay.focus();
    scr.render();
  }

  _quit() {
    this._timers.forEach(t => clearInterval(t));

    this.screen.destroy();

    console.log("\x1b[32m");
    console.log("  ┌─────────────────────────────────────────┐");
    console.log("  │   TikTok Downloader    │");
    console.log("  │       By Nexa Dev      │");
    console.log("  └─────────────────────────────────────────┘");
    console.log("\x1b[0m");
    process.exit(0);
  }
}

// ── entry point ───────────────────────────────────────────────────────────────
new RetroTerminalDownloader();
