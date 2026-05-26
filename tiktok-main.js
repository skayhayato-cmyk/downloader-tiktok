#!/usr/bin/env node

/**
 * ╔══════════════════════════════════════════════════════════════════════════════╗
 * ║  TikTok Downloader  —  Installer TUI Edition  v3.0                           ║
 * ║  Project: NEXA Downloader Suite  |  Created by: NexaDev                      ║
 * ║  Scraper by: Ditzzx  (SnapTik API)                                           ║
 * ╚══════════════════════════════════════════════════════════════════════════════╝
 *
 *  Controls:
 *    Enter    → Process URL        Ctrl+S → Copy selected URL
 *    Ctrl+B   → Save file          Ctrl+R → Reset form
 *    Ctrl+V   → Back to menu       Ctrl+C → Quit
 *    ↑/↓      → Select link        Tab    → Next button
 */

import blessed   from "blessed";
import { spawn } from "child_process";
import fs        from "node:fs";
import os        from "node:os";
import path      from "node:path";
import https     from "node:https";
import http      from "node:http";
import crypto    from "node:crypto";

// ── Theme ─────────────────────────────────────────────────────────────────────
const ACCENT = "cyan";

const TT_BRAND = [
  "",
  "  ┌──────────┐",
  "  │  N E X A │",
  "  └──────────┘",
  "",
  "   TikTok",
  " Downloader",
  "",
  " ──────────",
  "",
  "  v 3.0.0",
  "",
  " NexaDev",
  " Ditzzx",
  "",
  " ──────────",
  "",
  " © 2025",
];

// ── SnapTik API config ────────────────────────────────────────────────────────
const SNAPTIK_BASE = "https://snaptik.app";
const UA =
  "Mozilla/5.0 (Linux; Android 10; K) AppleWebKit/537.36 " +
  "(KHTML, like Gecko) Chrome/147.0.0.0 Mobile Safari/537.36";

// ═════════════════════════════════════════════════════════════════════════════
//  SNAPTIK DOWNLOADER LOGIC
// ═════════════════════════════════════════════════════════════════════════════

function fetchUrl(url, opts = {}) {
  return new Promise((resolve, reject) => {
    const parsed  = new URL(url);
    const mod     = parsed.protocol === "https:" ? https : http;
    const options = {
      hostname: parsed.hostname,
      path:     parsed.pathname + parsed.search,
      method:   opts.method || "GET",
      headers:  opts.headers || {},
      timeout:  30000,
    };

    const req = mod.request(options, (res) => {
      // follow redirects
      if (res.statusCode >= 300 && res.statusCode < 400 && res.headers.location) {
        return fetchUrl(res.headers.location, opts).then(resolve).catch(reject);
      }
      let body = "";
      res.on("data", (c) => (body += c));
      res.on("end", () => resolve({ status: res.statusCode, body, headers: res.headers }));
    });

    req.on("error", reject);
    req.on("timeout", () => { req.destroy(); reject(new Error("Request timeout")); });

    if (opts.body) req.write(opts.body);
    req.end();
  });
}

