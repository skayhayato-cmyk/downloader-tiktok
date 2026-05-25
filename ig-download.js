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

// ═══════════════════════════════════════════════════════════════════════════════
//  COLOR PALETTE  (magenta/pink theme for Instagram)
// ═══════════════════════════════════════════════════════════════════════════════
const C = {
  bgMain:        "black",
  bgDialog:      "black",
  bgInput:       "black",
  bgInputFocus:  "black",
  bgButton:      "black",
  bgButtonFocus: "magenta",
  fgBorder:      "magenta",
  fgTitle:       "yellow",
  fgLabel:       "magenta",
  fgInput:       "white",
  fgStatus:      "yellow",
  fgLog:         "white",
  fgResult:      "magenta",
  fgButton:      "magenta",
  fgButtonFocus: "black",
  fgFooter:      "black",
  bgFooter:      "magenta",
  fgSep:         "magenta",
  fgScrollbar:   "magenta",
  fgProgress:    "magenta",
};

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

// ═══════════════════════════════════════════════════════════════════════════════
//  TUI CLASS
// ═══════════════════════════════════════════════════════════════════════════════

class IGDownloaderTUI {
  constructor() {
    this.screen = blessed.screen({
      smartCSR: true,
      title: "Instagram Downloader - NEXA Suite",
      mouse: true,
      cursor: { artificial: true, shape: "underline", blink: true, color: "magenta" },
    });

    this.isProcessing = false;
    this.downloadResult = null;
    this.selectedLinkIndex = 0;
    this.currentFocus = "input";

    this.initUI();
    this.bindKeys();
  }

