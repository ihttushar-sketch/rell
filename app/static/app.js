/* ==========================================================================
   rell — front-end. Vanilla JS, no build step, no dependencies.
   ========================================================================== */
"use strict";

/* ------------------------------------------------------------------ i18n */
const I18N = {
  en: {
    tagline: "paste a reel · get the whole page",
    library: "Library",
    cookies: "Cookies",
    heroTitle: "Drop a video link",
    modeSingle: "Single",
    modeBatch: "Batch",
    extract: "Extract",
    extracting: "Extracting…",
    paste: "Paste",
    batchPlaceholder: "Paste as many links as you like — one per line (Facebook, Instagram, …)",
    batchHint: "Links are detected automatically.",
    works: "Works with",
    loading: "Reading the page…",
    tabDownload: "Download",
    tabFormats: "Formats",
    tabJson: "Raw data",
    more: "more",
    less: "less",
    saveServer: "Save to server",
    dlThumb: "Download thumbnail",
    copyDirect: "Copy direct video link",
    openPage: "Open original page",
    preview: "Try inline preview",
    thId: "ID", thQuality: "Quality", thRes: "Resolution", thExt: "Ext",
    thVideo: "Video", thAudio: "Audio", thSize: "Size", thActions: "Actions",
    jsonNote: "The complete unfiltered metadata yt-dlp read from the page.",
    loadRaw: "Load raw dump",
    copyJson: "Copy",
    batchResults: "Batch results",
    downloadAll: "Download all (best)",
    errorTitle: "Could not read that page",
    recent: "Recent",
    clearHistory: "clear",
    footNote: "local & private — nothing is uploaded anywhere",
    libraryTitle: "Saved files",
    cookieTitle: "Cookies (for private / login-only reels)",
    cookieHelp: "Facebook and Instagram hide most reels behind a login. Paste a cookies.txt export (or a raw Cookie: header) and rell will use it for every request. It stays on this machine only.",
    cookieStep1: 'Install the "Get cookies.txt LOCALLY" browser extension.',
    cookieStep2: "Open facebook.com or instagram.com while logged in, click the extension, Export.",
    cookieStep3: "Paste the file contents below, or upload the file.",
    uploadFile: "Upload file",
    deleteCookies: "Delete",
    saveCookies: "Save cookies",
    copyError: "Copy error",
    sViews: "views", sLikes: "likes", sComments: "comments", sShares: "shares",
    sDuration: "duration", sUploaded: "uploaded", sQuality: "max quality",
    sFormats: "renditions", sId: "video id", sPlatform: "platform", sLive: "LIVE",
    qBest: "Best available", qAudio: "Audio only", qMp3: "MP3 audio",
    dlStart: "Download started — watch your browser's download bar.",
    copied: "Copied to clipboard",
    copyFailed: "Copy failed — select the text manually.",
    noCookies: "No cookies saved yet",
    cookiesOn: "Cookies active",
    cookiesOff: "No cookies",
    cookiesSaved: "Cookies saved",
    cookiesGone: "Cookies deleted",
    libraryEmpty: "Nothing saved yet. Use “Save to server” on any result.",
    ffmpegMissing: "ffmpeg missing — MP3 and stream merging disabled",
    engineReady: "ready",
    needUrl: "Paste a link first.",
    noLinks: "No links found in that text.",
    previewBlocked: "Inline preview blocked by the site — use Download instead.",
    saved: "Saved to server library",
    saveFailed: "Save failed",
    untitled: "Untitled",
    sDelete: "Delete",
    batchSummary: (ok, fail) => `${ok} ready · ${fail} failed`,
    directExpires: "Direct CDN links expire fast — download soon.",
  },
  bn: {
    tagline: "রিলের লিংক দিন · পুরো পেজের সব পান",
    library: "লাইব্রেরি",
    cookies: "কুকি",
    heroTitle: "ভিডিও লিংক দিন",
    modeSingle: "একটি",
    modeBatch: "অনেকগুলো",
    extract: "বের করুন",
    extracting: "বের হচ্ছে…",
    paste: "পেস্ট",
    batchPlaceholder: "যত খুশি লিংক পেস্ট করুন — প্রতি লাইনে একটি (ফেসবুক, ইনস্টাগ্রাম, …)",
    batchHint: "লিংকগুলো নিজে থেকেই শনাক্ত হবে।",
    works: "যেগুলো চলে",
    loading: "পেজটি পড়া হচ্ছে…",
    tabDownload: "ডাউনলোড",
    tabFormats: "ফরম্যাট",
    tabJson: "আসল ডেটা",
    more: "আরও",
    less: "কম",
    saveServer: "সার্ভারে সেভ করুন",
    dlThumb: "থাম্বনেইল ডাউনলোড",
    copyDirect: "সরাসরি ভিডিও লিংক কপি",
    openPage: "আসল পেজ খুলুন",
    preview: "প্রিভিউ চালানোর চেষ্টা",
    thId: "আইডি", thQuality: "কোয়ালিটি", thRes: "রেজোলিউশন", thExt: "ধরন",
    thVideo: "ভিডিও", thAudio: "অডিও", thSize: "সাইজ", thActions: "কাজ",
    jsonNote: "পেজ থেকে yt-dlp যা যা পড়েছে, তার সম্পূর্ণ কাঁচা ডেটা।",
    loadRaw: "কাঁচা ডেটা দেখুন",
    copyJson: "কপি",
    batchResults: "সব ফলাফল",
    downloadAll: "সব ডাউনলোড (সেরা)",
    errorTitle: "পেজটি পড়া যায়নি",
    recent: "সাম্প্রতিক",
    clearHistory: "মুছুন",
    footNote: "সম্পূর্ণ লোকাল ও প্রাইভেট — কোথাও কিছু পাঠানো হয় না",
    libraryTitle: "সেভ হওয়া ফাইল",
    cookieTitle: "কুকি (প্রাইভেট / লগইন-দরকারি রিলের জন্য)",
    cookieHelp: "ফেসবুক ও ইনস্টাগ্রামের বেশিরভাগ রিল লগইন ছাড়া দেখা যায় না। cookies.txt ফাইলের লেখা (অথবা Cookie: হেডার) পেস্ট করলে rell সব রিকোয়েস্টে সেটা ব্যবহার করবে। এটি শুধু এই মেশিনেই থাকবে।",
    cookieStep1: '"Get cookies.txt LOCALLY' + '" ব্রাউজার এক্সটেনশন ইনস্টল করুন।',
    cookieStep2: "লগইন অবস্থায় facebook.com বা instagram.com খুলে এক্সটেনশন থেকে Export করুন।",
    cookieStep3: "ফাইলের লেখা নিচে পেস্ট করুন, অথবা ফাইল আপলোড করুন।",
    uploadFile: "ফাইল আপলোড",
    deleteCookies: "মুছে ফেলুন",
    saveCookies: "কুকি সেভ করুন",
    copyError: "এরর কপি",
    sViews: "ভিউ", sLikes: "লাইক", sComments: "কমেন্ট", sShares: "শেয়ার",
    sDuration: "সময়", sUploaded: "আপলোড", sQuality: "সর্বোচ্চ কোয়ালিটি",
    sFormats: "রেন্ডিশন", sId: "ভিডিও আইডি", sPlatform: "প্ল্যাটফর্ম", sLive: "লাইভ",
    qBest: "সেরা কোয়ালিটি", qAudio: "শুধু অডিও", qMp3: "এমপি৩ অডিও",
    dlStart: "ডাউনলোড শুরু হয়েছে — ব্রাউজারের ডাউনলোড বার দেখুন।",
    copied: "কপি হয়েছে",
    copyFailed: "কপি করা যায়নি — নিজে সিলেক্ট করে কপি করুন।",
    noCookies: "এখনও কোনো কুকি সেভ নেই",
    cookiesOn: "কুকি চালু আছে",
    cookiesOff: "কুকি নেই",
    cookiesSaved: "কুকি সেভ হয়েছে",
    cookiesGone: "কুকি মুছে ফেলা হয়েছে",
    libraryEmpty: "এখনও কিছু সেভ হয়নি। যেকোনো ফলাফলে “সার্ভারে সেভ করুন” চাপুন।",
    ffmpegMissing: "ffmpeg নেই — এমপি৩ ও স্ট্রিম মার্জ বন্ধ থাকবে",
    engineReady: "প্রস্তুত",
    needUrl: "আগে একটি লিংক দিন।",
    noLinks: "এই লেখায় কোনো লিংক পাওয়া যায়নি।",
    previewBlocked: "সাইটটি প্রিভিউ আটকে দিয়েছে — ডাউনলোড ব্যবহার করুন।",
    saved: "সার্ভার লাইব্রেরিতে সেভ হয়েছে",
    saveFailed: "সেভ করা যায়নি",
    untitled: "শিরোনামহীন",
    sDelete: "মুছুন",
    batchSummary: (ok, fail) => `${ok} ঠিক আছে · ${fail} ব্যর্থ`,
    directExpires: "সরাসরি CDN লিংক দ্রুত নষ্ট হয়ে যায় — তাড়াতাড়ি ডাউনলোড করুন।",
  },
};

