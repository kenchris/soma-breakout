// --- Game Constants ---
const CANVAS_W = 900;
const CANVAS_H = 600;

// --- Game Entities ---
let canvas, ctx;
let balls, paddle, bricks, score = 0, lives = 3, level = 1;
let gameState = 'ready'; // ready, playing, won, lost
let isMuted = false;
let movingWalls = []; // sliding barriers from level 3+
let touchDetected = false;

// Run stats and best score (shown on the end screen)
let bestScore = 0;      // persisted high score
let bestAtStart = 0;    // best when this run began, to detect beating it
let newBestShown = false;
let runStats = { maxCombo: 0, bricks: 0, aliens: 0 };
let bricksLeft = 0;
let levelBricksTotal = 0;
let inputLockUntil = 0; // ignore restart/continue input briefly after an end screen appears
const COMBO_MAX = 5;
const reduceMotion = !!(window.matchMedia && window.matchMedia('(prefers-reduced-motion: reduce)').matches);
const BRICK_ROWS = 6;
const BRICK_COLS = 12;
const BRICK_W = 64;
const BRICK_H = 20;
const BRICK_OFFSET_TOP = 60;
const BRICK_OFFSET_LEFT = (CANVAS_W - BRICK_COLS * BRICK_W) / 2;
const PADDLE_W = 110;
const PADDLE_H = 12;
const BALL_RADIUS = 8;

// --- Device & Input Helpers ---
function isTouchDevice() {
    return (
        touchDetected ||
        ('ontouchstart' in window) ||
        (navigator.maxTouchPoints > 0) ||
        (window.matchMedia && window.matchMedia('(pointer: coarse)').matches)
    );
}

function getLaunchMessage(levelWon = false) {
    const isTouch = isTouchDevice();
    if (levelWon) {
        const name = currentLayout().name;
        return isTouch
            ? 'Level ' + level + ' · ' + name + ' unlocked! Tap or press SPACE to continue.'
            : 'Level ' + level + ' · ' + name + ' unlocked! Press SPACE to continue.';
    }
    return isTouch
        ? 'Tap or press SPACE to launch'
        : 'Press SPACE to launch';
}

// summary (optional): { newBest, rows: [[label, value], ...] } rendered as stat tiles
function showOverlay(message, buttonText = 'Launch', summary = null) {
    const overlay = document.getElementById('overlay');
    const msg = document.getElementById('overlay-message');
    const btn = document.getElementById('overlay-button');
    if (msg) msg.textContent = message;
    if (btn) {
        btn.textContent = buttonText;
        btn.style.display = 'inline-block';
    }
    renderSummary(summary);
    if (overlay) overlay.style.display = 'block';
}

function renderSummary(summary) {
    const flag = document.getElementById('overlay-flag');
    const list = document.getElementById('overlay-stats');
    if (flag) flag.style.display = summary && summary.newBest ? 'block' : 'none';
    if (!list) return;
    list.textContent = '';
    if (!summary) {
        list.style.display = 'none';
        return;
    }
    for (const [label, value] of summary.rows) {
        const tile = document.createElement('div');
        tile.className = 'stat';
        const v = document.createElement('b');
        v.textContent = value;
        const l = document.createElement('span');
        l.textContent = label;
        tile.append(v, l);
        list.appendChild(tile);
    }
    list.style.display = 'flex';
}

function buildSummary(levelCleared) {
    return {
        newBest: score > 0 && score > bestAtStart,
        rows: [
            ['Score', score],
            ['Best', bestScore],
            [levelCleared ? 'Level cleared' : 'Level reached', levelCleared ? level - 1 : level],
            ['Max combo', runStats.maxCombo],
            ['Bricks broken', runStats.bricks],
            ['Aliens downed', runStats.aliens]
        ]
    };
}

function hideOverlay() {
    const overlay = document.getElementById('overlay');
    if (overlay) overlay.style.display = 'none';
}

// Stray input right after an end screen appears shouldn't dismiss it before it can be read
function endScreenLocked() {
    return (gameState === 'won' || gameState === 'lost') && performance.now() < inputLockUntil;
}

function handleOverlayAction() {
    if (endScreenLocked()) return;
    if (gameState === 'lost') {
        resetGame(getStartingLevel());
    } else if (gameState === 'ready' || gameState === 'won') {
        launchGame();
    } else if (gameState === 'paused') {
        togglePause();
    }
}

// --- Fullscreen & Orientation Lock ---
async function lockLandscape() {
    try {
        if (screen.orientation && typeof screen.orientation.lock === 'function') {
            await screen.orientation.lock('landscape');
        } else if (screen.lockOrientation) {
            screen.lockOrientation('landscape');
        } else if (screen.mozLockOrientation) {
            screen.mozLockOrientation('landscape');
        } else if (screen.msLockOrientation) {
            screen.msLockOrientation('landscape');
        }
    } catch (e) {
        // Ignored if browser/device doesn't support programmatic orientation lock without fullscreen/PWA
    }
}

function unlockOrientation() {
    try {
        if (screen.orientation && typeof screen.orientation.unlock === 'function') {
            screen.orientation.unlock();
        } else if (screen.unlockOrientation) {
            screen.unlockOrientation();
        } else if (screen.mozUnlockOrientation) {
            screen.mozUnlockOrientation();
        } else if (screen.msUnlockOrientation) {
            screen.msUnlockOrientation();
        }
    } catch (e) {}
}

async function toggleFullscreen() {
    const doc = document;
    const docEl = doc.documentElement;
    const isFS = !!(doc.fullscreenElement || doc.webkitFullscreenElement);

    try {
        if (!isFS) {
            // Must be called synchronously from the tap/click (user activation), before any await
            const request = docEl.requestFullscreen || docEl.webkitRequestFullscreen;
            if (!request) throw new Error('not supported by this browser');
            if (doc.fullscreenEnabled === false) throw new Error('not allowed on this page (embedded or blocked)');
            await request.call(docEl);
            await lockLandscape();
        } else {
            if (doc.exitFullscreen) {
                await doc.exitFullscreen();
            } else if (doc.webkitExitFullscreen) {
                await doc.webkitExitFullscreen();
            }
            unlockOrientation();
        }
    } catch (err) {
        console.warn('Fullscreen / orientation error:', err);
        // Say why on screen: a refused request is otherwise silent, especially on a phone
        addPopup(CANVAS_W / 2, CANVAS_H * 0.5, 'Fullscreen unavailable: ' + ((err && err.message) || err),
            '#ff9a9a', { life: 2.5, size: 18, rise: 0.3 });
    }
}

function updateFullscreenBtn() {
    const btn = document.getElementById('fullscreen-btn');
    if (!btn) return;
    const isFS = !!(document.fullscreenElement || document.webkitFullscreenElement);
    btn.textContent = isFS ? '⛶ Exit' : '⛶ Fullscreen';
}

function launchGame() {
    if (gameState !== 'ready' && gameState !== 'won') return;
    gameState = 'playing';
    const sp = currentSpeed();
    for (const b of balls) {
        b.vx = sp;
        b.vy = -sp;
    }
    hideOverlay();

    // If currently in fullscreen, ensure landscape orientation lock
    if (document.fullscreenElement || document.webkitFullscreenElement) {
        lockLandscape();
    }
}

// --- Initialization Function ---
function getStartingLevel() {
    try {
        const params = new URLSearchParams(window.location.search);
        const lvl = parseInt(params.get('level'), 10);
        if (!isNaN(lvl) && lvl > 0) {
            return lvl;
        }
    } catch (e) {
        // Fallback to level 1
    }
    return 1;
}

function initGame() {
    // FIX: Correctly target the canvas element ID 'canvas' as per index.html
    canvas = document.getElementById('canvas');
    if (!canvas) {
        console.error("Canvas element with ID 'canvas' not found in the DOM.");
        return;
    }
    canvas.width = CANVAS_W;
    canvas.height = CANVAS_H;
    ctx = canvas.getContext('2d');

    try {
        bestScore = parseInt(localStorage.getItem('breakout-best'), 10) || 0;
    } catch (e) {
        bestScore = 0; // Storage unavailable; best is session-only
    }

    // Initialize game state with optional URL level parameter
    resetGame(getStartingLevel());
}

function resetGame(startLevel = 1) {
    score = 0;
    lives = 3;
    level = startLevel;
    gameState = 'ready';
    runStats = { maxCombo: 0, bricks: 0, aliens: 0 };
    bestAtStart = bestScore;
    newBestShown = false;

    // Paddle setup
    paddle = {
        x: CANVAS_W / 2 - PADDLE_W / 2,
        y: CANVAS_H - 30,
        w: PADDLE_W,
        h: PADDLE_H
    };

    // Ball setup (multi-ball: starts with a single ball, can split up to 4)
    balls = [makeBall(CANVAS_W / 2, paddle.y - BALL_RADIUS, 5, -5)];

    // Brick setup
    bricks = [];
    for (let c = 0; c < BRICK_COLS; c++) {
        bricks[c] = [];
        for (let r = 0; r < BRICK_ROWS; r++) {
            bricks[c][r] = {
                x: 0,
                y: 0,
                w: BRICK_W,
                h: BRICK_H,
                color: '#0095DD',
                alive: true,
                points: 0,
                steel: false,
                maxHits: 1,
                hitsLeft: 1
            };
        }
    }
    spawnLevel();

    // Clear leftover particles
    particles.length = 0;
    powerups.length = 0;
    clearTimedEffects();
    shield = false;
    shake = 0;
    combo = 0;
    popups.length = 0;
    blasts.length = 0;

    // Show the launch prompt
    showOverlay(getLaunchMessage(), 'Launch');
}

// --- Level Generation ---
// A level = a layout (which cells hold bricks) + a steel style (which bricks take two hits).
// Layouts repeat every 8 levels and steel styles every 3, so combinations don't repeat for 24 levels.
// Levels 1-5 keep the original layout order.
const CENTER_COL = (BRICK_COLS - 1) / 2;
const LAYOUTS = [
    { name: 'Wall', alive: () => true },
    { name: 'Checkerboard', alive: (c, r) => (c + r) % 2 === 0 },
    { name: 'Stripes', alive: (c) => c % 3 !== 2 },
    { name: 'Pyramid', alive: (c, r) => Math.abs(c - CENTER_COL) <= r + 1.2 },
    {
        // Battlements on top, side towers + centre gate in the middle, solid base
        name: 'Castle',
        alive: (c, r) => {
            if (r === 0) return c % 2 === 0;
            if (r <= 2) return c < 3 || c >= BRICK_COLS - 3 || c === 5 || c === 6;
            return true;
        }
    },
    { name: 'Diagonals', alive: (c, r) => (c + r) % 4 < 2 },
    { name: 'Lattice', alive: (c, r) => r % 2 === 0 || c % 2 === 0 }, // solid rows alternate with checkered gaps
    { name: 'Funnel', alive: (c, r) => Math.abs(c - CENTER_COL) <= (BRICK_ROWS - r) + 0.2 } // inverted pyramid
];
const STEEL_STYLES = ['top row', 'clusters', 'diagonal'];

// Row-based scoring and colour, top to bottom
const ROW_STYLES = [
    { points: 30, color: '#FFD700' },
    { points: 25, color: '#FFA500' },
    { points: 20, color: '#FF4500' },
    { points: 15, color: '#FF0000' },
    { points: 10, color: '#8B0000' },
    { points: 5, color: '#006400' }
];

function currentLayout() {
    return LAYOUTS[(level - 1) % LAYOUTS.length];
}

// --- Steel brick cracks ---
// Procedural and random per hit: 3-4 jagged fissures radiate from where the ball actually struck,
// each with a chance of short offshoots, and every fissure stops when it reaches the brick's edge.
// Stored on the brick as polylines in brick-local coordinates and drawn by drawCrack().
function crackPath(x, y, angle, length, brick, out, branchChance) {
    const pts = [[x, y]];
    const steps = 3 + Math.floor(Math.random() * 3);
    let a = angle;
    for (let s = 0; s < steps; s++) {
        a += (Math.random() - 0.5) * 1.1; // jagged
        const seg = (length / steps) * (0.6 + Math.random() * 0.8);
        const nx = x + Math.cos(a) * seg;
        const ny = y + Math.sin(a) * seg;
        if (nx < 1 || nx > brick.w - 1 || ny < 1 || ny > brick.h - 1) {
            // Ran into the brick's edge: end exactly on it
            pts.push([Math.max(1, Math.min(brick.w - 1, nx)), Math.max(1, Math.min(brick.h - 1, ny))]);
            break;
        }
        x = nx;
        y = ny;
        pts.push([x, y]);
        if (branchChance && Math.random() < branchChance) {
            const side = Math.random() < 0.5 ? -1 : 1;
            out.push(crackPath(x, y, a + side * (0.6 + Math.random() * 0.8), length * 0.35, brick, out, 0));
        }
    }
    return pts;
}

