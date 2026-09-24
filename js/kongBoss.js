// === kongBoss.js ===
// --- Kong boss: "Space Kong" ---
// A giant space gorilla in a bubble helmet stands on top of a Donkey Kong-style tower of space-station
// girders and fights you by throwing alien invaders, curled up into balls. (In the code they're still
// "barrels", which is what they are to the girders.) They roll down the sloped girders, drop off each end
// onto the next one down (or, now and then, down a ladder gap), and finally fall at your paddle: one that
// lands on it punches a hole. The ball smashes them. From phase 2 it also hurls "wild" pink invaders,
// uncurled and flailing, straight at you through the girders, and when ENRAGED it pounds its chest, which
// bounces every invader on the tower and hurries them along.
// To hurt it you have to get the ball up to it: the girders are solid, but the ball slips through the
// ladder gaps and around the girder ends. A hammer hangs on the left of the tower; knock it down with the
// ball and catch it for HAMMER TIME: for a few seconds your paddle smashes any barrel that lands on it.

const KONG_W = 96;
const KONG_H = 72;
const KONG_X = CANVAS_W / 2;       // it stands in the middle of the top girder
const KONG_FEET_Y = 172;
const GIRDER_HALF = 6;             // half the beam's thickness
const BARREL_R = 12;
const BARREL_GRAVITY = 0.18;
const BARREL_MAX_FALL = 6;
const KONG_HAMMER_SECONDS = 8;
const KONG_HAMMER_POS = { x: 92, y: 282 };
const KONG_BROWN = '#8a4a1c';
const KONG_TAN = '#e8b27a';

// The tower, top to bottom. Barrels roll downhill along each girder and drop off its low end; `gaps` are
// ladder openings (x ranges) the ball passes through and barrels usually roll over.
const KONG_GIRDERS = [
    // Just a ledge under its feet: a ball that makes it up the tower can smack it from below or the sides
    { x0: 380, y0: KONG_FEET_Y, x1: 540, y1: KONG_FEET_Y, gaps: [] },
    { x0: 60, y0: 225, x1: 760, y1: 252, gaps: [[170, 222], [480, 532]] },
    { x0: 140, y0: 338, x1: 840, y1: 311, gaps: [[300, 352], [620, 672]] },
    { x0: 60, y0: 398, x1: 760, y1: 425, gaps: [[210, 262], [540, 592]] },
    // The princess's perch, up in the corner, out of the invaders' way
    { x0: 40, y0: 128, x1: 140, y1: 128, gaps: [] }
];

// Pixel art, 6px per cell. B brown fur, T tan face and chest, W eye white, K black.
const KONG_ART = {
    idle: [
        '....BBBBBBBB....',
        '...BBBBBBBBBB...',
        '...BBTTBBTTBB...',
        '...BTWKTTKWTB...',
        '...BTTTTTTTTB...',
        '....TTKKKKTT....',
        '.BBBBTTTTTTBBBB.',
        'BBBBBTTTTTTBBBBB',
        'BBB.BBTTTTBB.BBB',
        'BB..BBBBBBBB..BB',
        'TT..BBB..BBB..TT',
        '...TTT....TTT...'
    ],
    throw: [
        'TT..BBBBBBBB..TT',
        'BB.BBBBBBBBBB.BB',
        'BB.BBTTBBTTBB.BB',
        'BBBBTWKTTKWTBBBB',
        '.BBBTTTTTTTTBBB.',
        '....TKKKKKKT....',
        '....BTTTTTTB....',
        '...BBTTTTTTBB...',
        '...BBBTTTTBBB...',
        '...BBBBBBBBBB...',
        '...BBB....BBB...',
        '..TTT......TTT..'
    ]
};

// Where girder g's top surface is at x
function girderY(g, x) {
    return g.y0 + (g.y1 - g.y0) * (x - g.x0) / (g.x1 - g.x0);
}

function girderLeft(g) { return Math.min(g.x0, g.x1); }
function girderRight(g) { return Math.max(g.x0, g.x1); }

// Which way a barrel rolls on girder g: downhill (a flat girder sends it right)
function girderDownhill(g) {
    const lowEnd = g.y1 >= g.y0 ? g.x1 : g.x0;
    return g.y0 === g.y1 ? 1 : Math.sign(lowEnd - (g.x0 + g.x1) / 2);
}