let LANG = localStorage.getItem("rell.lang") || "en";
const t = (key) => (I18N[LANG] && I18N[LANG][key]) || I18N.en[key] || key;

/* ------------------------------------------------------------------ state */
const state = {
  mode: "single",
  info: null,          // current MediaInfo
  presets: [],
  raw: null,           // raw dump
  ffmpeg: true,
  batch: [],
  jobTimer: null,
};

const $ = (sel, root = document) => root.querySelector(sel);
const $$ = (sel, root = document) => Array.from(root.querySelectorAll(sel));

/* ------------------------------------------------------------------ utils */
function toast(message, kind = "ok", ms = 3600) {
  const box = $("#toasts");
  const el = document.createElement("div");
  el.className = `toast ${kind}`;
  el.textContent = message;
  box.appendChild(el);
  setTimeout(() => {
    el.style.transition = "opacity .25s, transform .25s";
    el.style.opacity = "0";
    el.style.transform = "translateY(6px)";
    setTimeout(() => el.remove(), 260);
  }, ms);
}

function fmtCount(n) {
  if (n === null || n === undefined) return "—";
  const num = Number(n);
  if (!isFinite(num)) return "—";
  if (num < 1000) return String(num);
  const units = [["B", 1e9], ["M", 1e6], ["K", 1e3]];
  for (const [suffix, div] of units) {
    if (num >= div) {
      const v = num / div;
      return `${v >= 100 ? v.toFixed(0) : v.toFixed(1).replace(/\.0$/, "")}${suffix}`;
    }
  }
  return String(num);
}

