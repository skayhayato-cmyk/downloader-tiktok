#!/usr/bin/env node

/**
 * ╔══════════════════════════════════════════════════════════════════════════════╗
 * ║  NEXA DOWNLOADER - Retro Terminal Suite v1.0                                 ║
 * ║  Project: Multi-Platform Downloader                                          ║
 * ║  Created by: NexaDev                                                         ║
 * ╚══════════════════════════════════════════════════════════════════════════════╝
 */

// ─── UTF-8 / Unicode fix ─────────────────────────────────────────────────────
process.env.LANG     = process.env.LANG     || "en_US.UTF-8";
process.env.LC_ALL   = process.env.LC_ALL   || "en_US.UTF-8";
process.env.LC_CTYPE = process.env.LC_CTYPE || "en_US.UTF-8";
if (process.stdout.setDefaultEncoding) process.stdout.setDefaultEncoding("utf8");
if (process.stderr.setDefaultEncoding) process.stderr.setDefaultEncoding("utf8");
// ─────────────────────────────────────────────────────────────────────────────

import blessed from "blessed";
import { spawn } from "child_process";
import path from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));

// ═══════════════════════════════════════════════════════════════════════════════
//  COLOR PALETTE
// ═══════════════════════════════════════════════════════════════════════════════
const C = {
  bgMain:       "black",
  bgDialog:     "black",
  bgButton:     "black",
  bgButtonFocus:"cyan",
  fgMain:       "cyan",
  fgBorder:     "cyan",
  fgTitle:      "yellow",
  fgLabel:      "green",
  fgButton:     "cyan",
  fgButtonFocus:"black",
  fgFooter:     "black",
  bgFooter:     "cyan",
};

// ═══════════════════════════════════════════════════════════════════════════════
//  MENU ITEMS
// ═══════════════════════════════════════════════════════════════════════════════
const MENU_ITEMS = [
  {
    key: "1",
    label: "TikTok Downloader",
    icon: "♪",
    desc: "Download TikTok videos without watermark",
    color: "cyan-fg",
    script: "tiktok-main.js",
  },
  {
    key: "2",
    label: "Instagram Downloader",
    icon: "◈",
    desc: "Download Instagram Reels, Photos & Videos",
    color: "magenta-fg",
    script: "ig-download.js",
  },
  {
    key: "3",
    label: "YouTube Downloader",
    icon: "▶",
    desc: "Download YouTube videos & audio (MP3/MP4)",
    color: "red-fg",
    script: "yt-download.js",
  },
];

// ═══════════════════════════════════════════════════════════════════════════════
//  ASCII ART LOGO
// ═══════════════════════════════════════════════════════════════════════════════
const LOGO = [
  "███╗   ██╗███████╗██╗  ██╗ █████╗ ",
  "████╗  ██║██╔════╝╚██╗██╔╝██╔══██╗",
  "██╔██╗ ██║█████╗   ╚███╔╝ ███████║",
  "██║╚██╗██║██╔══╝   ██╔██╗ ██╔══██║",
  "██║ ╚████║███████╗██╔╝ ██╗██║  ██║",
  "╚═╝  ╚═══╝╚══════╝╚═╝  ╚═╝╚═╝  ╚═╝",
  "  ─── D O W N L O A D E R  S U I T E ───",
];

// ═══════════════════════════════════════════════════════════════════════════════
//  MAIN MENU CLASS
// ═══════════════════════════════════════════════════════════════════════════════
class NexaMenu {
  constructor() {
    this.screen = blessed.screen({
      smartCSR: true,
      fullUnicode: true,
      forceUnicode: true,
      title: "NEXA Downloader Suite",
      mouse: true,
      cursor: {
        artificial: true,
        shape: "underline",
        blink: true,
        color: "cyan",
      },
    });

    this.selectedIndex = 0;
    this.childProcess = null;
    this.inSubApp = false;

    this.initUI();
    this.bindKeys();
    this.startAnimations();
  }

