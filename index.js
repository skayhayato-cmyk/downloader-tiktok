#!/usr/bin/env node

/**
 * ╔══════════════════════════════════════════════════════════════════════════════╗
 * ║  TikTok Downloader v2.0 — RETRO TERMINAL EDITION                          ║
 * ║  CRT Phosphor Green  •  Norton Commander Style  •  Old School BIOS         ║
 * ╚══════════════════════════════════════════════════════════════════════════════╝
 *
 *  Controls:
 *    F1 / Enter   → Download
 *    F2 / Ctrl+A  → Copy selected URL to clipboard
 *    F3 / Ctrl+R  → Reset form
 *    F10 / Ctrl+Q → Quit
 *    Tab          → Toggle focus (input ↔ links)
 *    ↑ / ↓        → Select download link
 */

import axios      from "axios";
import FormData   from "form-data";
import { CookieJar } from "tough-cookie";
import * as cheerio  from "cheerio";
import vm         from "node:vm";
import crypto     from "node:crypto";
import blessed    from "blessed";
import { spawn }  from "child_process";
import fs         from "node:fs";
import os         from "node:os";
import path       from "node:path";

const BASE = "https://snaptik.app";
const PAGE = `${BASE}/en2`;
const API  = `${BASE}/abc2.php`;
const LANG = "en2";

const UA =
  "Mozilla/5.0 (Linux; Android 10; K) AppleWebKit/537.36 " +
  "(KHTML, like Gecko) Chrome/147.0.0.0 Mobile Safari/537.36";

const jar = new CookieJar();

// ═══════════════════════════════════════════════════════════════════════════════
//  SNAPTIK API FUNCTIONS  (unchanged)
// ═══════════════════════════════════════════════════════════════════════════════

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
    "user-agent"       : UA,
    "accept-language"  : "id-ID,id;q=0.9,en-US;q=0.8,en;q=0.7",
    "sec-ch-ua"        : '"Google Chrome";v="147", "Not.A/Brand";v="8", "Chromium";v="147"',
    "sec-ch-ua-mobile" : "?1",
    "sec-ch-ua-platform": '"Android"',
    "x-request-id"    : crypto.randomUUID(),
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
        accept: "*/*",
        origin: BASE,
        referer: PAGE,
        "sec-fetch-site": "same-origin",
        "sec-fetch-mode": "cors",
        "sec-fetch-dest": "empty",
        priority: "u=1, i",
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
  const dom = new Map();
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
    window: { location: { hostname: "snaptik.app" } },
    gtag() {},
    fetch: async () => ({ json: async () => ({}) }),
    $: fakeDollar
  };
  try {
    vm.createContext(context);
    vm.runInContext(decodedJs, context, { timeout: 3000 });
  } catch {}

  const html = dom.get("#download")?.innerHTML || decodedJs;
  const $    = cheerio.load(html);
  const links = [];

  $("a[href]").each((_, el) => {
    const text = $(el).text().trim().replace(/\s+/g, " ");
    const href = $(el).attr("href");
    if (!href) return;
    const lc = text.toLowerCase();
    if (lc.includes("download with app"))     return;
    if (lc.includes("download other video"))  return;
    if (href === "/")                          return;
    if (href.includes("play.google.com"))      return;
    links.push({ text: text || "Download", url: href });
  });

  return {
    title     : $(".video-title").first().text().trim() || null,
    author    : $(".info span").first().text().trim()   || null,
    thumbnail : $("#thumbnail").attr("src") || $(".avatar").attr("src") ||
                $("img").first().attr("src") || null,
    render_token: $(".btn-render").attr("data-token") || null,
    links
  };
}

async function renderVideo(renderToken) {
  if (!renderToken) return null;
  const cookie = await getCookieHeader();
  const renderRes = await axios.get(`${BASE}/render.php`, {
    timeout: 30000,
    validateStatus: () => true,
    params: { token: renderToken },
    headers: commonHeaders({ accept: "*/*", referer: PAGE, cookie })
  });
  const taskId = renderRes.data?.task_id;
  if (!taskId) return renderRes.data;

  for (let i = 0; i < 30; i++) {
    const poll = await axios.get(`${BASE}/task.php`, {
      timeout: 30000,
      validateStatus: () => true,
      params: { token: taskId },
      headers: commonHeaders({ accept: "*/*", referer: PAGE, cookie: await getCookieHeader() })
    });
    if (poll.data?.download_url) return poll.data;
    if (poll.data?.status !== 0)  return poll.data;
    await new Promise(r => setTimeout(r, 3000));
  }
  return null;
}

