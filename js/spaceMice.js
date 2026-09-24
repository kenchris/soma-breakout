// === spaceMice.js ===
// --- Space Mice levels ---
// A maze level type, after the arcade maze games but turned around. A space mouse in a bubble helmet lives in
// a neon maze full of space cheese, and only the mouse can eat it: clear every piece to finish the level.
// The ball is how you steer it. Hit the mouse and it zooms off the way the ball was going, eating as it
// runs, until a wall stops it; left alone it just sniffs its slow way to the nearest cheese, so it never
// gets stuck. Four space cats prowl the maze hunting it. A cat that catches the mouse sends it home and
// knocks some cheese loose back into the maze, so bop cats with the ball to keep them off it (a bopped
// cat goes back to its pod for a while). The cats also swoop out at your paddle and bite holes in it,
// like the aliens do. And the four big cheeses turn the tables: for a few seconds the cats are scared,
// and the mouse (or the ball) can chase them down, for 200, 400, 800, 1600 points.
// The ball rattles round the maze like a pinball; the walls are solid.

const MAZE_UNLOCK = 14;           // curve level of the first one (level 19), then about 1 level in 7
const MAZE_CELL = 36;
// # wall, . cheese, o big cheese, G the cats' pod, M where the mouse starts (cheese-free)
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
const MAZE_PEN = { c: 11, r: 2 };         // the cats' pod, in the middle
const MAZE_DOOR = { c: 11, r: 1 };        // the open cell above it they leave by
const MOUSE_HOME = { c: 11, r: 6 };
const CAT_R = 14;
const MOUSE_R = 12;
const MOUSE_SNIFF_SPEED = 1.15;   // px per step, left to its own devices
const MOUSE_ZOOM_SPEED = 3.4;     // px per step, after the ball sends it off
const MOUSE_CAUGHT_DROP = 2;      // cheese a caught mouse knocks loose
// The four space cats (see catTarget for what each one is after)
const CAT_DEFS = [
    { role: 'chaser', color: '#ff5a7a', release: 60 * 2 },
    { role: 'ambusher', color: '#ff9ae8', release: 60 * 5 },
    { role: 'patroller', color: '#3de0ff', release: 60 * 8 },
    { role: 'shy', color: '#ffb852', release: 60 * 11 }
];
const DIRS = [[1, 0], [-1, 0], [0, 1], [0, -1]];
const mazeLevelCache = {};

let maze = null; // { cheese[r][c]: 0 none, 1 cheese, 2 big; mouse, cats, fright, eaten, diveIn, powerIn, t }
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

// Cells a cat or the mouse may walk: inside the grid, not a wall, and the pod only for cats allowed in
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

function catHome(i) {
    return mazeCenter(MAZE_PEN.c - 1 + (i % 3), MAZE_PEN.r);
}

function buildMaze() {
    const cheese = MAZE_ART.map(row => [...row].map(ch => (ch === '.' ? 1 : ch === 'o' ? 2 : 0)));
    const n = curveLevel();
    const home = mazeCenter(MOUSE_HOME.c, MOUSE_HOME.r);
    maze = {
        cheese, t: 0, fright: 0, eaten: 0, powerIn: 0, diveIn: 60 * 9,
        mouse: { x: home.x, y: home.y, c: MOUSE_HOME.c, r: MOUSE_HOME.r, tc: MOUSE_HOME.c, tr: MOUSE_HOME.r, dir: [0, -1], zoom: false, face: 1, hitCool: 0, safe: 0, munch: 0 },
        cats: CAT_DEFS.map((def, i) => {
            const h = catHome(i);
            return { ...def, i, x: h.x, y: h.y, c: MAZE_PEN.c, r: MAZE_PEN.r, tc: MAZE_PEN.c, tr: MAZE_PEN.r, dir: [0, -1], mode: 'pen', penT: def.release, vy: 0, warn: 0 };
        }),
        speed: Math.min(0.75 + 0.02 * n, 1.1) // always a touch slower than the mouse: they win by cornering it
    };
    return mazeCheeseCount();
}