  initUI() {
    const screen = this.screen;

    // ─── Scanline background effect ─────────────────────────────────
    this.bg = blessed.box({
      parent: screen,
      top: 0, left: 0,
      width: "100%", height: "100%",
      style: { bg: C.bgMain },
    });

    // ─── Shadow ──────────────────────────────────────────────────────
    this.shadow = blessed.box({
      parent: this.bg,
      top: 1, left: 2,
      width: "100%-6", height: "100%-4",
      style: { bg: "black" },
    });

    // ─── Outer border dialog ─────────────────────────────────────────
    this.dialog = blessed.box({
      parent: this.bg,
      top: 0, left: 1,
      width: "100%-4", height: "100%-3",
      border: { type: "line", fg: C.fgBorder },
      style: {
        bg: C.bgDialog,
        border: { fg: C.fgBorder },
      },
    });

    // ─── Double-line inner decorative border ─────────────────────────
    this.innerBorder = blessed.box({
      parent: this.dialog,
      top: 1, left: 1,
      width: "100%-2", height: "100%-2",
      border: { type: "line", fg: "blue" },
      style: {
        bg: C.bgDialog,
        border: { fg: "blue" },
      },
    });

    // ─── Corner decorations ──────────────────────────────────────────
    blessed.box({
      parent: this.dialog,
      top: 0, left: 0, width: 3, height: 1,
      style: { fg: "yellow", bg: C.bgDialog },
      tags: true,
      content: "{yellow-fg}╔══{/yellow-fg}",
    });
    blessed.box({
      parent: this.dialog,
      top: 0, right: 0, width: 3, height: 1,
      style: { fg: "yellow", bg: C.bgDialog },
      tags: true,
      content: "{yellow-fg}══╗{/yellow-fg}",
    });

    // ─── Title bar ───────────────────────────────────────────────────
    this.titleBar = blessed.box({
      parent: this.dialog,
      top: 0, left: 0,
      width: "100%", height: 1,
      align: "center",
      style: { fg: "yellow", bg: C.bgDialog },
      tags: true,
      content: "{yellow-fg}{bold}[ NEXA DOWNLOADER SUITE v1.0 ]{/bold}{/yellow-fg}",
    });

    // ─── Separator after title ────────────────────────────────────────
    this.sep1 = blessed.line({
      parent: this.dialog,
      top: 1, left: 0,
      width: "100%",
      orientation: "horizontal",
      style: { fg: "blue", bg: C.bgDialog },
    });

    // ─── ASCII Logo area ─────────────────────────────────────────────
    this.logoBox = blessed.box({
      parent: this.dialog,
      top: 2, left: 0,
      width: "100%", height: 9,
      align: "center",
      style: { fg: "cyan", bg: C.bgDialog },
      tags: true,
    });

    this.renderLogo();

    // ─── Separator after logo ─────────────────────────────────────────
    blessed.line({
      parent: this.dialog,
      top: 11, left: 0,
      width: "100%",
      orientation: "horizontal",
      style: { fg: "blue", bg: C.bgDialog },
    });

    // ─── Menu label ───────────────────────────────────────────────────
    blessed.box({
      parent: this.dialog,
      top: 12, left: 0,
      width: "100%", height: 1,
      align: "center",
      style: { fg: "green", bg: C.bgDialog },
      tags: true,
      content: "{green-fg}{bold}▼  SELECT PLATFORM  ▼{/bold}{/green-fg}",
    });

    // ─── Menu container ───────────────────────────────────────────────
    this.menuBox = blessed.box({
      parent: this.dialog,
      top: 14, left: "10%",
      width: "80%", height: MENU_ITEMS.length * 4 + 2,
      border: { type: "line", fg: "cyan" },
      style: { bg: C.bgDialog, border: { fg: "cyan" } },
    });

    // ─── Render menu items ────────────────────────────────────────────
    this.menuItemBoxes = [];
    MENU_ITEMS.forEach((item, i) => {
      const box = blessed.box({
        parent: this.menuBox,
        top: 1 + i * 4, left: 1,
        width: "100%-2", height: 3,
        border: { type: "line", fg: i === this.selectedIndex ? "yellow" : "blue" },
        style: {
          bg: i === this.selectedIndex ? "blue" : C.bgDialog,
          border: { fg: i === this.selectedIndex ? "yellow" : "blue" },
        },
        tags: true,
        mouse: true,
        clickable: true,
      });

      const iconColor = item.color;
      const numColor  = i === this.selectedIndex ? "yellow-fg" : "cyan-fg";

      blessed.box({
        parent: box,
        top: 0, left: 1,
        width: "100%-2", height: 1,
        style: { bg: i === this.selectedIndex ? "blue" : C.bgDialog },
        tags: true,
        content:
          `{${numColor}}{bold}[${item.key}]{/bold}{/${numColor}}  ` +
          `{${iconColor}}{bold}${item.icon} ${item.label}{/bold}{/${iconColor}}`,
      });

      blessed.box({
        parent: box,
        top: 1, left: 4,
        width: "100%-6", height: 1,
        style: {
          fg: "white",
          bg: i === this.selectedIndex ? "blue" : C.bgDialog,
        },
        tags: true,
        content: `{white-fg}    ${item.desc}{/white-fg}`,
      });

      box.on("click", () => {
        this.selectedIndex = i;
        this.refreshMenu();
        this.launchSelected();
      });

      this.menuItemBoxes.push(box);
    });

    // ─── Hint below menu ─────────────────────────────────────────────
    const menuBottom = 14 + MENU_ITEMS.length * 4 + 4;

    this.hintBox = blessed.box({
      parent: this.dialog,
      top: menuBottom, left: 0,
      width: "100%", height: 3,
      align: "center",
      style: { fg: "white", bg: C.bgDialog },
      tags: true,
      content:
        "{cyan-fg}↑↓{/cyan-fg} / {cyan-fg}1 2 3{/cyan-fg} = Navigate  " +
        "{yellow-fg}Enter{/yellow-fg} = Select  " +
        "{red-fg}Ctrl+C{/red-fg} = Quit\n" +
        "{white-fg}In downloader: {/white-fg}{cyan-fg}Ctrl+V{/cyan-fg}{white-fg} = Back to menu{/white-fg}",
    });

    // ─── Decorative side ornaments ────────────────────────────────────
    this.leftOrn = blessed.box({
      parent: this.dialog,
      top: "50%", left: 1,
      width: 3, height: 7,
      style: { fg: "blue", bg: C.bgDialog },
      tags: true,
      content: "{blue-fg}▌\n▌\n▌\n▌\n▌\n▌\n▌{/blue-fg}",
    });

    this.rightOrn = blessed.box({
      parent: this.dialog,
      top: "50%", right: 1,
      width: 3, height: 7,
      style: { fg: "blue", bg: C.bgDialog },
      tags: true,
      content: "{blue-fg}▐\n▐\n▐\n▐\n▐\n▐\n▐{/blue-fg}",
    });

    // ─── Status bar ───────────────────────────────────────────────────
    this.statusBar = blessed.box({
      parent: this.dialog,
      bottom: 1, left: 0,
      width: "100%", height: 1,
      align: "center",
      style: { fg: "yellow", bg: C.bgDialog },
      tags: true,
      content: "{yellow-fg}● READY  |  NexaDev © 2025  |  v1.0.0{/yellow-fg}",
    });

    // ─── Footer ───────────────────────────────────────────────────────
    this.footer = blessed.box({
      parent: screen,
      bottom: 0, left: 0,
      width: "100%", height: 1,
      style: { fg: C.fgFooter, bg: C.bgFooter },
      tags: true,
      content:
        " {bold}↑↓{/bold}=Navigate  {bold}Enter{/bold}=Select  {bold}1{/bold}=TikTok  {bold}2{/bold}=Instagram  {bold}3{/bold}=YouTube  {bold}Ctrl+C{/bold}=Quit ",
    });
  }

