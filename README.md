# home-site

The home page served from `/var/www/html`, including the scroll-to-Snake game.

- `index.html`: the home page (lake intro, themes, and the Snake stage markup and styles)
- `snake/snake.js`: the Snake game, built on [LittleJS](https://github.com/KilledByAPixel/LittleJS) (MIT, see `snake/LITTLEJS-LICENSE.txt`)
- `snake/littlejs.min.js`: the LittleJS engine, loaded on first scroll
- `lake.jpg`, `favicon.*`, `apple-touch-icon.png`: page assets

## Deploy

Commit your changes, then:

    ./deploy.sh -n   # dry run: list what would change
    ./deploy.sh      # copy changed files to /var/www/html

It refuses to run with uncommitted changes, replaces only files that differ
from the live copy, and backs up each replaced live file as
`<name>.bak-YYYYMMDD-HHMMSS`.