function fmtBytes(n) {
  if (!n) return "";
  const u = ["B", "KB", "MB", "GB"];
  let v = Number(n), i = 0;
  while (v >= 1024 && i < u.length - 1) { v /= 1024; i++; }
  return `${v.toFixed(i === 0 ? 0 : 1)} ${u[i]}`;
}

async function copyText(text) {
  try {
    await navigator.clipboard.writeText(text);
    toast(t("copied"), "ok", 1800);
    return true;
  } catch {
    const ta = document.createElement("textarea");
    ta.value = text;
    ta.style.position = "fixed";
    ta.style.opacity = "0";
    document.body.appendChild(ta);
    ta.select();
    const ok = document.execCommand && document.execCommand("copy");
    ta.remove();
    toast(ok ? t("copied") : t("copyFailed"), ok ? "ok" : "err", 2200);
    return ok;
  }
}

async function api(path, options = {}) {
  const res = await fetch(path, options);
  let data = null;
  const type = res.headers.get("content-type") || "";
  if (type.includes("application/json")) data = await res.json();
  if (!res.ok) {
    const detail = data && (data.detail || data.error) ? data.detail || data.error : `HTTP ${res.status}`;
    const err = new Error(typeof detail === "string" ? detail : JSON.stringify(detail));
    err.hint = data && data.hint;
    err.status = res.status;
    throw err;
  }
  return data;
}

function thumbSrc(info) {
  const raw = info.thumbnail || (info.thumbnails && info.thumbnails.length ? info.thumbnails[info.thumbnails.length - 1].url : null);
  if (!raw) return null;
  return `/api/thumb?url=${encodeURIComponent(raw)}&referer=${encodeURIComponent(info.webpage_url || info.url || "")}`;
}

function downloadHref(url, quality) {
  return `/api/download?url=${encodeURIComponent(url)}&quality=${encodeURIComponent(quality)}`;
}

function triggerDownload(href) {
  const a = document.createElement("a");
  a.href = href;
  a.rel = "noopener";
  document.body.appendChild(a);
  a.click();
  a.remove();
}

/* ------------------------------------------------------------------ i18n apply */
function applyLang() {
  document.documentElement.lang = LANG === "bn" ? "bn" : "en";
  $$("[data-i18n]").forEach((el) => { el.textContent = t(el.dataset.i18n); });
  $$("[data-i18n-title]").forEach((el) => { el.title = t(el.dataset.i18nTitle); });
  $$("[data-i18n-placeholder]").forEach((el) => { el.placeholder = t(el.dataset.i18nPlaceholder); });
  $$(".lang-btn").forEach((b) => b.classList.toggle("active", b.dataset.lang === LANG));
  if (state.info) renderResult(state.info);
}

/* ------------------------------------------------------------------ health */
async function loadHealth() {
  try {
    const h = await api("/api/health");
    const d = h.details || {};
    state.ffmpeg = !!d.ffmpeg_available;
    const pill = $("#statusPill");
    pill.classList.remove("pill-muted", "pill-ok", "pill-warn", "pill-err");
    pill.classList.add(d.ffmpeg_available ? "pill-ok" : "pill-warn");
    $("#statusText").textContent = `${t("engineReady")} · yt-dlp ${d.yt_dlp_version || "?"}${d.cookies_loaded ? " · 🔑" : ""}`;
    $("#footVersion").textContent = `v${h.version}`;
    if (!d.ffmpeg_available) {
      pill.title = t("ffmpegMissing");
    }
  } catch (e) {
    $("#statusPill").classList.add("pill-err");
    $("#statusText").textContent = "offline";
  }
}

async function loadPresets() {
  try {
    const p = await api("/api/presets");
    state.presets = p.items || [];
    state.ffmpeg = !!p.ffmpeg_available;
  } catch { state.presets = []; }
}

/* ------------------------------------------------------------------ loading */
function setLoading(on, text) {
  $("#loading").hidden = !on;
  if (text) $("#loadingText").textContent = text;
  else $("#loadingText").textContent = t("loading");
  $("#btnExtract").disabled = on;
  $(".btn-label", $("#btnExtract")).textContent = on ? t("extracting") : t("extract");
  $(".spinner", $("#btnExtract")).hidden = !on;
}

