/**
 * Instagram Downloader Module
 * Scraping: Ditzzx via SnapSave
 */

import crypto from "node:crypto";
import fs from "node:fs";
import path from "node:path";
import axios from "axios";
import blessed from "blessed";

const BASE = "https://snapsave.app";
const UA =
  "Mozilla/5.0 (Linux; Android 10; K) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/147.0.0.0 Mobile Safari/537.36";

// ========== INSTAGRAM DOWNLOADER LOGIC ==========
function randomGa() {
  return `GA1.1.${Math.floor(Math.random() * 2_000_000_000)}.${Math.floor(Date.now() / 1000)}`;
}

function randomPhpSession() {
  return crypto.randomBytes(13).toString("hex").slice(0, 26);
}

function parseSetCookie(headers) {
  const cookies = [];

  if (typeof headers.getSetCookie === "function") {
    for (const cookie of headers.getSetCookie()) {
      cookies.push(cookie.split(";")[0]);
    }
  } else {
    const raw = headers.get("set-cookie");
    if (raw) {
      cookies.push(...raw.split(/,(?=[^;,]+=)/).map((v) => v.split(";")[0].trim()));
    }
  }

  return cookies;
}

function mergeCookies(...lists) {
  const map = new Map();

  for (const list of lists) {
    for (const item of list) {
      const [key] = item.split("=");
      if (key) map.set(key.trim(), item.trim());
    }
  }

  return [...map.values()].join("; ");
}

function defaultCookies() {
  const now = Math.floor(Date.now() / 1000);

  return [
    `_ga=${randomGa()}`,
    `PHPSESSID=${randomPhpSession()}`,
    "__jscuActive=true",
    `_ga_WNPZGVDWE9=GS2.1.s${now}$o1$g0$t${now}$j60$l0$h0`,
  ];
}

function baseHeaders(cookie = "") {
  return {
    "user-agent": UA,
    "sec-ch-ua": `"Google Chrome";v="147", "Not.A/Brand";v="8", "Chromium";v="147"`,
    "sec-ch-ua-mobile": "?1",
    "sec-ch-ua-platform": `"Android"`,
    "accept-language": "id-ID,id;q=0.9,en-US;q=0.8,en;q=0.7",
    ...(cookie ? { cookie } : {}),
  };
}

async function initCookie() {
  const seed = defaultCookies().join("; ");

  try {
    const res = await fetch(`${BASE}/id/download-video-instagram`, {
      method: "GET",
      headers: {
        ...baseHeaders(seed),
        accept:
          "text/html,application/xhtml+xml,application/xml;q=0.9,image/avif,image/webp,image/apng,*/*;q=0.8",
        "upgrade-insecure-requests": "1",
      },
    });

    const setCookies = parseSetCookie(res.headers);
    return mergeCookies(defaultCookies(), setCookies);
  } catch {
    return seed;
  }
}

function convertBase(value, fromBase, toBase) {
  const chars = "0123456789abcdefghijklmnopqrstuvwxyzABCDEFGHIJKLMNOPQRSTUVWXYZ+/".split("");
  const fromChars = chars.slice(0, fromBase);
  const toChars = chars.slice(0, toBase);

  let number = value
    .split("")
    .reverse()
    .reduce((acc, char, index) => {
      const pos = fromChars.indexOf(char);
      if (pos !== -1) return acc + pos * Math.pow(fromBase, index);
      return acc;
    }, 0);

  let out = "";

  while (number > 0) {
    out = toChars[number % toBase] + out;
    number = (number - (number % toBase)) / toBase;
  }

  return out || "0";
}

function decodeSnapSaveEval(html) {
  const match = html.match(
    /eval\(function\(h,u,n,t,e,r\)[\s\S]*?\}\("([^"]+)",(\d+),"([^"]+)",(\d+),(\d+),(\d+)\)\)/,
  );

  if (!match) return html;

  const h = match[1];
  const n = match[3];
  const t = Number(match[4]);
  const e = Number(match[5]);
  const delimiter = n[e];

  let result = "";

  for (let i = 0; i < h.length; i++) {
    let chunk = "";

    while (i < h.length && h[i] !== delimiter) {
      chunk += h[i];
      i++;
    }

    for (let j = 0; j < n.length; j++) {
      chunk = chunk.replaceAll(n[j], String(j));
    }

    result += String.fromCharCode(Number(convertBase(chunk, e, 10)) - t);
  }

  return decodeURIComponent(escape(result));
}

