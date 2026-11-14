# NEXUS FRAME — ব্যবহার নির্দেশিকা (বাংলা)

> একটা লাইনেই: **যেকোনো ভালো এডিট করা ভিডিও দেখে তার "এডিটিং ডিজাইন" শিখে নেয়, তারপর আপনার নিজের ফুটেজ দিয়ে ঠিক সেই স্টাইলে নতুন ভিডিও বানায় — যেকোনো দৈর্ঘ্যে।**

---

## ১. কোন কাজে লাগে (use cases)

| কাজ | কীভাবে |
|---|---|
| পুরোনো viral রিলের এডিট স্টাইল ধরে নতুন প্রোডাক্ট লঞ্চ | রেফারেন্স = ওই ভিডিও, ফুটেজ = আপনার নতুন ক্লিপ |
| এক ব্র্যান্ডের ১০টি ভিডিও একই রিদম ও গ্রেডে | একবার Framework সেভ → বারবার নতুন ক্লিপ দিয়ে Produce |
| একই ফুটেজ থেকে ১৫s / ৩০s / ৪৫s / ৬০s ভার্সন | শুধু টার্গেট ডিউরেশন বদলান, স্টাইল অটুট থাকে |
| এজেন্সি: ক্লায়েন্টের রেফারেন্স থেকে পুনরায় ব্যবহারযোগ্য ব্লুপ্রিন্ট | Vault → **Export JSON** → অন্য প্রজেক্টে **Import** |
| A/B টেস্ট: একই ক্লিপ, দুই স্টাইল | দুটি Framework সেভ করে একই ফুটেজে দুবার Produce |
| নিজের লম্বা ভিডিও থেকে দ্রুত শর্টস | রেফারেন্স = নিজের লম্বা ভিডিও, ফুটেজ = ওটাই |

**এটা কী নয়:** এটা ভিডিও *এডিটর* নয় (টাইমলাইনে হাত দিয়ে কাটছাঁট করবেন না), এটা *এডিট রেপ্লিকেটর* — স্টাইল শিখে অটোমেটিক বসিয়ে দেয়।

---

## ২. খুলবেন কোথায়

- **এই workspace-এ:** LIVE PREVIEW প্যানেলের `:3000` (স্টুডিও) · `:8000/docs` (API ডকুমেন্টেশন)
- **নিজের মেশিনে:** `./scripts/setup.sh && ./scripts/dev.sh` → `http://localhost:3000`

উপরে-ডানে engine badge দেখুন:
- **Production Node** = Python ইঞ্জিন চালু (আসল FFmpeg রেন্ডার, yt-dlp, Demucs থাকলে stem)
- **Studio Lite** = ব্রাউজার-অনলি মোড (কাজ করবে, কিন্তু WebM আর কম কোঅালিটি)

---

## ৩. ব্যবহার ১ — রেফারেন্স থেকে Framework বানানো

**ট্যাব:** `Framework Extractor` (কীবোর্ড `1`)

1. **"Drop the reference edit"** বক্সে একটা এডিট করা ভিডিও ড্রপ করুন (বা ক্লিক করে ব্রাউজ)।
   - চাইলে `Reference URL` + **Fetch** — নোডের নেটওয়ার্ক খোলা থাকলে (YouTube/Reels/TikTok)।
2. বোতাম: **Deconstruct reference**
3. ডান পাশে "Deconstruction telemetry" ধাপে ধাপে এগোবে:
   `Ingest & probe → Scene cuts → Audio fingerprint → Five-pillar map`
4. নিচে যা পাবেন:
   - **Timeline visualiser** — কাটের ঘনত্ব, বিট গ্রিড, ৫ পিলারের ব্যান্ড
   - **Stats** — Shots, Duration, BPM, Avg cut, Zoom ratio, Motion, SFX cues, Loudness (LUFS)
   - **Palette** ও **Shot ladder** — গ্রেড ও মোশন ক্লাসিফিকেশন
   - **Node log** — কোন ডিটেক্টর আসলে চলেছে (PySceneDetect / librosa / Demucs…)
5. **Save framework to vault** → মডালে **Framework name\*** (বাধ্যতামূলক), Tags, Description → **Save framework**

> `Deconstruct reference` না চেপে শুধু ড্রপ করলেও বিশ্লেষণ শুরু হয় — বোতামটা আবার চালানোর জন্য।

---

## ৪. ব্যবহার ২ — নতুন ফুটেজ দিয়ে ভিডিও বানানো

**ট্যাব:** `Production House` (কীবোর্ড `2`)

1. **Framework** বাছাই করুন (উপরের সিলেক্টরে ভল্টের ব্লুপ্রিন্ট)।
2. **"Drop raw clips"** — আপনার ১–৪টি ক্লিপ ড্রপ করুন। (বিকল্প: `Clip URLs`, প্রতি লাইনে একটি)
3. **`Target output duration`** — শুধু দৈর্ঘ্য লিখুন:

   | লিখলে | অর্থ |
   |---|---|
   | `30` | ৩০ সেকেন্ড |
   | `45s` | ৪৫ সেকেন্ড |
   | `01:30` / `1:30` | ১ মিনিট ৩০ সেকেন্ড |
   | `02:15` | ২ মিনিট ১৫ সেকেন্ড |

4. **Background audio**
   - `Framework BG` → রেফারেন্সের BGM স্টেম (না থাকলে স্টুডিও নিজেই BPM-এ একটা licence-free bed বানায়)
   - `Custom` → নিজের wav/mp3/m4a আপলোড
