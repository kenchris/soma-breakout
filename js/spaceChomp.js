// === spaceChomp.js ===
// --- Space Chomp levels ---
// A maze level type after the arcade maze games, with the ball as the steering wheel. A round yellow chomper
// lives in a neon maze full of dots, and only the chomper eats them: clear every dot to finish the level.
// The maze only steers the chomper and the ghosts; the ball flies straight over its walls. Hit the chomper
// and it zooms off the way the ball was going, eating as it runs, until a wall stops it; left alone it
// wanders its slow, ghost-wary way to the nearest dot, so it never gets stuck. Four ghosts hunt it. A ghost
// that catches it sends it home and knocks a couple of dots back into the maze, so bop ghosts with the ball
// to keep them off it (a bopped ghost goes back to its pen for a while). The ghosts also swoop out at your
// paddle and bite holes in it, like the aliens do. And the four power pellets turn the tables: for a few
// seconds the ghosts turn blue and run, and the chomper (or the ball) can eat them, for 200 to 1600 points.

const MAZE_UNLOCK = 14;           // curve level of the first one (level 19), then about 1 level in 7
const MAZE_CELL = 36;
// # wall, . dot, o power pellet, G the ghosts' pen, M where the chomper starts (no dot)
const MAZE_ART = [
    'o.........#.#.........o',
    '.##.###.#.....#.###.##.',
    '.....#...#GGG#...#.....',
    '..#...#..#####..#...#..',
    '.#.#...#.......#...#.#.',
    '.#.###.#.#.#.#.#.###.#.',
    'o..........M..........o'
];
const MAZE_COLS = MAZE_ART[0].length;
const MAZE_ROWS = MAZE_ART.length;
const MAZE_LEFT = (CANVAS_W - MAZE_COLS * MAZE_CELL) / 2;
const MAZE_TOP = 74;
const MAZE_PEN = { c: 11, r: 2 };         // the ghosts' pen, in the middle
const MAZE_DOOR = { c: 11, r: 1 };        // the open cell above it they leave by
const CHOMPER_HOME = { c: 11, r: 6 };
const GHOST_R = 14;
const CHOMPER_R = 12;
const CHOMPER_SNIFF_SPEED = 1.15;   // px per step, left to its own devices
const CHOMPER_ZOOM_SPEED = 3.4;     // px per step, after the ball sends it off
const CHOMPER_CAUGHT_DROP = 2;      // dots a caught chomper knocks loose
// The four space ghosts (see ghostTarget for what each one is after)
const GHOST_DEFS = [
    { role: 'chaser', color: '#ff3b5c', release: 60 * 2 },
    { role: 'ambusher', color: '#ff9ae8', release: 60 * 5 },
    { role: 'patroller', color: '#3de0ff', release: 60 * 8 },
    { role: 'shy', color: '#ffb852', release: 60 * 11 }
];
const DIRS = [[1, 0], [-1, 0], [0, 1], [0, -1]];
const mazeLevelCache = {};

let maze = null; // { dots[r][c]: 0 none, 1 dot, 2 power pellet; chomper, ghosts, fright, eaten, diveIn, powerIn, t }
let mazeDiveTipShown = false;
let mazeCatchTipShown = false;

function isMazeLevel(l) {
    if (isTutorial(l) || isBossLevel(l) || curveLevel(l) < MAZE_UNLOCK) return false;
    if (mazeLevelCache[l] === undefined) {
        mazeLevelCache[l] = curveLevel(l) === MAZE_UNLOCK || (seededRandom(l * 9161 + 53)() < 0.15 && !isMazeLevel(l - 1));
    }
    return mazeLevelCache[l];
}

function mazeWall(c, r) {
    return r >= 0 && r < MAZE_ROWS && c >= 0 && c < MAZE_COLS && MAZE_ART[r][c] === '#';
}

function mazeCellX(c) { return MAZE_LEFT + c * MAZE_CELL; }
function mazeCellY(r) { return MAZE_TOP + r * MAZE_CELL; }
function mazeCenter(c, r) { return { x: mazeCellX(c) + MAZE_CELL / 2, y: mazeCellY(r) + MAZE_CELL / 2 }; }

// Cells a ghost or the chomper may walk: inside the grid, not a wall, and the pen only for ghosts allowed in
function mazeOpen(c, r, podOk) {
    if (c < 0 || c >= MAZE_COLS || r < 0 || r >= MAZE_ROWS) return false;
    const ch = MAZE_ART[r][c];
    return ch !== '#' && (podOk || ch !== 'G');
}

// The cell nearest to a point (clamped into the grid)
function mazeCellAt(x, y) {
    return {
        c: Math.max(0, Math.min(MAZE_COLS - 1, Math.floor((x - MAZE_LEFT) / MAZE_CELL))),
        r: Math.max(0, Math.min(MAZE_ROWS - 1, Math.floor((y - MAZE_TOP) / MAZE_CELL)))
    };
}