  initUI() {
    const screen = this.screen;

    this.bg = blessed.box({ parent: screen, top: 0, left: 0, width: "100%", height: "100%", style: { bg: C.bgMain } });
    this.shadow = blessed.box({ parent: this.bg, top: 1, left: 2, width: "100%-4", height: "100%-3", style: { bg: "black" } });

    this.dialog = blessed.box({
      parent: this.bg, top: 0, left: 1, width: "100%-4", height: "100%-3",
      border: { type: "line", fg: C.fgBorder },
      style: { bg: C.bgDialog, border: { fg: C.fgBorder } },
    });

    // Title bar
    blessed.box({
      parent: this.dialog, top: 0, left: 0, width: "100%", height: 1,
      align: "center", style: { fg: C.fgTitle, bg: C.bgDialog }, tags: true,
      content: `{yellow-fg}{bold}▓▒░ NEXA  ◈  Instagram Downloader v1.0 ░▒▓{/bold}{/yellow-fg}`,
    });

    blessed.line({ parent: this.dialog, top: 1, left: 0, width: "100%", orientation: "horizontal", style: { fg: C.fgSep, bg: C.bgDialog } });

    // Back hint
    blessed.box({
      parent: this.dialog, top: 2, left: 2, width: "100%-4", height: 1,
      style: { fg: "yellow", bg: C.bgDialog }, tags: true,
      content: `{yellow-fg}◄ Press {bold}Ctrl+V{/bold} to return to Main Menu{/yellow-fg}`,
    });

    // URL Label
    blessed.box({
      parent: this.dialog, top: 4, left: 2, width: "100%-4", height: 2,
      style: { fg: C.fgLabel, bg: C.bgDialog }, tags: true,
      content: `{magenta-fg}{bold}► Enter Instagram URL:{/bold}{/magenta-fg}\n{white-fg}  (instagram.com/reel/, /p/, /tv/){/white-fg}`,
    });

    // Input box
    this.inputBox = blessed.textbox({
      parent: this.dialog, top: 6, left: 2, width: "100%-4", height: 3,
      border: { type: "line", fg: C.fgBorder },
      style: { fg: C.fgInput, bg: C.bgInput, border: { fg: C.fgBorder }, focus: { bg: C.bgInputFocus, border: { fg: "yellow" } } },
      inputOnFocus: true, value: "", tags: true,
    });

    // Progress label
    blessed.box({
      parent: this.dialog, top: 10, left: 2, width: "100%-4", height: 1,
      style: { fg: C.fgLabel, bg: C.bgDialog }, tags: true,
      content: `{magenta-fg}{bold}Progress:{/bold}{/magenta-fg}`,
    });

    // Progress bar
    this.progressBar = blessed.progressbar({
      parent: this.dialog, top: 11, left: 2, width: "100%-4", height: 1,
      orientation: "horizontal",
      style: { bar: { bg: C.fgProgress, fg: C.bgMain }, border: { fg: C.fgBorder } },
      filled: 0, pch: "█", tags: true,
    });

    // Status text
    this.statusText = blessed.box({
      parent: this.dialog, top: 12, left: 2, width: "100%-4", height: 1,
      align: "right", style: { fg: C.fgStatus, bg: C.bgDialog }, tags: true,
      content: `{yellow-fg}{bold}● READY{/bold}{/yellow-fg}`,
    });

    blessed.line({ parent: this.dialog, top: 14, left: 0, width: "100%", orientation: "horizontal", style: { fg: C.fgSep, bg: C.bgDialog } });

    // Log
    blessed.box({ parent: this.dialog, top: 15, left: 2, width: 12, height: 1, style: { fg: C.fgLabel, bg: C.bgDialog }, tags: true, content: `{magenta-fg}{bold}[ LOG ]{/bold}{/magenta-fg}` });
    this.logBox = blessed.log({
      parent: this.dialog, top: 16, left: 2, width: "55%", height: "100%-21",
      border: { type: "line", fg: C.fgBorder },
      style: { fg: C.fgLog, bg: C.bgDialog, border: { fg: C.fgBorder }, scrollbar: { bg: C.fgScrollbar } },
      scrollable: true, alwaysScroll: true, tags: true,
      scrollbar: { ch: "▒", style: { bg: C.fgScrollbar, fg: C.bgMain } },
    });

    // Result
    blessed.box({ parent: this.dialog, top: 15, left: "55%+1", width: 14, height: 1, style: { fg: C.fgLabel, bg: C.bgDialog }, tags: true, content: `{magenta-fg}{bold}[ LINKS ]{/bold}{/magenta-fg}` });
    this.resultBox = blessed.box({
      parent: this.dialog, top: 16, left: "55%+1", width: "45%-3", height: "100%-21",
      border: { type: "line", fg: C.fgBorder },
      style: { fg: C.fgResult, bg: C.bgDialog, border: { fg: C.fgBorder }, scrollbar: { bg: C.fgScrollbar } },
      scrollable: true, alwaysScroll: true, tags: true,
      scrollbar: { ch: "▒", style: { bg: C.fgScrollbar, fg: C.bgMain } },
    });

    // Button bar
    this.buttonBar = blessed.box({
      parent: this.dialog, bottom: 0, left: 0, width: "100%", height: 3,
      border: { type: "line", fg: C.fgBorder },
      style: { fg: C.fgMain, bg: C.bgDialog, border: { fg: C.fgBorder } },
      tags: true, align: "center", valign: "middle",
    });

    const btnStyle = { fg: C.fgButton, bg: C.bgButton, focus: { bg: C.bgButtonFocus, fg: C.fgButtonFocus } };
    this.btnProcess = blessed.button({ parent: this.buttonBar, top: 1, left: "5%", width: 14, height: 1, content: `{bold}{magenta-fg}[Process]{/magenta-fg}{/bold}`, align: "center", style: btnStyle, tags: true, mouse: true, clickable: true });
    this.btnCopy = blessed.button({ parent: this.buttonBar, top: 1, left: "29%", width: 14, height: 1, content: `{bold}{magenta-fg}[Copy URL]{/magenta-fg}{/bold}`, align: "center", style: btnStyle, tags: true, mouse: true, clickable: true });
    this.btnSave = blessed.button({ parent: this.buttonBar, top: 1, left: "54%", width: 14, height: 1, content: `{bold}{magenta-fg}[Save File]{/magenta-fg}{/bold}`, align: "center", style: btnStyle, tags: true, mouse: true, clickable: true });
    this.btnBack = blessed.button({ parent: this.buttonBar, top: 1, left: "79%", width: 12, height: 1, content: `{bold}{yellow-fg}[◄ Menu]{/yellow-fg}{/bold}`, align: "center", style: { fg: "yellow", bg: C.bgButton, focus: { bg: "yellow", fg: "black" } }, tags: true, mouse: true, clickable: true });

    // Footer
    blessed.box({
      parent: screen, bottom: 0, left: 0, width: "100%", height: 1,
      style: { fg: C.fgFooter, bg: C.bgFooter }, tags: true,
      content: " {bold}Enter{/bold}=Process  {bold}Ctrl+S{/bold}=Copy  {bold}Ctrl+B{/bold}=Save  {bold}Ctrl+R{/bold}=Reset  {bold}Ctrl+V{/bold}=Menu  {bold}↑↓{/bold}=SelectLink ",
    });

    this.inputBox.focus();
    this.resultBox.setContent(`{magenta-fg}{center}── No results yet ──{/center}{/magenta-fg}`);
  }

