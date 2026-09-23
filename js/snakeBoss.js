// === snakeBoss.js ===
// --- Snake boss ---
// A second boss type, picked randomly alongside the mothership from the 2nd boss encounter onward (see
// spawnBoss's dispatch in boss.js). A snake winds around a grid below the boss bar; hitting any part of
// it chops off everything from that point to the tail (hit near the head for a big cut, right at the tip
// for a small one). Leave it alone for a few seconds and it starts regrowing along its own recent path,
// so sustained pressure matters, not just one good shot. A scatter of obstacle bricks blocks the way and
// respawns at random spots after a while, like the mothership's supply crates but as a hazard rather than
// a reward; some are translucent decoys the ball passes straight through, worth avoiding wasting a shot on.
// It fights back too: it periodically spits a poisoned capsule at you (see the venom section below) and
// hisses on its own clock, so the arena has presence even between hits.
let snakeObstacleTimer = 0;
let snakeSpitTimer = 0;
let snakeHissTimer = 0;

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
        obstacles: [], flashT: 0, cool: 0, cheatRolled: false
    };
    snakeObstacleTimer = 0;
    snakeSpitTimer = SNAKE_SPIT_GRACE_FRAMES;
    snakeHissTimer = Math.round(60 * (2 + Math.random() * 2));
    snakeFillObstacles();
    spawnSnakeWall(n);
}

