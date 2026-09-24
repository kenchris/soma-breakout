// === pongBoss.js ===
// --- Pong boss: "The Rival" ---
// An AI paddle guards the top edge of the screen, which is its goal. Get the ball past it to the top wall
// and that's a goal; score enough goals to win the match. It reads where the ball will arrive (side-wall
// bounces included) but moves at a capped speed and aims with a random error each return, so wide angled
// shots beat it. One-way bricks drift about its half of the court (every few seconds each fades out and
// reappears somewhere else): they stop your shots going up (each hit breaks one) but let its returns
// straight through on the way down, so they only ever help it. As it loses it gets harder: from phase 2
// it rebuilds every one you've broken and returns faster "smash" shots, and in phase 3 it splits into twin
// paddles, each guarding its own half of the court, and in a rage calls for backup: three of the regular
// aliens warp in to shoot holes in your paddle. Your paddle and its paddle count as two rally surfaces, so
// a long back-and-forth earns the usual PING PONG bonus too.

function spawnPongBoss(n) {
    const goals = Math.min(4 + n, 12); // 7 at its debut (the 3rd boss encounter)
    const w = PONG_WIDTHS[0];
    boss = {
        kind: 'pong', n, hp: goals, maxHp: goals, x: CANVAS_W / 2, intro: 90, dying: 0, cool: 0, flash: 0,
        paddles: [{ x: (CANVAS_W - w) / 2, w }], err: 0, tracking: null, rivalScore: 0, lastPhase: 1,
        rage: 0, backup: 0, backupIn: 0, wall: buildPongWall()
    };
}

// One-way bricks on PONG_WALL_COUNT distinct random cells of a grid spanning the court's width, from just
// under the rival's paddle down towards the net; each with its own hop clock, staggered
function buildPongWall() {
    const wall = [];
    for (let i = 0; i < PONG_WALL_COUNT; i++) {
        const w = { x: 0, y: 0, alive: true, fade: 0, vanish: 0, appear: 0, hopIn: pongHopDelay() };
        placeOnFreeCell(w, wall);
        wall.push(w);
    }
    return wall;
}

function pongHopDelay() {
    return PONG_HOP_MIN + Math.floor(Math.random() * PONG_HOP_SPREAD);
}

// Move brick w to a random grid cell no other (alive) brick in the wall is on
function placeOnFreeCell(w, wall) {
    const cols = Math.floor((CANVAS_W - 4) / BRICK_W);
    const taken = new Set(wall.filter(o => o !== w && o.alive).map(o => o.x + ',' + o.y));
    const free = [];
    for (let c = 0; c < cols; c++) {
        for (let r = 0; r < PONG_WALL_ROWS; r++) {
            const x = 2 + c * BRICK_W, y = PONG_WALL_TOP + r * PONG_WALL_ROW_STEP;
            if (!taken.has(x + ',' + y) && !(x === w.x && y === w.y)) free.push([x, y]);
        }
    }
    [w.x, w.y] = free[Math.floor(Math.random() * free.length)];
}

// Solid only while fully there: mid-hop (fading out or back in) the ball passes through
function pongBrickSolid(w) {
    return w.alive && w.vanish === 0 && w.appear === 0;
}

// Each brick sits a while, fades out, jumps to a free cell, and fades back in
function updatePongBricks() {
    const wall = boss.wall;
    for (const w of wall) {
        if (!w.alive) continue;
        if (w.vanish > 0) {
            if (--w.vanish === 0) {
                placeOnFreeCell(w, wall);
                w.appear = PONG_HOP_FADE;
            }
        } else if (w.appear > 0) {
            w.appear--;
        } else if (--w.hopIn <= 0) {
            w.vanish = PONG_HOP_FADE;
            w.hopIn = pongHopDelay();
        }
    }
}

function pongPhase() {
    const ratio = boss.hp / boss.maxHp;
    return ratio > 0.66 ? 1 : ratio > 0.33 ? 2 : 3;
}