  renderLogo() {
    const colors = ["cyan", "cyan", "cyan", "blue", "blue", "blue", "yellow"];
    let content = "";
    LOGO.forEach((line, i) => {
      const col = colors[i] || "cyan";
      content += `{${col}-fg}${line}{/${col}-fg}\n`;
    });
    this.logoBox.setContent(content);
  }

  refreshMenu() {
    MENU_ITEMS.forEach((item, i) => {
      const box  = this.menuItemBoxes[i];
      const isSelected = i === this.selectedIndex;

      box.style.bg     = isSelected ? "blue" : C.bgDialog;
      box.style.border = { fg: isSelected ? "yellow" : "blue" };
      box.border       = { type: "line", fg: isSelected ? "yellow" : "blue" };

      // update children
      const children = box.children;
      if (children[0]) {
        const numColor  = isSelected ? "yellow-fg" : "cyan-fg";
        const iconColor = item.color;
        children[0].setContent(
          `{${numColor}}{bold}[${item.key}]{/bold}{/${numColor}}  ` +
          `{${iconColor}}{bold}${item.icon} ${item.label}{/bold}{/${iconColor}}`
        );
        children[0].style.bg = isSelected ? "blue" : C.bgDialog;
      }
      if (children[1]) {
        children[1].style.bg = isSelected ? "blue" : C.bgDialog;
      }
    });

    this.screen.render();
  }

