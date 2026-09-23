// === asteroidsBoss.js ===
// --- Asteroids boss: "Asteroid Field" ---
// Big vector-outline rocks drift and spin through the field, wrapping around the side edges like the
// arcade original. Every ball hit splits a rock into two smaller, faster ones (large -> medium -> small ->
// dust). Above the rocks sits the vault: two rows of ordinary bricks, and smashing all of them wins the
// fight. They're sealed off behind a full-width row of colour-coded locked bricks that the ball just
// bounces off. Three keys are hidden inside the rocks (a carrier glints in its key's colour), and each hit
// on a carrier may shake its key loose (always, once it's down to dust); a freed key drifts down to be
// caught. Each key has its own colour and opens the third of the lock row in that colour, so one key is
// enough to break in and every other one just makes it easier. Drop a key and you die: it costs a life and
// the whole field starts over. Meanwhile the regular aliens keep warping in to shoot holes in your paddle
// (a hole never swallows a key, though): one at a time at first, two at once from halfway through,
// arriving faster on later encounters. Portal pairs are open from the start and keep coming back (see
// portals.js), their gravity bending the ball around the rocks.
// boss.hp is the total number of rock hits still needed; it drives the ball's speed-up and the cheat roll.

// Hits needed to clear a rock of this tier completely: itself, plus both halves it splits into
function rockMass(tier) {
    return tier === 1 ? 1 : 1 + 2 * rockMass(tier - 1);
}

function makeRock(tier, x, y, vx, vy) {
    return {
        tier, x, y, vx, vy, r: ROCK_TIERS[tier].r,
        rot: Math.random() * Math.PI * 2, spin: (Math.random() - 0.5) * 0.02 * (4 - tier),
        shape: Array.from({ length: 11 }, () => 0.78 + Math.random() * 0.3), // lumpy outline, per rock
        cool: 0, flash: 0, keys: [] // ids of the keys inside (see KEY_COLORS)
    };
}

// The vault: VAULT_ROWS rows of ordinary bricks across the usual brick columns, and right under them a lock
// row spanning the whole canvas width, so the only way up to the vault is through a gap a key opened. Each
// lock brick belongs to the key that opens it (0 = the middle third, 1 = left, 2 = right: see KEY_COLORS).
function buildVault() {
    const targets = [], locks = [];
    const x0 = BRICK_OFFSET_LEFT;
    for (let r = 0; r < VAULT_ROWS; r++) {
        for (let c = 0; c < BRICK_COLS; c++) {
            targets.push({ x: x0 + c * BRICK_W, y: VAULT_TOP + r * BRICK_H, color: ROW_STYLES[r].color, points: ROW_STYLES[r].points, alive: true });
        }
    }
    const lockY = VAULT_TOP + VAULT_ROWS * BRICK_H;
    for (let c = -1; c <= BRICK_COLS; c++) {
        const group = c < BRICK_COLS / 3 ? 1 : c < (BRICK_COLS * 2) / 3 ? 0 : 2;
        locks.push({ x: x0 + c * BRICK_W, y: lockY, group, alive: true, fade: 0 });
    }
    return { targets, locks, left: targets.length };
}

function spawnAsteroidsBoss(n) {
    const count = Math.min(2 + Math.floor((n - 4) / 2), 4); // 2 at its debut (the 4th boss encounter), up to 4
    const rocks = [];
    for (let i = 0; i < count; i++) {
        const a = Math.random() * Math.PI * 2;
        const sp = ROCK_TIERS[3].speed * (1 + 0.08 * n);
        rocks.push(makeRock(3, CANVAS_W * (i + 1) / (count + 1), 290, Math.cos(a) * sp, Math.sin(a) * sp * 0.6));
    }
    for (let k = 0; k < FIELD_KEYS; k++) rocks[k % count].keys.push(k);
    const hp = count * rockMass(3);
    portalTimer = 1; // the first pair opens as soon as the fight begins (canSpawnPortals waits out the intro)
    boss = {
        kind: 'asteroids', n, hp, maxHp: hp, x: CANVAS_W / 2, intro: 90, dying: 0, cool: 0,
        rocks, alienIn: 60 * 5, lastX: CANVAS_W / 2, lastY: 290,
        keys: 0, freed: [], vault: buildVault(), t: 0,
        restart: false, // set by loseKey when the fight starts over: no second free shield then
        cheatRolled: false
    };
}

