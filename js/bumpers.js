// === bumpers.js ===
// --- Pinball bumpers ---
// Round, unbreakable posts in the open band between the bricks and the paddle. The ball glances off one
// along the line through its centre, so where it strikes decides where it goes, and every hit kicks it a
// little faster (capped, and a paddle bounce hands back the level's normal speed) and scores. They're
// placed seeded per level like the rest of its plan (see planLevel), so a level always has them in the
// same spots, clear of each other and of the sliding walls above them.

let bumpersIntroduced = false;

function buildBumpers() {
    const out = [];
    if (!plan.bumpers) return out;
    const rand = seededRandom(level * 86028121 + 17);
    for (let attempt = 0; attempt < 200 && out.length < plan.bumpers; attempt++) {
        const x = 120 + rand() * (CANVAS_W - 240);
        const y = 340 + rand() * 80;
        if (out.every(o => Math.hypot(o.x - x, o.y - y) > 180)) out.push({ x, y, r: BUMPER_R, lit: 0, hits: 0, label: 0 });
    }
    if (out.length && !bumpersIntroduced) { // labelled the first time they turn up (however you got to that level)
        bumpersIntroduced = true;
        for (const bp of out) bp.label = 60 * 8;
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

// Painted once, then drawn with drawImage. Styled after a real pinball pop bumper so it reads as one: a
// dark skirt ringed with lamps, a neon rim, and a star on the cap. Everything is concentric (an off-centre
// highlight made the cap look misplaced). The lamps chase round the rim live, so it looks switched on.
let bumperSprite = null;
const BUMPER_SPRITE_PAD = 10;
const BUMPER_LAMPS = 10;
const BUMPER_LAMP_R = BUMPER_R - 5; // the ring the lamps sit on

function drawStar(g, cx, cy, outer, inner, points) {
    g.beginPath();
    for (let i = 0; i < points * 2; i++) {
        const a = -Math.PI / 2 + (i * Math.PI) / points;
        const r = i % 2 === 0 ? outer : inner;
        if (i === 0) g.moveTo(cx + Math.cos(a) * r, cy + Math.sin(a) * r);
        else g.lineTo(cx + Math.cos(a) * r, cy + Math.sin(a) * r);
    }
    g.closePath();
}

function getBumperSprite() {
    if (bumperSprite) return bumperSprite;
    const R = BUMPER_R;
    const size = 2 * (R + BUMPER_SPRITE_PAD);
    const c = size / 2;
    bumperSprite = makeSprite(size, size, g => {
        const glow = g.createRadialGradient(c, c, R - 2, c, c, R + BUMPER_SPRITE_PAD);
        glow.addColorStop(0, 'rgba(255, 47, 180, 0.5)');
        glow.addColorStop(1, 'rgba(255, 47, 180, 0)');
        g.fillStyle = glow;
        g.fillRect(0, 0, size, size);
        // Skirt
        g.fillStyle = '#1a0a2e';
        g.beginPath();
        g.arc(c, c, R, 0, Math.PI * 2);
        g.fill();
        // Neon rim
        g.strokeStyle = BUMPER_COLOR;
        g.lineWidth = 3;
        g.beginPath();
        g.arc(c, c, R - 1.5, 0, Math.PI * 2);
        g.stroke();
        // Unlit lamps
        g.fillStyle = '#6a1450';
        for (let i = 0; i < BUMPER_LAMPS; i++) {
            const a = (i / BUMPER_LAMPS) * Math.PI * 2;
            g.beginPath();
            g.arc(c + Math.cos(a) * BUMPER_LAMP_R, c + Math.sin(a) * BUMPER_LAMP_R, 2, 0, Math.PI * 2);
            g.fill();
        }
        // Cap with a star
        const capR = R * 0.55;
        const cap = g.createRadialGradient(c, c, 0, c, c, capR);
        cap.addColorStop(0, '#b8fbff');
        cap.addColorStop(1, BUMPER_CAP_COLOR);
        g.fillStyle = cap;
        g.beginPath();
        g.arc(c, c, capR, 0, Math.PI * 2);
        g.fill();
        g.strokeStyle = '#0b4a52';
        g.lineWidth = 1.5;
        g.stroke();
        drawStar(g, c, c, capR * 0.72, capR * 0.3, 5);
        g.fillStyle = BUMPER_COLOR;
        g.fill();
    });
    return bumperSprite;
}

function tickBumpers() {
    for (const bp of bumpers) {
        if (bp.lit > 0) bp.lit--;
        if (bp.label > 0 && gameState === 'playing' && !introHold()) bp.label--; // counts down only once play is on
    }
}

function drawBumpers() {
    if (!bumpers.length) return;
    const sprite = getBumperSprite();
    const half = sprite.width / 2;
    const chase = Math.floor(performance.now() / 90);
    ctx.save();
    for (const bp of bumpers) {
        const k = bp.lit / 12;
        const s = 1 + 0.15 * k; // a struck bumper swells and flashes, like a real one's lamp
        ctx.drawImage(sprite, bp.x - half * s, bp.y - half * s, half * 2 * s, half * 2 * s);
        // Two lamps chasing round the rim; all of them light up on a hit
        ctx.fillStyle = '#ffe3f6';
        ctx.beginPath();
        for (let i = 0; i < BUMPER_LAMPS; i++) {
            if (k === 0 && (i - chase) % 5 !== 0) continue;
            const a = (i / BUMPER_LAMPS) * Math.PI * 2;
            const lx = bp.x + Math.cos(a) * BUMPER_LAMP_R * s;
            const ly = bp.y + Math.sin(a) * BUMPER_LAMP_R * s;
            ctx.moveTo(lx + 2.2, ly);
            ctx.arc(lx, ly, 2.2, 0, Math.PI * 2);
        }
        ctx.fill();
        if (k > 0) {
            ctx.globalAlpha = 0.55 * k;
            ctx.fillStyle = '#ffffff';
            ctx.beginPath();
            ctx.arc(bp.x, bp.y, BUMPER_R * s, 0, Math.PI * 2);
            ctx.fill();
            ctx.globalAlpha = 1;
        }
        // The first time bumpers turn up in a session, each one says what it is for a few seconds
        if (bp.label > 0) {
            ctx.globalAlpha = Math.min(1, bp.label / 40);
            ctx.font = pixelFont(9);
            ctx.textAlign = 'center';
            ctx.lineWidth = 3;
            ctx.lineJoin = 'round'; // a mitred outline spikes out of the M
            ctx.strokeStyle = 'rgba(0, 0, 0, 0.8)';
            ctx.strokeText('BUMPER', bp.x, bp.y + BUMPER_R + 18);
            ctx.fillStyle = '#ffc8ec';
            ctx.fillText('BUMPER', bp.x, bp.y + BUMPER_R + 18);
            ctx.globalAlpha = 1;
        }
    }
    ctx.restore();
}
