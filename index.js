#!/usr/bin/env node
/**
 * NexaDev Downloader TUI
 * Versi: 1.0.0
 * Scraping: Ditzzx
 * UI: NexaDev
 */

import blessed from "blessed";
import path from "node:path";
import fs from "node:fs";
import { fileURLToPath } from "node:url";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

// ========== GLOBAL STATE ==========
let currentScreen = "main"; // main | about | tiktok | instagram | youtube
let lastActiveBox = null;
let downloadDir = "/storage/emulated/0/download";

// ========== STYLE CONFIG ==========
const COLORS = {
  bg: "#0d1117",
  fg: "#c9d1d9",
  accent: "#58a6ff",
  accent2: "#f0883e",
  success: "#3fb950",
  danger: "#f85149",
  warning: "#d29922",
  border: "#30363d",
  highlight: "#1f6feb",
  muted: "#8b949e",
};

const STYLES = {
  box: {
    border: { type: "line", fg: COLORS.border },
    style: {
      fg: COLORS.fg,
      bg: COLORS.bg,
      border: { fg: COLORS.border },
    },
  },
  focusedBox: {
    border: { type: "line", fg: COLORS.accent },
    style: {
      fg: COLORS.fg,
      bg: COLORS.bg,
      border: { fg: COLORS.accent },
    },
  },
  button: {
    border: { type: "line", fg: COLORS.border },
    style: {
      fg: COLORS.fg,
      bg: "#161b22",
      border: { fg: COLORS.border },
      hover: { bg: COLORS.accent, fg: "#ffffff" },
      focus: { bg: COLORS.highlight, fg: "#ffffff", border: { fg: COLORS.accent } },
    },
  },
  input: {
    border: { type: "line", fg: COLORS.border },
    style: {
      fg: COLORS.fg,
      bg: "#0d1117",
      border: { fg: COLORS.border },
      focus: { border: { fg: COLORS.accent } },
    },
  },
  list: {
    border: { type: "line", fg: COLORS.border },
    style: {
      fg: COLORS.fg,
      bg: COLORS.bg,
      border: { fg: COLORS.border },
      selected: { bg: COLORS.accent, fg: "#ffffff" },
      item: { hover: { bg: "#21262d" } },
    },
  },
};

// ========== SCREEN ==========
const screen = blessed.screen({
  smartCSR: true,
  title: "NexaDev Downloader TUI v1.0.0",
  cursor: { artificial: true, shape: "line", blink: true, color: COLORS.accent },
});

// ========== HEADER ==========
const headerBox = blessed.box({
  top: 0,
  left: "center",
  width: "100%",
  height: 3,
  content: "{center}{bold}{#58a6ff-fg}╔═══════════════════════════════════════════════════╗{/}
"
         + "{center}{bold}{#58a6ff-fg}║      NEXADEV DOWNLOADER TUI  v1.0.0              ║{/}
"
         + "{center}{bold}{#58a6ff-fg}╚═══════════════════════════════════════════════════╝{/}",
  tags: true,
  style: { fg: COLORS.accent, bg: COLORS.bg },
});

// ========== FOOTER / STATUS BAR ==========
const statusBar = blessed.box({
  bottom: 0,
  left: 0,
  width: "100%",
  height: 1,
  content: " {bold}Alt+N{/bold}=About  {bold}Ctrl+C{/bold}=Exit  {bold}Ctrl+B{/bold}=Save Dir  {bold}Tab{/bold}=Navigate  {bold}Enter{/bold}=Select  {bold}Esc{/bold}=Back",
  tags: true,
  style: { fg: COLORS.muted, bg: "#161b22" },
});

// ========== MAIN MENU ==========
const menuBox = blessed.list({
  parent: screen,
  top: 4,
  left: "center",
  width: 40,
  height: 12,
  label: " {bold}  Pilih Downloader  {/bold} ",
  border: STYLES.list.border,
  style: STYLES.list.style,
  keys: true,
  vi: true,
  mouse: true,
  items: [
    "  📷  Instagram",
    "  🎵  TikTok",
    "  📺  YouTube",
    "  ℹ️  About",
  ],
  tags: true,
});