function updateAsteroidsBoss() {
    const B = boss;
    if (B.dying > 0) {
        updateAsteroidsDeath();
        return;
    }
    if (B.intro === 90) announceBoss(B.restart ? 'THE FIELD STARTS OVER!' : 'ASTEROIDS INCOMING!', '#2de2e6', !B.restart);
    for (const r of B.rocks) {
        r.x += r.vx * timeScale;
        r.y += r.vy * timeScale;
        r.rot += r.spin * timeScale;
        if (r.cool > 0) r.cool--;
        if (r.flash > 0) r.flash--;
        // Wrap around the side edges once fully off-screen; bounce between the vault and the paddle zone
        if (r.x < -r.r) r.x += CANVAS_W + 2 * r.r;
        else if (r.x > CANVAS_W + r.r) r.x -= CANVAS_W + 2 * r.r;
        if (r.y - r.r < ROCK_TOP) r.vy = Math.abs(r.vy);
        else if (r.y + r.r > ROCK_BOTTOM) r.vy = -Math.abs(r.vy);
    }
    for (const l of B.vault.locks) if (l.fade > 0) l.fade--;
    if (B.intro > 0) {
        B.intro--;
        return;
    }
    B.t++;
    updateAsteroidAliens();
    updateFieldKeys();
}

// Freed keys drift down to the paddle. Catching one opens the locks of its colour; missing one kills you
// (see loseKey). A key is a pickup, not a ball: the whole paddle (and a Split Paddle's mirror half) catches
// it, alien-shot holes included.
function updateFieldKeys() {
    const B = boss;
    for (let i = B.freed.length - 1; i >= 0; i--) {
        const k = B.freed[i];
        k.y += KEY_FALL_VY * timeScale;
        k.t++;
        if (keyCaught(k)) {
            B.freed.splice(i, 1);
            catchKey(k);
        } else if (k.y > CANVAS_H + 14) {
            loseKey(k);
            return; // a dropped key ends this attempt at the field one way or another
        }
    }
}

function keyCaught(k) {
    const halves = [paddle];
    const m = mirrorPaddleRect();
    if (m) halves.push(m);
    return halves.some(p => k.x > p.x - 14 && k.x < p.x + p.w + 14 && k.y + 12 > p.y && k.y - 12 < p.y + p.h);
}

function freeKey(x, y, id) {
    bossTip('dropKey', "DON'T DROP IT: THE FIELD STARTS OVER!", 380);
    boss.freed.push({ x: Math.max(20, Math.min(CANVAS_W - 20, x)), y, t: 0, id });
    addPopup(x, y - 20, KEY_NAMES[id] + ' KEY! CATCH IT!', KEY_COLORS[id], { size: 20, life: 1.3, rise: 0.4, pop: true });
    tone(880, 0.12, { type: 'triangle', vol: 0.2, key: 'keyFree', force: true });
    tone(1320, 0.16, { type: 'triangle', vol: 0.2, delay: 0.08, force: true });
}

function catchKey(k) {
    const B = boss;
    B.keys++;
    addScore(250 * (doubleTimer > 0 ? 2 : 1));
    spawnParticles(k.x, paddle.y, KEY_COLORS[k.id], 14);
    haptic([15, 20, 30], true);
    sfxKey();
    addPopup(k.x, paddle.y - 30, KEY_NAMES[k.id] + ' KEY ' + B.keys + ' / ' + FIELD_KEYS + '!', KEY_COLORS[k.id], { size: 22, life: 1.3, rise: 0.5, pop: true });
    noteMoment(45, 'KEY FOUND!');
    unlockGroup(k.id);
}