function makeCrack(brick, hitX, hitY) {
    const ox = Math.max(3, Math.min(brick.w - 3, hitX - brick.x));
    const oy = Math.max(3, Math.min(brick.h - 3, hitY - brick.y));
    const lines = [];
    const arms = 3 + Math.floor(Math.random() * 2);
    const base = Math.random() * Math.PI * 2;
    for (let i = 0; i < arms; i++) {
        const angle = base + (i / arms) * Math.PI * 2 + (Math.random() - 0.5) * 0.9;
        lines.push(crackPath(ox, oy, angle, 16 + Math.random() * 30, brick, lines, 0.4));
    }
    return { ox, oy, lines };
}

// Small seeded PRNG (mulberry32) so a given level always generates the same layout, also for ?level=N
function seededRandom(seed) {
    let s = seed >>> 0;
    return function () {
        s = (s + 0x6D2B79F5) >>> 0;
        let t = s;
        t = Math.imul(t ^ (t >>> 15), t | 1);
        t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
        return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
    };
}

// Returns (c, r) => whether that cell is a two-hit steel brick
function buildSteelMask(layout, style) {
    if (style === 'top row') return (c, r) => r === 0;
    if (style === 'diagonal') return (c, r) => (c + r) % 5 === 0;

    // 'clusters': 2x2 steel blocks scattered over cells that actually hold bricks, more of them on later levels
    const rand = seededRandom(level * 7919);
    const marked = new Set();
    const count = Math.min(2 + Math.floor((level - 1) / 3), 5);
    for (let i = 0; i < count; i++) {
        for (let attempt = 0; attempt < 20; attempt++) {
            const c0 = Math.floor(rand() * (BRICK_COLS - 1));
            const r0 = Math.floor(rand() * (BRICK_ROWS - 1));
            const cells = [[c0, r0], [c0 + 1, r0], [c0, r0 + 1], [c0 + 1, r0 + 1]]
                .filter(([c, r]) => layout.alive(c, r));
            if (cells.length >= 2) {
                cells.forEach(([c, r]) => marked.add(c * BRICK_ROWS + r));
                break;
            }
        }
    }
    return (c, r) => marked.has(c * BRICK_ROWS + r);
}

// TNT bricks: 1 on level 1, growing to 5. Placed only where they have neighbours so the blast is
// worth it (never in the top row), seeded per level like the steel clusters. Adjacent TNTs chain.
const TNT_COLOR = '#7a1010';
function placeTnt() {
    const rand = seededRandom(level * 104729);
    const target = Math.min(1 + Math.floor(level / 2), 5);
    let placed = 0;
    for (let attempt = 0; attempt < 80 && placed < target; attempt++) {
        const c = Math.floor(rand() * BRICK_COLS);
        const r = 1 + Math.floor(rand() * (BRICK_ROWS - 1));
        const cell = bricks[c][r];
        if (!cell.alive || cell.steel || cell.tnt) continue;
        let neighbours = 0;
        for (let cc = c - 1; cc <= c + 1; cc++) {
            for (let rr = r - 1; rr <= r + 1; rr++) {
                if ((cc !== c || rr !== r) && cc >= 0 && cc < BRICK_COLS && rr >= 0 && rr < BRICK_ROWS && bricks[cc][rr].alive) {
                    neighbours++;
                }
            }
        }
        if (neighbours < 3) continue;
        cell.tnt = true;
        cell.points = 25;
        cell.color = TNT_COLOR;
        placed++;
    }
}

// Sliding barriers: one from level 3, a counter-moving second from level 8; speed ramps and is capped
function buildWalls() {
    const walls = [];
    if (level >= 3) {
        const y = BRICK_OFFSET_TOP + BRICK_ROWS * BRICK_H + 35; // floats below the brick grid
        const speed = Math.min(2.2 + (level - 3) * 0.5, 6.5);
        walls.push({ x: CANVAS_W / 2 - 60, y: y, w: 120, h: 14, vx: speed });
        if (level >= 8) {
            walls.push({ x: 60, y: y + 50, w: 90, h: 14, vx: -speed });
        }
    }
    return walls;
}

function spawnLevel() {
    const layout = currentLayout();
    const isSteel = buildSteelMask(layout, STEEL_STYLES[(level - 1) % STEEL_STYLES.length]);

    bricksLeft = 0;
    for (let c = 0; c < BRICK_COLS; c++) {
        for (let r = 0; r < BRICK_ROWS; r++) {
            const brick = bricks[c][r];
            brick.x = (c * BRICK_W) + BRICK_OFFSET_LEFT;
            brick.y = (r * BRICK_H) + BRICK_OFFSET_TOP;
            brick.alive = layout.alive(c, r);
            brick.tnt = false;
            brick.crack = null;
            brick.flash = 0;
            if (brick.alive) bricksLeft++;

            if (brick.alive && isSteel(c, r)) {
                // Two-hit steel: first hit cracks it, awards no points
                brick.steel = true;
                brick.maxHits = 2;
                brick.hitsLeft = 2;
                brick.points = 0;
                brick.color = '#71797E'; // Steel gray
            } else {
                brick.steel = false;
                brick.maxHits = 1;
                brick.hitsLeft = 1;
                brick.points = ROW_STYLES[r].points;
                brick.color = ROW_STYLES[r].color;
            }
        }
    }
    placeTnt();
    levelBricksTotal = bricksLeft;
    resetAliens(); // no aliens carry over, and a fresh grace period before the first one

    movingWalls = buildWalls();
    buildBackground();
}

function makeBall(x, y, vx, vy) {
    return { x, y, r: BALL_RADIUS, vx, vy, trail: [], stuck: false, stuckFor: 0, aim: null, aimIn: 0 };
}

// --- Guided ball: aim for maximum damage ---
// How much a shot is worth if its first hit is brick (c, r): the points it (and anything it sets off)
// would clear. Mirrors the game's real damage rules: TNT chains, the armed Explosive blast, fire-ball
// pierce lines, and otherwise the brick plus a bonus for the cluster around it (good follow-up bounces).
function hitValue(c, r) {
    const t = bricks[c][r];
    const worth = q => (q.steel ? (q.hitsLeft > 1 ? 8 : 20) : q.points);
    if (explosiveReady || t.tnt) {
        const { targets, tnt } = collectBlast(c, r, explosiveReady);
        let v = t.tnt ? 20 : 0;
        for (const [tc, tr] of targets) {
            if (bricks[tc][tr].alive) v += worth(bricks[tc][tr]);
        }
        return v + (tnt >= 2 ? 50 * tnt : 0);
    }
    if (fireTimer > 0) {
        // Pierces straight through: everything left in this column counts
        let v = 0;
        for (let rr = 0; rr < BRICK_ROWS; rr++) {
            if (bricks[c][rr].alive) v += worth(bricks[c][rr]);
        }
        return v;
    }
    let v = worth(t);
    for (let cc = c - 1; cc <= c + 1; cc++) {
        for (let rr = r - 1; rr <= r + 1; rr++) {
            if ((cc !== c || rr !== r) && cc >= 0 && cc < BRICK_COLS && rr >= 0 && rr < BRICK_ROWS && bricks[cc][rr].alive) {
                v += 0.25 * worth(bricks[cc][rr]);
            }
        }
    }
    return v;
}

// March a ray from (x, y) along the unit vector (dx, dy), reflecting off the side walls, and return
// the first alive brick it reaches ({c, r}), 'wall' if a sliding barrier blocks it, or null.
function castRay(x, y, dx, dy) {
    const step = 5;
    const lo = BALL_RADIUS;
    const hi = CANVAS_W - BALL_RADIUS;
    for (let i = 0; i < 170; i++) {
        x += dx * step;
        y += dy * step;
        if (x < lo) {
            x = 2 * lo - x;
            dx = -dx;
        } else if (x > hi) {
            x = 2 * hi - x;
            dx = -dx;
        }
        if (y < 0 || y > CANVAS_H) return null;
        for (const w of movingWalls) {
            if (x > w.x - 4 && x < w.x + w.w + 4 && y > w.y - 4 && y < w.y + w.h + 4) return 'wall';
        }
        const c = Math.floor((x - BRICK_OFFSET_LEFT) / BRICK_W);
        const r = Math.floor((y - BRICK_OFFSET_TOP) / BRICK_H);
        if (c >= 0 && c < BRICK_COLS && r >= 0 && r < BRICK_ROWS && bricks[c][r].alive) return { c, r };
    }
    return null;
}

// Sample the upward arc, score what each ray would hit, and return the best shot as
// { vx, vy, c, r } at the current ball speed (null if nothing is hittable).
function bestAim(x, y) {
    const speed = currentSpeed();
    let best = null;
    let bestValue = 0;
    for (let deg = -70; deg <= 70; deg += 7) {
        const a = (deg * Math.PI) / 180;
        const dx = Math.sin(a);
        const dy = -Math.cos(a);
        const hit = castRay(x, y, dx, dy);
        if (!hit || hit === 'wall') continue;
        const v = hitValue(hit.c, hit.r) * (1 - Math.abs(deg) / 400); // slight preference for straighter shots
        if (v > bestValue) {
            bestValue = v;
            best = { vx: dx * speed, vy: dy * speed, c: hit.c, r: hit.r };
        }
    }
    return best;
}

// Where a ball leaving the paddle at b goes: the best shot while Guided, else normal paddle steering
function launchVelocity(b, throwVX) {
    if (guidedTimer > 0) {
        const aim = bestAim(b.x, b.y);
        if (aim) return [aim.vx, aim.vy];
    }
    return paddleDeflection(b.x, throwVX);
}

// In flight: every so often re-pick the best shot, and curve toward it at a limited turn rate
function steerGuided(b) {
    if (b.vy >= 0) return; // only while heading up toward the bricks
    if (--b.aimIn <= 0) {
        b.aimIn = 15;
        b.aim = bestAim(b.x, b.y);
    }
    if (!b.aim) return;
    const cur = Math.atan2(b.vy, b.vx);
    const want = Math.atan2(b.aim.vy, b.aim.vx);
    const diff = Math.atan2(Math.sin(want - cur), Math.cos(want - cur)); // shortest signed angle
    const turn = Math.max(-GUIDED_TURN, Math.min(GUIDED_TURN, diff));
    const speed = Math.hypot(b.vx, b.vy);
    b.vx = Math.cos(cur + turn) * speed;
    b.vy = Math.sin(cur + turn) * speed;
}

// Velocity for a ball leaving the paddle at x: steered by where it hits the paddle, plus a little of
// the paddle's own sideways motion (the "throw"). Used by bounces, sticky releases and the aim preview.
function paddleDeflection(x, throwVX) {
    const hitRatio = Math.max(-1, Math.min(1, (x - (paddle.x + paddle.w / 2)) / (paddle.w / 2)));
    const speed = currentSpeed();
    let vx = hitRatio * speed * 0.866;
    let vy = -Math.sqrt(speed * speed - vx * vx);
    if (throwVX !== 0) {
        vx += throwVX * 0.4;
        const mag = Math.hypot(vx, vy);
        const maxSpeed = speed * 1.6;
        if (mag > maxSpeed) {
            vx *= maxSpeed / mag;
            vy *= maxSpeed / mag;
        }
    }
    return [vx, vy];
}

// Sticky paddle: a caught ball rides the paddle (slide the paddle under it to aim) until released
function releaseBall(b) {
    const [vx, vy] = launchVelocity(b, paddleVX);
    b.vx = vx;
    b.vy = vy;
    b.stuck = false;
    b.stuckFor = 0;
    beep(760, 'release');
    haptic(10);
}

function releaseStuckBalls() {
    let released = false;
    for (const b of balls) {
        if (b.stuck) {
            releaseBall(b);
            released = true;
        }
    }
    return released;
}

