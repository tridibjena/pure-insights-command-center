"""Apply db/migrations/*.sql in filename order, recording each in public.schema_migrations."""

from __future__ import annotations

import hashlib

from .config import MIGRATIONS_DIR
from .db import connect


def run(test: bool = False) -> list[str]:
    applied: list[str] = []
    with connect(test) as conn, conn.cursor() as cur:
        cur.execute(
            """CREATE TABLE IF NOT EXISTS public.schema_migrations (
                   filename   TEXT PRIMARY KEY,
                   checksum   TEXT NOT NULL,
                   applied_at TIMESTAMPTZ NOT NULL DEFAULT now())"""
        )
        cur.execute("SELECT filename, checksum FROM public.schema_migrations")
        done = dict(cur.fetchall())
        for path in sorted(MIGRATIONS_DIR.glob("*.sql")):
            sql = path.read_text()
            checksum = hashlib.sha256(sql.encode()).hexdigest()
            if done.get(path.name) == checksum:
                continue
            # Migrations are written to be idempotent (IF NOT EXISTS / OR REPLACE),
            # so a changed file is simply re-applied.
            cur.execute(sql)
            cur.execute(
                """INSERT INTO public.schema_migrations (filename, checksum) VALUES (%s, %s)
                   ON CONFLICT (filename) DO UPDATE SET checksum = EXCLUDED.checksum, applied_at = now()""",
                (path.name, checksum),
            )
            applied.append(path.name)
    return applied