// Dissolve every lock brick that key `group` opens, in a sparkle of its colour
function unlockGroup(group) {
    const opened = boss.vault.locks.filter(l => l.alive && l.group === group);
    if (!opened.length) return;
    for (const l of opened) {
        l.alive = false;
        l.fade = 24;
        spawnParticles(l.x + BRICK_W / 2, l.y + BRICK_H / 2, KEY_COLORS[group], 8);
    }
    const mid = opened[Math.floor(opened.length / 2)];
    addPopup(mid.x + BRICK_W / 2, mid.y + BRICK_H + 26, KEY_NAMES[group] + ' LOCKS OPEN!', KEY_COLORS[group],
        { size: 20, life: 1.6, rise: 0.3, pop: true });
    addShake(5);
    sfxUnlock();
}

// A dropped key is fatal: a life gone, and (if that wasn't the last one) the whole field starts over:
// fresh rocks with all three keys back inside, every lock closed again, the vault full
function loseKey(k) {
    addPopup(CANVAS_W / 2, CANVAS_H - 70, KEY_NAMES[k.id] + ' KEY LOST!', '#ff4d4d', { size: 26, life: 1.6, rise: 0.3, pop: true });
    loseLife();
    if (gameState === 'lost') return;
    spawnLevel(); // rebuilds this same boss level; spawnBoss sees the same level so it's the field again
    boss.restart = true;
}

// The regular aliens warp in to harass you: one at a time, two at once from halfway through the field
function updateAsteroidAliens() {
    const B = boss;
    if (--B.alienIn > 0) return;
    const max = B.hp / B.maxHp <= 0.5 ? 2 : 1;
    if (aliens.length < max) spawnAlien();
    B.alienIn = Math.round(60 * Math.max(6, 12 - B.n) * (0.8 + Math.random() * 0.4));
}

function asteroidsBallCollision(b) {
    const B = boss;
    if (B.dying > 0) return;
    if (vaultBallCollision(b)) return; // solid from the first frame: the ball must never slip past it, intro or not
    if (B.intro > 0) return;
    for (const r of B.rocks) {
        if (r.cool > 0) continue;
        const dx = b.x - r.x, dy = b.y - r.y;
        const dist = Math.hypot(dx, dy);
        const reach = r.r * 0.9 + b.r; // a touch inside the lumpy outline, so glancing hits look like contact
        if (dist >= reach) continue;
        if (fireTimer <= 0 && dist > 0.01) {
            // Bounce off the rock's surface, and push out so the ball doesn't stay buried in it
            const nx = dx / dist, ny = dy / dist;
            const dot = b.vx * nx + b.vy * ny;
            if (dot < 0) {
                b.vx -= 2 * dot * nx;
                b.vy -= 2 * dot * ny;
            }
            b.x = r.x + nx * reach;
            b.y = r.y + ny * reach;
        }
        hitRock(r, b);
        return;
    }
}

// Bounce ball b off the brick at (x, y), along whichever axis it came in on, and push it clear
function bounceOffBrick(b, x, y, dx, dy) {
    if (Math.abs(dx) > Math.abs(dy)) {
        const dir = dx >= 0 ? 1 : -1;
        b.vx = dir * Math.abs(b.vx);
        b.x = dir > 0 ? x + BRICK_W + b.r : x - b.r;
    } else {
        const dir = dy >= 0 ? 1 : -1;
        b.vy = dir * Math.abs(b.vy);
        b.y = dir > 0 ? y + BRICK_H + b.r : y - b.r;
    }
}

