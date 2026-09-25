// === kongBoss.js ===
// --- Space Gorilla boss (kind 'kong' in the code) ---
// A giant space gorilla in a bubble helmet stands on top of a Donkey Kong-style tower of space-station
// girders and fights you with barrels. They roll down the sloped girders, drop off each end onto the next
// one down (or, now and then, down a ladder gap), and finally fall at your paddle: one that lands on it
// punches a hole. From phase 2 it also hurls blue steel barrels straight at you through the girders, and
// when ENRAGED it pounds its chest, which bounces every barrel on the tower and hurries them along.
// The barrels are also your best weapon: hit one (anywhere, and they're easy to hit) and it flies back up
// at the ape, homing in, for heavy damage, smashing any barrel in its way. The girders only carry the barrels: the ball flies straight through them, so the whole
// screen is yours to play in, and you can hit the ape directly too.
// Mind the princess up in the corner: the ball bounces off her, but she has three hearts, and the third
// hit fails the fight (a life lost, and the ape and the princess both back to full). Her hearts heal: one
// back after PRINCESS_HEAL_FRAMES without a hit, so only three hits close together fail it.
// The ladders are launchers: a ball that touches one on its way up is fired at the ape (with a little
// spread, so it hits more often than not).
// Now and then a hit barrel drops a hammer capsule (the 3rd one always does): catch it for HAMMER TIME, a
// short, wild punch-out. The music goes frantic and the ball becomes the hammer: every time it leaves your
// paddle (or a ladder) it's PUNCHED straight at the ape, twice as fast, homing in, smashing through barrels
// and past the princess, and lands for triple damage, then drops back to the paddle for the next one.
// Barrels landing on your paddle just break.

const KONG_W = 96;
const KONG_H = 72;
const KONG_X = CANVAS_W / 2;       // it stands in the middle of the top girder
const KONG_FEET_Y = 172;
const GIRDER_HALF = 6;             // half the beam's thickness
const BARREL_R = 14;
const BARREL_HIT_REACH = 12;      // extra reach for the ball on a barrel: they should be easy to hit
const HAMMER_BALL_REACH = 10;     // and more again while the ball is a hammer
const BARREL_KICK_SPEED = 10;     // a knocked-back barrel still out-runs anything thrown at you
const BARREL_KICK_DAMAGE = 3;
const BARREL_GRAVITY = 0.25;
const BARREL_MAX_FALL = 7;
// Off the bottom girder the barrel comes at you for real: it drops hard and fast (about half a second to the
// paddle), so it's something to dodge. Rolling along that girder first is its warning.
const BARREL_DROP_GRAVITY = 0.45;
const BARREL_DROP_MAX = 10;
const BOTTOM_GIRDER = 3;
const KONG_HAMMER_SECONDS = 6;      // short and wild: about 4-5 punches
const PUNCH_SPEED = 2.2;             // a punch flies this much faster than the level's ball...
const PUNCH_RETURN_SPEED = 1.3;      // ...and drops back to the paddle a bit faster than usual, for the next
const PUNCH_DAMAGE = 3;
const KONG_HAMMER_DROP_CHANCE = 0.15; // per smashed barrel, while no hammer is falling or in use
const KONG_BROWN = '#8a4a1c';
const KONG_TAN = '#e8b27a';

