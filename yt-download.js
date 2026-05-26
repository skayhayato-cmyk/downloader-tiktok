#!/usr/bin/env node

/**
 * ╔══════════════════════════════════════════════════════════════════════════════╗
 * ║  YouTube Downloader  —  Installer TUI Edition  v1.0                          ║
 * ║  Project: NEXA Downloader Suite  |  Created by: NexaDev                      ║
 * ╚══════════════════════════════════════════════════════════════════════════════╝
 *
 *  Controls:
 *    Enter    → Process URL        Ctrl+S → Copy URL
 *    Ctrl+B   → Save file          Ctrl+R → Reset
 *    Ctrl+V   → Back to menu       Ctrl+C → Quit
 *    ↑/↓      → Select link        Tab    → Next field
 */

import yt from "@vreden/youtube_scraper";
import crypto from "crypto";
import axios from "axios";
import { wrapper } from "axios-cookiejar-support";
import { CookieJar } from "tough-cookie";
import blessed from "blessed";
import { spawn } from "child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import https from "node:https";

// ═══════════════════════════════════════════════════════════════════════════════
//  CONFIG
// ═══════════════════════════════════════════════════════════════════════════════
const BASE_URL = "https://youtubedl.siputzx.my.id";
const APIKEY   = null;

// ── Theme ────────────────────────────────────────────────────────────────────
const ACCENT = "red";
const YT_BRAND = [
  "", "  ┌──────────┐", "  │  N E X A │", "  └──────────┘",
  "", "  YouTube", " Downloader", "", " ──────────",
  "", "  v 1.0.0", "", " NexaDev", "", " ──────────", "", " © 2025",
];

// ═══════════════════════════════════════════════════════════════════════════════
//  YOUTUBE DOWNLOADER LOGIC
// ═══════════════════════════════════════════════════════════════════════════════

function solvePow(challenge, difficulty) {
  let nonce = 0;
  const prefix = "0".repeat(Number(difficulty));
  while (true) {
    const hash = crypto.createHash("sha256").update(challenge + nonce.toString()).digest("hex");
    if (hash.startsWith(prefix)) return nonce.toString();
    nonce++;
    if (nonce > 10000000) throw new Error("PoW solving timeout");
  }
}

function createClient() {
  const jar = new CookieJar();
  return wrapper(
    axios.create({
      jar,
      withCredentials: true,
      timeout: 60000,
      validateStatus: () => true,
      headers: {
        Accept: "application/json, text/plain, */*",
        "Content-Type": "application/json",
        "User-Agent": "Mozilla/5.0 (Linux; Android 10; K) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/147.0.0.0 Mobile Safari/537.36",
        Origin: BASE_URL,
        Referer: `${BASE_URL}/`,
        "X-Request-Id": crypto.randomUUID(),
      },
    })
  );
}

function normalizeType(type) {
  return type === "audio" || type === "mp3" ? "audio" : "merge";
}

async function downloadWithExternalAPI(type, url, apikey = null) {
  const client = createClient();
  const downloadType = normalizeType(type);

  if (!apikey) {
    const challengeRes = await client.post(`${BASE_URL}/akumaudownload`, { url, type: downloadType });
    if (challengeRes.status !== 200) throw new Error(`Challenge ${downloadType} gagal HTTP ${challengeRes.status}`);
    const { challenge, difficulty } = challengeRes.data || {};
    if (!challenge || !difficulty) throw new Error(`Challenge ${downloadType} tidak ditemukan`);
    const nonce = solvePow(challenge, difficulty);
    const verifyRes = await client.post(`${BASE_URL}/cekpunyaku`, { url, type: downloadType, nonce });
    if (verifyRes.status !== 200) throw new Error(`Verify ${downloadType} gagal HTTP ${verifyRes.status}`);
  }

  for (let attempts = 0; attempts < 30; attempts++) {
    const downloadRes = await client.get(`${BASE_URL}/download`, { params: { url, type: downloadType, apikey } });
    const data = downloadRes.data || {};
    if (data.status === "completed" && data.fileUrl) return `${BASE_URL}${data.fileUrl}`;
    if (data.status === "failed") throw new Error(data.error || `Download ${downloadType} failed`);
    await new Promise(resolve => setTimeout(resolve, 3000));
  }
  throw new Error(`Download ${downloadType} timeout`);
}

function getYoutubeId(url) {
  return (
    url.match(/youtu\.be\/([^?&/]+)/)?.[1] ||
    url.match(/[?&]v=([^?&]+)/)?.[1] ||
    url.match(/shorts\/([^?&/]+)/)?.[1] ||
    null
  );
}