// The solid stretches of each girder (between its ladder gaps) as segments, for the ball. Not the ledge
// it stands on: a ball coming up from below hits the ape itself, never the plank under its feet.
const KONG_PIECES = KONG_GIRDERS.slice(1).flatMap(g => {
    const cuts = [girderLeft(g)];
    for (const [a, b] of g.gaps) cuts.push(a, b);
    cuts.push(girderRight(g));
    const pieces = [];
    for (let i = 0; i < cuts.length; i += 2) {
        pieces.push({ x0: cuts[i], y0: girderY(g, cuts[i]), x1: cuts[i + 1], y1: girderY(g, cuts[i + 1]) });
    }
    return pieces;
});

function kongPhase() {
    return bossPhase();
}

function spawnKongBoss(n) {
    const hp = 10 + 4 * n; // 22 on its debut
    boss = {
        kind: 'kong', n, hp, maxHp: hp, x: KONG_X, y: -KONG_H, intro: 110, dying: 0, cool: 0, flash: 0, t: 0,
        barrels: [], throwIn: 150, pose: 'idle', poseT: 0, pending: null, lastPhase: 1, pound: 0,
        hammer: { state: 'hang', x: KONG_HAMMER_POS.x, y: KONG_HAMMER_POS.y, vy: 0, respawn: 0 },
        hammerTime: 0, cheatRolled: false
    };
}

function kongBox() {
    return { x: boss.x - KONG_W / 2, y: boss.y - KONG_H, w: KONG_W, h: KONG_H };
}

// --- Barrels ---
function barrelRollSpeed() {
    return Math.min(1.8 + 0.2 * boss.n + 0.35 * (kongPhase() - 1), 4);
}

function throwRollingBarrel() {
    boss.barrels.push({ state: 'roll', g: 0, x: boss.x + KONG_W / 2 + 4, y: 0, vx: 0, vy: 0, spin: 0, wild: false });
    tone(160, 0.12, { type: 'square', vol: 0.18, slideTo: 110, key: 'kongThrow' });
}

// A wild barrel flies straight at where the paddle is, crashing down through the girders
function throwWildBarrel(tx) {
    const x0 = boss.x, y0 = boss.y - KONG_H + 10;
    const speed = Math.min(3.4 + 0.2 * boss.n, 5.2);
    const d = Math.hypot(tx - x0, paddle.y - y0);
    boss.barrels.push({ state: 'wild', x: x0, y: y0, vx: (tx - x0) / d * speed, vy: (paddle.y - y0) / d * speed, spin: 0, wild: true });
    tone(420, 0.2, { type: 'sawtooth', vol: 0.2, slideTo: 140, key: 'kongWild' });
    bossTip('wild', 'PINK INVADERS COME STRAIGHT AT YOU!', 440);
}

function barrelLimit() {
    return 5 + boss.n;
}

function updateBarrels() {
    const B = boss;
    const roll = barrelRollSpeed() * timeScale;
    for (const br of B.barrels) {
        br.spin += (br.state === 'roll' ? br.dir || 1 : 1) * 0.15 * timeScale;
        if (br.state === 'roll') {
            const g = KONG_GIRDERS[br.g];
            br.dir = girderDownhill(g);
            const px = br.x;
            br.x += br.dir * roll;
            br.y = girderY(g, br.x) - GIRDER_HALF - BARREL_R;
            // Crossing the middle of a ladder gap: sometimes it takes the ladder down instead of rolling on
            for (const [a, b] of g.gaps) {
                const mid = (a + b) / 2;
                if ((px - mid) * (br.x - mid) <= 0 && Math.random() < 0.2 + 0.1 * (kongPhase() - 1)) {
                    br.x = mid;
                    br.state = 'fall';
                    br.vx = 0;
                    br.vy = 0.5;
                    br.from = br.g;
                }
            }
            if (br.state === 'roll' && (br.x < girderLeft(g) || br.x > girderRight(g))) { // off the end
                br.state = 'fall';
                br.vx = br.dir * roll * 0.6;
                br.vy = 0;
                br.from = br.g;
            }
        } else if (br.state === 'fall' || br.state === 'hop') {
            const py = br.y;
            br.vy = Math.min(br.vy + BARREL_GRAVITY * timeScale, BARREL_MAX_FALL);
            br.x += br.vx * timeScale;
            br.y += br.vy * timeScale;
            if (br.vy > 0) {
                // Landing on a girder below the one it left (a hop lands back on its own)
                for (let i = 0; i < KONG_GIRDERS.length; i++) {
                    const g = KONG_GIRDERS[i];
                    if (br.state === 'fall' && i <= br.from) continue;
                    if (br.x < girderLeft(g) || br.x > girderRight(g)) continue;
                    const top = girderY(g, br.x) - GIRDER_HALF - BARREL_R;
                    if (py <= top + 0.5 && br.y >= top) {
                        br.state = 'roll';
                        br.g = i;
                        br.y = top;
                        beep(120, 'barrelLand');
                        break;
                    }
                }
            }
        } else if (br.state === 'wild') {
            br.x += br.vx * timeScale;
            br.y += br.vy * timeScale;
            if (br.x < BARREL_R || br.x > CANVAS_W - BARREL_R) br.vx = -br.vx;
        }
        // Down at the paddle
        if (!br.dead && br.state !== 'roll' && br.y > paddle.y - BARREL_R - 4 && br.y < paddle.y + paddle.h + BARREL_R) {
            const hit = paddleHit(br.x, br.y, BARREL_R);
            if (hit) {
                br.dead = true;
                if (B.hammerTime > 0) {
                    smashBarrel(br, 100, 'SMASH!');
                } else if (hit.mirror) {
                    blockMirrorBolt(br.x);
                } else {
                    punchHole(br.x, BOSS_HOLE_SECONDS);
                    bossTip('smash', 'SMASH THE ROLLING INVADERS BEFORE THEY LAND!', 440);
                }
                spawnParticles(br.x, br.y, br.wild ? '#ff4dd8' : ALIEN_COLOR, 10);
            }
        }
        if (br.y > CANVAS_H + 30) br.dead = true;
    }
    keepWhere(B.barrels, br => !br.dead);
}

