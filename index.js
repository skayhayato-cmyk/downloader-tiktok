#!/usr/bin/env node

/**
 * ╔══════════════════════════════════════════════════════════════════════════════╗
 * ║  TikTok Downloader - Retro Computer Edition v3.0                             ║
 * ║  Project: TikTok Downloader                                                  ║
 * ║  Created by: NexaDev                                                         ║
 * ║  Scraper by: Ditzzx                                                          ║
 * ╚══════════════════════════════════════════════════════════════════════════════╝
 * 
 *  Controls:
 *    Ctrl+S  → Copy URL to clipboard        ← CHANGED from Ctrl+A
 *    Ctrl+B  → Download video to /storage/emulated/0/
 *    Ctrl+R  → Reset form
 *    Ctrl+C  → Quit application
 *    Alt+N   → About dialog
 *    Alt+M   → Close about dialog
 *    Enter   → Process URL
 *    Tab     → Next field
 *    ↑/↓     → Select link
 */

import blessed from "blessed";
import { spawn } from "child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import https from "node:https";

import {
  openHome,
  submitVideo,
  decodeObfuscatedResponse,
  extractResult,
  renderVideo
} from "./tiktok-downloader.js";

// ═══════════════════════════════════════════════════════════════════════════════
//  COLOR PALETTE  (semua didefinisikan di sini supaya mudah diganti)
//  blessed hanya support: black, red, green, yellow, blue, magenta, cyan, white
//  + bright variants: bright<Color> atau light<Color>
// ═══════════════════════════════════════════════════════════════════════════════
const C = {
  // Backgrounds
  bgMain:       "black",        // latar utama → hitam pekat, kontras tinggi
  bgDialog:     "black",        // dialog box
  bgInput:      "black",        // input field bg
  bgInputFocus: "black",        // input saat focused
  bgButton:     "black",        // tombol normal
  bgButtonFocus:"cyan",         // tombol saat focused → cyan mencolok
  bgBar:        "blue",         // progress bar fill
  bgLogBox:     "black",
  bgResultBox:  "black",
  bgTitleBar:   "black",
  bgFooter:     "cyan",         // footer bar → cyan supaya menonjol
  bgAbout:      "black",

  // Foregrounds
  fgMain:       "cyan",         // teks utama → cyan
  fgBorder:     "cyan",         // semua border → cyan
  fgTitle:      "yellow",       // judul → kuning terang
  fgLabel:      "green",        // label (Progress:, Log:, Links:) → hijau
  fgInput:      "white",        // teks dalam input
  fgStatus:     "yellow",       // teks status kanan atas
  fgLog:        "white",        // teks log → putih
  fgResult:     "cyan",         // teks result
  fgButton:     "cyan",         // teks tombol normal
  fgButtonFocus:"black",        // teks tombol saat focused
  fgFooter:     "black",        // teks footer
  fgAbout:      "white",
  fgSep:        "cyan",         // garis separator
  fgScrollbar:  "cyan",
  fgProgress:   "cyan",         // progress bar fill

  // Accents (dipakai lewat {tag} di content)
  tagOk:        "green-fg",     // [OK]
  tagWarn:      "yellow-fg",    // WARNING
  tagError:     "red-fg",       // ERROR
  tagInfo:      "cyan-fg",      // [INFO]
  tagBoot:      "magenta-fg",   // [BOOT]
  tagDl:        "white-fg",     // [DL]
  tagDone:      "green-fg",     // [DONE]
};

// ═══════════════════════════════════════════════════════════════════════════════
//  CLIPBOARD HELPER
// ═══════════════════════════════════════════════════════════════════════════════