function mazeCheeseCount() {
    let n = 0;
    for (const row of maze.cheese) for (const d of row) if (d) n++;
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

// --- The mouse ---
// The first step of the shortest path from (c, r) to the nearest cheese, or null if there is none. It's a
// wary mouse: it plans around the cells hungry cats are in or about to be in, unless that leaves no way.
function stepTowardCheese(c, r) {
    const danger = new Set();
    for (const cat of maze.cats) {
        if (cat.mode !== 'chase') continue;
        danger.add(cat.c * 16 + cat.r);
        danger.add(cat.tc * 16 + cat.tr);
    }
    return cheesePath(c, r, danger) || cheesePath(c, r, new Set());
}

function cheesePath(c, r, avoid) {
    const seen = new Set([c * 16 + r]);
    const queue = [[c, r, null]];
    for (let i = 0; i < queue.length; i++) {
        const [qc, qr, first] = queue[i];
        if (first && maze.cheese[qr][qc]) return first;
        for (const d of DIRS) {
            const nc = qc + d[0], nr = qr + d[1];
            if (!mazeOpen(nc, nr, false) || seen.has(nc * 16 + nr) || avoid.has(nc * 16 + nr)) continue;
            seen.add(nc * 16 + nr);
            queue.push([nc, nr, first || d]);
        }
    }
    return null;
}

function mouseEat() {
    const m = maze.mouse;
    const kind = maze.cheese[m.r][m.c];
    if (!kind) return;
    maze.cheese[m.r][m.c] = 0;
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
        addPopup(m.x, m.y - 18, 'BIG CHEESE!', '#ffe14d', { size: 18, life: 1, pop: true });
        spawnParticles(m.x, m.y, '#ffe14d', 10);
        scareCats();
    }
    if (combo >= 3 && combo <= COMBO_MAX && combo !== maze.lastShout) {
        maze.lastShout = combo;
        comboShout(combo, m.x, m.y);
    }
    if (bricksLeft <= 0) {
        noteMoment(60, 'ALL THE CHEESE!');
        completeLevel();
    }
}

function updateMouse() {
    const m = maze.mouse;
    if (m.hitCool > 0) m.hitCool--;
    if (m.safe > 0) m.safe--;
    if (m.munch > 0) m.munch--;
    const speed = (m.zoom ? MOUSE_ZOOM_SPEED : MOUSE_SNIFF_SPEED) * timeScale;
    if (!stepToCell(m, speed)) return;
    mouseEat();
    if (gameState !== 'playing' || !maze) return;
    // At a cell centre: zooming, it carries straight on while it can; otherwise it sniffs out the nearest cheese
    if (m.zoom && mazeOpen(m.c + m.dir[0], m.r + m.dir[1], false)) {
        m.tc = m.c + m.dir[0];
        m.tr = m.r + m.dir[1];
        return;
    }
    if (m.zoom) {
        m.zoom = false; // bonk: the wall stops it
        beep(700, 'mouseBonk');
    }
    const d = stepTowardCheese(m.c, m.r);
    if (!d) return;
    m.dir = d;
    if (d[0]) m.face = d[0];
    m.tc = m.c + d[0];
    m.tr = m.r + d[1];
}

// The ball sends the mouse zooming off the way the ball was travelling (along whichever axis it was
// travelling more), or along the other axis if that way is a wall
function pushMouse(b) {
    const m = maze.mouse;
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
    tone(900, 0.12, { type: 'triangle', vol: 0.16, slideTo: 1500, key: 'mouseZoom' });
    spawnParticles(m.x, m.y, '#dfe3ff', 5);
    haptic(10);
}

// A cat got the mouse: it's whisked home, a few cheeses tumble back into the maze
function catchMouse(cat) {
    const m = maze.mouse;
    const home = mazeCenter(MOUSE_HOME.c, MOUSE_HOME.r);
    spawnParticles(m.x, m.y, '#ffe14d', 12);
    addPopup(m.x, m.y - 20, 'CAUGHT!', '#ff5a7a', { size: 20, life: 1.2, pop: true });
    tone(600, 0.35, { type: 'sawtooth', vol: 0.2, slideTo: 150, key: 'mouseCaught', force: true });
    addShake(5);
    haptic([30, 30, 50], true);
    Object.assign(m, { x: home.x, y: home.y, c: MOUSE_HOME.c, r: MOUSE_HOME.r, tc: MOUSE_HOME.c, tr: MOUSE_HOME.r, zoom: false, safe: 180 });
    // Knocked-loose cheese lands on empty cells
    const empty = [];
    maze.cheese.forEach((row, r) => row.forEach((k, c) => { if (!k && MAZE_ART[r][c] !== '#' && MAZE_ART[r][c] !== 'G' && !(c === m.c && r === m.r)) empty.push([c, r]); }));
    for (let i = 0; i < MOUSE_CAUGHT_DROP && empty.length; i++) {
        const [c, r] = empty.splice(Math.floor(Math.random() * empty.length), 1)[0];
        maze.cheese[r][c] = 1;
        bricksLeft++;
    }
    levelBricksTotal = Math.max(levelBricksTotal, bricksLeft);
    catGoHome(cat, 60 * 3); // the cat's had its fun
    if (!mazeCatchTipShown) {
        mazeCatchTipShown = true;
        addPopup(CANVAS_W / 2, 410, 'BOP THE CATS WITH THE BALL TO PROTECT THE MOUSE!', '#ffffff', { size: 18, life: 2.6, rise: 0.15, pop: true });
    }
}

