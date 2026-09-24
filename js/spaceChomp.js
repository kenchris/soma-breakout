// === spaceChomp.js ===
// --- Space Chomp levels ---
// A maze level type after the arcade maze games, with a timer. Two round chompers live in a neon maze full
// of dots, and only they eat them: eat the level's quota of dots before the clock runs out. The ball is
// their helper, and any hit is a good hit:
//   - Hit a chomper and it ZOOMS: it runs at three times the speed for a few seconds. Chompers always find
//     their own way to the nearest dots, so there's no aiming it: just keep them boosted.
//   - Four ghosts hunt them. A ghost that catches one sends it home and knocks a couple of dots loose (off
//     your count, back into the maze), so bop the ghosts away with the ball.
//   - The ghosts also swoop out at your paddle and bite holes in it, like the aliens do.
//   - The four power pellets turn the tables: for a few seconds the ghosts turn blue and run, and the
//     chompers (or the ball) can eat them, for 200 to 1600 points.
// The maze only steers the chompers and the ghosts: the ball flies straight over its walls. But some of the
// maze is made of bricks, and those the ball does hit: it bounces off and smashes them (points, now and
// then a drop, often an AIM that homes the ball in on a chomper, and a nudge of ZOOM for both chompers). A smashed brick leaves a gap in the maze, a shortcut
// for the chompers (and the ghosts), until it rebuilds itself a few seconds later. Running out of
// time costs a life, and the clock restarts (with what you've eaten kept).

const MAZE_UNLOCK = 14;           // curve level of the first one (level 19), then about 1 level in 7
const MAZE_CELL = 36;
const MAZE_DOT_COLOR = '#aef3ff';   // pale cyan dots
// # wall, B breakable brick (a wall until the ball smashes it), . dot, o power pellet, G the ghosts' pen,
// M where a chomper starts (no dot)
const MAZE_ART = [
    'o.........B.B.........o',
    '.##.#B#.B.....B.#B#.##.',
    '.##.....#.#.#.#.....##.',
    '.....#...#GGG#...#.....',
    '..B.##.B.#####.B.##.B..',
    '.#.#...#.......#...#.#.',
    '.#.#B#.#.B.B.B.#.#B#.#.',
    '...B.....B...B.....B...',
    'o.........M.M.........o'
];
const MAZE_BRICK_REBUILD = 60 * 12;  // frames until a smashed brick rebuilds (later if something's in the way)
const MAZE_LOW_BRICK_ROW = 5;       // bricks from this row down shatter and let the ball straight through: a
                                     // bounce off one that low sent the ball back down too fast to react to
const MAZE_BRICK_ZOOM = 15;          // the little nudge of ZOOM every smashed brick gives both chompers
const MAZE_COLS = MAZE_ART[0].length;
const MAZE_ROWS = MAZE_ART.length;
const MAZE_LEFT = (CANVAS_W - MAZE_COLS * MAZE_CELL) / 2;
const MAZE_TOP = 90;                       // under the goal bar
const MAZE_PEN = { c: 11, r: 3 };          // the ghosts' pen, in the middle
const MAZE_DOOR = { c: 11, r: 2 };         // the open cell above it they leave by
const CHOMPER_HOMES = [{ c: 10, r: 8 }, { c: 12, r: 8 }];
const CHOMPER_COLORS = ['#ff9a1f', '#7dea3c']; // orange and lime
const GHOST_R = 14;
const CHOMPER_R = 13;
const CHOMPER_HIT_R = 32;          // generous: brushing past a chomper counts
const CHOMPER_SNIFF_SPEED = 0.3;   // px per step, left to itself: a slow amble, too slow to make the quota alone
const CHOMPER_ZOOM_SPEED = 2.7;    // px per step while boosted (nine times as fast)
const CHOMPER_ZOOM_FRAMES = 180;
const CHOMPER_CAUGHT_DROP = 2;     // dots a caught chomper knocks loose
const MAZE_GOAL = 100;             // dots to clear the level (of the maze's 140): a nice round number
const MAZE_EXTRA_SECONDS = 40;     // the clock after running out once
// Our own four ghosts (see ghostTarget for what each one is after)
// Our own four space ghosts, in the game's neon colours, each with one big eye (see ghostTarget for what
// each one is after)
const GHOST_DEFS = [
    { role: 'chaser', color: '#ff2fb4', release: 60 * 2 },
    { role: 'ambusher', color: '#a06cff', release: 60 * 5 },
    { role: 'patroller', color: '#3d7bff', release: 60 * 8 },
    { role: 'shy', color: '#20c997', release: 60 * 11 }
];
const GHOST_SCARED_COLOR = '#dfe3ff';  // scared, they go pale and see-through
const DIRS = [[1, 0], [-1, 0], [0, 1], [0, -1]];
const mazeLevelCache = {};

// { dots[r][c]: 0 none, 1 dot, 2 power pellet; chompers, ghosts, goal, time, fright, eaten, diveIn, powerIn, t }
let maze = null;
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
// The same, one axis at a time, for the every-frame paths: no object to allocate (on a phone, hundreds of
// little {x, y}s a frame meant garbage-collection pauses, and stutter)
function mazeCX(c) { return MAZE_LEFT + c * MAZE_CELL + MAZE_CELL / 2; }
function mazeCY(r) { return MAZE_TOP + r * MAZE_CELL + MAZE_CELL / 2; }