function ghostHome(i) {
    return mazeCenter(MAZE_PEN.c - 1 + (i % 3), MAZE_PEN.r);
}

function buildMaze() {
    const dots = MAZE_ART.map(row => [...row].map(ch => (ch === '.' ? 1 : ch === 'o' ? 2 : 0)));
    const n = curveLevel();
    const home = mazeCenter(CHOMPER_HOME.c, CHOMPER_HOME.r);
    maze = {
        dots, t: 0, fright: 0, eaten: 0, powerIn: 0, diveIn: 60 * 9,
        chomper: { x: home.x, y: home.y, c: CHOMPER_HOME.c, r: CHOMPER_HOME.r, tc: CHOMPER_HOME.c, tr: CHOMPER_HOME.r, dir: [0, -1], zoom: false, face: 1, hitCool: 0, safe: 0, munch: 0 },
        ghosts: GHOST_DEFS.map((def, i) => {
            const h = ghostHome(i);
            return { ...def, i, x: h.x, y: h.y, c: MAZE_PEN.c, r: MAZE_PEN.r, tc: MAZE_PEN.c, tr: MAZE_PEN.r, dir: [0, -1], mode: 'pen', penT: def.release, vy: 0, warn: 0 };
        }),
        speed: Math.min(0.75 + 0.02 * n, 1.1) // always a touch slower than the chomper: they win by cornering it
    };
    return mazeDotCount();
}

function mazeDotCount() {
    let n = 0;
    for (const row of maze.dots) for (const d of row) if (d) n++;
    return n;
}

// Move toward the centre of cell (tc, tr) by `move` px; true on arrival (leftover movement is dropped)
function stepToCell(o, move) {
    const t = mazeCenter(o.tc, o.tr);
    const d = Math.hypot(t.x - o.x, t.y - o.y);
    if (d > move) {
        o.x += (t.x - o.x) / d * move;
        o.y += (t.y - o.y) / d * move;
        return false;
    }
    o.x = t.x;
    o.y = t.y;
    o.c = o.tc;
    o.r = o.tr;
    return true;
}

// --- The chomper ---
// The first step of the shortest path from (c, r) to the nearest dot, or null if there is none. It's a
// wary chomper: it plans around the cells hungry ghosts are in or about to be in, unless that leaves no way.
function stepTowardDot(c, r) {
    const danger = new Set();
    for (const ghost of maze.ghosts) {
        if (ghost.mode !== 'chase') continue;
        danger.add(ghost.c * 16 + ghost.r);
        danger.add(ghost.tc * 16 + ghost.tr);
    }
    return dotPath(c, r, danger) || dotPath(c, r, new Set());
}

function dotPath(c, r, avoid) {
    const seen = new Set([c * 16 + r]);
    const queue = [[c, r, null]];
    for (let i = 0; i < queue.length; i++) {
        const [qc, qr, first] = queue[i];
        if (first && maze.dots[qr][qc]) return first;
        for (const d of DIRS) {
            const nc = qc + d[0], nr = qr + d[1];
            if (!mazeOpen(nc, nr, false) || seen.has(nc * 16 + nr) || avoid.has(nc * 16 + nr)) continue;
            seen.add(nc * 16 + nr);
            queue.push([nc, nr, first || d]);
        }
    }
    return null;
}

function chomperEat() {
    const m = maze.chomper;
    const kind = maze.dots[m.r][m.c];
    if (!kind) return;
    maze.dots[m.r][m.c] = 0;
    m.munch = 10;
    bricksLeft--;
    runStats.bricks++;
    combo++;
    runStats.maxCombo = Math.max(runStats.maxCombo, combo);
    const mult = Math.min(combo, COMBO_MAX) * (doubleTimer > 0 ? 2 : 1);
    addScore((kind === 2 ? 50 : 10) * mult);
    maze.nibble = !maze.nibble; // a squeaky two-note nibble
    tone(maze.nibble ? 1320 : 1560, 0.04, { type: 'triangle', vol: 0.1, key: 'nibble' });
    if (kind === 2) {
        addPopup(m.x, m.y - 18, 'POWER!', '#ffffff', { size: 18, life: 1, pop: true });
        spawnParticles(m.x, m.y, '#ffb8ae', 10);
        scareGhosts();
    }
    if (combo >= 3 && combo <= COMBO_MAX && combo !== maze.lastShout) {
        maze.lastShout = combo;
        comboShout(combo, m.x, m.y);
    }
    if (bricksLeft <= 0) {
        noteMoment(60, 'MAZE CLEARED!');
        completeLevel();
    }
}

