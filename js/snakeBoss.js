// === snakeBoss.js ===
// --- Snake boss ---
// A second boss type, picked randomly alongside the mothership from the 2nd boss encounter onward (see
// spawnBoss's dispatch in boss.js). A snake winds around a grid below the boss bar; hitting any part of
// it chops off everything from that point to the tail (hit near the head for a big cut, right at the tip
// for a small one). Leave it alone for a few seconds and it starts regrowing along its own recent path,
// so sustained pressure matters, not just one good shot. A scatter of obstacle bricks blocks the way and
// respawns at random spots after a while, like the mothership's supply crates but as a hazard rather than
// a reward; some are translucent decoys the ball passes straight through, worth avoiding wasting a shot on.
let snakeObstacleTimer = 0;

function snakeCellX(c) {
    return SNAKE_LEFT + c * SNAKE_CELL;
}
function snakeCellY(r) {
    return SNAKE_TOP + r * SNAKE_CELL;
}

const SNAKE_DIRS = [[1, 0], [-1, 0], [0, 1], [0, -1]];

function snakeOccupied(c, r, excludeTail) {
    const B = boss;
    for (let i = 0; i < B.segments.length; i++) {
        if (excludeTail && i === B.segments.length - 1) continue; // the tail is about to vacate unless growing
        if (B.segments[i].c === c && B.segments[i].r === r) return true;
    }
    for (const o of B.obstacles) {
        if (o.alive && !o.ghost && o.c === c && o.r === r) return true;
    }
    return false;
}

function snakeValidDirs(willGrow) {
    const B = boss;
    const head = B.segments[0];
    return SNAKE_DIRS.filter(([dc, dr]) => {
        const c = head.c + dc, r = head.r + dr;
        if (c < 0 || c >= SNAKE_COLS || r < 0 || r >= SNAKE_ROWS) return false;
        if (dc === -B.dir[0] && dr === -B.dir[1] && B.segments.length > 1) return false; // no doubling back
        return !snakeOccupied(c, r, !willGrow);
    });
}

// Lays the body out in a boustrophedon (back-and-forth) path from the top-left, since a straight line
// long enough for a late-game snake wouldn't fit across the grid's width. Every consecutive pair of cells
// is grid-adjacent by construction, so the snake starts in a perfectly valid, contiguous shape.
function snakeBoustrophedonPath(length) {
    const path = [{ c: 0, r: Math.floor(SNAKE_ROWS / 2) }];
    let dc = 1;
    while (path.length < length) {
        const last = path[path.length - 1];
        let nc = last.c + dc, nr = last.r;
        if (nc < 0 || nc >= SNAKE_COLS) {
            nc = last.c;
            nr = last.r + 1;
            dc = -dc;
        }
        if (nr >= SNAKE_ROWS) break; // ran out of room (shouldn't happen given the length cap below, but safe)
        path.push({ c: nc, r: nr });
    }
    return path;
}

function spawnSnakeBoss() {
    const n = Math.floor(level / UNLOCK.boss);
    const maxLen = Math.floor(SNAKE_COLS * SNAKE_ROWS * 0.35); // leaves room for obstacles and manoeuvring
    const length = Math.min(8 + 3 * n, maxLen);
    const path = snakeBoustrophedonPath(length);
    const segments = path.slice().reverse(); // segments[0] (the head) is the far end of the path just laid
    const dir = segments.length > 1
        ? [segments[0].c - segments[1].c, segments[0].r - segments[1].r]
        : [1, 0];
    boss = {
        kind: 'snake', n, x: CANVAS_W / 2, y: SNAKE_TOP - 40, intro: 90, dying: 0,
        segments, dir, history: [], startLength: segments.length,
        moveT: 0, moveEvery: Math.max(8, 16 - n),
        sinceHit: 0, regrowT: SNAKE_REGROW_INTERVAL_FRAMES,
        obstacles: [], flashT: 0, cool: 0
    };
    snakeObstacleTimer = 0;
    snakeFillObstacles();
    spawnSnakeWall(n);
}

