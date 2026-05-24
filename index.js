#!/usr/bin/env node

/**
 * ╔══════════════════════════════════════════════════════════════════╗
 * ║  TikTok Downloader - Retro Computer Edition                      ║
 * ║         Developer By NexaDev                                     ║
 * ╚══════════════════════════════════════════════════════════════════╝
 * 
 *  Controls:
 *    Ctrl+A  → Copy URL to clipboard (clean, no extra text)
 *    Ctrl+Q  → Quit application
 *    Ctrl+D  → Focus input field
 *    Ctrl+R  → Reset form
 *    Enter   → Start download
 *    ↑ / ↓   → Select link
 */

import axios from "axios";
import FormData from "form-data";
import { CookieJar } from "tough-cookie";
import * as cheerio from "cheerio";
import vm from "node:vm";
import crypto from "node:crypto";
import blessed from "blessed";
import { spawn } from "child_process";

const BASE = "https://snaptik.app";
const PAGE = `${BASE}/en2`;
const API = `${BASE}/abc2.php`;
const LANG = "en2";

const UA =
  "Mozilla/5.0 (Linux; Android 10; K) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/147.0.0.0 Mobile Safari/537.36";

const jar = new CookieJar();

// ═══════════════════════════════════════════════════════════════════════════════
//  SNAPTIK API FUNCTIONS
// ═══════════════════════════════════════════════════════════════════════════════

function autoToken() {
  const unix = Math.floor(Date.now() / 1000).toString();
  return `ey${Buffer.from(unix).toString("base64")}c`;
}

async function saveCookies(res) {
  const cookies = res.headers["set-cookie"] || [];
  for (const cookie of cookies) {
    await jar.setCookie(cookie, BASE);
  }
}

async function getCookieHeader() {
  return jar.getCookieString(BASE);
}

function commonHeaders(extra = {}) {
  return {
    "user-agent": UA,
    "accept-language": "id-ID,id;q=0.9,en-US;q=0.8,en;q=0.7",
    "sec-ch-ua": '"Google Chrome";v="147", "Not.A/Brand";v="8", "Chromium";v="147"',
    "sec-ch-ua-mobile": "?1",
    "sec-ch-ua-platform": '"Android"',
    "x-request-id": crypto.randomUUID(),
    ...extra
  };
}

function extractToken(html) {
  const $ = cheerio.load(html);
  return $('input[name="token"]').attr("value") || null;
}

async function openHome() {
  const res = await axios.get(PAGE, {
    timeout: 30000,
    validateStatus: () => true,
    headers: commonHeaders({
      accept:
        "text/html,application/xhtml+xml,application/xml;q=0.9,image/avif,image/webp,image/apng,*/*;q=0.8",
      "upgrade-insecure-requests": "1",
      "sec-fetch-site": "none",
      "sec-fetch-mode": "navigate",
      "sec-fetch-user": "?1",
      "sec-fetch-dest": "document"
    })
  });

  await saveCookies(res);

  const html = String(res.data || "");
  const token = extractToken(html) || autoToken();

  return {
    status: res.status,
    token,
    html
  };
}

async function submitVideo(url, token) {
  const form = new FormData();
  form.append("url", url);
  form.append("lang", LANG);
  form.append("token", token);

  const cookie = await getCookieHeader();

  const res = await axios.post(API, form, {
    timeout: 60000,
    validateStatus: () => true,
    headers: {
      ...commonHeaders({
        accept: "*/*",
        origin: BASE,
        referer: PAGE,
        "sec-fetch-site": "same-origin",
        "sec-fetch-mode": "cors",
        "sec-fetch-dest": "empty",
        priority: "u=1, i",
        cookie
      }),
      ...form.getHeaders()
    }
  });

  await saveCookies(res);

  return {
    status: res.status,
    body: String(res.data || "")
  };
}

function decodeObfuscatedResponse(body) {
  let decoded = "";

  const context = {
    console,
    Math,
    Date,
    RegExp,
    String,
    decodeURIComponent,
    escape,
    window: {
      location: {
        hostname: "snaptik.app"
      }
    },
    eval(code) {
      decoded = String(code || "");
      return decoded;
    }
  };

  try {
    vm.createContext(context);
    vm.runInContext(body, context, { timeout: 3000 });
  } catch {}

  return decoded || body;
}

