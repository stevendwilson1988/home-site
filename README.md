# home-site

The home page served from `/var/www/html`, including the scroll-to-Snake game.

- `index.html`: the home page (lake intro, themes, and the Snake stage markup and styles)
- `snake/snake.js`: the Snake game, built on [LittleJS](https://github.com/KilledByAPixel/LittleJS) (MIT, see `snake/LITTLEJS-LICENSE.txt`)
- `snake/littlejs.min.js`: the LittleJS engine, loaded on first scroll
- `lake.jpg`, `favicon.*`, `apple-touch-icon.png`: page assets

## Deploy

    sudo cp index.html favicon.ico favicon.svg apple-touch-icon.png lake.jpg /var/www/html/
    sudo cp snake/snake.js snake/littlejs.min.js snake/LITTLEJS-LICENSE.txt /var/www/html/snake/