// ═══════════════════════════════════════════════════════════════════════════════
//  CLIPBOARD  (multiple fallback methods)
// ═══════════════════════════════════════════════════════════════════════════════

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
    proc.on("exit", code => code === 0 ? resolve(true) : reject(new Error(`${cmd} exited ${code}: ${err}`)));
  });

  if (platform === "darwin") {
    try { await tryCmd("pbcopy", [], text); return; } catch (e) { errors.push(`pbcopy: ${e.message}`); }
  } else if (platform === "win32") {
    try { await tryCmd("clip", [], text); return; } catch (e) { errors.push(`clip: ${e.message}`); }
  } else {
    for (const [cmd, args] of [
      ["wl-copy", []], ["xclip", ["-selection","clipboard"]],
      ["xsel", ["--clipboard","--input"]], ["termux-clipboard-set", []]
    ]) {
      try { await tryCmd(cmd, args, text); return; } catch (e) { errors.push(`${cmd}: ${e.message}`); }
    }
  }

  try {
    const osc52 = `\x1b]52;c;${Buffer.from(text).toString("base64")}\x07`;
    process.stdout.write(osc52);
    return;
  } catch (e) { errors.push(`OSC52: ${e.message}`); }

  try {
    const tmp = path.join(os.tmpdir(), `tiktok-url-${Date.now()}.txt`);
    fs.writeFileSync(tmp, text, "utf8");
    throw new Error(`Clipboard tools not found. URL saved to: ${tmp}`);
  } catch (e) {
    if (e.message.includes("saved to")) throw e;
    errors.push(`tempfile: ${e.message}`);
  }

  throw new Error(
    `Clipboard failed.\n${errors.map(e => "  • " + e).join("\n")}\n\n` +
    "Install: xclip / xsel / wl-copy (Linux) | pbcopy (Mac) | clip (Windows)"
  );
}

// ═══════════════════════════════════════════════════════════════════════════════
//  RETRO TERMINAL DOWNLOADER  —  CRT Phosphor Green / BIOS / Norton Commander
// ═══════════════════════════════════════════════════════════════════════════════