// The vault's bricks. Locks just bounce the ball, fire ball or not (a lock is a lock); a vault brick
// breaks, and the last one breaking wins the fight. Returns whether the ball touched anything.
function vaultBallCollision(b) {
    const V = boss.vault;
    const touch = (x, y) => {
        const cx = Math.max(x, Math.min(b.x, x + BRICK_W)), cy = Math.max(y, Math.min(b.y, y + BRICK_H));
        const dx = b.x - cx, dy = b.y - cy;
        return dx * dx + dy * dy < b.r * b.r ? { dx, dy } : null;
    };
    for (const l of V.locks) {
        if (!l.alive) continue;
        const t = touch(l.x, l.y);
        if (!t) continue;
        bounceOffBrick(b, l.x, l.y, t.dx, t.dy);
        bossTip('lock', 'LOCKED! ITS KEY IS HIDDEN IN A ROCK');
        beep(300, 'lockClank');
        spawnParticles(b.x, b.y, '#ffd319', 3);
        return true;
    }
    for (const v of V.targets) {
        if (!v.alive) continue;
        const t = touch(v.x, v.y);
        if (!t) continue;
        breakVaultBrick(v);
        if (explosiveReady) {
            // An armed Explosive takes out the bricks around it too
            explosiveReady = false;
            for (const o of V.targets) {
                if (o.alive && Math.abs(o.x - v.x) <= BRICK_W && Math.abs(o.y - v.y) <= BRICK_H) breakVaultBrick(o);
            }
            addBlast(v.x + BRICK_W / 2, v.y + BRICK_H / 2);
            boom();
        }
        if (fireTimer <= 0) bounceOffBrick(b, v.x, v.y, t.dx, t.dy);
        if (V.left === 0) vaultCracked();
        return true;
    }
    return false;
}

function breakVaultBrick(v) {
    v.alive = false;
    boss.vault.left--;
    runStats.bricks++;
    addScore(v.points * 2 * (doubleTimer > 0 ? 2 : 1));
    spawnParticles(v.x + BRICK_W / 2, v.y + BRICK_H / 2, v.color, 10);
    beep(520 + Math.random() * 200, 'vaultBrick');
    addShake(2);
    if (Math.random() < POWERUP_CHANCE * 0.5) dropFieldPowerup(v.x + BRICK_W / 2, v.y + BRICK_H / 2);
}

// Half of this fight's drops are Guided (which locks on to aliens, see castRay in guided.js), the rest
// the usual random pick
function dropFieldPowerup(x, y) {
    if (Math.random() >= 0.5) {
        spawnPowerup(x, y);
        return;
    }
    const def = POWERUP_TYPES.find(p => p.type === 'guided');
    powerups.push({ x, y, type: def.type, label: def.label, color: def.color, vy: 2.5 });
}

function hitRock(r, b) {
    const B = boss;
    const scoreMult = doubleTimer > 0 ? 2 : 1;
    B.lastX = r.x;
    B.lastY = r.y;
    B.rocks.splice(B.rocks.indexOf(r), 1);
    spawnParticles(r.x, r.y, '#e6f6ff', 6 + r.tier * 4);
    addShake(2 + r.tier * 2);
    if (explosiveReady) {
        // An armed Explosive shatters the whole rock at once, halves and all
        explosiveReady = false;
        B.hp -= rockMass(r.tier);
        addScore(ROCK_TIERS[r.tier].points * rockMass(r.tier) * scoreMult);
        addBlast(r.x, r.y);
        boom();
        addPopup(r.x, r.y, 'SHATTERED!', '#ffb347', { size: 20, life: 1, pop: true });
        r.keys.forEach((id, i) => freeKey(r.x + (i - (r.keys.length - 1) / 2) * 40, r.y, id));
    } else {
        B.hp--;
        addScore(ROCK_TIERS[r.tier].points * scoreMult);
        // Each key inside may shake loose on the hit (the smaller the rock, the likelier: dust always frees
        // it); whatever stays in goes on into the halves below
        const loose = r.keys.filter(() => Math.random() < KEY_DROP_CHANCE[r.tier]);
        loose.forEach((id, i) => freeKey(r.x + (i - (loose.length - 1) / 2) * 40, r.y, id));
        const kept = r.keys.filter(id => !loose.includes(id));
        const half = Math.ceil(kept.length / 2);
        if (r.tier > 1) {
            // Two halves fly apart across the ball's line of travel, keeping some of the parent's drift
            const mag = Math.hypot(b.vx, b.vy) || 1;
            const px = -b.vy / mag, py = b.vx / mag;
            const tier = r.tier - 1;
            const sp = ROCK_TIERS[tier].speed * (1 + 0.08 * B.n);
            for (const side of [1, -1]) {
                const k = sp * (0.9 + Math.random() * 0.3);
                const child = makeRock(tier, r.x + px * side * ROCK_TIERS[tier].r * 0.8, r.y + py * side * ROCK_TIERS[tier].r * 0.8,
                    r.vx * 0.5 + px * side * k, r.vy * 0.5 + py * side * k);
                child.cool = 12; // so the ball that split it can't hit a half on the same contact
                child.keys = side === 1 ? kept.slice(0, half) : kept.slice(half); // the keys still inside go with the pieces
                child.flash = 6;
                B.rocks.push(child);
            }
            beep(260 + (3 - r.tier) * 120, 'rockSplit');
        } else {
            beep(700, 'rockDust');
            if (Math.random() < POWERUP_CHANCE * 0.6) dropFieldPowerup(r.x, r.y);
        }
    }
    haptic(r.tier >= 2 ? [15, 15, 25] : 12);
    if (B.hp / B.maxHp <= 0.33) maybeDropBossCheatCapsule(r.x, r.y); // one roll for the last stretch (guarded inside)
}