function updateChomper() {
    const m = maze.chomper;
    if (m.hitCool > 0) m.hitCool--;
    if (m.safe > 0) m.safe--;
    if (m.munch > 0) m.munch--;
    const speed = (m.zoom ? CHOMPER_ZOOM_SPEED : CHOMPER_SNIFF_SPEED) * timeScale;
    if (!stepToCell(m, speed)) return;
    chomperEat();
    if (gameState !== 'playing' || !maze) return;
    // At a cell centre: zooming, it carries straight on while it can; otherwise it heads for the nearest dot
    if (m.zoom && mazeOpen(m.c + m.dir[0], m.r + m.dir[1], false)) {
        m.tc = m.c + m.dir[0];
        m.tr = m.r + m.dir[1];
        return;
    }
    if (m.zoom) {
        m.zoom = false; // bonk: the wall stops it
        beep(700, 'chomperBonk');
    }
    const d = stepTowardDot(m.c, m.r);
    if (!d) return;
    m.dir = d;
    if (d[0]) m.face = d[0];
    m.tc = m.c + d[0];
    m.tr = m.r + d[1];
}

// The ball sends the chomper zooming off the way the ball was travelling (along whichever axis it was
// travelling more), or along the other axis if that way is a wall
function pushChomper(b) {
    const m = maze.chomper;
    const here = mazeCellAt(m.x, m.y);
    const main = Math.abs(b.vx) > Math.abs(b.vy) ? [Math.sign(b.vx), 0] : [0, Math.sign(b.vy)];
    const other = main[0] ? [0, Math.sign(b.vy) || -1] : [Math.sign(b.vx) || 1, 0];
    const dir = [main, other, [-other[0], -other[1]]].find(d => mazeOpen(here.c + d[0], here.r + d[1], false));
    if (!dir) return;
    m.c = here.c;
    m.r = here.r;
    m.dir = dir;
    if (dir[0]) m.face = dir[0];
    m.tc = here.c + dir[0];
    m.tr = here.r + dir[1];
    m.zoom = true;
    tone(900, 0.12, { type: 'triangle', vol: 0.16, slideTo: 1500, key: 'chomperZoom' });
    spawnParticles(m.x, m.y, '#dfe3ff', 5);
    haptic(10);
}

// A ghost got the chomper: it's whisked home, and a couple of dots tumble back into the maze
function catchChomper(ghost) {
    const m = maze.chomper;
    const home = mazeCenter(CHOMPER_HOME.c, CHOMPER_HOME.r);
    spawnParticles(m.x, m.y, '#ffe14d', 12);
    addPopup(m.x, m.y - 20, 'CAUGHT!', '#ff5a7a', { size: 20, life: 1.2, pop: true });
    tone(600, 0.35, { type: 'sawtooth', vol: 0.2, slideTo: 150, key: 'chomperCaught', force: true });
    addShake(5);
    haptic([30, 30, 50], true);
    Object.assign(m, { x: home.x, y: home.y, c: CHOMPER_HOME.c, r: CHOMPER_HOME.r, tc: CHOMPER_HOME.c, tr: CHOMPER_HOME.r, zoom: false, safe: 180 });
    // Knocked-loose dots land on empty cells
    const empty = [];
    maze.dots.forEach((row, r) => row.forEach((k, c) => { if (!k && MAZE_ART[r][c] !== '#' && MAZE_ART[r][c] !== 'G' && !(c === m.c && r === m.r)) empty.push([c, r]); }));
    for (let i = 0; i < CHOMPER_CAUGHT_DROP && empty.length; i++) {
        const [c, r] = empty.splice(Math.floor(Math.random() * empty.length), 1)[0];
        maze.dots[r][c] = 1;
        bricksLeft++;
    }
    levelBricksTotal = Math.max(levelBricksTotal, bricksLeft);
    ghostGoHome(ghost, 60 * 3); // the ghost's had its fun
    if (!mazeCatchTipShown) {
        mazeCatchTipShown = true;
        addPopup(CANVAS_W / 2, 410, 'BOP THE GHOSTS WITH THE BALL TO PROTECT THE CHOMPER!', '#ffffff', { size: 18, life: 2.6, rise: 0.15, pop: true });
    }
}

// --- Ghost brains ---
// Where each ghost is heading when it isn't scared: the red chaser goes straight for the chomper, the pink
// ambusher for where the chomper is going, the cyan patroller keeps to the bottom row above your paddle (it
// does most of the swooping), and the orange shy one stalks the chomper until it's close, then loses its
// nerve and wanders off to a corner.
function ghostTarget(ghost) {
    const m = maze.chomper;
    if (ghost.i === 0) return { x: m.x, y: m.y };
    if (ghost.i === 1) return { x: m.x + m.dir[0] * MAZE_CELL * 3, y: m.y + m.dir[1] * MAZE_CELL * 3 };
    if (ghost.i === 2) return { x: paddle.x + paddle.w / 2, y: mazeCenter(0, MAZE_ROWS - 1).y };
    const d = Math.hypot(ghost.x - m.x, ghost.y - m.y);
    return d > MAZE_CELL * 5 ? { x: m.x, y: m.y } : { x: mazeCellX(0), y: mazeCellY(0) };
}