  bindKeys() {
    this.screen.key(["C-v"], () => this.goBack());
    this.screen.key(["C-s"], async () => await this.doCopy());
    this.screen.key(["C-b"], async () => await this.doDownloadFile());
    this.screen.key(["C-r"], () => this.reset());
    this.screen.key(["C-c"], () => { this.screen.destroy(); process.exit(0); });

    this.inputBox.key(["enter"], async () => {
      const url = this.inputBox.getValue().trim();
      if (!url) { this.log(`{yellow-fg}⚠ URL kosong!{/yellow-fg}`); return; }
      await this.process(url);
    });

    this.screen.key(["tab"], () => {
      const order = ["input", "process", "copy", "save", "back"];
      const idx = order.indexOf(this.currentFocus);
      this.currentFocus = order[(idx + 1) % order.length];
      ({ input: this.inputBox, process: this.btnProcess, copy: this.btnCopy, save: this.btnSave, back: this.btnBack }[this.currentFocus] || this.inputBox).focus();
    });

    this.screen.key(["up"], () => {
      if (this.downloadResult?.links?.length > 0) { this.selectedLinkIndex = Math.max(0, this.selectedLinkIndex - 1); this.displayResult(this.downloadResult); }
    });
    this.screen.key(["down"], () => {
      if (this.downloadResult?.links?.length > 0) { this.selectedLinkIndex = Math.min(this.downloadResult.links.length - 1, this.selectedLinkIndex + 1); this.displayResult(this.downloadResult); }
    });

    this.btnProcess.on("press", async () => {
      const url = this.inputBox.getValue().trim();
      if (!url) { this.log(`{yellow-fg}⚠ URL kosong!{/yellow-fg}`); return; }
      await this.process(url);
    });
    this.btnCopy.on("press", async () => await this.doCopy());
    this.btnSave.on("press", async () => await this.doDownloadFile());
    this.btnBack.on("press", () => this.goBack());
  }

  goBack() { this.screen.destroy(); process.exit(0); }

  log(message) {
    const ts = new Date().toLocaleTimeString("id-ID", { hour12: false });
    this.logBox.log(`{white-fg}[${ts}]{/white-fg} ${message}`);
    this.screen.render();
  }

  setStatus(status) {
    let colored = status;
    if (status.includes("READY"))       colored = `{yellow-fg}{bold}● ${status}{/bold}{/yellow-fg}`;
    else if (status.includes("COMPLETE") || status.includes("SAVED") || status.includes("COPIED"))
                                         colored = `{green-fg}{bold}● ${status}{/bold}{/green-fg}`;
    else if (status.includes("FAILED") || status.includes("ERROR"))
                                         colored = `{red-fg}{bold}● ${status}{/bold}{/red-fg}`;
    else if (status.includes("PROCESSING") || status.includes("DOWNLOADING"))
                                         colored = `{cyan-fg}{bold}● ${status}{/bold}{/cyan-fg}`;
    else                                 colored = `{white-fg}{bold}● ${status}{/bold}{/white-fg}`;
    this.statusText.setContent(colored);
    this.screen.render();
  }

  setProgress(percent) { this.progressBar.setProgress(percent); this.screen.render(); }

  reset() {
    this.inputBox.setValue("");
    this.resultBox.setContent(`{magenta-fg}{center}── No results yet ──{/center}{/magenta-fg}`);
    this.downloadResult = null;
    this.selectedLinkIndex = 0;
    this.setProgress(0);
    this.log(`{white-fg}Form reset{/white-fg}`);
    this.setStatus("READY");
    this.inputBox.focus();
    this.currentFocus = "input";
    this.screen.render();
  }

  async doCopy() {
    if (this.downloadResult?.links?.length > 0) {
      const url = this.downloadResult.links[this.selectedLinkIndex]?.url || this.downloadResult.links[0].url;
      try {
        await copyToClipboard(url);
        this.log(`{green-fg}✔ URL copied!{/green-fg}`);
        this.setStatus("COPIED ✔");
      } catch (err) {
        this.log(`{yellow-fg}⚠ ${err.message}{/yellow-fg}`);
        this.setStatus("COPY FAILED ✘");
      }
    } else {
      this.log(`{yellow-fg}⚠ No URL to copy!{/yellow-fg}`);
    }
  }