function smashBarrel(br, points, label) {
    br.dead = true;
    const pts = points * (doubleTimer > 0 ? 2 : 1);
    addScore(pts);
    addPopup(br.x, br.y - 16, (label ? label + ' ' : '') + '+' + pts, br.wild ? '#ff9ae8' : '#9dffb0', { size: 15, life: 0.8 });
    spawnParticles(br.x, br.y, br.wild ? '#ff4dd8' : ALIEN_COLOR, 12);
    sfxAlienDie();
    addShake(3);
    haptic(12);
    if (Math.random() < 0.15) spawnPowerup(br.x, br.y);
}

// --- The ape ---
function kongInterval() {
    return Math.max(60, 170 - 12 * boss.n - 28 * (kongPhase() - 1));
}

function startKongAttack() {
    const B = boss;
    const phase = kongPhase();
    const r = Math.random();
    let kind = 'roll';
    if (phase >= 2 && r < 0.3) kind = 'wild';
    if (phase >= 3 && r > 0.82) kind = 'pound';
    if (kind !== 'pound' && B.barrels.length >= barrelLimit()) kind = phase >= 3 ? 'pound' : null;
    if (!kind) {
        B.throwIn = 30;
        return;
    }
    B.pending = { kind, t: kind === 'wild' ? 50 : kind === 'pound' ? 60 : 22, x: paddle.x + paddle.w / 2 };
    B.pose = 'throw';
}

function releaseKongAttack() {
    const B = boss;
    const a = B.pending;
    if (a.kind === 'roll') throwRollingBarrel();
    else if (a.kind === 'wild') throwWildBarrel(a.x);
    else kongPound();
    B.pending = null;
    B.pose = 'idle';
    B.throwIn = Math.round(kongInterval() * (0.8 + Math.random() * 0.4));
}

// ENRAGED chest pound: the tower shakes, every barrel on it bounces and hurries along
function kongPound() {
    const B = boss;
    B.pound = 30;
    addShake(10);
    haptic([40, 30, 40], true);
    tone(90, 0.35, { type: 'square', vol: 0.3, slideTo: 50, key: 'kongPound', force: true });
    tone(90, 0.35, { type: 'square', vol: 0.3, slideTo: 50, delay: 0.18, force: true });
    for (const br of B.barrels) {
        if (br.state !== 'roll') continue;
        br.state = 'hop';
        br.from = br.g;
        br.vx = girderDownhill(KONG_GIRDERS[br.g]) * barrelRollSpeed() * 1.4;
        br.vy = -3.2;
    }
    bossTip('pound', 'IT POUNDS ITS CHEST: THE INVADERS GO FLYING!', 440);
}