// Ball speed ramps up each level (capped), plus up to +1.2 within a level as its bricks are cleared
function currentSpeed() {
    const base = Math.min(5 + (level - 1) * 0.4, 8);
    const cleared = levelBricksTotal > 0 ? 1 - bricksLeft / levelBricksTotal : 0;
    return base + 1.2 * cleared;
}

// --- Ambience: level-tinted gradient backdrop with slow parallax stars ---
let bgGradient = null;
const stars = Array.from({ length: 70 }, () => ({
    x: Math.random() * CANVAS_W,
    y: Math.random() * CANVAS_H,
    z: 0.2 + Math.random() * 0.8, // depth: nearer stars are bigger, brighter and move faster
    tw: Math.random() * Math.PI * 2
}));

function buildBackground() {
    const hue = (235 + (level - 1) * 28) % 360;
    bgGradient = ctx.createLinearGradient(0, 0, 0, CANVAS_H);
    bgGradient.addColorStop(0, 'hsl(' + hue + ', 55%, 5%)');
    bgGradient.addColorStop(1, 'hsl(' + ((hue + 30) % 360) + ', 60%, 17%)');
}

function drawBackground() {
    ctx.fillStyle = bgGradient;
    ctx.fillRect(0, 0, CANVAS_W, CANVAS_H);
    const parallax = paddle ? (paddle.x + paddle.w / 2 - CANVAS_W / 2) * 0.04 : 0;
    ctx.fillStyle = '#cfd8ff';
    for (const s of stars) {
        s.y += 0.06 + s.z * 0.3;
        if (s.y > CANVAS_H) {
            s.y = 0;
            s.x = Math.random() * CANVAS_W;
        }
        s.tw += 0.03;
        const x = (((s.x - parallax * s.z) % CANVAS_W) + CANVAS_W) % CANVAS_W;
        ctx.globalAlpha = (0.25 + 0.55 * s.z) * (0.7 + 0.3 * Math.sin(s.tw));
        const size = 0.7 + s.z * 1.5;
        ctx.fillRect(x, s.y, size, size);
    }
    ctx.globalAlpha = 1;
}

function roundRectPath(x, y, w, h, r) {
    r = Math.min(r, w / 2, h / 2);
    ctx.beginPath();
    ctx.moveTo(x + r, y);
    ctx.arcTo(x + w, y, x + w, y + h, r);
    ctx.arcTo(x + w, y + h, x, y + h, r);
    ctx.arcTo(x, y + h, x, y, r);
    ctx.arcTo(x, y, x + w, y, r);
    ctx.closePath();
}

function fillPoly(points, style) {
    ctx.beginPath();
    ctx.moveTo(points[0][0], points[0][1]);
    for (let i = 1; i < points.length; i++) ctx.lineTo(points[i][0], points[i][1]);
    ctx.closePath();
    ctx.fillStyle = style;
    ctx.fill();
}

// --- Drawing Functions ---
// Dotted preview of where a stuck ball will go when released, plus a ring that drains toward auto-release
function drawStuckAim(b) {
    const [vx, vy] = launchVelocity(b, 0);
    const speed = Math.hypot(vx, vy);
    ctx.save();
    ctx.fillStyle = '#c6ff6a';
    for (let d = 26; d <= 190; d += 18) {
        ctx.globalAlpha = 0.85 - d / 260;
        ctx.beginPath();
        ctx.arc(b.x + (vx / speed) * d, b.y + (vy / speed) * d, 2.5, 0, Math.PI * 2);
        ctx.fill();
    }
    ctx.globalAlpha = 0.9;
    ctx.strokeStyle = '#c6ff6a';
    ctx.lineWidth = 2;
    ctx.beginPath();
    ctx.arc(b.x, b.y, b.r + 5, -Math.PI / 2, -Math.PI / 2 + Math.PI * 2 * (1 - b.stuckFor / STICKY_MAX_FRAMES));
    ctx.stroke();
    ctx.restore();
}

// Ball look by state: a fire ball burns orange, a guided ball glows violet, otherwise red
const BALL_LOOKS = {
    normal: { trailCore: '255, 150, 70', trailEdge: '255, 60, 60', trailA: 0.32, trailGrow: 0.9, halo: '255, 77, 77', haloA: 0.45, haloR: 2.6, mid: '#ff6b6b', edge: '#d40000' },
    fire: { trailCore: '255, 190, 40', trailEdge: '255, 90, 0', trailA: 0.42, trailGrow: 1.3, halo: '255, 150, 20', haloA: 0.6, haloR: 3.4, mid: '#ffd23f', edge: '#ff5a00' },
    guided: { trailCore: '190, 140, 255', trailEdge: '110, 60, 230', trailA: 0.4, trailGrow: 1.1, halo: '160, 108, 255', haloA: 0.55, haloR: 3.0, mid: '#c9a0ff', edge: '#6a2fd0' }
};

// Lock-on reticle over the brick a guided ball is heading for
function drawReticle(brick) {
    const cx = brick.x + brick.w / 2;
    const cy = brick.y + brick.h / 2;
    const spin = performance.now() / 500;
    const pulse = 13 + Math.sin(performance.now() / 120) * 2;
    ctx.save();
    ctx.strokeStyle = '#c9a0ff';
    ctx.lineWidth = 2;
    ctx.globalAlpha = 0.9;
    ctx.beginPath();
    ctx.arc(cx, cy, pulse, 0, Math.PI * 2);
    ctx.stroke();
    ctx.beginPath();
    for (let i = 0; i < 4; i++) {
        const a = spin + (i * Math.PI) / 2;
        ctx.moveTo(cx + Math.cos(a) * (pulse - 4), cy + Math.sin(a) * (pulse - 4));
        ctx.lineTo(cx + Math.cos(a) * (pulse + 6), cy + Math.sin(a) * (pulse + 6));
    }
    ctx.stroke();
    ctx.restore();
}

function drawBall() {
    const look = BALL_LOOKS[fireTimer > 0 ? 'fire' : guidedTimer > 0 ? 'guided' : 'normal'];
    for (const b of balls) {
        if (b.stuck) drawStuckAim(b);
        if (guidedTimer > 0 && b.aim && bricks[b.aim.c][b.aim.r].alive) drawReticle(bricks[b.aim.c][b.aim.r]);
        // Glowing trail: additive blending so overlapping ghosts brighten into a comet tail
        if (b.trail && b.trail.length) {
            ctx.save();
            ctx.globalCompositeOperation = 'lighter';
            for (let t = 0; t < b.trail.length; t++) {
                const tr = b.trail[t];
                const ratio = (t + 1) / b.trail.length;
                const rad = b.r * (0.4 + look.trailGrow * ratio);
                const g = ctx.createRadialGradient(tr.x, tr.y, 0, tr.x, tr.y, rad);
                g.addColorStop(0, 'rgba(' + look.trailCore + ', ' + (look.trailA * ratio) + ')');
                g.addColorStop(1, 'rgba(' + look.trailEdge + ', 0)');
                ctx.fillStyle = g;
                ctx.beginPath();
                ctx.arc(tr.x, tr.y, rad, 0, Math.PI * 2);
                ctx.fill();
            }
            ctx.restore();
        }

        // Main ball: soft halo (cheaper than shadowBlur) plus a sphere with a highlight
        ctx.save();
        const haloR = b.r * look.haloR;
        const halo = ctx.createRadialGradient(b.x, b.y, b.r * 0.6, b.x, b.y, haloR);
        halo.addColorStop(0, 'rgba(' + look.halo + ', ' + look.haloA + ')');
        halo.addColorStop(1, 'rgba(' + look.halo + ', 0)');
        ctx.fillStyle = halo;
        ctx.beginPath();
        ctx.arc(b.x, b.y, haloR, 0, Math.PI * 2);
        ctx.fill();
        const g = ctx.createRadialGradient(b.x - b.r * 0.35, b.y - b.r * 0.35, 1, b.x, b.y, b.r);
        g.addColorStop(0, '#ffffff');
        g.addColorStop(0.35, look.mid);
        g.addColorStop(1, look.edge);
        ctx.fillStyle = g;
        ctx.beginPath();
        ctx.arc(b.x, b.y, b.r, 0, Math.PI * 2);
        ctx.fill();
        ctx.restore();
    }
}

function drawMovingWalls() {
    for (const wall of movingWalls) {
        ctx.save();
        ctx.fillStyle = "rgba(0, 229, 255, 0.25)"; // glow underlay
        ctx.fillRect(wall.x - 3, wall.y - 3, wall.w + 6, wall.h + 6);
        ctx.fillStyle = "#00ffff";
        ctx.fillRect(wall.x, wall.y, wall.w, wall.h);

        // Subtle hazard striped pattern overlay
        ctx.fillStyle = "rgba(0, 0, 0, 0.25)";
        for (let x = wall.x; x < wall.x + wall.w; x += 16) {
            ctx.fillRect(x, wall.y, 8, wall.h);
        }
        ctx.restore();
    }
}

// The shield is a glowing line along the bottom edge that saves one missed ball
function drawShield() {
    if (!shield) return;
    ctx.save();
    ctx.strokeStyle = '#33ddff';
    ctx.globalAlpha = 0.7 + 0.3 * Math.sin(performance.now() / 150);
    ctx.beginPath();
    ctx.moveTo(0, CANVAS_H - 2);
    ctx.lineTo(CANVAS_W, CANVAS_H - 2);
    ctx.lineWidth = 3;
    ctx.stroke();
    ctx.globalAlpha *= 0.3; // wide faint stroke as the glow
    ctx.lineWidth = 9;
    ctx.stroke();
    ctx.restore();
}

function drawCrack(brick) {
    const k = brick.crack;
    const x = brick.x;
    const y = brick.y;
    ctx.save();
    // Dented, darkened spot where the ball struck
    const dent = ctx.createRadialGradient(x + k.ox, y + k.oy, 0, x + k.ox, y + k.oy, 10);
    dent.addColorStop(0, 'rgba(15, 20, 25, 0.6)');
    dent.addColorStop(1, 'rgba(15, 20, 25, 0)');
    ctx.fillStyle = dent;
    ctx.fillRect(x, y, brick.w, brick.h);

    ctx.lineJoin = 'round';
    ctx.lineCap = 'round';
    // A dark groove with a bright lip on top of it reads as a real fissure
    const passes = [
        { off: 0.9, style: 'rgba(0, 0, 0, 0.7)', width: 2.6 },
        { off: 0, style: 'rgba(255, 255, 255, 0.92)', width: 1.2 }
    ];
    for (const pass of passes) {
        ctx.strokeStyle = pass.style;
        ctx.lineWidth = pass.width;
        ctx.beginPath();
        for (const line of k.lines) {
            ctx.moveTo(x + line[0][0] + pass.off, y + line[0][1] + pass.off);
            for (let i = 1; i < line.length; i++) {
                ctx.lineTo(x + line[i][0] + pass.off, y + line[i][1] + pass.off);
            }
        }
        ctx.stroke();
    }
    ctx.restore();
}