function vaultCracked() {
    const B = boss;
    B.dying = 70;
    B.freed.length = 0;
    // Any aliens still about go up with the field, like the mothership's minions do with the ship
    for (const a of aliens) {
        spawnParticles(a.x, a.y, ALIEN_COLOR, 14);
        addBlast(a.x, a.y);
    }
    aliens.length = 0;
    alienBullets.length = 0;
    noteMoment(100, 'CRACKED THE VAULT!', 20);
    addShake(10);
    haptic([50, 30, 50, 30, 100], true);
    tone(380, 0.5, { type: 'sawtooth', vol: 0.28, slideTo: 40, key: 'bossDie', force: true });
    addPopup(CANVAS_W / 2, 250, 'VAULT CRACKED!', '#ffd319', { size: 28, life: 2, rise: 0.2, pop: true });
}

function updateAsteroidsDeath() {
    const B = boss;
    B.dying--;
    if (B.dying % 7 === 0) {
        // The rocks left behind go up one by one (or, if none are left, bursts around the last one broken)
        const r = B.rocks.length ? B.rocks.splice(Math.floor(Math.random() * B.rocks.length), 1)[0] : null;
        const x = r ? r.x : B.lastX + (Math.random() - 0.5) * 160, y = r ? r.y : B.lastY + (Math.random() - 0.5) * 100;
        addBlast(x, y);
        spawnParticles(x, y, Math.random() < 0.5 ? '#2de2e6' : '#ffffff', 8);
        addShake(4);
        beep(200 + Math.random() * 300, 'rockBoom');
    }
    if (B.dying <= 0) finishBoss();
}

// For the guided ball: each rock as a target rectangle (not the vault, which it can't see past the locks)
function asteroidsRects() {
    return boss.rocks.map(r => [r.x - r.r * 0.8, r.y - r.r * 0.8, r.x + r.r * 0.8, r.y + r.r * 0.8]);
}

// --- Drawing: the vault as real bricks; rocks in arcade vector style, bright outlines over dark fill ---
const lockBrickSprites = {}; // by lock group (the key id)

// A dark brick rimmed in its key's colour, with a keyhole, so it reads as "locked" and says which key opens it
function lockBrickSprite(group) {
    if (!lockBrickSprites[group]) {
        const body = KEY_LOCK_SHADES[group];
        const rim = KEY_COLORS[group];
        lockBrickSprites[group] = makeSprite(BRICK_W, BRICK_H, g => {
            g.drawImage(brickSprite({ color: body, steel: false, tnt: false }), 0, 0);
            g.strokeStyle = rim;
            g.lineWidth = 1.5;
            g.strokeRect(2, 2, BRICK_W - 4, BRICK_H - 4);
            g.fillStyle = '#0c0816';
            g.beginPath();
            g.arc(BRICK_W / 2, BRICK_H / 2 - 2, 3.5, 0, Math.PI * 2);
            g.fill();
            g.fillRect(BRICK_W / 2 - 1.5, BRICK_H / 2, 3, 6);
        });
    }
    return lockBrickSprites[group];
}