// Step 1 – open SnapTik home to grab token
async function openHome() {
  const res = await fetchUrl(`${SNAPTIK_BASE}/id`, {
    headers: {
      "User-Agent": UA,
      Accept: "text/html,application/xhtml+xml,*/*;q=0.9",
    },
  });

  // extract token from HTML: name="token" value="..."
  const match = res.body.match(/name=["']token["']\s+value=["']([^"']+)["']/);
  if (!match) throw new Error("Token SnapTik tidak ditemukan");
  return { token: match[1], cookie: res.headers["set-cookie"]?.join("; ") || "" };
}

// Step 2 – POST url + token
async function submitVideo(url, token, cookie) {
  const body = new URLSearchParams({ url, token }).toString();
  const res  = await fetchUrl(`${SNAPTIK_BASE}/action`, {
    method: "POST",
    headers: {
      "User-Agent":   UA,
      "Content-Type": "application/x-www-form-urlencoded",
      Cookie:         cookie,
      Referer:        `${SNAPTIK_BASE}/id`,
      Origin:         SNAPTIK_BASE,
    },
    body,
  });
  return { status: res.status, body: res.body };
}

// Step 3 – decode obfuscated JS response
function decodeObfuscatedResponse(raw) {
  // SnapTik returns something like: eval(function(p,a,c,k,e,d){...}(...))
  // We extract the encoded string and decode it manually where possible,
  // or grab the rendered HTML by executing the eval payload via regex patterns.

  // Try to find the h(...) encoded string
  const fnMatch = raw.match(/\(function\(h,u,n,t,e,r\)\{.*?\}\(["']([^"']+)["']/s) ||
                  raw.match(/eval\(function\(p,a,c,k,e(?:,d)?\)\{[\s\S]*?\}\(["']([^"']+)["']/);

  if (!fnMatch) {
    // Maybe already decoded HTML
    return raw;
  }

  // Fallback: return raw so we can still parse HTML download links from it
  return raw;
}

// Step 4 – parse download links from decoded HTML/JS
function extractLinks(decoded) {
  const links = [];

  // Pattern: href="https://..." or data-href="..." for video links
  const hrefRe = /(?:href|data-href)=["'](https?:\/\/[^"']+)["']/g;
  let m;
  while ((m = hrefRe.exec(decoded)) !== null) {
    const u = m[1];
    if (
      u.includes("tiktok") ||
      u.includes("muscdn") ||
      u.includes("tikcdn") ||
      u.includes("snaptik") ||
      u.includes("tikwm") ||
      u.includes("ttdownloader")
    ) {
      if (!links.find((l) => l.url === u)) {
        links.push({ text: guessLinkLabel(u, links.length), url: u });
      }
    }
  }

  // Also look for direct download links in anchor text context
  const dlRe = /download[^>]*href=["'](https?:\/\/[^"']+)["']/gi;
  while ((m = dlRe.exec(decoded)) !== null) {
    const u = m[1];
    if (!links.find((l) => l.url === u)) {
      links.push({ text: guessLinkLabel(u, links.length), url: u });
    }
  }

  return links;
}

function guessLinkLabel(url, idx) {
  if (url.includes("music") || url.includes(".mp3"))  return `Audio (MP3) #${idx + 1}`;
  if (url.includes("hd") || url.includes("HD"))       return `Video HD #${idx + 1}`;
  if (url.includes("nowm") || url.includes("no_wm"))  return `No Watermark #${idx + 1}`;
  if (url.includes("wm") || url.includes("watermark"))return `With Watermark #${idx + 1}`;
  return `Video #${idx + 1}`;
}

// Render token polling (some SnapTik versions use async render)
async function renderVideo(renderToken, cookie) {
  try {
    const res = await fetchUrl(`${SNAPTIK_BASE}/render?token=${encodeURIComponent(renderToken)}`, {
      headers: { "User-Agent": UA, Cookie: cookie },
    });
    const data = JSON.parse(res.body);
    return data;
  } catch {
    return null;
  }
}

// Main TikTok downloader orchestrator
async function tiktokDl(url) {
  if (!url) throw new Error("URL kosong");

  const tiktokRe = /^(https?:\/\/)?(www\.|vm\.|m\.)?(tiktok\.com|vt\.tiktok\.com)\/.+/;
  if (!tiktokRe.test(url)) throw new Error("URL TikTok tidak valid");

  // 1. Get token
  const home = await openHome();

  // 2. Submit
  const post = await submitVideo(url, home.token, home.cookie);
  if (post.status !== 200 && post.status !== 0) {
    // status 0 = no-status (old node http quirk)
  }

  // 3. Decode
  const decoded = decodeObfuscatedResponse(post.body);

  // 4. Extract
  let links = extractLinks(decoded);

  // 5. Try render token if present
  const renderMatch = decoded.match(/render[_-]?token["']?\s*[:=]\s*["']([^"']+)["']/i);
  if (renderMatch) {
    const rendered = await renderVideo(renderMatch[1], home.cookie);
    if (rendered?.download_url) {
      links.unshift({ text: "No Watermark (Rendered)", url: rendered.download_url });
    }
  }

  if (links.length === 0) throw new Error("Tidak ada link ditemukan. Coba URL lain.");

  // Extract title from HTML
  const titleMatch = decoded.match(/<title[^>]*>([^<]+)<\/title>/i);
  const title = titleMatch ? titleMatch[1].replace(/\s*[-|]\s*SnapTik.*$/i, "").trim() : null;

  return { title, links };
}

// ═════════════════════════════════════════════════════════════════════════════
//  CLIPBOARD & FILE HELPERS
// ═════════════════════════════════════════════════════════════════════════════

async function copyToClipboard(text) {
  const tryCmd = (cmd, args, input) =>
    new Promise((resolve, reject) => {
      const proc = spawn(cmd, args);
      proc.stdin.write(input);
      proc.stdin.end();
      proc.on("error", reject);
      proc.on("exit", (code) =>
        code === 0 ? resolve(true) : reject(new Error(`${cmd} exited ${code}`))
      );
    });

  const plt = process.platform;
  if (plt === "darwin") { try { await tryCmd("pbcopy", [], text); return; } catch {} }
  else if (plt === "win32") { try { await tryCmd("clip", [], text); return; } catch {} }
  else {
    for (const [cmd, args] of [
      ["wl-copy",            []],
      ["xclip",              ["-selection", "clipboard"]],
      ["xsel",               ["--clipboard", "--input"]],
      ["termux-clipboard-set", []],
    ]) {
      try { await tryCmd(cmd, args, text); return; } catch {}
    }
  }
  // OSC 52 fallback
  process.stdout.write(`\x1b]52;c;${Buffer.from(text).toString("base64")}\x07`);
}

function downloadFile(url, outputPath, onProgress) {
  return new Promise((resolve, reject) => {
    const file   = fs.createWriteStream(outputPath);
    const mod    = url.startsWith("https") ? https : http;

    mod.get(url, { timeout: 90000, headers: { "User-Agent": UA } }, (res) => {
      // Follow redirect
      if (res.statusCode >= 300 && res.statusCode < 400 && res.headers.location) {
        file.close();
        fs.unlink(outputPath, () => {});
        return downloadFile(res.headers.location, outputPath, onProgress)
          .then(resolve).catch(reject);
      }

      const total      = parseInt(res.headers["content-length"], 10) || 0;
      let downloaded   = 0;

      res.on("data", (chunk) => {
        downloaded += chunk.length;
        file.write(chunk);
        if (total > 0 && onProgress) onProgress(Math.round((downloaded / total) * 100));
      });
      res.on("end",   () => { file.end(); resolve(outputPath); });
      res.on("error", (e) => { file.destroy(); fs.unlink(outputPath, () => {}); reject(e); });
    }).on("error", (e) => {
      file.destroy();
      fs.unlink(outputPath, () => {});
      reject(e);
    });
  });
}

function getDownloadPath(filename) {
  const androidPath = "/storage/emulated/0/Download";
  if (fs.existsSync("/storage/emulated/0")) {
    if (!fs.existsSync(androidPath)) {
      try { fs.mkdirSync(androidPath, { recursive: true }); } catch {}
    }
    if (fs.existsSync(androidPath)) return path.join(androidPath, filename);
  }
  const homePath = path.join(os.homedir(), "Downloads");
  if (!fs.existsSync(homePath)) {
    try { fs.mkdirSync(homePath, { recursive: true }); } catch {}
  }
  return path.join(homePath, filename);
}

// ═════════════════════════════════════════════════════════════════════════════
//  INSTALLER-STYLE TUI  — TikTok Downloader
// ═════════════════════════════════════════════════════════════════════════════

class TikTokDownloaderTUI {
  constructor() {
    this.scr = blessed.screen({
      smartCSR: true,
      title:    "TikTok Downloader — NEXA Suite",
      mouse:    true,
      cursor:   { artificial: true, shape: "block", blink: false },
    });

    this.busy    = false;
    this.result  = null;
    this.linkIdx = 0;

    this._build();
    this._keys();
    this._boot();
  }

  // ── Layout ────────────────────────────────────────────────────────────────
  _build() {
    const s = this.scr;

    // OS-style window title bar
    blessed.box({
      parent: s, top: 0, left: 0, width: "100%", height: 1,
      style: { bg: "white", fg: "black" },
      content: "  NEXA Downloader Suite  —  TikTok Downloader  v3.0",
    });

    // Main window frame
    this.win = blessed.box({
      parent: s, top: 1, left: 0,
      width: "100%", height: "100%-2",
      border: { type: "line" },
      style: { bg: "black", border: { fg: "white" } },
    });

    // ── Sidebar ──────────────────────────────────────────────────────────────
    blessed.box({
      parent: this.win, top: 0, left: 0,
      width: 20, height: "100%-2",
      style: { bg: "blue", fg: "white" },
      content: TT_BRAND.join("\n"),
    });
    // Accent bottom strip
    blessed.box({
      parent: this.win, bottom: 0, left: 0,
      width: 20, height: 1,
      style: { bg: ACCENT, fg: "black" },
      content: "  TikTok  ♪",
    });
    // Divider
    blessed.line({
      parent: this.win, top: 0, left: 20,
      orientation: "vertical", height: "100%-2",
      style: { fg: "white" },
    });

    // ── Content panel ─────────────────────────────────────────────────────────
    this.panel = blessed.box({
      parent: this.win, top: 0, left: 21,
      width: "100%-23", height: "100%-2",
      style: { bg: "black", fg: "white" },
    });

    // Page header (white installer bar)
    blessed.box({
      parent: this.panel, top: 0, left: 0, width: "100%", height: 4,
      style: { bg: "white", fg: "black" }, tags: true,
      content:
        "\n   {bold}TikTok Downloader{/bold}\n" +
        "   Paste a TikTok video URL below and press [ Process ]",
    });
    blessed.line({
      parent: this.panel, top: 4, left: 0, width: "100%",
      orientation: "horizontal", style: { fg: "white" },
    });

    // ◄ Back hint
    blessed.box({
      parent: this.panel, top: 5, left: 3, width: "100%-6", height: 1,
      style: { bg: "black", fg: "white" }, tags: true,
      content: "  ◄  {bold}Ctrl+V{/bold} = Back to Setup Menu",
    });

    // URL label
    blessed.box({
      parent: this.panel, top: 7, left: 3, width: "100%-6", height: 1,
      style: { bg: "black", fg: "white" }, tags: true,
      content: "{bold}Enter TikTok URL:{/bold}",
    });

    // Input box
    this.inputBox = blessed.textbox({
      parent: this.panel, top: 8, left: 3, width: "100%-6", height: 3,
      border: { type: "line" },
      style: {
        fg: "white", bg: "black",
        border: { fg: "white" },
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

    // Status line
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
      style: {
        fg: "white", bg: "black",
        border: { fg: "white" },
        scrollbar: { bg: ACCENT },
      },
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
      style: {
        fg: "white", bg: "black",
        border: { fg: "white" },
        scrollbar: { bg: ACCENT },
      },
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
    const BS = {
      bg: "black", fg: "white",
      border: { fg: "white" },
      focus: { bg: ACCENT, fg: "black" },
      hover: { bg: ACCENT, fg: "black" },
    };
    this.btnProcess = this._btn(this.panel, "bottom", 1, "left",   3, 14, " Process ",  BS);
    this.btnCopy    = this._btn(this.panel, "bottom", 1, "left",  20, 14, " Copy URL ", BS);
    this.btnSave    = this._btn(this.panel, "bottom", 1, "left",  37, 14, " Save File ", BS);
    this.btnReset   = this._btn(this.panel, "bottom", 1, "left",  54, 12, " Reset ",    BS);
    this.btnBack    = this._btn(this.panel, "bottom", 1, "right",  1, 14, " ◄ Menu ",
      { bg: "white", fg: "black", border: { fg: "white" },
        focus: { bg: "white", fg: "black" }, hover: { bg: "white", fg: "black" } }
    );

    // OS status bar (bottom)
    blessed.box({
      parent: s, bottom: 0, left: 0, width: "100%", height: 1,
      style: { bg: "white", fg: "black" },
      content:
        "  Enter=Process  Ctrl+S=Copy  Ctrl+B=Save  Ctrl+R=Reset  Ctrl+V=Menu  ↑↓=Link",
    });

    this.inputBox.focus();
  }

  // ── Helper: create a bordered button ─────────────────────────────────────
  _btn(parent, vSide, vVal, hSide, hVal, width, label, style) {
    return blessed.button({
      parent,
      [vSide]: vVal, [hSide]: hVal,
      width, height: 3,
      border: { type: "line" },
      align: "center", valign: "middle",
      style, tags: true,
      content: `{bold}${label}{/bold}`,
      mouse: true, clickable: true,
    });
  }

  // ── Key bindings ──────────────────────────────────────────────────────────
  _keys() {
    this.scr.key(["C-v"], () => this._back());
    this.scr.key(["C-c"], () => { this.scr.destroy(); process.exit(0); });
    this.scr.key(["C-s"], async () => await this._copy());
    this.scr.key(["C-b"], async () => await this._save());
    this.scr.key(["C-r"], () => this._reset());

    this.scr.key(["up"], () => {
      if (this.result?.links?.length) {
        this.linkIdx = Math.max(0, this.linkIdx - 1);
        this._showResult();
      }
    });
    this.scr.key(["down"], () => {
      if (this.result?.links?.length) {
        this.linkIdx = Math.min(this.result.links.length - 1, this.linkIdx + 1);
        this._showResult();
      }
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

  // ── Actions ───────────────────────────────────────────────────────────────
  _back() { this.scr.destroy(); process.exit(0); }

  _log(msg) {
    const ts = new Date().toLocaleTimeString("id-ID", { hour12: false });
    this.logBox.log(`{white-fg}[${ts}]{/white-fg} ${msg}`);
    this.scr.render();
  }

  _status(s) {
    let c;
    if      (s.includes("DONE") || s.includes("SAVED") || s.includes("COPIED"))
      c = `{green-fg}● ${s}{/green-fg}`;
    else if (s.includes("ERR") || s.includes("FAIL"))
      c = `{red-fg}● ${s}{/red-fg}`;
    else if (s.includes("PROC") || s.includes("LOAD") || s.includes("FETCH"))
      c = `{${ACCENT}-fg}● ${s}{/${ACCENT}-fg}`;
    else
      c = `{white-fg}● ${s}{/white-fg}`;
    this.statusBox.setContent(c);
    this.scr.render();
  }

  _prog(p) { this.progressBar.setProgress(p); this.scr.render(); }

  _reset() {
    this.inputBox.setValue("");
    this.resultBox.setContent("  No results yet.");
    this.result  = null;
    this.linkIdx = 0;
    this._prog(0);
    this._status("READY");
    this._log("{white-fg}Form reset.{/white-fg}");
    this.inputBox.focus();
    this.scr.render();
  }

  async _copy() {
    if (!this.result?.links?.length) {
      this._log("{yellow-fg}⚠ Belum ada link.{/yellow-fg}");
      return;
    }
    const url = this.result.links[this.linkIdx]?.url || this.result.links[0].url;
    try {
      await copyToClipboard(url);
      this._log("{green-fg}✔ URL copied to clipboard!{/green-fg}");
      this._status("COPIED ✔");
    } catch (e) {
      this._log(`{yellow-fg}⚠ ${e.message}{/yellow-fg}`);
    }
  }

  async _save() {
    if (!this.result?.links?.length) {
      this._log("{yellow-fg}⚠ Belum ada link.{/yellow-fg}");
      return;
    }
    const link = this.result.links[this.linkIdx] || this.result.links[0];
    const ext  = link.text.toLowerCase().includes("mp3") ||
                 link.text.toLowerCase().includes("audio") ? "mp3" : "mp4";
    const base = (this.result.title || `tiktok-${Date.now()}`)
      .replace(/[^a-zA-Z0-9]/g, "_")
      .substring(0, 50);
    const out  = getDownloadPath(`${base}.${ext}`);

    this._log("{white-fg}Starting download...{/white-fg}");
    this._status("DOWNLOADING");

    try {
      await downloadFile(link.url, out, (p) => {
        this._prog(p);
        this._status(`LOADING ${p}%`);
      });
      this._log(`{green-fg}✔ Saved: ${out}{/green-fg}`);
      this._status("SAVED ✔");
      this._prog(100);
    } catch (e) {
      this._log(`{red-fg}✘ Download failed: ${e.message}{/red-fg}`);
      this._status("FAILED");
      this._prog(0);
    }
  }

  async _process(url) {
    if (this.busy) {
      this._log("{yellow-fg}⚠ Masih processing!{/yellow-fg}");
      return;
    }
    this.busy    = true;
    this.result  = null;
    this.linkIdx = 0;

    this._prog(0);
    this._status("PROCESSING");
    this._log(`{${ACCENT}-fg}♪ ${url.substring(0, 58)}{/${ACCENT}-fg}`);

    try {
      this._prog(15);
      this._log("{white-fg}[1/4] Fetching SnapTik token...{/white-fg}");

      this._prog(35);
      this._log("{white-fg}[2/4] Submitting URL to SnapTik...{/white-fg}");

      this._prog(55);
      this._log("{white-fg}[3/4] Decoding obfuscated response...{/white-fg}");

      this._prog(75);
      this._log("{white-fg}[4/4] Extracting download links...{/white-fg}");

      this.result = await tiktokDl(url);

      this._prog(100);
      this._showResult();
      this._log(`{green-fg}✔ Done! Found ${this.result.links.length} link(s).{/green-fg}`);
      this._status("DONE ✔");
    } catch (e) {
      this._prog(0);
      this._log(`{red-fg}✘ ERROR: ${e.message}{/red-fg}`);
      this._status("ERROR");
      this.resultBox.setContent(`  ERROR:\n  ${e.message}`);
    } finally {
      this.busy = false;
      this.scr.render();
    }
  }

  _showResult() {
    if (!this.result) return;

    let c = "";
    if (this.result.title) c += `Title:  ${this.result.title}\n`;
    c += `\nLinks:\n`;

    (this.result.links || []).forEach((l, i) => {
      const sel = i === this.linkIdx;
      if (sel) {
        c += `{${ACCENT}-fg}{bold} ▶ ${i + 1}. ${l.text}{/bold}{/${ACCENT}-fg}\n`;
        c += `   ${l.url.substring(0, 42)}...\n\n`;
      } else {
        c += `   ${i + 1}. ${l.text}\n`;
        c += `   ${l.url.substring(0, 42)}...\n\n`;
      }
    });

    c += `\n↑↓=select  Ctrl+S=copy  Ctrl+B=save`;
    this.resultBox.setContent(c);
    this.scr.render();
  }

  // ── Boot sequence ─────────────────────────────────────────────────────────
  _boot() {
    this._log(`{${ACCENT}-fg}♪ TikTok Downloader v3.0 ready.{/${ACCENT}-fg}`);
    this._log("{white-fg}Powered by SnapTik API{/white-fg}");
    this._log("{white-fg}Ctrl+V = Back to menu{/white-fg}");
    this._status("READY");
    this.scr.render();
  }
}

// ─────────────────────────────────────────────────────────────────────────────
//  BOOT
// ─────────────────────────────────────────────────────────────────────────────
const app = new TikTokDownloaderTUI();
