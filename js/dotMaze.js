// === dotMaze.js ===
// --- Dot Maze levels ---
// A level type after Pac-Man. Instead of bricks there's a neon maze full of dots, and the ball eats every
// dot it flies over: clear them all to finish the level. The walls are solid, so the ball rattles about
// the corridors like a pinball. Four ghosts roam the maze, each after something different, and are solid
// to the ball too. Every so often one of them swoops out of the bottom of the maze at your paddle and
// bites a hole in it; hit a swooping ghost with the ball to send it home. The four big dots turn every
// ghost blue for a few seconds, and then the ball eats them, for 200, 400, 800, 1600 points. A fire ball
// eats ghosts whatever colour they are.

const MAZE_UNLOCK = 14;           // curve level of the first one (level 19), then about 1 level in 7
const MAZE_CELL = 36;
const MAZE_ART = [
    'o.........#.#.........o',
    '.##.###.#.....#.###.##.',
    '.....#...#GGG#...#.....',
    '..#...#..#####..#...#..',
    '.#.#...#.......#...#.#.',
    '.#.###.#.#.#.#.#.###.#.',
    'o.....................o'
];
const MAZE_COLS = MAZE_ART[0].length;
const MAZE_ROWS = MAZE_ART.length;
const MAZE_LEFT = (CANVAS_W - MAZE_COLS * MAZE_CELL) / 2;
const MAZE_TOP = 74;
const MAZE_PEN = { c: 11, r: 2 };         // the ghosts' home, in the middle
const MAZE_DOOR = { c: 11, r: 1 };        // the open cell above it they leave by
const GHOST_R = 14;
// Our own four ghosts (see ghostTarget for what each one is after)
const GHOST_DEFS = [
    { role: 'chaser', color: '#ff3b5c', release: 0 },
    { role: 'ambusher', color: '#ff9ae8', release: 60 * 3 },
    { role: 'patroller', color: '#3de0ff', release: 60 * 6 },
    { role: 'shy', color: '#ffb852', release: 60 * 9 }
];
const DIRS = [[1, 0], [-1, 0], [0, 1], [0, -1]];
const mazeLevelCache = {};

let maze = null; // { dots[r][c]: 0 none, 1 dot, 2 power; ghosts, fright, eaten, diveIn, powerIn, t }

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

// Cells a ghost may walk: inside the grid, not a wall, and the pen only when it's allowed in
function ghostOpen(c, r, penOk) {
    if (c < 0 || c >= MAZE_COLS || r < 0 || r >= MAZE_ROWS) return false;
    const ch = MAZE_ART[r][c];
    return ch !== '#' && (penOk || ch !== 'G');
}

function buildMaze() {
    const dots = MAZE_ART.map(row => [...row].map(ch => (ch === '.' ? 1 : ch === 'o' ? 2 : 0)));
    const n = curveLevel();
    maze = {
        dots, t: 0, fright: 0, eaten: 0, powerIn: 0,
        diveIn: 60 * 8,
        ghosts: GHOST_DEFS.map((def, i) => {
            const home = mazeCenter(MAZE_PEN.c - 1 + (i % 3), MAZE_PEN.r);
            return { ...def, i, x: home.x, y: home.y, c: MAZE_PEN.c, r: MAZE_PEN.r, tc: MAZE_PEN.c, tr: MAZE_PEN.r, dir: [0, -1], mode: 'pen', penT: def.release, vx: 0, vy: 0, warn: 0 };
        }),
        speed: Math.min(1.3 + 0.05 * n, 2.2)
    };
    return mazeDotCount();
}

function mazeDotCount() {
    let n = 0;
    for (const row of maze.dots) for (const d of row) if (d) n++;
    return n;
}