// The tower, top to bottom. Barrels roll downhill along each girder and drop off its low end; `gaps` are
// ladder openings (x ranges): barrels usually roll over them, but now and then one takes the ladder down.
const KONG_GIRDERS = [
    // Just a ledge under its feet: a ball that makes it up the tower can smack it from below or the sides
    { x0: 380, y0: KONG_FEET_Y, x1: 540, y1: KONG_FEET_Y, gaps: [] },
    { x0: 90, y0: 225, x1: 740, y1: 250, gaps: [[170, 234], [466, 530]] },
    { x0: 160, y0: 336, x1: 810, y1: 311, gaps: [[300, 364], [606, 670]] },
    { x0: 90, y0: 398, x1: 740, y1: 423, gaps: [[216, 280], [536, 600]] },
    // The princess's perch, up in the corner, out of the barrels' way
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

function kongPhase() {
    return bossPhase();
}

function spawnKongBoss(n) {
    const hp = 20 + 7 * n; // 41 on its debut
    boss = {
        kind: 'kong', n, hp, maxHp: hp, x: KONG_X, y: -KONG_H, intro: 110, dying: 0, cool: 0, flash: 0, t: 0,
        barrels: [], throwIn: 150, pose: 'idle', poseT: 0, pending: null, lastPhase: 1, pound: 0,
        hammers: [], hammerTime: 0, princess: { hearts: 3, cool: 0, flash: 0, heal: 0 }
    };
}

function kongBox() {
    return { x: boss.x - KONG_W / 2, y: boss.y - KONG_H, w: KONG_W, h: KONG_H };
}

// --- Barrels ---
function barrelRollSpeed() {
    return Math.min(2.4 + 0.25 * boss.n + 0.4 * (kongPhase() - 1), 5);
}

function throwRollingBarrel() {
    boss.barrels.push({ state: 'roll', g: 0, x: boss.x + KONG_W / 2 + 4, y: 0, vx: 0, vy: 0, spin: 0, wild: false });
    tone(160, 0.12, { type: 'square', vol: 0.18, slideTo: 110, key: 'kongThrow' });
}

// A wild barrel flies straight at where the paddle is, crashing down through the girders
function throwWildBarrel(tx) {
    const x0 = boss.x, y0 = boss.y - KONG_H + 10;
    const speed = Math.min(6 + 0.3 * boss.n, 8.5); // about twice the old pace: a real thing to dodge
    const d = Math.hypot(tx - x0, paddle.y - y0);
    boss.barrels.push({ state: 'wild', x: x0, y: y0, vx: (tx - x0) / d * speed, vy: (paddle.y - y0) / d * speed, spin: 0, wild: true });
    tone(420, 0.2, { type: 'sawtooth', vol: 0.2, slideTo: 140, key: 'kongWild' });
    bossTip('wild', 'BLUE BARRELS COME STRAIGHT AT YOU!', 440);
}

function barrelLimit() {
    return 5 + boss.n;
}

function updateBarrels() {
    const B = boss;
    const roll = barrelRollSpeed() * timeScale;
    for (const br of B.barrels) {
        if (br.state === 'roll') {
            const g = KONG_GIRDERS[br.g];
            br.dir = girderDownhill(g);
            const px = br.x;
            br.x += br.dir * roll;
            br.spin += (br.dir * roll) / BARREL_R; // turns exactly as far as it rolls, so it reads as rolling
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
            br.spin += (br.vx || 0) / BARREL_R * timeScale; // keeps tumbling as it falls
            const drop = br.state === 'fall' && br.from === BOTTOM_GIRDER; // the last drop, down at you
            br.vy = Math.min(br.vy + (drop ? BARREL_DROP_GRAVITY : BARREL_GRAVITY) * timeScale, drop ? BARREL_DROP_MAX : BARREL_MAX_FALL);
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
            br.spin += 0.2 * timeScale;
            br.x += br.vx * timeScale;
            br.y += br.vy * timeScale;
            if (br.x < BARREL_R || br.x > CANVAS_W - BARREL_R) br.vx = -br.vx;
        } else if (br.state === 'kick') {
            updateKickedBarrel(br);
            continue;
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
                    bossTip('smash', 'HIT THE BARRELS: THEY FLY BACK AT THE GORILLA!', 440);
                }
                spawnParticles(br.x, br.y, br.wild ? '#5b8cff' : '#c0782e', 10);
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
    addPopup(br.x, br.y - 16, (label ? label + ' ' : '') + '+' + pts, br.wild ? '#9fc0ff' : '#ffc07a', { size: 15, life: 0.8 });
    spawnParticles(br.x, br.y, br.wild ? '#5b8cff' : '#c0782e', 12);
    noise(0.12, { vol: 0.2, from: 1800, to: 300, key: 'barrelSmash' });
    addShake(3);
    haptic(12);
    if (!maybeDropHammer(br) && Math.random() < 0.12) spawnPowerup(br.x, br.y);
}

// Every barrel the player deals with, knocked back or smashed, counts toward a hammer: the 3rd always
// drops one, and any later one might. (Only smashes used to count, and in normal play a hit barrel is
// knocked back, not smashed, so the hammer almost never turned up.)
function maybeDropHammer(br) {
    boss.smashed = (boss.smashed || 0) + 1;
    const due = boss.smashed === 3 || (boss.smashed > 3 && Math.random() < KONG_HAMMER_DROP_CHANCE);
    if (!due || boss.hammers.length || boss.hammerTime > 0) return false;
    boss.hammers.push({ x: br.x, y: Math.min(br.y, paddle.y - 150), vy: 2 }); // high enough to see it coming
    return true;
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
    bossTip('pound', 'IT POUNDS ITS CHEST: THE BARRELS GO FLYING!', 440);
}

// Hammer capsules fall like any drop; catching one starts HAMMER TIME
function updateKongHammer() {
    const B = boss;
    if (B.hammerTime > 0) B.hammerTime = Math.max(0, B.hammerTime - 1 / 60);
    for (const H of B.hammers) {
        H.y += H.vy * timeScale;
        if (paddleOverlap(H.x, H.y, 16)) {
            H.done = true;
            B.hammerTime = KONG_HAMMER_SECONDS;
            if (!kongHammerExplained) {
                kongHammerExplained = true;
                addPopup(CANVAS_W / 2, 440, 'EVERY HIT PUNCHES THE GORILLA!', '#ffffff', { size: 18, life: 2.4, rise: 0.15, pop: true });
            }
            addShake(6);
            noteMoment(45, 'HAMMER TIME!');
            sfxPowerup();
            haptic([15, 20, 15], true);
        } else if (H.y > CANVAS_H + 20) {
            H.done = true;
        }
    }
    keepWhere(B.hammers, H => !H.done);
}
let kongHammerExplained = false;

function updateKongBoss() {
    const B = boss;
    B.t++;
    if (B.powFlash > 0) B.powFlash--;
    if (B.dying > 0) {
        updateKongDeath();
        return;
    }
    if (B.intro > 0) {
        if (B.intro === 110) announceBoss('SPACE GORILLA IS ANGRY!', '#ff8a2a');
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
    if (B.princess.cool > 0) B.princess.cool--;
    // Her hearts heal, one at a time, while she's left alone
    const P = B.princess;
    if (P.hearts < 3 && --P.heal <= 0) {
        P.hearts++;
        P.heal = PRINCESS_HEAL_FRAMES;
        addPopup(PRINCESS_BOX.x + PRINCESS_BOX.w / 2, PRINCESS_BOX.y + PRINCESS_BOX.h + 30, '\u2665', '#ff4d8a', { size: 16, life: 1, rise: 0.4 });
        tone(880, 0.1, { type: 'triangle', vol: 0.12, slideTo: 1320, key: 'princessHeal' });
    }
    if (B.princess.flash > 0) B.princess.flash--;
    if (B.pound > 0) B.pound--;
    if (B.pending) {
        if (--B.pending.t <= 0) releaseKongAttack();
    } else if (--B.throwIn <= 0) {
        startKongAttack();
    }
    updateBarrels();
    updateKongHammer();
    if (B.t === 115) bossTip('ladder', 'HIT A LADDER: IT FIRES THE BALL AT THE GORILLA!', 470);
    if (B.t === 115 + 60 * 8) bossTip('kick', 'HIT THE BARRELS: THEY FLY BACK AT HIM!', 470);
    if (B.ladderFlash && --B.ladderFlash.t <= 0) B.ladderFlash = null;
}

function kongBallCollision(b) {
    const B = boss;
    if (B.dying > 0) return;
    // (The girders only carry the barrels: the ball flies straight through them)
    // Ladders: a ball touching one on its way up is fired at the ape
    if (B.intro <= 0 && b.vy < 0 && !(b.ladderCool > 0)) {
        for (const g of KONG_GIRDERS) {
            for (const [a, c] of g.gaps) {
                const ym = girderY(g, (a + c) / 2);
                if (b.x < a + 4 || b.x > c - 4 || b.y < ym - 26 || b.y > ym + 30) continue;
                launchAtKong(b, (a + c) / 2, ym);
                break;
            }
        }
    }
    if (b.ladderCool > 0) b.ladderCool--;
    if (b.punch) { // a punch homes in on the ape: nothing can make it miss
        const k = kongBox();
        const speed = Math.hypot(b.vx, b.vy);
        const a = Math.atan2(k.y + k.h / 2 - b.y, k.x + k.w / 2 - b.x);
        b.vx = Math.cos(a) * speed;
        b.vy = Math.sin(a) * speed;
        if (Math.random() < 0.7) spawnParticles(b.x, b.y, Math.random() < 0.5 ? '#ffd23f' : '#ffffff', 1);
    }
    // The princess: don't hit her (a punch flies past)
    const P = B.princess;
    const ph = !b.punch && rectContact(b, PRINCESS_BOX.x, PRINCESS_BOX.y, PRINCESS_BOX.w, PRINCESS_BOX.h);
    if (ph && B.dying <= 0) {
        bounceOffRect(b, PRINCESS_BOX.x, PRINCESS_BOX.y, PRINCESS_BOX.w, PRINCESS_BOX.h, ph);
        if (P.cool <= 0) hitPrincess();
        if (gameState !== 'playing') return; // that was the third hit
    }
    if (B.intro > 0) return;
    // Barrels
    for (const br of B.barrels) {
        if (br.dead) continue;
        const dx = b.x - br.x, dy = b.y - br.y;
        const reach = b.r + BARREL_R + BARREL_HIT_REACH + (B.hammerTime > 0 ? HAMMER_BALL_REACH : 0);
        if (dx * dx + dy * dy >= reach * reach) continue;
        if (br.state === 'kick') continue; // already on its way up
        if (b.punch) { // a punch smashes straight through
            smashBarrel(br, 100, 'SMASH!');
            continue;
        }
        const d = Math.sqrt(dx * dx + dy * dy) || 1;
        // Any hit knocks it back up at the ape (the ball bounces off it, unless it's a fire ball)
        if (fireTimer <= 0) {
            const along = b.vx * (dx / d) + b.vy * (dy / d);
            if (along < 0) {
                b.vx -= 2 * along * (dx / d);
                b.vy -= 2 * along * (dy / d);
            }
        }
        if (B.dying <= 0) kickBarrel(br, -dx / d, -Math.abs(dy / d) || -1);
        else smashBarrel(br, br.wild ? 75 : 50);
        break;
    }
    keepWhere(B.barrels, br => !br.dead);
    // The ape itself
    if (B.cool > 0) return;
    const k = kongBox();
    const grow = B.hammerTime > 0 ? HAMMER_BALL_REACH : 0; // the hammer reaches further
    const hit = rectContact(b, k.x - grow, k.y - grow, k.w + 2 * grow, k.h + 2 * grow);
    if (!hit) return;
    B.cool = 10;
    if (b.punch) {
        landPunch(b);
        return;
    }
    let dmg = fireTimer > 0 ? 2 : 1;
    if (explosiveReady) {
        explosiveReady = false;
        dmg += 4;
        addBlast(b.x, b.y);
        boom();
    }
    if (fireTimer <= 0) bounceOffRect(b, k.x - grow, k.y - grow, k.w + 2 * grow, k.h + 2 * grow, hit);
    hurtKong(dmg, b.x, b.y, '-' + dmg);
}

// HAMMER TIME: the ball leaves the paddle as a punch (see kongPaddleBounce and the ladders)
function punchAtKong(b) {
    const k = kongBox();
    const a = Math.atan2(k.y + k.h / 2 - b.y, k.x + k.w / 2 - b.x);
    const speed = currentSpeed() * PUNCH_SPEED;
    b.vx = Math.cos(a) * speed;
    b.vy = Math.sin(a) * speed;
    b.punch = true;
    tone(200, 0.12, { type: 'sawtooth', vol: 0.22, slideTo: 900, key: 'punchGo' });
    haptic(15);
}

// It lands: triple damage, a big POW, and the ball drops back toward the paddle for the next punch
function landPunch(b) {
    b.punch = false;
    let dmg = PUNCH_DAMAGE * (fireTimer > 0 ? 2 : 1);
    if (explosiveReady) {
        explosiveReady = false;
        dmg += 4;
        addBlast(b.x, b.y);
        boom();
    }
    hurtKong(dmg, b.x, b.y, 'POW! -' + dmg);
    addShake(12);
    haptic([20, 20, 40], true);
    spawnParticles(b.x, b.y, '#ffd23f', 18);
    sfxPunch();
    boss.powFlash = 8; // the whole screen flashes white for an instant (drawKongBoss)
    const tx = paddle.x + paddle.w / 2 + (Math.random() - 0.5) * paddle.w * 0.6;
    const a = Math.atan2(paddle.y - b.y, tx - b.x);
    const speed = currentSpeed() * PUNCH_RETURN_SPEED;
    b.vx = Math.cos(a) * speed;
    b.vy = Math.abs(Math.sin(a) * speed);
}

// The punch landing: an intense, layered hit, nothing like an ordinary bonk. A deep body thump, a metallic
// clang from the hammer, a sharp crack on top, and a low boom a moment later.
function sfxPunch() {
    tone(110, 0.4, { type: 'square', vol: 0.34, slideTo: 38, key: 'punchThump', force: true });
    tone(1500, 0.22, { type: 'triangle', vol: 0.22, slideTo: 620, key: 'punchClang', force: true });
    tone(2300, 0.12, { type: 'square', vol: 0.1, slideTo: 1800, delay: 0.01, key: 'punchRing', force: true });
    noise(0.12, { vol: 0.34, type: 'highpass', from: 1200, key: 'punchCrack', force: true });
    noise(0.5, { vol: 0.3, from: 500, to: 60, delay: 0.05, key: 'punchBoom', force: true });
}

// A paddle bounce (hook from main.js): in HAMMER TIME every one is a punch
function kongPaddleBounce(b) {
    if (boss.hammerTime > 0 && boss.dying <= 0 && boss.intro <= 0) punchAtKong(b);
}

// Fire the ball from a ladder at the ape: its speed kept (at least a brisk one), aimed with a little spread
function launchAtKong(b, lx, ly) {
    b.ladderCool = 40; // one launch per ladder pass
    boss.ladderFlash = { x: lx, y: ly, t: 12 };
    if (boss.hammerTime > 0) {
        punchAtKong(b);
        return;
    }
    const k = kongBox();
    const aim = Math.atan2(k.y + k.h / 2 - b.y, k.x + k.w / 2 - b.x) + (Math.random() - 0.5) * 0.3;
    const speed = Math.max(Math.hypot(b.vx, b.vy), currentSpeed() * 1.25);
    b.vx = Math.cos(aim) * speed;
    b.vy = Math.sin(aim) * speed;
    spawnParticles(b.x, b.y, '#2de2e6', 8);
    tone(420, 0.16, { type: 'square', vol: 0.18, slideTo: 1300, key: 'ladderLaunch' });
    haptic(12);
}

const PRINCESS_BOX = { x: 72, y: 64, w: 36, h: 58 };
const PRINCESS_HEAL_FRAMES = 60 * 12;

function hitPrincess() {
    const B = boss;
    const P = B.princess;
    P.hearts--;
    P.heal = PRINCESS_HEAL_FRAMES;
    P.cool = 40;
    P.flash = 20;
    const cx = PRINCESS_BOX.x + PRINCESS_BOX.w / 2;
    addShake(5);
    haptic([30, 30, 30], true);
    tone(900, 0.2, { type: 'square', vol: 0.2, slideTo: 500, key: 'princessOw', force: true });
    if (P.hearts > 0) {
        addPopup(cx + 70, PRINCESS_BOX.y + PRINCESS_BOX.h + 42, "DON'T HIT ME!", '#ff7ad9', { size: 14, life: 1.4, rise: 0.2 });
        return;
    }
    // Third hit: the fight's lost. A life goes, and the ape and the princess start over at full strength.
    addPopup(CANVAS_W / 2, 300, 'YOU HIT THE PRINCESS!', '#ff7ad9', { size: 26, life: 2, rise: 0.2, pop: true });
    tone(400, 0.7, { type: 'sawtooth', vol: 0.25, slideTo: 90, key: 'princessFail', force: true });
    B.hp = B.maxHp;
    B.lastPhase = 1;
    P.hearts = 3;
    B.hammerTime = 0;
    B.hammers.length = 0;
    loseLife();
}

function hurtKong(dmg, x, y, label) {
    const B = boss;
    B.flash = 8;
    B.hp -= dmg;
    addScore(20 * dmg * (doubleTimer > 0 ? 2 : 1));
    addPopup(x, y - 14, label, '#ffffff', { size: dmg > 1 ? 22 : 18, life: 0.9, pop: dmg > 1 });
    spawnParticles(x, y, KONG_BROWN, 8 + 2 * dmg);
    tone(140, 0.15, { type: 'square', vol: 0.25, slideTo: 90, key: 'kongHurt' });
    addShake(3 + dmg);
    haptic(20 * dmg, dmg > 1);
    if (B.pending && B.pending.kind !== 'pound') { // a hit knocks the barrel out of its hands
        B.pending = null;
        B.pose = 'idle';
        B.throwIn = 60;
    }
    if (B.hp <= 0) killKong();
    else checkKongPhase();
}

// Knocked back up: it flies off the way it was struck, bent toward the ape and homing in on it, straight
// through the girders
function kickBarrel(br, nx, ny) {
    const k = kongBox();
    let tx = k.x + k.w / 2 - br.x, ty = k.y + k.h / 2 - br.y;
    const td = Math.hypot(tx, ty) || 1;
    let vx = nx * 0.35 + (tx / td) * 0.65, vy = ny * 0.35 + (ty / td) * 0.65;
    const vd = Math.hypot(vx, vy) || 1;
    br.state = 'kick';
    br.vx = (vx / vd) * BARREL_KICK_SPEED;
    br.vy = (vy / vd) * BARREL_KICK_SPEED;
    br.trail = [];
    addScore(25 * (doubleTimer > 0 ? 2 : 1));
    maybeDropHammer(br);
    tone(300, 0.18, { type: 'square', vol: 0.2, slideTo: 900, key: 'barrelKick' });
    spawnParticles(br.x, br.y, '#ffd23f', 6);
    haptic(12);
}

function updateKickedBarrel(br) {
    const B = boss;
    br.trail.push({ x: br.x, y: br.y });
    if (br.trail.length > 6) br.trail.shift();
    // It homes in on the ape as it flies (knocking one back should feel like it's going to land)
    if (B.dying <= 0) {
        const k = kongBox();
        const want = Math.atan2(k.y + k.h / 2 - br.y, k.x + k.w / 2 - br.x);
        const cur = Math.atan2(br.vy, br.vx);
        const diff = Math.atan2(Math.sin(want - cur), Math.cos(want - cur));
        const a = cur + Math.max(-0.07, Math.min(0.07, diff)) * timeScale;
        br.vx = Math.cos(a) * BARREL_KICK_SPEED;
        br.vy = Math.sin(a) * BARREL_KICK_SPEED;
    }
    br.x += br.vx * timeScale;
    br.y += br.vy * timeScale;
    br.spin += 0.5 * timeScale;
    if (br.x < BARREL_R || br.x > CANVAS_W - BARREL_R) br.vx = -br.vx;
    if (br.y < -BARREL_R * 2 || br.y > CANVAS_H + 30) {
        br.dead = true;
        return;
    }
    // Anything in its way gets smashed
    for (const o of B.barrels) {
        if (o === br || o.dead || o.state === 'kick') continue;
        if (Math.hypot(o.x - br.x, o.y - br.y) < BARREL_R * 2) smashBarrel(o, 75, 'CRASH!');
    }
    // BONK
    if (B.dying > 0 || B.intro > 0) return;
    const k = kongBox();
    if (br.x + BARREL_R > k.x && br.x - BARREL_R < k.x + k.w && br.y + BARREL_R > k.y && br.y - BARREL_R < k.y + k.h) {
        br.dead = true;
        addBlast(br.x, br.y);
        spawnParticles(br.x, br.y, '#c0782e', 14);
        noteMoment(45, 'BARREL BONK!');
        hurtKong(BARREL_KICK_DAMAGE, br.x, br.y, 'BONK! -' + BARREL_KICK_DAMAGE);
    }
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
}

function kongBreather() {
    const B = boss;
    for (const br of B.barrels) spawnParticles(br.x, br.y, '#c0782e', 6);
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
        spawnParticles(br.x, br.y, '#c0782e', 8);
    }
    B.barrels.length = 0;
    addShake(12);
    haptic([60, 40, 60, 40, 120], true);
    tone(300, 0.7, { type: 'sawtooth', vol: 0.3, slideTo: 40, key: 'bossDie', force: true });
    noteMoment(100, 'GORILLA DOWN!', 30);
    addPopup(CANVAS_W / 2, 250, 'GORILLA DOWN!', '#ffd23f', { size: 28, life: 2.2, rise: 0.2, pop: true });
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

// Barrels, in pixel art at 2px a pixel, seen end-on as they roll toward the side: a round lid of wooden
// planks with a dark iron rim and a bright cross-brace. Drawn rotated by how far it has rolled, so it
// plainly turns as it goes. Wooden ones roll down the girders; the blue steel ones are the wild throws.
const BARREL_PALETTES = {
    wood: { plank: '#c0782e', seam: '#7a4214', light: '#e8a860', rim: '#3b3550', rimLight: '#8a86a8', brace: '#f2c27a' },
    steel: { plank: '#3d6bd6', seam: '#1f3a8a', light: '#8fb0ff', rim: '#1a1f40', rimLight: '#c9d2ff', brace: '#dfe7ff' }
};
const barrelSprites = {};

function barrelSprite(wild) {
    const key = wild ? 'steel' : 'wood';
    if (!barrelSprites[key]) {
        const P = BARREL_PALETTES[key];
        const N = BARREL_R; // cells across (2px each)
        barrelSprites[key] = makeSprite(N * 2, N * 2, g => {
            const c = (N - 1) / 2;
            for (let y = 0; y < N; y++) {
                for (let x = 0; x < N; x++) {
                    const d = Math.hypot(x - c, y - c);
                    if (d > c + 0.5) continue;
                    let col = P.plank;
                    if (d > c - 0.7) col = (x + y < N ? P.rimLight : P.rim);      // the iron rim, lit top-left
                    else if (d > c - 1.7) col = P.rim;
                    else if (Math.abs(x - y) < 0.6 || Math.abs(x + y - (N - 1)) < 0.6) col = P.brace; // the X brace
                    else if (y % 3 === 0) col = P.seam;                          // plank seams
                    else if (x < c && y < c) col = P.light;
                    g.fillStyle = col;
                    g.fillRect(x * 2, y * 2, 2, 2);
                }
            }
        });
    }
    return barrelSprites[key];
}

// A barrel; a kicked one flies with a hot streak behind it and spins fast
function drawBarrel(br, x, y) {
    if (br.state === 'kick' && br.trail) {
        ctx.save();
        ctx.globalCompositeOperation = 'lighter';
        br.trail.forEach((t, i) => {
            ctx.globalAlpha = 0.12 + 0.06 * i;
            ctx.fillStyle = '#ff9a1f';
            ctx.beginPath();
            ctx.arc(t.x, t.y, BARREL_R * (0.5 + 0.08 * i), 0, Math.PI * 2);
            ctx.fill();
        });
        ctx.restore();
    }
    ctx.save();
    ctx.translate(x, y);
    ctx.rotate(br.spin);
    ctx.drawImage(barrelSprite(br.wild), -BARREL_R, -BARREL_R);
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

function drawPrincess(x, feetY, t, rescued, P) {
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
    const shake = P.flash > 0 ? Math.sin(P.flash * 2) * 3 : 0;
    ctx.drawImage(princessSprite, x - 18 + shake, top);
    if (P.flash > 0 && Math.floor(P.flash / 4) % 2 === 0) { // flashes when hit
        ctx.save();
        ctx.globalCompositeOperation = 'lighter';
        ctx.globalAlpha = 0.6;
        ctx.drawImage(princessSprite, x - 18 + shake, top);
        ctx.restore();
    }
    // Her hearts, under her perch: full ones pink, lost ones dark
    for (let i = 0; i < 3; i++) drawPixelHeart(x - 23 + i * 16, feetY + 14, i < P.hearts ? '#ff4d8a' : '#4a2040');
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

// A little pixel heart (2px pixels), its top-left at (x, y)
function drawPixelHeart(x, y, color) {
    const art = ['.XX.XX.', 'XXXXXXX', 'XXXXXXX', '.XXXXX.', '..XXX..', '...X...'];
    ctx.fillStyle = color;
    art.forEach((row, r) => {
        for (let c = 0; c < row.length; c++) if (row[c] === 'X') ctx.fillRect(x + c * 2, y + r * 2, 2, 2);
    });
}

function drawKongBoss() {
    const B = boss;
    if (!girderLayer) girderLayer = makeSprite(CANVAS_W, CANVAS_H, paintGirders);
    const shakeY = B.pound > 0 ? Math.sin(B.pound * 1.7) * 2 : 0;
    ctx.drawImage(girderLayer, 0, shakeY);

    // The princess on her perch, calling for help
    drawPrincess(90, 128 - GIRDER_HALF, B.t, B.dying > 0, B.princess);

    // Falling hammers: the big pixel hammer itself, turning slowly as it falls
    for (const H of B.hammers) drawHammer(H.x, H.y, B.t / 25, 1.3);

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
            drawBarrel({ wild: B.pending.kind === 'wild', spin: 0 }, B.x, B.y - KONG_H - BARREL_R + 4);
        }
        // A wild barrel's aim, so you can get out of the way
        if (B.pending && B.pending.kind === 'wild') {
            ctx.save();
            ctx.strokeStyle = 'rgba(120, 170, 255, 0.5)';
            ctx.setLineDash([5, 7]);
            ctx.lineWidth = 2;
            ctx.beginPath();
            ctx.moveTo(B.x, B.y - KONG_H + 10);
            ctx.lineTo(B.pending.x, paddle.y);
            ctx.stroke();
            ctx.restore();
        }
    }

    // A ladder that just launched the ball lights up
    if (B.ladderFlash) {
        const f = B.ladderFlash;
        ctx.save();
        ctx.globalCompositeOperation = 'lighter';
        ctx.globalAlpha = f.t / 12;
        ctx.fillStyle = '#2de2e6';
        ctx.fillRect(f.x - 26, f.y - 28, 52, 60);
        ctx.restore();
    }
    // Barrels
    for (const br of B.barrels) drawBarrel(br, br.x, br.y + (br.state === 'roll' ? shakeY : 0));
}

// The hammer, in pixel art at 2px a pixel: a steel head with a lit top edge on a wooden handle with a neon
// pink grip. Painted once; drawn spinning about its middle.
const HAMMER_ART = [
    '................',
    '.dLLLLHHHHHHHHd.',
    '.dLHHHHHHHHHHHd.',
    '.dhhhhhhhhhhhhd.',
    '.dhhhhhhhhhhhhd.',
    '.dddddddddddddd.',
    '......wWWw......',
    '......wWWw......',
    '......wWWw......',
    '......GGGG......',
    '......wWWw......',
    '......GGGG......',
    '......wWWw......',
    '......wWWw......',
    '......wWWw......',
    '......wwww......'
];
const HAMMER_COLORS = { L: '#ffffff', H: '#e6e8f2', h: '#aeb2c8', d: '#5c6080', W: '#c47f3a', w: '#7a4214', G: '#ff2fb4' };
let hammerSprite = null;

function drawHammer(x, y, angle, scale) {
    if (!hammerSprite) {
        hammerSprite = makeSprite(32, 32, g => {
            HAMMER_ART.forEach((row, r) => {
                for (let c = 0; c < row.length; c++) {
                    const col = HAMMER_COLORS[row[c]];
                    if (!col) continue;
                    g.fillStyle = col;
                    g.fillRect(c * 2, r * 2, 2, 2);
                }
            });
        });
    }
    ctx.save();
    ctx.translate(x, y);
    ctx.rotate(angle);
    ctx.scale(scale, scale);
    ctx.drawImage(hammerSprite, -16, -16);
    ctx.restore();
}

// HAMMER TIME: the ball is the hammer, spinning as it flies, with a speed streak behind a punch
function drawKongBall(b) {
    if (boss.hammerTime <= 0 && !b.punch) return false;
    if (b.punch) {
        for (let i = 3; i >= 1; i--) {
            ctx.globalAlpha = 0.12 * (4 - i);
            drawHammer(b.x - b.vx * i * 1.2, b.y - b.vy * i * 1.2, boss.t * 0.6, 1.35);
        }
        ctx.globalAlpha = 1;
    }
    drawHammer(b.x, b.y, boss.t * (b.punch ? 0.6 : 0.35), b.punch ? 1.6 : 1.35);
    return true;
}

function drawKongBossBar() {
    const B = boss;
    if (B.powFlash > 0 && !reduceMotion) { // a punch landing: white flash over the whole arena, fading fast
        ctx.fillStyle = 'rgba(255, 255, 255, ' + (B.powFlash / 8) * 0.45 + ')';
        ctx.fillRect(0, 0, CANVAS_W, CANVAS_H);
    }
    drawSimpleBossBar('SPACE GORILLA   ' + Math.max(0, B.hp) + ' / ' + B.maxHp, B.hp / B.maxHp);
    if (B.hammerTime > 0 && (B.hammerTime > 2 || Math.floor(B.t / 6) % 2 === 0)) {
        // HAMMER TIME, big and pulsing above the paddle (blinking as it runs out)
        const s = 1 + 0.08 * Math.sin(B.t / 4);
        ctx.save();
        ctx.translate(CANVAS_W / 2, 505);
        ctx.scale(s, s);
        ctx.font = pixelFont(26);
        ctx.textAlign = 'center';
        ctx.globalAlpha = 0.85;
        ctx.fillStyle = '#7a1560';
        ctx.fillText('HAMMER TIME!', 3, 3);
        ctx.fillStyle = '#ffd23f';
        ctx.fillText('HAMMER TIME!', 0, 0);
        ctx.restore();
    }
}

// The status chip strip shows how long HAMMER TIME has left
function kongChips() {
    return boss.hammerTime > 0 ? [{ text: 'HAMMER ' + Math.ceil(boss.hammerTime), color: '#ffd23f' }] : [];
}

BOSS_KINDS.kong = {
    spawn: spawnKongBoss,
    update: updateKongBoss,
    collide: kongBallCollision,
    paddleBounce: kongPaddleBounce,
    draw: drawKongBoss,
    bar: drawKongBossBar,
    rects: kongRects,
    breather: kongBreather,
    chips: kongChips,
    tune: () => (boss.hammerTime > 0 ? 'hammer' : 'kong'),
    drawBall: drawKongBall,
    movers: () => boss.barrels.concat(boss.hammers)
};