async function extractResult(decodedJs) {
  const dom = new Map();

  const fakeDollar = selector => {
    if (!dom.has(selector)) {
      dom.set(selector, {
        innerHTML: "",
        style: {},
        remove() {},
        addClass() {},
        removeClass() {},
        show() {},
        hide() {},
        html(value) {
          if (value !== undefined) this.innerHTML = String(value);
          return this.innerHTML;
        }
      });
    }

    return dom.get(selector);
  };

  const context = {
    console,
    Math,
    Date,
    RegExp,
    String,
    setTimeout,
    clearTimeout,
    document: {
      getElementById() {
        return { src: "", style: {} };
      },
      querySelector() {
        return { innerHTML: "", style: {} };
      }
    },
    window: {
      location: {
        hostname: "snaptik.app"
      }
    },
    gtag() {},
    fetch: async () => ({
      json: async () => ({})
    }),
    $: fakeDollar
  };

  try {
    vm.createContext(context);
    vm.runInContext(decodedJs, context, { timeout: 3000 });
  } catch {}

  const html = dom.get("#download")?.innerHTML || decodedJs;
  const $ = cheerio.load(html);

  const links = [];

  $("a[href]").each((_, el) => {
    const text = $(el).text().trim().replace(/\s+/g, " ");
    const href = $(el).attr("href");

    if (!href) return;

    const lowerText = text.toLowerCase();

    if (lowerText.includes("download with app")) return;
    if (lowerText.includes("download other video")) return;
    if (href === "/") return;
    if (href.includes("play.google.com")) return;

    links.push({
      text: text || "Download",
      url: href
    });
  });

  return {
    title: $(".video-title").first().text().trim() || null,
    author: $(".info span").first().text().trim() || null,
    thumbnail:
      $("#thumbnail").attr("src") ||
      $(".avatar").attr("src") ||
      $("img").first().attr("src") ||
      null,
    render_token: $(".btn-render").attr("data-token") || null,
    links
  };
}

async function renderVideo(renderToken) {
  if (!renderToken) return null;

  const cookie = await getCookieHeader();

  const renderRes = await axios.get(`${BASE}/render.php`, {
    timeout: 30000,
    validateStatus: () => true,
    params: {
      token: renderToken
    },
    headers: commonHeaders({
      accept: "*/*",
      referer: PAGE,
      cookie
    })
  });

  const taskId = renderRes.data?.task_id;

  if (!taskId) {
    return renderRes.data;
  }

  for (let i = 0; i < 30; i++) {
    const poll = await axios.get(`${BASE}/task.php`, {
      timeout: 30000,
      validateStatus: () => true,
      params: {
        token: taskId
      },
      headers: commonHeaders({
        accept: "*/*",
        referer: PAGE,
        cookie: await getCookieHeader()
      })
    });

    const data = poll.data;

    if (data?.download_url) {
      return data;
    }

    if (data?.status !== 0) {
      return data;
    }

    await new Promise(resolve => setTimeout(resolve, 3000));
  }

  return null;
}

// ═══════════════════════════════════════════════════════════════════════════════
//  CLIPBOARD HELPER - Clean copy without extra text
// ═══════════════════════════════════════════════════════════════════════════════

function copyToClipboard(text) {
  return new Promise((resolve, reject) => {
    const platform = process.platform;
    let proc;

    if (platform === "darwin") {
      // macOS
      proc = spawn("pbcopy", []);
    } else if (platform === "win32") {
      // Windows
      proc = spawn("clip", []);
    } else {
      // Linux - try xclip, xsel, or wl-copy
      const tryCopy = (cmd, args) => {
        return new Promise((res, rej) => {
          const p = spawn(cmd, args);
          p.on("error", () => rej());
          p.on("exit", code => {
            if (code === 0) res(true);
            else rej();
          });
        });
      };

      // Try wl-copy (Wayland)
      tryCopy("wl-copy", [])
        .then(() => {
          proc = spawn("wl-copy", []);
          proc.stdin.write(text);
          proc.stdin.end();
          resolve(true);
        })
        .catch(() => {
          // Try xclip (X11)
          tryCopy("xclip", ["-selection", "clipboard"])
            .then(() => {
              proc = spawn("xclip", ["-selection", "clipboard"]);
              proc.stdin.write(text);
              proc.stdin.end();
              resolve(true);
            })
            .catch(() => {
              // Try xsel
              tryCopy("xsel", ["--clipboard", "--input"])
                .then(() => {
                  proc = spawn("xsel", ["--clipboard", "--input"]);
                  proc.stdin.write(text);
                  proc.stdin.end();
                  resolve(true);
                })
                .catch(() => {
                  reject(new Error("No clipboard utility found. Install xclip, xsel, or wl-copy."));
                });
            });
        });
      return;
    }

    if (proc) {
      proc.stdin.write(text);
      proc.stdin.end();
      proc.on("exit", code => {
        if (code === 0) resolve(true);
        else reject(new Error(`Clipboard exit code: ${code}`));
      });
      proc.on("error", err => reject(err));
    }
  });
}