// --- Ghost brains ---
// Where each ghost is heading when it isn't scared: the red chaser goes straight for the ball, the pink
// ambusher for where the ball is going, the cyan patroller keeps to the bottom row above your paddle (it does
// most of the swooping), and the orange shy one chases the ball until it gets close, then loses its nerve
// and wanders off to a corner.
function ghostTarget(g) {
    const b = balls.find(bb => !bb.stuck) || balls[0];
    const bx = b ? b.x : CANVAS_W / 2, by = b ? b.y : CANVAS_H;
    if (g.i === 0) return { x: bx, y: by };
    if (g.i === 1) return { x: bx + (b ? b.vx : 0) * 30, y: by + (b ? b.vy : 0) * 30 };
    if (g.i === 2) return { x: paddle.x + paddle.w / 2, y: mazeCellY(MAZE_ROWS - 1) + MAZE_CELL / 2 };
    const d = Math.hypot(g.x - bx, g.y - by);
    return d > MAZE_CELL * 6 ? { x: bx, y: by } : { x: mazeCellX(0), y: mazeCellY(MAZE_ROWS - 1) };
}

// At a cell centre: pick the next cell. No turning back unless it's a dead end.
function ghostChooseDir(g) {
    const penOk = g.mode === 'leave';
    const options = DIRS.filter(([dx, dy]) => ghostOpen(g.c + dx, g.r + dy, penOk) && !(dx === -g.dir[0] && dy === -g.dir[1]));
    const all = options.length ? options : DIRS.filter(([dx, dy]) => ghostOpen(g.c + dx, g.r + dy, penOk));
    if (!all.length) return;
    let pick;
    if (g.mode === 'fright') {
        pick = all[Math.floor(Math.random() * all.length)];
    } else {
        const t = g.mode === 'leave' ? mazeCenter(MAZE_DOOR.c, MAZE_DOOR.r - 1) : ghostTarget(g);
        let best = Infinity;
        for (const d of all) {
            const p = mazeCenter(g.c + d[0], g.r + d[1]);
            const dist = Math.hypot(p.x - t.x, p.y - t.y);
            if (dist < best) {
                best = dist;
                pick = d;
            }
        }
    }
    g.dir = pick;
    g.tc = g.c + pick[0];
    g.tr = g.r + pick[1];
}

function ghostSpeed(g) {
    const base = maze.speed * timeScale;
    if (g.mode === 'fright') return base * 0.55;
    if (g.mode === 'eyes') return 4.5 * timeScale;
    if (g.mode === 'dive') return (2.4 + 0.04 * curveLevel()) * timeScale;
    if (g.mode === 'rise') return 3 * timeScale;
    // The chaser speeds up as the dots run out
    return base * (g.i === 0 && bricksLeft < levelBricksTotal * 0.3 ? 1.25 : 1);
}

function stepGhostOnGrid(g) {
    let move = ghostSpeed(g);
    for (let guard = 0; guard < 3 && move > 0; guard++) {
        const t = mazeCenter(g.tc, g.tr);
        const d = Math.hypot(t.x - g.x, t.y - g.y);
        if (d > move) {
            g.x += (t.x - g.x) / d * move;
            g.y += (t.y - g.y) / d * move;
            return;
        }
        g.x = t.x;
        g.y = t.y;
        g.c = g.tc;
        g.r = g.tr;
        move -= d;
        if (g.mode === 'leave' && g.c === MAZE_DOOR.c && g.r === MAZE_DOOR.r) g.mode = maze.fright > 0 ? 'fright' : 'chase';
        ghostChooseDir(g);
    }
}

// Fly straight at a point; true on arrival
function flyGhostTo(g, x, y, speed) {
    const d = Math.hypot(x - g.x, y - g.y);
    if (d <= speed) {
        g.x = x;
        g.y = y;
        return true;
    }
    g.x += (x - g.x) / d * speed;
    g.y += (y - g.y) / d * speed;
    return false;
}

