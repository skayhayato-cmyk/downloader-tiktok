/**
 * TikTok Downloader Module
 * Scraping: Ditzzx via SnapTik
 */

import axios from "axios";
import FormData from "form-data";
import { CookieJar } from "tough-cookie";
import * as cheerio from "cheerio";
import vm from "node:vm";
import crypto from "node:crypto";
import fs from "node:fs";
import path from "node:path";
import blessed from "blessed";

const BASE = "https://snaptik.app";
const PAGE = `${BASE}/en2`;
const API = `${BASE}/abc2.php`;
const LANG = "en2";

const UA =
  "Mozilla/5.0 (Linux; Android 10; K) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/147.0.0.0 Mobile Safari/537.36";

// ========== TIKTOK DOWNLOADER LOGIC ==========
const jar = new CookieJar();

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

  return { status: res.status, token, html };
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

  return { status: res.status, body: String(res.data || "") };
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
    params: { token: renderToken },
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
      params: { token: taskId },
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

async function askTiktok(url) {
  const home = await openHome();
  const post = await submitVideo(url, home.token);
  const decoded = decodeObfuscatedResponse(post.body);
  const result = await extractResult(decoded);

  let render = null;
  if (result.render_token) {
    render = await renderVideo(result.render_token);
  }

  const output = {
    Status: post.status === 200,
    Code: post.status,
    Label: "SnapTik",
    Input: url,
    Token: home.token,
    Result: {
      title: result.title,
      author: result.author,
      thumbnail: result.thumbnail,
      links: result.links
    }
  };

  if (render) {
    output.Result.render = render;
  }

  return output;
}