// At a cell centre: pick the next cell. No turning back unless it's a dead end.
function ghostChooseDir(ghost) {
    const podOk = ghost.mode === 'leave';
    const fits = ([dx, dy]) => mazeOpen(ghost.c + dx, ghost.r + dy, podOk);
    let options = DIRS.filter(d => fits(d) && !(d[0] === -ghost.dir[0] && d[1] === -ghost.dir[1]));
    if (!options.length) options = DIRS.filter(fits);
    if (!options.length) return;
    let pick;
    if (ghost.mode === 'fright') {
        pick = options[Math.floor(Math.random() * options.length)];
    } else {
        const t = ghost.mode === 'leave' ? mazeCenter(MAZE_DOOR.c, MAZE_DOOR.r - 1) : ghostTarget(ghost);
        let best = Infinity;
        for (const d of options) {
            const p = mazeCenter(ghost.c + d[0], ghost.r + d[1]);
            const dist = Math.hypot(p.x - t.x, p.y - t.y);
            if (dist < best) {
                best = dist;
                pick = d;
            }
        }
    }
    ghost.dir = pick;
    ghost.tc = ghost.c + pick[0];
    ghost.tr = ghost.r + pick[1];
}

function ghostSpeed(ghost) {
    const base = maze.speed * timeScale;
    if (ghost.mode === 'fright') return base * 0.55;
    if (ghost.mode === 'home') return 4.5 * timeScale;
    if (ghost.mode === 'dive') return (2.4 + 0.04 * curveLevel()) * timeScale;
    if (ghost.mode === 'rise') return 3 * timeScale;
    return base * (ghost.i === 0 && bricksLeft < levelBricksTotal * 0.3 ? 1.2 : 1); // the chaser gets keener near the end
}

// Fly straight at a point; true on arrival
function flyTo(o, x, y, speed) {
    const d = Math.hypot(x - o.x, y - o.y);
    if (d <= speed) {
        o.x = x;
        o.y = y;
        return true;
    }
    o.x += (x - o.x) / d * speed;
    o.y += (y - o.y) / d * speed;
    return false;
}

function ghostGoHome(ghost, penFrames) {
    ghost.mode = 'home';
    ghost.scared = false;
    ghost.penT = penFrames;
}

// Back into the maze after a swoop: the nearest bottom-row cell, and on with the hunt from there
function rejoinMaze(ghost) {
    ghost.c = ghost.tc = mazeCellAt(ghost.x, 0).c;
    ghost.r = ghost.tr = MAZE_ROWS - 1;
    ghost.dir = [0, -1];
    ghost.mode = maze.fright > 0 ? 'fright' : 'chase';
    ghost.scared = false;
}

function startDive(ghost) {
    ghost.mode = 'dive';
    ghost.warn = 40; // it crouches and wiggles first, so you see it coming
    ghost.aimX = paddle.x + paddle.w / 2;
    ghost.vy = 0;
    tone(520, 0.3, { type: 'sawtooth', vol: 0.16, slideTo: 180, key: 'ghostPounce' });
    if (!mazeDiveTipShown) {
        mazeDiveTipShown = true;
        addPopup(CANVAS_W / 2, 400, 'A GHOST IS SWOOPING AT YOUR PADDLE: HIT IT!', '#ffffff', { size: 18, life: 2.4, rise: 0.15, pop: true });
    }
}