async function copyToClipboard(text) {
  const platform = process.platform;
  const errors = [];

  const tryCommand = (cmd, args, input) => {
    return new Promise((resolve, reject) => {
      const proc = spawn(cmd, args);
      let error = "";
      proc.stdin.write(input);
      proc.stdin.end();
      proc.stderr.on("data", data => { error += data.toString(); });
      proc.on("error", err => reject(err));
      proc.on("exit", code => {
        if (code === 0) resolve(true);
        else reject(new Error(`${cmd} exited with ${code}: ${error}`));
      });
    });
  };

  if (platform === "darwin") {
    try { await tryCommand("pbcopy", [], text); return; }
    catch (e) { errors.push(`pbcopy: ${e.message}`); }
  } else if (platform === "win32") {
    try { await tryCommand("clip", [], text); return; }
    catch (e) { errors.push(`clip: ${e.message}`); }
  } else {
    const linuxCommands = [
      ["wl-copy", []],
      ["xclip", ["-selection", "clipboard"]],
      ["xsel", ["--clipboard", "--input"]],
      ["termux-clipboard-set", []]
    ];
    for (const [cmd, args] of linuxCommands) {
      try { await tryCommand(cmd, args, text); return; }
      catch (e) { errors.push(`${cmd}: ${e.message}`); }
    }
  }

  try {
    const osc52 = `\x1b]52;c;${Buffer.from(text).toString("base64")}\x07`;
    process.stdout.write(osc52);
    return;
  } catch (e) { errors.push(`OSC52: ${e.message}`); }

  try {
    const tmpFile = path.join(os.tmpdir(), `tiktok-url-${Date.now()}.txt`);
    fs.writeFileSync(tmpFile, text, "utf8");
    throw new Error(`Clipboard tools not found. URL saved to: ${tmpFile}`);
  } catch (e) {
    if (e.message.includes("saved to")) throw e;
    errors.push(`tempfile: ${e.message}`);
  }

  throw new Error(
    `Clipboard failed. Tried:\n${errors.map(e => "  - " + e).join("\n")}\n\n` +
    `Install: xclip, xsel, wl-copy (Linux) | pbcopy (Mac) | clip (Windows)`
  );
}

// ═══════════════════════════════════════════════════════════════════════════════
//  FILE DOWNLOAD HELPER
// ═══════════════════════════════════════════════════════════════════════════════

async function downloadFile(url, outputPath, onProgress) {
  return new Promise((resolve, reject) => {
    const file = fs.createWriteStream(outputPath);
    https.get(url, { timeout: 60000 }, response => {
      const total = parseInt(response.headers['content-length'], 10) || 0;
      let downloaded = 0;

      response.on('data', chunk => {
        downloaded += chunk.length;
        file.write(chunk);
        if (total > 0 && onProgress) {
          onProgress(Math.round((downloaded / total) * 100));
        }
      });

      response.on('end', () => {
        file.end();
        resolve(outputPath);
      });

      response.on('error', err => {
        file.destroy();
        fs.unlink(outputPath, () => {});
        reject(err);
      });
    }).on('error', err => {
      file.destroy();
      fs.unlink(outputPath, () => {});
      reject(err);
    });
  });
}

function getDownloadPath(filename) {
  const androidPath = "/storage/emulated/0/Download";
  if (fs.existsSync("/storage/emulated/0")) {
    if (!fs.existsSync(androidPath)) {
      try { fs.mkdirSync(androidPath, { recursive: true }); } catch {}
    }
    if (fs.existsSync(androidPath)) {
      return path.join(androidPath, filename);
    }
  }
  const homePath = path.join(os.homedir(), "Downloads");
  if (!fs.existsSync(homePath)) {
    try { fs.mkdirSync(homePath, { recursive: true }); } catch {}
  }
  return path.join(homePath, filename);
}

// ═══════════════════════════════════════════════════════════════════════════════
//  RETRO TUI CLASS
// ═══════════════════════════════════════════════════════════════════════════════

