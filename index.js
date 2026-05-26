#!/usr/bin/env node
/**
 * ╔══════════════════════════════════════════════════════════════════════╗
 * ║         NEXA DOWNLOADER SUITE  —  Installer TUI  v1.0               ║
 * ║                     Created by: NexaDev                             ║
 * ╚══════════════════════════════════════════════════════════════════════╝
 *
 *  Gaya: Windows/Linux setup wizard (NSIS / ncurses installer)
 *  Struktur:
 *    ┌─ titlebar (putih) ─────────────────────────────────────┐
 *    │ [sidebar biru] │ [header putih]                        │
 *    │                │ ─────────────────────────────────     │
 *    │  N E X A       │  instruksi                            │
 *    │  ─────────     │  ─────────────────────────────────    │
 *    │  v1.0.0        │  [card platform 1]  (○) TikTok        │
 *    │                │  [card platform 2]  (○) Instagram     │
 *    │                │  [card platform 3]  (○) YouTube       │
 *    │                │  ─────────────────────────────────    │
 *    │                │  [Cancel]              [Launch ▶]     │
 *    └────────────────┴───────────────────────────────────────┘
 *    [statusbar putih bawah]
 */

import blessed from "blessed";
import { spawn } from "child_process";
import path from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));

// ── Platform definitions ─────────────────────────────────────────────────────
const PLATFORMS = [
  {
    label:   "TikTok Downloader",
    icon:    "♪",
    sub:     "No-watermark video download",
    detail:  "Supports /video/, /photo/, live — solves PoW challenge",
    script:  "tiktok-main.js",
    accent:  "cyan",
  },
  {
    label:   "Instagram Downloader",
    icon:    "◈",
    sub:     "Reels, Posts & Story download",
    detail:  "Supports /reel/, /p/, /tv/ — uses iqsaved WebSocket API",
    script:  "ig-download.js",
    accent:  "magenta",
  },
  {
    label:   "YouTube Downloader",
    icon:    "▶",
    sub:     "MP4 video + MP3 audio",
    detail:  "Supports youtube.com, youtu.be, music.youtube.com",
    script:  "yt-download.js",
    accent:  "red",
  },
];

// ── Sidebar brand lines ──────────────────────────────────────────────────────
const BRAND_LINES = [
  "",
  "  ┌──────────┐",
  "  │  N E X A │",
  "  └──────────┘",
  "",
  " Downloader",
  "   Suite",
  "",
  " ──────────",
  "",
  "  v 1.0.0",
  "",
  " NexaDev",
  "",
  " ──────────",
  "",
  " © 2025",
];

// ═════════════════════════════════════════════════════════════════════════════
class NexaInstaller {
  constructor() {
    this.scr = blessed.screen({
      smartCSR:    true,
      title:       "NEXA Downloader Suite — Setup",
      mouse:       true,
      cursor:      { artificial: true, shape: "block", blink: false },
    });

    this.sel      = 0;   // selected platform index
    this.inChild  = false;

    this._build();
    this._keys();
    this.scr.render();
  }