// Cells a ghost or the chomper may walk: inside the grid, not a wall, and the pen only for ghosts allowed in
function mazeOpen(c, r, podOk) {
    if (c < 0 || c >= MAZE_COLS || r < 0 || r >= MAZE_ROWS) return false;
    const ch = MAZE_ART[r][c];
    if (ch === 'B') return !maze.bricks[c * 16 + r].alive; // a smashed brick is a gap
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
    let total = 0;
    for (const row of dots) for (const d of row) if (d) total++;
    maze = {
        bricks: mazeBricks(), dots, t: 0, fright: 0, eaten: 0, powerIn: 0, diveIn: 60 * 9,
        goal: Math.min(MAZE_GOAL, total),
        time: 60 * Math.max(55, 85 - n), // 71s on its debut, a little less later on
        chompers: CHOMPER_HOMES.map((h, i) => {
            const p = mazeCenter(h.c, h.r);
            return { i, color: CHOMPER_COLORS[i], home: h, x: p.x, y: p.y, c: h.c, r: h.r, tc: h.c, tr: h.r, dir: [i ? 1 : -1, 0], zoomT: 0, hitCool: 0, safe: 0, pushed: false };
        }),
        ghosts: GHOST_DEFS.map((def, i) => {
            const h = ghostHome(i);
            return { ...def, i, x: h.x, y: h.y, c: MAZE_PEN.c, r: MAZE_PEN.r, tc: MAZE_PEN.c, tr: MAZE_PEN.r, dir: [0, -1], mode: 'pen', penT: def.release, vy: 0, warn: 0 };
        }),
        speed: Math.min(0.6 + 0.015 * n, 0.9) // faster than a chomper left alone, far slower than a boosted one
    };
    maze.brickList = Object.values(maze.bricks); // (the same bricks, as a list to walk every frame)
    prewarmMazeSprites();
    return maze.goal; // (the level's "bricks left" count down to the goal)
}

// The maze's breakable bricks, by cell (c * 16 + r)
function mazeBricks() {
    const bricks = {};
    MAZE_ART.forEach((row, r) => [...row].forEach((ch, c) => {
        if (ch === 'B') bricks[c * 16 + r] = { c, r, alive: true, rebuild: 0, pop: 0 };
    }));
    return bricks;
}

// Rebuilding waits for the cell to be clear: nothing may be walled in
function updateMazeBricks() {
    for (const br of maze.brickList) {
        if (br.pop > 0) br.pop--;
        if (br.alive || --br.rebuild > 0) continue;
        const inTheWay = maze.chompers.concat(maze.ghosts).some(o => (o.c === br.c && o.r === br.r) || (o.tc === br.c && o.tr === br.r)) ||
            balls.some(b => Math.abs(b.x - mazeCX(br.c)) < MAZE_CELL && Math.abs(b.y - mazeCY(br.r)) < MAZE_CELL);
        if (inTheWay) {
            br.rebuild = 30;
            continue;
        }
        br.alive = true;
        br.pop = 12;
    }
}

function smashMazeBrick(br) {
    const p = mazeCenter(br.c, br.r);
    br.alive = false;
    br.rebuild = MAZE_BRICK_REBUILD;
    const pts = 30 * (doubleTimer > 0 ? 2 : 1);
    addScore(pts);
    addPopup(p.x, p.y - 12, '+' + pts, '#ff9ae8', { size: 14, life: 0.7 });
    spawnParticles(p.x, p.y, '#ff2fb4', 10);
    beep(520 + Math.random() * 200, 'mazeBrick');
    addShake(2);
    haptic(10);
    for (const m of maze.chompers) m.zoomT = Math.max(m.zoomT, MAZE_BRICK_ZOOM); // a little push for both
    // Drops: often an AIM (the Guided powerup, which here homes the ball in on a chomper)
    const roll = Math.random();
    if (roll < 0.14) dropPowerup('guided', p.x, p.y);
    else if (roll < 0.22) spawnPowerup(p.x, p.y);
}

function mazeDotCount() {
    let n = 0;
    for (const row of maze.dots) for (const d of row) if (d) n++;
    return n;
}

// Move toward the centre of cell (tc, tr) by `move` px; true on arrival (leftover movement is dropped)
function stepToCell(o, move) {
    const tx = mazeCX(o.tc), ty = mazeCY(o.tr);
    const d = Math.hypot(tx - o.x, ty - o.y);
    if (d > move) {
        o.x += (tx - o.x) / d * move;
        o.y += (ty - o.y) / d * move;
        return false;
    }
    o.x = tx;
    o.y = ty;
    o.c = o.tc;
    o.r = o.tr;
    return true;
}

// --- The chompers ---
// The first step of the shortest path from (c, r) to the nearest dot, or null if there is none. A wary
// chomper plans around the cells hungry ghosts are in or about to be in, unless that leaves no way.
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

function chomperEat(m) {
    const kind = maze.dots[m.r][m.c];
    if (!kind || maze.cleared) return;
    maze.dots[m.r][m.c] = 0;
    bricksLeft--;
    runStats.bricks++;
    maybeDropMazeCheatCapsule();
    addScore((kind === 2 ? 50 : 10) * (m.zoomT > 0 ? 2 : 1) * (doubleTimer > 0 ? 2 : 1)); // boosted eating pays double
    maze.waka = !maze.waka;
    tone(maze.waka ? 220 : 330, 0.05, { type: 'triangle', vol: 0.12, slideTo: maze.waka ? 330 : 220, key: 'waka' });
    if (kind === 2) {
        addPopup(m.x, m.y - 18, 'POWER!', '#ffffff', { size: 18, life: 1, pop: true });
        spawnParticles(m.x, m.y, MAZE_DOT_COLOR, 10);
        scareGhosts();
    }
    if (bricksLeft <= 0) mazeGoalReached();
}