function showError(message, hint) {
  $("#result").hidden = true;
  $("#batchResults").hidden = true;
  const box = $("#errorBox");
  box.hidden = false;
  $("#errorMessage").textContent = message || "Unknown error";
  const h = $("#errorHint");
  if (hint) { h.hidden = false; h.textContent = hint; } else { h.hidden = true; }
  box.scrollIntoView({ behavior: "smooth", block: "center" });
}

function hideError() { $("#errorBox").hidden = true; }

/* ------------------------------------------------------------------ result */
function statBlock(k, v) {
  if (v === null || v === undefined || v === "" || v === "—") return "";
  return `<div class="stat"><span class="k">${k}</span><span class="v">${v}</span></div>`;
}

function renderStats(info) {
  const parts = [];
  if (info.is_live) parts.push(statBlock("", `<span style="color:var(--err)">${t("sLive")}</span>`));
  parts.push(statBlock(t("sViews"), fmtCount(info.view_count)));
  parts.push(statBlock(t("sLikes"), fmtCount(info.like_count)));
  parts.push(statBlock(t("sComments"), fmtCount(info.comment_count)));
  parts.push(statBlock(t("sShares"), fmtCount(info.repost_count)));
  if (info.duration_text) parts.push(statBlock(t("sDuration"), info.duration_text));
  if (info.upload_date) parts.push(statBlock(t("sUploaded"), info.upload_date));
  if (info.best_height) parts.push(statBlock(t("sQuality"), `${info.best_height}p`));
  if (info.formats && info.formats.length) parts.push(statBlock(t("sFormats"), info.formats.length));
  if (info.video_id) parts.push(statBlock(t("sId"), `<code>${info.video_id}</code>`));
  $("#stats").innerHTML = parts.filter(Boolean).join("");
}

function renderQualityGrid(info) {
  const grid = $("#qualityGrid");
  if (!info.ok) { grid.innerHTML = ""; return; }

  const heights = [...new Set((info.formats || []).filter((f) => f.has_video && f.height).map((f) => f.height))].sort((a, b) => b - a);
  const sizeFor = (h) => {
    const matches = (info.formats || []).filter((f) => f.has_video && f.height === h && f.filesize);
    if (!matches.length) return "";
    return fmtBytes(Math.max(...matches.map((f) => f.filesize)));
  };
  const resFor = (h) => {
    const m = (info.formats || []).find((f) => f.has_video && f.height === h);
    return m && m.resolution ? m.resolution : "";
  };

  const cards = [];
  const bestLabel = info.best_height ? `${t("qBest")} · ${info.best_height}p` : t("qBest");
  cards.push(card("best", bestLabel, info.best_height ? resFor(info.best_height) : "", sizeFor(info.best_height), true, "★"));

  heights.slice(1).forEach((h) => {
    cards.push(card(String(h), `${h}p`, resFor(h), sizeFor(h), false));
  });

  const hasAudio = (info.formats || []).some((f) => f.has_audio);
  if (hasAudio || !heights.length) {
    cards.push(card("audio", t("qAudio"), "m4a / webm", "", false));
    if (state.ffmpeg) cards.push(card("mp3", t("qMp3"), "converted · 192kbps", "", false));
  }

  function card(id, name, sub, size, isBest, flag) {
    const disabled = !id ? "disabled" : "";
    return `<button class="q-card ${isBest ? "best" : ""}" data-quality="${id}" ${disabled}>
      ${flag ? `<span class="q-flag">${flag}</span>` : ""}
      <span class="q-name">${name}</span>
      <span class="q-sub">${[sub, size].filter(Boolean).join(" · ") || "&nbsp;"}</span>
    </button>`;
  }

  grid.innerHTML = cards.join("");
  $$(".q-card", grid).forEach((btn) => {
    btn.addEventListener("click", () => {
      const q = btn.dataset.quality;
      triggerDownload(downloadHref(info.url, q));
      toast(t("dlStart"), "ok");
    });
  });

  $("#formatCount").textContent = (info.formats || []).length;
}

function renderFormats(info) {
  const body = $("#formatBody");
  if (!info.formats || !info.formats.length) {
    body.innerHTML = `<tr><td colspan="8" class="muted">—</td></tr>`;
    return;
  }
  body.innerHTML = info.formats.map((f) => `
    <tr>
      <td><code>${f.format_id}</code></td>
      <td>${f.label || "—"}</td>
      <td>${f.resolution || "—"}</td>
      <td>${f.ext}</td>
      <td class="${f.has_video ? "badge-v" : "muted"}">${f.has_video ? (f.vcodec || "yes") : "—"}</td>
      <td class="${f.has_audio ? "badge-a" : "muted"}">${f.has_audio ? (f.acodec || "yes") : "—"}</td>
      <td>${f.filesize_text || "—"}</td>
      <td>
        <button class="mini" data-act="dl" data-fid="${f.format_id}">↓</button>
        <button class="mini" data-act="copy" data-fid="${f.format_id}">link</button>
      </td>
    </tr>`).join("");

  $$("button.mini", body).forEach((btn) => {
    btn.addEventListener("click", () => {
      const fid = btn.dataset.fid;
      if (btn.dataset.act === "dl") {
        triggerDownload(downloadHref(info.url, fid));
        toast(t("dlStart"), "ok");
      } else {
        const f = info.formats.find((x) => x.format_id === fid);
        if (f && f.url) { copyText(f.url); toast(t("directExpires"), "warn", 2600); }
        else toast("No direct URL for this rendition", "warn");
      }
    });
  });
}

