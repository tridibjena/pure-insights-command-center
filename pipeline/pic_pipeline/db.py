"""PostgreSQL helpers (psycopg 3)."""

from __future__ import annotations

import io
from collections.abc import Iterable, Sequence

import pandas as pd
import psycopg

from .config import dsn


def connect(test: bool = False) -> psycopg.Connection:
    return psycopg.connect(dsn(test))


def copy_dataframe(cur: psycopg.Cursor, table: str, df: pd.DataFrame, columns: Sequence[str] | None = None) -> int:
    """Bulk-load a DataFrame with COPY (CSV format; empty string → NULL)."""
    cols = list(columns or df.columns)
    buf = io.StringIO()
    df[cols].to_csv(buf, index=False, header=False, na_rep="")
    buf.seek(0)
    col_sql = ", ".join(cols)
    with cur.copy(f"COPY {table} ({col_sql}) FROM STDIN WITH (FORMAT csv, NULL '')") as copy:
        while chunk := buf.read(1 << 16):
            copy.write(chunk)
    return len(df)


def query_df(conn: psycopg.Connection, sql: str, params: Iterable | None = None) -> pd.DataFrame:
    with conn.cursor() as cur:
        cur.execute(sql, params)
        cols = [d.name for d in cur.description]
        return pd.DataFrame(cur.fetchall(), columns=cols)