// A maze has no gold brick to hide a level code in: instead it gets one roll, at the normal per-level chance,
// once half the quota's eaten, dropping the capsule from the bottom of the maze toward the paddle
function maybeDropMazeCheatCapsule() {
    if (!plan.cheatEligible || maze.cheatRolled || bricksLeft > maze.goal / 2) return;
    maze.cheatRolled = true;
    if (Math.random() < cheatChance()) spawnCheatCapsule(CANVAS_W / 2, mazeCellY(MAZE_ROWS) + 10);
}

// Quota eaten: the level's done, with a bonus for the time left on the clock
// Quota eaten: a victory lap before the next level. Play freezes (the clock stops, nothing can be lost: the
// ball just bounces off the bottom), the maze flashes like the arcade's level clear, the ghosts pop one by
// one for a bonus each, the chompers hop for joy under fireworks, and then it's on to the next level.
const MAZE_CELEBRATION_FRAMES = 60 * 3;

function mazeGoalReached() {
    if (maze.cleared) return;
    maze.cleared = 1;
    const secs = Math.ceil(maze.time / 60);
    const bonus = 50 * secs * (doubleTimer > 0 ? 2 : 1);
    addScore(bonus);
    addPopup(CANVAS_W / 2, 230, 'MAZE CLEARED!', '#ffe14d', { size: 32, life: 2.6, rise: 0.15, pop: true });
    addPopup(CANVAS_W / 2, 290, secs + 's LEFT: TIME BONUS +' + bonus, '#ffffff', { size: 20, life: 2.6, rise: 0.15, pop: true });
    noteMoment(60, 'MAZE CLEARED!');
    playWinJingle();
    addShake(6);
    haptic([30, 60, 30, 60, 80], true);
    keepWhere(powerups, p => p.type === 'cheatcode'); // (a level code in the air still gets its chance)
}

function mazeCelebrating() {
    return !!(maze && maze.cleared);
}

function updateMazeCelebration() {
    const t = maze.cleared++;
    // The ghosts pop, one every quarter second
    const live = maze.ghosts.filter(g => !g.popped);
    if (t % 15 === 10 && live.length) {
        const g = live[0];
        g.popped = true;
        const pts = 200 * (doubleTimer > 0 ? 2 : 1);
        addScore(pts);
        addBlast(g.x, g.y);
        spawnParticles(g.x, g.y, g.color, 16);
        addPopup(g.x, g.y - 16, '+' + pts, g.color, { size: 18, life: 1, pop: true });
        tone(500 + 150 * (4 - live.length), 0.12, { type: 'square', vol: 0.16, key: 'ghostPop', force: true });
    }
    // Fireworks
    if (t % 12 === 0) {
        const x = 90 + Math.random() * (CANVAS_W - 180), y = 110 + Math.random() * 280;
        addBlast(x, y);
        spawnParticles(x, y, ['#ffe14d', '#ff2fb4', '#2de2e6', '#7dea3c'][Math.floor(Math.random() * 4)], 14);
    }
    if (t >= MAZE_CELEBRATION_FRAMES) completeLevel();
}

function updateChomper(m) {
    if (m.hitCool > 0) m.hitCool--;
    if (m.safe > 0) m.safe--;
    if (m.zoomT > 0) m.zoomT--;
    const speed = (m.zoomT > 0 ? CHOMPER_ZOOM_SPEED : CHOMPER_SNIFF_SPEED) * timeScale;
    for (let guard = 0, move = speed; guard < 3 && move > 0; guard++) {
        const tx = mazeCX(m.tc), ty = mazeCY(m.tr);
        const d = Math.hypot(tx - m.x, ty - m.y);
        if (d > move) {
            m.x += (tx - m.x) / d * move;
            m.y += (ty - m.y) / d * move;
            return;
        }
        m.x = tx;
        m.y = ty;
        m.c = m.tc;
        m.r = m.tr;
        move -= d;
        chomperEat(m);
        if (gameState !== 'playing' || !maze) return;
        const next = stepTowardDot(m.c, m.r);
        if (!next) return;
        m.dir = next;
        m.tc = m.c + next[0];
        m.tr = m.r + next[1];
    }
}

// Any ball hit boosts it: a few seconds at three times the speed
function boostChomper(m) {
    m.zoomT = CHOMPER_ZOOM_FRAMES;
    m.pushed = true;
    addPopup(m.x, m.y - 22, 'ZOOM!', m.color, { size: 16, life: 0.7, rise: 1 });
    tone(700, 0.14, { type: 'triangle', vol: 0.16, slideTo: 1400, key: 'chompZoom' });
    spawnParticles(m.x, m.y, m.color, 6);
    haptic(10);
}