// A moving wall floating between the grid and the player's paddle — a second surface for the ball to
// rally off of on its way in, same mechanics as the sliding walls from level 3+ (see buildWalls in
// level.js), just spawned here since boss arenas otherwise get none of their own.
function spawnSnakeWall(n) {
    const speed = Math.min(SNAKE_WALL_BASE_SPEED + n * SNAKE_WALL_SPEED_PER_N, SNAKE_WALL_MAX_SPEED);
    movingWalls.push({ x: CANVAS_W / 2 - SNAKE_WALL_W / 2, y: SNAKE_WALL_Y, w: SNAKE_WALL_W, h: SNAKE_WALL_H, vx: speed, hits: 0 });
}

// -- Obstacles: normal ones block the ball and the snake alike; ghost ones are harmless decoys --
function snakeFreeSpot() {
    for (let attempt = 0; attempt < 40; attempt++) {
        const c = Math.floor(Math.random() * SNAKE_COLS);
        const r = Math.floor(Math.random() * SNAKE_ROWS);
        if (snakeOccupied(c, r, false)) continue;
        if (boss.obstacles.some(o => o.alive && o.c === c && o.r === r)) continue;
        return { c, r };
    }
    return null;
}

function snakeObstacleCount() {
    return Math.min(6 + Math.floor(boss.n / 2), 14);
}

function snakeSpawnObstacle() {
    const spot = snakeFreeSpot();
    if (!spot) return false;
    boss.obstacles.push({
        c: spot.c, r: spot.r, alive: true, age: 0,
        ghost: Math.random() < SNAKE_OBSTACLE_GHOST_SHARE
    });
    return true;
}

function snakeFillObstacles() {
    const target = snakeObstacleCount();
    let guard = 0;
    while (boss.obstacles.filter(o => o.alive).length < target && guard++ < target * 3) {
        if (!snakeSpawnObstacle()) break;
    }
}

function snakeUpdateObstacles() {
    const B = boss;
    for (const o of B.obstacles) if (o.alive) o.age++;
    B.obstacles = B.obstacles.filter(o => o.alive || o.age < 20); // keep a broken one around briefly for its fade
    const alive = B.obstacles.filter(o => o.alive).length;
    if (alive < snakeObstacleCount()) {
        if (--snakeObstacleTimer <= 0) {
            snakeSpawnObstacle();
            snakeObstacleTimer = Math.round(60 * (SNAKE_OBSTACLE_RESPAWN_MIN + Math.random() * SNAKE_OBSTACLE_RESPAWN_SPREAD));
        }
    }
}

function snakeBreakObstacle(o) {
    o.alive = false;
    o.age = 0;
    const x = snakeCellX(o.c) + SNAKE_CELL / 2, y = snakeCellY(o.r) + SNAKE_CELL / 2;
    spawnParticles(x, y, SNAKE_OBSTACLE_COLOR, 8);
    addScore(15 * (doubleTimer > 0 ? 2 : 1));
    beep(500, 'snakeObstacle');
    addShake(2);
    if (snakeObstacleTimer <= 0) snakeObstacleTimer = Math.round(60 * (SNAKE_OBSTACLE_RESPAWN_MIN + Math.random() * SNAKE_OBSTACLE_RESPAWN_SPREAD));
    snakeMaybeDropPowerup(x, y);
}

// Like a brick, breaking an obstacle or landing a hit has a normal chance to drop a powerup — the
// snake fight's answer to the mothership's supply crates. Once it's down to its last few segments it's
// a small, fast target that's genuinely hard to land the finishing hit on, so drops get both more
// frequent and deliberately biased toward Multi-ball (more chances to connect) and Shield (room to keep
// chasing it without losing the ball) rather than the full random pool.
function snakeMaybeDropPowerup(x, y) {
    if (boss.segments.length === 0) return; // finishing blow — no drop, nothing left to help with
    if (boss.segments.length <= SNAKE_ASSIST_SEGMENTS) {
        if (Math.random() >= SNAKE_ASSIST_CHANCE) return;
        const assistType = Math.random() < 0.5 ? 'multi' : 'shield';
        const def = POWERUP_TYPES.find(p => p.type === assistType);
        powerups.push({ x, y, type: def.type, label: def.label, color: def.color, vy: 2.5 });
    } else if (Math.random() < POWERUP_CHANCE) {
        spawnPowerup(x, y);
    }
}