function drawBricks() {
    const bev = 3; // bevel thickness
    for (let c = 0; c < BRICK_COLS; c++) {
        for (let r = 0; r < BRICK_ROWS; r++) {
            const brick = bricks[c][r];
            if (!brick.alive) continue;
            const { x, y, w, h } = brick;

            ctx.fillStyle = brick.color;
            ctx.fillRect(x, y, w, h);

            // Beveled edges: light from the top-left, shadow on the bottom-right
            fillPoly([[x, y], [x + w, y], [x + w - bev, y + bev], [x + bev, y + bev]], 'rgba(255, 255, 255, 0.38)');
            fillPoly([[x, y], [x + bev, y + bev], [x + bev, y + h - bev], [x, y + h]], 'rgba(255, 255, 255, 0.2)');
            fillPoly([[x, y + h], [x + bev, y + h - bev], [x + w - bev, y + h - bev], [x + w, y + h]], 'rgba(0, 0, 0, 0.38)');
            fillPoly([[x + w, y], [x + w, y + h], [x + w - bev, y + h - bev], [x + w - bev, y + bev]], 'rgba(0, 0, 0, 0.25)');
            // Soft sheen on the upper half of the face
            ctx.fillStyle = 'rgba(255, 255, 255, 0.08)';
            ctx.fillRect(x + bev, y + bev, w - 2 * bev, (h - 2 * bev) / 2);
            ctx.strokeStyle = 'rgba(0, 0, 0, 0.45)';
            ctx.lineWidth = 1;
            ctx.strokeRect(x + 0.5, y + 0.5, w - 1, h - 1);

            if (brick.steel) {
                // Steel brick metallic border
                ctx.strokeStyle = "#B0C4DE";
                ctx.lineWidth = 1.5;
                ctx.strokeRect(x + 2, y + 2, w - 4, h - 4);

                // If cracked (took 1 hit), draw its crack; a brief white flash sells the impact
                if (brick.hitsLeft === 1 && brick.crack) drawCrack(brick);
                if (brick.flash > 0) {
                    ctx.fillStyle = 'rgba(255, 255, 255, ' + (brick.flash / 6) * 0.6 + ')';
                    ctx.fillRect(x, y, w, h);
                    brick.flash--;
                }
            } else if (brick.tnt) {
                // TNT: hazard stripes, a pulsing glow, and a label so it reads as a bomb
                ctx.fillStyle = 'rgba(255, 210, 0, 0.35)';
                for (let sx = x + 4; sx < x + w - 8; sx += 14) {
                    fillPoly([[sx, y + h - bev], [sx + 6, y + h - bev], [sx + 10, y + bev], [sx + 4, y + bev]], 'rgba(255, 210, 0, 0.28)');
                }
                ctx.fillStyle = 'rgba(255, 90, 0, ' + (0.15 + 0.15 * Math.sin(performance.now() / 180)) + ')';
                ctx.fillRect(x + bev, y + bev, w - 2 * bev, h - 2 * bev);
                ctx.font = 'bold 12px sans-serif';
                ctx.textAlign = 'center';
                ctx.textBaseline = 'middle';
                ctx.fillStyle = '#ffe14d';
                ctx.fillText('TNT', x + w / 2, y + h / 2 + 1);
                ctx.textBaseline = 'alphabetic';
            }
        }
    }
}

// Active effects as small chips in the empty strip above the bricks
function drawStatusChips() {
    const chips = [];
    if (slowTimer > 0) chips.push({ text: 'SLOW ' + Math.ceil(slowTimer), color: '#cc33cc' });
    if (wideTimer > 0) chips.push({ text: 'WIDE ' + Math.ceil(wideTimer), color: '#ff9900' });
    if (doubleTimer > 0) chips.push({ text: '2× SCORE ' + Math.ceil(doubleTimer), color: '#e6b800' });
    if (fireTimer > 0) chips.push({ text: 'FIRE ' + Math.ceil(fireTimer), color: '#ff6a00' });
    if (guidedTimer > 0) chips.push({ text: 'GUIDED ' + Math.ceil(guidedTimer), color: '#a06cff' });
    if (stickyCatches > 0) chips.push({ text: 'STICKY ×' + stickyCatches, color: '#7cb518' });
    if (shield) chips.push({ text: 'SHIELD', color: '#33ddff' });
    if (explosiveReady) chips.push({ text: 'BOOM READY', color: '#ff3366' });
    if (multiReady) chips.push({ text: 'MULTI READY', color: '#3399ff' });
    if (!chips.length) return;

    ctx.save();
    ctx.font = 'bold 12px sans-serif';
    ctx.textAlign = 'left';
    ctx.textBaseline = 'middle';
    let x = 10;
    for (const chip of chips) {
        const w = ctx.measureText(chip.text).width + 16;
        roundRectPath(x, 10, w, 20, 10);
        ctx.globalAlpha = 0.25;
        ctx.fillStyle = chip.color;
        ctx.fill();
        ctx.globalAlpha = 1;
        ctx.strokeStyle = chip.color;
        ctx.lineWidth = 1.5;
        ctx.stroke();
        ctx.fillStyle = '#ffffff';
        ctx.fillText(chip.text, x + 8, 20.5);
        x += w + 6;
    }
    ctx.restore();
}

// --- HUD (DOM) ---
// Only touch the DOM when a value changes; this runs every frame.
const hudCache = {};
let shownCombo = -1;

function setText(id, text) {
    if (hudCache[id] === text) return;
    hudCache[id] = text;
    const el = document.getElementById(id);
    if (el) el.textContent = text;
}

// Combo meter: x1 -> x5, one pip per chained brick; the multiplier caps at COMBO_MAX
function updateComboMeter() {
    const filled = Math.min(combo, COMBO_MAX);
    if (filled === shownCombo) return;
    const increased = filled > shownCombo;
    shownCombo = filled;
    const meter = document.getElementById('combo');
    if (!meter) return;
    setText('combo-label', '×' + Math.max(1, filled));
    meter.querySelectorAll('#combo-pips i').forEach((pip, i) => pip.classList.toggle('on', i < filled));
    meter.classList.toggle('max', filled === COMBO_MAX);
    if (increased && filled > 1) {
        meter.classList.remove('bump');
        void meter.offsetWidth; // restart the CSS animation
        meter.classList.add('bump');
    }
}

function updateHUD() {
    setText('score', 'Score: ' + score);
    setText('lives', 'Lives: ' + '●'.repeat(lives));
    setText('level', 'Level: ' + level);
    setText('best', 'Best: ' + bestScore);
    updateComboMeter();
}

// Score goes through here so the best score is saved and beating it is announced
function addScore(points) {
    if (points <= 0) return;
    score += points;
    if (score > bestScore) {
        bestScore = score;
        try {
            localStorage.setItem('breakout-best', bestScore);
        } catch (e) {
            // Storage unavailable; skip
        }
    }
    if (!newBestShown && bestAtStart > 0 && score > bestAtStart) {
        newBestShown = true;
        addPopup(CANVAS_W / 2, CANVAS_H * 0.55, 'New high score!', '#FFD700', { size: 30, life: 1.6, rise: 0.5, pop: true });
        addShake(4);
        haptic([20, 40, 20, 40, 60], true);
        [523, 659, 784, 1047].forEach((f, i) =>
            tone(f, i === 3 ? 0.25 : 0.12, { type: 'triangle', vol: 0.2, delay: i * 0.09, force: true }));
    }
}

// --- Sound ---
// Every sound goes through tone(). Each call builds an oscillator + gain node, so a burst of
// collisions (a ball riding a moving wall, multi-ball, explosions) used to pile up dozens of
// nodes and choke the audio thread and the game. tone() therefore:
//   - throttles repeats of the same sound (`key`) to one per MIN_GAP_MS,
//   - caps the number of voices playing at once,
//   - never queues sounds while the AudioContext is blocked or the tab is hidden.
let audioCtx = null;
const MAX_VOICES = 8;
const MIN_GAP_MS = 45;
let activeVoices = 0;
const lastPlayedAt = {};

function toggleMute() {
    isMuted = !isMuted;
    const btn = document.getElementById('mute-btn');
    if (btn) {
        btn.textContent = isMuted ? '🔇 Muted' : '🔊 Sound';
        btn.title = isMuted ? 'Unmute sound and vibration (M)' : 'Mute sound and vibration (M)';
    }
}

// Create/resume the AudioContext. Browsers (notably Chrome on Android) start it suspended until
// a user gesture, so this is also called from input handlers.
function ensureAudio() {
    try {
        if (!audioCtx) audioCtx = new (window.AudioContext || window.webkitAudioContext)();
        if (audioCtx.state === 'suspended') audioCtx.resume();
    } catch (e) {
        return null; // Audio not available; ignore
    }
    return audioCtx.state === 'running' ? audioCtx : null;
}

// One-shot tone: optional pitch slide and start delay (seconds).
// `key` throttles repeats of the same sound; `force` (jingles, fanfares) bypasses throttle and cap.
function tone(freq, dur, { type = 'square', vol = 0.15, slideTo = null, delay = 0, key = null, force = false } = {}) {
    if (isMuted || document.hidden) return;
    const ac = ensureAudio();
    if (!ac) return;
    if (!force) {
        const now = performance.now();
        if (activeVoices >= MAX_VOICES) return;
        if (key !== null) {
            if (now - (lastPlayedAt[key] || 0) < MIN_GAP_MS) return;
            lastPlayedAt[key] = now;
        }
    }
    try {
        const t0 = ac.currentTime + delay;
        const osc = ac.createOscillator();
        const gain = ac.createGain();
        osc.type = type;
        osc.frequency.setValueAtTime(freq, t0);
        if (slideTo) osc.frequency.exponentialRampToValueAtTime(slideTo, t0 + dur);
        gain.gain.setValueAtTime(vol, t0);
        gain.gain.exponentialRampToValueAtTime(0.001, t0 + dur);
        osc.connect(gain);
        gain.connect(ac.destination);
        activeVoices++;
        osc.onended = () => {
            activeVoices--;
            osc.disconnect();
            gain.disconnect();
        };
        osc.start(t0);
        osc.stop(t0 + dur);
    } catch (e) {
        // Audio not available; ignore
    }
}

// --- Haptics (navigator.vibrate: Chrome on Android; a no-op on iOS and desktop) ---
// Follows the mute button, and is skipped for reduced-motion users. Light hits are throttled so a
// burst of collisions doesn't buzz constantly (each vibrate() call replaces the previous one);
// `strong` events always go through.
const MIN_HAPTIC_GAP_MS = 60;
let lastHapticAt = 0;
function haptic(pattern, strong = false) {
    if (isMuted || reduceMotion || document.hidden || !navigator.vibrate) return;
    // Chrome ignores (and logs a warning for) vibrate() before the user has interacted with the page
    if (navigator.userActivation && !navigator.userActivation.hasBeenActive) return;
    const now = performance.now();
    if (!strong && now - lastHapticAt < MIN_HAPTIC_GAP_MS) return;
    lastHapticAt = now;
    try {
        navigator.vibrate(pattern);
    } catch (e) {
        // Vibration not available; ignore
    }
}

function beep(freq = 440, key = 'beep') {
    tone(freq, 0.08, { type: 'square', vol: 0.15, key: key });
}

// Short metallic clink when hitting steel brick
function clink() {
    tone(1100, 0.07, { type: 'triangle', vol: 0.2, slideTo: 600, key: 'clink' });
}

// Short explosion boom (low, thuddy)
function boom() {
    tone(90, 0.25, { type: 'sawtooth', vol: 0.3, slideTo: 30, key: 'boom' });
}

// Win jingle: cheerful rising arpeggio (C5, E5, G5, C6)
function playWinJingle() {
    [523.25, 659.25, 783.99, 1046.50].forEach((freq, idx) => {
        tone(freq, 0.25, { type: 'sine', vol: 0.2, delay: idx * 0.1, force: true });
    });
}

// Lose jingle: descending sad tones (G4, F4, Eb4, C4)
function playLoseJingle() {
    [392.00, 349.23, 311.13, 261.63].forEach((freq, idx) => {
        tone(freq, 0.3, { type: 'sawtooth', vol: 0.18, delay: idx * 0.15, force: true });
    });
}

// Particles are capped: they're pure decoration and a few hundred fillRects per frame add up
const MAX_PARTICLES = 220;
function spawnParticles(x, y, color, count = 12) {
    count = Math.min(count, MAX_PARTICLES - particles.length);
    for (let i = 0; i < count; i++) {
        const angle = Math.random() * Math.PI * 2;
        const speed = 2 + Math.random() * 3;
        particles.push({
            x: x,
            y: y,
            vx: Math.cos(angle) * speed,
            vy: Math.sin(angle) * speed,
            life: 20 + Math.random() * 10,
            color: color
        });
    }
}

function drawParticles() {
    for (let i = particles.length - 1; i >= 0; i--) {
        const p = particles[i];
        p.x += p.vx;
        p.y += p.vy;
        p.life--;  // p.life--
        if (p.life <= 0) {
            particles.splice(i, 1);
            continue;
        }
        ctx.fillStyle = p.color;
        ctx.fillRect(p.x - 2, p.y - 2, 4, 4);
    }
}

