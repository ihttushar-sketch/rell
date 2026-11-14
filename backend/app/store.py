"""SQLite-backed Production Vault.

Deliberately dependency-free: sqlite3 is in the standard library, connections
are short-lived and WAL is enabled so concurrent reads never block a render.
"""

from __future__ import annotations

import json
import sqlite3
import threading
from pathlib import Path
from typing import Any, Dict, List, Optional

from .config import DB_PATH

_LOCK = threading.Lock()
_INITIALISED = False


def _connect() -> sqlite3.Connection:
    connection = sqlite3.connect(DB_PATH, timeout=30, check_same_thread=False)
    connection.row_factory = sqlite3.Row
    connection.execute("PRAGMA journal_mode=WAL")
    connection.execute("PRAGMA synchronous=NORMAL")
    return connection


def init_db() -> None:
    global _INITIALISED
    with _LOCK:
        if _INITIALISED:
            return
        DB_PATH.parent.mkdir(parents=True, exist_ok=True)
        with _connect() as connection:
            connection.execute(
                """
                CREATE TABLE IF NOT EXISTS frameworks (
                    id TEXT PRIMARY KEY,
                    name TEXT NOT NULL,
                    created_at TEXT NOT NULL,
                    updated_at TEXT NOT NULL,
                    payload TEXT NOT NULL
                )
                """
            )
            connection.execute("CREATE INDEX IF NOT EXISTS idx_frameworks_created ON frameworks(created_at)")
        _INITIALISED = True


def upsert_framework(payload: Dict[str, Any]) -> Dict[str, Any]:
    init_db()
    framework_id = str(payload["id"])
    now = str(payload.get("created_at") or "")
    document = json.dumps(payload, ensure_ascii=False)
    with _LOCK, _connect() as connection:
        connection.execute(
            """
            INSERT INTO frameworks (id, name, created_at, updated_at, payload)
            VALUES (?, ?, ?, datetime('now'), ?)
            ON CONFLICT(id) DO UPDATE SET name=excluded.name, updated_at=excluded.updated_at, payload=excluded.payload
            """,
            (framework_id, str(payload.get("framework_name", "Untitled")), now, document),
        )
    return payload


def list_frameworks() -> List[Dict[str, Any]]:
    init_db()
    with _LOCK, _connect() as connection:
        rows = connection.execute("SELECT payload FROM frameworks ORDER BY created_at ASC").fetchall()
    output: List[Dict[str, Any]] = []
    for row in rows:
        try:
            output.append(json.loads(row["payload"]))
        except json.JSONDecodeError:
            continue
    return output


def get_framework(framework_id: str) -> Optional[Dict[str, Any]]:
    init_db()
    with _LOCK, _connect() as connection:
        row = connection.execute("SELECT payload FROM frameworks WHERE id = ?", (framework_id,)).fetchone()
    if not row:
        return None
    try:
        return json.loads(row["payload"])
    except json.JSONDecodeError:
        return None


def delete_framework(framework_id: str) -> bool:
    init_db()
    with _LOCK, _connect() as connection:
        cursor = connection.execute("DELETE FROM frameworks WHERE id = ?", (framework_id,))
    return cursor.rowcount > 0


def count_frameworks() -> int:
    init_db()
    with _LOCK, _connect() as connection:
        row = connection.execute("SELECT COUNT(*) AS total FROM frameworks").fetchone()
    return int(row["total"]) if row else 0


def media_root() -> Path:
    from .config import DATA_DIR

    return DATA_DIR