// -- Movement & regrowth --
function snakeMove(grow) {
    const B = boss;
    const dirs = snakeValidDirs(grow);
    if (!dirs.length) {
        // Boxed in by the grid edge, an obstacle, and its own coiled body, with nothing about to move
        // out of the way on its own. Rather than freeze forever, give it a couple of ticks' grace (a
        // stray blocker may clear) and then shed a tail segment each stuck tick to squeeze itself free —
        // guaranteed to eventually work since a single remaining segment can always find somewhere to go.
        B.stuckMoves = (B.stuckMoves || 0) + 1;
        if (B.stuckMoves > 2 && B.segments.length > 1) B.segments.pop();
        return;
    }
    B.stuckMoves = 0;
    // Keep going the same way when possible (reads as purposeful movement, not a jittery random walk)
    const keepGoing = dirs.some(([dc, dr]) => dc === B.dir[0] && dr === B.dir[1]);
    const pick = (keepGoing && Math.random() < 0.8) ? B.dir : dirs[Math.floor(Math.random() * dirs.length)];
    B.dir = pick;
    const head = B.segments[0];
    const newHead = { c: head.c + pick[0], r: head.r + pick[1] };
    const oldTail = B.segments[B.segments.length - 1];
    B.history.unshift(oldTail);
    if (B.history.length > B.startLength) B.history.length = B.startLength;
    B.segments.unshift(newHead);
    if (!grow) B.segments.pop();
}

function snakeUpdateRegrow() {
    const B = boss;
    B.sinceHit++;
    if (B.sinceHit < SNAKE_REGROW_DELAY_FRAMES) return false;
    if (B.segments.length >= B.startLength) return false; // fully healed; no need to keep growing
    if (--B.regrowT > 0) return false;
    B.regrowT = SNAKE_REGROW_INTERVAL_FRAMES;
    return true; // this tick's move should grow instead of just shift
}

function updateSnakeBoss() {
    const B = boss;
    B.x = CANVAS_W / 2;
    if (B.dying > 0) {
        updateSnakeDeath();
        return;
    }
    if (B.intro > 0) {
        if (B.intro === 90) {
            addPopup(CANVAS_W / 2, 250, 'A WILD SNAKE APPEARS!', '#8dffab', { size: 28, life: 1.8, rise: 0.3, pop: true });
            tone(260, 0.4, { type: 'sawtooth', vol: 0.22, slideTo: 500, key: 'siren', force: true });
            haptic([50, 30, 50], true);
        }
        B.intro--;
        return;
    }
    if (B.flashT > 0) B.flashT--;
    if (B.cool > 0) B.cool--;
    snakeUpdateObstacles();
    const willGrow = snakeUpdateRegrow();
    if (--B.moveT <= 0) {
        B.moveT = B.moveEvery;
        snakeMove(willGrow);
    }
}