  startAnimations() {
    // Blinking cursor in status bar
    let blink = true;
    this._blinkTimer = setInterval(() => {
      blink = !blink;
      const dot = blink ? "●" : "○";
      this.statusBar.setContent(
        `{yellow-fg}${dot} READY  |  NexaDev © 2025  |  v1.0.0{/yellow-fg}`
      );
      this.screen.render();
    }, 600);
  }

  bindKeys() {
    // Number shortcuts
    this.screen.key(["1"], () => {
      this.selectedIndex = 0;
      this.refreshMenu();
      this.launchSelected();
    });
    this.screen.key(["2"], () => {
      this.selectedIndex = 1;
      this.refreshMenu();
      this.launchSelected();
    });
    this.screen.key(["3"], () => {
      this.selectedIndex = 2;
      this.refreshMenu();
      this.launchSelected();
    });

    // Arrow navigation
    this.screen.key(["up", "k"], () => {
      this.selectedIndex = Math.max(0, this.selectedIndex - 1);
      this.refreshMenu();
    });
    this.screen.key(["down", "j"], () => {
      this.selectedIndex = Math.min(MENU_ITEMS.length - 1, this.selectedIndex + 1);
      this.refreshMenu();
    });

    // Enter to launch
    this.screen.key(["enter"], () => {
      this.launchSelected();
    });

    // Ctrl+C to quit
    this.screen.key(["C-c"], () => {
      this.screen.destroy();
      process.exit(0);
    });
  }

  launchSelected() {
    if (this.inSubApp) return;

    const item = MENU_ITEMS[this.selectedIndex];
    if (!item) return;

    clearInterval(this._blinkTimer);
    this.screen.destroy();
    this.inSubApp = true;

    const scriptPath = path.join(__dirname, item.script);

    const child = spawn(process.execPath, [scriptPath], {
      stdio: "inherit",
      env: { ...process.env, NEXA_PARENT: "1" },
    });

    child.on("exit", () => {
      // Re-launch menu when child exits (Ctrl+V triggers exit in child)
      this.inSubApp = false;
      // Restart self
      spawn(process.execPath, [fileURLToPath(import.meta.url)], {
        stdio: "inherit",
        detached: false,
      });
    });
  }
}

// ═══════════════════════════════════════════════════════════════════════════════
//  BOOT
// ═══════════════════════════════════════════════════════════════════════════════
const menu = new NexaMenu();
menu.screen.render();