// A ghost got a chomper: it's whisked home, and a couple of dots go back into the maze (and off your count)
function catchChomper(m, ghost) {
    const p = mazeCenter(m.home.c, m.home.r);
    spawnParticles(m.x, m.y, m.color, 12);
    addPopup(m.x, m.y - 20, 'CAUGHT! -' + CHOMPER_CAUGHT_DROP, '#ff5a7a', { size: 20, life: 1.2, pop: true });
    tone(600, 0.35, { type: 'sawtooth', vol: 0.2, slideTo: 150, key: 'chompCaught', force: true });
    addShake(5);
    haptic([30, 30, 50], true);
    Object.assign(m, { x: p.x, y: p.y, c: m.home.c, r: m.home.r, tc: m.home.c, tr: m.home.r, zoomT: 0, safe: 180 });
    const empty = [];
    maze.dots.forEach((row, r) => row.forEach((k, c) => { if (!k && '.o'.includes(MAZE_ART[r][c])) empty.push([c, r]); })); // (never under a brick or on a start)
    for (let i = 0; i < CHOMPER_CAUGHT_DROP && empty.length; i++) {
        const [c, r] = empty.splice(Math.floor(Math.random() * empty.length), 1)[0];
        maze.dots[r][c] = 1;
    }
    bricksLeft = Math.min(maze.goal, bricksLeft + CHOMPER_CAUGHT_DROP);
    ghostGoHome(ghost, 60 * 3); // the ghost's had its fun
    if (!mazeCatchTipShown) {
        mazeCatchTipShown = true;
        addPopup(CANVAS_W / 2, 440, 'BOP THE GHOSTS WITH THE BALL TO PROTECT THE CHOMPERS!', '#ffffff', { size: 17, life: 2.6, rise: 0.15, pop: true });
    }
}

// Out of time: costs a life, and the clock restarts (what's been eaten stays eaten)
function mazeTimeUp() {
    addPopup(CANVAS_W / 2, 300, 'TIME UP!', '#ff5a7a', { size: 30, life: 1.6, rise: 0.3, pop: true });
    tone(300, 0.6, { type: 'sawtooth', vol: 0.25, slideTo: 80, key: 'timeUp', force: true });
    maze.time = 60 * MAZE_EXTRA_SECONDS;
    loseLife();
}

// --- Ghost brains ---
// Where each ghost is heading when it isn't scared: the red chaser goes straight for a chomper, the pink
// ambusher for where it's going, the cyan patroller keeps to the bottom row above your paddle (it
// does most of the swooping), and the orange shy one stalks the chomper until it's close, then loses its
// nerve and wanders off to a corner.
function ghostTarget(ghost) {
    // Each goes after whichever chomper is nearer to it
    const m = maze.chompers.reduce((a, b) => (Math.hypot(a.x - ghost.x, a.y - ghost.y) <= Math.hypot(b.x - ghost.x, b.y - ghost.y) ? a : b));
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
            const dist = Math.hypot(mazeCX(ghost.c + d[0]) - t.x, mazeCY(ghost.r + d[1]) - t.y);
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
        ghost.y += ghost.vy; // (vy already includes timeScale, via ghostSpeed)
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
        const x = Math.max(mazeCX(0), Math.min(mazeCX(MAZE_COLS - 1), ghost.x));
        if (flyTo(ghost, mazeCX(mazeCellAt(x, 0).c), mazeCY(MAZE_ROWS - 1), ghostSpeed(ghost))) rejoinMaze(ghost);
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
    if (!maze || gameState !== 'playing') return; // (a ball lost earlier this step may already have ended play)
    if (maze.cleared) {
        maze.t++;
        updateMazeCelebration();
        return;
    }
    maze.t++;
    if (maze.fright > 0 && --maze.fright === 0) {
        for (const ghost of maze.ghosts) if (ghost.mode === 'fright') ghost.mode = 'chase';
    }
    for (const m of maze.chompers) {
        updateChomper(m);
        if (!maze || gameState !== 'playing') return;
    }
    // The clock (ticking audibly through the last ten seconds)
    maze.time--;
    if (maze.time <= 600 && maze.time % 60 === 0 && maze.time > 0) tone(maze.time <= 180 ? 1200 : 900, 0.04, { type: 'square', vol: 0.1, key: 'mazeTick' });
    if (maze.time <= 0) {
        mazeTimeUp();
        return;
    }
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
    updateMazeBricks();
    // With every power pellet gone, a new one turns up now and then, so the ghosts can always be turned
    if (!maze.dots.some(row => row.includes(2)) && --maze.powerIn <= 0) {
        const free = [];
        maze.dots.forEach((row, r) => row.forEach((k, c) => { if (!k && '.oM'.includes(MAZE_ART[r][c])) free.push([c, r]); })); // (never under a brick)
        if (free.length) {
            const [c, r] = free[Math.floor(Math.random() * free.length)];
            maze.dots[r][c] = 2;
        }
        maze.powerIn = 60 * 18;
    }
    for (const ghost of maze.ghosts) {
        updateGhost(ghost);
        // Ghost meets chomper: a hungry ghost catches it, a scared one gets eaten by it
        if (ghost.mode !== 'chase' && ghost.mode !== 'fright') continue;
        for (const m of maze.chompers) {
            if (Math.hypot(ghost.x - m.x, ghost.y - m.y) > GHOST_R + CHOMPER_R - 4) continue;
            if (ghost.mode === 'fright') eatGhost(ghost);
            else if (m.safe <= 0) catchChomper(m, ghost);
            break;
        }
    }
}

