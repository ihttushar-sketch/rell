"""Tiny sqlite-backed history of everything rell has looked at."""
from __future__ import annotations

import json
import sqlite3
import threading
import time
from pathlib import Path
from typing import Any

from . import config

_LOCK = threading.Lock()


def _connect() -> sqlite3.Connection:
    conn = sqlite3.connect(config.HISTORY_DB, timeout=10, check_same_thread=False)
    conn.row_factory = sqlite3.Row
    return conn


def init() -> None:
    with _LOCK, _connect() as conn:
        conn.execute(
            """
            CREATE TABLE IF NOT EXISTS history (
                id       INTEGER PRIMARY KEY AUTOINCREMENT,
                ts       REAL    NOT NULL,
                url      TEXT    NOT NULL,
                platform TEXT,
                title    TEXT,
                ok       INTEGER NOT NULL DEFAULT 1,
                error    TEXT,
                thumb    TEXT,
                payload  TEXT
            )
            """
        )
        conn.execute("CREATE INDEX IF NOT EXISTS idx_history_ts ON history(ts DESC)")


def add(
    url: str,
    platform: str = "",
    title: str = "",
    ok: bool = True,
    error: str | None = None,
    thumb: str | None = None,
    payload: dict[str, Any] | None = None,
) -> int:
    with _LOCK, _connect() as conn:
        cur = conn.execute(
            "INSERT INTO history (ts, url, platform, title, ok, error, thumb, payload) "
            "VALUES (?, ?, ?, ?, ?, ?, ?, ?)",
            (
                time.time(),
                url,
                platform or "",
                title or "",
                1 if ok else 0,
                error,
                thumb,
                json.dumps(payload, ensure_ascii=False) if payload else None,
            ),
        )
        # Trim so the file never grows forever.
        conn.execute(
            "DELETE FROM history WHERE id NOT IN "
            "(SELECT id FROM history ORDER BY ts DESC LIMIT ?)",
            (config.HISTORY_LIMIT,),
        )
        return int(cur.lastrowid or 0)


def recent(limit: int = 30) -> list[dict[str, Any]]:
    with _LOCK, _connect() as conn:
        rows = conn.execute(
            "SELECT id, ts, url, platform, title, ok, error, thumb FROM history "
            "ORDER BY ts DESC LIMIT ?",
            (max(1, min(limit, 200)),),
        ).fetchall()
    return [dict(r) for r in rows]


def clear() -> int:
    with _LOCK, _connect() as conn:
        cur = conn.execute("DELETE FROM history")
        return cur.rowcount


init()