// ========== TUI INTERFACE ==========
export function runTiktok(screen, headerBox, statusBar, showNotification, ensureDownloadDir, downloadDir, COLORS, STYLES) {
  let currentDownloadUrl = null;
  let currentTitle = "tiktok_video";

  const container = blessed.box({
    parent: screen,
    top: 4,
    left: "center",
    width: 70,
    height: 20,
    label: " {bold}  TikTok Downloader  {/bold} ",
    border: STYLES.box.border,
    style: STYLES.box.style,
  });

  const urlInput = blessed.textbox({
    parent: container,
    top: 2,
    left: 2,
    right: 2,
    height: 3,
    label: " URL TikTok ",
    border: STYLES.input.border,
    style: STYLES.input.style,
    inputOnFocus: true,
  });

  const fetchBtn = blessed.button({
    parent: container,
    top: 6,
    left: 2,
    width: 20,
    height: 3,
    content: "{center}🔍 Fetch{/}",
    border: STYLES.button.border,
    style: STYLES.button.style,
    tags: true,
    mouse: true,
    keys: true,
  });

  const downloadBtn = blessed.button({
    parent: container,
    top: 6,
    left: 24,
    width: 20,
    height: 3,
    content: "{center}⬇️ Download{/}",
    border: STYLES.button.border,
    style: {
      ...STYLES.button.style,
      focus: { bg: COLORS.success, fg: "#ffffff", border: { fg: COLORS.success } },
      hover: { bg: COLORS.success, fg: "#ffffff" },
    },
    tags: true,
    mouse: true,
    keys: true,
  });

  const backBtn = blessed.button({
    parent: container,
    top: 6,
    left: 46,
    width: 20,
    height: 3,
    content: "{center}⬅️ Kembali{/}",
    border: STYLES.button.border,
    style: STYLES.button.style,
    tags: true,
    mouse: true,
    keys: true,
  });

  const resultBox = blessed.box({
    parent: container,
    top: 10,
    left: 2,
    right: 2,
    bottom: 1,
    label: " Result ",
    border: { type: "line", fg: COLORS.border },
    style: { fg: COLORS.fg, bg: COLORS.bg, border: { fg: COLORS.border } },
    scrollable: true,
    alwaysScroll: true,
    mouse: true,
    keys: true,
    tags: true,
    content: "{center}{#8b949e-fg}Masukkan URL TikTok dan klik Fetch{/}
",
  });

  function backToMenu() {
    container.destroy();
    screen.render();
    // Trigger back to main menu
    screen.emit("key", { name: "escape" }, { name: "escape" });
  }

  async function fetchVideo() {
    const url = urlInput.getValue().trim();
    if (!url) {
      showNotification("URL tidak boleh kosong!", "error");
      return;
    }

    resultBox.setContent("{center}{#58a6ff-fg}⏳ Mengambil data...{/}
");
    screen.render();

    try {
      const data = await askTiktok(url);

      if (!data.Status || !data.Result.links.length) {
        resultBox.setContent(`{center}{#f85149-fg}❌ Gagal mengambil data
${data.Result?.links ? "Tidak ada link tersedia" : "Error"}{/}
`);
        screen.render();
        return;
      }

      currentDownloadUrl = data.Result.links[0]?.url || null;
      currentTitle = data.Result.title || "tiktok_video";

      let linksText = "";
      data.Result.links.forEach((link, i) => {
        linksText += `  {bold}[${i + 1}]{/bold} ${link.text}
  {#58a6ff-fg}${link.url}{/}

`;
      });

      const thumbText = data.Result.thumbnail
        ? `{#3fb950-fg}✔ Thumbnail:{/} ${data.Result.thumbnail}
`
        : "";

      resultBox.setContent(
        `{bold}{#3fb950-fg}✔ Berhasil!{/}{/}

`
        + `  {bold}Title:{/} ${data.Result.title || "-"}
`
        + `  {bold}Author:{/} ${data.Result.author || "-"}
`
        + `  {bold}Links:{/}
${linksText}`
        + thumbText
      );

      showNotification("Data berhasil diambil!", "success");
      screen.render();
    } catch (err) {
      resultBox.setContent(`{center}{#f85149-fg}❌ Error: ${err.message}{/}
`);
      screen.render();
      showNotification(`Error: ${err.message}`, "error");
    }
  }

  async function downloadVideo() {
    if (!currentDownloadUrl) {
      showNotification("Belum ada URL untuk di-download! Klik Fetch dulu.", "warning");
      return;
    }

    if (!ensureDownloadDir()) return;

    resultBox.setContent("{center}{#58a6ff-fg}⬇️ Mendownload video...{/}
");
    screen.render();

    try {
      const safeName = currentTitle.replace(/[^a-zA-Z0-9 -]/g, "_").substring(0, 50);
      const filename = `tiktok_${safeName}_${Date.now()}.mp4`;
      const filepath = path.join(downloadDir, filename);

      const response = await axios({
        method: "GET",
        url: currentDownloadUrl,
        responseType: "stream",
        timeout: 120000,
        headers: {
          "User-Agent": UA,
          "Accept": "*/*",
          "Referer": BASE,
        }
      });

      const writer = fs.createWriteStream(filepath);
      response.data.pipe(writer);

      await new Promise((resolve, reject) => {
        writer.on("finish", resolve);
        writer.on("error", reject);
      });

      resultBox.setContent(
        `{center}{bold}{#3fb950-fg}✔ Download Berhasil!{/}{/}

`
        + `  {bold}File:{/} ${filename}
`
        + `  {bold}Path:{/} ${filepath}
`
        + `  {bold}Size:{/} ${(fs.statSync(filepath).size / 1024 / 1024).toFixed(2)} MB
`
      );

      showNotification(`Download berhasil! ${filename}`, "success", 3000);
      screen.render();
    } catch (err) {
      resultBox.setContent(`{center}{#f85149-fg}❌ Download gagal: ${err.message}{/}
`);
      screen.render();
      showNotification(`Download gagal: ${err.message}`, "error");
    }
  }

  fetchBtn.on("press", fetchVideo);
  downloadBtn.on("press", downloadVideo);
  backBtn.on("press", backToMenu);

  urlInput.key(["enter"], () => {
    fetchVideo();
  });

  container.key(["escape"], () => {
    backToMenu();
  });

  urlInput.focus();
  screen.render();
}
