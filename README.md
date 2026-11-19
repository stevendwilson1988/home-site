# home-site

The home page served from `/var/www/html`, including the scroll-to-Snake game.

Everything under `site/` is published. Everything else in the repo is never deployed.

- `site/index.html`: the home page (lake intro, themes, and the Snake stage markup and styles)
- `site/snake/snake.js`: the Snake game, built on [LittleJS](https://github.com/KilledByAPixel/LittleJS) (MIT, see `site/snake/LITTLEJS-LICENSE.txt`)
- `site/snake/littlejs.min.js`: the LittleJS engine, loaded on first scroll
- `server/`: the Snake top-5 leaderboard backend (not part of `site/`, so `deploy.sh` never publishes it)
- `site/lake.jpg`, `site/favicon.*`, `site/apple-touch-icon.png`: page assets

## Deploy

Commit your changes on `main`, then:

    ./deploy.sh -n   # dry run: list what would change (also --dry-run)
    ./deploy.sh      # deploy to /var/www/html

How it works:

- It deploys `site/` exactly as committed in `HEAD`, not your working copy.
- A real deploy refuses to run with uncommitted changes to tracked files, or when a branch other than `main` is checked out. A dry run still works in both cases and tells you what it leaves out.
- Only files that differ from the live copy are replaced. Files deployed before but since deleted or renamed in `site/` are removed. Nothing else in `/var/www/html` is touched. The list of deployed files is kept in `/var/backups/home-site/manifest`.
- Every live file it replaces or removes is first backed up to `/var/backups/home-site/<YYYYMMDD-HHMMSS>/`, outside the web root.
- Each file is written to a temp name and renamed into place. If any step fails, the files already changed are restored from the backup, so the site is never left half-deployed.

## Leaderboard backend

The top 5 beside the Snake board is shared by every visitor. Players enter 3-letter initials when a score makes the board, and each set of initials keeps only its best score.

- `server/app.py`: a small Flask app (`snake-scores` systemd service on 127.0.0.1:5003). Scores are kept in `/opt/snake-scores/scores.db`.
- nginx proxies `/snake/api/` to it with a per-visitor rate limit (`server/nginx-snake-scores*.conf`).
- The game asks for a signed token when each game starts and submits its score with it. The server checks that the initials are 3 letters and the score fits the board. It also rejects a score that came in faster than the game can play, and a token used twice. Even so, the game runs in the browser, so this is an honor system, not real anti-cheat.
- If the service is down, the board hides itself and the game plays as usual.

Install or update it on the server (needs sudo; runs the tests first, backs up anything it replaces, and reloads nginx only if `nginx -t` passes):

    server/install.sh

Run the tests alone:

    cd server && python3 -m unittest -v test_app

Remove a score:

    python3 -c "import sqlite3; c = sqlite3.connect('/opt/snake-scores/scores.db'); c.execute(\"DELETE FROM scores WHERE name='ABC'\"); c.commit()"
