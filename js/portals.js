// === portals.js ===
// --- Portal pairs ---
// The warp rift's friendlier cousin: two linked vortices (the rift's look, tinted orange and cyan) open
// together in the open play area, and a ball that dives into one flies out of the other at the same speed,
// still in this level, always heading up. Each pulls the ball in with the rift's own gravity, so it bends
// the ball's path even on a near miss. A pair stays open for a while, then closes; one pair at a time, never alongside a warp rift
// (see canSpawnWarp). Boss arenas are busy enough already, so of those only the asteroid field gets them,
// open from the moment the fight starts and back soon after each pair closes: one more way to bend the
// ball around the rocks.

// In the asteroid field they're part of the arena rather than a rare surprise: back within a few seconds
function portalInterval() {
    if (boss && boss.kind === 'asteroids') return Math.round(60 * (4 + Math.random() * 3));
    return Math.round(60 * (22 + Math.random() * 16));
}

function canSpawnPortals() {
    const arenaOk = !boss || (boss.kind === 'asteroids' && boss.intro <= 0 && boss.dying <= 0);
    return gameState === 'playing' && !portals && !warpRift && arenaOk && level >= PORTAL_UNLOCK &&
        !(ghost && ghostCount() <= 6) && !(!ghost && !boss && bricksLeft <= 3);
}

function spawnPortals() {
    // Two spots in the open band between the bricks (and walls) and the paddle, well apart from each other
    const spot = () => ({ x: 70 + Math.random() * (CANVAS_W - 140), y: 300 + Math.random() * 160 });
    let a = spot(), b = spot();
    for (let i = 0; i < 30 && Math.hypot(a.x - b.x, a.y - b.y) < 320; i++) b = spot();
    portals = { a: { ...a, color: '#ff9a1f', tint: '255, 154, 31' }, b: { ...b, color: '#2de2e6', tint: '45, 226, 230' },
        warn: PORTAL_WARN_FRAMES, life: PORTAL_LIFE_FRAMES, t: 0 };
    addPopup(CANVAS_W / 2, 100, 'PORTALS OPENING…', '#ffb347', { size: 20, life: 1.6, rise: 0.2, pop: true });
    tone(330, 0.3, { type: 'sine', vol: 0.18, slideTo: 660, key: 'portalWarn', force: true });
    haptic([15, 30, 15], true);
}

function updatePortals() {
    if (portals) {
        portals.t++;
        if (portals.warn > 0) portals.warn--;
        else if (--portals.life <= 0) portals = null; // closed
    } else if (canSpawnPortals() && --portalTimer <= 0) {
        spawnPortals();
        portalTimer = portalInterval();
    }
}

function portalBallCollision(b) {
    if (b.portalCool > 0) b.portalCool--;
    if (!portals || portals.warn > 0) return;
    for (const [from, to] of [[portals.a, portals.b], [portals.b, portals.a]]) {
        const dx = from.x - b.x, dy = from.y - b.y;
        const dist = Math.hypot(dx, dy);
        if (dist >= PORTAL_PULL_R) continue;
        // A gentle pull toward the centre (speed kept, only the heading bends) — but not on the way out
        if (!(b.portalCool > 0) && dist > 0.01) {
            const speed = Math.hypot(b.vx, b.vy);
            const pull = (1 - dist / PORTAL_PULL_R) * PORTAL_PULL_MAX;
            b.vx += (dx / dist) * pull;
            b.vy += (dy / dist) * pull;
            const mag = Math.hypot(b.vx, b.vy);
            if (mag > 0.01) {
                b.vx *= speed / mag;
                b.vy *= speed / mag;
            }
        }
        if (dist < PORTAL_R && !(b.portalCool > 0)) {
            // Out the other one at the same speed, always heading up (at least a fair climb), so it's
            // never spat straight at your paddle; placed just clear of the far rim along its new heading
            const speed = Math.hypot(b.vx, b.vy) || currentSpeed();
            const vy = -Math.max(Math.abs(b.vy), speed * PORTAL_EXIT_MIN_CLIMB);
            const vx = Math.sign(b.vx || 1) * Math.sqrt(Math.max(0, speed * speed - vy * vy));
            b.vx = vx;
            b.vy = vy;
            spawnParticles(from.x, from.y, from.color, 10);
            b.x = to.x + (vx / speed) * (PORTAL_R + b.r + 2);
            b.y = to.y + (vy / speed) * (PORTAL_R + b.r + 2);
            b.trail.length = 0; // no comet tail streaked across the screen between the two
            b.portalCool = 30;  // can't dive straight back in
            spawnParticles(to.x, to.y, to.color, 10);
            tone(520, 0.08, { type: 'sine', vol: 0.18, slideTo: 1040, key: 'portal', force: true });
            haptic(12);
            return;
        }
    }
}

function drawPortals() {
    if (!portals) return;
    const P = portals;
    for (const p of [P.a, P.b]) drawVortex(p.x, p.y, PORTAL_R, PORTAL_PULL_R, P.t, P.warn, PORTAL_WARN_FRAMES, P.life, p.tint, p.color);
}