function updateGhost(ghost) {
    if (ghost.mode === 'pen') {
        ghost.y = ghostHome(ghost.i).y + Math.sin(maze.t / 8 + ghost.i) * 3; // bobbing in the pen
        if (--ghost.penT <= 0) {
            const h = mazeCenter(MAZE_PEN.c, MAZE_PEN.r);
            Object.assign(ghost, { mode: 'leave', x: h.x, y: h.y, c: MAZE_PEN.c, r: MAZE_PEN.r, tc: MAZE_PEN.c, tr: MAZE_PEN.r, dir: [0, -1] });
            ghostChooseDir(ghost);
        }
        return;
    }
    if (ghost.mode === 'home') {
        const h = ghostHome(ghost.i);
        if (flyTo(ghost, h.x, h.y, ghostSpeed(ghost))) ghost.mode = 'pen';
        return;
    }
    if (ghost.mode === 'dive') {
        if (ghost.warn > 0) {
            ghost.warn--;
            return;
        }
        // Pounces down at where the paddle was, weaving a little and homing in gently
        ghost.aimX += Math.sign(paddle.x + paddle.w / 2 - ghost.aimX) * 0.8 * timeScale;
        ghost.vy = Math.min(ghost.vy + 0.12 * timeScale, ghostSpeed(ghost));
        ghost.y += ghost.vy * timeScale;
        ghost.x += (ghost.aimX + Math.sin(maze.t / 9) * 26 - ghost.x) * 0.06 * timeScale;
        if (ghost.y > paddle.y - GHOST_R && ghost.y < paddle.y + paddle.h + GHOST_R) {
            const hit = paddleHit(ghost.x, ghost.y, GHOST_R);
            if (hit) {
                if (hit.mirror) blockMirrorBolt(ghost.x);
                else punchHole(ghost.x, BOSS_HOLE_SECONDS);
                ghost.mode = 'rise';
            }
        }
        if (ghost.y > paddle.y + 40) ghost.mode = 'rise';
        return;
    }
    if (ghost.mode === 'rise') {
        const x = Math.max(mazeCenter(0, 0).x, Math.min(mazeCenter(MAZE_COLS - 1, 0).x, ghost.x));
        if (flyTo(ghost, mazeCenter(mazeCellAt(x, 0).c, 0).x, mazeCenter(0, MAZE_ROWS - 1).y, ghostSpeed(ghost))) rejoinMaze(ghost);
        return;
    }
    let move = ghostSpeed(ghost);
    if (stepToCell(ghost, move)) {
        if (ghost.mode === 'leave' && ghost.c === MAZE_DOOR.c && ghost.r === MAZE_DOOR.r) ghost.mode = maze.fright > 0 ? 'fright' : 'chase';
        ghostChooseDir(ghost);
    }
}

function scareGhosts() {
    maze.fright = Math.max(60 * 4, 60 * 7 - 6 * curveLevel());
    maze.eaten = 0;
    maze.powerIn = 60 * 18;
    for (const ghost of maze.ghosts) {
        if (ghost.mode === 'chase') {
            ghost.mode = 'fright';
            ghost.dir = [-ghost.dir[0], -ghost.dir[1]]; // they turn tail
            if (mazeOpen(ghost.c + ghost.dir[0], ghost.r + ghost.dir[1], false)) {
                ghost.tc = ghost.c + ghost.dir[0];
                ghost.tr = ghost.r + ghost.dir[1];
            }
        } else if (ghost.mode === 'dive') {
            ghost.mode = 'rise'; // a swooping ghost bolts back for the maze
            ghost.scared = true;
        }
    }
    tone(180, 0.5, { type: 'triangle', vol: 0.2, slideTo: 90, key: 'fright', force: true });
}

function ghostScared(ghost) {
    return ghost.mode === 'fright' || (ghost.mode === 'rise' && ghost.scared);
}

// A scared ghost caught by the chomper or the ball
function eatGhost(ghost) {
    const pts = 200 * Math.pow(2, Math.min(maze.eaten, 3)) * (doubleTimer > 0 ? 2 : 1);
    maze.eaten++;
    ghostGoHome(ghost, 60 * 4);
    addScore(pts);
    addPopup(ghost.x, ghost.y - 14, '' + pts, '#3de0ff', { size: 20, life: 1.1, pop: true });
    if (maze.eaten === 4) noteMoment(70, 'ALL FOUR CATS!');
    spawnParticles(ghost.x, ghost.y, '#9aa6ff', 12);
    tone(1200, 0.25, { type: 'square', vol: 0.18, slideTo: 300, key: 'eatGhost', force: true });
    addShake(4);
    haptic([15, 20, 25], true);
    if (Math.random() < 0.35) spawnPowerup(ghost.x, ghost.y);
}

function updateMaze() {
    if (!maze) return;
    maze.t++;
    if (maze.fright > 0 && --maze.fright === 0) {
        for (const ghost of maze.ghosts) if (ghost.mode === 'fright') ghost.mode = 'chase';
    }
    updateChomper();
    if (!maze || gameState !== 'playing') return;
    // Every so often a ghost on the bottom row (never a scared one) swoops at the paddle
    if (--maze.diveIn <= 0) {
        const bottom = maze.ghosts.filter(ghost => ghost.mode === 'chase' && ghost.r === MAZE_ROWS - 1);
        if (bottom.length) {
            startDive(bottom[Math.floor(Math.random() * bottom.length)]);
            maze.diveIn = Math.round(60 * Math.max(4, 10 - 0.15 * curveLevel()) * (0.8 + Math.random() * 0.4));
        } else {
            maze.diveIn = 30;
        }
    }
    // With every power pellet gone, a new one turns up now and then, so the ghosts can always be turned
    if (!maze.dots.some(row => row.includes(2)) && --maze.powerIn <= 0) {
        const free = [];
        maze.dots.forEach((row, r) => row.forEach((k, c) => { if (!k && MAZE_ART[r][c] !== '#' && MAZE_ART[r][c] !== 'G') free.push([c, r]); }));
        if (free.length) {
            const [c, r] = free[Math.floor(Math.random() * free.length)];
            maze.dots[r][c] = 2;
            bricksLeft++;
            levelBricksTotal++;
        }
        maze.powerIn = 60 * 18;
    }
    const m = maze.chomper;
    for (const ghost of maze.ghosts) {
        updateGhost(ghost);
        // Ghost meets chomper: a hungry ghost catches it, a scared one gets chased off by it
        if (ghost.mode !== 'chase' && ghost.mode !== 'fright') continue;
        if (Math.hypot(ghost.x - m.x, ghost.y - m.y) > GHOST_R + CHOMPER_R - 4) continue;
        if (ghost.mode === 'fright') eatGhost(ghost);
        else if (m.safe <= 0) catchChomper(ghost);
    }
}