function updateKongHammer() {
    const B = boss;
    const H = B.hammer;
    if (B.hammerTime > 0) B.hammerTime -= 1 / 60;
    if (H.state === 'fall') {
        H.y += H.vy * timeScale;
        if (paddleOverlap(H.x, H.y, 16)) {
            H.state = 'gone';
            H.respawn = 60 * 20;
            B.hammerTime = KONG_HAMMER_SECONDS;
            addPopup(paddle.x + paddle.w / 2, paddle.y - 30, 'HAMMER TIME!', '#ffd23f', { size: 24, life: 1.4, rise: 0.6, pop: true });
            noteMoment(45, 'HAMMER TIME!');
            sfxPowerup();
            haptic([15, 20, 15], true);
        } else if (H.y > CANVAS_H + 20) {
            H.state = 'gone';
            H.respawn = 60 * 12;
        }
    } else if (H.state === 'gone' && B.hammerTime <= 0 && --H.respawn <= 0) {
        Object.assign(H, { state: 'hang', x: KONG_HAMMER_POS.x, y: KONG_HAMMER_POS.y, vy: 0 });
    }
}

function updateKongBoss() {
    const B = boss;
    B.t++;
    if (B.dying > 0) {
        updateKongDeath();
        return;
    }
    if (B.intro > 0) {
        if (B.intro === 110) announceBoss('SPACE KONG IS ANGRY!', '#ff8a2a');
        B.intro--;
        // Drops in from the top and lands on its girder with a thud
        const k = Math.min(1, (110 - B.intro) / 50);
        B.y = -KONG_H + (KONG_FEET_Y + KONG_H) * k * k;
        if (B.intro === 60) {
            addShake(9);
            tone(70, 0.4, { type: 'square', vol: 0.3, slideTo: 40, key: 'kongLand', force: true });
            haptic(50, true);
        }
        return;
    }
    B.y = KONG_FEET_Y;
    if (B.flash > 0) B.flash--;
    if (B.cool > 0) B.cool--;
    if (B.pound > 0) B.pound--;
    if (B.pending) {
        if (--B.pending.t <= 0) releaseKongAttack();
    } else if (--B.throwIn <= 0) {
        startKongAttack();
    }
    updateBarrels();
    updateKongHammer();
    if (B.t === 115) bossTip('ladders', 'BASH THE APE! THE BALL GOES UP THROUGH THE LADDERS', 470);
}

function kongBallCollision(b) {
    const B = boss;
    if (B.dying > 0) return;
    // The girders: solid everywhere except the ladder gaps
    for (const p of KONG_PIECES) {
        if (bounceOffSegment(b, p.x0, p.y0, p.x1, p.y1, GIRDER_HALF)) {
            if (Math.abs(b.vx) < 0.6) b.vx = (Math.random() < 0.5 ? -1 : 1) * 0.9; // never stuck bouncing straight up and down
            beep(300, 'girder');
            break;
        }
    }
    if (B.intro > 0) return;
    // Barrels
    for (const br of B.barrels) {
        if (br.dead) continue;
        const dx = b.x - br.x, dy = b.y - br.y;
        if (dx * dx + dy * dy >= (b.r + BARREL_R) * (b.r + BARREL_R)) continue;
        if (fireTimer <= 0) bounceOffCircle(b, br.x, br.y, BARREL_R);
        smashBarrel(br, br.wild ? 75 : 50);
        break;
    }
    keepWhere(B.barrels, br => !br.dead);
    // The hammer on its hook
    const H = B.hammer;
    if (H.state === 'hang' && Math.hypot(b.x - H.x, b.y - H.y) < b.r + 16) {
        H.state = 'fall';
        H.vy = 2.2;
        bounceOffCircle(b, H.x, H.y, 16);
        tone(900, 0.1, { type: 'triangle', vol: 0.2, key: 'hammerFree' });
        bossTip('hammer', 'CATCH THE HAMMER!', 440);
    }
    // The ape itself
    if (B.cool > 0) return;
    const k = kongBox();
    const hit = rectContact(b, k.x, k.y, k.w, k.h);
    if (!hit) return;
    B.cool = 10;
    B.flash = 8;
    let dmg = fireTimer > 0 ? 2 : 1;
    if (explosiveReady) {
        explosiveReady = false;
        dmg += 4;
        addBlast(b.x, b.y);
        boom();
    }
    B.hp -= dmg;
    addScore(20 * dmg * (doubleTimer > 0 ? 2 : 1));
    addPopup(b.x, b.y - 14, '-' + dmg, '#ffffff', { size: 18, life: 0.9, pop: dmg > 1 });
    spawnParticles(b.x, b.y, KONG_BROWN, 8);
    tone(140, 0.15, { type: 'square', vol: 0.25, slideTo: 90, key: 'kongHurt' });
    addShake(4);
    haptic(20);
    if (fireTimer <= 0) bounceOffRect(b, k.x, k.y, k.w, k.h, hit);
    if (B.pending && B.pending.kind !== 'pound') { // a hit knocks the invader out of its hands
        B.pending = null;
        B.pose = 'idle';
        B.throwIn = 60;
    }
    if (B.hp <= 0) killKong();
    else checkKongPhase();
}

