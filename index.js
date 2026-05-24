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
  // Try Android storage first
  const androidPath = "/storage/emulated/0/Download";
  if (fs.existsSync("/storage/emulated/0")) {
    if (!fs.existsSync(androidPath)) {
      try { fs.mkdirSync(androidPath, { recursive: true }); } catch {}
    }
    if (fs.existsSync(androidPath)) {
      return path.join(androidPath, filename);
    }
  }

  // Fallback to home/Downloads
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
        color: "white"
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

    // ─── Blue background (classic DOS/BIOS style) ───
    this.bg = blessed.box({
      parent: screen,
      top: 0,
      left: 0,
      width: "100%",
      height: "100%",
      style: { bg: "blue" }
    });

    // ─── Shadow effect ───
    this.shadow = blessed.box({
      parent: this.bg,
      top: 1,
      left: 2,
      width: "100%-4",
      height: "100%-3",
      style: { bg: "black" }
    });

    // ─── Main dialog box ───
    this.dialog = blessed.box({
      parent: this.bg,
      top: 0,
      left: 1,
      width: "100%-4",
      height: "100%-3",
      border: { type: "line", fg: "white" },
      style: { bg: "blue", border: { fg: "white" } }
    });

    // ─── Title bar ───
    this.titleBox = blessed.box({
      parent: this.dialog,
      top: 0,
      left: 0,
      width: "100%",
      height: 1,
      align: "center",
      style: { fg: "white", bg: "blue" },
      tags: true,
      content: "{bold} TikTok Downloader v3.0 {/bold}"
    });

    this.sep1 = blessed.line({
      parent: this.dialog,
      top: 1,
      left: 0,
      width: "100%",
      orientation: "horizontal",
      style: { fg: "white", bg: "blue" }
    });

    // ─── URL Input ───
    this.urlLabel = blessed.box({
      parent: this.dialog,
      top: 3,
      left: 2,
      width: "100%-4",
      height: 2,
      style: { fg: "white", bg: "blue" },
      tags: true,
      content: "Enter TikTok URL:\n(leave blank to exit)"
    });

    this.inputBox = blessed.textbox({
      parent: this.dialog,
      top: 5,
      left: 2,
      width: "100%-4",
      height: 3,
      border: { type: "line", fg: "white" },
      style: {
        fg: "black",
        bg: "white",
        border: { fg: "white" },
        focus: { border: { fg: "yellow" }, bg: "cyan" }
      },
      inputOnFocus: true,
      value: "",
      tags: true
    });

    // ─── Progress ───
    this.progressLabel = blessed.box({
      parent: this.dialog,
      top: 9,
      left: 2,
      width: "100%-4",
      height: 1,
      style: { fg: "yellow", bg: "blue" },
      tags: true,
      content: "Progress:"
    });

    this.progressBar = blessed.progressbar({
      parent: this.dialog,
      top: 10,
      left: 2,
      width: "100%-4",
      height: 1,
      orientation: "horizontal",
      style: {
        bar: { bg: "white", fg: "blue" },
        border: { fg: "white" }
      },
      filled: 0,
      pch: "█",
      tags: true
    });

    this.statusText = blessed.box({
      parent: this.dialog,
      top: 11,
      left: 2,
      width: "100%-4",
      height: 1,
      align: "right",
      style: { fg: "yellow", bg: "blue" },
      tags: true,
      content: "READY"
    });

    this.sep2 = blessed.line({
      parent: this.dialog,
      top: 13,
      left: 0,
      width: "100%",
      orientation: "horizontal",
      style: { fg: "white", bg: "blue" }
    });

    // ─── Log area ───
    this.logLabel = blessed.box({
      parent: this.dialog,
      top: 14,
      left: 2,
      width: 10,
      height: 1,
      style: { fg: "yellow", bg: "blue" },
      tags: true,
      content: "{bold}Log:{/bold}"
    });

    this.logBox = blessed.log({
      parent: this.dialog,
      top: 15,
      left: 2,
      width: "55%",
      height: "100%-20",
      border: { type: "line", fg: "white" },
      style: {
        fg: "white",
        bg: "blue",
        border: { fg: "white" },
        scrollbar: { bg: "white" }
      },
      scrollable: true,
      alwaysScroll: true,
      tags: true,
      scrollbar: { ch: "▒", style: { bg: "white", fg: "blue" } }
    });

    // ─── Result area ───
    this.resultLabel = blessed.box({
      parent: this.dialog,
      top: 14,
      left: "55%+1",
      width: 12,
      height: 1,
      style: { fg: "yellow", bg: "blue" },
      tags: true,
      content: "{bold}Links:{/bold}"
    });

    this.resultBox = blessed.box({
      parent: this.dialog,
      top: 15,
      left: "55%+1",
      width: "45%-3",
      height: "100%-20",
      border: { type: "line", fg: "white" },
      style: {
        fg: "white",
        bg: "blue",
        border: { fg: "white" },
        scrollbar: { bg: "white" }
      },
      scrollable: true,
      alwaysScroll: true,
      tags: true,
      scrollbar: { ch: "▒", style: { bg: "white", fg: "blue" } }
    });

    // ─── Button bar ───
    this.buttonBar = blessed.box({
      parent: this.dialog,
      top: "100%-4",
      left: 0,
      width: "100%",
      height: 3,
      border: { type: "line", fg: "white" },
      style: { fg: "white", bg: "blue", border: { fg: "white" } },
      tags: true,
      align: "center",
      valign: "middle"
    });

    this.btnDownload = blessed.button({
      parent: this.buttonBar,
      top: 1,
      left: "15%",
      width: 12,
      height: 1,
      content: "{bold}< Download >{/bold}",
      align: "center",
      style: { fg: "white", bg: "blue", focus: { bg: "white", fg: "black" } },
      tags: true,
      mouse: true,
      clickable: true
    });

    this.btnCopy = blessed.button({
      parent: this.buttonBar,
      top: 1,
      left: "38%",
      width: 12,
      height: 1,
      content: "{bold}< Copy URL >{/bold}",
      align: "center",
      style: { fg: "white", bg: "blue", focus: { bg: "white", fg: "black" } },
      tags: true,
      mouse: true,
      clickable: true
    });

    this.btnSave = blessed.button({
      parent: this.buttonBar,
      top: 1,
      left: "61%",
      width: 12,
      height: 1,
      content: "{bold}< Save File >{/bold}",
      align: "center",
      style: { fg: "white", bg: "blue", focus: { bg: "white", fg: "black" } },
      tags: true,
      mouse: true,
      clickable: true
    });

    this.btnQuit = blessed.button({
      parent: this.buttonBar,
      top: 1,
      left: "84%",
      width: 10,
      height: 1,
      content: "{bold}< Quit >{/bold}",
      align: "center",
      style: { fg: "white", bg: "blue", focus: { bg: "white", fg: "black" } },
      tags: true,
      mouse: true,
      clickable: true
    });

    // ─── Footer ───
    this.footer = blessed.box({
      parent: screen,
      bottom: 0,
      left: 0,
      width: "100%",
      height: 1,
      style: { fg: "black", bg: "white" },
      tags: true,
      content: "  Ctrl+A=Copy  Ctrl+B=Save  Ctrl+R=Reset  Ctrl+C=Quit  Alt+N=About  "
    });

    this.inputBox.focus();
  }

  // ─── About Dialog ───
  showAbout() {
    if (this.aboutVisible) return;
    this.aboutVisible = true;

    const dialogWidth = 50;
    const dialogHeight = 16;
    const left = Math.floor((this.screen.width - dialogWidth) / 2);
    const top = Math.floor((this.screen.height - dialogHeight) / 2);

    // Shadow
    this.aboutShadow = blessed.box({
      parent: this.screen,
      top: top + 1,
      left: left + 2,
      width: dialogWidth,
      height: dialogHeight,
      style: { bg: "black" }
    });

    // Main about box
    this.aboutBox = blessed.box({
      parent: this.screen,
      top: top,
      left: left,
      width: dialogWidth,
      height: dialogHeight,
      border: { type: "line", fg: "white" },
      style: { bg: "blue", border: { fg: "white" } },
      tags: true
    });

    // Title
    blessed.box({
      parent: this.aboutBox,
      top: 0,
      left: 0,
      width: "100%",
      height: 1,
      align: "center",
      style: { fg: "white", bg: "blue" },
      tags: true,
      content: "{bold} About This Program {/bold}"
    });

    blessed.line({
      parent: this.aboutBox,
      top: 1,
      left: 0,
      width: "100%",
      orientation: "horizontal",
      style: { fg: "white", bg: "blue" }
    });

    // Content
    blessed.box({
      parent: this.aboutBox,
      top: 3,
      left: 2,
      width: "100%-4",
      height: "100%-6",
      style: { fg: "white", bg: "blue" },
      tags: true,
      content:
        "{center}{bold}TikTok Downloader{/bold}{/center}\n" +
        "{center}Version 3.0 - Retro Edition{/center}\n\n" +
        "  {bold}Project:{/bold}    TikTok Downloader\n" +
        "  {bold}Creator:{/bold}    NexaDev\n" +
        "  {bold}Scraper:{/bold}    Ditzzx\n\n" +
        "  {bold}Features:{/bold}\n" +
        "    • SnapTik API Integration\n" +
        "    • Obfuscated Response Decoder\n" +
        "    • Direct File Download\n" +
        "    • Retro Computer UI\n\n" +
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
    // ─── Ctrl+A: Copy URL ───
    this.screen.key(["C-a"], async () => {
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
        this.log("{yellow-fg}WARNING:{/yellow-fg} URL is empty!");
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
        case "input": this.inputBox.focus(); break;
        case "download": this.btnDownload.focus(); break;
        case "copy": this.btnCopy.focus(); break;
        case "save": this.btnSave.focus(); break;
        case "quit": this.btnQuit.focus(); break;
      }
    });

    // ─── Button clicks ───
    this.btnDownload.on("press", async () => {
      const url = this.inputBox.getValue().trim();
      if (!url) { this.log("{yellow-fg}WARNING:{/yellow-fg} URL is empty!"); return; }
      await this.download(url);
    });

    this.btnCopy.on("press", async () => { await this.doCopy(); });
    this.btnSave.on("press", async () => { await this.doDownloadFile(); });
    this.btnQuit.on("press", () => { this.doQuit(); });

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
        this.log("{white-fg}{bold}OK:{/bold}{/white-fg} URL copied to clipboard!");
        this.setStatus("COPIED");
      } catch (err) {
        this.log(`{yellow-fg}WARNING:{/yellow-fg} ${err.message}`);
        this.setStatus("COPY FAILED");
      }
    } else {
      this.log("{yellow-fg}WARNING:{/yellow-fg} No URL to copy!");
    }
  }

  async doDownloadFile() {
    if (!this.downloadResult?.links?.length > 0) {
      this.log("{yellow-fg}WARNING:{/yellow-fg} No URL to download! Process a URL first.");
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

    this.log(`{white-fg}[DL] Starting download...{/white-fg}`);
    this.setStatus("DOWNLOADING");

    try {
      await downloadFile(url, outputPath, (percent) => {
        this.setProgress(percent);
        this.setStatus(`DOWNLOADING ${percent}%`);
      });

      this.log(`{white-fg}{bold}[OK]{/bold}{/white-fg} Saved to: ${outputPath}`);
      this.setStatus("SAVED");
      this.setProgress(100);
    } catch (err) {
      this.log(`{yellow-fg}ERROR:{/yellow-fg} Download failed: ${err.message}`);
      this.setStatus("DOWNLOAD FAILED");
      this.setProgress(0);
    }
  }

  doQuit() {
    this.log("{white-fg}Shutting down...{/white-fg}");
    this.setStatus("EXITING");
    setTimeout(() => process.exit(0), 500);
  }

  log(message) {
    const timestamp = new Date().toLocaleTimeString("id-ID", { hour12: false });
    this.logBox.log(`[${timestamp}] ${message}`);
    this.screen.render();
  }

  setStatus(status) {
    this.statusText.setContent(`{bold}${status}{/bold}`);
    this.screen.render();
  }

  setProgress(percent) {
    this.progressBar.setProgress(percent);
    this.screen.render();
  }

  reset() {
    this.inputBox.setValue("");
    this.resultBox.setContent("{center}No results yet{/center}");
    this.downloadResult = null;
    this.selectedLinkIndex = 0;
    this.setProgress(0);
    this.log("{white-fg}Form reset{/white-fg}");
    this.setStatus("READY");
    this.inputBox.focus();
    this.currentFocus = "input";
    this.screen.render();
  }

  async download(url) {
    if (this.isProcessing) {
      this.log("{yellow-fg}WARNING:{/yellow-fg} Already processing!");
      return;
    }

    this.isProcessing = true;
    this.currentUrl = url;
    this.downloadResult = null;
    this.selectedLinkIndex = 0;
    this.setProgress(0);
    this.setStatus("PROCESSING");
    this.log(`{white-fg}Target: ${url.substring(0, 50)}...{/white-fg}`);

    try {
      this.setProgress(10);
      this.log("{white-fg}[1/4] Fetching token...{/white-fg}");
      const home = await openHome();
      this.log(`{white-fg}[OK] Token: ${home.token.substring(0, 25)}...{/white-fg}`);
      this.setProgress(25);

      this.log("{white-fg}[2/4] Submitting to SnapTik...{/white-fg}");
      const post = await submitVideo(url, home.token);
      this.log(`{white-fg}[OK] HTTP ${post.status}{/white-fg}`);
      this.setProgress(50);

      this.log("{white-fg}[3/4] Decoding obfuscated response...{/white-fg}");
      const decoded = decodeObfuscatedResponse(post.body);
      this.log(`{white-fg}[OK] Decoded: ${decoded.length} chars{/white-fg}`);
      this.setProgress(75);

      this.log("{white-fg}[4/4] Extracting download links...{/white-fg}");
      const result = await extractResult(decoded);
      this.downloadResult = result;
      this.setProgress(90);

      let render = null;
      if (result.render_token) {
        this.log("{white-fg}[RND] Async render started...{/white-fg}");
        render = await renderVideo(result.render_token);
        if (render?.download_url) {
          this.log("{white-fg}[OK] Render complete!{/white-fg}");
        }
      }

      this.setProgress(100);
      this.displayResult(result, render);
      this.log("{white-fg}{bold}[DONE] Download ready!{/bold}{/white-fg}");
      this.setStatus("COMPLETE");

    } catch (err) {
      this.setProgress(0);
      this.log(`{yellow-fg}ERROR: ${err.message}{/yellow-fg}`);
      this.setStatus("FAILED");
      this.resultBox.setContent(
        `{yellow-fg}{bold}ERROR:{/bold}{/yellow-fg}\n${err.message}`
      );
    } finally {
      this.isProcessing = false;
      this.screen.render();
    }
  }

  displayResult(result, render) {
    let content = "";

    if (result.title) {
      content += `{bold}Title:{/bold} ${result.title}\n`;
    }
    if (result.author) {
      content += `{bold}Author:{/bold} ${result.author}\n`;
    }
    if (result.thumbnail) {
      content += `{bold}Thumb:{/bold} ${result.thumbnail.substring(0, 35)}...\n`;
    }

    content += `\n{bold}Download Links:{/bold}\n`;

    if (result.links && result.links.length > 0) {
      result.links.forEach((link, i) => {
        const marker = i === this.selectedLinkIndex ? 
          "{black-fg}{white-bg}▶{/white-bg}{/black-fg}" : " ";
        content += `${marker} ${i + 1}. ${link.text}\n`;
        content += `   ${link.url}\n\n`;
      });
      content += `\n{yellow-fg}Use ↑↓ to select, Ctrl+A to copy, Ctrl+B to save{/yellow-fg}\n`;
    } else {
      content += "  No links found\n";
    }

    if (render?.download_url) {
      content += `\n{bold}Render:{/bold}\n  ${render.download_url}\n`;
    }

    this.resultBox.setContent(content);
    this.screen.render();
  }

  start() {
    this.log("{white-fg}{bold}[BOOT] TikTok Downloader v3.0{/bold}{/white-fg}");
    this.log("{white-fg}[BOOT] SnapTik API connected{/white-fg}");
    this.log("{white-fg}[INFO] Paste URL and press Enter{/white-fg}");
    this.setStatus("READY");
    this.screen.render();
  }
}

// ═══════════════════════════════════════════════════════════════════════════════
//  BOOT
// ═══════════════════════════════════════════════════════════════════════════════

const app = new RetroTikTokDownloader();
app.start();