  // ── Layout ─────────────────────────────────────────────────────────────────
  _build() {
    const s = this.scr;

    // ── OS-style window title bar ──────────────────────────────────────────
    blessed.box({
      parent: s, top: 0, left: 0, width: "100%", height: 1,
      style: { bg: "white", fg: "black" },
      content: "  NEXA Downloader Suite  —  Setup Wizard   [v1.0.0]",
    });

    // ── Outer window border ────────────────────────────────────────────────
    this.win = blessed.box({
      parent: s, top: 1, left: 0,
      width: "100%", height: "100%-2",
      border: { type: "line" },
      style: { bg: "black", border: { fg: "white" } },
    });

    // ── LEFT SIDEBAR ───────────────────────────────────────────────────────
    this.sidebar = blessed.box({
      parent: this.win,
      top: 0, left: 0,
      width: 20, height: "100%-2",
      style: { bg: "blue", fg: "white" },
      tags: true,
    });

    // Sidebar brand text
    const brandContent = BRAND_LINES.join("\n");
    blessed.box({
      parent: this.sidebar,
      top: 1, left: 0,
      width: "100%", height: BRAND_LINES.length,
      style: { bg: "blue", fg: "white" },
      tags: true,
      content: brandContent,
    });

    // Sidebar bottom accent strip
    blessed.box({
      parent: this.sidebar,
      bottom: 0, left: 0,
      width: "100%", height: 1,
      style: { bg: "cyan", fg: "black" },
      content: "  NEXA SUITE",
    });

    // ── Sidebar / content divider ──────────────────────────────────────────
    blessed.line({
      parent: this.win,
      top: 0, left: 20,
      orientation: "vertical",
      height: "100%-2",
      style: { fg: "white" },
    });

    // ── RIGHT CONTENT AREA ─────────────────────────────────────────────────
    this.panel = blessed.box({
      parent: this.win,
      top: 0, left: 21,
      width: "100%-23", height: "100%-2",
      style: { bg: "black", fg: "white" },
    });

    // ── Page header (putih seperti installer header) ───────────────────────
    this.pageHeader = blessed.box({
      parent: this.panel,
      top: 0, left: 0, width: "100%", height: 4,
      style: { bg: "white", fg: "black" },
      tags: true,
      content:
        "\n" +
        "   {bold}Welcome to NEXA Downloader Suite{/bold}\n" +
        "   Please select a platform to launch.",
    });

    // Thin separator line bawah header
    blessed.line({
      parent: this.panel,
      top: 4, left: 0, width: "100%",
      orientation: "horizontal",
      style: { fg: "white" },
    });

    // ── Instruction paragraph ──────────────────────────────────────────────
    blessed.box({
      parent: this.panel,
      top: 5, left: 3, width: "100%-6", height: 3,
      style: { bg: "black", fg: "white" },
      tags: true,
      content:
        "Use {bold}↑ ↓ Arrow{/bold} or {bold}Tab{/bold} to highlight a platform,\n" +
        "then press {bold}Enter{/bold} or click {bold}[ Launch ▶ ]{/bold} to open it.\n" +
        "Ctrl+V inside any downloader returns to this menu.",
    });

    // Separator bawah instruksi
    blessed.line({
      parent: this.panel,
      top: 8, left: 0, width: "100%",
      orientation: "horizontal",
      style: { fg: "white" },
    });

    // Section label
    blessed.box({
      parent: this.panel,
      top: 9, left: 3, width: "100%-6", height: 1,
      style: { bg: "black", fg: "white" },
      tags: true,
      content: "{bold}Select Platform:{/bold}",
    });

    // ── Platform radio cards ───────────────────────────────────────────────
    this.cards = [];
    PLATFORMS.forEach((p, i) => {
      // Outer card box
      const card = blessed.box({
        parent: this.panel,
        top: 11 + i * 5, left: 3,
        width: "100%-7", height: 4,
        border: { type: "line" },
        style: { bg: "black", border: { fg: "white" } },
        tags: true,
        mouse: true,
        clickable: true,
      });

      // Row 1: radio + icon + label
      const row1 = blessed.box({
        parent: card,
        top: 0, left: 1, width: "100%-2", height: 1,
        style: { bg: "black", fg: "white" },
        tags: true,
      });

      // Row 2: sub-label
      const row2 = blessed.box({
        parent: card,
        top: 1, left: 4, width: "100%-6", height: 1,
        style: { bg: "black", fg: "white" },
        tags: true,
      });

      // Row 3: detail
      const row3 = blessed.box({
        parent: card,
        top: 2, left: 4, width: "100%-6", height: 1,
        style: { bg: "black", fg: "white" },
        tags: true,
      });

      card.on("click", () => {
        this.sel = i;
        this._refresh();
      });

      this.cards.push({ card, row1, row2, row3 });
    });

    // Separator above buttons
    blessed.line({
      parent: this.panel,
      bottom: 4, left: 0, width: "100%",
      orientation: "horizontal",
      style: { fg: "white" },
    });

    // ── [ Cancel ] button ─────────────────────────────────────────────────
    this.btnCancel = blessed.button({
      parent: this.panel,
      bottom: 1, left: 3,
      width: 16, height: 3,
      border: { type: "line" },
      align: "center", valign: "middle",
      style: {
        bg: "black", fg: "white",
        border: { fg: "white" },
        focus: { bg: "white", fg: "black" },
        hover: { bg: "white", fg: "black" },
      },
      tags: true,
      content: "  Cancel  ",
      mouse: true, clickable: true,
    });

    // ── [ Launch ▶ ] button ────────────────────────────────────────────────
    this.btnLaunch = blessed.button({
      parent: this.panel,
      bottom: 1, right: 2,
      width: 18, height: 3,
      border: { type: "line" },
      align: "center", valign: "middle",
      style: {
        bg: "white", fg: "black",
        border: { fg: "white" },
        focus: { bg: "cyan", fg: "black" },
        hover: { bg: "cyan", fg: "black" },
      },
      tags: true,
      content: "{bold}  Launch  ▶  {/bold}",
      mouse: true, clickable: true,
    });

    // ── Bottom status bar ──────────────────────────────────────────────────
    this.statusBar = blessed.box({
      parent: s,
      bottom: 0, left: 0, width: "100%", height: 1,
      style: { bg: "white", fg: "black" },
      content: "  Ready  |  ↑↓ Navigate   Enter = Launch   Ctrl+C = Exit",
    });

    this._refresh();
  }

