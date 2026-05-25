/**
 * tiktok-downloader.js
 * Core scraper module - handles all SnapTik API interactions
 * Created by: Ditzzx
 * Project: TikTok Downloader
 */

import axios from "axios";
import FormData from "form-data";
import { CookieJar } from "tough-cookie";
import * as cheerio from "cheerio";
import vm from "node:vm";
import crypto from "node:crypto";

const BASE = "https://snaptik.app";
const PAGE = `${BASE}/en2`;
const API = `${BASE}/abc2.php`;
const LANG = "en2";

const UA = "Mozilla/5.0 (Linux; Android 10; K) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/147.0.0.0 Mobile Safari/537.36";

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

export async function openHome() {
  const res = await axios.get(PAGE, {
    timeout: 30000,
    validateStatus: () => true,
    headers: commonHeaders({
      accept: "text/html,application/xhtml+xml,application/xml;q=0.9,image/avif,image/webp,image/apng,*/*;q=0.8",
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

export async function submitVideo(url, token) {
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

export function decodeObfuscatedResponse(body) {
  let decoded = "";

  const context = {
    console, Math, Date, RegExp, String,
    decodeURIComponent, escape,
    window: { location: { hostname: "snaptik.app" } },
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

export async function extractResult(decodedJs) {
  const dom = new Map();

  const fakeDollar = selector => {
    if (!dom.has(selector)) {
      dom.set(selector, {
        innerHTML: "", style: {},
        remove() {}, addClass() {}, removeClass() {}, show() {}, hide() {},
        html(value) {
          if (value !== undefined) this.innerHTML = String(value);
          return this.innerHTML;
        }
      });
    }
    return dom.get(selector);
  };

  const context = {
    console, Math, Date, RegExp, String, setTimeout, clearTimeout,
    document: {
      getElementById() { return { src: "", style: {} }; },
      querySelector() { return { innerHTML: "", style: {} }; }
    },
    window: { location: { hostname: "snaptik.app" } },
    gtag() {},
    fetch: async () => ({ json: async () => ({}) }),
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

    links.push({ text: text || "Download", url: href });
  });

  return {
    title: $(".video-title").first().text().trim() || null,
    author: $(".info span").first().text().trim() || null,
    thumbnail: $("#thumbnail").attr("src") || $(".avatar").attr("src") || $("img").first().attr("src") || null,
    render_token: $(".btn-render").attr("data-token") || null,
    links
  };
}

export async function renderVideo(renderToken) {
  if (!renderToken) return null;

  const cookie = await getCookieHeader();

  const renderRes = await axios.get(`${BASE}/render.php`, {
    timeout: 30000,
    validateStatus: () => true,
    params: { token: renderToken },
    headers: commonHeaders({ accept: "*/*", referer: PAGE, cookie })
  });

  const taskId = renderRes.data?.task_id;
  if (!taskId) return renderRes.data;

  for (let i = 0; i < 30; i++) {
    const poll = await axios.get(`${BASE}/task.php`, {
      timeout: 30000,
      validateStatus: () => true,
      params: { token: taskId },
      headers: commonHeaders({ accept: "*/*", referer: PAGE, cookie: await getCookieHeader() })
    });

    const data = poll.data;
    if (data?.download_url) return data;
    if (data?.status !== 0) return data;

    await new Promise(resolve => setTimeout(resolve, 3000));
  }

  return null;
}