// ═══════════════════════════════════════════════════════════════════════════════
//  RETRO TUI CLASS
// ═══════════════════════════════════════════════════════════════════════════════

class RetroTikTokDownloader {
  constructor() {
    this.screen = blessed.screen({
      smartCSR: true,
      title: "TikTok Downloader [Retro Edition]",
      mouse: true,
      cursor: {
        artificial: true,
        shape: "block",
        blink: true,
        color: "green"
      }
    });

    this.currentUrl = "";
    this.isProcessing = false;
    this.downloadResult = null;
    this.selectedLinkIndex = 0;

    this.initUI();
    this.bindKeys();
  }

  initUI() {
    const screen = this.screen;

    // ═══ CRT Background Effect ═══
    this.crtOverlay = blessed.box({
      parent: screen,
      top: 0,
      left: 0,
      width: "100%",
      height: "100%",
      style: {
        bg: "black"
      }
    });

    // ═══ Main Frame ═══
    this.mainFrame = blessed.box({
      parent: screen,
      top: 0,
      left: 0,
      width: "100%",
      height: "100%-1",
      border: {
        type: "line",
        fg: "green"
      },
      style: {
        border: { fg: "green" }
      }
    });

    // ═══ Title Bar ═══
    this.titleBar = blessed.box({
      parent: this.mainFrame,
      top: 0,
      left: 1,
      width: "100%-2",
      height: 3,
      tags: true,
      style: {
        fg: "green",
        bg: "black"
      },
      content:
        "{center}{bold}╔══════════════════════════════════╗{/bold}{/center}\n" +
        "{center}{bold}║     TikTok Downloader              ║{/bold}{/center}\n" +
        "{center}{bold}╚══════════════════════════════════╝{/bold}{/center}"
    });

    // ═══ Input Section ═══
    this.inputLabel = blessed.box({
      parent: this.mainFrame,
      top: 4,
      left: 2,
      width: 14,
      height: 1,
      tags: true,
      style: { fg: "yellow" },
      content: "{bold}[URL INPUT]{/bold}"
    });

    this.inputBox = blessed.textbox({
      parent: this.mainFrame,
      top: 5,
      left: 2,
      width: "100%-4",
      height: 3,
      label: " Paste TikTok URL here ",
      border: {
        type: "line",
        fg: "green"
      },
      style: {
        fg: "green",
        bg: "black",
        border: { fg: "green" },
        focus: { border: { fg: "yellow" } }
      },
      inputOnFocus: true,
      value: "",
      tags: true
    });

    // ═══ Progress Bar ═══
    this.progressLabel = blessed.box({
      parent: this.mainFrame,
      top: 9,
      left: 2,
      width: 16,
      height: 1,
      tags: true,
      style: { fg: "yellow" },
      content: "{bold}[PROGRESS]{/bold}"
    });

    this.progressBar = blessed.progressbar({
      parent: this.mainFrame,
      top: 10,
      left: 2,
      width: "100%-4",
      height: 1,
      orientation: "horizontal",
      style: {
        bar: { bg: "green" },
        border: { fg: "green" }
      },
      filled: 0,
      pch: "█",
      tags: true
    });

    this.statusText = blessed.box({
      parent: this.mainFrame,
      top: 11,
      left: 2,
      width: "100%-4",
      height: 1,
      tags: true,
      style: { fg: "cyan" },
      content: "{right}READY{/right}"
    });

    // ═══ Log Section ═══
    this.logLabel = blessed.box({
      parent: this.mainFrame,
      top: 13,
      left: 2,
      width: 12,
      height: 1,
      tags: true,
      style: { fg: "yellow" },
      content: "{bold}[SYS.LOG]{/bold}"
    });

    this.logBox = blessed.log({
      parent: this.mainFrame,
      top: 14,
      left: 2,
      width: "60%",
      height: "100%-18",
      label: " System Log ",
      border: {
        type: "line",
        fg: "green"
      },
      style: {
        fg: "green",
        bg: "black",
        border: { fg: "green" }
      },
      scrollable: true,
      alwaysScroll: true,
      tags: true,
      scrollbar: {
        ch: " ",
        inverse: true
      }
    });

    // ═══ Result Section ═══
    this.resultLabel = blessed.box({
      parent: this.mainFrame,
      top: 13,
      left: "60%+1",
      width: 14,
      height: 1,
      tags: true,
      style: { fg: "yellow" },
      content: "{bold}[RESULT]{/bold}"
    });

    this.resultBox = blessed.box({
      parent: this.mainFrame,
      top: 14,
      left: "60%+1",
      width: "40%-3",
      height: "100%-18",
      label: " Download Links ",
      border: {
        type: "line",
        fg: "green"
      },
      style: {
        fg: "green",
        bg: "black",
        border: { fg: "green" }
      },
      scrollable: true,
      alwaysScroll: true,
      tags: true,
      scrollbar: {
        ch: " ",
        inverse: true
      }
    });

    // ═══ Help Panel ═══
    this.helpBox = blessed.box({
      parent: this.mainFrame,
      top: "100%-15",
      left: 2,
      width: "100%-4",
      height: 6,
      label: " Controls ",
      border: {
        type: "line",
        fg: "green"
      },
      style: {
        fg: "green",
        bg: "black",
        border: { fg: "green" }
      },
      tags: true,
      content:
        "  {yellow-fg}Ctrl+A{/yellow-fg} Copy URL    {yellow-fg}Ctrl+Q{/yellow-fg} Quit    {yellow-fg}Ctrl+D{/yellow-fg} Focus Input    {yellow-fg}Ctrl+R{/yellow-fg} Reset    {yellow-fg}Enter{/yellow-fg} Download"
    });

    // ═══ Footer Bar ═══
    this.footer = blessed.box({
      parent: screen,
      bottom: 0,
      left: 0,
      width: "100%",
      height: 1,
      style: {
        fg: "black",
        bg: "green"
      },
      tags: true,
      content:
        "  TikTok Downloader v1.0  |  SnapTik API  |  Press Ctrl+Q to exit  "
    });

    this.inputBox.focus();
  }