// --- Cat brains ---
// Where each cat is heading when it isn't scared: the red chaser goes straight for the mouse, the pink
// ambusher for where the mouse is going, the cyan patroller keeps to the bottom row above your paddle (it
// does most of the swooping), and the orange shy one stalks the mouse until it's close, then loses its
// nerve and wanders off to a corner.
function catTarget(cat) {
    const m = maze.mouse;
    if (cat.i === 0) return { x: m.x, y: m.y };
    if (cat.i === 1) return { x: m.x + m.dir[0] * MAZE_CELL * 3, y: m.y + m.dir[1] * MAZE_CELL * 3 };
    if (cat.i === 2) return { x: paddle.x + paddle.w / 2, y: mazeCenter(0, MAZE_ROWS - 1).y };
    const d = Math.hypot(cat.x - m.x, cat.y - m.y);
    return d > MAZE_CELL * 5 ? { x: m.x, y: m.y } : { x: mazeCellX(0), y: mazeCellY(0) };
}

// At a cell centre: pick the next cell. No turning back unless it's a dead end.
function catChooseDir(cat) {
    const podOk = cat.mode === 'leave';
    const fits = ([dx, dy]) => mazeOpen(cat.c + dx, cat.r + dy, podOk);
    let options = DIRS.filter(d => fits(d) && !(d[0] === -cat.dir[0] && d[1] === -cat.dir[1]));
    if (!options.length) options = DIRS.filter(fits);
    if (!options.length) return;
    let pick;
    if (cat.mode === 'fright') {
        pick = options[Math.floor(Math.random() * options.length)];
    } else {
        const t = cat.mode === 'leave' ? mazeCenter(MAZE_DOOR.c, MAZE_DOOR.r - 1) : catTarget(cat);
        let best = Infinity;
        for (const d of options) {
            const p = mazeCenter(cat.c + d[0], cat.r + d[1]);
            const dist = Math.hypot(p.x - t.x, p.y - t.y);
            if (dist < best) {
                best = dist;
                pick = d;
            }
        }
    }
    cat.dir = pick;
    cat.tc = cat.c + pick[0];
    cat.tr = cat.r + pick[1];
}

