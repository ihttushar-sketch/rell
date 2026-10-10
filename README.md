# rell

**Paste a reel link → get every detail of that page, plus the video.**

```
https://www.facebook.com/reel/1402267498733776
        │
        ▼
┌─────────────────────────────────────────────────────────────┐
│ title · caption · page name · page url · upload date        │
│ views · likes · comments · shares · duration · video id     │
│ thumbnail · tags · categories · availability                │
│ every rendition (id, resolution, codec, size, direct link)  │
│ one-click download: best / 4K / 1080p / 720p / … / MP3      │
└─────────────────────────────────────────────────────────────┘
```

Built for **Facebook** and **Instagram** reels, and it also works with ~1000 other
sites (YouTube, TikTok, X, Vimeo, …) because the engine is
[yt-dlp](https://github.com/yt-dlp/yt-dlp).

Free, open source, runs entirely on your own machine — nothing is uploaded anywhere.

---

## Quick start

```bash
git clone https://github.com/ihttushar-sketch/rell && cd rell
./run.sh
```

Then open **http://localhost:8000**.

`run.sh` creates a virtualenv, installs everything (including a bundled ffmpeg),
and starts the server. First run takes ~30 s, later runs start instantly.

```bash
PORT=9000 ./run.sh        # different port
./run.sh --dev            # auto-reload while editing code
./run.sh --no-install     # skip dependency check
```

<details>
<summary>Manual setup (if you prefer)</summary>

```bash
python3 -m venv .venv
.venv/bin/pip install -r requirements.txt
.venv/bin/python -m app.main          # web UI + API
```

</details>

---

## Web UI

| Area | What you get |
| --- | --- |
| **Paste box** | Drop a link (or the whole share text — the URL is picked out automatically). `Ctrl/⌘+Enter` runs it. |
| **Batch mode** | Paste 25 links at once, one per line; get a card per video and a *Download all* button. |
| **Result card** | Thumbnail, title, page name + link, upload date, views / likes / comments / shares, duration, max quality, tags, full caption. |
| **Download tab** | One button per available quality, with resolution and file size. Plus audio-only and MP3. |
| **Formats tab** | Every rendition yt-dlp saw: id, label, resolution, container, codecs, size, and its direct CDN link. |
| **Raw data tab** | The complete unfiltered JSON the engine read from the page. Copy it in one click. |
| **Library** | Files you saved server-side, with size and date; download or delete. |
| **Recent** | History of everything rell looked at (kept on your machine, SQLite). |
| **EN / বাংলা** | Full interface translation toggle. |

You can also deep-link: `http://localhost:8000/?url=<link>` extracts on load —
handy as a browser share target.

---

## Cookies — the important bit for Facebook / Instagram

Most reels are only served to logged-in accounts. Without cookies you will often get
*"This video is only available to logged in users"*. rell handles that:

1. Install the **Get cookies.txt LOCALLY** extension (Chrome / Firefox / Edge).
2. Log in to facebook.com (or instagram.com), click the extension, **Export**.
3. In rell click **Cookies** → paste the file contents, or upload `cookies.txt`.

rell accepts either a Netscape `cookies.txt` **or** a raw `Cookie:` request header —
it converts the latter for you. Cookies are stored at `data/cookies.txt` with `0600`
permissions and never leave your machine. Delete them any time from the same dialog.

Prefer your live browser session instead of a file? Then start with:

```bash
RELL_COOKIES_FROM_BROWSER=chrome ./run.sh      # chrome | firefox | brave | edge | safari
```

---

## API

Interactive docs at **http://localhost:8000/docs**.

| Method | Path | Purpose |
| --- | --- | --- |
| `POST` | `/api/info` | `{ "url": "…", "include_raw": false }` → every metadata field + all formats |
| `POST` | `/api/batch` | `{ "raw_text": "link1\nlink2" }` → one result per link |
| `GET` | `/api/formats?url=…&quality=720` | rendition table + the yt-dlp selector that quality maps to |
| `GET` | `/api/download?url=…&quality=1080&filename=…` | streams the file straight to the browser |
| `POST` | `/api/save` | download into `downloads/`, returns a `job_id` |
| `GET` | `/api/jobs/{job_id}` | progress: percent, speed, ETA, final filename |
| `GET` | `/api/thumb?url=…&referer=…` | thumbnail proxied through rell (beats hotlink blocking) |
| `GET/POST/DELETE` | `/api/cookies` | cookie status / set / remove (`POST /api/cookies/upload` for a file) |
| `GET` · `DELETE` | `/api/library` · `/api/library/{name}` | list / fetch / delete saved files |
| `GET` · `DELETE` | `/api/history` | recent extractions |
| `GET` | `/api/presets` · `/api/health` · `/api/normalize` | quality presets, engine status, link check |

`quality` accepts a preset (`best`, `2160`, `1440`, `1080`, `720`, `480`, `360`,
`small`, `audio`, `mp3`), an `Np` string like `720p`, or a raw format id / yt-dlp
selector.

```bash
# everything about a page
curl -s -X POST localhost:8000/api/info \
  -H 'content-type: application/json' \
  -d '{"url":"https://www.facebook.com/reel/1402267498733776"}' | jq

# download 720p
curl -L -o reel.mp4 'localhost:8000/api/download?url=https://www.facebook.com/reel/1402267498733776&quality=720'

# 20 links from a file
jq -r '.results[] | select(.ok) | .title' <<< "$(curl -s -X POST localhost:8000/api/batch \
  -H 'content-type: application/json' \
  --data "$(jq -Rs '{raw_text: .}' links.txt)")"
```

---

## Command line

Same engine, no browser:

```bash
.venv/bin/python -m app.cli https://www.facebook.com/reel/1402267498733776
.venv/bin/python -m app.cli LINK --info        # metadata only
.venv/bin/python -m app.cli LINK --formats     # rendition table
.venv/bin/python -m app.cli LINK --json        # raw yt-dlp dump
.venv/bin/python -m app.cli LINK -q 720 -o ~/Videos
.venv/bin/python -m app.cli LINK -q mp3        # audio → MP3
cat links.txt | .venv/bin/python -m app.cli -  # batch from stdin
```

---

## Configuration

Everything is environment driven — no config file to edit.

| Variable | Default | Meaning |
| --- | --- | --- |
| `RELL_HOST` / `RELL_PORT` | `0.0.0.0` / `8000` | bind address |
| `RELL_DOWNLOAD_DIR` | `./downloads` | where *Save to server* writes |
| `RELL_DATA_DIR` | `./data` | cookies, history DB, ffmpeg shim |
| `RELL_COOKIES_FILE` | `data/cookies.txt` | cookie file location |
| `RELL_COOKIES_FROM_BROWSER` | *(unset)* | e.g. `chrome` — read the live browser session |
| `RELL_ALLOWED_DOMAINS` | *(any)* | e.g. `facebook.com,instagram.com` to lock it down |
| `RELL_ALLOW_PRIVATE` | *(off)* | `1` lets rell fetch LAN / localhost URLs (off by default so an exposed server can't be used to probe internal hosts) |
| `RELL_CACHE_TTL` | `600` | seconds an extraction stays cached |
| `RELL_EXTRACT_TIMEOUT` | `120` | per-request extraction timeout |
| `RELL_FFMPEG_DIR` | auto | folder containing `ffmpeg` |
| `RELL_USER_AGENT` | Chrome/126 | UA sent to sites |

ffmpeg is auto-detected from `PATH`; if it is missing, the bundled binary from
`imageio-ffmpeg` is symlinked into `data/bin/ffmpeg`. Without ffmpeg at all, MP3
conversion is disabled and merging falls back to the best single-file rendition.

---

## Tests

87 tests, all offline — no network, no fixtures downloaded:

```bash
.venv/bin/python -m pytest -q
```

* `tests/test_extractor.py` — URL normalising, platform detection, format parsing,
  quality selectors, cache, error → hint mapping, job progress.
* `tests/test_api.py` — every endpoint driven through FastAPI's `TestClient`.
* `tests/test_e2e_local.py` — the real pipeline: a local HTTP server serves a
  generated mp4, then actual yt-dlp probing, downloading, MP3 transcoding and
  API streaming run against it.

The URL endpoints refuse loopback / private / cloud-metadata addresses unless
`RELL_ALLOW_PRIVATE=1`, so exposing rell on a network can't turn it into a proxy
into your LAN.

---

## Troubleshooting

| Symptom | Fix |
| --- | --- |
| `only available to logged in users` | Add cookies (see above). |
| `HTTP Error 403` | The CDN link expired — just run the extraction again. |
| `Unable to extract …` / broken site | `pip install -U yt-dlp` — sites change their markup often. |
| No sound / no merge | ffmpeg missing: `pip install imageio-ffmpeg` or set `RELL_FFMPEG_DIR`. |
| `Temporary failure in name resolution` | The machine running rell has no route to the site (VPN / firewall / sandbox). |
| Instagram always fails | Instagram requires login for nearly everything — cookies are mandatory. |
| Slow first extraction | Normal: the site is being contacted and every rendition is resolved. Repeat calls hit the cache. |

---

## Layout

```
app/
  main.py         FastAPI app: routes, streaming downloads, library, cookies
  extractor.py    the yt-dlp wrapper: probe / formats / download / jobs / errors
  models.py       pydantic schemas
  history.py      SQLite history
  config.py       paths, env settings, ffmpeg discovery
  cli.py          terminal front-end
  static/         index.html · app.js · styles.css (vanilla, no build step)
tests/            offline unit, API and end-to-end tests
downloads/        your saved files            (git-ignored)
data/             cookies, history DB, ffmpeg (git-ignored)
```

---

## Please use it responsibly

Download only content you have the right to save. Respect each platform's terms of
service, copyright and the privacy of the people in the videos. rell keeps no logs
of what you fetch beyond the local history file you can clear at any time.