// The ball heading up that will reach the rival's line soonest (the one worth defending against)
function pongThreat() {
    let best = null, bestT = Infinity;
    for (const b of balls) {
        if (b.stuck || b.vy >= 0) continue;
        const t = (b.y - (PONG_Y + PONG_H)) / -b.vy;
        if (t >= 0 && t < bestT) {
            bestT = t;
            best = b;
        }
    }
    return best;
}

// Where ball b will cross the rival's line, folding its path back and forth off the side walls
function pongPredictX(b) {
    const lo = b.r, span = CANVAS_W - 2 * b.r;
    const t = Math.max(0, (b.y - (PONG_Y + PONG_H + b.r)) / -b.vy);
    let x = ((b.x + b.vx * t - lo) % (2 * span) + 2 * span) % (2 * span);
    if (x > span) x = 2 * span - x;
    return x + lo;
}

function updatePongBoss() {
    const B = boss;
    if (B.dying > 0) {
        updatePongDeath();
        return;
    }
    if (B.intro > 0) {
        if (B.intro === 90) announceBoss('THE RIVAL CHALLENGES YOU!', '#ff9a2e');
        B.intro--;
        return;
    }
    if (B.cool > 0) B.cool--;
    if (B.flash > 0) B.flash--;
    if (B.rage > 0) B.rage--;
    updatePongBricks();
    // Its backup warps in one alien at a time, so they don't all arrive stacked on top of each other
    if (B.backup > 0 && --B.backupIn <= 0) {
        spawnAlien();
        B.backup--;
        B.backupIn = 35;
    }

    const phase = pongPhase();
    const twins = B.paddles.length > 1;
    const speed = (PONG_SPEED_BASE + PONG_SPEED_PER_N * B.n + PONG_SPEED_PER_PHASE * (phase - 1)) * timeScale;
    const threat = pongThreat();
    // A fresh aiming error for each new return it has to read: sometimes it guesses a little off, and a
    // fast wide shot then finds the gap
    if (threat && threat !== B.tracking) B.err = (Math.random() * 2 - 1) * PONG_AIM_ERROR * B.paddles[0].w;
    B.tracking = threat;
    const arrival = threat ? pongPredictX(threat) + B.err : null;

    B.paddles.forEach((p, i) => {
        const lo = twins && i === 1 ? CANVAS_W / 2 : 0;
        const hi = twins && i === 0 ? CANVAS_W / 2 - p.w : CANVAS_W - p.w;
        let target = (lo + hi) / 2; // nothing to defend: drift back to the middle of its patch
        if (arrival !== null && (!twins || (arrival >= lo && arrival <= hi + p.w))) target = arrival - p.w / 2;
        target = Math.max(lo, Math.min(hi, target));
        p.x += Math.max(-speed, Math.min(speed, target - p.x));
    });
}

function pongBallCollision(b) {
    const B = boss;
    if (B.dying > 0) return;
    if (pongWallCollision(b)) return; // solid from the first frame, intro or not
    if (B.intro > 0) return;
    // Past the rival and onto the top wall (main.js has already bounced it back down): a goal
    if (b.y - b.r <= 0.5 && b.vy > 0) {
        if (B.cool <= 0) pongGoal(b);
        return;
    }
    if (b.vy >= 0 || fireTimer > 0) return; // a fire ball burns straight through its paddle
    for (const p of B.paddles) {
        const cx = Math.max(p.x, Math.min(b.x, p.x + p.w));
        const cy = Math.max(PONG_Y, Math.min(b.y, PONG_Y + PONG_H));
        const dx = b.x - cx, dy = b.y - cy;
        if (dx * dx + dy * dy >= b.r * b.r) continue;
        // Returned like a real paddle: where it lands on the paddle sets the angle
        const offset = Math.max(-1, Math.min(1, (b.x - (p.x + p.w / 2)) / (p.w / 2)));
        const angle = offset * (Math.PI / 180) * 55;
        let speed = Math.max(Math.hypot(b.vx, b.vy), currentSpeed());
        if (pongPhase() >= 2) speed = Math.min(speed * PONG_SMASH, currentSpeed() * PONG_SMASH_CAP);
        b.vx = Math.sin(angle) * speed;
        b.vy = Math.cos(angle) * speed;
        b.y = PONG_Y + PONG_H + b.r;
        registerRallyTouch(b, 'rival');
        beep(440, 'rival');
        spawnParticles(b.x, b.y - b.r, '#ff9a2e', 4);
        return;
    }
}