class RetroTikTokDownloader {
  constructor() {
    this.screen = blessed.screen({
      smartCSR: true,
      title: "TikTok Downloader",
      mouse: true,
      cursor: {
        artificial: true,
        shape: "underline",
        blink: true,
        color: "cyan"           // cursor warna cyan
      }
    });

    this.currentUrl = "";
    this.isProcessing = false;
    this.downloadResult = null;
    this.selectedLinkIndex = 0;
    this.currentFocus = "input";
    this.aboutVisible = false;

    this.initUI();
    this.bindKeys();
  }

  initUI() {
    const screen = this.screen;

    // ─── Background utama ───────────────────────────────────────────
    this.bg = blessed.box({
      parent: screen,
      top: 0,
      left: 0,
      width: "100%",
      height: "100%",
      style: { bg: C.bgMain }
    });

    // ─── Shadow ─────────────────────────────────────────────────────
    this.shadow = blessed.box({
      parent: this.bg,
      top: 1,
      left: 2,
      width: "100%-4",
      height: "100%-3",
      style: { bg: "black" }
    });

    // ─── Dialog utama ────────────────────────────────────────────────
    this.dialog = blessed.box({
      parent: this.bg,
      top: 0,
      left: 1,
      width: "100%-4",
      height: "100%-3",
      border: { type: "line", fg: C.fgBorder },
      style: {
        bg: C.bgDialog,
        border: { fg: C.fgBorder }
      }
    });

    // ─── Title bar ───────────────────────────────────────────────────
    this.titleBox = blessed.box({
      parent: this.dialog,
      top: 0,
      left: 0,
      width: "100%",
      height: 1,
      align: "center",
      style: { fg: C.fgTitle, bg: C.bgTitleBar },
      tags: true,
      content: `{bold}{yellow-fg}▓▒░ TikTok Downloader v3.0 ░▒▓{/yellow-fg}{/bold}`
    });

    this.sep1 = blessed.line({
      parent: this.dialog,
      top: 1,
      left: 0,
      width: "100%",
      orientation: "horizontal",
      style: { fg: C.fgSep, bg: C.bgDialog }
    });

    // ─── URL Label ───────────────────────────────────────────────────
    this.urlLabel = blessed.box({
      parent: this.dialog,
      top: 3,
      left: 2,
      width: "100%-4",
      height: 2,
      style: { fg: C.fgLabel, bg: C.bgDialog },
      tags: true,
      content: `{green-fg}{bold}► Enter TikTok URL:{/bold}{/green-fg}\n{white-fg}  (leave blank to exit){/white-fg}`
    });

    // ─── Input box ───────────────────────────────────────────────────
    this.inputBox = blessed.textbox({
      parent: this.dialog,
      top: 5,
      left: 2,
      width: "100%-4",
      height: 3,
      border: { type: "line", fg: C.fgBorder },
      style: {
        fg: C.fgInput,
        bg: C.bgInput,
        border: { fg: C.fgBorder },
        focus: {
          bg: C.bgInputFocus,
          border: { fg: "yellow" }   // border kuning saat focused
        }
      },
      inputOnFocus: true,
      value: "",
      tags: true
    });

    // ─── Progress label ──────────────────────────────────────────────
    this.progressLabel = blessed.box({
      parent: this.dialog,
      top: 9,
      left: 2,
      width: "100%-4",
      height: 1,
      style: { fg: C.fgLabel, bg: C.bgDialog },
      tags: true,
      content: `{green-fg}{bold}Progress:{/bold}{/green-fg}`
    });

    // ─── Progress bar ────────────────────────────────────────────────
    this.progressBar = blessed.progressbar({
      parent: this.dialog,
      top: 10,
      left: 2,
      width: "100%-4",
      height: 1,
      orientation: "horizontal",
      style: {
        bar: { bg: C.fgProgress, fg: C.bgMain },   // bar cyan on black
        border: { fg: C.fgBorder }
      },
      filled: 0,
      pch: "█",
      tags: true
    });

    // ─── Status text ─────────────────────────────────────────────────
    this.statusText = blessed.box({
      parent: this.dialog,
      top: 11,
      left: 2,
      width: "100%-4",
      height: 1,
      align: "right",
      style: { fg: C.fgStatus, bg: C.bgDialog },
      tags: true,
      content: `{yellow-fg}{bold}● READY{/bold}{/yellow-fg}`
    });

    this.sep2 = blessed.line({
      parent: this.dialog,
      top: 13,
      left: 0,
      width: "100%",
      orientation: "horizontal",
      style: { fg: C.fgSep, bg: C.bgDialog }
    });

    // ─── Log label ───────────────────────────────────────────────────
    this.logLabel = blessed.box({
      parent: this.dialog,
      top: 14,
      left: 2,
      width: 12,
      height: 1,
      style: { fg: C.fgLabel, bg: C.bgDialog },
      tags: true,
      content: `{green-fg}{bold}[ LOG ]{/bold}{/green-fg}`
    });

    // ─── Log box ─────────────────────────────────────────────────────
    this.logBox = blessed.log({
      parent: this.dialog,
      top: 15,
      left: 2,
      width: "55%",
      height: "100%-20",
      border: { type: "line", fg: C.fgBorder },
      style: {
        fg: C.fgLog,
        bg: C.bgLogBox,
        border: { fg: C.fgBorder },
        scrollbar: { bg: C.fgScrollbar }
      },
      scrollable: true,
      alwaysScroll: true,
      tags: true,
      scrollbar: { ch: "▒", style: { bg: C.fgScrollbar, fg: C.bgMain } }
    });

    // ─── Result label ─────────────────────────────────────────────────
    this.resultLabel = blessed.box({
      parent: this.dialog,
      top: 14,
      left: "55%+1",
      width: 14,
      height: 1,
      style: { fg: C.fgLabel, bg: C.bgDialog },
      tags: true,
      content: `{green-fg}{bold}[ LINKS ]{/bold}{/green-fg}`
    });

    // ─── Result box ───────────────────────────────────────────────────
    this.resultBox = blessed.box({
      parent: this.dialog,
      top: 15,
      left: "55%+1",
      width: "45%-3",
      height: "100%-20",
      border: { type: "line", fg: C.fgBorder },
      style: {
        fg: C.fgResult,
        bg: C.bgResultBox,
        border: { fg: C.fgBorder },
        scrollbar: { bg: C.fgScrollbar }
      },
      scrollable: true,
      alwaysScroll: true,
      tags: true,
      scrollbar: { ch: "▒", style: { bg: C.fgScrollbar, fg: C.bgMain } }
    });

    // ─── Button bar ───────────────────────────────────────────────────
    this.buttonBar = blessed.box({
      parent: this.dialog,
      top: "100%-4",
      left: 0,
      width: "100%",
      height: 3,
      border: { type: "line", fg: C.fgBorder },
      style: {
        fg: C.fgMain,
        bg: C.bgDialog,
        border: { fg: C.fgBorder }
      },
      tags: true,
      align: "center",
      valign: "middle"
    });

    const btnStyle = {
      fg: C.fgButton,
      bg: C.bgButton,
      focus: { bg: C.bgButtonFocus, fg: C.fgButtonFocus }
    };

    this.btnDownload = blessed.button({
      parent: this.buttonBar,
      top: 1,
      left: "5%",
      width: 14,
      height: 1,
      content: "{bold}{cyan-fg}[Download]{/cyan-fg}{/bold}",
      align: "center",
      style: btnStyle,
      tags: true,
      mouse: true,
      clickable: true
    });

    this.btnCopy = blessed.button({
      parent: this.buttonBar,
      top: 1,
      left: "29%",
      width: 14,
      height: 1,
      content: "{bold}{cyan-fg}[Copy URL]{/cyan-fg}{/bold}",
      align: "center",
      style: btnStyle,
      tags: true,
      mouse: true,
      clickable: true
    });

    this.btnSave = blessed.button({
      parent: this.buttonBar,
      top: 1,
      left: "54%",
      width: 14,
      height: 1,
      content: "{bold}{cyan-fg}[Save File]{/cyan-fg}{/bold}",
      align: "center",
      style: btnStyle,
      tags: true,
      mouse: true,
      clickable: true
    });

    this.btnQuit = blessed.button({
      parent: this.buttonBar,
      top: 1,
      left: "79%",
      width: 12,
      height: 1,
      content: "{bold}{red-fg}[Quit]{/red-fg}{/bold}",
      align: "center",
      style: {
        fg: "red",
        bg: C.bgButton,
        focus: { bg: "red", fg: "white" }
      },
      tags: true,
      mouse: true,
      clickable: true
    });

    // ─── Footer ───────────────────────────────────────────────────────
    this.footer = blessed.box({
      parent: screen,
      bottom: 0,
      left: 0,
      width: "100%",
      height: 1,
      style: { fg: C.fgFooter, bg: C.bgFooter },
      tags: true,
      content: " {bold}Ctrl+S{/bold}=Copy  {bold}Ctrl+B{/bold}=Save  {bold}Ctrl+R{/bold}=Reset  {bold}Ctrl+C{/bold}=Quit  {bold}Alt+N{/bold}=About  {bold}↑↓{/bold}=SelectLink "
    });

    this.inputBox.focus();
  }