function cleanMetadata(metadata = {}, inputUrl = null) {
  const thumbnails = Array.isArray(metadata?.thumbnails) ? metadata.thumbnails : [];
  const bestThumbnail =
    thumbnails.find(v => v.quality === "maxres")?.url ||
    thumbnails.find(v => v.quality === "standard")?.url ||
    thumbnails.find(v => v.quality === "high")?.url ||
    thumbnails.at(-1)?.url ||
    metadata?.thumbnail || metadata?.image || metadata?.thumb || null;
  const id = metadata?.id || metadata?.videoId || getYoutubeId(inputUrl);
  return {
    title: metadata?.title || null,
    author: metadata?.author?.name || metadata?.author || metadata?.channel_title || metadata?.channel || null,
    views: metadata?.statistics?.view ? Number(metadata.statistics.view) : metadata?.views || metadata?.viewCount || null,
    thumbnail: bestThumbnail,
    url: metadata?.url || metadata?.videoUrl || (id ? `https://youtube.com/watch?v=${id}` : inputUrl),
  };
}

async function getMetadata(url) {
  try { const data = await yt.metadata(url); return cleanMetadata(data, url); }
  catch { return cleanMetadata({}, url); }
}

async function ytdl(url) {
  if (!url) throw new Error("URL kosong");
  const youtubeRegex = /^(https?:\/\/)?(www\.)?(youtube\.com|youtu\.be|music\.youtube\.com)\/.+$/;
  if (!youtubeRegex.test(url)) throw new Error("URL YouTube tidak valid");
  const [metadata, urlVideo, urlAudio] = await Promise.all([
    getMetadata(url),
    downloadWithExternalAPI("video", url, APIKEY),
    downloadWithExternalAPI("mp3", url, APIKEY),
  ]);
  return {
    title: metadata.title,
    author: metadata.author,
    thumbnail: metadata.thumbnail,
    links: [
      { text: "Video (MP4)", url: urlVideo },
      { text: "Audio (MP3)", url: urlAudio },
    ],
  };
}

// ═══════════════════════════════════════════════════════════════════════════════
//  CLIPBOARD & FILE HELPERS
// ═══════════════════════════════════════════════════════════════════════════════