// The one-way bricks: a ball going up hits one, breaks it, and bounces back down (a fire ball burns
// through without bouncing); a ball coming down just passes through. Returns whether it broke one.
function pongWallCollision(b) {
    if (b.vy >= 0) return false;
    for (const w of boss.wall) {
        if (!pongBrickSolid(w)) continue;
        const cx = Math.max(w.x, Math.min(b.x, w.x + BRICK_W));
        const cy = Math.max(w.y, Math.min(b.y, w.y + BRICK_H));
        const dx = b.x - cx, dy = b.y - cy;
        if (dx * dx + dy * dy >= b.r * b.r) continue;
        w.alive = false;
        w.fade = 16;
        bossTip('oneway', 'ITS BRICKS ONLY BLOCK YOUR SHOTS!');
        addScore(PONG_WALL_POINTS * (doubleTimer > 0 ? 2 : 1));
        spawnParticles(w.x + BRICK_W / 2, w.y + BRICK_H / 2, '#9a6bff', 10);
        beep(560, 'rivalWall');
        addShake(2);
        if (fireTimer <= 0) {
            b.vy = Math.abs(b.vy);
            b.y = w.y + BRICK_H + b.r;
        }
        return true;
    }
    return false;
}

function pongGoal(b) {
    const B = boss;
    B.cool = 20;
    B.flash = 14;
    B.hp--;
    addScore(150 * B.n * (doubleTimer > 0 ? 2 : 1));
    addPopup(Math.max(80, Math.min(CANVAS_W - 80, b.x)), PONG_Y + 60, 'GOAL!', '#ffd319', { size: 32, life: 1.2, rise: 0.4, pop: true }); // under the rival, clear of the health bar
    for (let x = 30; x < CANVAS_W; x += 60) spawnParticles(x, 2, '#ff9a2e', 3);
    addShake(8);
    haptic([20, 30, 40], true);
    tone(660, 0.1, { type: 'square', vol: 0.2, key: 'goal', force: true });
    tone(990, 0.18, { type: 'square', vol: 0.2, delay: 0.1, force: true });
    sfxRivalGrunt();
    if (B.hp <= 0) {
        killPong();
        return;
    }
    noteMoment(35, 'GOAL!');
    const phase = pongPhase();
    if (phase === B.lastPhase) return;
    B.lastPhase = phase;
    if (phase === 2) {
        B.paddles[0].w = PONG_WIDTHS[1];
        addPopup(CANVAS_W / 2, 215, 'THE RIVAL GETS SERIOUS!', '#ff8a2a', { size: 26, life: 1.6, rise: 0.3, pop: true });
        // ...and puts back every one-way brick you've broken
        let rebuilt = 0;
        for (const w of B.wall) {
            if (w.alive) continue;
            w.alive = true;
            placeOnFreeCell(w, B.wall);
            w.vanish = 0;
            w.appear = PONG_HOP_FADE;
            w.hopIn = pongHopDelay();
            rebuilt++;
            spawnParticles(w.x + BRICK_W / 2, w.y + BRICK_H / 2, '#9a6bff', 6);
        }
        if (rebuilt) addPopup(CANVAS_W / 2, 250, 'IT REBUILDS ITS BRICKS!', '#9a6bff', { size: 22, life: 1.8, rise: 0.25, pop: true });
    } else {
        // Splits into twins, each guarding its own half of the court
        const w = PONG_WIDTHS[2];
        B.paddles = [{ x: CANVAS_W / 4 - w / 2, w }, { x: (CANVAS_W * 3) / 4 - w / 2, w }];
        // Losing, it loses its temper: shakes with rage, then calls in three aliens to wreck your paddle
        B.rage = 90;
        sfxRivalRage();
        B.backup = 3;
        B.backupIn = 60;
        addPopup(CANVAS_W / 2, 215, 'THE RIVAL IS FURIOUS!', '#ff4d4d', { size: 26, life: 1.6, rise: 0.3, pop: true });
        addPopup(CANVAS_W / 2, 250, 'IT CALLS FOR BACKUP!', '#ff9a2e', { size: 22, life: 1.8, rise: 0.25, pop: true });
        tone(90, 0.7, { type: 'sawtooth', vol: 0.3, slideTo: 55, key: 'rivalRage', force: true }); // a low growl
        haptic([60, 40, 60, 40, 60], true);
        addShake(6); // on top of the phase shake below: the angriest moment of the fight
    }
    addShake(9);
    tone(180, 0.5, { type: 'sawtooth', vol: 0.28, slideTo: 90, key: 'phase', force: true });
}