// --- The ball in the maze ---
function mazeBallCollision(b) {
    if (!maze) return;
    // (The walls only steer the chomper and the ghosts: the ball flies straight over them)
    // The chomper: send it zooming off the way the ball was going
    const m = maze.chomper;
    if (m.hitCool <= 0 && Math.hypot(b.x - m.x, b.y - m.y) < b.r + CHOMPER_R) {
        m.hitCool = 12;
        pushChomper(b); // (the ball's heading before it bounces off decides where the chomper goes)
        bounceOffCircle(b, m.x, m.y, CHOMPER_R);
    }
    // Ghosts
    for (const ghost of maze.ghosts) {
        if (ghost.mode === 'home' || ghost.mode === 'pen') continue;
        const dx = b.x - ghost.x, dy = b.y - ghost.y;
        if (dx * dx + dy * dy >= (b.r + GHOST_R) * (b.r + GHOST_R)) continue;
        bounceOffCircle(b, ghost.x, ghost.y, GHOST_R);
        if (ghostScared(ghost) || fireTimer > 0) {
            eatGhost(ghost);
        } else {
            // Bopped: back to its pen for a while
            ghostGoHome(ghost, 60 * 3);
            const pts = (ghost.mode === 'dive' || ghost.mode === 'rise' ? 200 : 100) * (doubleTimer > 0 ? 2 : 1);
            addScore(pts);
            addPopup(ghost.x, ghost.y - 18, 'BOP! +' + pts, ghost.color, { size: 18, life: 1, pop: true });
            spawnParticles(ghost.x, ghost.y, ghost.color, 10);
            tone(880, 0.12, { type: 'square', vol: 0.18, slideTo: 440, key: 'ghostBop' });
            addShake(3);
            haptic(15);
        }
        return;
    }
}

// A lost ball: the ghosts go back to their pen and start over
function mazeBreather() {
    if (!maze) return;
    maze.fright = 0;
    maze.diveIn = 60 * 7;
    maze.ghosts.forEach((ghost, i) => {
        const h = ghostHome(i);
        Object.assign(ghost, { x: h.x, y: h.y, mode: 'pen', penT: GHOST_DEFS[i].release, scared: false, warn: 0 });
    });
}

// Guided ball: go for the chomper, or a scared ghost (the ball flies over the walls, so nothing blocks a shot)
function bestAimMaze(x, y) {
    const speed = currentSpeed();
    let best = null, bestV = 0;
    const m = maze.chomper;
    for (let deg = -70; deg <= 70; deg += 5) {
        const a = (deg * Math.PI) / 180;
        let dx = Math.sin(a);
        const dy = -Math.cos(a);
        let px = x, py = y, v = 0;
        for (let i = 0; i < 170 && !v; i++) {
            px += dx * 5;
            py += dy * 5;
            if (px < BALL_RADIUS || px > CANVAS_W - BALL_RADIUS) dx = -dx;
            if (py < 0) break;
            if (Math.hypot(m.x - px, m.y - py) < CHOMPER_R + BALL_RADIUS) v = 10;
            for (const ghost of maze.ghosts) if (Math.hypot(ghost.x - px, ghost.y - py) < GHOST_R + BALL_RADIUS) v = Math.max(v, ghostScared(ghost) ? 12 : 6);
        }
        v *= 1 - Math.abs(deg) / 400;
        if (v > bestV) {
            bestV = v;
            best = { vx: Math.sin(a) * speed, vy: dy * speed };
        }
    }
    return best;
}

// --- Drawing ---
let mazeLayer = null;