// --- The ball in the maze ---
function mazeBallCollision(b) {
    if (!maze || maze.cleared) return;
    // (The walls only steer the chompers and the ghosts: the ball flies straight over them)
    // Bricks: the ball bounces off the one it's deepest into, and smashes it
    const c0 = Math.floor((b.x - b.r - MAZE_LEFT) / MAZE_CELL), c1 = Math.floor((b.x + b.r - MAZE_LEFT) / MAZE_CELL);
    const r0 = Math.floor((b.y - b.r - MAZE_TOP) / MAZE_CELL), r1 = Math.floor((b.y + b.r - MAZE_TOP) / MAZE_CELL);
    let best = null;
    for (let c = c0; c <= c1; c++) {
        for (let r = r0; r <= r1; r++) {
            const br = maze.bricks[c * 16 + r];
            if (c < 0 || r < 0 || c >= MAZE_COLS || r >= MAZE_ROWS || !br || !br.alive || MAZE_ART[r][c] !== 'B') continue;
            const hit = rectContact(b, mazeCellX(c) + 3, mazeCellY(r) + 3, MAZE_CELL - 6, MAZE_CELL - 6);
            if (hit && (!best || hit.d2 < best.hit.d2)) best = { br, hit };
        }
    }
    if (best) {
        if (fireTimer <= 0 && best.br.r < MAZE_LOW_BRICK_ROW) bounceOffRect(b, mazeCellX(best.br.c) + 3, mazeCellY(best.br.r) + 3, MAZE_CELL - 6, MAZE_CELL - 6, best.hit);
        smashMazeBrick(best.br);
    }
    // A chomper: any touch boosts it, and the ball flies on through (no bounce to aim)
    for (const m of maze.chompers) {
        if (m.hitCool <= 0 && m.safe <= 0 && Math.hypot(b.x - m.x, b.y - m.y) < CHOMPER_HIT_R) {
            m.hitCool = 30;
            boostChomper(m);
        }
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

// Guided ball: go for a chomper that isn't boosted, or a ghost (a scared one best); the ball flies over the
// walls, so nothing blocks a shot
function bestAimMaze(x, y) {
    const speed = currentSpeed();
    // The AIM drop (the Guided powerup, here): straight at a chomper, leading it a little. The one that isn't
    // already zooming, and of those the nearer.
    if (guidedTimer > 0) {
        const pick = maze.chompers.slice().sort((a, b) => (a.zoomT > 0) - (b.zoomT > 0) || Math.hypot(a.x - x, a.y - y) - Math.hypot(b.x - x, b.y - y))[0];
        const t = Math.hypot(pick.x - x, pick.y - y) / speed;
        const sp = pick.zoomT > 0 ? CHOMPER_ZOOM_SPEED : CHOMPER_SNIFF_SPEED;
        const tx = pick.x + pick.dir[0] * sp * t, ty = pick.y + pick.dir[1] * sp * t;
        const d = Math.hypot(tx - x, ty - y) || 1;
        return { vx: (tx - x) / d * speed, vy: Math.min(-0.3 * speed, (ty - y) / d * speed), chomper: pick };
    }
    let best = null, bestV = 0;
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
            for (const m of maze.chompers) if (Math.hypot(m.x - px, m.y - py) < CHOMPER_HIT_R) v = Math.max(v, m.zoomT > 60 ? 2 : 10);
            const bc = Math.floor((px - MAZE_LEFT) / MAZE_CELL), brr = Math.floor((py - MAZE_TOP) / MAZE_CELL);
            const brick = bc >= 0 && bc < MAZE_COLS && brr >= 0 && brr < MAZE_ROWS && MAZE_ART[brr][bc] === 'B' && maze.bricks[bc * 16 + brr];
            if (brick && brick.alive) v = Math.max(v, 4); // a brick is worth smashing too
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
// The walls' layer covers just the maze (plus a little margin for the outlines), not the whole screen:
// blitting a full-screen layer every frame doubled the fill work on phones for mostly empty pixels
const MAZE_LAYER_PAD = 6;
const MAZE_LAYER_W = MAZE_COLS * MAZE_CELL + 2 * MAZE_LAYER_PAD;
const MAZE_LAYER_H = MAZE_ROWS * MAZE_CELL + 2 * MAZE_LAYER_PAD;

// The walls, painted once as thin double neon-blue outlines round each run of wall, like the arcade's (no
// fill: they're lines the chomper can't cross, not blocks, and the ball flies over them)
function paintMaze(g) {
    const S = MAZE_CELL;
    for (const [inset, color, width] of [[6, '#2de2e6', 2.5], [11, '#a06cff', 1.2]]) { // cyan outside, violet inside
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
// One big round eye, its pupil looking the way it's going, with a glint
function drawGhostEye(x, y, dir) {
    const ey = y - 3;
    ctx.fillStyle = '#ffffff';
    ctx.beginPath();
    ctx.ellipse(x, ey, 7, 7.5, 0, 0, Math.PI * 2);
    ctx.fill();
    ctx.fillStyle = '#1a1040';
    ctx.beginPath();
    ctx.arc(x + dir[0] * 3, ey + dir[1] * 3, 3.6, 0, Math.PI * 2);
    ctx.fill();
    ctx.fillStyle = '#ffffff';
    ctx.fillRect(x + dir[0] * 3 - 2.5, ey + dir[1] * 3 - 2.5, 1.6, 1.6);
}

// A chomper: a disc with a wedge mouth that opens and closes as it goes, facing its way (one yellow, one
// green). Our own twist: a little antenna with a glowing tip, bobbing on top. Until the ball has boosted
// it once, a blinking HIT ME! sign hangs over it.
function drawChomper(m) {
    if (m.safe > 0 && Math.floor(m.safe / 6) % 2 === 0) return; // blinking while it's safe, just home
    const R = CHOMPER_R + 2;
    const zoom = m.zoomT > 0;
    if (m.dir[0]) m.face = m.dir[0]; // it faces the way it last went left or right
    ctx.save();
    ctx.translate(m.x, m.y);
    if (zoom) { // a glow and speed lines behind it
        ctx.fillStyle = 'rgba(255, 255, 255, 0.18)';
        ctx.beginPath();
        ctx.arc(0, 2, R + 6, 0, Math.PI * 2);
        ctx.fill();
        ctx.strokeStyle = 'rgba(255, 255, 255, 0.5)';
        ctx.lineWidth = 1.5;
        ctx.beginPath();
        for (const off of [-6, 0, 6]) {
            ctx.moveTo(-m.dir[0] * (R + 3) + (m.dir[1] ? off : 0), 4 - m.dir[1] * (R + 3) + (m.dir[0] ? off : 0));
            ctx.lineTo(-m.dir[0] * (R + 15) + (m.dir[1] ? off : 0), 4 - m.dir[1] * (R + 15) + (m.dir[0] ? off : 0));
        }
        ctx.stroke();
    }
    // Chomping away: faster while zooming
    const step = Math.floor(maze.t / (zoom ? 3 : 6)) % SLIME_OPENINGS.length;
    const frame = chomperFrame(m.color, m.face || 1, chomperDirIndex(m.dir), step);
    ctx.drawImage(frame, -frame.width / 2, -frame.height / 2 - 6);
    ctx.restore();
    if (!m.pushed && Math.floor(maze.t / 20) % 2 === 0) {
        ctx.font = pixelFont(9);
        ctx.textAlign = 'center';
        ctx.lineWidth = 3;
        ctx.lineJoin = 'round';
        ctx.strokeStyle = 'rgba(0, 0, 0, 0.8)';
        ctx.strokeText('HIT ME!', m.x, m.y + R + 16);
        ctx.fillStyle = m.color;
        ctx.fillText('HIT ME!', m.x, m.y + R + 16);
    }
}

// A chomper is a little space jelly: a glossy dome of slime with big oval eyes, blush cheeks, a round mouth
// that opens and closes as it eats (the body stretching a touch as it gulps) and a tiny antenna with a glowing
// pink bulb. Its eyes look the way it's going, and it faces the way it last went left or right. Every
// frame (colour x facing x gaze x mouth opening) is painted once and cached, so drawing one is one drawImage.
const SLIME_OPENINGS = [0, 0.55, 1, 0.55]; // the chomp cycle
const SLIME_SIZE = 46;                      // the frame canvas (the jelly is about 34px wide)
const SLIME_PALETTES = {
    '#ff9a1f': { body: '#ff9a1f', light: '#ffd49a', dark: '#c95a06', edge: '#7a3300' },
    '#7dea3c': { body: '#7dea3c', light: '#dcffb8', dark: '#3f9e14', edge: '#1f5208' }
};
const DIR_LOOKS = [[1, 0], [0, 1], [-1, 0], [0, -1]]; // by chomperDirIndex
const chomperFrames = {};

function chomperDirIndex(dir) {
    return dir[0] > 0 ? 0 : dir[1] > 0 ? 1 : dir[0] < 0 ? 2 : 3;
}

function chomperFrame(color, face, dirIndex, step) {
    const key = color + face + dirIndex + step;
    if (!chomperFrames[key]) {
        const P = SLIME_PALETTES[color] || SLIME_PALETTES['#ff9a1f'];
        const look = DIR_LOOKS[dirIndex];
        chomperFrames[key] = makeSprite(SLIME_SIZE, SLIME_SIZE, g => paintJelly(g, P, SLIME_OPENINGS[step], look[0] * face, look[1], face));
    }
    return chomperFrames[key];
}

// Painted facing right, then mirrored for facing left (lx: the gaze across, in the painted frame's terms)
function paintJelly(g, P, open, lx, ly, face) {
    const S = SLIME_SIZE;
    g.translate(face > 0 ? 0 : S, 0);
    g.scale(face > 0 ? 1 : -1, 1);
    const cx = S / 2, base = S - 6;
    const w = 16 * (1 + 0.06 * open), h = 20 * (1 - 0.06 * open); // stretches a little as it gulps
    const top = base - h;
    // The dome: a rounded top, soft sides and a flat, wobbly base
    const dome = new Path2D();
    dome.moveTo(cx - w, base);
    dome.bezierCurveTo(cx - w - 1, base - h * 0.55, cx - w * 0.72, top, cx, top);
    dome.bezierCurveTo(cx + w * 0.72, top, cx + w + 1, base - h * 0.55, cx + w, base);
    dome.quadraticCurveTo(cx + w * 0.5, base + 2.5, cx, base + 1);
    dome.quadraticCurveTo(cx - w * 0.5, base + 2.5, cx - w, base);
    dome.closePath();
    // Antenna, behind the dome, with a glowing bulb
    const ax = cx - 4, ay = top + 3;
    g.strokeStyle = P.edge;
    g.lineWidth = 2;
    g.beginPath();
    g.moveTo(ax, ay);
    g.quadraticCurveTo(ax - 3, ay - 5, ax - 1, top - 6);
    g.stroke();
    g.fillStyle = 'rgba(255, 47, 180, 0.35)';
    g.beginPath();
    g.arc(ax - 1, top - 7, 4.5, 0, Math.PI * 2);
    g.fill();
    g.fillStyle = '#ff2fb4';
    g.beginPath();
    g.arc(ax - 1, top - 7, 2.6, 0, Math.PI * 2);
    g.fill();
    g.fillStyle = '#ffd6ef';
    g.fillRect(ax - 2.2, top - 8.4, 1.3, 1.3);
    // Body: lit from the top left, deeper toward the base
    const shade = g.createRadialGradient(cx - w * 0.35, top + h * 0.3, 2, cx, base - h * 0.35, w * 1.35);
    shade.addColorStop(0, P.light);
    shade.addColorStop(0.35, P.body);
    shade.addColorStop(1, P.dark);
    g.fillStyle = shade;
    g.fill(dome);
    g.strokeStyle = P.edge;
    g.lineWidth = 1.6;
    g.stroke(dome);
    // Glossy shine
    g.fillStyle = 'rgba(255, 255, 255, 0.65)';
    g.beginPath();
    g.ellipse(cx - w * 0.5, top + h * 0.3, 3.2, 2, -0.6, 0, Math.PI * 2);
    g.fill();
    g.beginPath();
    g.arc(cx - w * 0.22, top + h * 0.17, 1.2, 0, Math.PI * 2);
    g.fill();
    // Face, nudged the way it's looking
    const fx = cx + 1.5 + lx * 1.8, fy = base - h * 0.52 + ly * 1.6;
    for (const side of [-1, 1]) {
        const ex = fx + side * 5.2, ey = fy;
        g.fillStyle = '#1a1040';
        g.beginPath();
        g.ellipse(ex, ey, 2.6, 3.5, 0, 0, Math.PI * 2);
        g.fill();
        g.fillStyle = '#ffffff';
        g.beginPath();
        g.arc(ex - 0.9, ey - 1.4, 1.1, 0, Math.PI * 2);
        g.fill();
        g.fillStyle = 'rgba(255, 90, 140, 0.55)'; // blush
        g.beginPath();
        g.ellipse(ex + side * 2.6, ey + 4.6, 2.4, 1.3, 0, 0, Math.PI * 2);
        g.fill();
    }
    const mx = fx, my = fy + 5.8;
    if (open < 0.1) { // a little smile
        g.strokeStyle = '#3a0820';
        g.lineWidth = 1.5;
        g.lineCap = 'round';
        g.beginPath();
        g.arc(mx, my - 1.2, 2.2, 0.2 * Math.PI, 0.8 * Math.PI);
        g.stroke();
    } else { // a round "O", with a tongue
        const rx = 1.6 + 2.2 * open, ry = 1.4 + 2.8 * open;
        g.fillStyle = '#3a0820';
        g.beginPath();
        g.ellipse(mx, my, rx, ry, 0, 0, Math.PI * 2);
        g.fill();
        g.fillStyle = '#ff6f98';
        g.beginPath();
        g.ellipse(mx, my + ry * 0.45, rx * 0.7, ry * 0.4, 0, 0, Math.PI * 2);
        g.fill();
    }
}

function drawMaze() {
    if (!maze) return;
    if (!mazeLayer) mazeLayer = makeSprite(MAZE_LAYER_W, MAZE_LAYER_H, g => {
        g.translate(MAZE_LAYER_PAD - MAZE_LEFT, MAZE_LAYER_PAD - MAZE_TOP);
        paintMaze(g);
    });
    const lx = MAZE_LEFT - MAZE_LAYER_PAD, ly = MAZE_TOP - MAZE_LAYER_PAD;
    ctx.drawImage(mazeLayer, lx, ly);
    if (maze.cleared && Math.floor(maze.cleared / 10) % 2 === 0) { // cleared: the walls flash white
        ctx.save();
        ctx.globalCompositeOperation = 'lighter';
        ctx.drawImage(mazeLayer, lx, ly);
        ctx.drawImage(mazeLayer, lx, ly);
        ctx.restore();
    }
    // Dots (one path); power pellets blink
    ctx.fillStyle = MAZE_DOT_COLOR;
    ctx.beginPath();
    for (let r = 0; r < MAZE_ROWS; r++) {
        for (let c = 0; c < MAZE_COLS; c++) {
            if (maze.dots[r][c] !== 1) continue;
            ctx.rect(mazeCX(c) - 4, mazeCY(r) - 4, 8, 8);
        }
    }
    ctx.fill();
    if (Math.floor(maze.t / 15) % 2 === 0) {
        ctx.beginPath();
        for (let r = 0; r < MAZE_ROWS; r++) {
            for (let c = 0; c < MAZE_COLS; c++) {
                if (maze.dots[r][c] !== 2) continue;
                const x = mazeCX(c), y = mazeCY(r);
                ctx.moveTo(x + 11, y);
                ctx.arc(x, y, 11, 0, Math.PI * 2);
            }
        }
        ctx.fill();
    }
    // Bricks (popping back in as they rebuild)
    const brickImg = mazeBrickSprite();
    for (const br of maze.brickList) {
        if (!br.alive) continue;
        const x = mazeCX(br.c), y = mazeCY(br.r);
        if (br.pop > 0) {
            const half = (brickImg.width / 2) * (1 - br.pop / 16);
            ctx.drawImage(brickImg, x - half, y - half, half * 2, half * 2);
        } else {
            ctx.drawImage(brickImg, x - brickImg.width / 2, y - brickImg.height / 2);
        }
    }
    for (const m of maze.chompers) {
        if (!maze.cleared) {
            drawChomper(m);
            continue;
        }
        // Hopping for joy, taking turns
        const hop = Math.abs(Math.sin(maze.cleared / 7 + m.i * 1.5)) * 14;
        drawChomper({ ...m, y: m.y - hop, zoomT: 1, pushed: true, safe: 0 });
    }
    // Ghosts
    const frame = Math.floor(maze.t / 8) % 2;
    for (const ghost of maze.ghosts) {
        if (ghost.popped) continue;
        let x = ghost.x, y = ghost.y;
        if (ghost.mode === 'dive' && ghost.warn > 0) x += Math.sin(ghost.warn * 1.8) * 3; // shivering before the swoop
        if (ghost.mode === 'home') { // just its eye, zipping back to the pen
            drawGhostEye(x, y, [0, -1]);
            continue;
        }
        const scared = ghostScared(ghost);
        const blink = scared && maze.fright < 120 && Math.floor(maze.t / 10) % 2 === 0;
        if (scared) {
            // Scared: pale and see-through, its eye squeezed shut to a worried little line (flashing its
            // colour back as the scare runs out)
            ctx.globalAlpha = 0.6;
            ctx.drawImage(ghostBody(blink ? ghost.color : GHOST_SCARED_COLOR, frame), x - GHOST_R - 2, y - GHOST_R - 1);
            ctx.globalAlpha = 1;
            ctx.strokeStyle = '#1a1040';
            ctx.lineWidth = 2;
            ctx.beginPath();
            ctx.moveTo(x - 5, y - 2);
            ctx.quadraticCurveTo(x, y - 6, x + 5, y - 2);
            ctx.stroke();
        } else {
            ctx.drawImage(ghostBody(ghost.color, frame), x - GHOST_R - 2, y - GHOST_R - 1);
            drawGhostEye(x, y, ghost.mode === 'dive' || ghost.mode === 'rise' ? [0, ghost.mode === 'dive' ? 1 : -1] : ghost.dir);
        }
        if (ghost.mode === 'dive' && ghost.warn > 0 && Math.floor(ghost.warn / 5) % 2 === 0) {
            ctx.font = pixelFont(12);
            ctx.textAlign = 'center';
            ctx.fillStyle = '#ff4d4d';
            ctx.fillText('!', x, y - GHOST_R - 8);
        }
    }
}

// The goal bar across the top (over everything, like a boss's health bar): dots eaten toward the quota,
// and the clock, which turns red and pulses for the last ten seconds
function drawMazeBar() {
    if (!maze || gameState === 'won' || maze.cleared) return;
    const w = 460, x = (CANVAS_W - w) / 2, y = 64, h = 14;
    const eaten = maze.goal - bricksLeft;
    const secs = Math.max(0, Math.ceil(maze.time / 60));
    const low = secs <= 10;
    ctx.save();
    ctx.fillStyle = 'rgba(0, 0, 0, 0.65)';
    ctx.fillRect(x - 3, y - 3, w + 6, h + 6);
    ctx.fillStyle = '#ffe14d';
    ctx.fillRect(x, y, w * Math.min(1, eaten / maze.goal), h);
    ctx.font = pixelFont(12);
    ctx.textAlign = 'center';
    ctx.fillStyle = '#ffffff';
    ctx.fillText('EAT ' + maze.goal + ' DOTS   ' + eaten + ' / ' + maze.goal, CANVAS_W / 2, y - 8);
    const pulse = low ? 1 + 0.15 * Math.abs(Math.sin(maze.t / 8)) : 1;
    ctx.font = pixelFont(Math.round(16 * pulse));
    ctx.textAlign = 'left';
    ctx.fillStyle = low ? '#ff5a7a' : '#ffffff';
    ctx.fillText(Math.floor(secs / 60) + ':' + String(secs % 60).padStart(2, '0'), x + w + 16, y + h);
    ctx.restore();
}

// A maze brick: a bevelled neon-pink block, so it's plain it's something the ball can smash (the walls
// are only thin outlines)
let mazeBrickImg = null;

function mazeBrickSprite() {
    if (!mazeBrickImg) {
        const S = MAZE_CELL - 6;
        mazeBrickImg = makeSprite(S, S, g => {
            g.fillStyle = '#c21e7a';
            g.fillRect(0, 0, S, S);
            g.fillStyle = '#ff6ec7'; // lit top and left bevel
            g.fillRect(0, 0, S, 4);
            g.fillRect(0, 0, 4, S);
            g.fillStyle = '#6e0a45'; // shaded bottom and right
            g.fillRect(0, S - 4, S, 4);
            g.fillRect(S - 4, 0, 4, S);
            g.fillStyle = 'rgba(255, 255, 255, 0.35)';
            g.fillRect(6, 6, 6, 3);
        });
    }
    return mazeBrickImg;
}

// Paint every sprite the maze will need now, while the level's launch screen is up, rather than the first
// time each one turns up mid-play (80-odd little canvases, each a small hitch when made on the spot)
function prewarmMazeSprites() {
    for (const color of CHOMPER_COLORS) {
        for (const face of [1, -1]) for (let dir = 0; dir < 4; dir++) for (let step = 0; step < SLIME_OPENINGS.length; step++) chomperFrame(color, face, dir, step);
    }
    for (const color of GHOST_DEFS.map(d => d.color).concat([GHOST_SCARED_COLOR])) for (const f of [0, 1]) ghostBody(color, f);
    mazeBrickSprite();
}