// A lost ball is a point for the rival: only for the scoreboard, your lives are what actually count
function pongBreather() {
    boss.rivalScore++;
    addPopup(CANVAS_W / 2, 160, 'RIVAL SCORES!', '#ff4d4d', { size: 22, life: 1.2, rise: 0.3, pop: true });
}

function killPong() {
    const B = boss;
    B.dying = 90;
    B.backup = 0;
    // Its backup goes down with it, like the mothership's minions do
    for (const a of aliens) {
        spawnParticles(a.x, a.y, ALIEN_COLOR, 14);
        addBlast(a.x, a.y);
    }
    aliens.length = 0;
    alienBullets.length = 0;
    noteMoment(100, 'RIVAL DEFEATED!', 20);
    addShake(10);
    haptic([50, 30, 50, 30, 100], true);
    tone(380, 0.5, { type: 'sawtooth', vol: 0.28, slideTo: 40, key: 'bossDie', force: true });
    addPopup(CANVAS_W / 2, 250, 'YOU WIN THE MATCH!', '#ffd319', { size: 28, life: 2, rise: 0.2, pop: true });
}

function updatePongDeath() {
    const B = boss;
    B.dying--;
    if (B.dying % 6 === 0) {
        for (const p of B.paddles) {
            const x = p.x + Math.random() * p.w;
            addBlast(x, PONG_Y + PONG_H / 2);
            spawnParticles(x, PONG_Y + PONG_H / 2, Math.random() < 0.5 ? '#ff4d4d' : '#ffffff', 6);
            p.w = Math.max(0, p.w - 8); // crumbling away
            p.x += 4;
        }
        addShake(4);
        beep(200 + Math.random() * 300, 'rivalBoom');
    }
    if (B.dying <= 0) finishBoss();
}

// --- Drawing: a Pong court (dashed net, big faint score digits, a glowing goal line) and the rival ---
function drawPongBoss() {
    const B = boss;
    ctx.save();
    ctx.fillStyle = 'rgba(255, 255, 255, 0.12)';
    for (let x = 6; x < CANVAS_W; x += 24) ctx.fillRect(x, PONG_NET_Y, 12, 3);
    ctx.font = pixelFont(56);
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    ctx.fillStyle = 'rgba(255, 255, 255, 0.08)';
    ctx.fillText(String(B.maxHp - B.hp), CANVAS_W / 4, 240);   // your goals
    ctx.fillText(String(B.rivalScore), (CANVAS_W * 3) / 4, 240); // balls it's taken off you
    // The goal line along the top edge flares up when you score
    ctx.globalAlpha = B.flash > 0 ? 0.5 + B.flash / 20 : 0.35 + 0.1 * Math.sin(performance.now() / 300);
    ctx.fillStyle = B.flash > 0 ? '#ffd319' : '#ff4d4d';
    ctx.fillRect(0, 0, CANVAS_W, 3);
    ctx.restore();

    drawPongWall(B);
    if (B.intro > 0 && B.intro % 10 < 5) return; // blinks in during its intro
    // Shaking with rage: jittering in place, flashing angry red
    const jitter = B.rage > 0 ? () => (Math.random() * 2 - 1) * 4 : () => 0;
    for (const p of B.paddles) {
        if (p.w > 0) drawRivalSlab(p.x + jitter(), PONG_Y + jitter(), p.w, PONG_H, B.rage > 0 && B.rage % 12 < 6);
    }
}