  // ─── About Dialog ──────────────────────────────────────────────────
  showAbout() {
    if (this.aboutVisible) return;
    this.aboutVisible = true;

    const dialogWidth = 52;
    const dialogHeight = 18;
    const left = Math.floor((this.screen.width - dialogWidth) / 2);
    const top = Math.floor((this.screen.height - dialogHeight) / 2);

    this.aboutShadow = blessed.box({
      parent: this.screen,
      top: top + 1,
      left: left + 2,
      width: dialogWidth,
      height: dialogHeight,
      style: { bg: "black" }
    });

    this.aboutBox = blessed.box({
      parent: this.screen,
      top: top,
      left: left,
      width: dialogWidth,
      height: dialogHeight,
      border: { type: "line", fg: "yellow" },
      style: { bg: C.bgAbout, border: { fg: "yellow" } },
      tags: true
    });

    blessed.box({
      parent: this.aboutBox,
      top: 0,
      left: 0,
      width: "100%",
      height: 1,
      align: "center",
      style: { fg: "yellow", bg: C.bgAbout },
      tags: true,
      content: "{bold}{yellow-fg}▒ About This Program ▒{/yellow-fg}{/bold}"
    });

    blessed.line({
      parent: this.aboutBox,
      top: 1,
      left: 0,
      width: "100%",
      orientation: "horizontal",
      style: { fg: "yellow", bg: C.bgAbout }
    });

    blessed.box({
      parent: this.aboutBox,
      top: 3,
      left: 2,
      width: "100%-4",
      height: "100%-6",
      style: { fg: C.fgAbout, bg: C.bgAbout },
      tags: true,
      content:
        "{center}{bold}{cyan-fg}TikTok Downloader{/cyan-fg}{/bold}{/center}\n" +
        "{center}{white-fg}Version 3.0 - Retro Edition{/white-fg}{/center}\n\n" +
        "  {green-fg}{bold}Project:{/bold}{/green-fg}    TikTok Downloader\n" +
        "  {green-fg}{bold}Creator:{/bold}{/green-fg}    NexaDev\n" +
        "  {green-fg}{bold}Scraper:{/bold}{/green-fg}    Ditzzx\n\n" +
        "  {green-fg}{bold}Features:{/bold}{/green-fg}\n" +
        "    {cyan-fg}•{/cyan-fg} SnapTik API Integration\n" +
        "    {cyan-fg}•{/cyan-fg} Obfuscated Response Decoder\n" +
        "    {cyan-fg}•{/cyan-fg} Direct File Download\n" +
        "    {cyan-fg}•{/cyan-fg} Retro Computer UI\n\n" +
        "{center}{yellow-fg}Press Alt+M to close{/yellow-fg}{/center}"
    });

    this.screen.render();
  }