// Back into the maze: the nearest bottom-row cell, and on with the chase from there
function rejoinMaze(g) {
    const c = Math.max(0, Math.min(MAZE_COLS - 1, Math.floor((g.x - MAZE_LEFT) / MAZE_CELL)));
    g.c = g.tc = c;
    g.r = g.tr = MAZE_ROWS - 1;
    g.dir = [0, -1];
    g.mode = maze.fright > 0 ? 'fright' : 'chase';
    g.scared = false;
}

function startDive(g) {
    g.mode = 'dive';
    g.warn = 40; // it shivers first, so you see it coming
    g.aimX = paddle.x + paddle.w / 2;
    g.vy = 0;
    tone(520, 0.3, { type: 'sawtooth', vol: 0.16, slideTo: 180, key: 'ghostDive' });
    if (!mazeDiveTipShown) {
        mazeDiveTipShown = true;
        addPopup(CANVAS_W / 2, 400, 'A GHOST IS COMING FOR YOUR PADDLE: HIT IT!', '#ffffff', { size: 18, life: 2.4, rise: 0.15, pop: true });
    }
}
let mazeDiveTipShown = false;

function updateGhost(g) {
    if (g.mode === 'pen') {
        g.y = mazeCenter(MAZE_PEN.c, MAZE_PEN.r).y + Math.sin(maze.t / 8 + g.i) * 4; // bobbing, like in the arcade
        if (--g.penT <= 0) {
            g.mode = 'leave';
            const home = mazeCenter(MAZE_PEN.c, MAZE_PEN.r);
            g.x = home.x;
            g.y = home.y;
            g.c = g.tc = MAZE_PEN.c;
            g.r = g.tr = MAZE_PEN.r;
            g.dir = [0, -1];
            ghostChooseDir(g);
        }
        return;
    }
    if (g.mode === 'eyes') {
        const home = mazeCenter(MAZE_PEN.c, MAZE_PEN.r);
        if (flyGhostTo(g, home.x, home.y, ghostSpeed(g))) {
            g.mode = 'pen';
            g.penT = 60 * 3;
        }
        return;
    }
    if (g.mode === 'dive') {
        if (g.warn > 0) {
            g.warn--;
            return;
        }
        // Swoops down at where the paddle was, weaving a little, and homing in gently
        g.aimX += Math.sign(paddle.x + paddle.w / 2 - g.aimX) * 0.8 * timeScale;
        g.vy = Math.min(g.vy + 0.12 * timeScale, ghostSpeed(g));
        g.y += g.vy * timeScale;
        g.x += (g.aimX + Math.sin(maze.t / 9) * 26 - g.x) * 0.06 * timeScale;
        if (g.y > paddle.y - GHOST_R && g.y < paddle.y + paddle.h + GHOST_R) {
            const hit = paddleHit(g.x, g.y, GHOST_R);
            if (hit) {
                if (hit.mirror) blockMirrorBolt(g.x);
                else punchHole(g.x, BOSS_HOLE_SECONDS);
                g.mode = 'rise';
            }
        }
        if (g.y > paddle.y + 40) g.mode = 'rise';
        return;
    }
    if (g.mode === 'rise') {
        const x = Math.max(mazeCellX(0) + MAZE_CELL / 2, Math.min(mazeCellX(MAZE_COLS - 1) + MAZE_CELL / 2, g.x));
        const cx = MAZE_LEFT + (Math.floor((x - MAZE_LEFT) / MAZE_CELL) + 0.5) * MAZE_CELL;
        if (flyGhostTo(g, cx, mazeCenter(0, MAZE_ROWS - 1).y, ghostSpeed(g))) rejoinMaze(g);
        return;
    }
    stepGhostOnGrid(g);
}

