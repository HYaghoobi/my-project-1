import hashlib
import os
import secrets
import sqlite3
from collections.abc import Generator
from pathlib import Path

from fastapi import Request

DEMO_USERNAME = "user"
DEMO_PASSWORD = "password"
PBKDF2_ITERATIONS = 260_000
INITIAL_COLUMNS = (
    "برای انجام",
    "در حال انجام",
    "انجام‌شده",
    "در انتظار تأیید",
    "پروژه‌های در انتظار",
    "پروژه‌های اتمام‌شده",
)
INITIAL_CARDS = (
    (0, 0, "روایت تازه برای برند", "یک داستان کوتاه که دلیل شکل‌گیری محصول را روشن کند."),
    (0, 1, "ایده‌های ورود کاربران", "تجربهٔ اولین برخورد را ساده‌تر و دلنشین‌تر کنیم."),
    (1, 0, "بازنویسی متن صفحهٔ اصلی", "متن معرفی را کوتاه‌تر و روشن‌تر بازنویسی کنیم."),
    (1, 1, "ساخت نمونهٔ اولیه", "مسیر اصلی کاربر را در یک نمونهٔ قابل کلیک نشان دهیم."),
    (2, 0, "تعریف زبان بصری", "رنگ‌ها و سبک کلی رابط کاربری مشخص شد."),
    (2, 1, "جلسهٔ هم‌فکری تیم", "نیازهای اصلی محصول را با هم مرور کردیم."),
    (3, 0, "بازبینی مسیر ثبت‌نام", "مراحل غیرضروری را پیدا و حذف کنیم."),
    (4, 0, "بررسی تجربهٔ موبایل", "بازخوردهای کاربران را در یک فهرست کوتاه جمع‌بندی کنیم."),
    (5, 0, "مرتب‌سازی اجزای طراحی", "رنگ‌ها و فاصله‌ها را برای نسخهٔ بعدی یکدست کنیم."),
)

configured_path = os.environ.get("PM_DATABASE_PATH")
DEFAULT_DATABASE_PATH = (
    Path(configured_path)
    if configured_path
    else Path(__file__).resolve().parents[1] / "data" / "pm.sqlite3"
)

SCHEMA = """
CREATE TABLE IF NOT EXISTS users (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    username TEXT NOT NULL UNIQUE,
    password_hash TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS boards (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    user_id INTEGER NOT NULL UNIQUE REFERENCES users(id) ON DELETE CASCADE,
    name TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS "columns" (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    board_id INTEGER NOT NULL REFERENCES boards(id) ON DELETE CASCADE,
    name TEXT NOT NULL,
    position INTEGER NOT NULL CHECK (position >= 0),
    UNIQUE (board_id, position)
);

CREATE TABLE IF NOT EXISTS cards (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    column_id INTEGER NOT NULL REFERENCES "columns"(id) ON DELETE CASCADE,
    title TEXT NOT NULL,
    details TEXT NOT NULL DEFAULT '',
    position INTEGER NOT NULL CHECK (position >= 0),
    UNIQUE (column_id, position)
);

CREATE TABLE IF NOT EXISTS chat_messages (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    role TEXT NOT NULL CHECK (role IN ('user', 'assistant')),
    content TEXT NOT NULL,
    created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
);

CREATE TABLE IF NOT EXISTS chat_proposals (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    message_id INTEGER NOT NULL UNIQUE REFERENCES chat_messages(id) ON DELETE CASCADE,
    operations_json TEXT NOT NULL,
    status TEXT NOT NULL DEFAULT 'pending'
        CHECK (status IN ('pending', 'applied', 'rejected'))
);
"""


def hash_password(password: str) -> str:
    salt = secrets.token_bytes(16)
    digest = hashlib.pbkdf2_hmac(
        "sha256", password.encode("utf-8"), salt, PBKDF2_ITERATIONS
    )
    return f"pbkdf2_sha256${salt.hex()}${digest.hex()}"