function checkKongPhase() {
    const B = boss;
    const p = kongPhase();
    if (p === B.lastPhase) return;
    B.lastPhase = p;
    addPopup(CANVAS_W / 2, 250, p === 3 ? 'ENRAGED!' : 'PHASE 2', '#ff8a2a', { size: 30, life: 1.6, rise: 0.3, pop: true });
    addShake(9);
    haptic([50, 30, 50], true);
    tone(180, 0.5, { type: 'sawtooth', vol: 0.28, slideTo: 90, key: 'phase', force: true });
    if (p === 3) maybeDropBossCheatCapsule(B.x, B.y + 20);
}

function kongBreather() {
    const B = boss;
    for (const br of B.barrels) spawnParticles(br.x, br.y, ALIEN_COLOR, 6);
    B.barrels.length = 0;
    B.pending = null;
    B.pose = 'idle';
    B.throwIn = 150;
}

function killKong() {
    const B = boss;
    B.dying = 160;
    B.pending = null;
    for (const br of B.barrels) {
        addBlast(br.x, br.y);
        spawnParticles(br.x, br.y, ALIEN_COLOR, 8);
    }
    B.barrels.length = 0;
    addShake(12);
    haptic([60, 40, 60, 40, 120], true);
    tone(300, 0.7, { type: 'sawtooth', vol: 0.3, slideTo: 40, key: 'bossDie', force: true });
    noteMoment(100, 'KONG IS DOWN!', 30);
    addPopup(CANVAS_W / 2, 250, 'KONG IS DOWN!', '#ffd23f', { size: 28, life: 2.2, rise: 0.2, pop: true });
}

// It staggers, then topples off its girder and falls head over heels off the bottom of the screen
function updateKongDeath() {
    const B = boss;
    B.dying--;
    if (B.dying > 90) {
        if (B.dying % 8 === 0) {
            addBlast(B.x + (Math.random() - 0.5) * KONG_W, B.y - Math.random() * KONG_H);
            beep(200 + Math.random() * 200, 'bossBoom');
        }
    } else {
        B.fallV = (B.fallV || -4) + 0.3;
        B.y += B.fallV;
    }
    if (B.dying === 90) tone(600, 0.9, { type: 'triangle', vol: 0.25, slideTo: 80, key: 'kongFall', force: true });
    if (B.dying <= 0) finishBoss();
}

function kongRects() {
    const k = kongBox();
    const rects = [[k.x, k.y, k.x + k.w, k.y + k.h]];
    for (const br of boss.barrels) rects.push([br.x - BARREL_R, br.y - BARREL_R, br.x + BARREL_R, br.y + BARREL_R]);
    return rects;
}

// A guided ball plans around the girders
function kongBlocks(x, y) {
    return KONG_PIECES.some(p => pointSegmentDistance(x, y, p.x0, p.y0, p.x1, p.y1) < GIRDER_HALF + BALL_RADIUS);
}

// --- Drawing ---
const kongSprites = {};

function kongSprite(pose, angry) {
    const key = pose + (angry ? '!' : '');
    if (!kongSprites[key]) {
        const colors = { B: KONG_BROWN, T: KONG_TAN, W: angry ? '#ff3b30' : '#ffffff', K: '#1a0a00' };
        kongSprites[key] = makeSprite(KONG_W, KONG_H, g => {
            KONG_ART[pose].forEach((row, r) => {
                for (let c = 0; c < row.length; c++) {
                    const col = colors[row[c]];
                    if (!col) continue;
                    g.fillStyle = col;
                    g.fillRect(c * 6, r * 6, 6, 6);
                }
            });
            g.fillStyle = 'rgba(0, 0, 0, 0.18)'; // a darker lower half of each fur cell, for a chunky pixel shade
            KONG_ART[pose].forEach((row, r) => {
                for (let c = 0; c < row.length; c++) if (row[c] === 'B') g.fillRect(c * 6, r * 6 + 4, 6, 2);
            });
        });
    }
    return kongSprites[key];
}