// The walls, painted once as thin double neon-blue outlines round each run of wall, like the arcade's (no
// fill: they're lines the chomper can't cross, not blocks, and the ball flies over them)
function paintMaze(g) {
    const S = MAZE_CELL;
    for (const [inset, color, width] of [[6, '#2d4dff', 2.5], [11, '#2d4dff', 1.2]]) {
        g.strokeStyle = color;
        g.lineWidth = width;
        g.lineCap = 'round';
        g.beginPath();
        for (let r = 0; r < MAZE_ROWS; r++) {
            for (let c = 0; c < MAZE_COLS; c++) {
                if (!mazeWall(c, r)) continue;
                const x = mazeCellX(c), y = mazeCellY(r);
                if (!mazeWall(c, r - 1)) { g.moveTo(x + (mazeWall(c - 1, r) ? 0 : inset), y + inset); g.lineTo(x + S - (mazeWall(c + 1, r) ? 0 : inset), y + inset); }
                if (!mazeWall(c, r + 1)) { g.moveTo(x + (mazeWall(c - 1, r) ? 0 : inset), y + S - inset); g.lineTo(x + S - (mazeWall(c + 1, r) ? 0 : inset), y + S - inset); }
                if (!mazeWall(c - 1, r)) { g.moveTo(x + inset, y + (mazeWall(c, r - 1) ? 0 : inset)); g.lineTo(x + inset, y + S - (mazeWall(c, r + 1) ? 0 : inset)); }
                if (!mazeWall(c + 1, r)) { g.moveTo(x + S - inset, y + (mazeWall(c, r - 1) ? 0 : inset)); g.lineTo(x + S - inset, y + S - (mazeWall(c, r + 1) ? 0 : inset)); }
            }
        }
        g.stroke();
    }
    // The pen's door
    const d = mazeCenter(MAZE_PEN.c, MAZE_PEN.r);
    g.fillStyle = '#ffb8ff';
    g.fillRect(d.x - MAZE_CELL * 1.5 + 6, mazeCellY(MAZE_PEN.r) + 4, MAZE_CELL * 3 - 12, 3);
}

// A ghost's body, per colour and animation frame: a round dome, soft sides and a skirt of three rounded
// scallops that ripple between two frames. Painted once each. No mouth: just the big eyes, drawn live.
const ghostBodies = {};

function ghostBody(color, frame) {
    const key = color + frame;
    if (!ghostBodies[key]) {
        const S = GHOST_R * 2 + 4;
        ghostBodies[key] = makeSprite(S, S, g => {
            const R = GHOST_R, cx = S / 2, cy = S / 2 - 1;
            const bottom = cy + R;
            g.fillStyle = color;
            g.beginPath();
            g.arc(cx, cy, R, Math.PI, 0);
            g.lineTo(cx + R, bottom - 3);
            const n = 3, w = (2 * R) / n, shift = frame ? w / 2 : 0;
            for (let i = 0; i <= n; i++) {
                const x = cx + R - i * w + shift;
                const xc = Math.max(cx - R, Math.min(cx + R, x - w / 2));
                g.quadraticCurveTo(Math.max(cx - R, Math.min(cx + R, x)), bottom + 2, xc, bottom - 3);
            }
            g.lineTo(cx - R, bottom - 3);
            g.closePath();
            g.fill();
            g.fillStyle = 'rgba(255, 255, 255, 0.25)'; // a soft sheen on the dome
            g.beginPath();
            g.ellipse(cx - R * 0.35, cy - R * 0.45, R * 0.28, R * 0.18, -0.5, 0, Math.PI * 2);
            g.fill();
        });
    }
    return ghostBodies[key];
}

// Big round eyes, pupils looking the way it's going
function drawGhostEyes(x, y, dir) {
    for (const s of [-1, 1]) {
        const ex = x + s * 5.5, ey = y - 3;
        ctx.fillStyle = '#ffffff';
        ctx.beginPath();
        ctx.ellipse(ex, ey, 4.5, 5.5, 0, 0, Math.PI * 2);
        ctx.fill();
        ctx.fillStyle = '#1b2cff';
        ctx.beginPath();
        ctx.arc(ex + dir[0] * 2, ey + dir[1] * 2.5, 2.6, 0, Math.PI * 2);
        ctx.fill();
    }
}

