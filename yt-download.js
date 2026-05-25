#!/usr/bin/env node

/**
 * ╔══════════════════════════════════════════════════════════════════════════════╗
 * ║  YouTube Downloader - Retro Terminal Edition v1.0                            ║
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

// ─── UTF-8 / Unicode fix ─────────────────────────────────────────────────────
process.env.LANG     = process.env.LANG     || "en_US.UTF-8";
process.env.LC_ALL   = process.env.LC_ALL   || "en_US.UTF-8";
process.env.LC_CTYPE = process.env.LC_CTYPE || "en_US.UTF-8";
if (process.stdout.setDefaultEncoding) process.stdout.setDefaultEncoding("utf8");
if (process.stderr.setDefaultEncoding) process.stderr.setDefaultEncoding("utf8");
// ─────────────────────────────────────────────────────────────────────────────

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

// ═══════════════════════════════════════════════════════════════════════════════
//  COLOR PALETTE
// ═══════════════════════════════════════════════════════════════════════════════
const C = {
  bgMain:        "black",
  bgDialog:      "black",
  bgInput:       "black",
  bgInputFocus:  "black",
  bgButton:      "black",
  bgButtonFocus: "red",
  fgBorder:      "red",
  fgTitle:       "yellow",
  fgLabel:       "red",
  fgInput:       "white",
  fgStatus:      "yellow",
  fgLog:         "white",
  fgResult:      "red",
  fgButton:      "red",
  fgButtonFocus: "black",
  fgFooter:      "black",
  bgFooter:      "red",
  fgSep:         "red",
  fgScrollbar:   "red",
  fgProgress:    "red",
};

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

// ═══════════════════════════════════════════════════════════════════════════════
//  TUI CLASS
// ═══════════════════════════════════════════════════════════════════════════════

class YouTubeDownloaderTUI {
  constructor() {
    this.screen = blessed.screen({
      smartCSR: true,
      fullUnicode: true,
      forceUnicode: true,
      title: "YouTube Downloader - NEXA Suite",
      mouse: true,
      cursor: { artificial: true, shape: "underline", blink: true, color: "red" },
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
    this.titleBox = blessed.box({
      parent: this.dialog, top: 0, left: 0, width: "100%", height: 1,
      align: "center",
      style: { fg: C.fgTitle, bg: C.bgDialog },
      tags: true,
      content: `{yellow-fg}{bold}▓▒░ NEXA  ▶  YouTube Downloader v1.0 ░▒▓{/bold}{/yellow-fg}`,
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
      content: `{red-fg}{bold}► Enter YouTube URL:{/bold}{/red-fg}\n{white-fg}  (youtube.com, youtu.be, music.youtube.com){/white-fg}`,
    });

    // Input box
    this.inputBox = blessed.textbox({
      parent: this.dialog, top: 6, left: 2, width: "100%-4", height: 3,
      border: { type: "line", fg: C.fgBorder },
      style: {
        fg: C.fgInput, bg: C.bgInput,
        border: { fg: C.fgBorder },
        focus: { bg: C.bgInputFocus, border: { fg: "yellow" } },
      },
      inputOnFocus: true, value: "", tags: true,
    });

    // Progress label
    blessed.box({
      parent: this.dialog, top: 10, left: 2, width: "100%-4", height: 1,
      style: { fg: C.fgLabel, bg: C.bgDialog }, tags: true,
      content: `{red-fg}{bold}Progress:{/bold}{/red-fg}`,
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

    // Log label
    blessed.box({
      parent: this.dialog, top: 15, left: 2, width: 12, height: 1,
      style: { fg: C.fgLabel, bg: C.bgDialog }, tags: true,
      content: `{red-fg}{bold}[ LOG ]{/bold}{/red-fg}`,
    });

    // Log box
    this.logBox = blessed.log({
      parent: this.dialog, top: 16, left: 2, width: "55%", height: "100%-21",
      border: { type: "line", fg: C.fgBorder },
      style: { fg: C.fgLog, bg: C.bgDialog, border: { fg: C.fgBorder }, scrollbar: { bg: C.fgScrollbar } },
      scrollable: true, alwaysScroll: true, tags: true,
      scrollbar: { ch: "▒", style: { bg: C.fgScrollbar, fg: C.bgMain } },
    });

    // Result label
    blessed.box({
      parent: this.dialog, top: 15, left: "55%+1", width: 14, height: 1,
      style: { fg: C.fgLabel, bg: C.bgDialog }, tags: true,
      content: `{red-fg}{bold}[ LINKS ]{/bold}{/red-fg}`,
    });

    // Result box
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

    this.btnProcess = blessed.button({
      parent: this.buttonBar, top: 1, left: "5%", width: 14, height: 1,
      content: `{bold}{red-fg}[Process]{/red-fg}{/bold}`, align: "center",
      style: btnStyle, tags: true, mouse: true, clickable: true,
    });
    this.btnCopy = blessed.button({
      parent: this.buttonBar, top: 1, left: "29%", width: 14, height: 1,
      content: `{bold}{red-fg}[Copy URL]{/red-fg}{/bold}`, align: "center",
      style: btnStyle, tags: true, mouse: true, clickable: true,
    });
    this.btnSave = blessed.button({
      parent: this.buttonBar, top: 1, left: "54%", width: 14, height: 1,
      content: `{bold}{red-fg}[Save File]{/red-fg}{/bold}`, align: "center",
      style: btnStyle, tags: true, mouse: true, clickable: true,
    });
    this.btnBack = blessed.button({
      parent: this.buttonBar, top: 1, left: "79%", width: 12, height: 1,
      content: `{bold}{yellow-fg}[◄ Menu]{/yellow-fg}{/bold}`, align: "center",
      style: { fg: "yellow", bg: C.bgButton, focus: { bg: "yellow", fg: "black" } },
      tags: true, mouse: true, clickable: true,
    });

    // Footer
    this.footer = blessed.box({
      parent: screen, bottom: 0, left: 0, width: "100%", height: 1,
      style: { fg: C.fgFooter, bg: C.bgFooter }, tags: true,
      content: " {bold}Enter{/bold}=Process  {bold}Ctrl+S{/bold}=Copy  {bold}Ctrl+B{/bold}=Save  {bold}Ctrl+R{/bold}=Reset  {bold}Ctrl+V{/bold}=Menu  {bold}↑↓{/bold}=SelectLink ",
    });

    this.inputBox.focus();
    this.resultBox.setContent(`{red-fg}{center}── No results yet ──{/center}{/red-fg}`);
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
      if (this.downloadResult?.links?.length > 0) {
        this.selectedLinkIndex = Math.max(0, this.selectedLinkIndex - 1);
        this.displayResult(this.downloadResult);
      }
    });
    this.screen.key(["down"], () => {
      if (this.downloadResult?.links?.length > 0) {
        this.selectedLinkIndex = Math.min(this.downloadResult.links.length - 1, this.selectedLinkIndex + 1);
        this.displayResult(this.downloadResult);
      }
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

  goBack() {
    this.screen.destroy();
    process.exit(0);
  }

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
    this.resultBox.setContent(`{red-fg}{center}── No results yet ──{/center}{/red-fg}`);
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
        this.log(`{green-fg}✔ URL copied to clipboard!{/green-fg}`);
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
    const ext = link.text.includes("MP3") ? "mp3" : "mp4";
    const safeTitle = (this.downloadResult.title || "youtube-video")
      .replace(/[^a-zA-Z0-9]/g, "_").substring(0, 50);
    const outputPath = getDownloadPath(`${safeTitle}.${ext}`);
    this.log(`{cyan-fg}[DL] Downloading...{/cyan-fg}`);
    this.setStatus("DOWNLOADING...");
    try {
      await downloadFile(link.url, outputPath, p => { this.setProgress(p); this.setStatus(`DOWNLOADING ${p}%`); });
      this.log(`{green-fg}✔ Saved: {white-fg}${outputPath}{/white-fg}{/green-fg}`);
      this.setStatus("SAVED ✔");
      this.setProgress(100);
    } catch (err) {
      this.log(`{red-fg}✘ Download failed: ${err.message}{/red-fg}`);
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
    this.log(`{red-fg}▶ Target:{/red-fg} ${url.substring(0, 55)}...`);

    try {
      this.setProgress(20);
      this.log(`{cyan-fg}[1/3]{/cyan-fg} Fetching metadata...`);
      this.setProgress(40);
      this.log(`{cyan-fg}[2/3]{/cyan-fg} Solving PoW challenge...`);
      this.setProgress(60);
      this.log(`{cyan-fg}[3/3]{/cyan-fg} Getting download links...`);
      const result = await ytdl(url);
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
    if (result.title)  content += `{yellow-fg}{bold}Title:{/bold}{/yellow-fg}  {white-fg}${result.title}{/white-fg}\n`;
    if (result.author) content += `{yellow-fg}{bold}Author:{/bold}{/yellow-fg} {white-fg}${result.author}{/white-fg}\n`;
    if (result.thumbnail) content += `{yellow-fg}{bold}Thumb:{/bold}{/yellow-fg}  {white-fg}${result.thumbnail.substring(0, 32)}...{/white-fg}\n`;
    content += `\n{red-fg}{bold}Download Links:{/bold}{/red-fg}\n`;
    if (result.links?.length > 0) {
      result.links.forEach((link, i) => {
        const sel = i === this.selectedLinkIndex;
        const marker = sel ? `{black-fg}{red-bg} ▶ {/red-bg}{/black-fg}` : `   `;
        const nc = sel ? `{red-fg}{bold}` : `{white-fg}`;
        const ne = sel ? `{/bold}{/red-fg}` : `{/white-fg}`;
        content += `${marker} ${nc}${i + 1}. ${link.text}${ne}\n`;
        content += `       {white-fg}${link.url.substring(0, 35)}...{/white-fg}\n\n`;
      });
      content += `\n{yellow-fg}↑↓ select  Ctrl+S copy  Ctrl+B save{/yellow-fg}\n`;
    } else {
      content += `  {red-fg}No links found{/red-fg}\n`;
    }
    this.resultBox.setContent(content);
    this.screen.render();
  }

  start() {
    this.log(`{red-fg}[BOOT]{/red-fg} {bold}YouTube Downloader v1.0{/bold}`);
    this.log(`{cyan-fg}[INFO]{/cyan-fg} Paste YouTube URL → Enter`);
    this.log(`{yellow-fg}[INFO]{/yellow-fg} Ctrl+V = Back to Main Menu`);
    this.setStatus("READY");
    this.screen.render();
  }
}

// ═══════════════════════════════════════════════════════════════════════════════
//  BOOT
// ═══════════════════════════════════════════════════════════════════════════════
const app = new YouTubeDownloaderTUI();
app.start();