  hideAbout() {
    if (!this.aboutVisible) return;
    this.aboutVisible = false;
    if (this.aboutBox) {
      this.aboutBox.destroy();
      this.aboutShadow.destroy();
    }
    this.screen.render();
  }

  bindKeys() {
    // ─── Ctrl+S: Copy URL (CHANGED from Ctrl+A) ───
    this.screen.key(["C-s"], async () => {
      await this.doCopy();
    });

    // ─── Ctrl+B: Download to storage ───
    this.screen.key(["C-b"], async () => {
      await this.doDownloadFile();
    });

    // ─── Ctrl+R: Reset ───
    this.screen.key(["C-r"], () => {
      this.reset();
    });

    // ─── Ctrl+C: Quit ───
    this.screen.key(["C-c"], () => {
      this.doQuit();
    });

    // ─── Alt+N: About ───
    this.screen.key(["M-n"], () => {
      this.showAbout();
    });

    // ─── Alt+M: Close About ───
    this.screen.key(["M-m"], () => {
      this.hideAbout();
    });

    // ─── Enter on input ───
    this.inputBox.key(["enter"], async () => {
      const url = this.inputBox.getValue().trim();
      if (!url) {
        this.log(`{yellow-fg}⚠ WARNING:{/yellow-fg} URL is empty!`);
        return;
      }
      await this.download(url);
    });

    // ─── Tab: cycle focus ───
    this.screen.key(["tab"], () => {
      const focusOrder = ["input", "download", "copy", "save", "quit"];
      const currentIdx = focusOrder.indexOf(this.currentFocus);
      const nextIdx = (currentIdx + 1) % focusOrder.length;
      this.currentFocus = focusOrder[nextIdx];

      switch (this.currentFocus) {
        case "input":    this.inputBox.focus();    break;
        case "download": this.btnDownload.focus(); break;
        case "copy":     this.btnCopy.focus();     break;
        case "save":     this.btnSave.focus();     break;
        case "quit":     this.btnQuit.focus();     break;
      }
    });

    // ─── Button clicks ───
    this.btnDownload.on("press", async () => {
      const url = this.inputBox.getValue().trim();
      if (!url) { this.log(`{yellow-fg}⚠ WARNING:{/yellow-fg} URL is empty!`); return; }
      await this.download(url);
    });

    this.btnCopy.on("press",  async () => { await this.doCopy(); });
    this.btnSave.on("press",  async () => { await this.doDownloadFile(); });
    this.btnQuit.on("press",  ()       => { this.doQuit(); });

    // ─── Arrow keys ───
    this.screen.key(["up"], () => {
      if (this.downloadResult?.links?.length > 0) {
        this.selectedLinkIndex = Math.max(0, this.selectedLinkIndex - 1);
        this.displayResult(this.downloadResult, null);
      }
    });

    this.screen.key(["down"], () => {
      if (this.downloadResult?.links?.length > 0) {
        this.selectedLinkIndex = Math.min(
          this.downloadResult.links.length - 1,
          this.selectedLinkIndex + 1
        );
        this.displayResult(this.downloadResult, null);
      }
    });
  }

