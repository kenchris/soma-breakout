// === bumpers.js ===
// --- Pinball bumpers ---
// Round, unbreakable posts in the open band between the bricks and the paddle. The ball glances off one
// along the line through its centre, so where it strikes decides where it goes, and every hit kicks it a
// little faster (capped, and a paddle bounce hands back the level's normal speed) and scores. They're
// placed seeded per level like the rest of its plan (see planLevel), so a level always has them in the
// same spots, clear of each other and of the sliding walls above them.

function buildBumpers() {
    const out = [];
    if (!plan.bumpers) return out;
    const rand = seededRandom(level * 86028121 + 17);
    for (let attempt = 0; attempt < 200 && out.length < plan.bumpers; attempt++) {
        const x = 120 + rand() * (CANVAS_W - 240);
        const y = 335 + rand() * 85;
        if (out.every(o => Math.hypot(o.x - x, o.y - y) > 170)) out.push({ x, y, r: BUMPER_R, lit: 0, hits: 0 });
    }
    return out;
}

// Whether (x, y) is within `gap` of a bumper's rim: rifts and portals open elsewhere
function nearBumper(x, y, gap) {
    return bumpers.some(bp => Math.hypot(bp.x - x, bp.y - y) < bp.r + gap);
}

function bumperBallCollision(b) {
    for (const bp of bumpers) {
        const hit = bounceOffCircle(b, bp.x, bp.y, bp.r);
        if (!hit || !hit.bounced) continue;
        // The kick, then never leave flat: a ball skimming sideways could ping between a bumper and a side
        // wall for ages
        const speed = Math.hypot(b.vx, b.vy) || currentSpeed();
        const out = Math.max(speed, Math.min(speed * BUMPER_KICK, currentSpeed() * BUMPER_KICK_CAP));
        const vy = (b.vy < 0 ? -1 : 1) * Math.max(Math.abs(b.vy) / speed, BUMPER_MIN_CLIMB) * out;
        const vx = (b.vx < 0 ? -1 : 1) * Math.sqrt(Math.max(0, out * out - vy * vy));
        b.vx = vx;
        b.vy = vy;
        bp.lit = 12;
        bp.hits++;
        const points = BUMPER_POINTS * (doubleTimer > 0 ? 2 : 1);
        addScore(points);
        addPopup(bp.x, bp.y - bp.r - 8, '+' + points, '#ffc8ec', { size: 14, life: 0.6, rise: 0.8 });
        spawnParticles(b.x, b.y, BUMPER_COLOR, 5);
        // Each bumper climbs its own little scale as it's hit again and again
        tone(520 * Math.pow(2, (bp.hits % 5) / 5), 0.08, { type: 'square', vol: 0.16, key: 'bumper' });
        addShake(1.5);
        haptic(8);
        return;
    }
}

// Painted once, then drawn with drawImage: a magenta ring around a dark body with a cyan cap
let bumperSprite = null;
const BUMPER_SPRITE_PAD = 8;

function getBumperSprite() {
    if (bumperSprite) return bumperSprite;
    const R = BUMPER_R;
    const size = 2 * (R + BUMPER_SPRITE_PAD);
    const c = size / 2;
    bumperSprite = makeSprite(size, size, g => {
        const glow = g.createRadialGradient(c, c, R - 2, c, c, R + BUMPER_SPRITE_PAD);
        glow.addColorStop(0, 'rgba(255, 47, 180, 0.55)');
        glow.addColorStop(1, 'rgba(255, 47, 180, 0)');
        g.fillStyle = glow;
        g.fillRect(0, 0, size, size);
        const body = g.createRadialGradient(c - 5, c - 6, 2, c, c, R);
        body.addColorStop(0, '#5a2a78');
        body.addColorStop(1, '#1a0a2e');
        g.fillStyle = body;
        g.beginPath();
        g.arc(c, c, R, 0, Math.PI * 2);
        g.fill();
        g.strokeStyle = BUMPER_COLOR;
        g.lineWidth = 3;
        g.beginPath();
        g.arc(c, c, R - 1.5, 0, Math.PI * 2);
        g.stroke();
        g.fillStyle = BUMPER_CAP_COLOR;
        g.beginPath();
        g.arc(c, c, R * 0.42, 0, Math.PI * 2);
        g.fill();
        g.fillStyle = 'rgba(255, 255, 255, 0.7)';
        g.beginPath();
        g.arc(c - 2, c - 2, R * 0.15, 0, Math.PI * 2);
        g.fill();
    });
    return bumperSprite;
}

function tickBumpers() {
    for (const bp of bumpers) if (bp.lit > 0) bp.lit--;
}

function drawBumpers() {
    if (!bumpers.length) return;
    const sprite = getBumperSprite();
    const half = sprite.width / 2;
    for (const bp of bumpers) {
        if (bp.lit > 0) {
            // A struck bumper swells and flashes, like a real one's lamp
            const k = bp.lit / 12;
            const s = 1 + 0.18 * k;
            ctx.drawImage(sprite, bp.x - half * s, bp.y - half * s, half * 2 * s, half * 2 * s);
            ctx.save();
            ctx.globalAlpha = 0.7 * k;
            ctx.fillStyle = '#ffffff';
            ctx.beginPath();
            ctx.arc(bp.x, bp.y, bp.r * s, 0, Math.PI * 2);
            ctx.fill();
            ctx.restore();
        } else {
            ctx.drawImage(sprite, bp.x - half, bp.y - half);
        }
    }
}