// -- Damage: hitting segment i chops everything from i to the tail off in one go, capped at
// SNAKE_MAX_CUT_FRACTION of its current length so a head shot can never end the fight outright
// (except finishing off a snake that's already down to its last segment) --
function snakeBallCollision(b) {
    const B = boss;
    if (!B || B.intro > 0 || B.dying > 0) return;

    // Obstacles first: solid ones block and break, ghost ones the ball just passes through
    for (const o of B.obstacles) {
        if (!o.alive) continue;
        const x = snakeCellX(o.c), y = snakeCellY(o.r);
        const cx = Math.max(x, Math.min(b.x, x + SNAKE_CELL));
        const cy = Math.max(y, Math.min(b.y, y + SNAKE_CELL));
        const dx = b.x - cx, dy = b.y - cy;
        if (dx * dx + dy * dy >= b.r * b.r) continue;
        if (o.ghost) continue; // no effect at all: a decoy, not an obstacle
        snakeBreakObstacle(o);
        if (fireTimer <= 0) {
            if (Math.abs(dx) > Math.abs(dy)) {
                const dir = dx >= 0 ? 1 : -1;
                b.vx = dir * Math.abs(b.vx);
                b.x = dir > 0 ? x + SNAKE_CELL + b.r : x - b.r;
            } else {
                const dir = dy >= 0 ? 1 : -1;
                b.vy = dir * Math.abs(b.vy);
                b.y = dir > 0 ? y + SNAKE_CELL + b.r : y - b.r;
            }
        }
        return;
    }

    if (B.cool > 0) return;
    for (let i = 0; i < B.segments.length; i++) {
        const seg = B.segments[i];
        const x = snakeCellX(seg.c), y = snakeCellY(seg.r);
        const cx = Math.max(x, Math.min(b.x, x + SNAKE_CELL));
        const cy = Math.max(y, Math.min(b.y, y + SNAKE_CELL));
        const dx = b.x - cx, dy = b.y - cy;
        if (dx * dx + dy * dy >= b.r * b.r) continue;

        // The cut always starts at the hit point and runs to the tail (small near the tip, big near the
        // head) — but it can't go past this hit's minimum survivors, so even a clean head shot leaves
        // roughly half the body standing. The last segment is exempt: it's always finishable in one hit.
        let minSurvivors = Math.min(Math.ceil(B.segments.length * (1 - SNAKE_MAX_CUT_FRACTION)), B.segments.length - 1);
        const effectiveIndex = Math.max(i, minSurvivors);
        const cut = B.segments.length - effectiveIndex; // how much of it this hit actually chops off
        B.segments.length = effectiveIndex;
        B.sinceHit = 0;
        B.regrowT = SNAKE_REGROW_INTERVAL_FRAMES;
        B.flashT = 6;
        B.cool = 8;
        const dmg = (fireTimer > 0 ? 2 : 1) * cut;
        const scoreGain = 12 * dmg * (doubleTimer > 0 ? 2 : 1);
        addScore(scoreGain);
        spawnParticles(x + SNAKE_CELL / 2, y + SNAKE_CELL / 2, i === 0 ? SNAKE_HEAD_COLOR : SNAKE_COLOR, 6 + cut);
        addPopup(x + SNAKE_CELL / 2, y, (i === 0 ? 'HEAD SHOT! ' : '') + '-' + cut, i === 0 ? '#ffd23f' : '#8dffab',
            { size: i === 0 ? 20 : 15, pop: i === 0, life: 0.9 });
        snakeMaybeDropPowerup(x + SNAKE_CELL / 2, y + SNAKE_CELL / 2);
        addShake(i === 0 ? 8 : 2 + cut * 0.3);
        haptic(i === 0 ? [25, 25, 40] : 15, i === 0);
        if (i === 0) {
            tone(700, 0.1, { type: 'triangle', vol: 0.22, key: 'snakeCrit' });
            tone(1050, 0.14, { type: 'triangle', vol: 0.22, delay: 0.06, force: true });
        } else {
            clink();
        }
        if (fireTimer <= 0) {
            if (Math.abs(dx) > Math.abs(dy)) {
                const dir = dx >= 0 ? 1 : -1;
                b.vx = dir * Math.abs(b.vx);
                b.x = dir > 0 ? x + SNAKE_CELL + b.r : x - b.r;
            } else {
                const dir = dy >= 0 ? 1 : -1;
                b.vy = dir * Math.abs(b.vy);
                b.y = dir > 0 ? y + SNAKE_CELL + b.r : y - b.r;
            }
        }
        if (B.segments.length === 0) killSnake();
        return;
    }
}

function snakeBreather() {
    if (boss && boss.kind === 'snake' && boss.dying <= 0) {
        boss.sinceHit = 0; // a lost ball buys a little breathing room before regrowth resumes
        boss.regrowT = SNAKE_REGROW_INTERVAL_FRAMES;
    }
}

function killSnake() {
    const B = boss;
    B.dying = 90;
    addShake(10);
    haptic([50, 30, 50, 30, 100], true);
    tone(380, 0.5, { type: 'sawtooth', vol: 0.28, slideTo: 40, key: 'bossDie', force: true });
    addPopup(CANVAS_W / 2, 250, 'SNAKE DEFEATED!', '#8dffab', { size: 28, life: 2, rise: 0.2, pop: true });
}