  async doCopy() {
    if (this.downloadResult?.links?.length > 0) {
      const url = this.downloadResult.links[this.selectedLinkIndex]?.url ||
                  this.downloadResult.links[0].url;
      try {
        await copyToClipboard(url);
        this.log(`{green-fg}✔ OK:{/green-fg} URL copied to clipboard!`);
        this.setStatus("COPIED ✔");
      } catch (err) {
        this.log(`{yellow-fg}⚠ WARNING:{/yellow-fg} ${err.message}`);
        this.setStatus("COPY FAILED ✘");
      }
    } else {
      this.log(`{yellow-fg}⚠ WARNING:{/yellow-fg} No URL to copy!`);
    }
  }

  async doDownloadFile() {
    if (!this.downloadResult?.links?.length > 0) {
      this.log(`{yellow-fg}⚠ WARNING:{/yellow-fg} No URL to download! Process a URL first.`);
      return;
    }

    const url = this.downloadResult.links[this.selectedLinkIndex]?.url ||
                this.downloadResult.links[0].url;

    let filename = "tiktok-video.mp4";
    if (this.downloadResult.title) {
      const safeTitle = this.downloadResult.title
        .replace(/[^a-zA-Z0-9\u0000-\u007F]/g, "_")
        .substring(0, 50);
      filename = `${safeTitle}.mp4`;
    }

    const outputPath = getDownloadPath(filename);

    this.log(`{cyan-fg}[DL] Starting download...{/cyan-fg}`);
    this.setStatus("DOWNLOADING...");

    try {
      await downloadFile(url, outputPath, (percent) => {
        this.setProgress(percent);
        this.setStatus(`DOWNLOADING ${percent}%`);
      });

      this.log(`{green-fg}✔ [OK]{/green-fg} Saved to: {white-fg}${outputPath}{/white-fg}`);
      this.setStatus("SAVED ✔");
      this.setProgress(100);
    } catch (err) {
      this.log(`{red-fg}✘ ERROR:{/red-fg} Download failed: ${err.message}`);
      this.setStatus("DOWNLOAD FAILED ✘");
      this.setProgress(0);
    }
  }

