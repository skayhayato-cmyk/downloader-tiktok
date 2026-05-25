/**
 * YouTube Downloader Module
 * Scraping: Ditzzx via youtubedl.siputzx.my.id
 */

import yt from "@vreden/youtube_scraper";
import crypto from "crypto";
import axios from "axios";
import { wrapper } from "axios-cookiejar-support";
import { CookieJar } from "tough-cookie";
import fs from "node:fs";
import path from "node:path";
import blessed from "blessed";

const BASE_URL = "https://youtubedl.siputzx.my.id";

// ========== YOUTUBE DOWNLOADER LOGIC ==========
function solvePow(challenge, difficulty) {
  let nonce = 0;
  const prefix = "0".repeat(Number(difficulty));

  while (true) {
    const hash = crypto
      .createHash("sha256")
      .update(challenge + nonce.toString())
      .digest("hex");

    if (hash.startsWith(prefix)) {
      return nonce.toString();
    }

    nonce++;

    if (nonce > 10000000) {
      throw new Error("PoW solving timeout");
    }
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
        "User-Agent":
          "Mozilla/5.0 (Linux; Android 10; K) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/147.0.0.0 Mobile Safari/537.36",
        Origin: BASE_URL,
        Referer: `${BASE_URL}/`,
        "X-Request-Id": crypto.randomUUID()
      }
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
    const challengeRes = await client.post(`${BASE_URL}/akumaudownload`, {
      url,
      type: downloadType
    });

    if (challengeRes.status !== 200) {
      throw new Error(`Challenge ${downloadType} gagal HTTP ${challengeRes.status}`);
    }

    const { challenge, difficulty } = challengeRes.data || {};

    if (!challenge || !difficulty) {
      throw new Error(`Challenge ${downloadType} tidak ditemukan`);
    }

    const nonce = solvePow(challenge, difficulty);

    const verifyRes = await client.post(`${BASE_URL}/cekpunyaku`, {
      url,
      type: downloadType,
      nonce
    });

    if (verifyRes.status !== 200) {
      throw new Error(`Verify ${downloadType} gagal HTTP ${verifyRes.status}`);
    }
  }

  for (let attempts = 0; attempts < 30; attempts++) {
    const downloadRes = await client.get(`${BASE_URL}/download`, {
      params: {
        url,
        type: downloadType,
        apikey
      }
    });

    const data = downloadRes.data || {};

    if (data.status === "completed" && data.fileUrl) {
      return `${BASE_URL}${data.fileUrl}`;
    }

    if (data.status === "failed") {
      throw new Error(data.error || `Download ${downloadType} failed`);
    }

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
  const thumbnails = Array.isArray(metadata?.thumbnails)
    ? metadata.thumbnails
    : [];

  const bestThumbnail =
    thumbnails.find(v => v.quality === "maxres")?.url ||
    thumbnails.find(v => v.quality === "standard")?.url ||
    thumbnails.find(v => v.quality === "high")?.url ||
    thumbnails.at(-1)?.url ||
    metadata?.thumbnail ||
    metadata?.image ||
    metadata?.thumb ||
    null;

  const id = metadata?.id || metadata?.videoId || getYoutubeId(inputUrl);

  return {
    title: metadata?.title || null,
    author:
      metadata?.author?.name ||
      metadata?.author ||
      metadata?.channel_title ||
      metadata?.channel ||
      null,
    views:
      metadata?.statistics?.view
        ? Number(metadata.statistics.view)
        : metadata?.views || metadata?.viewCount || null,
    thumbnail: bestThumbnail,
    url:
      metadata?.url ||
      metadata?.videoUrl ||
      (id ? `https://youtube.com/watch?v=${id}` : inputUrl)
  };
}

async function getMetadata(url) {
  try {
    const data = await yt.metadata(url);
    return cleanMetadata(data, url);
  } catch {
    return cleanMetadata({}, url);
  }
}

async function ytdl(url) {
  if (!url) {
    throw new Error("URL kosong");
  }

  const youtubeRegex =
    /^(https?:\/\/)?(www\.)?(youtube\.com|youtu\.be|music\.youtube\.com)\/.+$/;

  if (!youtubeRegex.test(url)) {
    throw new Error("URL YouTube tidak valid");
  }

  const [metadata, urlVideo, urlAudio] = await Promise.all([
    getMetadata(url),
    downloadWithExternalAPI("video", url, null),
    downloadWithExternalAPI("mp3", url, null)
  ]);

  return {
    Status: true,
    Code: 200,
    Input: url,
    Metadata: metadata,
    Result: {
      Url_video: urlVideo,
      Url_audio: urlAudio
    }
  };
}