  // ── Update card visuals for current selection ───────────────────────────
  _refresh() {
    PLATFORMS.forEach((p, i) => {
      const { card, row1, row2, row3 } = this.cards[i];
      const sel = i === this.sel;
      const a   = p.accent;   // "cyan" | "magenta" | "red"

      // Border highlight
      card.style.border = { fg: sel ? a : "white" };
      card.style.bg     = sel ? "black" : "black";

      // Radio dot
      const dot   = sel ? `{${a}-fg}{bold}(●){/bold}{/${a}-fg}` : `{white-fg}(○){/white-fg}`;
      const iCol  = sel ? `{${a}-fg}{bold}` : `{white-fg}`;
      const iEnd  = sel ? `{/bold}{/${a}-fg}` : `{/white-fg}`;
      row1.setContent(`${dot}  ${iCol}${p.icon}  ${p.label}${iEnd}`);

      const dc  = sel ? `{${a}-fg}` : `{white-fg}`;
      const de  = sel ? `{/${a}-fg}` : `{/white-fg}`;
      row2.setContent(`${dc}${p.sub}${de}`);
      row3.setContent(`{white-fg}${p.detail}{/white-fg}`);
    });

    // Launch button accent = current platform colour
    const a = PLATFORMS[this.sel].accent;
    this.btnLaunch.style.bg     = a;
    this.btnLaunch.style.border = { fg: a };

    // Status bar info
    this.statusBar.setContent(
      `  Platform: ${PLATFORMS[this.sel].label}  |  ↑↓ Navigate   Enter = Launch   Ctrl+C = Exit`
    );

    this.scr.render();
  }

  // ── Key bindings ───────────────────────────────────────────────────────
  _keys() {
    this.scr.key(["up",   "k"], () => { this.sel = Math.max(0, this.sel - 1); this._refresh(); });
    this.scr.key(["down", "j"], () => { this.sel = Math.min(PLATFORMS.length - 1, this.sel + 1); this._refresh(); });
    this.scr.key(["tab"],       () => { this.sel = (this.sel + 1) % PLATFORMS.length; this._refresh(); });
    this.scr.key(["1"],         () => { this.sel = 0; this._refresh(); });
    this.scr.key(["2"],         () => { this.sel = 1; this._refresh(); });
    this.scr.key(["3"],         () => { this.sel = 2; this._refresh(); });
    this.scr.key(["enter"],     () => this._launch());
    this.scr.key(["C-c"],       () => { this.scr.destroy(); process.exit(0); });

    this.btnCancel.on("press", () => { this.scr.destroy(); process.exit(0); });
    this.btnLaunch.on("press", () => this._launch());
  }

  // ── Spawn child process (sub-app) ─────────────────────────────────────
  _launch() {
    if (this.inChild) return;
    this.inChild = true;
    this.scr.destroy();

    const item   = PLATFORMS[this.sel];
    const script = path.join(__dirname, item.script);

    const child = spawn(process.execPath, [script], {
      stdio: "inherit",
      env: { ...process.env, NEXA_PARENT: "1" },
    });

    child.on("exit", () => {
      this.inChild = false;
      // Re-open menu
      spawn(process.execPath, [fileURLToPath(import.meta.url)], {
        stdio: "inherit",
        detached: false,
      });
    });
  }
}

// ─────────────────────────────────────────────────────────────────────────────
new NexaInstaller();