// --- Powerups ---
// A destroyed brick has a chance to drop a powerup; the paddle catches it.
const POWERUP_CHANCE = 0.25;
// weight: relative drop chance (extra life is the rarest)
const POWERUP_TYPES = [
    { type: 'life', label: '+', color: '#33cc33', text: '+1 Life', weight: 1 },
    { type: 'slow', label: 'S', color: '#cc33cc', text: 'Slow Ball', weight: 2 },
    { type: 'wide', label: 'W', color: '#ff9900', text: 'Wide Paddle', weight: 2 },
    { type: 'explosive', label: 'E', color: '#ff3366', text: 'Explosive!', weight: 2 },
    { type: 'multi', label: 'M', color: '#3399ff', text: 'Multi-Ball!', weight: 2 },
    { type: 'double', label: '2×', color: '#c98f00', text: '2× Score!', weight: 1.5 },
    { type: 'shield', label: null, color: '#22bbdd', text: 'Shield!', weight: 1.5 }, // label null: drawn as a shield icon
    { type: 'fire', label: 'F', color: '#ff6a00', text: 'Fire Ball!', weight: 1.5 },
    { type: 'sticky', label: 'G', color: '#7cb518', text: 'Sticky Paddle!', weight: 2 },
    { type: 'guided', label: 'A', color: '#a06cff', text: 'Guided Ball!', weight: 1.5 }
];
const GUIDED_SECONDS = 8;
const GUIDED_TURN = 0.045; // max steering per frame (radians), so the ball curves rather than snaps
const FIRE_SECONDS = 6;
const STICKY_CATCHES = 3;
const STICKY_MAX_FRAMES = 180; // a stuck ball auto-releases after 3s so it can never soft-lock the game
let powerups = [];
let slowTimer = 0;
let wideTimer = 0;
let doubleTimer = 0;       // seconds of 2x score left
let fireTimer = 0;         // seconds of fire ball left: pierces every brick, never bounces off them
let guidedTimer = 0;       // seconds of guided ball left: aims for the highest-damage shot
let stickyCatches = 0;     // the next N paddle catches stick to the paddle until released
let blasts = [];           // expanding shockwave rings from explosions (decoration)
let shield = false;        // one free miss: the next ball to fall bounces off the bottom edge
let explosiveReady = false; // next brick hit detonates a 3x3 area
let multiReady = false;    // next paddle bounce splits the ball (cap 4)
let combo = 0; // bricks destroyed in a row without a paddle bounce
let popups = []; // floating text popups
let particles = []; // brick shrapnel
let shake = 0; // screen shake magnitude in px, decays each frame

// Timed / one-shot effects that end when a ball is lost or a level is cleared (the shield persists)
function clearTimedEffects() {
    slowTimer = 0;
    wideTimer = 0;
    doubleTimer = 0;
    fireTimer = 0;
    guidedTimer = 0;
    stickyCatches = 0;
    explosiveReady = false;
    multiReady = false;
    paddle.w = PADDLE_W;
    paddleHoles.length = 0; // a new ball / level comes with a repaired paddle
}

function addBlast(x, y) {
    if (blasts.length < 24) blasts.push({ x, y, r: 12, life: 1 });
}

// Shockwave rings: expand and fade (frame-based, like popups and particles)
function drawBlasts() {
    if (!blasts.length) return;
    ctx.save();
    for (let i = blasts.length - 1; i >= 0; i--) {
        const b = blasts[i];
        b.r += 5;
        b.life -= 0.06;
        if (b.life <= 0) {
            blasts.splice(i, 1);
            continue;
        }
        ctx.globalAlpha = b.life * 0.8;
        ctx.strokeStyle = '#ffb347';
        ctx.lineWidth = 2 + b.life * 5;
        ctx.beginPath();
        ctx.arc(b.x, b.y, b.r, 0, Math.PI * 2);
        ctx.stroke();
        ctx.globalAlpha = b.life * 0.35;
        ctx.fillStyle = '#ff7a1a';
        ctx.beginPath();
        ctx.arc(b.x, b.y, b.r * 0.7, 0, Math.PI * 2);
        ctx.fill();
    }
    ctx.restore();
}

function addShake(amount) {
    if (reduceMotion) return;
    shake = Math.min(shake + amount, 16);
}

function addPopup(x, y, text, color, { life = 1, size = 16, rise = 1.5, pop = false, tag = null } = {}) {
    popups.push({ x, y, text, color, life, maxLife: life, size, rise, pop, tag });
}

// Big "x3!" / "x4!" / "x5!" call-out when the combo multiplier climbs
function comboShout(mult, x, y) {
    const colors = { 3: '#FFD700', 4: '#FF9A2E', 5: '#FF4D4D' };
    addPopup(Math.max(60, Math.min(x, CANVAS_W - 60)), y - 26, 'x' + mult + '!', colors[mult] || '#FFD700',
        { size: 22 + mult * 4, life: 1.1, rise: 0.8, pop: true });
    const f = 440 * Math.pow(2, mult / 6);
    tone(f, 0.1, { type: 'triangle', vol: 0.2 });
    tone(f * 1.5, 0.14, { type: 'triangle', vol: 0.2, delay: 0.07 });
    if (mult === COMBO_MAX) addShake(5);
    haptic(mult === COMBO_MAX ? [20, 30, 20, 30, 40] : [12, 30, 12], true);
}

function spawnPowerup(x, y) {
    // Weighted pick
    let roll = Math.random() * POWERUP_TYPES.reduce((sum, p) => sum + p.weight, 0);
    let t = POWERUP_TYPES[POWERUP_TYPES.length - 1];
    for (const p of POWERUP_TYPES) {
        roll -= p.weight;
        if (roll < 0) {
            t = p;
            break;
        }
    }
    powerups.push({ x: x, y: y, type: t.type, label: t.label, color: t.color, vy: 2.5 });
}

function applyPowerup(type) {
    const def = POWERUP_TYPES.find(p => p.type === type);
    // Stack the name above any still-visible catch popups so back-to-back catches stay readable
    const stacked = popups.filter(p => p.tag === 'powerup').length;
    addPopup(paddle.x + paddle.w / 2, paddle.y - 10 - stacked * 22, def.text, def.color, { life: 1.2, tag: 'powerup' });

    if (type === 'life') {
        lives = Math.min(lives + 1, 5);
    } else if (type === 'slow') {
        slowTimer = 6;
    } else if (type === 'wide') {
        wideTimer = 8;
        // W stacks: each W widens the paddle further (1.4x -> 1.7x -> 2.0x, capped)
        const ratio = paddle.w / PADDLE_W;
        const steps = [1.4, 1.7, 2.0];
        const next = steps.find(s => s > ratio);
        if (next) paddle.w = Math.round(PADDLE_W * next);
        paddle.x = Math.max(0, Math.min(paddle.x, CANVAS_W - paddle.w));
        paddleHoles.length = 0; // the new, wider paddle is welded whole
    } else if (type === 'explosive') {
        // Next brick hit detonates a 3x3 area around that brick
        explosiveReady = true;
    } else if (type === 'multi') {
        // Next paddle bounce splits that ball into two (cap 4 balls)
        multiReady = true;
    } else if (type === 'double') {
        doubleTimer = 10; // catching another refreshes the timer
    } else if (type === 'shield') {
        shield = true;
    } else if (type === 'fire') {
        fireTimer = FIRE_SECONDS; // catching another refreshes the timer
    } else if (type === 'sticky') {
        stickyCatches = Math.min(stickyCatches + STICKY_CATCHES, 5);
    } else if (type === 'guided') {
        guidedTimer = GUIDED_SECONDS;
    }
}

function updatePowerups() {
    for (let i = powerups.length - 1; i >= 0; i--) {
        const p = powerups[i];
        p.y += p.vy;
        // Catch test against the solid parts of the paddle
        if (paddleOverlap(p.x, p.y, 12)) {
            applyPowerup(p.type);
            spawnParticles(p.x, p.y, p.color);
            beep();
            haptic(15);
            powerups.splice(i, 1);
            continue;
        }
        if (p.y > CANVAS_H) {
            powerups.splice(i, 1);
        }
    }
}

function drawPowerups() {
    ctx.save();
    ctx.textAlign = 'center';
    for (const p of powerups) {
        ctx.fillStyle = p.color;
        ctx.globalAlpha = 0.3; // halo
        ctx.beginPath();
        ctx.arc(p.x, p.y, 14, 0, Math.PI * 2);
        ctx.fill();
        ctx.globalAlpha = 1;
        ctx.beginPath();
        ctx.arc(p.x, p.y, 10, 0, Math.PI * 2);
        ctx.fill();
        ctx.fillStyle = '#ffffff';
        if (p.label) {
            const wide = p.label.length > 1;
            ctx.font = wide ? 'bold 11px sans-serif' : 'bold 14px sans-serif';
            ctx.fillText(p.label, p.x, p.y + (wide ? 4 : 5));
        } else {
            // Shield icon
            ctx.beginPath();
            ctx.moveTo(p.x, p.y - 6);
            ctx.lineTo(p.x + 5, p.y - 4);
            ctx.lineTo(p.x + 5, p.y + 1);
            ctx.quadraticCurveTo(p.x + 4, p.y + 5, p.x, p.y + 7);
            ctx.quadraticCurveTo(p.x - 4, p.y + 5, p.x - 5, p.y + 1);
            ctx.lineTo(p.x - 5, p.y - 4);
            ctx.closePath();
            ctx.fill();
        }
    }
    ctx.restore();
}

// --- Collision Detection ---
// --- Alien invaders ---
// Aliens warp in at random times, hover in the open middle of the screen and shoot at the paddle.
// A bolt that hits solid paddle punches a hole the ball falls through; holes repair by themselves.
// The ball can shoot aliens down (a bonus and a guaranteed powerup) and destroys their bolts.
const HOLE_W = 28;        // wider than the 16px ball, so a ball over a hole really falls through
const HOLE_SECONDS = 9;
const ALIEN_W = 33;       // 11 x 8 sprite cells at 3px
const ALIEN_H = 24;
const ALIEN_COLOR = '#5CFF7A';
let aliens = [];
let alienBullets = [];
let alienTimer = 0;       // frames until the next alien may warp in
let paddleHoles = [];     // { x: hole centre in paddle-local px, w, life: seconds left }

const ALIEN_SPRITES = [
    ['00100000100', '00010001000', '00111111100', '01101110110', '11111111111', '10111111101', '10100000101', '00011011000'],
    ['00100000100', '10010001001', '10111111101', '11101110111', '11111111111', '01111111110', '00100000100', '01000000010']
];

// -- Paddle holes --
// The solid parts of the paddle as [x0, x1] intervals in canvas coordinates
function paddleSegments() {
    let segs = [[paddle.x, paddle.x + paddle.w]];
    for (const h of paddleHoles) {
        const h0 = paddle.x + h.x - h.w / 2;
        const h1 = paddle.x + h.x + h.w / 2;
        const next = [];
        for (const [a, b] of segs) {
            if (h1 <= a || h0 >= b) {
                next.push([a, b]);
                continue;
            }
            if (h0 > a) next.push([a, h0]);
            if (h1 < b) next.push([h1, b]);
        }
        segs = next;
    }
    return segs;
}

// Circle vs the solid parts of the paddle (identical to a plain paddle rectangle when it has no holes)
function paddleOverlap(px, py, r) {
    const cy = Math.max(paddle.y, Math.min(py, paddle.y + paddle.h));
    for (const [a, b] of paddleSegments()) {
        const dx = px - Math.max(a, Math.min(px, b));
        const dy = py - cy;
        if (dx * dx + dy * dy < r * r) return true;
    }
    return false;
}

function punchHole(worldX) {
    const lx = Math.max(HOLE_W / 2, Math.min(paddle.w - HOLE_W / 2, worldX - paddle.x)); // hole stays inside the paddle
    const near = paddleHoles.find(h => Math.abs(h.x - lx) < HOLE_W * 0.6);
    if (near) {
        near.life = HOLE_SECONDS; // hitting an existing hole just refreshes it
    } else {
        paddleHoles.push({ x: lx, w: HOLE_W, life: HOLE_SECONDS });
        const maxHoles = Math.max(1, Math.floor(paddle.w / 45)); // a narrow paddle can't lose most of its width
        while (paddleHoles.length > maxHoles) paddleHoles.shift();
    }
    spawnParticles(worldX, paddle.y + paddle.h / 2, '#ff9a3c', 14);
    addShake(4);
    haptic([25, 20, 35], true);
    tone(700, 0.18, { type: 'sawtooth', vol: 0.22, slideTo: 120, key: 'zap' });
    addPopup(paddle.x + paddle.w / 2, paddle.y - 22, 'HIT!', '#ff6b6b', { life: 0.8 });
}