function updateMaze() {
    if (!maze) return;
    maze.t++;
    if (maze.fright > 0 && --maze.fright === 0) {
        for (const g of maze.ghosts) if (g.mode === 'fright') g.mode = 'chase';
    }
    // Every so often a ghost on the bottom row (never a scared one) swoops at the paddle
    if (--maze.diveIn <= 0) {
        const bottom = maze.ghosts.filter(g => g.mode === 'chase' && g.r === MAZE_ROWS - 1);
        if (bottom.length) {
            startDive(bottom[Math.floor(Math.random() * bottom.length)]);
            maze.diveIn = Math.round(60 * Math.max(3.5, 9 - 0.15 * curveLevel()) * (0.8 + Math.random() * 0.4));
        } else {
            maze.diveIn = 30;
        }
    }
    // With every big dot eaten, a new one turns up now and then, so the ghosts can always be turned
    if (!maze.dots.some(row => row.includes(2)) && --maze.powerIn <= 0) {
        const free = [];
        maze.dots.forEach((row, r) => row.forEach((d, c) => { if (!d && MAZE_ART[r][c] !== '#' && MAZE_ART[r][c] !== 'G') free.push([c, r]); }));
        if (free.length) {
            const [c, r] = free[Math.floor(Math.random() * free.length)];
            maze.dots[r][c] = 2;
            bricksLeft++;
            levelBricksTotal++;
        }
        maze.powerIn = 60 * 18;
    }
    for (const g of maze.ghosts) updateGhost(g);
}

function frightenGhosts() {
    maze.fright = Math.max(60 * 4, 60 * 7 - 6 * curveLevel());
    maze.eaten = 0;
    maze.powerIn = 60 * 18;
    for (const g of maze.ghosts) {
        if (g.mode === 'chase' || g.mode === 'leave') {
            g.mode = g.mode === 'leave' ? 'leave' : 'fright';
            g.dir = [-g.dir[0], -g.dir[1]]; // they turn tail
            g.tc = g.c + g.dir[0];
            g.tr = g.r + g.dir[1];
            if (!ghostOpen(g.tc, g.tr, false)) { g.tc = g.c; g.tr = g.r; }
        } else if (g.mode === 'dive') {
            g.mode = 'rise'; // a swooping ghost bolts back for the maze
            g.scared = true;
        }
    }
    tone(180, 0.5, { type: 'triangle', vol: 0.2, slideTo: 90, key: 'fright', force: true });
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
    // Dots it flies over
    const cc = Math.floor((b.x - MAZE_LEFT) / MAZE_CELL), rc = Math.floor((b.y - MAZE_TOP) / MAZE_CELL);
    for (let c = cc - 1; c <= cc + 1; c++) {
        for (let r = rc - 1; r <= rc + 1; r++) {
            if (c < 0 || c >= MAZE_COLS || r < 0 || r >= MAZE_ROWS || !maze.dots[r][c]) continue;
            const p = mazeCenter(c, r);
            if (Math.hypot(p.x - b.x, p.y - b.y) > b.r + 13) continue; // generous: the ball sweeps its whole corridor
            eatDot(c, r);
            if (gameState !== 'playing') return; // that was the last one
        }
    }
    // Ghosts
    for (const g of maze.ghosts) {
        if (g.mode === 'eyes' || g.mode === 'pen') continue;
        const dx = b.x - g.x, dy = b.y - g.y;
        if (dx * dx + dy * dy >= (b.r + GHOST_R) * (b.r + GHOST_R)) continue;
        if (g.mode === 'fright' || fireTimer > 0 || (g.mode === 'rise' && g.scared)) {
            eatGhost(g);
        } else if (g.mode === 'dive' || g.mode === 'rise') {
            // Knocked out of the air on its way to your paddle
            bounceOffCircle(b, g.x, g.y, GHOST_R);
            g.mode = 'eyes';
            g.scared = false;
            const pts = 200 * (doubleTimer > 0 ? 2 : 1);
            addScore(pts);
            addPopup(g.x, g.y - 18, 'BOP! +' + pts, g.color, { size: 18, life: 1, pop: true });
            spawnParticles(g.x, g.y, g.color, 10);
            tone(880, 0.12, { type: 'square', vol: 0.18, slideTo: 440, key: 'ghostBop' });
            addShake(3);
            haptic(15);
        } else {
            bounceOffCircle(b, g.x, g.y, GHOST_R); // a ghost in the maze is as solid as a wall
            beep(160, 'ghostBump');
        }
        return;
    }
}