function renderResult(info) {
  state.info = info;
  hideError();

  if (!info.ok) {
    $("#result").hidden = true;
    showError(info.error, info.hint);
    return;
  }

  $("#result").hidden = false;
  $("#batchResults").hidden = true;

  $("#title").textContent = info.title || t("untitled");
  $("#platformBadge").textContent = info.platform || "video";
  $("#durationBadge").textContent = info.duration_text || "";

  const up = $("#uploaderLink");
  if (info.uploader) {
    up.textContent = info.uploader;
    up.hidden = false;
    up.href = info.uploader_url || info.webpage_url || info.url;
  } else { up.hidden = true; }

  $("#uploadDate").textContent = info.upload_date ? `· ${info.upload_date}` : "";

  renderStats(info);

  const desc = $("#description");
  desc.textContent = info.description || "";
  desc.classList.remove("expanded");
  $("#btnMore").hidden = !(info.description && info.description.length > 200);
  $("#btnMore").textContent = t("more");

  const tags = (info.tags || []).slice(0, 14);
  $("#tags").innerHTML = tags.map((x) => `<span class="tag">#${escapeHtml(x)}</span>`).join("");

  // poster
  const poster = $("#poster");
  const img = $("#thumb");
  const src = thumbSrc(info);
  const isVertical = (info.formats || []).some((f) => f.height > f.width);
  poster.classList.toggle("landscape", !isVertical);
  img.classList.remove("broken");
  if (src) {
    img.src = src;
    img.onerror = () => {
      img.onerror = null;
      if (info.thumbnail && img.src !== info.thumbnail) { img.src = info.thumbnail; }
      else { img.classList.add("broken"); img.src = "/static/placeholder.svg"; }
    };
  } else {
    img.src = "/static/placeholder.svg";
  }
  img.alt = info.title || "thumbnail";

  renderQualityGrid(info);
  renderFormats(info);

  state.raw = null;
  $("#jsonView").textContent = JSON.stringify(stripRaw(info), null, 2);

  $("#btnSaveServer").onclick = () => saveToServer(info.url, "best");
  $("#btnThumbDl").onclick = () => {
    const rawThumb = info.thumbnail;
    if (!rawThumb) return toast("No thumbnail found", "warn");
    triggerDownload(`/api/thumb?url=${encodeURIComponent(rawThumb)}&referer=${encodeURIComponent(info.webpage_url || "")}`);
  };
  $("#btnCopyLink").onclick = () => {
    const best = (info.formats || []).find((f) => f.has_video && f.url) || (info.formats || [])[0];
    if (best && best.url) { copyText(best.url); toast(t("directExpires"), "warn", 2800); }
    else toast("No direct link available", "warn");
  };
  $("#btnOpenPage").onclick = () => window.open(info.webpage_url || info.url, "_blank", "noopener");

  poster.onclick = () => tryPreview(info);
  poster.style.cursor = "pointer";
  poster.title = t("preview");
}

function stripRaw(info) {
  const { raw, formats, ...rest } = info;
  return { ...rest, formats: (formats || []).map(({ url, ...f }) => ({ ...f, direct_url: url ? url.slice(0, 90) + "…" : null })) };
}

function escapeHtml(s) {
  return String(s).replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));
}

function tryPreview(info) {
  const poster = $("#poster");
  if ($("video", poster)) return;
  const candidate =
    (info.formats || []).find((f) => f.has_video && f.has_audio && f.url) ||
    (info.formats || []).find((f) => f.has_video && f.url);
  if (!candidate) return toast(t("previewBlocked"), "warn");

  const v = document.createElement("video");
  v.src = candidate.url;
  v.controls = true;
  v.autoplay = true;
  v.playsInline = true;
  v.style.cssText = "position:absolute;inset:0;width:100%;height:100%;background:#000;object-fit:contain;z-index:5";
  v.onerror = () => { v.remove(); toast(t("previewBlocked"), "warn", 4000); };
  poster.appendChild(v);
  v.play().catch(() => {});
}

/* ------------------------------------------------------------------ raw json */
async function loadRaw() {
  if (!state.info) return;
  if (state.raw) { $("#jsonView").textContent = JSON.stringify(state.raw, null, 2); return; }
  $("#jsonView").textContent = "loading…";
  try {
    const full = await api("/api/info", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ url: state.info.url, include_raw: true }),
    });
    state.raw = full.raw || full;
    $("#jsonView").textContent = JSON.stringify(state.raw, null, 2);
  } catch (e) {
    $("#jsonView").textContent = `Could not load raw data: ${e.message}`;
  }
}

