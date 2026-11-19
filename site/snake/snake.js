// Home page "intermission": scrolling past the lake washes the page to white and a
// game of Snake rises into view. The game runs on Frank Force's LittleJS engine
// (https://github.com/KilledByAPixel/LittleJS, MIT), loaded on the first scroll.
(() => {
  'use strict';

  const ENGINE_SRC = '/snake/littlejs.min.js';
  const N = 20;          // board is N x N cells
  const PX = 640;        // canvas size in css pixels before it is scaled to fit

  const root = document.documentElement;
  const runway = document.getElementById('play-runway');
  const wrap = document.getElementById('snake-wrap');
  const boardEl = document.getElementById('snake-board');
  const msgEl = document.getElementById('snake-msg');
  const btn = document.getElementById('snake-btn');
  const scoreEl = document.getElementById('snake-score');
  const bestEl = document.getElementById('snake-best');
  const topWrap = document.getElementById('snake-top-wrap');
  const topLists = [document.getElementById('snake-top'), document.getElementById('snake-top-mini')];
  const initialsForm = document.getElementById('snake-initials');
  const initialsInput = document.getElementById('snake-name');

  // ------------------------------------------------------------ game state
  let state = 'loading';  // loading | ready | playing | paused | over
  let snake = [], prev = [], dir = { x: 1, y: 0 }, queue = [];
  let food = { x: 14, y: 10 }, foodBorn = 0;
  let clock = 0, acc = 0, score = 0, best = 0, shake = 0, deadAt = 0;
  let particles = [], colors, sounds;
  let revealed = false, onScreen = false;

  try { best = +localStorage.getItem('snake-best') || 0; } catch (e) {}
  bestEl.textContent = best;

  // ------------------------------------------------------- shared top 5
  // Everyone's best five, one row per set of initials, kept by the snake-scores service
  // (home-site/server). If it can't be reached the board hides and the game plays on.
  const API = '/snake/api';
  const TOP_N = 5;
  let board = null;            // last list from the server, or null if it never answered
  let gameId = 0, tokenReq = null;
  let myInitials = '';
  try { myInitials = localStorage.getItem('snake-initials') || ''; } catch (e) {}

  const api = (path, body) => fetch(API + path, body === undefined ? { cache: 'no-store' } : {
    method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body),
  }).then(r => r.json().catch(() => ({})).then(d => {
    if (!r.ok) throw new Error(d.error || 'The leaderboard is unavailable.');
    return d;
  }));

  function renderBoard() {
    topWrap.hidden = !board;
    for (const ol of topLists) {
      ol.replaceChildren();
      if (!board) continue;
      for (let i = 0; i < TOP_N; i++) {
        const e = board[i], li = document.createElement('li');
        const cells = [i + 1, e ? e.name : '———', e ? e.score : ''];
        ['rank', 'who', 'pts'].forEach((cls, k) => {
          const s = document.createElement('span');
          s.className = cls; s.textContent = cells[k];
          li.appendChild(s);
        });
        if (!e) li.classList.add('empty');
        else if (e.name === myInitials) li.classList.add('is-you');
        ol.appendChild(li);
      }
    }
  }

  function loadBoard() {
    return api('/scores').then(d => { board = d.top; }, () => {}).then(renderBoard);
  }

  const makesBoard = s => board && s > 0 && (board.length < TOP_N || s > board[TOP_N - 1].score);

  function offerSave(id, s) {
    if (id !== gameId || state !== 'over' || !tokenReq || !makesBoard(s)) return;
    msgEl.textContent = `Score ${s} · top 5!`;
    initialsInput.value = myInitials;
    initialsForm.hidden = false;
    initialsForm.querySelector('button').disabled = false;
    // Focus right away with a mouse and keyboard; on touch screens wait for a tap, so no keyboard pops up.
    if (matchMedia('(pointer: fine)').matches) initialsInput.focus({ preventScroll: true });
  }

  function hideSave() {
    initialsForm.hidden = true;
    if (document.activeElement && initialsForm.contains(document.activeElement)) document.activeElement.blur();
  }

  initialsForm.addEventListener('submit', e => {
    e.preventDefault();
    const name = initialsInput.value.trim().toUpperCase();
    if (!/^[A-Z]{3}$/.test(name)) { initialsInput.focus(); return; }
    const id = gameId, s = score, req = tokenReq;
    tokenReq = null;   // one submission per game
    initialsForm.querySelector('button').disabled = true;
    myInitials = name;
    try { localStorage.setItem('snake-initials', name); } catch (e) {}
    req.then(token => api('/scores', { name, score: s, token }))
      .then(d => {
        board = d.top;
        const rank = board.findIndex(r => r.name === name) + 1;
        return rank ? `${name} is #${rank} in the top 5` : `Saved, but ${name} has a better score already`;
      }, err => err.message)
      .then(text => {
        renderBoard();
        if (id !== gameId || state !== 'over') return;
        hideSave();
        msgEl.textContent = text;
      });
  });

  // ------------------------------------------------------- scroll reveal
  const clamp01 = v => v < 0 ? 0 : v > 1 ? 1 : v;
  const ease = (a, b, v) => { const x = clamp01((v - a) / (b - a)); return x * x * (3 - 2 * x); };
  let ticking = false;

  // When the stage text and board fade in, per theme (set on <html data-theme> by the inline head script).
  // night and frost wait for the background to finish changing; shore's text sits on a solid panel, so it comes early.
  const REVEAL = {
    wash:  { copy: [0.38, 0.82], board: [0.48, 0.98] },
    night: { copy: [0.55, 0.85], board: [0.62, 0.98] },
    frost: { copy: [0.55, 0.85], board: [0.62, 0.98] },
    shore: { copy: [0.30, 0.60], board: [0.35, 0.70] },
  };
  const reveal = REVEAL[root.dataset.theme] || REVEAL.wash;

  function measure() {
    ticking = false;
    const vh = innerHeight, r = runway.getBoundingClientRect();
    // 0 while the runway sits below the fold, 1 once it has risen 1.4 screens
    const t = clamp01((vh - r.top) / (vh * 1.4));
    root.style.setProperty('--wash', ease(0.04, 0.6, t).toFixed(4));
    root.style.setProperty('--reveal-copy', ease(...reveal.copy, t).toFixed(4));
    root.style.setProperty('--reveal-board', ease(...reveal.board, t).toFixed(4));
    root.style.setProperty('--cue', (1 - ease(0, 0.1, t)).toFixed(4));
    root.classList.toggle('lights-on', t > 0.45);
    revealed = t > 0.8;
    if (!revealed && state === 'playing') pause();
  }
  function onScroll() {
    if (!ticking) { ticking = true; requestAnimationFrame(measure); }
    loadEngine();
  }
  addEventListener('scroll', onScroll, { passive: true });
  addEventListener('resize', () => { if (!ticking) { ticking = true; requestAnimationFrame(measure); } });
  measure();
  if (scrollY > 0) loadEngine();             // reloaded part way down the page
  setTimeout(loadEngine, 4000);              // or fetch it once the intro has played

  // ------------------------------------------------------- engine loading
  let engineRequested = false;
  function loadEngine() {
    if (engineRequested) return;
    engineRequested = true;
    const s = document.createElement('script');
    s.src = ENGINE_SRC;
    s.async = true;
    s.onload = startEngine;
    s.onerror = () => { msgEl.textContent = 'The game could not load.'; btn.hidden = true; };
    document.head.appendChild(s);
  }

  function startEngine() {
    // Game colors come from the theme's CSS custom properties; the fallbacks are the wash theme's.
    // The board color itself is painted by CSS behind a transparent canvas, so a translucent theme board works.
    const css = getComputedStyle(root);
    const probe = document.createElement('canvas').getContext('2d');
    const cssColor = (name, fallback) => {
      probe.fillStyle = fallback;
      probe.fillStyle = css.getPropertyValue(name).trim() || fallback;  // an invalid value leaves the fallback
      const s = probe.fillStyle;                       // normalized to "#rrggbb" or "rgba(r, g, b, a)"
      if (s[0] === '#') return new Color().setHex(s);
      const [r, g, b, a = 1] = s.match(/[\d.]+/g).map(Number);
      return rgb(r / 255, g / 255, b / 255, a);
    };
    const foodColor = cssColor('--food', '#ef7b54');
    colors = {
      check: cssColor('--grid', '#ebf0f7'),
      head: cssColor('--snake-head', '#12305a'), tail: cssColor('--snake', '#7d9cc4'), dead: new Color().setHex('#c3cedd'),
      food: foodColor, halo: foodColor.scale(1, 0.16), shine: rgb(1, 1, 1, 0.75),
      eye: rgb(1, 1, 1), pupil: new Color().setHex('#0b1f3b'),
    };
    // zzfx: volume, randomness, frequency, attack, sustain, release, shape, shapeCurve, slide, deltaSlide, pitchJump, pitchJumpTime
    sounds = {
      start: new Sound([0.4, 0, 440, 0.01, 0.04, 0.18, 0, 1.5, 0, 0, 220, 0.06]),
      eat: new Sound([0.6, 0.05, 660, 0, 0.02, 0.12, 0, 2, 0, 0, 440, 0.04]),
      die: new Sound([0.7, 0.05, 180, 0.01, 0.15, 0.45, 3, 1.5, -6, 0, 0, 0, 0, 0.3]),
    };

    setShowSplashScreen(false);
    setInputPreventDefault(false);   // the page must keep scrolling; keys are claimed below only while playing
    setTouchInputEnable(false);      // swipes are read from pointer events instead
    setCanvasFixedSize(vec2(PX));
    setCanvasPixelRatio(undefined);  // track devicePixelRatio for a crisp board
    setCanvasClearColor(rgb(0, 0, 0, 0));
    setSoundVolume(0.5);

    // engineInit prepends its own root styles; these come after and win
    boardEl.style.cssText = 'background:transparent;touch-action:auto;overflow:hidden;position:absolute;inset:0;';
    engineInit(gameInit, gameUpdate, gameUpdatePost, gameRender, undefined, [], boardEl);
    loadBoard();
  }

  // ------------------------------------------------------------ the game
  const KEYS = [['ArrowUp', 0, 1], ['ArrowDown', 0, -1], ['ArrowLeft', -1, 0], ['ArrowRight', 1, 0]];
  const stepInterval = () => Math.max(0.06, 0.125 - score * 0.0025);

  function gameInit() {
    setCameraPos(vec2(N / 2));
    setCameraScale(PX / N);
    reset();
    state = 'ready';
    showOverlay('Arrow keys, WASD, or swipe to steer.', 'Play');
  }

  function reset() {
    snake = [{ x: 7, y: 6 }, { x: 6, y: 6 }, { x: 5, y: 6 }, { x: 4, y: 6 }];
    prev = snake.map(p => ({ ...p }));
    dir = { x: 1, y: 0 };
    queue = []; particles = []; acc = 0;
    setScore(0);
    placeFood();
  }

  function placeFood() {
    const free = [];
    for (let x = 0; x < N; x++)
      for (let y = 0; y < N; y++)
        if (!snake.some(s => s.x === x && s.y === y)) free.push({ x, y });
    if (!free.length) return die(true);
    food = free[Math.random() * free.length | 0];
    foodBorn = clock;
  }

  function setScore(v) {
    score = v;
    scoreEl.textContent = v;
    if (v > best) {
      best = v;
      bestEl.textContent = v;
      try { localStorage.setItem('snake-best', v); } catch (e) {}
    }
  }

  function turn(x, y) {
    const last = queue.length ? queue[queue.length - 1] : dir;
    if ((x === last.x && y === last.y) || (x === -last.x && y === -last.y)) return;
    if (queue.length < 3) queue.push({ x, y });
  }

  function step() {
    if (queue.length) dir = queue.shift();
    const h = { x: snake[0].x + dir.x, y: snake[0].y + dir.y };
    const eats = h.x === food.x && h.y === food.y;
    const body = eats ? snake : snake.slice(0, -1);   // the tail moves out of the way unless we grow
    if (h.x < 0 || h.y < 0 || h.x >= N || h.y >= N || body.some(s => s.x === h.x && s.y === h.y))
      return die(false);

    prev = snake.map(p => ({ ...p }));
    snake.unshift(h);
    if (eats) {
      prev.push({ ...prev[prev.length - 1] });  // the new tail segment starts where the old one is
      setScore(score + 1);
      burst(food);
      sounds.eat.play();
      placeFood();
    } else snake.pop();
  }

  function die(won) {
    state = 'over';
    deadAt = clock;
    shake = won ? 0 : 1;
    won || sounds.die.play();
    setTouchPlaying(false);
    const isBest = score > 0 && score === best;
    showOverlay(won ? `You filled the board — ${score}!` :
      `Score ${score}${isBest ? ' · new best' : ''}`, 'Play again', 0.7);
    // check against a fresh board, since others may have played since this page loaded
    const id = gameId, s = score;
    if (s > 0 && tokenReq) loadBoard().then(() => offerSave(id, s));
  }

  function burst(c) {
    for (let i = 0; i < 14; i++) {
      const a = Math.random() * Math.PI * 2, v = 2 + Math.random() * 4;
      particles.push({ x: c.x + 0.5, y: c.y + 0.5, vx: Math.cos(a) * v, vy: Math.sin(a) * v, life: 0.5, max: 0.5 });
    }
  }

  function start() {
    if (state === 'loading' || state === 'playing') return;
    if (state !== 'paused') {
      reset();
      gameId++;
      hideSave();
      // a token from the server, issued now, that this game's score is submitted with
      const req = tokenReq = board ? api('/start', {}).then(d => d.token) : null;
      if (req) req.catch(() => { if (tokenReq === req) tokenReq = null; });
    }
    state = 'playing';
    hideOverlay();
    setTouchPlaying(true);
    sounds.start.play();
  }

  function pause() {
    if (state !== 'playing') return;
    state = 'paused';
    setTouchPlaying(false);
    showOverlay('Paused', 'Resume');
  }

  function gameUpdate() {
    clock += timeDelta;
    shake = Math.max(0, shake - timeDelta * 2.5);
    for (const p of particles) {
      p.life -= timeDelta;
      p.x += p.vx * timeDelta; p.y += p.vy * timeDelta;
      p.vx *= 0.9; p.vy *= 0.9;
    }
    particles = particles.filter(p => p.life > 0);

    if (state !== 'playing') return;
    for (const [key, x, y] of KEYS)
      if (keyWasPressed(key)) turn(x, y);   // WASD arrive here too, LittleJS maps them to arrows
    acc += timeDelta;
    const iv = stepInterval();
    while (acc >= iv && state === 'playing') { acc -= iv; step(); }
  }

  function gameUpdatePost() {
    const s = shake * shake * 0.35;
    setCameraPos(vec2(N / 2 + (Math.random() * 2 - 1) * s, N / 2 + (Math.random() * 2 - 1) * s));
  }

  const cell = p => vec2(p.x + 0.5, p.y + 0.5);
  const mix = (a, b, f) => a + (b - a) * f;

  function gameRender() {
    if (!onScreen) return;

    // checkerboard
    for (let x = 0; x < N; x++)
      for (let y = 0; y < N; y++)
        if ((x + y) & 1) drawRect(vec2(x + 0.5, y + 0.5), vec2(1), colors.check);

    // food: pops in, then breathes
    const fp = cell(food);
    const age = clamp01((clock - foodBorn) / 0.35);
    const pop = 1 + 2.2 * Math.pow(age - 1, 3) + 1.2 * Math.pow(age - 1, 2);   // ease-out-back
    const size = pop * (1 + Math.sin(clock * 5) * 0.05);
    drawCircle(fp, 0.98 * size, colors.halo);
    drawCircle(fp, 0.62 * size, colors.food);
    drawCircle(fp.add(vec2(-0.1, 0.12)), 0.16 * size, colors.shine);

    for (const p of particles)
      drawCircle(vec2(p.x, p.y), 0.22 * (p.life / p.max), colors.food.scale(1, p.life / p.max));

    // snake: a rounded tube through the eased head, every joint, and the eased tail
    const f = state === 'playing' ? clamp01(acc / stepInterval()) : 1;
    const n = snake.length;
    const at = k => vec2(mix(prev[k].x, snake[k].x, f) + 0.5, mix(prev[k].y, snake[k].y, f) + 0.5);
    const pts = [at(0)];
    for (let k = 1; k < n; k++) pts.push(cell(snake[k]));
    pts.push(at(n - 1));

    const dead = state === 'over' ? clamp01((clock - deadAt) / 0.5) : 0;
    const W = 0.74;
    for (let i = pts.length - 1; i > 0; i--) {
      const a = pts[i - 1], b = pts[i], u = i / (pts.length - 1);
      const w = W * (1 - 0.28 * u);
      const c = colors.head.lerp(colors.tail, u).lerp(colors.dead, dead);
      const dx = Math.abs(b.x - a.x), dy = Math.abs(b.y - a.y);
      if (dx > 1e-3 || dy > 1e-3)
        drawRect(a.add(b).scale(0.5), dx > dy ? vec2(dx, w) : vec2(w, dy), c);
      drawCircle(b, w, c);
    }

    // head and eyes
    const head = pts[0];
    drawCircle(head, W * 1.1, colors.head.lerp(colors.dead, dead * 0.6));
    const d = vec2(dir.x, dir.y), side = vec2(-dir.y, dir.x);
    for (const sgn of [-1, 1]) {
      const e = head.add(d.scale(0.12)).add(side.scale(0.19 * sgn));
      drawCircle(e, 0.24, colors.eye);
      drawCircle(e.add(d.scale(0.05)), dead ? 0.06 : 0.12, colors.pupil);
    }
  }

  // ------------------------------------------------------------ overlay & input
  function showOverlay(msg, label, delay = 0) {
    msgEl.textContent = msg;
    btn.textContent = label;
    btn.disabled = false;
    wrap.style.setProperty('--overlay-delay', delay + 's');
    wrap.classList.remove('is-playing');
  }
  function hideOverlay() {
    wrap.style.setProperty('--overlay-delay', '0s');
    wrap.classList.add('is-playing');
    btn.blur();
  }
  function setTouchPlaying(on) { wrap.style.touchAction = on ? 'none' : ''; }

  btn.addEventListener('click', start);

  addEventListener('keydown', e => {
    if (e.ctrlKey || e.metaKey || e.altKey || state === 'loading') return;
    const t = e.target;
    if (t && t.closest && t.closest('input,textarea,select,[contenteditable],form')) return;
    const code = e.code;
    if (state === 'playing') {
      // claim steering keys so the page doesn't scroll under the game
      if (code.startsWith('Arrow') || ['KeyW', 'KeyA', 'KeyS', 'KeyD', 'Space'].includes(code)) e.preventDefault();
      if (code === 'Space' || code === 'KeyP' || code === 'Escape') pause();
    } else if (revealed && ['Enter', 'NumpadEnter', 'Space', 'ArrowLeft', 'ArrowRight', 'KeyW', 'KeyA', 'KeyS', 'KeyD'].includes(code)) {
      // up/down arrows still scroll the page while the game waits
      e.preventDefault();
      start();
    }
  }, true);

  // swipe to steer on touch screens
  let swipe = null;
  wrap.addEventListener('pointerdown', e => {
    if (e.pointerType !== 'mouse') swipe = { id: e.pointerId, x: e.clientX, y: e.clientY };
  });
  wrap.addEventListener('pointermove', e => {
    if (!swipe || e.pointerId !== swipe.id || state !== 'playing') return;
    const dx = e.clientX - swipe.x, dy = e.clientY - swipe.y;
    if (Math.hypot(dx, dy) < 22) return;
    Math.abs(dx) > Math.abs(dy) ? turn(Math.sign(dx), 0) : turn(0, -Math.sign(dy));
    swipe.x = e.clientX; swipe.y = e.clientY;
  });
  const endSwipe = () => { swipe = null; };
  wrap.addEventListener('pointerup', endSwipe);
  wrap.addEventListener('pointercancel', endSwipe);

  // pause when the board scrolls away or the tab is hidden
  if ('IntersectionObserver' in window)
    new IntersectionObserver(([en]) => {
      onScreen = en.isIntersecting;
      if (en.intersectionRatio < 0.5) pause();
    }, { threshold: [0, 0.5] }).observe(wrap);
  else onScreen = true;
  document.addEventListener('visibilitychange', () => { if (document.hidden) pause(); });
})();