function catSpeed(cat) {
    const base = maze.speed * timeScale;
    if (cat.mode === 'fright') return base * 0.55;
    if (cat.mode === 'home') return 4.5 * timeScale;
    if (cat.mode === 'dive') return (2.4 + 0.04 * curveLevel()) * timeScale;
    if (cat.mode === 'rise') return 3 * timeScale;
    return base * (cat.i === 0 && bricksLeft < levelBricksTotal * 0.3 ? 1.2 : 1); // the chaser gets keener near the end
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

function catGoHome(cat, penFrames) {
    cat.mode = 'home';
    cat.scared = false;
    cat.penT = penFrames;
}

// Back into the maze after a swoop: the nearest bottom-row cell, and on with the hunt from there
function rejoinMaze(cat) {
    cat.c = cat.tc = mazeCellAt(cat.x, 0).c;
    cat.r = cat.tr = MAZE_ROWS - 1;
    cat.dir = [0, -1];
    cat.mode = maze.fright > 0 ? 'fright' : 'chase';
    cat.scared = false;
}

function startDive(cat) {
    cat.mode = 'dive';
    cat.warn = 40; // it crouches and wiggles first, so you see it coming
    cat.aimX = paddle.x + paddle.w / 2;
    cat.vy = 0;
    tone(520, 0.3, { type: 'sawtooth', vol: 0.16, slideTo: 180, key: 'catPounce' });
    if (!mazeDiveTipShown) {
        mazeDiveTipShown = true;
        addPopup(CANVAS_W / 2, 400, 'A CAT IS POUNCING AT YOUR PADDLE: HIT IT!', '#ffffff', { size: 18, life: 2.4, rise: 0.15, pop: true });
    }
}

function updateCat(cat) {
    if (cat.mode === 'pen') {
        cat.y = catHome(cat.i).y + Math.sin(maze.t / 8 + cat.i) * 3; // bobbing in the pod
        if (--cat.penT <= 0) {
            const h = mazeCenter(MAZE_PEN.c, MAZE_PEN.r);
            Object.assign(cat, { mode: 'leave', x: h.x, y: h.y, c: MAZE_PEN.c, r: MAZE_PEN.r, tc: MAZE_PEN.c, tr: MAZE_PEN.r, dir: [0, -1] });
            catChooseDir(cat);
        }
        return;
    }
    if (cat.mode === 'home') {
        const h = catHome(cat.i);
        if (flyTo(cat, h.x, h.y, catSpeed(cat))) cat.mode = 'pen';
        return;
    }
    if (cat.mode === 'dive') {
        if (cat.warn > 0) {
            cat.warn--;
            return;
        }
        // Pounces down at where the paddle was, weaving a little and homing in gently
        cat.aimX += Math.sign(paddle.x + paddle.w / 2 - cat.aimX) * 0.8 * timeScale;
        cat.vy = Math.min(cat.vy + 0.12 * timeScale, catSpeed(cat));
        cat.y += cat.vy * timeScale;
        cat.x += (cat.aimX + Math.sin(maze.t / 9) * 26 - cat.x) * 0.06 * timeScale;
        if (cat.y > paddle.y - CAT_R && cat.y < paddle.y + paddle.h + CAT_R) {
            const hit = paddleHit(cat.x, cat.y, CAT_R);
            if (hit) {
                if (hit.mirror) blockMirrorBolt(cat.x);
                else punchHole(cat.x, BOSS_HOLE_SECONDS);
                cat.mode = 'rise';
            }
        }
        if (cat.y > paddle.y + 40) cat.mode = 'rise';
        return;
    }
    if (cat.mode === 'rise') {
        const x = Math.max(mazeCenter(0, 0).x, Math.min(mazeCenter(MAZE_COLS - 1, 0).x, cat.x));
        if (flyTo(cat, mazeCenter(mazeCellAt(x, 0).c, 0).x, mazeCenter(0, MAZE_ROWS - 1).y, catSpeed(cat))) rejoinMaze(cat);
        return;
    }
    let move = catSpeed(cat);
    if (stepToCell(cat, move)) {
        if (cat.mode === 'leave' && cat.c === MAZE_DOOR.c && cat.r === MAZE_DOOR.r) cat.mode = maze.fright > 0 ? 'fright' : 'chase';
        catChooseDir(cat);
    }
}

function scareCats() {
    maze.fright = Math.max(60 * 4, 60 * 7 - 6 * curveLevel());
    maze.eaten = 0;
    maze.powerIn = 60 * 18;
    for (const cat of maze.cats) {
        if (cat.mode === 'chase') {
            cat.mode = 'fright';
            cat.dir = [-cat.dir[0], -cat.dir[1]]; // they turn tail
            if (mazeOpen(cat.c + cat.dir[0], cat.r + cat.dir[1], false)) {
                cat.tc = cat.c + cat.dir[0];
                cat.tr = cat.r + cat.dir[1];
            }
        } else if (cat.mode === 'dive') {
            cat.mode = 'rise'; // a pouncing cat bolts back for the maze
            cat.scared = true;
        }
    }
    tone(180, 0.5, { type: 'triangle', vol: 0.2, slideTo: 90, key: 'fright', force: true });
}

function catScared(cat) {
    return cat.mode === 'fright' || (cat.mode === 'rise' && cat.scared);
}

// A scared cat caught by the mouse or the ball
function eatCat(cat) {
    const pts = 200 * Math.pow(2, Math.min(maze.eaten, 3)) * (doubleTimer > 0 ? 2 : 1);
    maze.eaten++;
    catGoHome(cat, 60 * 4);
    addScore(pts);
    addPopup(cat.x, cat.y - 14, '' + pts, '#3de0ff', { size: 20, life: 1.1, pop: true });
    if (maze.eaten === 4) noteMoment(70, 'ALL FOUR CATS!');
    spawnParticles(cat.x, cat.y, '#9aa6ff', 12);
    tone(1200, 0.25, { type: 'square', vol: 0.18, slideTo: 300, key: 'eatCat', force: true });
    addShake(4);
    haptic([15, 20, 25], true);
    if (Math.random() < 0.35) spawnPowerup(cat.x, cat.y);
}

function updateMaze() {
    if (!maze) return;
    maze.t++;
    if (maze.fright > 0 && --maze.fright === 0) {
        for (const cat of maze.cats) if (cat.mode === 'fright') cat.mode = 'chase';
    }
    updateMouse();
    if (!maze || gameState !== 'playing') return;
    // Every so often a cat on the bottom row (never a scared one) pounces at the paddle
    if (--maze.diveIn <= 0) {
        const bottom = maze.cats.filter(cat => cat.mode === 'chase' && cat.r === MAZE_ROWS - 1);
        if (bottom.length) {
            startDive(bottom[Math.floor(Math.random() * bottom.length)]);
            maze.diveIn = Math.round(60 * Math.max(4, 10 - 0.15 * curveLevel()) * (0.8 + Math.random() * 0.4));
        } else {
            maze.diveIn = 30;
        }
    }
    // With every big cheese gone, a new one turns up now and then, so the cats can always be turned
    if (!maze.cheese.some(row => row.includes(2)) && --maze.powerIn <= 0) {
        const free = [];
        maze.cheese.forEach((row, r) => row.forEach((k, c) => { if (!k && MAZE_ART[r][c] !== '#' && MAZE_ART[r][c] !== 'G') free.push([c, r]); }));
        if (free.length) {
            const [c, r] = free[Math.floor(Math.random() * free.length)];
            maze.cheese[r][c] = 2;
            bricksLeft++;
            levelBricksTotal++;
        }
        maze.powerIn = 60 * 18;
    }
    const m = maze.mouse;
    for (const cat of maze.cats) {
        updateCat(cat);
        // Cat meets mouse: a hungry cat catches it, a scared one gets chased off by it
        if (cat.mode !== 'chase' && cat.mode !== 'fright') continue;
        if (Math.hypot(cat.x - m.x, cat.y - m.y) > CAT_R + MOUSE_R - 4) continue;
        if (cat.mode === 'fright') eatCat(cat);
        else if (m.safe <= 0) catchMouse(cat);
    }
}

// --- The ball in the maze ---
function mazeBallCollision(b) {
    if (!maze) return;
    // Walls: only the cells under the ball can touch it; bounce off the one it's deepest into
    const c0 = Math.floor((b.x - b.r - MAZE_LEFT) / MAZE_CELL), c1 = Math.floor((b.x + b.r - MAZE_LEFT) / MAZE_CELL);
    const r0 = Math.floor((b.y - b.r - MAZE_TOP) / MAZE_CELL), r1 = Math.floor((b.y + b.r - MAZE_TOP) / MAZE_CELL);
    let best = null;
    for (let c = c0; c <= c1; c++) {
        for (let r = r0; r <= r1; r++) {
            if (!mazeWall(c, r)) continue;
            const hit = rectContact(b, mazeCellX(c), mazeCellY(r), MAZE_CELL, MAZE_CELL);
            if (hit && (!best || hit.d2 < best.hit.d2)) best = { c, r, hit };
        }
    }
    if (best) {
        bounceOffRect(b, mazeCellX(best.c), mazeCellY(best.r), MAZE_CELL, MAZE_CELL, best.hit);
        // Never let it settle into bouncing dead straight between two walls
        const sp = Math.hypot(b.vx, b.vy);
        if (Math.abs(b.vx) < 0.6) b.vx = (Math.random() < 0.5 ? -1 : 1) * 0.9;
        if (Math.abs(b.vy) < 0.6) b.vy = (b.vy < 0 ? -1 : 1) * 0.9;
        const f = sp / Math.hypot(b.vx, b.vy);
        b.vx *= f;
        b.vy *= f;
        beep(200, 'mazeWall');
    }
    // The mouse: send it zooming off the way the ball was going
    const m = maze.mouse;
    if (m.hitCool <= 0 && Math.hypot(b.x - m.x, b.y - m.y) < b.r + MOUSE_R) {
        m.hitCool = 12;
        pushMouse(b); // (the ball's heading before it bounces off decides where the mouse goes)
        bounceOffCircle(b, m.x, m.y, MOUSE_R);
    }
    // Cats
    for (const cat of maze.cats) {
        if (cat.mode === 'home' || cat.mode === 'pen') continue;
        const dx = b.x - cat.x, dy = b.y - cat.y;
        if (dx * dx + dy * dy >= (b.r + CAT_R) * (b.r + CAT_R)) continue;
        bounceOffCircle(b, cat.x, cat.y, CAT_R);
        if (catScared(cat) || fireTimer > 0) {
            eatCat(cat);
        } else {
            // Bopped: back to its pod for a while
            catGoHome(cat, 60 * 3);
            const pts = (cat.mode === 'dive' || cat.mode === 'rise' ? 200 : 100) * (doubleTimer > 0 ? 2 : 1);
            addScore(pts);
            addPopup(cat.x, cat.y - 18, 'BOP! +' + pts, cat.color, { size: 18, life: 1, pop: true });
            spawnParticles(cat.x, cat.y, cat.color, 10);
            tone(880, 0.12, { type: 'square', vol: 0.18, slideTo: 440, key: 'catBop' });
            addShake(3);
            haptic(15);
        }
        return;
    }
}

// A lost ball: the cats go back to their pod and start over
function mazeBreather() {
    if (!maze) return;
    maze.fright = 0;
    maze.diveIn = 60 * 7;
    maze.cats.forEach((cat, i) => {
        const h = catHome(i);
        Object.assign(cat, { x: h.x, y: h.y, mode: 'pen', penT: CAT_DEFS[i].release, scared: false, warn: 0 });
    });
}

// Guided ball: go for the mouse (from below it, so the push sends it up into the maze), or scared cats
function bestAimMaze(x, y) {
    const speed = currentSpeed();
    let best = null, bestV = 0;
    const m = maze.mouse;
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
            const cell = { c: Math.floor((px - MAZE_LEFT) / MAZE_CELL), r: Math.floor((py - MAZE_TOP) / MAZE_CELL) };
            if (mazeWall(cell.c, cell.r)) break;
            if (Math.hypot(m.x - px, m.y - py) < MOUSE_R + BALL_RADIUS) v = 10;
            for (const cat of maze.cats) if (Math.hypot(cat.x - px, cat.y - py) < CAT_R + BALL_RADIUS) v = Math.max(v, catScared(cat) ? 12 : 6);
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

// The walls, painted once: navy blocks with a double neon-blue outline wherever a wall meets open space,
// so neighbouring blocks merge into long rounded runs of wall
function paintMaze(g) {
    const S = MAZE_CELL;
    g.fillStyle = '#07072a';
    for (let r = 0; r < MAZE_ROWS; r++) for (let c = 0; c < MAZE_COLS; c++) if (mazeWall(c, r)) g.fillRect(mazeCellX(c), mazeCellY(r), S, S);
    for (const [inset, color, width] of [[3, '#2d4dff', 3], [9, '#1a2a9a', 1.5]]) {
        g.strokeStyle = color;
        g.lineWidth = width;
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
    // The pod's door
    const d = mazeCenter(MAZE_PEN.c, MAZE_PEN.r);
    g.fillStyle = '#ff9ae8';
    g.fillRect(d.x - MAZE_CELL * 1.5 + 2, mazeCellY(MAZE_PEN.r) - 2, MAZE_CELL * 3 - 4, 3);
}

// Space cheese: a yellow wedge with holes (bigger and glowing for the big ones), painted once each
const cheeseSprites = {};

function cheeseSprite(big) {
    const key = big ? 'big' : 'small';
    if (!cheeseSprites[key]) {
        const w = big ? 26 : 16, h = big ? 20 : 12;
        cheeseSprites[key] = makeSprite(w + 4, h + 4, g => {
            g.translate(2, 2);
            g.fillStyle = '#ffd23f';
            g.beginPath();
            g.moveTo(0, h);
            g.lineTo(w, h);
            g.lineTo(w, h * 0.3);
            g.closePath();
            g.fill();
            g.fillStyle = '#ffe98a';
            g.fillRect(0, h - 1.5, w, 1.5);
            g.fillStyle = '#c9951a';
            for (const [hx, hy, hr] of [[w * 0.62, h * 0.72, h * 0.13], [w * 0.84, h * 0.55, h * 0.1], [w * 0.4, h * 0.85, h * 0.08]]) {
                g.beginPath();
                g.arc(hx, hy, hr, 0, Math.PI * 2);
                g.fill();
            }
        });
    }
    return cheeseSprites[key];
}

// A space cat's head, per colour: round, two pointy ears with pink insides, a little antenna. Painted
// once each; the big eyes go on live. No mouth.
const catSprites = {};

function catSprite(color) {
    if (!catSprites[color]) {
        const S = CAT_R * 2 + 8;
        catSprites[color] = makeSprite(S, S + 6, g => {
            const R = CAT_R, cx = S / 2, cy = S / 2 + 5;
            g.fillStyle = color;
            for (const s of [-1, 1]) { // ears
                g.beginPath();
                g.moveTo(cx + s * R * 0.95, cy - R * 0.2);
                g.lineTo(cx + s * R * 0.75, cy - R * 1.25);
                g.lineTo(cx + s * R * 0.15, cy - R * 0.8);
                g.closePath();
                g.fill();
            }
            g.fillStyle = '#ff8fc0';
            for (const s of [-1, 1]) {
                g.beginPath();
                g.moveTo(cx + s * R * 0.8, cy - R * 0.45);
                g.lineTo(cx + s * R * 0.72, cy - R * 1.02);
                g.lineTo(cx + s * R * 0.35, cy - R * 0.75);
                g.closePath();
                g.fill();
            }
            g.fillStyle = color;
            g.beginPath();
            g.ellipse(cx, cy, R, R * 0.9, 0, 0, Math.PI * 2);
            g.fill();
            g.fillStyle = 'rgba(255, 255, 255, 0.25)';
            g.beginPath();
            g.ellipse(cx - R * 0.4, cy - R * 0.45, R * 0.25, R * 0.15, -0.5, 0, Math.PI * 2);
            g.fill();
            g.strokeStyle = 'rgba(255, 255, 255, 0.55)'; // whiskers
            g.lineWidth = 1;
            g.beginPath();
            for (const s of [-1, 1]) {
                g.moveTo(cx + s * R * 0.45, cy + R * 0.3);
                g.lineTo(cx + s * R * 1.25, cy + R * 0.18);
                g.moveTo(cx + s * R * 0.45, cy + R * 0.42);
                g.lineTo(cx + s * R * 1.25, cy + R * 0.52);
            }
            g.stroke();
        });
    }
    return catSprites[color];
}

function drawCatEyes(x, y, dir) {
    for (const s of [-1, 1]) {
        const ex = x + s * 5.5, ey = y - 2;
        ctx.fillStyle = '#ffffff';
        ctx.beginPath();
        ctx.ellipse(ex, ey, 4.2, 5, 0, 0, Math.PI * 2);
        ctx.fill();
        ctx.fillStyle = '#1a1040';
        ctx.beginPath();
        ctx.ellipse(ex + dir[0] * 1.8, ey + dir[1] * 2.2, 2, 3, 0, 0, Math.PI * 2); // cat-slit-ish pupils
        ctx.fill();
    }
}

// The space mouse: a round grey body, big pink-lined ears, huge eyes, a tail, and a glass helmet
let mouseSprite = null;

function drawMouse(m) {
    if (!mouseSprite) {
        mouseSprite = makeSprite(48, 44, g => {
            const cx = 24, cy = 26;
            g.strokeStyle = '#c9a6b8'; // tail
            g.lineWidth = 2;
            g.beginPath();
            g.moveTo(cx - 10, cy + 6);
            g.quadraticCurveTo(cx - 22, cy + 8, cx - 20, cy - 4);
            g.stroke();
            g.fillStyle = '#b8bdd6';
            for (const [ex, ey] of [[cx - 7, cy - 10], [cx + 7, cy - 10]]) { // ears
                g.beginPath();
                g.arc(ex, ey, 7, 0, Math.PI * 2);
                g.fill();
            }
            g.fillStyle = '#ffadc9';
            for (const [ex, ey] of [[cx - 7, cy - 10], [cx + 7, cy - 10]]) {
                g.beginPath();
                g.arc(ex, ey, 4, 0, Math.PI * 2);
                g.fill();
            }
            g.fillStyle = '#d8dcf0';
            g.beginPath();
            g.ellipse(cx, cy, 11, 10, 0, 0, Math.PI * 2);
            g.fill();
            g.fillStyle = '#1a1030'; // eyes, with a glint
            for (const ex of [cx - 3, cx + 5]) {
                g.beginPath();
                g.ellipse(ex, cy - 2, 2.6, 3.4, 0, 0, Math.PI * 2);
                g.fill();
            }
            g.fillStyle = '#ffffff';
            for (const ex of [cx - 3.8, cx + 4.2]) g.fillRect(ex, cy - 4.5, 1.5, 1.5);
            g.fillStyle = '#ff7aa8'; // nose, at the front
            g.beginPath();
            g.arc(cx + 10, cy + 2, 2, 0, Math.PI * 2);
            g.fill();
            g.fillStyle = 'rgba(127, 233, 255, 0.14)'; // the helmet
            g.strokeStyle = 'rgba(127, 233, 255, 0.8)';
            g.lineWidth = 1.5;
            g.beginPath();
            g.arc(cx, cy - 3, 19, 0, Math.PI * 2);
            g.fill();
            g.stroke();
            g.strokeStyle = 'rgba(255, 255, 255, 0.85)';
            g.lineWidth = 2;
            g.beginPath();
            g.arc(cx, cy - 3, 14, -2.5, -1.9);
            g.stroke();
        });
    }
    if (m.safe > 0 && Math.floor(m.safe / 6) % 2 === 0) return; // blinking while it's safe, just home
    ctx.save();
    ctx.translate(m.x, m.y - 2 - (m.munch > 0 ? Math.abs(Math.sin(m.munch)) * 2 : 0));
    ctx.scale(m.face * 1.25, 1.25); // faces the way it's running
    if (m.zoom) ctx.rotate(0.12); // leaning into a zoom
    ctx.drawImage(mouseSprite, -24, -26);
    ctx.restore();
    if (m.zoom) { // speed lines behind it
        ctx.strokeStyle = 'rgba(255, 255, 255, 0.5)';
        ctx.lineWidth = 1.5;
        ctx.beginPath();
        for (const off of [-5, 0, 5]) {
            ctx.moveTo(m.x - m.dir[0] * 16 + (m.dir[1] ? off : 0), m.y - m.dir[1] * 16 + (m.dir[0] ? off : 0));
            ctx.lineTo(m.x - m.dir[0] * 28 + (m.dir[1] ? off : 0), m.y - m.dir[1] * 28 + (m.dir[0] ? off : 0));
        }
        ctx.stroke();
    }
}

function drawMaze() {
    if (!maze) return;
    if (!mazeLayer) mazeLayer = makeSprite(CANVAS_W, CANVAS_H, paintMaze);
    ctx.drawImage(mazeLayer, 0, 0);
    // Cheese; the big ones pulse, and the last few bob so you can spot them
    const small = cheeseSprite(false), big = cheeseSprite(true);
    const few = bricksLeft <= 8;
    for (let r = 0; r < MAZE_ROWS; r++) {
        for (let c = 0; c < MAZE_COLS; c++) {
            const k = maze.cheese[r][c];
            if (!k) continue;
            const p = mazeCenter(c, r);
            const sp = k === 2 ? big : small;
            const bob = few ? Math.sin(maze.t / 6 + c) * 3 : 0;
            if (k === 2) {
                const s = 1 + 0.12 * Math.sin(maze.t / 8);
                ctx.drawImage(sp, p.x - sp.width * s / 2, p.y - sp.height * s / 2, sp.width * s, sp.height * s);
            } else {
                ctx.drawImage(sp, p.x - sp.width / 2, p.y - sp.height / 2 + bob);
            }
        }
    }
    drawMouse(maze.mouse);
    // Cats
    for (const cat of maze.cats) {
        let x = cat.x, y = cat.y;
        if (cat.mode === 'dive' && cat.warn > 0) x += Math.sin(cat.warn * 1.8) * 3; // wiggling before the pounce
        if (cat.mode === 'home') { // just a faint, dazed ghost of itself zipping back to the pod
            ctx.save();
            ctx.globalAlpha = 0.35;
            ctx.drawImage(catSprite(cat.color), x - CAT_R - 4, y - CAT_R - 9);
            ctx.restore();
            continue;
        }
        const scared = catScared(cat);
        const blink = scared && maze.fright < 120 && Math.floor(maze.t / 10) % 2 === 0;
        ctx.drawImage(catSprite(scared ? (blink ? '#ffffff' : '#6b7bff') : cat.color), x - CAT_R - 4, y - CAT_R - 9);
        if (scared) { // scared: two small, worried eyes
            ctx.fillStyle = blink ? '#ff5a7a' : '#ffe0f0';
            ctx.beginPath();
            ctx.arc(x - 5, y - 2, 2.6, 0, Math.PI * 2);
            ctx.arc(x + 5, y - 2, 2.6, 0, Math.PI * 2);
            ctx.fill();
        } else {
            drawCatEyes(x, y, cat.mode === 'dive' || cat.mode === 'rise' ? [0, cat.mode === 'dive' ? 1 : -1] : cat.dir);
        }
        if (cat.mode === 'dive' && cat.warn > 0 && Math.floor(cat.warn / 5) % 2 === 0) {
            ctx.font = pixelFont(12);
            ctx.textAlign = 'center';
            ctx.fillStyle = '#ff4d4d';
            ctx.fillText('!', x, y - CAT_R - 10);
        }
    }
    // How much cheese is left
    ctx.font = termFont(20);
    ctx.textAlign = 'right';
    ctx.fillStyle = '#ffe14d';
    ctx.fillText('CHEESE LEFT ' + bricksLeft, CANVAS_W - 14, 56);
}