/* ------------------------------------------------------------------ save job */
async function saveToServer(url, quality) {
  try {
    const job = await api("/api/save", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ url, quality }),
    });
    const box = $("#jobProgress");
    box.hidden = false;
    $("#jobName").textContent = url;
    $("#jobStats").textContent = "0%";
    $("#jobBar").style.width = "0%";
    pollJob(job.job_id);
  } catch (e) {
    toast(`${t("saveFailed")}: ${e.message}`, "err", 5000);
  }
}

function pollJob(id) {
  clearInterval(state.jobTimer);
  state.jobTimer = setInterval(async () => {
    let job;
    try { job = await api(`/api/jobs/${id}`); }
    catch { clearInterval(state.jobTimer); return; }

    $("#jobStats").textContent = [
      `${Math.round(job.percent)}%`,
      job.speed,
      job.eta ? `ETA ${job.eta}` : "",
    ].filter(Boolean).join(" · ");
    $("#jobBar").style.width = `${Math.min(100, job.percent)}%`;

    if (job.status === "done") {
      clearInterval(state.jobTimer);
      $("#jobName").textContent = job.filename || "done";
      toast(t("saved"), "ok");
      loadLibrary();
      loadHistory();
    } else if (job.status === "error") {
      clearInterval(state.jobTimer);
      $("#jobName").textContent = job.error || t("saveFailed");
      toast(`${t("saveFailed")}: ${job.error || ""}`, "err", 5000);
    }
  }, 800);
}

/* ------------------------------------------------------------------ batch */
function renderBatch(payload) {
  const list = $("#batchList");
  const results = payload.results || [];
  state.batch = results;
  $("#batchResults").hidden = false;
  $("#batchSummary").textContent = t("batchSummary")(payload.ok || 0, payload.failed || 0);

  list.innerHTML = "";
  results.forEach((info) => {
    const item = document.createElement("div");
    item.className = `batch-item ${info.ok ? "" : "failed"}`;

    const img = document.createElement("img");
    const src = info.ok ? thumbSrc(info) : null;
    img.src = src || "/static/placeholder.svg";
    img.alt = "";
    img.loading = "lazy";
    img.onerror = () => { img.onerror = null; img.src = "/static/placeholder.svg"; };

    const mid = document.createElement("div");
    mid.innerHTML = info.ok
      ? `<div class="bi-title">${escapeHtml(info.title || t("untitled"))}</div>
         <div class="bi-sub">${escapeHtml(info.platform || "")} · ${info.duration_text || "?"} · ${info.best_height ? info.best_height + "p" : "?"} · ${fmtCount(info.view_count)} ${t("sViews")}</div>
         <div class="bi-sub muted" style="font-family:var(--mono)">${escapeHtml((info.url || "").slice(0, 78))}</div>`
      : `<div class="bi-title" style="color:var(--err)">${escapeHtml((info.url || "").slice(0, 78))}</div>
         <div class="bi-sub">${escapeHtml(info.error || "failed")}</div>
         ${info.hint ? `<div class="bi-sub" style="color:var(--warn)">${escapeHtml(info.hint)}</div>` : ""}`;

    const actions = document.createElement("div");
    actions.className = "bi-actions";
    if (info.ok) {
      const mk = (label, fn, cls = "btn btn-ghost btn-sm") => {
        const b = document.createElement("button");
        b.className = cls;
        b.textContent = label;
        b.onclick = fn;
        return b;
      };
      actions.append(
        mk("↓ best", () => { triggerDownload(downloadHref(info.url, "best")); toast(t("dlStart")); }),
        mk("720p", () => { triggerDownload(downloadHref(info.url, "720")); toast(t("dlStart")); }),
        mk(t("tabJson"), () => { openSingle(info.url); })
      );
    }
    item.append(img, mid, actions);
    list.appendChild(item);
  });

  $("#batchResults").scrollIntoView({ behavior: "smooth", block: "start" });
}

async function downloadAll() {
  const ok = state.batch.filter((b) => b.ok);
  if (!ok.length) return toast(t("noLinks"), "warn");
  for (const [i, info] of ok.entries()) {
    setTimeout(() => {
      triggerDownload(downloadHref(info.url, "best"));
    }, i * 1200);
  }
  toast(`${ok.length} × ${t("dlStart")}`, "ok", 4200);
}

async function openSingle(url) {
  setMode("single");
  $("#urlInput").value = url;
  await runExtract(url);
}

/* ------------------------------------------------------------------ actions */
async function runExtract(url) {
  if (!url || !url.trim()) { toast(t("needUrl"), "warn"); return; }
  setLoading(true);
  hideError();
  $("#result").hidden = true;
  $("#batchResults").hidden = true;

  try {
    const info = await api("/api/info", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ url }),
    });
    renderResult(info);
    if (!info.ok) showError(info.error, info.hint);
    else loadHistory();
  } catch (e) {
    showError(e.message, e.hint);
  } finally {
    setLoading(false);
  }
}