  bindKeys() {
    // ─── Ctrl+A: Copy URL ───
    this.screen.key(["C-a"], async () => {
      if (this.downloadResult?.links?.length > 0) {
        const url = this.downloadResult.links[this.selectedLinkIndex]?.url || 
                    this.downloadResult.links[0].url;
        try {
          await copyToClipboard(url);
          this.log("{green-fg}[OK]{/green-fg} URL copied to clipboard!");
          this.setStatus("URL COPIED");
        } catch (err) {
          this.log(`{red-fg}[ERR]{/red-fg} Copy failed: ${err.message}`);
          this.setStatus("COPY FAILED");
        }
      } else {
        this.log("{yellow-fg}[WARN]{/yellow-fg} No URL to copy!");
      }
    });

    // ─── Ctrl+Q: Quit ───
    this.screen.key(["C-q"], () => {
      this.log("{yellow-fg}[SYS]{/yellow-fg} Shutting down...");
      this.setStatus("EXITING...");
      setTimeout(() => process.exit(0), 500);
    });

    // ─── Ctrl+D: Focus Input ───
    this.screen.key(["C-d"], () => {
      this.inputBox.focus();
      this.setStatus("INPUT FOCUS");
    });

    // ─── Ctrl+R: Reset ───
    this.screen.key(["C-r"], () => {
      this.reset();
    });

    // ─── Enter: Download ───
    this.inputBox.key(["enter"], async () => {
      const url = this.inputBox.getValue().trim();
      if (!url) {
        this.log("{yellow-fg}[WARN]{/yellow-fg} URL is empty!");
        return;
      }
      await this.download(url);
    });

    // ─── Arrow keys for link selection ───
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

  log(message) {
    const timestamp = new Date().toLocaleTimeString("id-ID", {
      hour12: false
    });
    this.logBox.log(`[${timestamp}] ${message}`);
    this.screen.render();
  }

  setStatus(status) {
    this.statusText.setContent(`{right}{bold}${status}{/bold}{/right}`);
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
    this.log("{yellow-fg}[SYS]{/yellow-fg} Form reset");
    this.setStatus("READY");
    this.inputBox.focus();
    this.screen.render();
  }

  async download(url) {
    if (this.isProcessing) {
      this.log("{yellow-fg}[WARN]{/yellow-fg} Already processing!");
      return;
    }

    this.isProcessing = true;
    this.currentUrl = url;
    this.downloadResult = null;
    this.selectedLinkIndex = 0;
    this.setProgress(0);
    this.setStatus("PROCESSING...");
    this.log(`{cyan-fg}[REQ]{/cyan-fg} Target: ${url.substring(0, 50)}...`);

    try {
      // Step 1: Get token
      this.setProgress(10);
      this.log("{blue-fg}[1/4]{/blue-fg} Fetching token...");
      const home = await openHome();
      this.log(`{green-fg}[OK]{/green-fg} Token: ${home.token.substring(0, 25)}...`);
      this.setProgress(25);

      // Step 2: Submit URL
      this.log("{blue-fg}[2/4]{/blue-fg} Submitting to SnapTik...");
      const post = await submitVideo(url, home.token);
      this.log(`{green-fg}[OK]{/green-fg} HTTP ${post.status}`);
      this.setProgress(50);

      // Step 3: Decode
      this.log("{blue-fg}[3/4]{/blue-fg} Decoding obfuscated response...");
      const decoded = decodeObfuscatedResponse(post.body);
      this.log(`{green-fg}[OK]{/green-fg} Decoded: ${decoded.length} chars`);
      this.setProgress(75);

      // Step 4: Extract
      this.log("{blue-fg}[4/4]{/blue-fg} Extracting download links...");
      const result = await extractResult(decoded);
      this.downloadResult = result;
      this.setProgress(90);

      // Render if needed
      let render = null;
      if (result.render_token) {
        this.log("{blue-fg}[RND]{/blue-fg} Async render started...");
        render = await renderVideo(result.render_token);
        if (render?.download_url) {
          this.log("{green-fg}[OK]{/green-fg} Render complete!");
        }
      }

      this.setProgress(100);
      this.displayResult(result, render);
      this.log("{green-fg}[DONE]{/green-fg} Download ready!");
      this.setStatus("COMPLETE");

    } catch (err) {
      this.setProgress(0);
      this.log(`{red-fg}[ERR]{/red-fg} ${err.message}`);
      this.setStatus("FAILED");
      this.resultBox.setContent(
        `{red-fg}{bold}ERROR:{/bold}{/red-fg}\n${err.message}`
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
      content += `{bold}Thumb:{/bold} ${result.thumbnail.substring(0, 40)}...\n`;
    }

    content += `\n{bold}Links:{/bold}\n`;

    if (result.links && result.links.length > 0) {
      result.links.forEach((link, i) => {
        const marker = i === this.selectedLinkIndex ? 
          "{yellow-fg}▶{/yellow-fg}" : " ";
        content += `${marker} ${i + 1}. ${link.text}\n`;
        content += `   ${link.url}\n\n`;
      });
      content += `\n{yellow-fg}Use ↑↓ to select, Ctrl+A to copy{/yellow-fg}\n`;
    } else {
      content += "  {yellow-fg}No links found{/yellow-fg}\n";
    }

    if (render?.download_url) {
      content += `\n{bold}Render:{/bold}\n  ${render.download_url}\n`;
    }

    this.resultBox.setContent(content);
    this.screen.render();
  }

  start() {
    this.log("{green-fg}[BOOT]{/green-fg} TikTok Downloader initialized");
    this.log("{green-fg}[BOOT]{/green-fg} SnapTik API connected");
    this.log("{yellow-fg}[INFO]{/yellow-fg} Paste URL and press Enter");
    this.setStatus("READY");
    this.screen.render();
  }
}

// ═══════════════════════════════════════════════════════════════════════════════
//  BOOT SEQUENCE
// ═══════════════════════════════════════════════════════════════════════════════

const app = new RetroTikTokDownloader();
app.start();