function eatDot(c, r) {
    const power = maze.dots[r][c] === 2;
    maze.dots[r][c] = 0;
    bricksLeft--;
    runStats.bricks++;
    combo++;
    runStats.maxCombo = Math.max(runStats.maxCombo, combo);
    const mult = Math.min(combo, COMBO_MAX) * (doubleTimer > 0 ? 2 : 1);
    addScore((power ? 50 : 10) * mult);
    // The waka-waka: two alternating chomps
    maze.waka = !maze.waka;
    tone(maze.waka ? 220 : 330, 0.05, { type: 'triangle', vol: 0.13, slideTo: maze.waka ? 330 : 220, key: 'waka' });
    if (power) {
        const p = mazeCenter(c, r);
        addPopup(p.x, p.y - 16, 'POWER!', '#ffffff', { size: 18, life: 1, pop: true });
        spawnParticles(p.x, p.y, '#ffb8ae', 10);
        frightenGhosts();
    }
    if (combo >= 3 && combo <= COMBO_MAX && combo !== maze.lastShout) {
        maze.lastShout = combo;
        const p = mazeCenter(c, r);
        comboShout(combo, p.x, p.y);
    }
    if (bricksLeft <= 0) {
        noteMoment(60, 'MAZE CLEARED!');
        completeLevel();
    }
}

function eatGhost(g) {
    const pts = 200 * Math.pow(2, Math.min(maze.eaten, 3)) * (doubleTimer > 0 ? 2 : 1);
    maze.eaten++;
    g.mode = 'eyes';
    g.scared = false;
    addScore(pts);
    addPopup(g.x, g.y - 14, '' + pts, '#00ffff', { size: 20, life: 1.1, pop: true });
    if (maze.eaten === 4) noteMoment(70, 'ALL FOUR GHOSTS!');
    spawnParticles(g.x, g.y, '#2121ff', 12);
    tone(1200, 0.25, { type: 'square', vol: 0.18, slideTo: 300, key: 'eatGhost', force: true });
    addShake(4);
    haptic([15, 20, 25], true);
    if (Math.random() < 0.35) spawnPowerup(g.x, g.y);
}

// A lost ball: the ghosts go home and start over, like after a death in the arcade
function mazeBreather() {
    if (!maze) return;
    maze.fright = 0;
    maze.diveIn = 60 * 6;
    maze.ghosts.forEach((g, i) => {
        const home = mazeCenter(MAZE_PEN.c - 1 + (i % 3), MAZE_PEN.r);
        Object.assign(g, { x: home.x, y: home.y, mode: 'pen', penT: GHOST_DEFS[i].release, scared: false, warn: 0 });
    });
}