  async doDownloadFile() {
    if (!this.downloadResult?.links?.length) {
      this.log(`{yellow-fg}⚠ No URL to download!{/yellow-fg}`);
      return;
    }
    const link = this.downloadResult.links[this.selectedLinkIndex] || this.downloadResult.links[0];
    const filename = `ig-${Date.now()}.mp4`;
    const outputPath = getDownloadPath(filename);
    this.log(`{cyan-fg}[DL] Downloading...{/cyan-fg}`);
    this.setStatus("DOWNLOADING...");
    try {
      await downloadFile(link.url, outputPath, p => { this.setProgress(p); this.setStatus(`DOWNLOADING ${p}%`); });
      this.log(`{green-fg}✔ Saved: {white-fg}${outputPath}{/white-fg}{/green-fg}`);
      this.setStatus("SAVED ✔");
      this.setProgress(100);
    } catch (err) {
      this.log(`{red-fg}✘ Failed: ${err.message}{/red-fg}`);
      this.setStatus("DOWNLOAD FAILED ✘");
      this.setProgress(0);
    }
  }

  async process(url) {
    if (this.isProcessing) { this.log(`{yellow-fg}⚠ Still processing!{/yellow-fg}`); return; }
    this.isProcessing = true;
    this.downloadResult = null;
    this.selectedLinkIndex = 0;
    this.setProgress(0);
    this.setStatus("PROCESSING");
    this.log(`{magenta-fg}◈ Target:{/magenta-fg} ${url.substring(0, 55)}...`);

    try {
      this.setProgress(20);
      this.log(`{cyan-fg}[1/4]{/cyan-fg} Initializing session...`);
      this.setProgress(40);
      this.log(`{cyan-fg}[2/4]{/cyan-fg} Fetching token...`);
      this.setProgress(60);
      this.log(`{cyan-fg}[3/4]{/cyan-fg} Connecting to socket...`);
      this.setProgress(80);
      this.log(`{cyan-fg}[4/4]{/cyan-fg} Extracting links...`);
      const result = await igdl(url);
      this.downloadResult = result;
      this.setProgress(100);
      this.displayResult(result);
      this.log(`{green-fg}✔ {bold}[DONE]{/bold} Ready!{/green-fg}`);
      this.setStatus("COMPLETE ✔");
    } catch (err) {
      this.setProgress(0);
      this.log(`{red-fg}✘ ERROR: ${err.message}{/red-fg}`);
      this.setStatus("FAILED ✘");
      this.resultBox.setContent(`{red-fg}{bold}✘ ERROR:{/bold}{/red-fg}\n{white-fg}${err.message}{/white-fg}`);
    } finally {
      this.isProcessing = false;
      this.screen.render();
    }
  }

  displayResult(result) {
    let content = "";
    if (result.username) content += `{yellow-fg}{bold}User:{/bold}{/yellow-fg}  {white-fg}@${result.username}{/white-fg}\n`;
    if (result.countLikes != null) content += `{yellow-fg}{bold}Likes:{/bold}{/yellow-fg} {white-fg}${result.countLikes}{/white-fg}\n`;
    if (result.countViews != null) content += `{yellow-fg}{bold}Views:{/bold}{/yellow-fg} {white-fg}${result.countViews}{/white-fg}\n`;
    if (result.text) content += `{yellow-fg}{bold}Text:{/bold}{/yellow-fg}  {white-fg}${result.text.substring(0, 60)}...{/white-fg}\n`;
    content += `\n{magenta-fg}{bold}Download Links:{/bold}{/magenta-fg}\n`;
    if (result.links?.length > 0) {
      result.links.forEach((link, i) => {
        const sel = i === this.selectedLinkIndex;
        const marker = sel ? `{black-fg}{magenta-bg} ▶ {/magenta-bg}{/black-fg}` : `   `;
        const nc = sel ? `{magenta-fg}{bold}` : `{white-fg}`;
        const ne = sel ? `{/bold}{/magenta-fg}` : `{/white-fg}`;
        content += `${marker} ${nc}${i + 1}. ${link.text}${ne}\n`;
        content += `       {white-fg}${(link.url || "").substring(0, 35)}...{/white-fg}\n\n`;
      });
      content += `\n{yellow-fg}↑↓ select  Ctrl+S copy  Ctrl+B save{/yellow-fg}\n`;
    } else {
      content += `  {red-fg}No links found{/red-fg}\n`;
    }
    this.resultBox.setContent(content);
    this.screen.render();
  }

  start() {
    this.log(`{magenta-fg}[BOOT]{/magenta-fg} {bold}Instagram Downloader v1.0{/bold}`);
    this.log(`{cyan-fg}[INFO]{/cyan-fg} Paste Instagram URL → Enter`);
    this.log(`{yellow-fg}[INFO]{/yellow-fg} Ctrl+V = Back to Main Menu`);
    this.setStatus("READY");
    this.screen.render();
  }
}

// ═══════════════════════════════════════════════════════════════════════════════
//  BOOT
// ═══════════════════════════════════════════════════════════════════════════════
const app = new IGDownloaderTUI();
app.start();