// Boot POST messages
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

    // kick off boot animation then main UI
    this._showBoot();
  }

  // ── helpers ────────────────────────────────────────────────────────────────

  _sleep(ms) { return new Promise(r => setTimeout(r, ms)); }

  _hline(len = 76) {
    return "{green-fg}" + "─".repeat(len) + "{/green-fg}";
  }

  _buildFkeyBar() {
    // Classic Norton Commander F-key row
    const keys = [
      ["F1","DOWNLOAD"], ["F2","COPY URL"], ["F3","RESET  "],
      ["F5","↑↓ SEL  "], ["F9","ABOUT   "], ["F10","QUIT   "]
    ];
    return keys.map(([k, lbl]) =>
      `{black-fg}{white-bg}${k}{/white-bg}{/black-fg}` +
      `{black-fg}{cyan-bg}${lbl}{/cyan-bg}{/black-fg}`
    ).join(" ");
  }

  // ── boot POST screen ───────────────────────────────────────────────────────

  async _showBoot() {
    const scr = this.screen;

    // full-screen black canvas
    const bootBg = blessed.box({
      parent: scr,
      top: 0, left: 0, width: "100%", height: "100%",
      style: { bg: "black" }
    });

    // ASCII art block (green, centred)
    blessed.box({
      parent: bootBg,
      top: 1, left: "center",
      width: 72, height: 7,
      style: { fg: "green", bg: "black" },
      tags: true,
      content: [
        "{green-fg}  ████████╗██╗██╗  ██╗████████╗ ██████╗ ██╗  ██╗   ██████╗ ██╗    {/green-fg}",
        "{green-fg}     ██╔══╝██║██║ ██╔╝╚══██╔══╝██╔═══██╗██║ ██╔╝   ██╔══██╗██║    {/green-fg}",
        "{green-fg}     ██║   ██║█████╔╝    ██║   ██║   ██║█████╔╝    ██║  ██║██║    {/green-fg}",
        "{green-fg}     ██║   ██║██╔══██╗   ██║   ██║   ██║██╔══██╗   ██║  ██║██║    {/green-fg}",
        "{green-fg}     ╚═╝   ╚═╝╚═╝  ╚═╝   ╚═╝    ╚═════╝ ╚═╝  ╚═╝   ╚═════╝ ╚══════╝{/green-fg}",
        "{yellow-fg}                    [ DOWNLOADER  v2.0 ]  RETRO TERMINAL EDITION         {/yellow-fg}",
        "{green-fg}  ───────────────────────────────────────────────────────────────────  {/green-fg}",
      ].join("\n")
    });

    // scrollable boot log
    const bootLog = blessed.log({
      parent: bootBg,
      top: 9, left: 3, width: "100%-6", height: "100%-14",
      style: { fg: "green", bg: "black" },
      tags: true,
      scrollable: true,
      alwaysScroll: true,
    });

    // memory-test progress bar (dedicated box, fixed near bottom)
    const memBar = blessed.box({
      parent: bootBg,
      bottom: 3, left: 3, width: "100%-6", height: 1,
      style: { fg: "green", bg: "black" },
      tags: true,
      content: ""
    });

    // "ready" line at very bottom
    const readyLine = blessed.box({
      parent: bootBg,
      bottom: 1, left: 0, width: "100%", height: 1,
      align: "center",
      style: { fg: "black", bg: "black" },
      tags: true,
      content: ""
    });

    scr.render();

    // print POST lines one by one
    for (const [delay, msg] of BOOT_LINES) {
      await this._sleep(delay);
      bootLog.log(msg);
      scr.render();
    }

    // animated memory-test bar
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

    // flash "ready" at the bottom
    readyLine.style.fg = "black";
    readyLine.style.bg = "green";
    readyLine.setContent("{bold}{black-fg}  System ready. Initializing display adapter...  {/black-fg}{/bold}");
    scr.render();
    await this._sleep(600);

    // tear down boot screen, build main UI
    bootBg.destroy();
    this._initMainUI();
    this._bindKeys();
    this._startClock();
    this._startBlink();

    // initial log messages
    this._log("{green-fg}System online ─ TikTok Downloader v2.0{/green-fg}");
    this._log("{white-fg}Paste a TikTok URL and press {yellow-fg}[Enter]{/yellow-fg}{white-fg} or {yellow-fg}[F1]{/yellow-fg}{white-fg} to download.{/white-fg}");
    this._setStatus("STANDBY", "green");
  }

  // ── main UI ────────────────────────────────────────────────────────────────

  _initMainUI() {
    const scr = this.screen;

    // ─── Root black canvas ──────────────────────────────────────────────────
    this.root = blessed.box({
      parent: scr,
      top: 0, left: 0, width: "100%", height: "100%",
      style: { bg: "black" }
    });

    // ─── Top menu bar (inverted — Norton Commander style) ───────────────────
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

    // Clock widget (right side of menu bar)
    this.clockBox = blessed.box({
      parent: this.root,
      top: 0, right: 0, width: 11, height: 1,
      align: "right",
      style: { fg: "black", bg: "cyan" },
      tags: true,
      content: " 00:00:00 "
    });

    // ─── Main outer frame (green border on black) ───────────────────────────
    this.frame = blessed.box({
      parent: this.root,
      top: 1, left: 0, width: "100%", height: "100%-2",
      border: { type: "line" },
      style: {
        fg: "green", bg: "black",
        border: { fg: "green" }
      }
    });

    // ─── Small decorative title inside frame ────────────────────────────────
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

    // ─── URL input row ──────────────────────────────────────────────────────
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
      style: {
        fg: "green", bg: "black",
        focus: { fg: "white", bg: "black" }
      },
      inputOnFocus: true,
      value: "",
      tags: false
    });

    // underline below URL row
    this.inputLine = blessed.box({
      parent: this.frame,
      top: 5, left: 1, width: "100%-2", height: 1,
      style: { fg: "green", bg: "black" },
      tags: true,
      content: " " + this._hline(76)
    });

    // ─── Progress row ───────────────────────────────────────────────────────
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

    // blinking status dot
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

    // separator
    this.sep2 = blessed.box({
      parent: this.frame,
      top: 7, left: 1, width: "100%-2", height: 1,
      style: { fg: "green", bg: "black" },
      tags: true,
      content: " " + this._hline(76)
    });

    // ─── Column headers (inverted) ──────────────────────────────────────────
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

    // ─── Log panel ──────────────────────────────────────────────────────────
    this.logBox = blessed.log({
      parent: this.frame,
      top: 9, left: 1, width: "55%", height: "100%-12",
      border: { type: "line" },
      style: {
        fg: "green", bg: "black",
        border: { fg: "green" },
        scrollbar: { bg: "green", fg: "black" }
      },
      scrollable: true,
      alwaysScroll: true,
      tags: true,
      scrollbar: { ch: "▒", style: { bg: "green" } }
    });

    // ─── Result panel ───────────────────────────────────────────────────────
    this.resultBox = blessed.box({
      parent: this.frame,
      top: 9, left: "55%+2", width: "44%-3", height: "100%-12",
      border: { type: "line" },
      style: {
        fg: "green", bg: "black",
        border: { fg: "green" },
        scrollbar: { bg: "green", fg: "black" }
      },
      scrollable: true,
      alwaysScroll: true,
      tags: true,
      scrollbar: { ch: "▒", style: { bg: "green" } },
      content:
        "\n {white-fg}No results yet.{/white-fg}\n\n" +
        " Paste a TikTok URL above,\n" +
        " then press {yellow-fg}[F1]{/yellow-fg} or {yellow-fg}[Enter]{/yellow-fg}\n" +
        " to start downloading.\n\n" +
        " {green-fg}▸ Links will appear here.{/green-fg}"
    });

    // ─── F-key bar (bottom, Norton Commander style) ─────────────────────────
    this.fkeyBar = blessed.box({
      parent: this.root,
      bottom: 0, left: 0, width: "100%", height: 1,
      style: { fg: "black", bg: "black" },
      tags: true,
      content: this._buildFkeyBar()
    });

    scr.render();
  }

  // ── clock & blink ──────────────────────────────────────────────────────────

  _startClock() {
    const tick = () => {
      if (!this.clockBox) return;
      const now = new Date();
      const hh  = String(now.getHours()).padStart(2, "0");
      const mm  = String(now.getMinutes()).padStart(2, "0");
      const ss  = String(now.getSeconds()).padStart(2, "0");
      this.clockBox.setContent(` ${hh}:${mm}:${ss} `);
      this.screen.render();
    };
    tick();
    this._timers.push(setInterval(tick, 1000));
  }

  _startBlink() {
    this._timers.push(setInterval(() => {
      this.state.blinkOn = !this.state.blinkOn;
      if (!this.blinkDot) return;

      if (this.state.processing) {
        // fast amber blink while processing
        this.blinkDot.setContent(
          this.state.blinkOn ? "{yellow-fg}◉{/yellow-fg}" : "{black-fg}◉{/black-fg}"
        );
      } else {
        // steady green when idle
        this.blinkDot.setContent("{green-fg}●{/green-fg}");
      }
      this.screen.render();
    }, 450));
  }

  // ── log / status / progress ────────────────────────────────────────────────

  _log(msg) {
    if (!this.logBox) return;
    const ts = new Date().toLocaleTimeString("id-ID", { hour12: false });
    this.logBox.log(`{green-fg}[${ts}]{/green-fg} ${msg}`);
    this.screen.render();
  }

  _setStatus(text, color = "yellow") {
    if (!this.statusLabel) return;
    this.statusLabel.setContent(`{${color}-fg}{bold}${text}{/bold}{/${color}-fg}`);
    this.screen.render();
  }

  _setProgress(pct) {
    if (!this.progressBar) return;
    const total  = 28;
    const filled = Math.floor((pct / 100) * total);
    const empty  = total - filled;
    const bar    = "█".repeat(filled) + "░".repeat(empty);
    const pctStr = String(pct).padStart(3, " ");
    this.progressBar.setContent(
      `{green-fg}[${bar}]{/green-fg} {white-fg}${pctStr}%{/white-fg}`
    );
    this.screen.render();
  }

  // ── key bindings ───────────────────────────────────────────────────────────

  _bindKeys() {
    // F1 / Enter → download
    this.screen.key(["f1"], async () => {
      const url = this.inputBox.getValue().trim();
      if (!url) { this._log("{yellow-fg}⚠ URL is empty!{/yellow-fg}"); return; }
      await this._download(url);
    });
    this.inputBox.key(["enter"], async () => {
      const url = this.inputBox.getValue().trim();
      if (!url) { this._log("{yellow-fg}⚠ URL is empty!{/yellow-fg}"); return; }
      await this._download(url);
    });

    // F2 / Ctrl+A → copy
    this.screen.key(["f2", "C-a"], async () => { await this._copyUrl(); });

    // F3 / Ctrl+R → reset
    this.screen.key(["f3", "C-r"], () => { this._reset(); });

    // F9 → about
    this.screen.key(["f9"], () => {
      this._log("{cyan-fg}─── About ────────────────────────────────────{/cyan-fg}");
      this._log("{white-fg}TikTok Downloader v2.0  —  Retro Terminal Edition{/white-fg}");
      this._log("{white-fg}Powered by: SnapTik API + blessed TUI{/white-fg}");
      this._log("{cyan-fg}──────────────────────────────────────────────{/cyan-fg}");
    });

    // F10 / Ctrl+Q → quit
    this.screen.key(["f10", "C-q"], () => { this._quit(); });

    // Tab → cycle focus
    this.screen.key(["tab"], () => {
      if (this.state.focus === "input") {
        this.resultBox.focus();
        this.state.focus = "result";
        this._setStatus("NAV MODE", "cyan");
      } else {
        this.inputBox.focus();
        this.state.focus = "input";
        this._setStatus("INPUT MODE", "cyan");
      }
    });

    // ↑ / ↓ → navigate links
    this.screen.key(["up"], () => {
      if (this.state.result?.links?.length > 0) {
        this.state.selectedLink = Math.max(0, this.state.selectedLink - 1);
        this._displayResult(this.state.result, null);
      }
    });
    this.screen.key(["down"], () => {
      if (this.state.result?.links?.length > 0) {
        this.state.selectedLink = Math.min(
          this.state.result.links.length - 1,
          this.state.selectedLink + 1
        );
        this._displayResult(this.state.result, null);
      }
    });

    this.inputBox.focus();
  }

  // ── actions ────────────────────────────────────────────────────────────────

  async _copyUrl() {
    if (!this.state.result?.links?.length) {
      this._log("{yellow-fg}⚠ No URL available to copy!{/yellow-fg}");
      return;
    }
    const url = this.state.result.links[this.state.selectedLink]?.url ||
                this.state.result.links[0].url;
    try {
      await copyToClipboard(url);
      this._log("{green-fg}✓ URL copied to clipboard!{/green-fg}");
      this._setStatus("COPIED!", "green");
    } catch (err) {
      this._log(`{yellow-fg}⚠ ${err.message}{/yellow-fg}`);
      this._setStatus("COPY FAIL", "red");
    }
  }

  _reset() {
    this.inputBox.setValue("");
    this.resultBox.setContent(
      "\n {white-fg}Cleared. Ready for new URL.{/white-fg}\n\n" +
      " {green-fg}▸ Paste URL above and press [F1]{/green-fg}"
    );
    this.state.result       = null;
    this.state.selectedLink = 0;
    this._setProgress(0);
    this._log("{white-fg}── Reset ──────────────────────────────────────────{/white-fg}");
    this._setStatus("STANDBY", "green");
    this.inputBox.focus();
    this.state.focus = "input";
    this.screen.render();
  }

  _quit() {
    this._log("{yellow-fg}── Shutting down... ───────────────────────────────{/yellow-fg}");
    this._setStatus("HALTING", "red");
    this._timers.forEach(t => clearInterval(t));
    setTimeout(() => process.exit(0), 600);
  }

  async _download(url) {
    if (this.state.processing) {
      this._log("{yellow-fg}⚠ Already processing — please wait!{/yellow-fg}");
      return;
    }

    this.state.processing   = true;
    this.state.result       = null;
    this.state.selectedLink = 0;
    this._setProgress(0);
    this._setStatus("PROCESSING", "yellow");

    this._log("{yellow-fg}═══════════════════════════════════════════════════{/yellow-fg}");
    this._log(`{white-fg}TARGET  ${url.substring(0, 54)}${url.length > 54 ? "…" : ""}{/white-fg}`);

    try {
      // Step 1: token
      this._setProgress(10);
      this._log("{white-fg}[1/4] Requesting BIOS token...{/white-fg}");
      const home = await openHome();
      this._log(`{green-fg}[OK]  Token: ${home.token.substring(0, 26)}…{/green-fg}`);
      this._setProgress(25);

      // Step 2: submit
      this._log("{white-fg}[2/4] Submitting to SnapTik API...{/white-fg}");
      const post = await submitVideo(url, home.token);
      this._log(`{green-fg}[OK]  Server: HTTP ${post.status}  (${post.body.length} bytes){/green-fg}`);
      this._setProgress(50);

      // Step 3: decode
      this._log("{white-fg}[3/4] Decoding obfuscated response...{/white-fg}");
      const decoded = decodeObfuscatedResponse(post.body);
      this._log(`{green-fg}[OK]  Decoded: ${decoded.length} chars{/green-fg}`);
      this._setProgress(75);

      // Step 4: extract
      this._log("{white-fg}[4/4] Parsing download links...{/white-fg}");
      const result = await extractResult(decoded);
      this.state.result = result;
      this._setProgress(90);

      // Optional render
      let render = null;
      if (result.render_token) {
        this._log("{white-fg}[RND] Async render token found — polling...{/white-fg}");
        render = await renderVideo(result.render_token);
        if (render?.download_url)
          this._log("{green-fg}[OK]  Render complete!{/green-fg}");
      }

      this._setProgress(100);
      this._displayResult(result, render);

      const n = result.links?.length ?? 0;
      this._log(`{green-fg}[DONE] ${n} link(s) ready  ──  use ↑↓ to select, F2 to copy{/green-fg}`);
      this._log("{green-fg}═══════════════════════════════════════════════════{/green-fg}");
      this._setStatus("COMPLETE", "green");

    } catch (err) {
      this._setProgress(0);
      this._log(`{red-fg}[ERR] ${err.message}{/red-fg}`);
      this._log("{red-fg}═══════════════════════════════════════════════════{/red-fg}");
      this._setStatus("FAILED!", "red");
      this.resultBox.setContent(
        `\n {red-fg}ERROR:{/red-fg}\n\n ${err.message}\n\n` +
        " {yellow-fg}Press F3 to reset and try again.{/yellow-fg}"
      );
    } finally {
      this.state.processing = false;
      this.screen.render();
    }
  }

  _displayResult(result, render) {
    const lines = [];

    if (result.title) {
      lines.push(`{yellow-fg}Title :{/yellow-fg} {white-fg}${result.title}{/white-fg}`);
    }
    if (result.author) {
      lines.push(`{yellow-fg}Author:{/yellow-fg} {white-fg}${result.author}{/white-fg}`);
    }

    lines.push("");
    lines.push("{green-fg}─── Download Links ──────────────────────{/green-fg}");
    lines.push("");

    if (result.links?.length > 0) {
      result.links.forEach((link, i) => {
        const sel = i === this.state.selectedLink;
        // selected row: inverted
        if (sel) {
          lines.push(`{black-fg}{green-bg} ▶ [${i + 1}] ${link.text.padEnd(28)} {/green-bg}{/black-fg}`);
        } else {
          lines.push(`   {yellow-fg}[${i + 1}]{/yellow-fg} {white-fg}${link.text}{/white-fg}`);
        }

        const shortUrl = link.url.length > 36
          ? link.url.substring(0, 36) + "…"
          : link.url;
        lines.push(`   {green-fg}${shortUrl}{/green-fg}`);
        lines.push("");
      });

      lines.push("{white-fg}↑↓ navigate   F2 copy URL{/white-fg}");
    } else {
      lines.push("  {yellow-fg}No links found in response.{/yellow-fg}");
    }

    if (render?.download_url) {
      lines.push("");
      lines.push("{green-fg}─── Render Output ───────────────────────{/green-fg}");
      const ru = render.download_url;
      lines.push(`{green-fg}${ru.length > 36 ? ru.substring(0, 36) + "…" : ru}{/green-fg}`);
    }

    this.resultBox.setContent(" " + lines.join("\n "));
    this.screen.render();
  }
}

// ═══════════════════════════════════════════════════════════════════════════════
//  BOOT
// ═══════════════════════════════════════════════════════════════════════════════

new RetroTerminalDownloader();