let girderLayer = null;

function paintGirders(g) {
    for (const gd of KONG_GIRDERS) {
        const x0 = girderLeft(gd), x1 = girderRight(gd);
        const ya = girderY(gd, x0), yb = girderY(gd, x1);
        // The beam: a space-station girder, violet with a zig-zag neon lattice
        g.fillStyle = '#3a1680';
        g.beginPath();
        g.moveTo(x0, ya - GIRDER_HALF);
        g.lineTo(x1, yb - GIRDER_HALF);
        g.lineTo(x1, yb + GIRDER_HALF);
        g.lineTo(x0, ya + GIRDER_HALF);
        g.closePath();
        g.fill();
        g.strokeStyle = '#c9a0ff';
        g.lineWidth = 1.5;
        g.beginPath();
        g.moveTo(x0, ya - GIRDER_HALF + 1);
        g.lineTo(x1, yb - GIRDER_HALF + 1);
        g.moveTo(x0, ya + GIRDER_HALF - 1);
        g.lineTo(x1, yb + GIRDER_HALF - 1);
        for (let x = x0; x < x1; x += 12) {
            const yA = girderY(gd, x), yB = girderY(gd, Math.min(x1, x + 6));
            g.moveTo(x, yA - GIRDER_HALF + 1);
            g.lineTo(Math.min(x1, x + 6), yB + GIRDER_HALF - 1);
            g.lineTo(Math.min(x1, x + 12), girderY(gd, Math.min(x1, x + 12)) - GIRDER_HALF + 1);
        }
        g.stroke();
        // Ladder gaps: cut the beam away and stand a cyan ladder in the opening
        for (const [a, b] of gd.gaps) {
            const ym = girderY(gd, (a + b) / 2);
            g.clearRect(a, Math.min(girderY(gd, a), girderY(gd, b)) - GIRDER_HALF - 2, b - a, Math.abs(girderY(gd, b) - girderY(gd, a)) + 2 * GIRDER_HALF + 4);
            g.strokeStyle = '#2de2e6';
            g.lineWidth = 2;
            g.beginPath();
            g.moveTo(a + 8, ym - 26);
            g.lineTo(a + 8, ym + 30);
            g.moveTo(b - 8, ym - 26);
            g.lineTo(b - 8, ym + 30);
            for (let y = ym - 22; y < ym + 30; y += 9) {
                g.moveTo(a + 8, y);
                g.lineTo(b - 8, y);
            }
            g.stroke();
        }
    }
}

// A rolling invader: one of the regular green invaders curled up into a ball, its face peeking out
let invaderBallSprite = null;

function rollingInvaderSprite() {
    if (!invaderBallSprite) {
        invaderBallSprite = makeSprite(BARREL_R * 2 + 2, BARREL_R * 2 + 2, g => {
            const c = BARREL_R + 1;
            g.fillStyle = '#1f7a36';
            g.beginPath();
            g.arc(c, c, BARREL_R, 0, Math.PI * 2);
            g.fill();
            g.save();
            g.clip();
            g.fillStyle = ALIEN_COLOR; // its body, pixel for pixel, squashed round
            const art = ALIEN_SPRITES[0];
            for (let r = 0; r < 8; r++) for (let col = 0; col < 11; col++) if (art[r][col] === '1') g.fillRect(c - 11 + col * 2, c - 8 + r * 2, 2, 2);
            g.restore();
            g.strokeStyle = '#b8ffc6';
            g.lineWidth = 1.5;
            g.beginPath();
            g.arc(c, c, BARREL_R - 0.5, 0, Math.PI * 2);
            g.stroke();
        });
    }
    return invaderBallSprite;
}

const WILD_INVADER_COLOR = '#ff4dd8';