// The chomper: a yellow disc with a wedge mouth that opens and closes as it goes, facing its way. Our own
// twist: a little antenna with a glowing tip, bobbing on top.
function drawChomper(m) {
    if (m.safe > 0 && Math.floor(m.safe / 6) % 2 === 0) return; // blinking while it's safe, just home
    const R = CHOMPER_R + 2;
    const heading = Math.atan2(m.dir[1], m.dir[0]);
    const open = (0.08 + 0.3 * Math.abs(Math.sin(maze.t / (m.zoom ? 2.5 : 4)))) * Math.PI;
    ctx.save();
    ctx.translate(m.x, m.y);
    if (m.zoom) { // speed lines behind it
        ctx.strokeStyle = 'rgba(255, 255, 255, 0.5)';
        ctx.lineWidth = 1.5;
        ctx.beginPath();
        for (const off of [-6, 0, 6]) {
            ctx.moveTo(-m.dir[0] * (R + 3) + (m.dir[1] ? off : 0), -m.dir[1] * (R + 3) + (m.dir[0] ? off : 0));
            ctx.lineTo(-m.dir[0] * (R + 15) + (m.dir[1] ? off : 0), -m.dir[1] * (R + 15) + (m.dir[0] ? off : 0));
        }
        ctx.stroke();
    }
    // Antenna, always on top whichever way it faces
    const bob = Math.sin(maze.t / 7) * 2;
    ctx.strokeStyle = '#c9a0ff';
    ctx.lineWidth = 1.5;
    ctx.beginPath();
    ctx.moveTo(0, -R + 2);
    ctx.lineTo(3, -R - 7 + bob);
    ctx.stroke();
    ctx.fillStyle = '#ff2fb4';
    ctx.beginPath();
    ctx.arc(3, -R - 8 + bob, 2.6, 0, Math.PI * 2);
    ctx.fill();
    // Body with the mouth cut out
    ctx.rotate(heading);
    ctx.fillStyle = '#ffe14d';
    ctx.beginPath();
    ctx.moveTo(0, 0);
    ctx.arc(0, 0, R, open, Math.PI * 2 - open);
    ctx.closePath();
    ctx.fill();
    // Its eye, kept on the upper side whichever way it's facing
    const up = Math.abs(heading) > Math.PI / 2 ? 1 : -1;
    ctx.fillStyle = '#1a1030';
    ctx.beginPath();
    ctx.arc(2, up * R * 0.5, 2.2, 0, Math.PI * 2);
    ctx.fill();
    ctx.restore();
}

function drawMaze() {
    if (!maze) return;
    if (!mazeLayer) mazeLayer = makeSprite(CANVAS_W, CANVAS_H, paintMaze);
    ctx.drawImage(mazeLayer, 0, 0);
    // Dots (one path); power pellets blink; the last few swell so you can find them
    const pulse = bricksLeft <= 8 ? 2 + Math.sin(maze.t / 6) * 1.5 : 0;
    ctx.fillStyle = '#ffb8ae';
    ctx.beginPath();
    for (let r = 0; r < MAZE_ROWS; r++) {
        for (let c = 0; c < MAZE_COLS; c++) {
            if (maze.dots[r][c] !== 1) continue;
            const p = mazeCenter(c, r);
            const s = 3 + pulse;
            ctx.rect(p.x - s, p.y - s, s * 2, s * 2);
        }
    }
    ctx.fill();
    if (Math.floor(maze.t / 15) % 2 === 0) {
        ctx.beginPath();
        for (let r = 0; r < MAZE_ROWS; r++) {
            for (let c = 0; c < MAZE_COLS; c++) {
                if (maze.dots[r][c] !== 2) continue;
                const p = mazeCenter(c, r);
                ctx.moveTo(p.x + 9, p.y);
                ctx.arc(p.x, p.y, 9, 0, Math.PI * 2);
            }
        }
        ctx.fill();
    }
    drawChomper(maze.chomper);
    // Ghosts
    const frame = Math.floor(maze.t / 8) % 2;
    for (const ghost of maze.ghosts) {
        let x = ghost.x, y = ghost.y;
        if (ghost.mode === 'dive' && ghost.warn > 0) x += Math.sin(ghost.warn * 1.8) * 3; // shivering before the swoop
        if (ghost.mode === 'home') { // just its eyes, zipping back to the pen
            drawGhostEyes(x, y, [0, -1]);
            continue;
        }
        const scared = ghostScared(ghost);
        const blink = scared && maze.fright < 120 && Math.floor(maze.t / 10) % 2 === 0;
        ctx.drawImage(ghostBody(scared ? (blink ? '#ffffff' : '#3b4bff') : ghost.color, frame), x - GHOST_R - 2, y - GHOST_R - 1);
        if (scared) { // scared: two small, worried eyes
            ctx.fillStyle = blink ? '#ff3b5c' : '#ffe0f0';
            ctx.beginPath();
            ctx.arc(x - 5, y - 3, 2.6, 0, Math.PI * 2);
            ctx.arc(x + 5, y - 3, 2.6, 0, Math.PI * 2);
            ctx.fill();
        } else {
            drawGhostEyes(x, y, ghost.mode === 'dive' || ghost.mode === 'rise' ? [0, ghost.mode === 'dive' ? 1 : -1] : ghost.dir);
        }
        if (ghost.mode === 'dive' && ghost.warn > 0 && Math.floor(ghost.warn / 5) % 2 === 0) {
            ctx.font = pixelFont(12);
            ctx.textAlign = 'center';
            ctx.fillStyle = '#ff4d4d';
            ctx.fillText('!', x, y - GHOST_R - 8);
        }
    }
    // How many dots are left
    ctx.font = termFont(20);
    ctx.textAlign = 'right';
    ctx.fillStyle = '#ffb8ae';
    ctx.fillText('DOTS LEFT ' + bricksLeft, CANVAS_W - 14, 56);
}
