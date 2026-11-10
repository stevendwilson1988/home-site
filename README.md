# home-site

The home page served from `/var/www/html`, including the scroll-to-Snake game.

Everything under `site/` is published. Everything else in the repo is never deployed.

- `site/index.html`: the home page (lake intro, themes, and the Snake stage markup and styles)
- `site/snake/snake.js`: the Snake game, built on [LittleJS](https://github.com/KilledByAPixel/LittleJS) (MIT, see `site/snake/LITTLEJS-LICENSE.txt`)
- `site/snake/littlejs.min.js`: the LittleJS engine, loaded on first scroll
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