async function runBatch() {
  const text = $("#batchInput").value || "";
  setLoading(true, t("loading"));
  hideError();
  try {
    const payload = await api("/api/batch", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ raw_text: text }),
    });
    setLoading(false);
    renderBatch(payload);
    loadHistory();
  } catch (e) {
    setLoading(false);
    showError(e.message, e.hint);
  }
}

function setMode(mode) {
  state.mode = mode;
  $$(".mode-btn").forEach((b) => b.classList.toggle("active", b.dataset.mode === mode));
  const batch = mode === "batch";
  $("#batchArea").hidden = !batch;
  $(".input-row").style.display = batch ? "none" : "flex";
  if (batch) {
    $("#batchInput").focus();
    updateBatchCount();
  } else {
    $("#urlInput").focus();
  }
}

function updateBatchCount() {
  const text = $("#batchInput").value || "";
  const links = text.split(/[\s,;]+/).filter((s) => /^(https?:\/\/|www\.|m\.|web\.)/i.test(s));
  $("#batchCount").textContent = links.length
    ? `${links.length} ${links.length === 1 ? "link" : "links"}`
    : t("batchHint");
}

/* ------------------------------------------------------------------ history */
async function loadHistory() {
  try {
    const data = await api("/api/history?limit=12");
    const items = data.items || [];
    const section = $("#historySection");
    const row = $("#historyRow");
    if (!items.length) { section.hidden = true; return; }
    section.hidden = false;
    row.innerHTML = "";
    items.forEach((it) => {
      const chip = document.createElement("button");
      chip.className = "history-chip";
      chip.title = it.url;
      const img = document.createElement("img");
      img.src = it.thumb ? `/api/thumb?url=${encodeURIComponent(it.thumb)}&referer=${encodeURIComponent(it.url)}` : "/static/placeholder.svg";
      img.alt = "";
      img.loading = "lazy";
      img.onerror = () => { img.onerror = null; img.src = "/static/placeholder.svg"; };
      const label = document.createElement("span");
      label.textContent = it.title || it.platform || it.url.slice(0, 34);
      chip.append(img, label);
      chip.onclick = () => openSingle(it.url);
      row.appendChild(chip);
    });
  } catch { /* history is optional */ }
}

/* ------------------------------------------------------------------ library */
async function loadLibrary() {
  const list = $("#libraryList");
  list.innerHTML = `<p class="muted">…</p>`;
  try {
    const [items, health] = await Promise.all([api("/api/library"), api("/api/health")]);
    $("#libraryPath").textContent = (health.details && health.details.download_dir) || "";
    if (!items.length) { list.innerHTML = `<p class="muted">${t("libraryEmpty")}</p>`; return; }
    list.innerHTML = "";
    items.forEach((it) => {
      const el = document.createElement("div");
      el.className = "lib-item";
      el.innerHTML = `
        <span class="li-name">${escapeHtml(it.name)}</span>
        <span class="li-sub">${it.size_text} · ${new Date(it.modified * 1000).toLocaleString()}</span>
        <div class="li-actions">
          <a class="btn btn-ghost btn-sm" href="/api/library/${encodeURIComponent(it.name)}">↓</a>
          <button class="btn btn-ghost btn-sm btn-danger" data-del>${t("sDelete")}</button>
        </div>`;
      $("[data-del]", el).onclick = async () => {
        try {
          await api(`/api/library/${encodeURIComponent(it.name)}`, { method: "DELETE" });
          el.remove();
        } catch (e) { toast(e.message, "err"); }
      };
      list.appendChild(el);
    });
  } catch (e) {
    list.innerHTML = `<p class="muted">${escapeHtml(e.message)}</p>`;
  }
}

function openDrawer() {
  $("#libraryDrawer").classList.add("open");
  $("#libraryDrawer").setAttribute("aria-hidden", "false");
  $("#scrim").hidden = false;
  loadLibrary();
}
function closeDrawer() {
  $("#libraryDrawer").classList.remove("open");
  $("#libraryDrawer").setAttribute("aria-hidden", "true");
  $("#scrim").hidden = true;
}

/* ------------------------------------------------------------------ cookies */
function openCookies() {
  $("#cookieModal").classList.add("open");
  $("#cookieModal").setAttribute("aria-hidden", "false");
  refreshCookieStatus();
}
function closeCookies() {
  $("#cookieModal").classList.remove("open");
  $("#cookieModal").setAttribute("aria-hidden", "true");
}
async function refreshCookieStatus() {
  try {
    const s = await api("/api/cookies");
    $("#cookieStatus").textContent = s.loaded ? `${t("cookiesOn")} · ${s.rows} rows · ${s.path}` : `${t("cookiesOff")} · ${s.path}`;
  } catch { $("#cookieStatus").textContent = t("noCookies"); }
}

async function saveCookies() {
  const text = $("#cookieText").value.trim();
  if (!text) return toast(t("noCookies"), "warn");
  try {
    const r = await api("/api/cookies", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ text }),
    });
    toast(`${t("cookiesSaved")} · ${r.cookie_rows} rows`, "ok");
    refreshCookieStatus();
    loadHealth();
  } catch (e) { toast(e.message, "err"); }
}