function drawVault(B) {
    for (const v of B.vault.targets) {
        if (v.alive) ctx.drawImage(brickSprite({ color: v.color, steel: false, tnt: false }), v.x, v.y);
    }
    for (const l of B.vault.locks) {
        if (l.alive) {
            ctx.drawImage(lockBrickSprite(l.group), l.x, l.y);
        } else if (l.fade > 0) {
            ctx.save();
            ctx.globalAlpha *= l.fade / 24; // dissolving
            ctx.drawImage(lockBrickSprite(l.group), l.x, l.y - (24 - l.fade) * 0.5);
            ctx.restore();
        }
    }
}

function drawAsteroidsBoss() {
    const B = boss;
    ctx.save();
    ctx.lineJoin = 'round';
    if (B.intro > 0) ctx.globalAlpha = 1 - B.intro / 90; // fade in during the intro
    drawVault(B);
    for (const r of B.rocks) {
        ctx.save();
        ctx.translate(r.x, r.y);
        ctx.rotate(r.rot);
        ctx.beginPath();
        r.shape.forEach((k, i) => {
            const a = (i / r.shape.length) * Math.PI * 2;
            if (i === 0) ctx.moveTo(Math.cos(a) * r.r * k, Math.sin(a) * r.r * k);
            else ctx.lineTo(Math.cos(a) * r.r * k, Math.sin(a) * r.r * k);
        });
        ctx.closePath();
        ctx.fillStyle = r.flash > 0 ? 'rgba(90, 80, 150, 0.9)' : 'rgba(16, 12, 34, 0.88)';
        ctx.fill();
        ctx.strokeStyle = 'rgba(45, 226, 230, 0.3)';
        ctx.lineWidth = 6;
        ctx.stroke();
        ctx.strokeStyle = r.flash > 0 ? '#ffffff' : '#e6f6ff';
        ctx.lineWidth = 2;
        ctx.stroke();
        ctx.restore();
        // Keys inside glint in their own colours, so you know which rocks to go after and for what
        const pulse = 0.55 + 0.45 * Math.sin(B.t / 8 + r.x);
        r.keys.forEach((id, i) => {
            const kx = r.x + (i - (r.keys.length - 1) / 2) * 22;
            ctx.save();
            ctx.globalAlpha *= pulse;
            ctx.fillStyle = KEY_COLORS[id];
            ctx.globalAlpha *= 0.3;
            ctx.beginPath();
            ctx.arc(kx, r.y, 13, 0, Math.PI * 2);
            ctx.fill();
            ctx.globalAlpha /= 0.3;
            drawKeyGlyph(kx, r.y, 1, KEY_COLORS[id]);
            ctx.restore();
        });
    }
    for (const k of B.freed) {
        ctx.save();
        ctx.fillStyle = KEY_COLORS[k.id];
        ctx.globalAlpha *= 0.3;
        ctx.beginPath();
        ctx.arc(k.x, k.y, 16 + 3 * Math.sin(k.t / 6), 0, Math.PI * 2);
        ctx.fill();
        ctx.restore();
        drawKeyGlyph(k.x, k.y, 1.4, KEY_COLORS[k.id]);
    }
    ctx.restore();
}

// A pixel-art key in the given colour, centred on (x, y): a ring bow, a shaft, two teeth
function drawKeyGlyph(x, y, s, color) {
    ctx.save();
    ctx.translate(x, y);
    ctx.scale(s, s);
    ctx.fillStyle = color;
    ctx.fillRect(-8, -4, 8, 8);   // bow
    ctx.fillStyle = '#0c0816';
    ctx.fillRect(-6, -2, 4, 4);   // the hole in the bow
    ctx.fillStyle = color;
    ctx.fillRect(0, -1, 9, 3);    // shaft
    ctx.fillRect(5, 2, 2, 3);     // teeth
    ctx.fillRect(8, 2, 2, 4);
    ctx.restore();
}

function drawAsteroidsBossBar() {
    const B = boss;
    const roman = ['', 'I', 'II', 'III', 'IV', 'V', 'VI', 'VII', 'VIII', 'IX', 'X'][B.n] || B.n;
    const V = B.vault;
    drawSimpleBossBar('ASTEROID FIELD ' + roman + '   KEYS ' + B.keys + ' / ' + FIELD_KEYS + '   VAULT ' + V.left, V.left / V.targets.length);
}
