"""rell command line — same engine, no browser needed.

    python -m app.cli https://www.facebook.com/reel/1402267498733776
    python -m app.cli LINK --info            # print every metadata field
    python -m app.cli LINK --formats         # list renditions
    python -m app.cli LINK -q 720            # download 720p
    python -m app.cli LINK -q mp3            # download audio as mp3
    python -m app.cli LINK --json            # raw yt-dlp dump
    cat links.txt | python -m app.cli -      # batch, one link per line
"""
from __future__ import annotations

import argparse
import json
import sys
from pathlib import Path

from . import config, extractor


def _print_info(info) -> None:
    rows = [
        ("platform", info.platform),
        ("id", info.video_id),
        ("title", info.title),
        ("page/uploader", info.uploader),
        ("page url", info.uploader_url),
        ("webpage", info.webpage_url),
        ("uploaded", info.upload_date),
        ("duration", info.duration_text),
        ("views", info.view_count),
        ("likes", info.like_count),
        ("comments", info.comment_count),
        ("shares", info.repost_count),
        ("max quality", f"{info.best_height}p" if info.best_height else None),
        ("renditions", len(info.formats)),
        ("thumbnail", info.thumbnail),
        ("tags", ", ".join(info.tags[:12]) if info.tags else None),
    ]
    width = max(len(k) for k, _ in rows)
    print()
    for key, value in rows:
        if value in (None, "", []):
            continue
        print(f"  {key.ljust(width)}  {value}")
    if info.description:
        print(f"\n  description\n  {'-' * 40}")
        for line in info.description.strip().splitlines()[:20]:
            print(f"  {line}")
    print()


def _print_formats(info) -> None:
    if not info.formats:
        print("  no renditions found")
        return
    print(f"\n  {'ID':<12} {'LABEL':<14} {'RES':<12} {'EXT':<6} {'SIZE':<11} V/A")
    print(f"  {'-' * 12} {'-' * 14} {'-' * 12} {'-' * 6} {'-' * 11} {'-' * 5}")
    for f in info.formats:
        va = ("V" if f.has_video else "-") + ("A" if f.has_audio else "-")
        print(
            f"  {f.format_id[:12]:<12} {(f.label or '')[:14]:<14} "
            f"{(f.resolution or '')[:12]:<12} {f.ext[:6]:<6} "
            f"{(f.filesize_text or '?'):<11} {va}"
        )
    print()


def main(argv: list[str] | None = None) -> int:
    parser = argparse.ArgumentParser(
        prog="rell",
        description="Paste a reel link — get every detail of that page, and the video.",
    )
    parser.add_argument("urls", nargs="+", help="one or more links, or '-' to read from stdin")
    parser.add_argument("-q", "--quality", default="best", help="best/2160/1440/1080/720/480/360/audio/mp3 or a format id (default: best)")
    parser.add_argument("-o", "--output", default=None, help="output folder (default: ./downloads)")
    parser.add_argument("--info", action="store_true", help="print metadata only, do not download")
    parser.add_argument("--formats", action="store_true", help="print the rendition table only")
    parser.add_argument("--json", action="store_true", help="print the raw yt-dlp JSON dump")
    parser.add_argument("--no-cache", action="store_true", help="skip the in-memory info cache")
    args = parser.parse_args(argv)

    urls: list[str] = []
    for raw in args.urls:
        if raw == "-":
            urls.extend(extractor.split_urls(sys.stdin.read()))
        else:
            urls.extend(extractor.split_urls(raw) or [raw])
    if not urls:
        print("rell: no links given", file=sys.stderr)
        return 2

    dest = Path(args.output) if args.output else config.DOWNLOAD_DIR
    dest.mkdir(parents=True, exist_ok=True)

    exit_code = 0
    for url in urls:
        try:
            info = extractor.probe(url, include_raw=args.json, use_cache=not args.no_cache)
        except extractor.RellError as exc:
            print(f"rell: {exc.message}", file=sys.stderr)
            if exc.hint:
                print(f"      hint: {exc.hint}", file=sys.stderr)
            exit_code = 1
            continue

        if not info.ok:
            print(f"rell: {url}\n      {info.error}", file=sys.stderr)
            if info.hint:
                print(f"      hint: {info.hint}", file=sys.stderr)
            exit_code = 1
            continue

        if args.json:
            print(json.dumps(info.raw, indent=2, ensure_ascii=False, default=str))
            continue

        print(f"  → {info.url}")
        _print_info(info)

        if args.formats or args.info:
            _print_formats(info)
            if args.formats:
                continue

        if args.info:
            continue

        try:
            path = extractor.download(url, quality=args.quality, dest_dir=dest)
        except extractor.RellError as exc:
            print(f"rell: download failed — {exc.message}", file=sys.stderr)
            if exc.hint:
                print(f"      hint: {exc.hint}", file=sys.stderr)
            exit_code = 1
            continue
        size = extractor.human_size(path.stat().st_size)
        print(f"  ✓ saved {path}  ({size})\n")

    return exit_code


if __name__ == "__main__":
    raise SystemExit(main())