function cleanHtmlText(value = "") {
  return value
    .replaceAll('\"', '"')
    .replaceAll("\/", "/")
    .replaceAll("&amp;", "&")
    .replaceAll("\n", "")
    .replaceAll("\t", "")
    .trim();
}

function extractResults(decoded) {
  const text = cleanHtmlText(decoded);

  const results = [];
  const hrefRegex = /href="([^"]+)"/g;
  let match;

  while ((match = hrefRegex.exec(text))) {
    const url = match[1];

    if (!url.includes("rapidcdn.app") && !url.includes("cdninstagram.com")) continue;

    let type = "unknown";
    if (/\.mp4|\/v2\?token=|video/i.test(url)) type = "video";
    if (/thumb|\.jpg|\.jpeg|\.png|image/i.test(url)) type = "thumbnail";

    results.push({ type, url });
  }

  const unique = [];
  const seen = new Set();

  for (const item of results) {
    if (seen.has(item.url)) continue;
    seen.add(item.url);
    unique.push(item);
  }

  return unique;
}

async function snapsave(url) {
  const cookie = await initCookie();

  const form = new FormData();
  form.append("url", url);

  const res = await fetch(`${BASE}/id/action.php?lang=id`, {
    method: "POST",
    headers: {
      ...baseHeaders(cookie),
      accept: "*/*",
      origin: BASE,
      referer: `${BASE}/id/download-video-instagram`,
      "sec-fetch-site": "same-origin",
      "sec-fetch-mode": "cors",
      "sec-fetch-dest": "empty",
    },
    body: form,
  });

  const raw = await res.text();
  const decoded = decodeSnapSaveEval(raw);
  const result = extractResults(decoded);

  return {
    status: res.ok && result.length > 0,
    code: res.status,
    input: url,
    result,
    raw: result.length ? undefined : decoded,
  };
}

// ========== TUI INTERFACE ==========
export function runInstagram(screen, headerBox, statusBar, showNotification, ensureDownloadDir, downloadDir, COLORS, STYLES) {
  let currentDownloadUrl = null;
  let currentType = "video";

  const container = blessed.box({
    parent: screen,
    top: 4,
    left: "center",
    width: 70,
    height: 20,
    label: " {bold}  Instagram Downloader  {/bold} ",
    border: STYLES.box.border,
    style: STYLES.box.style,
  });

  const urlInput = blessed.textbox({
    parent: container,
    top: 2,
    left: 2,
    right: 2,
    height: 3,
    label: " URL Instagram ",
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
    content: "{center}{#8b949e-fg}Masukkan URL Instagram dan klik Fetch{/}
",
  });

  function backToMenu() {
    container.destroy();
    screen.render();
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
      const data = await snapsave(url);

      if (!data.status || !data.result.length) {
        resultBox.setContent(`{center}{#f85149-fg}❌ Gagal mengambil data
${data.raw ? "Response tidak valid" : "Tidak ada media ditemukan"}{/}
`);
        screen.render();
        return;
      }

      const videoItem = data.result.find(r => r.type === "video") || data.result[0];
      currentDownloadUrl = videoItem?.url || null;
      currentType = videoItem?.type || "video";

      let linksText = "";
      data.result.forEach((item, i) => {
        const icon = item.type === "video" ? "🎬" : item.type === "thumbnail" ? "🖼️" : "📄";
        linksText += `  {bold}[${i + 1}]{/bold} ${icon} ${item.type.toUpperCase()}
  {#58a6ff-fg}${item.url}{/}

`;
      });

      resultBox.setContent(
        `{bold}{#3fb950-fg}✔ Berhasil!{/}{/}

`
        + `  {bold}URL Input:{/} ${data.input}
`
        + `  {bold}Status:{/} ${data.status ? "OK" : "FAIL"} (${data.code})

`
        + `  {bold}Media Ditemukan:{/}
${linksText}`
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

    resultBox.setContent("{center}{#58a6ff-fg}⬇️ Mendownload media...{/}
");
    screen.render();

    try {
      const ext = currentType === "video" ? "mp4" : "jpg";
      const filename = `instagram_${Date.now()}.${ext}`;
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