async function deleteCookies() {
  try {
    await api("/api/cookies", { method: "DELETE" });
    $("#cookieText").value = "";
    toast(t("cookiesGone"), "ok");
    refreshCookieStatus();
    loadHealth();
  } catch (e) { toast(e.message, "err"); }
}

/* ------------------------------------------------------------------ wiring */
function wire() {
  $("#extractForm").addEventListener("submit", (e) => {
    e.preventDefault();
    if (state.mode === "batch") return runBatch();
    runExtract($("#urlInput").value);
  });

  $("#batchInput").addEventListener("input", updateBatchCount);
  $$(".mode-btn").forEach((b) => b.addEventListener("click", () => setMode(b.dataset.mode)));

  $("#btnPaste").addEventListener("click", async () => {
    try {
      const text = await navigator.clipboard.readText();
      $("#urlInput").value = text.trim();
      $("#urlInput").focus();
    } catch { toast("Clipboard access blocked — paste with Ctrl/Cmd+V", "warn"); }
  });

  $("#btnPasteBatch").addEventListener("click", async () => {
    try { $("#batchInput").value = await navigator.clipboard.readText(); updateBatchCount(); }
    catch { toast("Clipboard access blocked — paste with Ctrl/Cmd+V", "warn"); }
  });

  $$(".chip[data-example]").forEach((chip) => {
    chip.addEventListener("click", () => {
      const ex = chip.dataset.example;
      if (!ex) return;
      setMode("single");
      $("#urlInput").value = ex;
      $("#urlInput").focus();
    });
  });

  $$(".tab").forEach((tab) => {
    tab.addEventListener("click", () => {
      $$(".tab").forEach((x) => x.classList.remove("active"));
      $$(".tab-panel").forEach((p) => p.classList.remove("active"));
      tab.classList.add("active");
      $(`.tab-panel[data-panel="${tab.dataset.tab}"]`).classList.add("active");
      if (tab.dataset.tab === "json" && !state.raw) loadRaw();
    });
  });

  $("#btnMore").addEventListener("click", () => {
    const d = $("#description");
    d.classList.toggle("expanded");
    $("#btnMore").textContent = d.classList.contains("expanded") ? t("less") : t("more");
  });

  $("#btnLoadRaw").addEventListener("click", loadRaw);
  $("#btnCopyJson").addEventListener("click", () => copyText($("#jsonView").textContent));
  $("#btnDownloadAll").addEventListener("click", downloadAll);
  $("#btnCopyError").addEventListener("click", () => copyText($("#errorMessage").textContent));
  $("#btnErrorCookies").addEventListener("click", openCookies);

  $("#btnLibrary").addEventListener("click", openDrawer);
  $("#btnCloseLibrary").addEventListener("click", closeDrawer);
  $("#scrim").addEventListener("click", closeDrawer);

  $("#btnCookies").addEventListener("click", openCookies);
  $("#btnCloseCookies").addEventListener("click", closeCookies);
  $("#btnSaveCookies").addEventListener("click", saveCookies);
  $("#btnDeleteCookies").addEventListener("click", deleteCookies);
  $("#cookieModal").addEventListener("click", (e) => { if (e.target.id === "cookieModal") closeCookies(); });

  $("#cookieFile").addEventListener("change", async (e) => {
    const file = e.target.files && e.target.files[0];
    if (!file) return;
    const fd = new FormData();
    fd.append("file", file);
    try {
      const r = await fetch("/api/cookies/upload", { method: "POST", body: fd });
      const data = await r.json();
      if (!r.ok) throw new Error(data.detail || "upload failed");
      toast(`${t("cookiesSaved")} · ${data.cookie_rows} rows`, "ok");
      refreshCookieStatus();
      loadHealth();
    } catch (err) { toast(err.message, "err"); }
    e.target.value = "";
  });

  $("#btnClearHistory").addEventListener("click", async () => {
    try { await api("/api/history", { method: "DELETE" }); $("#historySection").hidden = true; }
    catch (e) { toast(e.message, "err"); }
  });

  $$(".lang-btn").forEach((b) => b.addEventListener("click", () => {
    LANG = b.dataset.lang;
    localStorage.setItem("rell.lang", LANG);
    applyLang();
  }));

  document.addEventListener("keydown", (e) => {
    if ((e.ctrlKey || e.metaKey) && e.key === "Enter") {
      e.preventDefault();
      if (state.mode === "batch") runBatch();
      else runExtract($("#urlInput").value);
    }
    if (e.key === "Escape") { closeDrawer(); closeCookies(); }
  });

  // Auto-fill from ?url= so rell can be used as a share target.
  const params = new URLSearchParams(location.search);
  const preset = params.get("url") || params.get("q");
  if (preset) {
    $("#urlInput").value = preset;
    setTimeout(() => runExtract(preset), 300);
  }
}

/* ------------------------------------------------------------------ boot */
(async function boot() {
  applyLang();
  wire();
  await Promise.all([loadHealth(), loadPresets()]);
  loadHistory();
  if (state.info) renderResult(state.info);
  $("#urlInput").focus();
})();