async function copyToClipboard(text) {
  const platform = process.platform;
  const tryCommand = (cmd, args, input) => new Promise((resolve, reject) => {
    const proc = spawn(cmd, args);
    proc.stdin.write(input);
    proc.stdin.end();
    proc.on("error", reject);
    proc.on("exit", code => code === 0 ? resolve(true) : reject(new Error(`${cmd} exited ${code}`)));
  });

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
//  INSTALLER-STYLE TUI  — YouTube Downloader
// ═════════════════════════════════════════════════════════════════════════════
class YouTubeDownloaderTUI {
  constructor() {
    this.scr = blessed.screen({
      smartCSR: true,
      title: "YouTube Downloader — NEXA Suite",
      mouse: true,
      cursor: { artificial: true, shape: "block", blink: false },
    });
    this.busy      = false;
    this.result    = null;
    this.linkIdx   = 0;
    this.focus     = "input";
    this._build();
    this._keys();
    this._boot();
  }

  _build() {
    const s = this.scr;

    // ── Window title bar ──────────────────────────────────────────────
    blessed.box({
      parent: s, top: 0, left: 0, width: "100%", height: 1,
      style: { bg: "white", fg: "black" },
      content: "  NEXA Downloader Suite  —  YouTube Downloader",
    });

    // ── Window frame ──────────────────────────────────────────────────
    this.win = blessed.box({
      parent: s, top: 1, left: 0,
      width: "100%", height: "100%-2",
      border: { type: "line" },
      style: { bg: "black", border: { fg: "white" } },
    });

    // ── Sidebar ───────────────────────────────────────────────────────
    blessed.box({
      parent: this.win, top: 0, left: 0,
      width: 20, height: "100%-2",
      style: { bg: "blue", fg: "white" },
      tags: true,
      content: YT_BRAND.join("\n"),
    });
    blessed.box({
      parent: this.win, bottom: 0, left: 0,
      width: 20, height: 1,
      style: { bg: ACCENT, fg: "black" },
      content: "  YouTube  ▶",
    });
    blessed.line({
      parent: this.win, top: 0, left: 20,
      orientation: "vertical", height: "100%-2",
      style: { fg: "white" },
    });

    // ── Content panel ─────────────────────────────────────────────────
    this.panel = blessed.box({
      parent: this.win, top: 0, left: 21,
      width: "100%-23", height: "100%-2",
      style: { bg: "black", fg: "white" },
    });

    // Page header
    blessed.box({
      parent: this.panel, top: 0, left: 0, width: "100%", height: 4,
      style: { bg: "white", fg: "black" }, tags: true,
      content: "\n   {bold}YouTube Downloader{/bold}\n   Paste a YouTube URL below and press [ Process ]",
    });
    blessed.line({
      parent: this.panel, top: 4, left: 0, width: "100%",
      orientation: "horizontal", style: { fg: "white" },
    });

    // Back hint
    blessed.box({
      parent: this.panel, top: 5, left: 3, width: "100%-6", height: 1,
      style: { bg: "black", fg: "white" }, tags: true,
      content: "  ◄  {bold}Ctrl+V{/bold} = Back to Setup Menu",
    });

    // URL section label
    blessed.box({
      parent: this.panel, top: 7, left: 3, width: "100%-6", height: 1,
      style: { bg: "black", fg: "white" }, tags: true,
      content: `{bold}Enter YouTube URL:{/bold}`,
    });

    // Input box
    this.inputBox = blessed.textbox({
      parent: this.panel, top: 8, left: 3, width: "100%-6", height: 3,
      border: { type: "line" },
      style: {
        fg: "white", bg: "black", border: { fg: "white" },
        focus: { border: { fg: ACCENT } },
      },
      inputOnFocus: true, value: "", tags: true,
    });

    // Progress label + bar
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

    // Status
    this.statusBox = blessed.box({
      parent: this.panel, top: 14, left: 3, width: "100%-6", height: 1,
      style: { bg: "black", fg: "white" }, tags: true,
      content: "{white-fg}● READY{/white-fg}",
    });

    // Separator
    blessed.line({
      parent: this.panel, top: 16, left: 0, width: "100%",
      orientation: "horizontal", style: { fg: "white" },
    });

    // LOG panel
    blessed.box({
      parent: this.panel, top: 17, left: 3, width: 10, height: 1,
      style: { bg: "black", fg: "white" }, tags: true,
      content: `{${ACCENT}-fg}{bold}[ LOG ]{/bold}{/${ACCENT}-fg}`,
    });
    this.logBox = blessed.log({
      parent: this.panel, top: 18, left: 3, width: "55%-3", height: "100%-24",
      border: { type: "line" },
      style: { fg: "white", bg: "black", border: { fg: "white" },
               scrollbar: { bg: ACCENT } },
      scrollable: true, alwaysScroll: true, tags: true,
      scrollbar: { ch: "▒" },
    });

    // LINKS panel
    blessed.box({
      parent: this.panel, top: 17, left: "55%", width: 12, height: 1,
      style: { bg: "black", fg: "white" }, tags: true,
      content: `{${ACCENT}-fg}{bold}[ LINKS ]{/bold}{/${ACCENT}-fg}`,
    });
    this.resultBox = blessed.box({
      parent: this.panel, top: 18, left: "55%", width: "45%-3", height: "100%-24",
      border: { type: "line" },
      style: { fg: "white", bg: "black", border: { fg: "white" },
               scrollbar: { bg: ACCENT } },
      scrollable: true, alwaysScroll: true, tags: true,
      scrollbar: { ch: "▒" },
      content: "  No results yet.",
    });

    // Button row separator
    blessed.line({
      parent: this.panel, bottom: 4, left: 0, width: "100%",
      orientation: "horizontal", style: { fg: "white" },
    });

    // Buttons
    const BS = { bg: "black", fg: "white", border: { fg: "white" },
                 focus: { bg: ACCENT, fg: "black" }, hover: { bg: ACCENT, fg: "black" } };

    this.btnProcess = this._btn(this.panel, "bottom", 1, "left",  3,  14, " Process ", BS);
    this.btnCopy    = this._btn(this.panel, "bottom", 1, "left",  20, 14, " Copy URL ", BS);
    this.btnSave    = this._btn(this.panel, "bottom", 1, "left",  37, 14, " Save File ", BS);
    this.btnReset   = this._btn(this.panel, "bottom", 1, "left",  54, 12, " Reset ", BS);
    this.btnBack    = this._btn(this.panel, "bottom", 1, "right",  1, 14, " ◄ Menu ",
                      { bg: "white", fg: "black", border: { fg: "white" },
                        focus: { bg: "white", fg: "black" }, hover: { bg: "white", fg: "black" } });

    // Status bar
    blessed.box({
      parent: s, bottom: 0, left: 0, width: "100%", height: 1,
      style: { bg: "white", fg: "black" },
      content: "  Enter=Process  Ctrl+S=Copy  Ctrl+B=Save  Ctrl+R=Reset  Ctrl+V=Menu  ↑↓=Link",
    });

    this.inputBox.focus();
  }

  _btn(parent, vSide, vVal, hSide, hVal, width, label, style) {
    const opts = {
      parent, [vSide]: vVal, [hSide]: hVal,
      width, height: 3,
      border: { type: "line" },
      align: "center", valign: "middle",
      style, tags: true, content: `{bold}${label}{/bold}`,
      mouse: true, clickable: true,
    };
    return blessed.button(opts);
  }

  _keys() {
    this.scr.key(["C-v"], () => this._back());
    this.scr.key(["C-c"], () => { this.scr.destroy(); process.exit(0); });
    this.scr.key(["C-s"], async () => await this._copy());
    this.scr.key(["C-b"], async () => await this._save());
    this.scr.key(["C-r"], () => this._reset());
    this.scr.key(["up"],  () => { if (this.result?.links?.length) { this.linkIdx = Math.max(0, this.linkIdx - 1); this._showResult(); } });
    this.scr.key(["down"],() => { if (this.result?.links?.length) { this.linkIdx = Math.min(this.result.links.length - 1, this.linkIdx + 1); this._showResult(); } });

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
    let c = `{white-fg}● ${s}{/white-fg}`;
    if (s.includes("READY"))                                   c = `{white-fg}● ${s}{/white-fg}`;
    else if (s.includes("DONE") || s.includes("SAVED") || s.includes("COPIED")) c = `{green-fg}● ${s}{/green-fg}`;
    else if (s.includes("ERR") || s.includes("FAIL"))          c = `{red-fg}● ${s}{/red-fg}`;
    else if (s.includes("PROC") || s.includes("LOAD"))         c = `{${ACCENT}-fg}● ${s}{/${ACCENT}-fg}`;
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
    this.inputBox.focus();
    this.scr.render();
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
    const ext  = link.text.includes("MP3") ? "mp3" : "mp4";
    const name = (this.result.title || "youtube").replace(/[^a-zA-Z0-9]/g, "_").substring(0, 50);
    const out  = getDownloadPath(`${name}.${ext}`);
    this._log("{white-fg}Downloading...{/white-fg}");
    this._status("DOWNLOADING");
    try {
      await downloadFile(link.url, out, p => { this._prog(p); this._status(`LOADING ${p}%`); });
      this._log(`{green-fg}✔ Saved: ${out}{/green-fg}`);
      this._status("SAVED ✔"); this._prog(100);
    } catch (e) {
      this._log(`{red-fg}✘ ${e.message}{/red-fg}`); this._status("FAILED"); this._prog(0);
    }
  }

  async _process(url) {
    if (this.busy) { this._log("{yellow-fg}⚠ Still processing!{/yellow-fg}"); return; }
    this.busy = true; this.result = null; this.linkIdx = 0;
    this._prog(0); this._status("PROCESSING");
    this._log(`{${ACCENT}-fg}▶ ${url.substring(0, 55)}{/${ACCENT}-fg}`);
    try {
      this._prog(20); this._log("{white-fg}[1/3] Fetching metadata...{/white-fg}");
      this._prog(45); this._log("{white-fg}[2/3] Solving PoW...{/white-fg}");
      this._prog(70); this._log("{white-fg}[3/3] Getting links...{/white-fg}");
      this.result = await ytdl(url);
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
    if (this.result.title)  c += `Title:   ${this.result.title}\n`;
    if (this.result.author) c += `Author:  ${this.result.author}\n`;
    c += `\nLinks:\n`;
    (this.result.links || []).forEach((l, i) => {
      const sel = i === this.linkIdx;
      c += sel
        ? `{${ACCENT}-fg}{bold} ▶ ${i+1}. ${l.text}{/bold}{/${ACCENT}-fg}\n   ${l.url.substring(0,40)}...\n\n`
        : `   ${i+1}. ${l.text}\n   ${l.url.substring(0,40)}...\n\n`;
    });
    c += `\n↑↓=select  Ctrl+S=copy  Ctrl+B=save`;
    this.resultBox.setContent(c);
    this.scr.render();
  }

  _boot() {
    this._log(`{${ACCENT}-fg}YouTube Downloader ready.{/${ACCENT}-fg}`);
    this._log("{white-fg}Ctrl+V = Back to menu{/white-fg}");
    this._status("READY");
    this.scr.render();
  }
}

// ─────────────────────────────────────────────────────────────────────────────
const app = new YouTubeDownloaderTUI();