// A rolling invader spins as it rolls; a wild one flails its legs, uncurled
function drawThrownInvader(br, x, y) {
    if (br.wild) {
        const sp = alienSprite(Math.floor(br.spin * 2) % 2, WILD_INVADER_COLOR);
        ctx.save();
        ctx.translate(x, y);
        ctx.rotate(Math.sin(br.spin * 1.5) * 0.35);
        ctx.globalAlpha = 0.35;
        ctx.fillStyle = WILD_INVADER_COLOR;
        ctx.beginPath();
        ctx.arc(0, 0, BARREL_R + 5, 0, Math.PI * 2);
        ctx.fill();
        ctx.globalAlpha = 1;
        ctx.drawImage(sp, -sp.width / 2, -sp.height / 2);
        ctx.restore();
        return;
    }
    ctx.save();
    ctx.translate(x, y);
    ctx.rotate(br.spin);
    ctx.drawImage(rollingInvaderSprite(), -BARREL_R - 1, -BARREL_R - 1);
    ctx.restore();
}

// The princess, in pixel art at 3px: crown, golden hair, big eyes and a pink gown
const PRINCESS_ART = [
    '...Y.YY.Y...', '...YYYYYY...', '..HHHHHHHH..', '.HHSSSSSSHH.', '.HSEESSEESH.', '.HSEWSSEWSH.',
    '.HSKSSSSKSH.', '.HHSSKKSSHH.', '.HH.SSSS.HH.', 'HH.PPPPPP.HH', 'H.PPPWWPPP.H', '..SPPPPPPS..',
    '..PPPPPPPP..', '.PPDPPPPDPP.', '.PPPPPPPPPP.', 'PPDPPPPPPDPP', 'PPPPPPPPPPPP', 'DDDDDDDDDDDD', '...DD..DD...'
];
const PRINCESS_COLORS = { Y: '#ffd23f', H: '#ffb03a', S: '#ffe0c4', E: '#3a1f6e', W: '#ffffff', K: '#ff8fb8', P: '#ff7ad9', D: '#d93f9c' };
let princessSprite = null;

function drawPrincess(x, feetY, t, rescued) {
    if (!princessSprite) {
        princessSprite = makeSprite(36, PRINCESS_ART.length * 3, g => {
            PRINCESS_ART.forEach((row, r) => {
                for (let c = 0; c < row.length; c++) {
                    const col = PRINCESS_COLORS[row[c]];
                    if (!col) continue;
                    g.fillStyle = col;
                    g.fillRect(c * 3, r * 3, 3, 3);
                }
            });
        });
    }
    const hop = rescued ? Math.abs(Math.sin(t / 8)) * 8 : 0; // jumps for joy once the ape is down
    const top = feetY - princessSprite.height - hop;
    ctx.drawImage(princessSprite, x - 18, top);
    ctx.font = pixelFont(9);
    ctx.textAlign = 'center';
    if (rescued) {
        ctx.fillStyle = '#ff4d8a';
        ctx.fillText('\u2665', x + 16, top - 4 - (t % 40) / 3);
    } else if (Math.floor(t / 40) % 2 === 0) {
        ctx.fillStyle = '#ffffff';
        ctx.fillText('HELP!', x, top - 8);
    }
}