// -- Aliens --
function resetAliens(graceSeconds = 8, spreadSeconds = 8) {
    aliens.length = 0;
    alienBullets.length = 0;
    alienTimer = Math.round(60 * (graceSeconds + Math.random() * spreadSeconds));
}

function alienMax() {
    return Math.min(1 + Math.floor((level - 1) / 5), 3);
}

// Frames between arrivals: shorter on later levels, never under ~8s, randomised +-30%
function alienInterval() {
    const base = Math.max(8, 20 - level * 0.9);
    return Math.round(60 * base * (0.7 + Math.random() * 0.6));
}

function alienFireEvery() {
    return Math.round(60 * Math.max(0.9, 2.2 - level * 0.1) * (0.75 + Math.random() * 0.5));
}

function alienBoltSpeed() {
    return Math.min(3.6 + level * 0.25, 6.5);
}

// Where a bolt fired now would be aimed: the paddle centre, led a little in the direction it's moving
function alienAimX() {
    return Math.max(0, Math.min(CANVAS_W, paddle.x + paddle.w / 2 + paddleVX * 10));
}

function spawnAlien() {
    const fromLeft = Math.random() < 0.5;
    const speed = Math.min(1.1 + level * 0.08, 2.4);
    const hp = Math.min(1 + Math.floor(level / 4), 3);
    aliens.push({
        x: fromLeft ? -ALIEN_W : CANVAS_W + ALIEN_W,
        y: 0,
        baseY: 250 + Math.random() * 110,
        w: ALIEN_W,
        h: ALIEN_H,
        vx: (fromLeft ? 1 : -1) * speed,
        hp: hp,
        maxHp: hp,
        entered: false,
        leaving: false,
        life: Math.round(60 * (10 + Math.random() * 5)),
        fireIn: Math.round(70 + Math.random() * 50),
        flash: 0,
        cool: 0,
        t: Math.floor(Math.random() * 100)
    });
    addPopup(CANVAS_W / 2, 46, 'ALIEN INCOMING!', ALIEN_COLOR, { size: 24, life: 1.4, rise: 0.2, pop: true });
    tone(330, 0.15, { type: 'triangle', vol: 0.2, key: 'warn' });
    tone(440, 0.2, { type: 'triangle', vol: 0.2, delay: 0.15, force: true });
    haptic([15, 40, 15], true);
}

function fireAlien(a) {
    const speed = alienBoltSpeed();
    const y0 = a.y + a.h / 2;
    const travel = Math.max(1, (paddle.y - y0) / speed);
    alienBullets.push({ x: a.x, y: y0, vx: (alienAimX() - a.x) / travel, vy: speed });
    tone(1200, 0.1, { type: 'square', vol: 0.12, slideTo: 420, key: 'laser' });
}

function killAlien(i, a) {
    aliens.splice(i, 1);
    runStats.aliens++;
    const points = 250 * (doubleTimer > 0 ? 2 : 1);
    addScore(points);
    spawnParticles(a.x, a.y, ALIEN_COLOR, 22);
    spawnParticles(a.x, a.y, '#ffffff', 8);
    addBlast(a.x, a.y);
    addPopup(a.x, a.y - 12, 'ALIEN DOWN! +' + points, ALIEN_COLOR, { size: 20, life: 1.3, pop: true });
    spawnPowerup(a.x, a.y + 14); // guaranteed drop
    addShake(6);
    haptic([30, 30, 50], true);
    tone(520, 0.3, { type: 'sawtooth', vol: 0.25, slideTo: 60, key: 'alienDown' });
}

function updateAliens() {
    // Holes repair themselves
    for (let i = paddleHoles.length - 1; i >= 0; i--) {
        paddleHoles[i].life -= 1 / 60;
        if (paddleHoles[i].life <= 0) paddleHoles.splice(i, 1);
    }

    // Random arrivals (not when the level is nearly cleared)
    if (aliens.length < alienMax() && bricksLeft > 3 && --alienTimer <= 0) {
        spawnAlien();
        alienTimer = alienInterval();
    }

    for (let i = aliens.length - 1; i >= 0; i--) {
        const a = aliens[i];
        a.t++;
        a.x += a.vx;
        a.y = a.baseY + Math.sin(a.t / 25) * 12;
        if (a.flash > 0) a.flash--;
        if (a.cool > 0) a.cool--;
        if (!a.entered) {
            if (a.x > a.w / 2 && a.x < CANVAS_W - a.w / 2) a.entered = true;
        } else if (!a.leaving) {
            if (a.x < a.w / 2 || a.x > CANVAS_W - a.w / 2) {
                a.x = Math.max(a.w / 2, Math.min(CANVAS_W - a.w / 2, a.x));
                a.vx *= -1;
            }
            if (--a.life <= 0) a.leaving = true;
            if (--a.fireIn <= 0) {
                fireAlien(a);
                a.fireIn = alienFireEvery();
            }
        } else if (a.x < -a.w || a.x > CANVAS_W + a.w) {
            aliens.splice(i, 1); // flew off the far side
        }
    }

    for (let i = alienBullets.length - 1; i >= 0; i--) {
        const b = alienBullets[i];
        b.x += b.vx;
        b.y += b.vy;
        // A ball destroys bolts
        if (balls.some(ball => Math.hypot(ball.x - b.x, ball.y - b.y) < ball.r + 4)) {
            spawnParticles(b.x, b.y, ALIEN_COLOR, 6);
            beep(900, 'shot');
            alienBullets.splice(i, 1);
            continue;
        }
        // Hits solid paddle (a bolt over an existing hole just passes through)
        if (b.y + 6 >= paddle.y && b.y - 6 <= paddle.y + paddle.h && paddleSegments().some(([s0, s1]) => b.x >= s0 && b.x <= s1)) {
            punchHole(b.x);
            alienBullets.splice(i, 1);
            continue;
        }
        if (b.y > CANVAS_H + 10 || b.x < -10 || b.x > CANVAS_W + 10) alienBullets.splice(i, 1);
    }
}

// Ball vs aliens: damage, bounce (a fire ball pierces) and a short cooldown so one contact = one hit
function alienBallCollision(b) {
    for (let i = aliens.length - 1; i >= 0; i--) {
        const a = aliens[i];
        if (a.cool > 0) continue;
        const left = a.x - a.w / 2;
        const top = a.y - a.h / 2;
        const cx = Math.max(left, Math.min(b.x, left + a.w));
        const cy = Math.max(top, Math.min(b.y, top + a.h));
        const dx = b.x - cx;
        const dy = b.y - cy;
        if (dx * dx + dy * dy >= b.r * b.r) continue;

        a.cool = 10;
        a.hp--;
        a.flash = 6;
        if (fireTimer <= 0) {
            if (Math.abs(dx) > Math.abs(dy)) {
                const dir = dx > 0 ? 1 : -1;
                b.vx = dir * Math.abs(b.vx);
                b.x = dir > 0 ? left + a.w + b.r : left - b.r;
            } else {
                const dir = dy >= 0 ? 1 : -1;
                b.vy = dir * Math.abs(b.vy);
                b.y = dir > 0 ? top + a.h + b.r : top - b.r;
            }
        }
        if (a.hp <= 0) {
            killAlien(i, a);
        } else {
            clink();
            addShake(2);
            haptic(15);
            spawnParticles(b.x, b.y, ALIEN_COLOR, 6);
        }
    }
}

// -- Drawing --
function drawAliens() {
    for (const a of aliens) {
        const charging = a.entered && !a.leaving && a.fireIn <= 30;
        const cell = 3;
        const sx = a.x - (11 * cell) / 2;
        const sy = a.y - (8 * cell) / 2;

        if (charging) {
            // Aim line to where the bolt would go right now: time to dodge
            ctx.save();
            ctx.strokeStyle = 'rgba(255, 90, 90, 0.4)';
            ctx.lineWidth = 1.5;
            ctx.setLineDash([4, 6]);
            ctx.beginPath();
            ctx.moveTo(a.x, a.y + a.h / 2);
            ctx.lineTo(alienAimX(), paddle.y);
            ctx.stroke();
            ctx.restore();
        }

        ctx.save();
        ctx.globalAlpha = 0.2; // glow underlay
        ctx.fillStyle = charging ? '#ff5a5a' : ALIEN_COLOR;
        ctx.beginPath();
        ctx.ellipse(a.x, a.y, 26, 18, 0, 0, Math.PI * 2);
        ctx.fill();
        ctx.globalAlpha = 1;

        ctx.fillStyle = a.flash > 0 ? '#ffffff' : (charging && Math.floor(a.t / 3) % 2 === 0 ? '#ff5a5a' : ALIEN_COLOR);
        const sprite = ALIEN_SPRITES[Math.floor(a.t / 14) % 2];
        for (let r = 0; r < 8; r++) {
            for (let c = 0; c < 11; c++) {
                if (sprite[r][c] === '1') ctx.fillRect(sx + c * cell, sy + r * cell, cell, cell);
            }
        }
        // Remaining hit points for tougher aliens
        if (a.maxHp > 1) {
            for (let h = 0; h < a.maxHp; h++) {
                ctx.fillStyle = h < a.hp ? '#ffffff' : 'rgba(255, 255, 255, 0.25)';
                ctx.fillRect(a.x - (a.maxHp * 6) / 2 + h * 6 + 1, sy - 7, 4, 3);
            }
        }
        ctx.restore();
    }
}

function drawAlienBullets() {
    if (!alienBullets.length) return;
    ctx.save();
    for (const b of alienBullets) {
        ctx.globalAlpha = 0.3; // halo
        ctx.fillStyle = ALIEN_COLOR;
        ctx.fillRect(b.x - 5, b.y - 9, 10, 18);
        ctx.globalAlpha = 1;
        ctx.fillStyle = '#eafff0';
        ctx.fillRect(b.x - 1.5, b.y - 7, 3, 14);
    }
    ctx.restore();
}

function drawPaddle() {
    ctx.save();
    for (const [a, b] of paddleSegments()) {
        ctx.globalAlpha = 0.25; // glow underlay
        ctx.fillStyle = '#0095DD';
        roundRectPath(a - 3, paddle.y - 3, b - a + 6, paddle.h + 6, 8);
        ctx.fill();
        ctx.globalAlpha = 1;
        const g = ctx.createLinearGradient(0, paddle.y, 0, paddle.y + paddle.h);
        g.addColorStop(0, '#6fd6ff');
        g.addColorStop(1, '#0070b0');
        ctx.fillStyle = g;
        roundRectPath(a, paddle.y, b - a, paddle.h, 4);
        ctx.fill();
    }
    // Molten notches on the torn edges of each hole; they blink cyan just before the hole repairs
    for (const h of paddleHoles) {
        const repairing = h.life < 1.2 && Math.floor(h.life * 8) % 2 === 0;
        ctx.fillStyle = repairing ? '#7fe9ff' : '#ff8a2a';
        const x0 = paddle.x + h.x - h.w / 2;
        const x1 = paddle.x + h.x + h.w / 2;
        for (let i = 0; i < 3; i++) {
            const len = 2 + ((i * 7 + Math.floor(h.x)) % 3);
            ctx.fillRect(x0 - len, paddle.y + 1 + i * 4, len, 2);
            ctx.fillRect(x1, paddle.y + 1 + i * 4, len, 2);
        }
    }
    ctx.restore();
}

// Every brick caught by one hit: the brick itself, its 3x3 neighbours if the Explosive powerup is
// armed, and, recursively, the 3x3 around any TNT brick caught in the blast (chain reaction).
// Returns the targets plus the ring centres (armed hit + each TNT) for the shockwave effect.
function collectBlast(c, r, armed) {
    const targets = [[c, r]];
    const seen = new Set([c * BRICK_ROWS + r]);
    const centers = [];
    const addAround = (bc, br) => {
        for (let cc = bc - 1; cc <= bc + 1; cc++) {
            for (let rr = br - 1; rr <= br + 1; rr++) {
                if (cc < 0 || cc >= BRICK_COLS || rr < 0 || rr >= BRICK_ROWS) continue;
                const key = cc * BRICK_ROWS + rr;
                if (!seen.has(key)) {
                    seen.add(key);
                    targets.push([cc, rr]);
                }
            }
        }
    };
    if (armed) {
        addAround(c, r);
        centers.push(bricks[c][r]);
    }
    let tnt = 0;
    for (let i = 0; i < targets.length; i++) { // targets grows as TNT bricks are found
        const t = bricks[targets[i][0]][targets[i][1]];
        if (t.alive && t.tnt) {
            tnt++;
            centers.push(t);
            addAround(targets[i][0], targets[i][1]);
        }
    }
    return { targets, tnt, centers };
}