5. দুটি চেকবক্স (দুটোই ডিফল্টে চালু):
   - **Preserve framework transition SFX** — BGM বদলালেও কাটে বসা whoosh/riser থাকবে
   - **Trim dead air from raw clips (VAD)** — নীরব অংশ বাদ দিয়ে শুধু কথা-বলা অংশ থেকে কাট নেবে
6. বোতাম: **Produce video · 30s** (ডিউরেশন অনুযায়ী লেখা বদলায়)
7. শেষ হলে: প্লেয়ার + **Download** বোতাম। নিচে **টাইমলাইন**-এ আসল প্লান (কাট, বিট, পিলার); পাশে লগ।

**ভেতরে কী হচ্ছে (বিশ্বাসযোগ্য হওয়ার জন্য জানুন):**
- **টাইম স্কেলিং beat-elastic** — ফ্রেম টেনে লম্বা করা হয় না; কাটের *সংখ্যা* বাড়ে, শটের দৈর্ঘ্য রেফারেন্সের ল্যাডার থেকেই আসে
- পিলার অনুপাত অটুট: Hook 12% · Pain 20% · Trigger 45% · Comment 13% · Outro 10%
- প্রতিটি অভ্যন্তরীণ কাট মিউজিক বিটে **±40ms** এর মধ্যে snap
- প্রতিটি আউটপুটে **ওয়াটারমার্ক বাধ্যতামূলক, উপরে-বাঁয়ে `x=24:y=24`**
- অডিও −14 LUFS-এ normalize; ভয়েসওভার দিলে BGM sidechain-এ ডাক হবে

---

## ৫. ব্যবহার ৩ — Vault (ব্লুপ্রিন্ট ব্যবস্থাপনা)

**ট্যাব:** `Framework Vault` (কীবোর্ড `3`)

- টেবিলে প্রতিটি ব্লুপ্রিন্ট: name, origin (server/browser/import), duration, BPM, shots, avg cut, aspect, date
- **Inspect blueprint** (👁) → পূর্ণ DNA দেখুন (shots, pillars, beat grid, watermark, SFX)
- **Export JSON** → এক ফাইলেই পুরো স্টাইল; অন্য মেশিনে **Import JSON** করে বসিয়ে দিন
- **Produce with this framework** → সরাসরি Production House-এ নিয়ে যায়
- ডিলিট করলে শুধু ভল্ট থেকে যাবে; এক্সপোর্ট করা কপি অক্ষত

---

## ৬. সাধারণ ভুল ও সমাধান

| সমস্যা | কারণ / সমাধান |
|---|---|
| "Studio Lite" দেখাচ্ছে | নোড বন্ধ — `./scripts/dev.sh` চালান, `curl localhost:8000/api/health` দেখুন |
| URL দিলে "node cannot reach the platform" | ওই নেটওয়ার্ক থেকে প্ল্যাটফর্ম ব্লকড (স্যান্ডবক্স/ডেটাসেন্টার) → ভিডিও ডাউনলোড করে **ফাইল আপলোড** করুন |
| URL-এ "Failed to extract any player response" | yt-dlp পুরোনো → `backend/.venv/bin/pip install -U yt-dlp` |
| "Sign in to confirm you're not a bot" | `cookies.txt` এক্সপোর্ট করে `NEXUS_YTDLP_COOKIES=/path/cookies.txt` |
| সাউন্ড নেই | ওই ফ্রেমওয়ার্কে stem নেই (`preview_only`) → Custom BGM দিন বা `--ml` স্ট্যাক ইনস্টল করুন |
| ৫০ MB+ আপলোডে ৫০০ | `NEXUS_STUDIO_MAX_UPLOAD` (ডিফল্ট 512mb) — স্টুডিও রিস্টার্ট করুন |
| রেন্ডার ধীর | `NEXUS_RENDER_MAX_DIM=960` + `NEXUS_RENDER_PRESET=ultrafast` দিয়ে ড্রাফট নিন |
| ডেমার্ক/নে-ডেমার্ক | Demucs ঐচ্ছিক (torch লাগে): `./scripts/setup.sh --ml` |

---

## ৭. কমান্ডলাইন দিয়ে (ঐচ্ছিক)

```bash
# ১) রেফারেন্স বিশ্লেষণ
curl -X POST localhost:8000/api/analyze \
  -F file=@reference.mp4 -F framework_name="Fast Hook v2"
# → {"id":"..."} ; GET /api/jobs/<id> দিয়ে প্রগ্রেস

# ২) ভল্ট থেকে ব্লুপ্রিন্ট
curl -s localhost:8000/api/frameworks > vault.json

# ৩) Produce (plan = স্কেল করা রেন্ডার প্লান)
curl -X POST localhost:8000/api/produce \
  -F plan=@plan.json -F clips=@raw-1.mp4 -F clips=@raw-2.mp4 -F bg_audio=@bgm.wav
```

স্কেলিংয়ের নিয়ম (`npm test` + `pytest` দিয়ে লক করা):
`Σ শট-দৈর্ঘ্য = টার্গেট`, কাট একমুখী, ৫ পিলার উপস্থিত, বিট-snap ±40ms, একই ইনপুট = হুবহু একই প্লান।

---

## ৮. দ্রুত টেস্ট

```bash
./scripts/test.sh                        # Python + TypeScript + parity
cd frontend && npm run check:hydration   # SSR/client মার্কআপ মিলছে কি না
```