function updateSnakeDeath() {
    const B = boss;
    B.dying--;
    if (B.dying % 5 === 0 && B.history.length) {
        const seg = B.history[Math.floor(Math.random() * B.history.length)];
        const x = snakeCellX(seg.c) + SNAKE_CELL / 2, y = snakeCellY(seg.r) + SNAKE_CELL / 2;
        addBlast(x, y);
        spawnParticles(x, y, Math.random() < 0.5 ? SNAKE_COLOR : '#ffffff', 8);
        addShake(4);
        beep(200 + Math.random() * 300, 'snakeBoom');
    }
    if (B.dying <= 0) finishSnakeBoss();
}

function finishSnakeBoss() {
    const points = 1500 * boss.n * (doubleTimer > 0 ? 2 : 1);
    addScore(points);
    runStats.bosses++;
    lives = Math.min(lives + 1, 5);
    boss = null;
    addPopup(CANVAS_W / 2, 210, 'BOSS DEFEATED! +' + points, '#8dffab', { size: 26, life: 2.4, rise: 0.2, pop: true });
    addPopup(CANVAS_W / 2, 245, '+1 LIFE', '#33cc33', { size: 20, life: 2.4, rise: 0.2 });
    completeLevel();
}

// For the guided ball: every solid (non-ghost) segment and obstacle as a target rectangle
function snakeRects() {
    const B = boss;
    if (!B || B.intro > 0 || B.dying > 0) return [];
    const rects = B.segments.map(s => [snakeCellX(s.c), snakeCellY(s.r), snakeCellX(s.c) + SNAKE_CELL, snakeCellY(s.r) + SNAKE_CELL]);
    for (const o of B.obstacles) {
        if (o.alive && !o.ghost) rects.push([snakeCellX(o.c), snakeCellY(o.r), snakeCellX(o.c) + SNAKE_CELL, snakeCellY(o.r) + SNAKE_CELL]);
    }
    return rects;
}

// -- Drawing --
// The body is drawn as one continuous rounded stroke through each segment's centre (round joins/caps
// give it the smooth, curvy look of Snake Xenzia rather than a row of separate brick tiles), with a
// darker outline pass underneath for definition and a circular head cap with eyes on top.
let snakeObstacleSprite = null;
function drawSnakeObstacles() {
    if (!snakeObstacleSprite) {
        snakeObstacleSprite = makeSprite(SNAKE_CELL, SNAKE_CELL, g => {
            g.fillStyle = SNAKE_OBSTACLE_COLOR;
            roundRectOn(g, 1, 1, SNAKE_CELL - 2, SNAKE_CELL - 2, 5);
            g.fill();
            g.fillStyle = 'rgba(255, 255, 255, 0.15)';
            g.fillRect(2, 2, SNAKE_CELL - 4, (SNAKE_CELL - 4) / 2);
            g.strokeStyle = 'rgba(0, 0, 0, 0.4)';
            g.lineWidth = 1;
            roundRectOn(g, 1, 1, SNAKE_CELL - 2, SNAKE_CELL - 2, 5);
            g.stroke();
        });
    }
    for (const o of boss.obstacles) {
        if (!o.alive) continue;
        const x = snakeCellX(o.c), y = snakeCellY(o.r);
        if (o.ghost) {
            ctx.save();
            ctx.globalAlpha = 0.3 + 0.1 * Math.sin(performance.now() / 300 + o.c);
            ctx.setLineDash([3, 3]);
            ctx.strokeStyle = '#9fd8ff';
            ctx.lineWidth = 1.5;
            ctx.strokeRect(x + 2, y + 2, SNAKE_CELL - 4, SNAKE_CELL - 4);
            ctx.restore();
        } else {
            const k = Math.min(1, o.age / 10);
            ctx.save();
            ctx.globalAlpha = k;
            ctx.drawImage(snakeObstacleSprite, x, y);
            ctx.restore();
        }
    }
}

function snakeSegCenter(seg) {
    return { x: snakeCellX(seg.c) + SNAKE_CELL / 2, y: snakeCellY(seg.r) + SNAKE_CELL / 2 };
}