function collisionDetection(b) {
    const onFire = fireTimer > 0;
    for (let c = 0; c < BRICK_COLS; c++) {
        for (let r = 0; r < BRICK_ROWS; r++) {
            const brick = bricks[c][r];
            if (brick.alive) {
                // Circle-AABB test: closest point on the brick's AABB to the ball center
                const cx = Math.max(brick.x, Math.min(b.x, brick.x + brick.w));
                const cy = Math.max(brick.y, Math.min(b.y, brick.y + brick.h));
                const dx = b.x - cx;
                const dy = b.y - cy;
                if (dx * dx + dy * dy < b.r * b.r) {
                    // Check if hit brick is a two-hit steel brick with hits left
                    const wasExplosive = explosiveReady;
                    explosiveReady = false;

                    // If it's a steel brick with 2 hits left and NOT hit by explosive burst or a fire ball:
                    // First hit cracks it, does not destroy it, awards 0 points
                    if (brick.steel && brick.hitsLeft > 1 && !wasExplosive && !onFire) {
                        brick.hitsLeft--;
                        brick.crack = makeCrack(brick, b.x, b.y);
                        brick.flash = 6;
                        clink();
                        addShake(2);
                        haptic(12);
                        spawnParticles(b.x, b.y, '#B0C4DE');
                        addPopup(brick.x + brick.w / 2, brick.y + brick.h / 2, 'CRACK!', '#E0E0E0', { life: 0.8 });

                        // Rebound ball
                        if (Math.abs(dx) > Math.abs(dy)) {
                            b.vx *= -1;
                        } else {
                            b.vy *= -1;
                        }
                        return;
                    }

                    // Brick destruction (1-hit brick, cracked steel second hit, fire ball, explosive, or TNT)
                    const { targets, tnt, centers } = collectBlast(c, r, wasExplosive);
                    const wasBlast = wasExplosive || tnt > 0;
                    for (const center of centers) {
                        addBlast(center.x + center.w / 2, center.y + center.h / 2);
                    }

                    // Combo: bricks broken in a row since the last paddle bounce,
                    // multiplier capped at x5 (applied to every brick in the burst)
                    combo++;
                    runStats.maxCombo = Math.max(runStats.maxCombo, combo);
                    const mult = Math.min(combo, COMBO_MAX);
                    const scoreMult = doubleTimer > 0 ? 2 : 1;
                    let totalEarned = 0;
                    let destroyed = 0;
                    for (const [tc, tr] of targets) {
                        const t = bricks[tc][tr];
                        if (!t.alive) continue;
                        t.alive = false;
                        destroyed++;
                        totalEarned += t.points * mult * scoreMult;
                        spawnParticles(t.x + t.w / 2, t.y + t.h / 2, t.color);
                    }
                    // Chain bonus: 2+ TNT bricks going off together
                    const chainBonus = tnt >= 2 ? 50 * tnt * scoreMult : 0;
                    totalEarned += chainBonus;
                    bricksLeft -= destroyed;
                    runStats.bricks += destroyed;
                    addScore(totalEarned);

                    // Floating score popup at the break point
                    const tags = [];
                    if (wasBlast) tags.push('boom');
                    if (mult > 1) tags.push('x' + mult);
                    if (scoreMult > 1) tags.push('2x');
                    const popupText = brick.steel
                        ? 'BROKEN!'
                        : '+' + totalEarned + (tags.length ? ' (' + tags.join(' · ') + ')' : '');
                    const popupX = brick.x + brick.w / 2;
                    const popupY = brick.y + brick.h / 2;
                    addPopup(popupX, popupY, popupText,
                        brick.steel ? '#B0C4DE' : (mult > 1 ? '#FFD700' : '#FFFFFF'));

                    // Combo call-out when the multiplier climbs to x3, x4, x5
                    if (combo >= 3 && combo <= COMBO_MAX) comboShout(combo, popupX, popupY);

                    // TNT chain call-out
                    if (tnt >= 2) {
                        addPopup(Math.max(80, Math.min(popupX, CANVAS_W - 80)), popupY - 44,
                            'CHAIN x' + tnt + '!  +' + chainBonus, '#FF8C1A', { size: 26, life: 1.4, rise: 0.7, pop: true });
                    }

                    // Screen shake: light per brick (heavier deeper in a combo), big for explosions
                    addShake(wasBlast ? Math.min(12 + 2 * (tnt - 1), 16) : brick.steel ? 3 : 1.5 + mult * 0.4);
                    if (wasBlast) haptic(tnt >= 2 ? [40, 30, 60] : 45, true);
                    else haptic(brick.steel ? 15 : 8);

                    // A fire ball pierces straight through: no speed-up, no bounce
                    if (!onFire) {
                        // Slightly speed up, then re-normalize to keep magnitude sane
                        const speed = Math.hypot(b.vx, b.vy);
                        const newSpeed = Math.min(speed * 1.02, 10);
                        const factor = newSpeed / speed;
                        b.vx *= factor;
                        b.vy *= factor;

                        if (Math.abs(dx) > Math.abs(dy)) {
                            // ball entered from the side -> flip vx
                            b.vx *= -1;
                        } else {
                            // ball entered from top/bottom -> flip vy
                            b.vy *= -1;
                        }
                    }

                    if (wasBlast) {
                        boom();
                    } else if (brick.steel) {
                        clink();
                    } else {
                        beep();
                    }
                    
                    // Chance for a powerup to drop from the destroyed brick
                    if (Math.random() < POWERUP_CHANCE) {
                        spawnPowerup(brick.x + brick.w / 2, brick.y + brick.h / 2);
                    }
                    
                    // Check for win condition
                    if (bricksLeft <= 0) {
                        level++;
                        gameState = 'won';
                        powerups.length = 0;
                        clearTimedEffects();
                        combo = 0;
                        spawnLevel();
                        playWinJingle();
                        addShake(6);
                        haptic([30, 60, 30, 60, 80], true);
                        // Reset ball on the paddle
                        const sp = currentSpeed();
                        balls = [makeBall(paddle.x + paddle.w / 2, paddle.y - BALL_RADIUS, sp, -sp)];
                        inputLockUntil = performance.now() + 700;
                        showOverlay(getLaunchMessage(true), 'Continue', buildSummary(true));
                        return;
                    }
                }
            }
        }
    }
}


// --- Game Logic Update ---
function update() {
    // 0. Update sliding barrier / moving wall (level 3+)
    for (const wall of movingWalls) {
        wall.x += wall.vx;
        if (wall.x <= 0) {
            wall.x = 0;
            wall.vx *= -1;
        } else if (wall.x + wall.w >= CANVAS_W) {
            wall.x = CANVAS_W - wall.w;
            wall.vx *= -1;
        }
    }

    // 1. Move each ball
    for (let i = balls.length - 1; i >= 0; i--) {
        const b = balls[i];

        // Sticky: a caught ball keeps its x (slide the paddle under it to aim), clamped onto the paddle
        if (b.stuck) {
            b.x = Math.max(paddle.x + b.r, Math.min(b.x, paddle.x + paddle.w - b.r));
            b.y = paddle.y - b.r;
            b.trail.length = 0;
            if (++b.stuckFor >= STICKY_MAX_FRAMES) releaseBall(b);
            continue;
        }

        // Update ball trail (store previous positions)
        if (!b.trail) b.trail = [];
        b.trail.push({ x: b.x, y: b.y });
        if (b.trail.length > 12) {
            b.trail.shift();
        }

        if (guidedTimer > 0) steerGuided(b);
        b.x += b.vx;
        b.y += b.vy;

        // 2. Wall collisions
        if (b.x + b.r > CANVAS_W) {
            b.x = CANVAS_W - b.r;
            b.vx *= -1;
        } else if (b.x - b.r < 0) {
            b.x = b.r;
            b.vx *= -1;
        }
        if (b.y - b.r < 0) {
            // Top wall bounce
            b.y = b.r;
            b.vy *= -1;
        }

        // 2a. Moving wall collision (circle vs AABB)
        let touchingWall = false;
        for (const wall of movingWalls) {
            const cx = Math.max(wall.x, Math.min(b.x, wall.x + wall.w));
            const cy = Math.max(wall.y, Math.min(b.y, wall.y + wall.h));
            const dx = b.x - cx;
            const dy = b.y - cy;
            if (dx * dx + dy * dy < b.r * b.r) {
                // Rebound off the wall and push the ball out of it. Without the push-out, a wall
                // sweeping into the ball (or a slow ball riding it) stays overlapped and re-triggers
                // the sound and particles every frame.
                if (Math.abs(dx) > Math.abs(dy)) {
                    const dir = dx > 0 ? 1 : -1;
                    b.vx = dir * Math.abs(b.vx);
                    b.x = dir > 0 ? wall.x + wall.w + b.r : wall.x - b.r;
                } else {
                    const dir = dy > 0 ? 1 : -1;
                    b.vy = dir * Math.abs(b.vy);
                    b.y = dir > 0 ? wall.y + wall.h + b.r : wall.y - b.r;
                }
                // Effects only when contact begins; a wall carrying the ball stays "in contact"
                if (!b.onWall) {
                    beep(580, 'wall');
                    spawnParticles(b.x, b.y, '#00ffff', 5);
                }
                touchingWall = true;
            }
        }
        b.onWall = touchingWall;

        // 2b. Paddle bounce: circle vs AABB test, only while moving down
        if (b.vy > 0) {
            // Solid parts only: a ball over an alien-shot hole falls straight through
            if (paddleOverlap(b.x, b.y, b.r)) {
                // Snap the ball to the top of the paddle
                b.y = paddle.y - b.r;
                // Classic paddle bounce logic (steer)
                [b.vx, b.vy] = launchVelocity(b, paddleVX);
                b.aim = null;
                b.aimIn = 0;
                beep(660, 'paddle');
                combo = 0;
                if (stickyCatches > 0) {
                    // Sticky paddle: catch the ball instead of bouncing it
                    stickyCatches--;
                    b.stuck = true;
                    b.stuckFor = 0;
                    b.vx = 0;
                    b.vy = 0;
                    addPopup(paddle.x + paddle.w / 2, paddle.y - 34,
                        isTouchDevice() ? 'Tap to release' : 'Click or Space to release',
                        '#c6ff6a', { life: 1.6, size: 14, rise: 0.2 });
                    haptic(10);
                } else if (multiReady) {
                    // Multi-ball split: the "multi" powerup causes this ball to split on the next paddle bounce
                    multiReady = false;
                    if (balls.length < 4) {
                        const mag = Math.hypot(b.vx, b.vy);
                        const f = 0.7 * mag;
                        balls.push(makeBall(b.x, b.y, b.vx + f, b.vy));
                    }
                }
            } else if (b.y + b.r > CANVAS_H && shield) {
                // Shield: one free miss. The ball bounces off the bottom edge and the shield breaks.
                shield = false;
                b.y = CANVAS_H - b.r;
                b.vy = -Math.abs(b.vy);
                for (let x = 0; x < CANVAS_W; x += 60) spawnParticles(x, CANVAS_H - 2, '#33ddff', 3);
                addPopup(b.x, CANVAS_H - 40, 'Shield saved you!', '#33ddff', { life: 1.2 });
                addShake(6);
                haptic([20, 40, 20], true);
                tone(300, 0.25, { type: 'sawtooth', vol: 0.2, slideTo: 900 });
            } else if (b.y + b.r > CANVAS_H) {
                // Ball fell past the paddle
                balls.splice(i, 1);
                lives--;
                combo = 0;
                powerups.length = 0;
                clearTimedEffects();
                resetAliens(6, 6); // a lost ball clears the invaders and gives a short breather
                addShake(7);
                haptic(70, true);
                if (lives === 0) {
                    gameState = 'lost';
                    playLoseJingle();
                    haptic(250, true);
                    inputLockUntil = performance.now() + 700;
                    showOverlay('Game over — tap or press R to play again.', 'Play again', buildSummary(false));
                } else if (balls.length === 0) {
                    // All balls lost: reset one ball on the paddle
                    balls.push(makeBall(paddle.x + paddle.w / 2, paddle.y - BALL_RADIUS, currentSpeed(), -currentSpeed()));
                    gameState = 'ready';
                    showOverlay(getLaunchMessage(false), 'Launch');
                }
            }
        }
    }

    // 2c. Active powerup timers (slow affects all balls)
    if (slowTimer > 0) {
        for (const b of balls) {
            const target = currentSpeed() * 0.6;
            const mag = Math.hypot(b.vx, b.vy);
            if (mag > 0) {
                const f = target / mag;
                b.vx *= f;
                b.vy *= f;
            }
        }
        slowTimer -= 1 / 60;
    }
    if (wideTimer > 0) {
        wideTimer -= 1 / 60;
        if (wideTimer <= 0) {
            paddle.w = PADDLE_W;
            paddle.x = Math.max(0, Math.min(paddle.x, CANVAS_W - paddle.w));
        }
    }
    if (doubleTimer > 0) {
        doubleTimer -= 1 / 60;
    }
    if (guidedTimer > 0) {
        guidedTimer -= 1 / 60;
    }
    if (fireTimer > 0) {
        fireTimer -= 1 / 60;
        // Flames shed off each moving ball
        for (const b of balls) {
            if (!b.stuck && Math.random() < 0.6) {
                spawnParticles(b.x, b.y, Math.random() < 0.5 ? '#ff9a1f' : '#ffd23f', 1);
            }
        }
    }

    // 2d. Falling powerups
    updatePowerups();

    // 2e. Alien invaders, their bolts, and paddle-hole repair
    updateAliens();

    // 3. Brick collisions for each ball
    for (const b of balls) {
        if (gameState !== 'playing') break; // a level clear / game over mid-loop ends this frame's collisions
        if (b.stuck) continue;
        collisionDetection(b);
        if (gameState === 'playing') alienBallCollision(b);
    }
}

