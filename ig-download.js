#!/usr/bin/env node

/**
 * ╔══════════════════════════════════════════════════════════════════════════════╗
 * ║  Instagram Downloader - Retro Terminal Edition v1.0                          ║
 * ║  Project: NEXA Downloader Suite                                              ║
 * ║  Created by: NexaDev                                                         ║
 * ╚══════════════════════════════════════════════════════════════════════════════╝
 *
 *  Controls:
 *    Enter    → Process URL
 *    Ctrl+S   → Copy selected URL to clipboard
 *    Ctrl+B   → Download file to storage
 *    Ctrl+R   → Reset form
 *    Ctrl+V   → Back to main menu
 *    Ctrl+C   → Quit
 *    ↑/↓      → Select link
 *    Tab      → Cycle focus
 */

import { io } from "socket.io-client";
import crypto from "node:crypto";
import blessed from "blessed";
import { spawn } from "child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import https from "node:https";

// ═══════════════════════════════════════════════════════════════════════════════
//  CONFIG
// ═══════════════════════════════════════════════════════════════════════════════
const BASE    = "https://iqsaved.com";
const LOCALE  = "id";
const IMG_PATH = "https://cdn.iqsaved.com/img.php?url=";
const UA = "Mozilla/5.0 (Linux; Android 10; K) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/147.0.0.0 Mobile Safari/537.36";

// ── Theme ─────────────────────────────────────────────────────────────────────
const ACCENT = "magenta";
const IG_BRAND = [
  "", "  ┌──────────┐", "  │  N E X A │", "  └──────────┘",
  "", "  Instagram", " Downloader", "", " ──────────",
  "", "  v 1.0.0", "", " NexaDev", "", " ──────────", "", " © 2025",
];

// ═══════════════════════════════════════════════════════════════════════════════
//  INSTAGRAM DOWNLOADER LOGIC (iqsaved.com)
// ═══════════════════════════════════════════════════════════════════════════════

function randomDigits(length = 10) {
  let out = "";
  for (let i = 0; i < length; i++) out += Math.floor(Math.random() * 10);
  return out;
}

function randomGa() {
  return `GA1.1.${Math.floor(Math.random() * 2_000_000_000)}.${Math.floor(Date.now() / 1000)}`;
}

function randomPhpSession() { return crypto.randomBytes(13).toString("hex"); }