  doQuit() {
    this.log(`{white-fg}Shutting down...{/white-fg}`);
    this.setStatus("EXITING...");
    setTimeout(() => process.exit(0), 500);
  }

  log(message) {
    const timestamp = new Date().toLocaleTimeString("id-ID", { hour12: false });
    this.logBox.log(`{white-fg}[${timestamp}]{/white-fg} ${message}`);
    this.screen.render();
  }

  setStatus(status) {
    // Warna status otomatis berdasarkan keyword
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

  setProgress(percent) {
    this.progressBar.setProgress(percent);
    this.screen.render();
  }

  reset() {
    this.inputBox.setValue("");
    this.resultBox.setContent(`{cyan-fg}{center}── No results yet ──{/center}{/cyan-fg}`);
    this.downloadResult = null;
    this.selectedLinkIndex = 0;
    this.setProgress(0);
    this.log(`{white-fg}Form reset{/white-fg}`);
    this.setStatus("READY");
    this.inputBox.focus();
    this.currentFocus = "input";
    this.screen.render();
  }

  async download(url) {
    if (this.isProcessing) {
      this.log(`{yellow-fg}⚠ WARNING:{/yellow-fg} Already processing!`);
      return;
    }

    this.isProcessing = true;
    this.currentUrl = url;
    this.downloadResult = null;
    this.selectedLinkIndex = 0;
    this.setProgress(0);
    this.setStatus("PROCESSING");
    this.log(`{cyan-fg}► Target:{/cyan-fg} ${url.substring(0, 50)}...`);

    try {
      this.setProgress(10);
      this.log(`{cyan-fg}[1/4]{/cyan-fg} Fetching token...`);
      const home = await openHome();
      this.log(`{green-fg}✔ [OK]{/green-fg} Token: ${home.token.substring(0, 25)}...`);
      this.setProgress(25);

      this.log(`{cyan-fg}[2/4]{/cyan-fg} Submitting to SnapTik...`);
      const post = await submitVideo(url, home.token);
      this.log(`{green-fg}✔ [OK]{/green-fg} HTTP {white-fg}${post.status}{/white-fg}`);
      this.setProgress(50);

      this.log(`{cyan-fg}[3/4]{/cyan-fg} Decoding obfuscated response...`);
      const decoded = decodeObfuscatedResponse(post.body);
      this.log(`{green-fg}✔ [OK]{/green-fg} Decoded: {white-fg}${decoded.length} chars{/white-fg}`);
      this.setProgress(75);

      this.log(`{cyan-fg}[4/4]{/cyan-fg} Extracting download links...`);
      const result = await extractResult(decoded);
      this.downloadResult = result;
      this.setProgress(90);

      let render = null;
      if (result.render_token) {
        this.log(`{cyan-fg}[RND]{/cyan-fg} Async render started...`);
        render = await renderVideo(result.render_token);
        if (render?.download_url) {
          this.log(`{green-fg}✔ [OK]{/green-fg} Render complete!`);
        }
      }

      this.setProgress(100);
      this.displayResult(result, render);
      this.log(`{green-fg}✔ {bold}[DONE]{/bold} Download ready!{/green-fg}`);
      this.setStatus("COMPLETE");

    } catch (err) {
      this.setProgress(0);
      this.log(`{red-fg}✘ ERROR: ${err.message}{/red-fg}`);
      this.setStatus("FAILED");
      this.resultBox.setContent(
        `{red-fg}{bold}✘ ERROR:{/bold}{/red-fg}\n{white-fg}${err.message}{/white-fg}`
      );
    } finally {
      this.isProcessing = false;
      this.screen.render();
    }
  }

  displayResult(result, render) {
    let content = "";

    if (result.title) {
      content += `{yellow-fg}{bold}Title:{/bold}{/yellow-fg}  {white-fg}${result.title}{/white-fg}\n`;
    }
    if (result.author) {
      content += `{yellow-fg}{bold}Author:{/bold}{/yellow-fg} {white-fg}${result.author}{/white-fg}\n`;
    }
    if (result.thumbnail) {
      content += `{yellow-fg}{bold}Thumb:{/bold}{/yellow-fg}  {white-fg}${result.thumbnail.substring(0, 32)}...{/white-fg}\n`;
    }

    content += `\n{green-fg}{bold}Download Links:{/bold}{/green-fg}\n`;

    if (result.links && result.links.length > 0) {
      result.links.forEach((link, i) => {
        const isSelected = i === this.selectedLinkIndex;
        const marker = isSelected
          ? `{black-fg}{cyan-bg} ▶ {/cyan-bg}{/black-fg}`
          : `   `;
        const numColor = isSelected ? `{cyan-fg}{bold}` : `{white-fg}`;
        const numEnd   = isSelected ? `{/bold}{/cyan-fg}` : `{/white-fg}`;
        content += `${marker} ${numColor}${i + 1}. ${link.text}${numEnd}\n`;
        content += `       {white-fg}${link.url.substring(0, 35)}...{/white-fg}\n\n`;
      });
      content += `\n{yellow-fg}↑↓ select  Ctrl+S copy  Ctrl+B save{/yellow-fg}\n`;
    } else {
      content += `  {red-fg}No links found{/red-fg}\n`;
    }

    if (render?.download_url) {
      content += `\n{green-fg}{bold}Render:{/bold}{/green-fg}\n  {white-fg}${render.download_url}{/white-fg}\n`;
    }

    this.resultBox.setContent(content);
    this.screen.render();
  }

  start() {
    this.log(`{magenta-fg}[BOOT]{/magenta-fg} {bold}TikTok Downloader v3.0{/bold}`);
    this.log(`{magenta-fg}[BOOT]{/magenta-fg} SnapTik API connected`);
    this.log(`{cyan-fg}[INFO]{/cyan-fg} Paste URL and press {bold}Enter{/bold}`);
    this.log(`{cyan-fg}[INFO]{/cyan-fg} Ctrl+S=Copy  Ctrl+B=Save  Ctrl+R=Reset`);
    this.setStatus("READY");
    this.screen.render();
  }
}

// ═══════════════════════════════════════════════════════════════════════════════
//  BOOT
// ═══════════════════════════════════════════════════════════════════════════════

const app = new RetroTikTokDownloader();
app.start();