// ========== ABOUT SCREEN ==========
const aboutBox = blessed.box({
  parent: screen,
  top: 4,
  left: "center",
  width: 50,
  height: 16,
  label: " {bold}  About  {/bold} ",
  border: STYLES.box.border,
  style: STYLES.box.style,
  hidden: true,
  content:
    "
{center}{bold}{#58a6ff-fg}╔══════════════════════════════════════╗{/}
"
    + "{center}{bold}{#58a6ff-fg}║     NEXADEV DOWNLOADER TUI          ║{/}
"
    + "{center}{bold}{#58a6ff-fg}╚══════════════════════════════════════╝{/}

"
    + "  {bold}Versi    :{/bold}  1.0.0
"
    + "  {bold}Scraping :{/bold}  Ditzzx
"
    + "  {bold}UI       :{/bold}  NexaDev

"
    + "  {bold}{#3fb950-fg}✔{/} Instagram Downloader{/}
"
    + "  {bold}{#3fb950-fg}✔{/} TikTok Downloader{/}
"
    + "  {bold}{#3fb950-fg}✔{/} YouTube Downloader{/}

"
    + "{center}{#8b949e-fg}Tekan Alt+M atau Esc untuk kembali{/}
",
  tags: true,
  align: "left",
  valign: "top",
});

// ========== SAVE DIRECTORY PROMPT ==========
const saveDirBox = blessed.box({
  parent: screen,
  top: "center",
  left: "center",
  width: 60,
  height: 8,
  label: " {bold}  Set Save Directory  {/bold} ",
  border: STYLES.box.border,
  style: STYLES.box.style,
  hidden: true,
});

const saveDirInput = blessed.textbox({
  parent: saveDirBox,
  top: 2,
  left: 2,
  right: 2,
  height: 3,
  label: " Folder Download ",
  border: STYLES.input.border,
  style: STYLES.input.style,
  value: downloadDir,
  inputOnFocus: true,
});

const saveDirHint = blessed.text({
  parent: saveDirBox,
  bottom: 0,
  left: 2,
  right: 2,
  height: 1,
  content: " Enter=Save  Esc=Cancel",
  style: { fg: COLORS.muted },
});

// ========== NOTIFICATION POPUP ==========
const notifyBox = blessed.box({
  parent: screen,
  top: "center",
  left: "center",
  width: 50,
  height: 5,
  border: { type: "line", fg: COLORS.success },
  style: { fg: COLORS.fg, bg: COLORS.bg, border: { fg: COLORS.success } },
  hidden: true,
  align: "center",
  valign: "middle",
  tags: true,
});

// ========== HELPER FUNCTIONS ==========
function showNotification(message, type = "success", duration = 2000) {
  const color = type === "success" ? COLORS.success : type === "error" ? COLORS.danger : COLORS.warning;
  notifyBox.setContent(`{center}{bold}{#${color.replace("#", "")}-fg}${message}{/}{/}`);
  notifyBox.style.border.fg = color;
  notifyBox.show();
  screen.render();
  setTimeout(() => {
    notifyBox.hide();
    screen.render();
  }, duration);
}

function showAbout() {
  currentScreen = "about";
  menuBox.hide();
  aboutBox.show();
  aboutBox.focus();
  screen.render();
}

function hideAbout() {
  currentScreen = "main";
  aboutBox.hide();
  menuBox.show();
  menuBox.focus();
  screen.render();
}

function showSaveDir() {
  lastActiveBox = screen.focused;
  saveDirInput.setValue(downloadDir);
  saveDirBox.show();
  saveDirInput.focus();
  screen.render();
}

function hideSaveDir() {
  saveDirBox.hide();
  if (lastActiveBox && lastActiveBox.focus) {
    lastActiveBox.focus();
  } else {
    menuBox.focus();
  }
  screen.render();
}

function confirmSaveDir() {
  const val = saveDirInput.getValue().trim();
  if (val) {
    downloadDir = val;
    try {
      if (!fs.existsSync(downloadDir)) {
        fs.mkdirSync(downloadDir, { recursive: true });
      }
      showNotification(`Save dir: ${downloadDir}`, "success");
    } catch (e) {
      showNotification(`Gagal membuat folder: ${e.message}`, "error");
    }
  }
  hideSaveDir();
}

function ensureDownloadDir() {
  try {
    if (!fs.existsSync(downloadDir)) {
      fs.mkdirSync(downloadDir, { recursive: true });
    }
    return true;
  } catch (e) {
    showNotification(`Folder error: ${e.message}`, "error", 3000);
    return false;
  }
}

// ========== KEYBOARD SHORTCUTS ==========
screen.key(["C-c"], () => {
  screen.destroy();
  process.exit(0);
});

screen.key(["M-n", "n"], () => {
  if (currentScreen === "main") {
    showAbout();
  }
});

screen.key(["M-m", "m"], () => {
  if (currentScreen === "about") {
    hideAbout();
  }
});

screen.key(["C-b"], () => {
  showSaveDir();
});

screen.key(["escape"], () => {
  if (!saveDirBox.hidden) {
    hideSaveDir();
    return;
  }
  if (currentScreen === "about") {
    hideAbout();
    return;
  }
  if (currentScreen !== "main") {
    // Kembali ke main menu dari downloader
    currentScreen = "main";
    menuBox.show();
    menuBox.focus();
    screen.render();
    return;
  }
});

// ========== MENU SELECTION ==========
menuBox.on("select", async (item, index) => {
  const text = item.getText().trim();

  if (text.includes("Instagram")) {
    currentScreen = "instagram";
    menuBox.hide();
    const { runInstagram } = await import("./instagram.js");
    runInstagram(screen, headerBox, statusBar, showNotification, ensureDownloadDir, downloadDir, COLORS, STYLES);
  } else if (text.includes("TikTok")) {
    currentScreen = "tiktok";
    menuBox.hide();
    const { runTiktok } = await import("./tiktok.js");
    runTiktok(screen, headerBox, statusBar, showNotification, ensureDownloadDir, downloadDir, COLORS, STYLES);
  } else if (text.includes("YouTube")) {
    currentScreen = "youtube";
    menuBox.hide();
    const { runYoutube } = await import("./yt.js");
    runYoutube(screen, headerBox, statusBar, showNotification, ensureDownloadDir, downloadDir, COLORS, STYLES);
  } else if (text.includes("About")) {
    showAbout();
  }
});

// ========== SAVE DIR EVENTS ==========
saveDirInput.key(["enter"], () => {
  confirmSaveDir();
});

saveDirInput.key(["escape"], () => {
  hideSaveDir();
});

// ========== INITIAL RENDER ==========
screen.append(headerBox);
screen.append(menuBox);
screen.append(aboutBox);
screen.append(saveDirBox);
screen.append(notifyBox);
screen.append(statusBar);

menuBox.focus();
screen.render();