function extractShortcode(url) {
  const match = String(url).match(/instagram\.com\/(?:reel|p|tv)\/([^/?#]+)/i);
  if (!match) throw new Error("Shortcode Instagram tidak ditemukan");
  return match[1];
}

function cleanInstagramUrl(url) {
  const shortcode = extractShortcode(url);
  return `https://www.instagram.com/reel/${shortcode}/`;
}

function createCookie() {
  const now = Math.floor(Date.now() / 1000);
  return [
    `PHPSESSID=${randomPhpSession()}`,
    `_ga=${randomGa()}`,
    `_ym_uid=${now}${randomDigits(10)}`,
    `_ym_d=${now}`,
    "_ym_isad=2",
    "_ym_visorc=w",
    `_ga_RWNEPS7JVV=GS2.1.s${now}$o1$g0$t${now}$j60$l0$h0`,
  ].join("; ");
}

function parseSetCookie(headers) {
  const cookies = [];
  if (typeof headers.getSetCookie === "function") {
    for (const item of headers.getSetCookie()) cookies.push(item.split(";")[0]);
  } else {
    const raw = headers.get("set-cookie");
    if (raw) cookies.push(...raw.split(/,(?=[^;,]+=)/).map(v => v.split(";")[0].trim()));
  }
  return cookies;
}

function mergeCookieString(oldCookie, newCookies = []) {
  const map = new Map();
  for (const part of oldCookie.split(";")) {
    const clean = part.trim();
    if (!clean) continue;
    map.set(clean.split("=")[0], clean);
  }
  for (const clean of newCookies) {
    if (!clean) continue;
    map.set(clean.split("=")[0], clean);
  }
  return [...map.values()].join("; ");
}

function buildHeaders(cookie = "") {
  return {
    "user-agent": UA,
    "sec-ch-ua": `"Google Chrome";v="147", "Not.A/Brand";v="8", "Chromium";v="147"`,
    "sec-ch-ua-mobile": "?1",
    "sec-ch-ua-platform": `"Android"`,
    "accept-language": "id-ID,id;q=0.9,en-US;q=0.8,en;q=0.7",
    ...(cookie ? { cookie } : {}),
  };
}

function makeFileLink(value, filename = "") {
  if (!value) return null;
  const url = `${IMG_PATH}${encodeURIComponent(value)}`;
  return filename ? `${url}&filename=${encodeURIComponent(filename)}` : url;
}

function cleanResult(data) {
  const items = Array.isArray(data.items) ? data.items : [];
  const resultUrl = items.flatMap((item, index) => {
    const files = [];
    if (item.imageSrc) files.push({ type: "thumbnail", url: makeFileLink(item.imageSrc, `thumbnail-${index + 1}.jpg`) });
    if (Array.isArray(item.downloadLink)) {
      for (const file of item.downloadLink) files.push({ type: item.type || "video", url: makeFileLink(file.value, file.filename) });
    }
    return files;
  });
  return {
    username: data.username || null,
    text: data.text || null,
    countViews: data.countViews ?? null,
    countLikes: data.countLikes ?? null,
    links: resultUrl.map((f, i) => ({ text: `${f.type} #${i + 1}`, url: f.url })),
  };
}

async function initSession() {
  let cookie = createCookie();
  const res = await fetch(`${BASE}/${LOCALE}/`, {
    method: "GET",
    headers: { ...buildHeaders(cookie), accept: "text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8", "upgrade-insecure-requests": "1" },
  });
  cookie = mergeCookieString(cookie, parseSetCookie(res.headers));
  return cookie;
}

async function postLandingPage(url, cookie) {
  const shortcode = extractShortcode(url);
  const endpoint = `${BASE}/${LOCALE}/download-reels/${shortcode}/`;
  const res = await fetch(endpoint, {
    method: "POST",
    headers: { ...buildHeaders(cookie), origin: BASE, referer: `${BASE}/${LOCALE}/`, "content-type": "application/x-www-form-urlencoded", "upgrade-insecure-requests": "1", accept: "text/html,*/*" },
    body: new URLSearchParams({ url }).toString(),
  });
  await res.text();
  return { endpoint, cookie: mergeCookieString(cookie, parseSetCookie(res.headers)) };
}

async function getToken(cookie) {
  const res = await fetch(`${BASE}/connect/`, {
    method: "GET",
    headers: { ...buildHeaders(cookie), accept: "application/json, text/plain, */*", referer: `${BASE}/${LOCALE}/` },
  });
  const text = await res.text();
  if (!res.ok) throw new Error(`GET /connect/ gagal HTTP ${res.status}`);
  const json = JSON.parse(text);
  if (!json.token) throw new Error(`Token tidak ditemukan`);
  return json.token;
}

async function searchViaSocket({ linkValue, token, cookie }) {
  return new Promise((resolve, reject) => {
    const socket = io(BASE, {
      reconnection: false,
      transports: ["websocket", "polling"],
      extraHeaders: { ...buildHeaders(cookie), origin: BASE, referer: `${BASE}/${LOCALE}/download-reels/${extractShortcode(linkValue)}/` },
      timeout: 30000,
    });
    const timer = setTimeout(() => { socket.disconnect(); reject(new Error("Timeout menunggu searchResult")); }, 30000);
    socket.on("connect", () => {
      socket.emit("search", { date: Date.now(), token, requestType: "2", linkValue });
    });
    socket.on("searchResult", data => { clearTimeout(timer); socket.disconnect(); resolve(data); });
    socket.on("connect_error", err => { clearTimeout(timer); socket.disconnect(); reject(new Error(`Socket error: ${err.message}`)); });
    socket.on("error", err => { clearTimeout(timer); socket.disconnect(); reject(new Error(`Socket error: ${err?.message || String(err)}`)); });
  });
}

async function igdl(url) {
  let cookie = await initSession();
  const landing = await postLandingPage(url, cookie);
  cookie = landing.cookie;
  const token = await getToken(cookie);
  const linkValue = cleanInstagramUrl(url);
  const raw = await searchViaSocket({ linkValue, token, cookie });
  const ok = raw?.data?.status === "success" || raw?.data?.code === 200;
  const resultData = raw?.data?.data || raw;
  if (!ok) throw new Error("Failed to fetch Instagram content");
  return cleanResult(resultData);
}

// ═══════════════════════════════════════════════════════════════════════════════
//  CLIPBOARD & FILE HELPERS
// ═══════════════════════════════════════════════════════════════════════════════

async function copyToClipboard(text) {
  const tryCommand = (cmd, args, input) => new Promise((resolve, reject) => {
    const proc = spawn(cmd, args);
    proc.stdin.write(input);
    proc.stdin.end();
    proc.on("error", reject);
    proc.on("exit", code => code === 0 ? resolve(true) : reject(new Error(`${cmd} exited ${code}`)));
  });
  const platform = process.platform;
  if (platform === "darwin") { try { await tryCommand("pbcopy", [], text); return; } catch {} }
  else if (platform === "win32") { try { await tryCommand("clip", [], text); return; } catch {} }
  else {
    for (const [cmd, args] of [["wl-copy",[]], ["xclip",["-selection","clipboard"]], ["xsel",["--clipboard","--input"]], ["termux-clipboard-set",[]]]) {
      try { await tryCommand(cmd, args, text); return; } catch {}
    }
  }
  process.stdout.write(`\x1b]52;c;${Buffer.from(text).toString("base64")}\x07`);
}

async function downloadFile(url, outputPath, onProgress) {
  return new Promise((resolve, reject) => {
    const file = fs.createWriteStream(outputPath);
    https.get(url, { timeout: 60000 }, response => {
      const total = parseInt(response.headers["content-length"], 10) || 0;
      let downloaded = 0;
      response.on("data", chunk => {
        downloaded += chunk.length;
        file.write(chunk);
        if (total > 0 && onProgress) onProgress(Math.round((downloaded / total) * 100));
      });
      response.on("end", () => { file.end(); resolve(outputPath); });
      response.on("error", err => { file.destroy(); fs.unlink(outputPath, () => {}); reject(err); });
    }).on("error", err => { file.destroy(); fs.unlink(outputPath, () => {}); reject(err); });
  });
}

function getDownloadPath(filename) {
  const androidPath = "/storage/emulated/0/Download";
  if (fs.existsSync("/storage/emulated/0")) {
    if (!fs.existsSync(androidPath)) { try { fs.mkdirSync(androidPath, { recursive: true }); } catch {} }
    if (fs.existsSync(androidPath)) return path.join(androidPath, filename);
  }
  const homePath = path.join(os.homedir(), "Downloads");
  if (!fs.existsSync(homePath)) { try { fs.mkdirSync(homePath, { recursive: true }); } catch {} }
  return path.join(homePath, filename);
}

// ═════════════════════════════════════════════════════════════════════════════
//  INSTALLER-STYLE TUI — Instagram Downloader
// ═════════════════════════════════════════════════════════════════════════════

class IGDownloaderTUI {
  constructor() {
    this.scr = blessed.screen({
      smartCSR: true,
      title: "Instagram Downloader — NEXA Suite",
      mouse: true,
      cursor: { artificial: true, shape: "block", blink: false },
    });

    this.busy    = false;
    this.result  = null;
    this.linkIdx = 0;
    this._build();
    this._keys();
    this._boot();
  }

  _build() {
    const s = this.scr;

    blessed.box({
      parent: s, top: 0, left: 0, width: "100%", height: 1,
      style: { bg: "white", fg: "black" },
      content: "  NEXA Downloader Suite  —  Instagram Downloader",
    });

    this.win = blessed.box({
      parent: s, top: 1, left: 0,
      width: "100%", height: "100%-2",
      border: { type: "line" },
      style: { bg: "black", border: { fg: "white" } },
    });

    // Sidebar
    blessed.box({
      parent: this.win, top: 0, left: 0,
      width: 20, height: "100%-2",
      style: { bg: "blue", fg: "white" },
      content: IG_BRAND.join("\n"),
    });
    blessed.box({
      parent: this.win, bottom: 0, left: 0, width: 20, height: 1,
      style: { bg: ACCENT, fg: "black" },
      content: "  Instagram  ◈",
    });
    blessed.line({
      parent: this.win, top: 0, left: 20,
      orientation: "vertical", height: "100%-2",
      style: { fg: "white" },
    });

    // Content
    this.panel = blessed.box({
      parent: this.win, top: 0, left: 21,
      width: "100%-23", height: "100%-2",
      style: { bg: "black", fg: "white" },
    });

    // Header
    blessed.box({
      parent: this.panel, top: 0, left: 0, width: "100%", height: 4,
      style: { bg: "white", fg: "black" }, tags: true,
      content:
        "\n   {bold}Instagram Downloader{/bold}\n" +
        "   Paste a Reel / Post / Story URL and press [ Process ]",
    });
    blessed.line({ parent: this.panel, top: 4, left: 0, width: "100%", orientation: "horizontal", style: { fg: "white" } });

    blessed.box({
      parent: this.panel, top: 5, left: 3, width: "100%-6", height: 1,
      style: { bg: "black", fg: "white" }, tags: true,
      content: "  ◄  {bold}Ctrl+V{/bold} = Back to Setup Menu",
    });
    blessed.box({
      parent: this.panel, top: 7, left: 3, width: "100%-6", height: 1,
      style: { bg: "black", fg: "white" }, tags: true,
      content: "{bold}Enter Instagram URL:{/bold}",
    });

    this.inputBox = blessed.textbox({
      parent: this.panel, top: 8, left: 3, width: "100%-6", height: 3,
      border: { type: "line" },
      style: { fg: "white", bg: "black", border: { fg: "white" }, focus: { border: { fg: ACCENT } } },
      inputOnFocus: true, value: "", tags: true,
    });

    blessed.box({
      parent: this.panel, top: 12, left: 3, width: "100%-6", height: 1,
      style: { bg: "black", fg: "white" }, tags: true,
      content: "{bold}Progress:{/bold}",
    });
    this.progressBar = blessed.progressbar({
      parent: this.panel, top: 13, left: 3, width: "100%-6", height: 1,
      orientation: "horizontal",
      style: { bar: { bg: ACCENT, fg: "black" } },
      filled: 0, pch: "█",
    });
    this.statusBox = blessed.box({
      parent: this.panel, top: 14, left: 3, width: "100%-6", height: 1,
      style: { bg: "black", fg: "white" }, tags: true,
      content: "{white-fg}● READY{/white-fg}",
    });

    blessed.line({ parent: this.panel, top: 16, left: 0, width: "100%", orientation: "horizontal", style: { fg: "white" } });

    blessed.box({
      parent: this.panel, top: 17, left: 3, width: 10, height: 1,
      style: { bg: "black", fg: "white" }, tags: true,
      content: `{${ACCENT}-fg}{bold}[ LOG ]{/bold}{/${ACCENT}-fg}`,
    });
    this.logBox = blessed.log({
      parent: this.panel, top: 18, left: 3, width: "55%-3", height: "100%-24",
      border: { type: "line" },
      style: { fg: "white", bg: "black", border: { fg: "white" }, scrollbar: { bg: ACCENT } },
      scrollable: true, alwaysScroll: true, tags: true,
      scrollbar: { ch: "▒" },
    });

    blessed.box({
      parent: this.panel, top: 17, left: "55%", width: 12, height: 1,
      style: { bg: "black", fg: "white" }, tags: true,
      content: `{${ACCENT}-fg}{bold}[ LINKS ]{/bold}{/${ACCENT}-fg}`,
    });
    this.resultBox = blessed.box({
      parent: this.panel, top: 18, left: "55%", width: "45%-3", height: "100%-24",
      border: { type: "line" },
      style: { fg: "white", bg: "black", border: { fg: "white" }, scrollbar: { bg: ACCENT } },
      scrollable: true, alwaysScroll: true, tags: true,
      scrollbar: { ch: "▒" },
      content: "  No results yet.",
    });

    blessed.line({ parent: this.panel, bottom: 4, left: 0, width: "100%", orientation: "horizontal", style: { fg: "white" } });

    const BS = { bg: "black", fg: "white", border: { fg: "white" }, focus: { bg: ACCENT, fg: "black" }, hover: { bg: ACCENT, fg: "black" } };
    this.btnProcess = this._btn(this.panel, "bottom", 1, "left",   3, 14, " Process ",  BS);
    this.btnCopy    = this._btn(this.panel, "bottom", 1, "left",  20, 14, " Copy URL ", BS);
    this.btnSave    = this._btn(this.panel, "bottom", 1, "left",  37, 14, " Save File ", BS);
    this.btnReset   = this._btn(this.panel, "bottom", 1, "left",  54, 12, " Reset ",    BS);
    this.btnBack    = this._btn(this.panel, "bottom", 1, "right",  1, 14, " ◄ Menu ",
      { bg: "white", fg: "black", border: { fg: "white" }, focus: { bg: "white", fg: "black" }, hover: { bg: "white", fg: "black" } });

    blessed.box({
      parent: s, bottom: 0, left: 0, width: "100%", height: 1,
      style: { bg: "white", fg: "black" },
      content: "  Enter=Process  Ctrl+S=Copy  Ctrl+B=Save  Ctrl+R=Reset  Ctrl+V=Menu  ↑↓=Link",
    });

    this.inputBox.focus();
  }

  _btn(parent, vSide, vVal, hSide, hVal, width, label, style) {
    return blessed.button({
      parent, [vSide]: vVal, [hSide]: hVal,
      width, height: 3,
      border: { type: "line" },
      align: "center", valign: "middle",
      style, tags: true,
      content: `{bold}${label}{/bold}`,
      mouse: true, clickable: true,
    });
  }

  _keys() {
    this.scr.key(["C-v"], () => this._back());
    this.scr.key(["C-c"], () => { this.scr.destroy(); process.exit(0); });
    this.scr.key(["C-s"], async () => await this._copy());
    this.scr.key(["C-b"], async () => await this._save());
    this.scr.key(["C-r"], () => this._reset());
    this.scr.key(["up"], () => {
      if (this.result?.links?.length) { this.linkIdx = Math.max(0, this.linkIdx - 1); this._showResult(); }
    });
    this.scr.key(["down"], () => {
      if (this.result?.links?.length) { this.linkIdx = Math.min(this.result.links.length - 1, this.linkIdx + 1); this._showResult(); }
    });
    this.inputBox.key(["enter"], async () => {
      const url = this.inputBox.getValue().trim();
      if (!url) { this._log("{yellow-fg}⚠ URL kosong!{/yellow-fg}"); return; }
      await this._process(url);
    });
    this.btnProcess.on("press", async () => {
      const url = this.inputBox.getValue().trim();
      if (!url) { this._log("{yellow-fg}⚠ URL kosong!{/yellow-fg}"); return; }
      await this._process(url);
    });
    this.btnCopy.on("press",  async () => await this._copy());
    this.btnSave.on("press",  async () => await this._save());
    this.btnReset.on("press", () => this._reset());
    this.btnBack.on("press",  () => this._back());
  }

  _back() { this.scr.destroy(); process.exit(0); }

  _log(msg) {
    const ts = new Date().toLocaleTimeString("id-ID", { hour12: false });
    this.logBox.log(`{white-fg}[${ts}]{/white-fg} ${msg}`);
    this.scr.render();
  }

  _status(s) {
    let c;
    if      (s.includes("DONE") || s.includes("SAVED") || s.includes("COPIED")) c = `{green-fg}● ${s}{/green-fg}`;
    else if (s.includes("ERR")  || s.includes("FAIL"))  c = `{red-fg}● ${s}{/red-fg}`;
    else if (s.includes("PROC") || s.includes("LOAD"))  c = `{${ACCENT}-fg}● ${s}{/${ACCENT}-fg}`;
    else                                                 c = `{white-fg}● ${s}{/white-fg}`;
    this.statusBox.setContent(c);
    this.scr.render();
  }

  _prog(p) { this.progressBar.setProgress(p); this.scr.render(); }

  _reset() {
    this.inputBox.setValue("");
    this.resultBox.setContent("  No results yet.");
    this.result = null; this.linkIdx = 0;
    this._prog(0); this._status("READY");
    this._log("{white-fg}Form reset.{/white-fg}");
    this.inputBox.focus(); this.scr.render();
  }

  async _copy() {
    if (!this.result?.links?.length) { this._log("{yellow-fg}⚠ No link yet.{/yellow-fg}"); return; }
    const url = this.result.links[this.linkIdx]?.url || this.result.links[0].url;
    try { await copyToClipboard(url); this._log("{green-fg}✔ Copied!{/green-fg}"); this._status("COPIED ✔"); }
    catch (e) { this._log(`{yellow-fg}⚠ ${e.message}{/yellow-fg}`); }
  }

  async _save() {
    if (!this.result?.links?.length) { this._log("{yellow-fg}⚠ No link yet.{/yellow-fg}"); return; }
    const link = this.result.links[this.linkIdx] || this.result.links[0];
    const out  = getDownloadPath(`ig-${Date.now()}.mp4`);
    this._log("{white-fg}Starting download...{/white-fg}"); this._status("DOWNLOADING");
    try {
      await downloadFile(link.url, out, p => { this._prog(p); this._status(`LOADING ${p}%`); });
      this._log(`{green-fg}✔ Saved: ${out}{/green-fg}`); this._status("SAVED ✔"); this._prog(100);
    } catch (e) { this._log(`{red-fg}✘ ${e.message}{/red-fg}`); this._status("FAILED"); this._prog(0); }
  }

  async _process(url) {
    if (this.busy) { this._log("{yellow-fg}⚠ Still processing!{/yellow-fg}"); return; }
    this.busy = true; this.result = null; this.linkIdx = 0;
    this._prog(0); this._status("PROCESSING");
    this._log(`{${ACCENT}-fg}◈ ${url.substring(0, 55)}{/${ACCENT}-fg}`);
    try {
      this._prog(20); this._log("{white-fg}[1/4] Init session...{/white-fg}");
      this._prog(40); this._log("{white-fg}[2/4] Fetching token...{/white-fg}");
      this._prog(60); this._log("{white-fg}[3/4] Socket search...{/white-fg}");
      this._prog(80); this._log("{white-fg}[4/4] Parsing links...{/white-fg}");
      this.result = await igdl(url);
      this._prog(100); this._showResult();
      this._log("{green-fg}✔ Done!{/green-fg}"); this._status("DONE ✔");
    } catch (e) {
      this._prog(0); this._log(`{red-fg}✘ ${e.message}{/red-fg}`);
      this._status("ERROR"); this.resultBox.setContent(`  ERROR:\n  ${e.message}`);
    } finally { this.busy = false; this.scr.render(); }
  }

  _showResult() {
    if (!this.result) return;
    let c = "";
    if (this.result.username)           c += `User:   @${this.result.username}\n`;
    if (this.result.countLikes != null) c += `Likes:  ${this.result.countLikes}\n`;
    if (this.result.countViews != null) c += `Views:  ${this.result.countViews}\n`;
    c += `\nLinks:\n`;
    (this.result.links || []).forEach((l, i) => {
      const sel = i === this.linkIdx;
      c += sel
        ? `{${ACCENT}-fg}{bold} ▶ ${i+1}. ${l.text}{/bold}{/${ACCENT}-fg}\n   ${(l.url||"").substring(0,40)}...\n\n`
        : `   ${i+1}. ${l.text}\n   ${(l.url||"").substring(0,40)}...\n\n`;
    });
    c += `\n↑↓=select  Ctrl+S=copy  Ctrl+B=save`;
    this.resultBox.setContent(c); this.scr.render();
  }

  _boot() {
    this._log(`{${ACCENT}-fg}Instagram Downloader ready.{/${ACCENT}-fg}`);
    this._log("{white-fg}Ctrl+V = Back to menu{/white-fg}");
    this._status("READY"); this.scr.render();
  }
}

// ─────────────────────────────────────────────────────────────────────────────
const app = new IGDownloaderTUI();
