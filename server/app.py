"""Snake leaderboard: the top 5 players across everyone who visits the home page.

Runs behind nginx at /snake/api/ (see nginx-snake-scores.conf) on 127.0.0.1:5003.

  GET  /snake/api/scores   -> {"top": [{"name", "score", "at"}, ...]}   best 5, one row per name
  POST /snake/api/start    -> {"token"}                                  call when a new game begins
  POST /snake/api/scores   {"name", "score", "token"} -> {"top"}         submit a finished game

The game runs in the browser, so this is an honor system with guardrails, not real anti-cheat:
names are 3 letters, scores fit the board, and a game token must have existed long enough
to play that many steps at the game's top speed, and can only be used once.
"""
import hashlib
import hmac
import os
import re
import secrets
import sqlite3
import time
from datetime import datetime, timezone
from pathlib import Path

from flask import Flask, g, jsonify, request

BASE = Path(os.environ.get("SNAKE_HOME", "/opt/snake-scores"))
DB_PATH = Path(os.environ.get("SNAKE_DB", BASE / "scores.db"))
SECRET_PATH = Path(os.environ.get("SNAKE_SECRET", BASE / "secret"))

TOP_N = 5
MAX_SCORE = 20 * 20 - 4          # a 20x20 board, starting 4 long
MIN_SECONDS_PER_POINT = 0.06     # the game's fastest step (snake.js stepInterval)
TOKEN_MAX_AGE = 2 * 3600
NAME_RE = re.compile(r"^[A-Z]{3}$")

app = Flask(__name__)


def _secret():
    if not SECRET_PATH.exists():
        SECRET_PATH.parent.mkdir(parents=True, exist_ok=True)
        fd = os.open(SECRET_PATH, os.O_WRONLY | os.O_CREAT | os.O_EXCL, 0o600)
        with os.fdopen(fd, "w") as f:
            f.write(secrets.token_hex(32))
    return SECRET_PATH.read_text().strip().encode()


def _db():
    if "db" not in g:
        db = sqlite3.connect(DB_PATH, timeout=5)
        db.execute("PRAGMA journal_mode=WAL")
        db.executescript("""
            CREATE TABLE IF NOT EXISTS scores (
                name  TEXT PRIMARY KEY,
                score INTEGER NOT NULL,
                at    TEXT NOT NULL
            );
            CREATE TABLE IF NOT EXISTS used_tokens (
                nonce  TEXT PRIMARY KEY,
                issued REAL NOT NULL
            );
        """)
        g.db = db
    return g.db


@app.teardown_appcontext
def _close(_exc):
    db = g.pop("db", None)
    if db is not None:
        db.close()


def _sign(payload):
    return hmac.new(_secret(), payload.encode(), hashlib.sha256).hexdigest()[:32]


def make_token(issued=None):
    issued = time.time() if issued is None else issued
    payload = f"{issued:.3f}.{secrets.token_hex(8)}"
    return f"{payload}.{_sign(payload)}"


def _read_token(token):
    """(issued, nonce) for a correctly signed token, else None."""
    if not isinstance(token, str) or len(token) > 100:
        return None
    parts = token.split(".")
    if len(parts) != 4:
        return None
    payload, sig = ".".join(parts[:3]), parts[3]
    if not hmac.compare_digest(sig, _sign(payload)):
        return None
    try:
        return float(f"{parts[0]}.{parts[1]}"), parts[2]
    except ValueError:
        return None


def top():
    rows = _db().execute(
        "SELECT name, score, at FROM scores ORDER BY score DESC, at ASC LIMIT ?", (TOP_N,)
    ).fetchall()
    return [{"name": n, "score": s, "at": a} for n, s, a in rows]


def _error(msg, code=400):
    return jsonify(error=msg), code


@app.after_request
def _no_store(resp):
    resp.headers["Cache-Control"] = "no-store"
    return resp


@app.get("/snake/api/scores")
def get_scores():
    return jsonify(top=top())


@app.post("/snake/api/start")
def start():
    return jsonify(token=make_token())


@app.post("/snake/api/scores")
def post_score():
    data = request.get_json(silent=True)
    if not isinstance(data, dict):
        return _error("Expected JSON.")

    name = data.get("name")
    name = name.strip().upper() if isinstance(name, str) else ""
    if not NAME_RE.match(name):
        return _error("Initials must be 3 letters.")

    score = data.get("score")
    if type(score) is not int or not 1 <= score <= MAX_SCORE:
        return _error("Score is out of range.")

    tok = _read_token(data.get("token"))
    if tok is None:
        return _error("Invalid game token.", 403)
    issued, nonce = tok
    now = time.time()
    if now - issued > TOKEN_MAX_AGE:
        return _error("Game token expired.", 403)
    if now - issued < score * MIN_SECONDS_PER_POINT:
        return _error("That score came in faster than the game allows.", 403)

    db = _db()
    with db:
        db.execute("DELETE FROM used_tokens WHERE issued < ?", (now - TOKEN_MAX_AGE,))
        try:
            db.execute("INSERT INTO used_tokens (nonce, issued) VALUES (?, ?)", (nonce, issued))
        except sqlite3.IntegrityError:
            return _error("That game was already submitted.", 409)
        at = datetime.now(timezone.utc).isoformat(timespec="seconds")
        db.execute(
            """INSERT INTO scores (name, score, at) VALUES (?, ?, ?)
               ON CONFLICT(name) DO UPDATE SET score = excluded.score, at = excluded.at
               WHERE excluded.score > scores.score""",
            (name, score, at),
        )
    return jsonify(top=top())