function strokeSnakePath(pts) {
    ctx.beginPath();
    ctx.moveTo(pts[0].x, pts[0].y);
    for (let i = 1; i < pts.length; i++) ctx.lineTo(pts[i].x, pts[i].y);
    ctx.stroke();
}

function drawSnakeEyes(head, dir, w) {
    const nx = -dir[1], ny = dir[0]; // perpendicular to travel direction
    const fwd = w * 0.2, off = w * 0.22;
    ctx.fillStyle = '#123018';
    for (const side of [-1, 1]) {
        ctx.beginPath();
        ctx.arc(head.x + dir[0] * fwd + nx * off * side, head.y + dir[1] * fwd + ny * off * side, 2.4, 0, Math.PI * 2);
        ctx.fill();
    }
}

function drawSnakeBoss() {
    const B = boss;
    if (!B) return;
    if (B.intro > 0) return; // the "A WILD SNAKE APPEARS!" popup is fired once from updateSnakeBoss
    drawSnakeObstacles();
    const pts = B.segments.map(snakeSegCenter);
    const w = SNAKE_CELL * 0.82;
    ctx.save();
    ctx.lineJoin = 'round';
    ctx.lineCap = 'round';
    if (pts.length === 1) {
        ctx.fillStyle = 'rgba(0, 0, 0, 0.35)';
        ctx.beginPath();
        ctx.arc(pts[0].x, pts[0].y, w / 2 + 1.5, 0, Math.PI * 2);
        ctx.fill();
    } else {
        ctx.strokeStyle = 'rgba(0, 0, 0, 0.35)';
        ctx.lineWidth = w + 3;
        strokeSnakePath(pts);
        ctx.strokeStyle = SNAKE_COLOR;
        ctx.lineWidth = w;
        strokeSnakePath(pts);
    }
    // The head is its own lighter cap drawn on top, so it always reads clearly at the front
    ctx.fillStyle = SNAKE_HEAD_COLOR;
    ctx.beginPath();
    ctx.arc(pts[0].x, pts[0].y, w / 2 + (pts.length === 1 ? 0 : 1), 0, Math.PI * 2);
    ctx.fill();
    drawSnakeEyes(pts[0], B.dir, w);
    if (B.flashT > 0) {
        ctx.globalAlpha = (B.flashT / 6) * 0.6;
        ctx.fillStyle = '#ffffff';
        ctx.beginPath();
        ctx.arc(pts[0].x, pts[0].y, w / 2 + 2, 0, Math.PI * 2);
        ctx.fill();
        ctx.globalAlpha = 1;
    }
    ctx.restore();
}

function drawSnakeBossBar() {
    const B = boss;
    if (!B || B.dying > 0) return;
    const w = 460, x = (CANVAS_W - w) / 2, y = 64, h = 12;
    const ratio = B.segments.length / B.startLength;
    const roman = ['', 'I', 'II', 'III', 'IV', 'V', 'VI', 'VII', 'VIII', 'IX', 'X'][B.n] || B.n;
    ctx.save();
    ctx.fillStyle = 'rgba(0, 0, 0, 0.65)';
    ctx.fillRect(x - 3, y - 3, w + 6, h + 6);
    ctx.fillStyle = ratio > 0.66 ? '#4de08c' : ratio > 0.33 ? '#ff9a2e' : '#ff4d4d';
    ctx.fillRect(x, y, w * Math.max(0, ratio), h);
    ctx.font = 'bold 12px sans-serif';
    ctx.textAlign = 'center';
    ctx.fillStyle = '#ffffff';
    ctx.fillText('SNAKE ' + roman + '   LENGTH ' + B.segments.length + ' / ' + B.startLength, CANVAS_W / 2, y - 6);
    if (B.sinceHit >= SNAKE_REGROW_DELAY_FRAMES && B.segments.length < B.startLength) {
        ctx.font = 'bold 11px sans-serif';
        ctx.fillStyle = '#ff9a2e';
        ctx.fillText('REGROWING', CANVAS_W / 2, y + h + 14);
    }
    ctx.restore();
}