// ========== TUI INTERFACE ==========
export function runYoutube(screen, headerBox, statusBar, showNotification, ensureDownloadDir, downloadDir, COLORS, STYLES) {
  let currentVideoUrl = null;
  let currentAudioUrl = null;
  let currentTitle = "youtube_video";

  const container = blessed.box({
    parent: screen,
    top: 4,
    left: "center",
    width: 70,
    height: 22,
    label: " {bold}  YouTube Downloader  {/bold} ",
    border: STYLES.box.border,
    style: STYLES.box.style,
  });

  const urlInput = blessed.textbox({
    parent: container,
    top: 2,
    left: 2,
    right: 2,
    height: 3,
    label: " URL YouTube ",
    border: STYLES.input.border,
    style: STYLES.input.style,
    inputOnFocus: true,
  });

  const fetchBtn = blessed.button({
    parent: container,
    top: 6,
    left: 2,
    width: 16,
    height: 3,
    content: "{center}🔍 Fetch{/}",
    border: STYLES.button.border,
    style: STYLES.button.style,
    tags: true,
    mouse: true,
    keys: true,
  });

  const dlVideoBtn = blessed.button({
    parent: container,
    top: 6,
    left: 20,
    width: 16,
    height: 3,
    content: "{center}🎬 Video{/}",
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

  const dlAudioBtn = blessed.button({
    parent: container,
    top: 6,
    left: 38,
    width: 16,
    height: 3,
    content: "{center}🎵 Audio{/}",
    border: STYLES.button.border,
    style: {
      ...STYLES.button.style,
      focus: { bg: COLORS.accent2, fg: "#ffffff", border: { fg: COLORS.accent2 } },
      hover: { bg: COLORS.accent2, fg: "#ffffff" },
    },
    tags: true,
    mouse: true,
    keys: true,
  });

  const backBtn = blessed.button({
    parent: container,
    top: 6,
    left: 56,
    width: 10,
    height: 3,
    content: "{center}⬅️{/}",
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
    content: "{center}{#8b949e-fg}Masukkan URL YouTube dan klik Fetch{/}
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

    resultBox.setContent("{center}{#58a6ff-fg}⏳ Mengambil data... (PoW + Poll){/}
");
    screen.render();

    try {
      const data = await ytdl(url);

      if (!data.Status) {
        resultBox.setContent(`{center}{#f85149-fg}❌ Gagal mengambil data{/}
`);
        screen.render();
        return;
      }

      currentVideoUrl = data.Result.Url_video;
      currentAudioUrl = data.Result.Url_audio;
      currentTitle = data.Metadata?.title || "youtube_video";

      resultBox.setContent(
        `{bold}{#3fb950-fg}✔ Berhasil!{/}{/}

`
        + `  {bold}Title:{/} ${data.Metadata?.title || "-"}
`
        + `  {bold}Author:{/} ${data.Metadata?.author || "-"}
`
        + `  {bold}Views:{/} ${data.Metadata?.views?.toLocaleString() || "-"}

`
        + `  {bold}{#3fb950-fg}🎬 Video:{/}{/}
  {#58a6ff-fg}${data.Result.Url_video}{/}

`
        + `  {bold}{#f0883e-fg}🎵 Audio:{/}{/}
  {#58a6ff-fg}${data.Result.Url_audio}{/}

`
        + `  {bold}Thumbnail:{/}
  {#58a6ff-fg}${data.Metadata?.thumbnail || "-"}{/}
`
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

  async function downloadMedia(mediaType) {
    const url = mediaType === "video" ? currentVideoUrl : currentAudioUrl;

    if (!url) {
      showNotification(`Belum ada URL ${mediaType}! Klik Fetch dulu.`, "warning");
      return;
    }

    if (!ensureDownloadDir()) return;

    resultBox.setContent(`{center}{#58a6ff-fg}⬇️ Mendownload ${mediaType}...{/}
`);
    screen.render();

    try {
      const ext = mediaType === "video" ? "mp4" : "mp3";
      const safeName = currentTitle.replace(/[^a-zA-Z0-9\u0000-\u007F]/g, "_").substring(0, 50);
      const filename = `youtube_${mediaType}_${safeName}_${Date.now()}.${ext}`;
      const filepath = path.join(downloadDir, filename);

      const response = await axios({
        method: "GET",
        url: url,
        responseType: "stream",
        timeout: 300000,
        headers: {
          "User-Agent": "Mozilla/5.0 (Linux; Android 10; K) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/147.0.0.0 Mobile Safari/537.36",
          "Accept": "*/*",
          "Referer": BASE_URL,
        }
      });

      const writer = fs.createWriteStream(filepath);
      response.data.pipe(writer);

      await new Promise((resolve, reject) => {
        writer.on("finish", resolve);
        writer.on("error", reject);
      });

      const size = (fs.statSync(filepath).size / 1024 / 1024).toFixed(2);

      resultBox.setContent(
        `{center}{bold}{#3fb950-fg}✔ Download Berhasil!{/}{/}

`
        + `  {bold}File:{/} ${filename}
`
        + `  {bold}Path:{/} ${filepath}
`
        + `  {bold}Size:{/} ${size} MB
`
        + `  {bold}Type:{/} ${mediaType.toUpperCase()}
`
      );

      showNotification(`Download ${mediaType} berhasil! ${filename}`, "success", 3000);
      screen.render();
    } catch (err) {
      resultBox.setContent(`{center}{#f85149-fg}❌ Download gagal: ${err.message}{/}
`);
      screen.render();
      showNotification(`Download gagal: ${err.message}`, "error");
    }
  }

  fetchBtn.on("press", fetchVideo);
  dlVideoBtn.on("press", () => downloadMedia("video"));
  dlAudioBtn.on("press", () => downloadMedia("audio"));
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