// Floating popups: drift upward and fade out; "pop" popups punch in from a larger scale
function drawPopups() {
    for (let i = popups.length - 1; i >= 0; i--) {
        const p = popups[i];
        p.y -= p.rise;
        p.life -= 0.02;
        if (p.life <= 0) {
            popups.splice(i, 1);
            continue;
        }
        const age = p.maxLife - p.life;
        const scale = p.pop ? 1 + 0.8 * Math.max(0, 1 - age / 0.12) : 1;
        ctx.save();
        ctx.globalAlpha = Math.max(0, Math.min(1, p.life * 2));
        ctx.font = 'bold ' + p.size + 'px sans-serif';
        ctx.textAlign = 'center';
        ctx.lineJoin = 'round';
        ctx.translate(p.x, p.y);
        ctx.scale(scale, scale);
        ctx.strokeStyle = 'rgba(0, 0, 0, 0.6)'; // dark outline keeps text readable (cheaper than a shadow blur)
        ctx.lineWidth = 3;
        ctx.strokeText(p.text, 0, 0);
        ctx.fillStyle = p.color || '#ffffff';
        ctx.fillText(p.text, 0, 0);
        ctx.restore();
    }
}

function render() {
    // Backdrop stays put while the playfield shakes
    drawBackground();

    ctx.save();
    if (shake > 0.3) {
        ctx.translate((Math.random() * 2 - 1) * shake, (Math.random() * 2 - 1) * shake);
        shake *= 0.86;
    } else {
        shake = 0;
    }
    drawBricks();
    drawMovingWalls();
    drawShield();
    drawAliens();
    drawAlienBullets();
    drawBall();
    drawPaddle();
    drawPowerups();
    drawBlasts();
    drawParticles();
    drawPopups();
    ctx.restore();

    drawStatusChips();
    updateHUD();
}

// --- Rendering Loop (always runs; physics only while playing) ---
let paddleVX = 0;
let paddlePrevX = 0;
function gameLoop() {
    // Track paddle velocity per frame (used for the paddle "throw")
    paddleVX = paddle.x - paddlePrevX;
    paddlePrevX = paddle.x;
    // Continuous paddle keyboard control (works before launch too)
    if (gameState === 'ready' || gameState === 'playing') {
        if (keys.left) paddle.x = Math.max(0, paddle.x - 10);
        if (keys.right) paddle.x = Math.min(CANVAS_W - paddle.w, paddle.x + 10);
    }
    // Before launch the ball rides on the paddle
    if (gameState === 'ready') {
        for (const b of balls) {
            b.x = paddle.x + paddle.w / 2;
            b.y = paddle.y - b.r;
            b.trail.length = 0;
        }
    }
    if (gameState === 'playing') {
        update();
    }
    render();
    requestAnimationFrame(gameLoop);
}

// --- Event Handlers ---
const keys = {};
// Displayed pixels -> canvas coordinate space
function canvasX(clientX) {
    const rect = canvas.getBoundingClientRect();
    if (rect.width <= 0) return 0;
    return (clientX - rect.left) * (canvas.width / rect.width);
}

function setPaddleX(x) {
    if (gameState !== 'ready' && gameState !== 'playing') return;
    paddle.x = Math.max(0, Math.min(x, CANVAS_W - paddle.w));
}

function movePaddleTo(clientX) {
    setPaddleX(canvasX(clientX) - paddle.w / 2);
}

// Pointer-based paddle control.
// Mouse: the paddle follows the cursor. Touch/pen: relative drag. The paddle keeps its offset from
// where the finger landed (no jump, and the finger doesn't cover it), and pointer capture keeps the
// drag alive if the finger slides off the canvas.
// Tap detection: a pointerdown that moves >25px becomes a drag and stops
// counting as a tap. Single tap = launch (restart on game over), double tap = pause.
let lastTapAt = 0;
let isTap = false;
let tapStartX = 0;
let tapStartY = 0;
let dragPointerId = null; // the touch/pen pointer currently dragging the paddle
let dragOffset = 0;       // paddle.x minus the finger's canvas x at touch-down

function handlePointerDown(e) {
    if (e.pointerType !== 'mouse') {
        if (dragPointerId !== null) return; // ignore extra fingers
        touchDetected = true;
        dragPointerId = e.pointerId;
        dragOffset = paddle.x - canvasX(e.clientX);
        try {
            canvas.setPointerCapture(e.pointerId);
        } catch (err) {
            // Capture unsupported; the drag still works while the finger stays on the canvas
        }
    } else {
        movePaddleTo(e.clientX);
    }
    isTap = true;
    tapStartX = e.clientX;
    tapStartY = e.clientY;
}

function handlePointerMove(e) {
    if (e.pointerType !== 'mouse') {
        if (e.pointerId !== dragPointerId) return;
        setPaddleX(canvasX(e.clientX) + dragOffset);
    } else {
        movePaddleTo(e.clientX);
    }
    // Increased tolerance to 25px so natural fingertip touch on mobile doesn't cancel tap
    if (isTap && Math.hypot(e.clientX - tapStartX, e.clientY - tapStartY) > 25) {
        isTap = false; // it's a drag now, not a tap
    }
}

function handlePointerCancel(e) {
    if (e.pointerId === dragPointerId) dragPointerId = null;
    isTap = false;
}

function handlePointerUp(e) {
    if (e && e.pointerType !== 'mouse') {
        if (e.pointerId !== dragPointerId) return;
        dragPointerId = null;
    }
    // Sticky paddle: a click, a tap, or lifting the finger after a touch drag fires the held ball
    if (gameState === 'playing' && (isTap || (e && e.pointerType !== 'mouse')) && releaseStuckBalls()) {
        lastTapAt = 0;
        isTap = false;
        return;
    }
    if (isTap && !endScreenLocked()) {
        if (gameState === 'lost') {
            resetGame(getStartingLevel());
            lastTapAt = 0;
        } else if (gameState === 'ready' || gameState === 'won') {
            launchGame();
            lastTapAt = 0;
        } else if (gameState === 'paused') {
            togglePause();
            lastTapAt = 0;
        } else if (gameState === 'playing') {
            // While playing, double tap toggles pause
            const now = performance.now();
            if (now - lastTapAt < 350) {
                togglePause();
                lastTapAt = 0;
            } else {
                lastTapAt = now;
            }
        }
    }
    isTap = false;
}

function togglePause() {
    const pauseBtn = document.getElementById('pause-btn');
    if (gameState === 'playing') {
        gameState = 'paused';
        if (pauseBtn) pauseBtn.textContent = '▶ Resume';
        showOverlay('Paused — tap or press P to resume.', 'Resume');
    } else if (gameState === 'paused') {
        gameState = 'playing';
        if (pauseBtn) pauseBtn.textContent = '⏸ Pause';
        hideOverlay();
    }
}

function handleKeyDown(e) {
    if (e.key === 'r' || e.key === 'R') {
        // Restart from ready, won, or lost
        if ((gameState === 'ready' || gameState === 'won' || gameState === 'lost') && !endScreenLocked()) {
            resetGame(getStartingLevel());
        }
        return;
    }
    if (e.key === 'p' || e.key === 'P') {
        // Pause / resume
        togglePause();
        return;
    }
    if (e.key === 'm' || e.key === 'M') {
        // Toggle sound / mute
        toggleMute();
        return;
    }
    if (e.key === 'f' || e.key === 'F') {
        // Toggle fullscreen & landscape orientation
        toggleFullscreen();
        return;
    }
    if (e.key === ' ' || e.key === 'Spacebar') {
        // Launch (or continue to next level)
        if ((gameState === 'ready' || gameState === 'won') && !endScreenLocked()) {
            launchGame();
        } else if (gameState === 'playing') {
            releaseStuckBalls();
        }
        return;
    }
    // Paddle movement (arrows): track held keys; applied each frame in gameLoop
    if (e.key === 'ArrowLeft') {
        keys.left = true;
    } else if (e.key === 'ArrowRight') {
        keys.right = true;
    }
}

function handleKeyUp(e) {
    if (e.key === 'ArrowLeft') {
        keys.left = false;
    } else if (e.key === 'ArrowRight') {
        keys.right = false;
    }
}


// --- Main Execution ---
document.addEventListener('DOMContentLoaded', () => {
    initGame();
    
    // Attach event listeners
    canvas.addEventListener('pointerdown', handlePointerDown);
    canvas.addEventListener('pointermove', handlePointerMove);
    // Browsers start audio suspended until a gesture; unlock it on the first tap/click/key
    window.addEventListener('pointerdown', ensureAudio);
    window.addEventListener('keydown', ensureAudio);
    window.addEventListener('pointerup', handlePointerUp);
    window.addEventListener('pointercancel', handlePointerCancel);
    document.addEventListener('keydown', handleKeyDown);
    document.addEventListener('keyup', handleKeyUp);

    const overlay = document.getElementById('overlay');
    if (overlay) {
        overlay.addEventListener('click', handleOverlayAction);
    }
    const overlayBtn = document.getElementById('overlay-button');
    if (overlayBtn) {
        overlayBtn.addEventListener('click', (e) => {
            e.stopPropagation();
            handleOverlayAction();
        });
    }

    const muteBtn = document.getElementById('mute-btn');
    if (muteBtn) {
        muteBtn.addEventListener('click', toggleMute);
    }

    const pauseBtn = document.getElementById('pause-btn');
    if (pauseBtn) {
        pauseBtn.addEventListener('click', togglePause);
    }

    const fsBtn = document.getElementById('fullscreen-btn');
    if (fsBtn) {
        fsBtn.addEventListener('click', toggleFullscreen);
    }

    document.addEventListener('fullscreenchange', () => {
        updateFullscreenBtn();
        if (document.fullscreenElement) {
            lockLandscape();
        } else {
            unlockOrientation();
        }
    });
    document.addEventListener('webkitfullscreenchange', () => {
        updateFullscreenBtn();
        if (document.webkitFullscreenElement) {
            lockLandscape();
        } else {
            unlockOrientation();
        }
    });

    window.addEventListener('touchstart', () => {
        touchDetected = true;
        const msg = document.getElementById('overlay-message');
        if (gameState === 'ready' && msg && msg.textContent.includes('SPACE')) {
            msg.textContent = getLaunchMessage(false);
        }
    }, { once: true, passive: true });
    
    // Start the always-running render loop
    requestAnimationFrame(gameLoop);
});