function drawKongBoss() {
    const B = boss;
    if (!girderLayer) girderLayer = makeSprite(CANVAS_W, CANVAS_H, paintGirders);
    const shakeY = B.pound > 0 ? Math.sin(B.pound * 1.7) * 2 : 0;
    ctx.drawImage(girderLayer, 0, shakeY);

    // The princess on her perch, calling for help
    drawPrincess(90, 128 - GIRDER_HALF, B.t, B.dying > 0);

    // For the first seconds of the fight, arrows blink up through every ladder: that's the way to the ape
    if (B.t < 60 * 12 && Math.floor(B.t / 20) % 2 === 0) {
        ctx.fillStyle = '#ffd23f';
        for (const g of KONG_GIRDERS) {
            for (const [a, b] of g.gaps) {
                const mx = (a + b) / 2, my = girderY(g, mx);
                for (const off of [4, -8]) {
                    ctx.beginPath();
                    ctx.moveTo(mx, my + off - 8);
                    ctx.lineTo(mx + 9, my + off + 2);
                    ctx.lineTo(mx - 9, my + off + 2);
                    ctx.closePath();
                    ctx.fill();
                }
            }
        }
    }

    // The hammer on its hook (or falling)
    const H = B.hammer;
    if (H.state === 'hang' || H.state === 'fall') drawHammerGlyph(H.x, H.y, H.state === 'hang' ? Math.sin(B.t / 20) * 0.25 : B.t / 4);

    // The ape
    if (B.y > -KONG_H) {
        const angry = kongPhase() >= 3;
        const sprite = kongSprite(B.pose === 'throw' || B.pound > 0 ? 'throw' : 'idle', angry);
        const bob = B.pose === 'idle' && B.dying <= 0 ? Math.floor(B.t / 20) % 2 : 0;
        ctx.save();
        ctx.translate(Math.round(B.x), Math.round(B.y - KONG_H / 2 + bob));
        if (B.dying > 0 && B.dying <= 90) ctx.rotate(Math.PI); // falls head over heels
        if (B.dying > 90) ctx.translate((Math.random() - 0.5) * 6, 0);
        ctx.drawImage(sprite, -KONG_W / 2, -KONG_H / 2);
        if (B.flash > 0) {
            ctx.globalCompositeOperation = 'lighter';
            ctx.globalAlpha = B.flash / 8 * 0.7;
            ctx.drawImage(sprite, -KONG_W / 2, -KONG_H / 2);
            ctx.globalCompositeOperation = 'source-over';
            ctx.globalAlpha = 1;
        }
        // Its space helmet: a glass bubble over the head, with a glint
        const hy = -KONG_H / 2 + 17;
        ctx.fillStyle = 'rgba(127, 233, 255, 0.13)';
        ctx.strokeStyle = 'rgba(127, 233, 255, 0.75)';
        ctx.lineWidth = 2;
        ctx.beginPath();
        ctx.arc(0, hy, 31, 0, Math.PI * 2);
        ctx.fill();
        ctx.stroke();
        ctx.strokeStyle = 'rgba(255, 255, 255, 0.8)';
        ctx.lineWidth = 3;
        ctx.beginPath();
        ctx.arc(0, hy, 24, -2.5, -1.9);
        ctx.stroke();
        ctx.restore();
        // The barrel it's about to throw, held up high
        if (B.pending && B.pending.kind !== 'pound') {
            drawThrownInvader({ wild: B.pending.kind === 'wild', spin: B.t / 10 }, B.x, B.y - KONG_H - BARREL_R + 2);
        }
        // A wild barrel's aim, so you can get out of the way
        if (B.pending && B.pending.kind === 'wild') {
            ctx.save();
            ctx.strokeStyle = 'rgba(255, 77, 216, 0.45)';
            ctx.setLineDash([5, 7]);
            ctx.lineWidth = 2;
            ctx.beginPath();
            ctx.moveTo(B.x, B.y - KONG_H + 10);
            ctx.lineTo(B.pending.x, paddle.y);
            ctx.stroke();
            ctx.restore();
        }
    }

    // The thrown invaders
    for (const br of B.barrels) drawThrownInvader(br, br.x, br.y + (br.state === 'roll' ? shakeY : 0));
}

function drawHammerGlyph(x, y, angle) {
    ctx.save();
    ctx.translate(x, y);
    ctx.rotate(angle);
    ctx.fillStyle = '#c98a4a';
    ctx.fillRect(-2, -4, 4, 22);   // handle
    ctx.fillStyle = '#d9d9e3';
    ctx.fillRect(-11, -14, 22, 11); // head
    ctx.fillStyle = '#8f8fa3';
    ctx.fillRect(-11, -6, 22, 3);
    ctx.restore();
}

function drawKongBossBar() {
    const B = boss;
    drawSimpleBossBar('SPACE KONG   ' + Math.max(0, B.hp) + ' / ' + B.maxHp, B.hp / B.maxHp);
    if (B.hammerTime > 0) {
        // Hammers swinging over both ends of the paddle, and the time left
        const swing = Math.sin(performance.now() / 70) * 0.9;
        drawHammerGlyph(paddle.x + 6, paddle.y - 8, -0.6 + swing * 0.5);
        drawHammerGlyph(paddle.x + paddle.w - 6, paddle.y - 8, 0.6 - swing * 0.5);
        ctx.save();
        ctx.font = pixelFont(10);
        ctx.textAlign = 'center';
        ctx.fillStyle = '#ffd23f';
        ctx.fillText('HAMMER TIME ' + Math.ceil(B.hammerTime), CANVAS_W - 110, 100);
        ctx.restore();
    }
}

BOSS_KINDS.kong = {
    spawn: spawnKongBoss,
    update: updateKongBoss,
    collide: kongBallCollision,
    draw: drawKongBoss,
    bar: drawKongBossBar,
    rects: kongRects,
    breather: kongBreather,
    blocks: kongBlocks,
    movers: () => boss.barrels.concat(boss.hammer.state === 'fall' ? [boss.hammer] : [])
};