// The player's paddle turned hostile: same arcade build, in the enemy's red and orange
function drawRivalSlab(x, y, w, h, enraged) {
    ctx.globalAlpha = enraged ? 0.55 : 0.22;
    ctx.fillStyle = '#ff4d4d';
    ctx.fillRect(x - 3, y - 3, w + 6, h + 6);
    ctx.globalAlpha = 1;
    ctx.fillStyle = enraged ? '#ff6b6b' : '#b9a6d9';
    ctx.fillRect(x, y, w, h);
    ctx.fillStyle = '#efe6ff';
    ctx.fillRect(x, y, w, 3);
    ctx.fillStyle = '#5b4a7a';
    ctx.fillRect(x, y + h - 3, w, 3);
    const cap = Math.min(10, Math.floor(w / 4));
    ctx.fillStyle = '#ff4d4d';
    ctx.fillRect(x, y, cap, h);
    ctx.fillRect(x + w - cap, y, cap, h);
    ctx.fillStyle = '#ffb3b3';
    ctx.fillRect(x, y, cap, 3);
    ctx.fillRect(x + w - cap, y, cap, 3);
    const strip = w - 2 * cap - 8;
    if (strip > 4) {
        ctx.fillStyle = '#ff9a2e';
        ctx.fillRect(x + cap + 4, y + Math.floor(h / 2) - 1, strip, 2);
    }
}

let oneWaySprite = null;

// The game's own bevelled brick in violet, marked with one crisp pixel arrow pointing down: "only this way
// through". Fading while it hops; sinking away when broken.
function tickPongWallFade() {
    for (const w of boss.wall) if (!w.alive && w.fade > 0) w.fade--;
}

function drawPongWall(B) {
    if (!oneWaySprite) {
        oneWaySprite = makeSprite(BRICK_W, BRICK_H, g => {
            g.drawImage(brickSprite({ color: '#6a3fd6', steel: false, tnt: false }), 0, 0);
            const cx = BRICK_W / 2;
            g.fillStyle = 'rgba(0, 0, 0, 0.35)'; // a drop shadow under the arrow, one pixel down-right
            g.fillRect(cx - 1, 5, 4, 6);
            g.fillRect(cx - 5, 11, 12, 2);
            g.fillRect(cx - 3, 13, 8, 2);
            g.fillRect(cx - 1, 15, 4, 2);
            g.fillStyle = '#ffffff';
            g.fillRect(cx - 2, 4, 4, 6);  // stem
            g.fillRect(cx - 6, 10, 12, 2); // head, narrowing to the tip
            g.fillRect(cx - 4, 12, 8, 2);
            g.fillRect(cx - 2, 14, 4, 2);
        });
    }
    for (const w of B.wall) {
        if (w.alive) {
            const a = w.vanish > 0 ? w.vanish / PONG_HOP_FADE : w.appear > 0 ? 1 - w.appear / PONG_HOP_FADE : 1;
            ctx.save();
            ctx.globalAlpha = a;
            ctx.drawImage(oneWaySprite, w.x, w.y);
            ctx.restore();
        } else if (w.fade > 0) { // counted down in tickPongWallFade
            ctx.save();
            ctx.globalAlpha = w.fade / 16;
            ctx.drawImage(oneWaySprite, w.x, w.y + (16 - w.fade));
            ctx.restore();
        }
    }
}

function drawPongBossBar() {
    const B = boss;
    const roman = ['', 'I', 'II', 'III', 'IV', 'V', 'VI', 'VII', 'VIII', 'IX', 'X'][B.n] || B.n;
    drawSimpleBossBar('THE RIVAL ' + roman + '   GOALS TO WIN ' + B.hp, B.hp / B.maxHp);
}

// Its one-way bricks: the guided ball helps clear a way through
function pongRects() {
    return boss.wall.filter(pongBrickSolid).map(w => [w.x, w.y, w.x + BRICK_W, w.y + BRICK_H]);
}

BOSS_KINDS.pong = {
    spawn: spawnPongBoss,
    update: updatePongBoss,
    collide: pongBallCollision,
    draw: drawPongBoss,
    bar: drawPongBossBar,
    rects: pongRects,
    breather: pongBreather,
    tick: tickPongWallFade,
    movers: () => boss.paddles
};
