"""Run with: cd server && python3 -m unittest -v test_app"""
import os
import tempfile
import time
import unittest

_tmp = tempfile.TemporaryDirectory()
os.environ["SNAKE_HOME"] = _tmp.name
os.environ["SNAKE_DB"] = os.path.join(_tmp.name, "scores.db")
os.environ["SNAKE_SECRET"] = os.path.join(_tmp.name, "secret")

import app as snake  # noqa: E402


class LeaderboardTest(unittest.TestCase):
    def setUp(self):
        for f in ("scores.db", "scores.db-wal", "scores.db-shm"):
            try:
                os.remove(os.path.join(_tmp.name, f))
            except FileNotFoundError:
                pass
        self.c = snake.app.test_client()

    def old_token(self, age=600):
        with snake.app.app_context():
            return snake.make_token(time.time() - age)

    def submit(self, name, score, token=None):
        return self.c.post("/snake/api/scores",
                           json={"name": name, "score": score, "token": token or self.old_token()})

    def test_empty_board(self):
        r = self.c.get("/snake/api/scores")
        self.assertEqual(r.status_code, 200)
        self.assertEqual(r.get_json(), {"top": []})
        self.assertEqual(r.headers["Cache-Control"], "no-store")

    def test_submit_and_uppercase(self):
        r = self.submit("abc", 12)
        self.assertEqual(r.status_code, 200)
        self.assertEqual([(e["name"], e["score"]) for e in r.get_json()["top"]], [("ABC", 12)])

    def test_keeps_each_names_best(self):
        self.submit("ABC", 12)
        self.submit("ABC", 5)
        top = self.submit("ABC", 9).get_json()["top"]
        self.assertEqual([(e["name"], e["score"]) for e in top], [("ABC", 12)])
        top = self.submit("ABC", 20).get_json()["top"]
        self.assertEqual([(e["name"], e["score"]) for e in top], [("ABC", 20)])

    def test_top_five_order_and_ties(self):
        for name, score in [("AAA", 3), ("BBB", 9), ("CCC", 9), ("DDD", 1), ("EEE", 7), ("FFF", 5)]:
            self.submit(name, score)
            time.sleep(1.01)  # 'at' has one-second resolution; ties go to the earlier score
        top = self.c.get("/snake/api/scores").get_json()["top"]
        self.assertEqual([e["name"] for e in top], ["BBB", "CCC", "EEE", "FFF", "AAA"])

    def test_bad_names(self):
        for name in ["AB", "ABCD", "A1C", "", None, 123, "ÀBC"]:
            self.assertEqual(self.submit(name, 5).status_code, 400, name)

    def test_bad_scores(self):
        for score in [0, -1, snake.MAX_SCORE + 1, 5.5, "5", None, True]:
            self.assertEqual(self.submit("ABC", score).status_code, 400, score)
        self.assertEqual(self.submit("ABC", snake.MAX_SCORE).status_code, 200)

    def test_not_json(self):
        self.assertEqual(self.c.post("/snake/api/scores", data="x").status_code, 400)
        self.assertEqual(self.c.post("/snake/api/scores", json=[1]).status_code, 400)

    def test_token_from_start_works_after_enough_time(self):
        token = self.c.post("/snake/api/start").get_json()["token"]
        self.assertEqual(self.submit("ABC", 50, token).status_code, 403)   # too fast: needs 3 s
        token = self.c.post("/snake/api/start").get_json()["token"]
        time.sleep(0.15)
        self.assertEqual(self.submit("ABC", 2, token).status_code, 200)

    def test_token_used_once(self):
        token = self.old_token()
        self.assertEqual(self.submit("ABC", 5, token).status_code, 200)
        self.assertEqual(self.submit("XYZ", 5, token).status_code, 409)

    def test_expired_token(self):
        self.assertEqual(self.submit("ABC", 5, self.old_token(snake.TOKEN_MAX_AGE + 5)).status_code, 403)

    def test_forged_tokens(self):
        good = self.old_token()
        ts, frac, nonce, sig = good.split(".")
        forged = [
            "nope", "", None, 42, "a.b.c.d",
            f"{int(ts) - 100}.{frac}.{nonce}.{sig}",          # moved the timestamp
            f"{ts}.{frac}.{nonce}.{'0' * 32}",                 # bad signature
            good + "x" * 100,                                  # oversized
        ]
        for t in forged:
            r = self.c.post("/snake/api/scores", json={"name": "ABC", "score": 5, "token": t})
            self.assertEqual(r.status_code, 403, t)


if __name__ == "__main__":
    unittest.main()