// Guided ball: the shot that flies over the most dots before it meets a wall (big dots and scared ghosts extra)
function bestAimMaze(x, y) {
    const speed = currentSpeed();
    let best = null, bestV = 0;
    for (let deg = -70; deg <= 70; deg += 7) {
        const a = (deg * Math.PI) / 180;
        let dx = Math.sin(a);
        const dy = -Math.cos(a);
        let px = x, py = y, v = 0;
        const seen = new Set();
        for (let i = 0; i < 170; i++) {
            px += dx * 5;
            py += dy * 5;
            if (px < BALL_RADIUS || px > CANVAS_W - BALL_RADIUS) dx = -dx;
            if (py < 0) break;
            const c = Math.floor((px - MAZE_LEFT) / MAZE_CELL), r = Math.floor((py - MAZE_TOP) / MAZE_CELL);
            if (mazeWall(c, r)) break;
            if (c >= 0 && c < MAZE_COLS && r >= 0 && r < MAZE_ROWS && maze.dots[r][c] && !seen.has(c * 16 + r)) {
                seen.add(c * 16 + r);
                v += maze.dots[r][c] === 2 && maze.fright <= 0 ? 6 : 1;
            }
            if (maze.fright > 0) for (const g of maze.ghosts) if (g.mode === 'fright' && Math.hypot(g.x - px, g.y - py) < GHOST_R + 6) v += 3;
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
// so neighbouring blocks merge into the arcade's rounded runs of wall
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
    // The pen's door
    const d = mazeCenter(MAZE_PEN.c, MAZE_PEN.r);
    g.fillStyle = '#ffb8ff';
    g.fillRect(d.x - MAZE_CELL * 1.5 + 2, mazeCellY(MAZE_PEN.r) - 2, MAZE_CELL * 3 - 4, 3);
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
            // Three scallops along the hem, shifted half a scallop on the other frame
            const n = 3, w = (2 * R) / n, shift = frame ? w / 2 : 0;
            for (let i = 0; i <= n; i++) {
                const x = cx + R - i * w + shift;
                const xc = Math.max(cx - R, Math.min(cx + R, x - w / 2));
                g.quadraticCurveTo(Math.max(cx - R, Math.min(cx + R, x)), bottom + 2, xc, bottom - 3);
            }
            g.lineTo(cx - R, bottom - 3);
            g.closePath();
            g.fill();
            // A soft sheen on the dome
            g.fillStyle = 'rgba(255, 255, 255, 0.25)';
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

function drawMaze() {
    if (!maze) return;
    if (!mazeLayer) mazeLayer = makeSprite(CANVAS_W, CANVAS_H, paintMaze);
    ctx.drawImage(mazeLayer, 0, 0);
    // Dots (one path), big dots blinking; the last few swell so you can find them
    const few = bricksLeft <= 8;
    const pulse = few ? 2 + Math.sin(maze.t / 6) * 1.5 : 0;
    ctx.fillStyle = '#ffb8ae';
    ctx.beginPath();
    for (let r = 0; r < MAZE_ROWS; r++) {
        for (let c = 0; c < MAZE_COLS; c++) {
            if (maze.dots[r][c] !== 1) continue;
            const p = mazeCenter(c, r);
            const s = 2.5 + pulse;
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
                ctx.moveTo(p.x + 8, p.y);
                ctx.arc(p.x, p.y, 8, 0, Math.PI * 2);
            }
        }
        ctx.fill();
    }
    // Ghosts
    const frame = Math.floor(maze.t / 8) % 2;
    for (const g of maze.ghosts) {
        let x = g.x, y = g.y;
        if (g.mode === 'dive' && g.warn > 0) x += Math.sin(g.warn * 1.8) * 3; // shivering before the swoop
        if (g.mode !== 'eyes') {
            const scared = g.mode === 'fright' || (g.mode === 'rise' && g.scared);
            const blink = scared && maze.fright < 120 && Math.floor(maze.t / 10) % 2 === 0;
            const color = scared ? (blink ? '#ffffff' : '#3b4bff') : g.color;
            ctx.drawImage(ghostBody(color, frame), x - GHOST_R - 2, y - GHOST_R - 1);
            if (scared) {
                // Scared: just two small, worried eyes
                ctx.fillStyle = blink ? '#ff3b5c' : '#ffe0f0';
                ctx.beginPath();
                ctx.arc(x - 5, y - 3, 2.6, 0, Math.PI * 2);
                ctx.arc(x + 5, y - 3, 2.6, 0, Math.PI * 2);
                ctx.fill();
                continue;
            }
        }
        drawGhostEyes(x, y, g.mode === 'dive' || g.mode === 'rise' ? [0, g.mode === 'dive' ? 1 : -1] : g.dir);
        if (g.mode === 'dive' && g.warn > 0 && Math.floor(g.warn / 5) % 2 === 0) {
            ctx.font = pixelFont(12);
            ctx.textAlign = 'center';
            ctx.fillStyle = '#ff4d4d';
            ctx.fillText('!', x, y - GHOST_R - 6);
        }
    }
}