// A moving wall floating between the grid and the player's paddle — a second surface for the ball to
// rally off of on its way in, same mechanics as the sliding walls from level 3+ (see buildWalls in
// level.js), just spawned here since boss arenas otherwise get none of their own.
function spawnSnakeWall(n) {
    const speed = Math.min(SNAKE_WALL_BASE_SPEED + n * SNAKE_WALL_SPEED_PER_N, SNAKE_WALL_MAX_SPEED);
    // Starts out near one edge, not centred: the paddle also spawns centred, and this wall sits close
    // enough above it that starting the two lined up put the very first launch on a near-guaranteed
    // collision course, with barely a beat to react before the rebound came straight back down on top of
    // where the paddle hadn't moved from yet. Starting off to a side keeps the opening launch clear.
    const startLeft = Math.random() < 0.5;
    const x = startLeft ? 20 : CANVAS_W - SNAKE_WALL_W - 20;
    const vx = startLeft ? speed : -speed;
    movingWalls.push({ x, y: SNAKE_WALL_Y, w: SNAKE_WALL_W, h: SNAKE_WALL_H, vx, hits: 0 });
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
    for (const o of B.obstacles) {
        if (!o.alive) continue;
        o.age++;
        // A ghost decoy is normally just cosmetic — but rarely, one arms itself for a short window (see
        // the pulsing red tell in drawSnakeObstacles) and actually hurts if the ball grazes it in time.
        if (o.ghost) {
            if (o.armed) {
                if (--o.armT <= 0) o.armed = false;
            } else if (Math.random() < SNAKE_GHOST_ARM_CHANCE) {
                o.armed = true;
                o.armT = SNAKE_GHOST_ARM_FRAMES;
            }
        }
    }
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

// -- Venom: the boss's own attack --
// A periodic poisoned capsule lobbed from the head on a side-to-side weave (see the curve in
// updatePowerups), so it reads as an attack, not a drop, before you even see its toxic color. Catching
// one — or grazing an armed ghost decoy — applies a short debuff instead of a bonus.
const SNAKE_POISON_LABELS = { mirror: 'MIRRORED!', fast: 'VENOM RUSH!', shrink: 'SHRUNK!' };

function randomPoisonDebuff() {
    return SNAKE_POISON_DEBUFFS[Math.floor(Math.random() * SNAKE_POISON_DEBUFFS.length)];
}

function snakeSpitInterval(n) {
    return Math.round(60 * Math.max(SNAKE_SPIT_INTERVAL_FLOOR,
        SNAKE_SPIT_INTERVAL_MIN - n * SNAKE_SPIT_INTERVAL_PER_N + Math.random() * SNAKE_SPIT_INTERVAL_SPREAD));
}

function snakeSpit() {
    const B = boss;
    if (!B.segments.length) return;
    const head = snakeSegCenter(B.segments[0]);
    powerups.push({
        x: head.x, y: head.y, baseX: head.x, age: 0,
        type: 'poison', debuff: randomPoisonDebuff(), color: SNAKE_POISON_COLOR, vy: SNAKE_SPIT_VY
    });
    spawnParticles(head.x, head.y, SNAKE_POISON_COLOR, 10);
    tone(180, 0.25, { type: 'sawtooth', vol: 0.22, slideTo: 320, key: 'snakeSpit', force: true });
    haptic(20);
}

function snakeUpdateSpit() {
    if (--snakeSpitTimer > 0) return;
    snakeSpitTimer = snakeSpitInterval(boss.n);
    snakeSpit();
}

// A quiet rattling hiss on its own clock, independent of any hit — so the fight has ambient presence
// even in the lull between exchanges, the way a rattlesnake's warning would.
function snakeHiss() {
    const base = 65 + Math.random() * 25;
    for (let i = 0; i < 3; i++) {
        tone(base + i * 16, 0.06, { type: 'sawtooth', vol: 0.09, delay: i * 0.05, force: true });
    }
}

function snakeUpdateHiss() {
    if (--snakeHissTimer > 0) return;
    snakeHissTimer = Math.round(60 * (2.5 + Math.random() * 3));
    snakeHiss();
}

// debuff: 'mirror' | 'fast' | 'shrink'. scale shortens the duration (an armed-decoy graze is unlucky, not
// deliberate, so it stings less than actually catching a spit).
function applyPoison(debuff, scale = 1) {
    addPopup(paddle.x + paddle.w / 2, paddle.y - 10, 'POISONED: ' + SNAKE_POISON_LABELS[debuff], SNAKE_POISON_COLOR,
        { life: 1.3, size: 15, tag: 'powerup' });
    if (debuff === 'mirror') {
        startChaos('fullFlip');
        chaos.total = chaos.left = Math.round(chaos.total * scale);
        // Unlike the scheduled FULL FLIP chaos event (which warns a few seconds ahead — see
        // startChaosWarning in chaos.js), this one lands with zero warning. A free miss covers the
        // disorientation while the player's brain catches up with mirrored controls.
        shield = Math.min(shield + 1, SHIELD_MAX);
        addPopup(paddle.x + paddle.w / 2, paddle.y - 30, 'Free shield!', '#33ddff', { life: 1.4, size: 14, rise: 0.2 });
    } else if (debuff === 'fast') {
        chaos.scale = TIME_WARP.turbo;
        startChaos('timeWarp');
        chaos.total = chaos.left = Math.round(chaos.total * scale);
    } else { // shrink
        wideTimer = 0; // shrink, wide and split all fight over paddle.w; whichever was just caught wins
        splitTimer = 0;
        narrowTimer = SNAKE_POISON_SHRINK_SECONDS * scale;
        const ratio = paddle.w / PADDLE_W;
        if (ratio > 0.55) {
            paddle.w = Math.round(PADDLE_W * 0.55);
            paddle.x = Math.max(0, Math.min(paddle.x, CANVAS_W - paddle.w));
            paddleHoles.length = 0;
        }
        addShake(6);
        tone(160, 0.3, { type: 'sawtooth', vol: 0.22, slideTo: 60, key: 'poisonShrink', force: true });
        haptic([20, 20, 30], true);
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
            // Same cushion the mothership gets on its own intro (see updateBoss in boss.js) — this is
            // usually the player's very first boss fight, so a guaranteed free miss up front keeps an
            // unlucky opening launch from ending the run before the fight has really begun.
            shield = Math.min(shield + 1, SHIELD_MAX);
            addPopup(CANVAS_W / 2, CANVAS_H - 60, 'Free shield!', '#33ddff', { size: 18, life: 1.8, rise: 0.2 }); // by the shield line, clear of the intro card
        }
        B.intro--;
        return;
    }
    if (B.flashT > 0) B.flashT--;
    if (B.cool > 0) B.cool--;
    snakeUpdateObstacles();
    snakeUpdateSpit();
    snakeUpdateHiss();
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
        if (o.ghost) {
            if (o.armed) {
                o.armed = false;
                applyPoison(randomPoisonDebuff(), SNAKE_GHOST_POISON_SCALE);
                spawnParticles(x + SNAKE_CELL / 2, y + SNAKE_CELL / 2, SNAKE_POISON_COLOR, 8);
                addShake(4);
            }
            continue; // still passes straight through either way — it's never a physical obstacle
        }
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
        // Down to its last few segments: the snake's own shot at a cheat-code capsule (mirrors the
        // mothership's ENRAGED phase 3 — see maybeDropBossCheatCapsule), a single roll regardless of how
        // many more hits land after this point.
        if (B.segments.length > 0 && B.segments.length <= SNAKE_ASSIST_SEGMENTS) {
            maybeDropBossCheatCapsule(x + SNAKE_CELL / 2, y + SNAKE_CELL / 2);
        }
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
            noteMoment(45, 'HEAD SHOT!');
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
    noteMoment(100, 'SNAKE DEFEATED!', 30);
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
            if (o.armed) {
                // Armed: a fast, ugly pulse in the same toxic palette as the venom spit — unmistakably
                // different from the lazy cyan dash of an ordinary, harmless decoy.
                ctx.globalAlpha = 0.55 + 0.35 * Math.sin(performance.now() / 60);
                ctx.setLineDash([]);
                ctx.strokeStyle = SNAKE_POISON_COLOR;
                ctx.lineWidth = 2.5;
                ctx.strokeRect(x + 1.5, y + 1.5, SNAKE_CELL - 3, SNAKE_CELL - 3);
            } else {
                ctx.globalAlpha = 0.3 + 0.1 * Math.sin(performance.now() / 300 + o.c);
                ctx.setLineDash([3, 3]);
                ctx.strokeStyle = '#9fd8ff';
                ctx.lineWidth = 1.5;
                ctx.strokeRect(x + 2, y + 2, SNAKE_CELL - 4, SNAKE_CELL - 4);
            }
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
    ctx.font = termFont(19);
    ctx.textAlign = 'center';
    ctx.fillStyle = '#ffffff';
    ctx.fillText('SNAKE ' + roman + '   LENGTH ' + B.segments.length + ' / ' + B.startLength, CANVAS_W / 2, y - 6);
    if (B.sinceHit >= SNAKE_REGROW_DELAY_FRAMES && B.segments.length < B.startLength) {
        ctx.font = termFont(17);
        ctx.fillStyle = '#ff9a2e';
        ctx.fillText('REGROWING', CANVAS_W / 2, y + h + 14);
    }
    ctx.restore();
}