def verify_password(password: str, password_hash: str) -> bool:
    algorithm, separator, encoded = password_hash.partition("$")
    if algorithm != "pbkdf2_sha256" or not separator:
        return False

    salt_hex, separator, expected_hex = encoded.partition("$")
    if not separator:
        return False

    try:
        salt = bytes.fromhex(salt_hex)
        expected = bytes.fromhex(expected_hex)
    except ValueError:
        return False

    actual = hashlib.pbkdf2_hmac(
        "sha256", password.encode("utf-8"), salt, PBKDF2_ITERATIONS
    )
    return secrets.compare_digest(actual, expected)


def last_inserted_id(cursor: sqlite3.Cursor) -> int:
    if cursor.lastrowid is None:
        raise RuntimeError("SQLite did not return the inserted row ID")
    return cursor.lastrowid


def connect_database(path: Path) -> sqlite3.Connection:
    path.parent.mkdir(parents=True, exist_ok=True)
    connection = sqlite3.connect(path, check_same_thread=False)
    connection.row_factory = sqlite3.Row
    connection.execute("PRAGMA foreign_keys = ON")
    return connection


def initialize_database(path: Path) -> None:
    connection = connect_database(path)
    try:
        version = int(connection.execute("PRAGMA user_version").fetchone()[0])
        with connection:
            connection.executescript(SCHEMA)
            if version == 2:
                connection.execute(
                    "CREATE TABLE chat_proposals_v3 ("
                    "id INTEGER PRIMARY KEY AUTOINCREMENT, "
                    "user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE, "
                    "message_id INTEGER NOT NULL UNIQUE REFERENCES "
                    "chat_messages(id) ON DELETE CASCADE, "
                    "operations_json TEXT NOT NULL, "
                    "status TEXT NOT NULL DEFAULT 'pending' "
                    "CHECK (status IN ('pending', 'applied', 'rejected')))"
                )
                connection.execute(
                    "INSERT INTO chat_proposals_v3 "
                    "(id, user_id, message_id, operations_json, status) "
                    "SELECT id, user_id, message_id, operations_json, status "
                    "FROM chat_proposals"
                )
                connection.execute("DROP TABLE chat_proposals")
                connection.execute(
                    "ALTER TABLE chat_proposals_v3 RENAME TO chat_proposals"
                )
            connection.execute("PRAGMA user_version = 3")
            user = connection.execute(
                "SELECT id FROM users WHERE username = ?",
                (DEMO_USERNAME,),
            ).fetchone()
            if user is None:
                cursor = connection.execute(
                    "INSERT INTO users (username, password_hash) VALUES (?, ?)",
                    (DEMO_USERNAME, hash_password(DEMO_PASSWORD)),
                )
                user_id = last_inserted_id(cursor)
            else:
                user_id = int(user["id"])

            board = connection.execute(
                "SELECT id FROM boards WHERE user_id = ?",
                (user_id,),
            ).fetchone()
            board_created = board is None
            if board_created:
                cursor = connection.execute(
                    "INSERT INTO boards (user_id, name) VALUES (?, ?)",
                    (user_id, "تختهٔ تیم محصول"),
                )
                board_id = last_inserted_id(cursor)
            else:
                board_id = int(board["id"])

            if board_created:
                column_ids: list[int] = []
                for position, name in enumerate(INITIAL_COLUMNS):
                    cursor = connection.execute(
                        'INSERT INTO "columns" (board_id, name, position) '
                        "VALUES (?, ?, ?)",
                        (board_id, name, position),
                    )
                    column_ids.append(last_inserted_id(cursor))

                connection.executemany(
                    "INSERT INTO cards (column_id, title, details, position) "
                    "VALUES (?, ?, ?, ?)",
                    [
                        (column_ids[column_position], title, details, position)
                        for column_position, position, title, details in INITIAL_CARDS
                    ],
                )
    finally:
        connection.close()


def get_database(request: Request) -> Generator[sqlite3.Connection, None, None]:
    connection = connect_database(request.app.state.database_path)
    try:
        yield connection
    finally:
        connection.close()
