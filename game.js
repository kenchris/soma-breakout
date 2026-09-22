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
let runStats = { maxCombo: 0, bricks: 0, aliens: 0, bosses: 0, warps: 0 };
let bricksLeft = 0;
let levelBricksTotal = 0;
let inputLockUntil = 0; // ignore restart/continue input briefly after an end screen appears
const COMBO_MAX = 5;
const reduceMotion = !!(window.matchMedia && window.matchMedia('(prefers-reduced-motion: reduce)').matches);
// Add ?perf to the URL for an on-screen frame-rate / frame-time readout (for finding slowdowns on a device)
const PERF = /[?&]perf(=|&|$)/.test(window.location.search);
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
        const name = plan.boss ? 'Boss fight' : plan.tetris ? 'Ghost rows' : currentLayout().name;
        return 'Level ' + level + ' · ' + name + '\n' + (isTouch ? 'Tap to continue' : 'Press SPACE to continue');
    }
    return 'Ready?\n' + (isTouch ? 'Tap or press SPACE to launch' : 'Press SPACE to launch');
}

// The first line of the message is the headline; any further lines are a smaller hint under it
function setOverlayMessage(text) {
    const msg = document.getElementById('overlay-message');
    if (!msg) return;
    const [title, ...rest] = String(text).split('\n');
    msg.textContent = '';
    const t = document.createElement('span');
    t.className = 'ov-title';
    t.textContent = title;
    msg.appendChild(t);
    if (rest.length) {
        const h = document.createElement('span');
        h.className = 'ov-hint';
        h.textContent = rest.join(' ');
        msg.appendChild(h);
    }
}

// summary (optional): { newBest, rows: [[label, value], ...] } rendered as stat tiles
function showOverlay(message, buttonText = 'Launch', summary = null) {
    const overlay = document.getElementById('overlay');
    const msg = document.getElementById('overlay-message');
    const btn = document.getElementById('overlay-button');
    setOverlayMessage(message);
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
    // Balanced rows instead of an orphan tile: up to 5 in one row, otherwise split evenly (6 -> 3+3, 7 -> 4+3)
    const n = summary.rows.length;
    list.style.gridTemplateColumns = 'repeat(' + (n <= 5 ? n : Math.ceil(n / 2)) + ', 1fr)';
    list.style.display = 'grid';
}

function buildSummary(levelCleared) {
    // Short labels so the tiles stay small on a phone; aliens and bosses only appear once you have some
    const rows = [
        ['Score', score],
        ['Best', bestScore],
        [levelCleared ? 'Cleared' : 'Level', levelCleared ? level - 1 : level],
        ['Combo', runStats.maxCombo],
        ['Bricks', runStats.bricks]
    ];
    if (runStats.aliens > 0) rows.push(['Aliens', runStats.aliens]);
    if (runStats.bosses > 0) rows.push(['Bosses', runStats.bosses]);
    if (runStats.warps > 0) rows.push(['Warps', runStats.warps]);
    return { newBest: score > 0 && score > bestAtStart, rows };
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
    showLevelIntro();

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
    runStats = { maxCombo: 0, bricks: 0, aliens: 0, bosses: 0, warps: 0 };
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
    shield = 0;
    shake = 0;
    combo = 0;
    popups.length = 0;
    blasts.length = 0;
    warpRift = null;
    warpTimer = warpInterval() + 60 * 20; // a fresh run gets ~20s of grace before the first rift can appear

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
// Stored on the brick as polylines in brick-local coordinates and baked into a sprite by bakeCrack().
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

// --- What appears when ---
// Mechanics are introduced gradually, and once unlocked they show up on some levels rather than every
// one. What a level contains is decided per level from a seeded PRNG (so a level always plays the same,
// and ?level=N works); *when* things happen inside a level (alien arrivals, weird events) is random at
// runtime. Tune the whole curve here.
const UNLOCK = { tnt: 2, walls: 3, aliens: 3, chaos: 4, reverse: 6, fullFlip: 8, boss: 5, tetris: 7 };
// First level each powerup can drop on (anything not listed is there from level 1)
const POWERUP_UNLOCK = { multi: 2, explosive: 2, double: 2, sticky: 3, shield: 3, fire: 4, guided: 6 };
// Short "what's new" hints, shown when the level starts
const LEVEL_INTROS = {
    2: ['NEW: TNT bricks chain-explode', 'NEW drops: Multi-ball, Explosive, 2× Score'],
    3: ['NEW: sliding walls', 'NEW: aliens shoot holes in your paddle: shoot them down!', 'NEW drops: Sticky, Shield'],
    4: ['NEW: weird events: the world may flip or change speed', 'NEW drop: Fire ball'],
    5: ['BOSS FIGHT', 'Hit the amber \u00d73 hatch on its belly for triple damage', 'Gold crates hold powerups (new ones keep appearing): break them, or catch what the boss shoots loose', 'Hit it again within 5 seconds to chain: \u00d72, then \u00d73 damage'],
    6: ['NEW: your controls may reverse', 'NEW drop: Guided ball'],
    8: ['NEW: the whole screen may flip']
};
let plan = { boss: false, tetris: false, tnt: 0, walls: 0, aliens: null, chaos: null };
let introPending = false;

function isBossLevel(l = level) {
    return l % UNLOCK.boss === 0;
}

// Ghost rows: introduced on level 7, then on about 3 levels in 10, never two in a row and never on a boss level.
// (Its own random stream, so it doesn't change what the other features do on any level.)
const ghostLevelCache = {};
function isGhostLevel(l) {
    if (l < UNLOCK.tetris || isBossLevel(l)) return false;
    if (ghostLevelCache[l] === undefined) {
        ghostLevelCache[l] = l === UNLOCK.tetris || (seededRandom(l * 7368787 + 3)() < 0.3 && !isGhostLevel(l - 1));
    }
    return ghostLevelCache[l];
}

function planLevel(l) {
    const rand = seededRandom(l * 15485863 + 7);
    const p = { boss: isBossLevel(l), tetris: false, tnt: 0, walls: 0, aliens: null, chaos: null };
    if (p.boss) return p; // a boss arena has no bricks, walls or random visitors: the boss brings its own

    if (l >= UNLOCK.tnt) {
        // Introduced with a couple; after that 0 to a few (never many on early levels)
        p.tnt = l === UNLOCK.tnt ? 2 : (rand() < 0.2 ? 0 : 1 + Math.floor(rand() * Math.min(1 + Math.floor(l / 2), 5)));
    }
    if (l >= UNLOCK.walls) {
        p.walls = (l === UNLOCK.walls || rand() < 0.65) ? 1 : 0;
        if (p.walls && l >= 8 && rand() < 0.5) p.walls = 2;
    }
    if (l >= UNLOCK.aliens && (l === UNLOCK.aliens || rand() < Math.min(0.7, 0.4 + 0.04 * (l - UNLOCK.aliens)))) {
        p.aliens = { max: alienMax(l), grace: 10 };
    }
    if (l >= UNLOCK.chaos && (l === UNLOCK.chaos || rand() < Math.min(0.55, 0.3 + 0.04 * (l - UNLOCK.chaos)))) {
        p.chaos = { events: 1 + (l >= 9 && rand() < 0.5 ? 1 : 0) };
    }
    // Ghost rows replace the bricks, so no TNT or sliding walls on those levels
    if (isGhostLevel(l)) {
        p.tetris = true;
        p.tnt = 0;
        p.walls = 0;
    }
    return p;
}

function showLevelIntro() {
    if (!introPending) return;
    introPending = false;
    let lines = LEVEL_INTROS[level];
    if (plan.tetris) {
        lines = ghostIntroSeen
            ? ['GHOST ROWS', 'Fill whole rows to clear them']
            : ['GHOST ROWS', 'Fly the ball THROUGH the ghost bricks to make them solid', 'Fill a whole row and it clears, like Tetris'];
        ghostIntroSeen = true;
    }
    if (!lines) return;
    lines.forEach((text, i) => {
        addPopup(CANVAS_W / 2, CANVAS_H * 0.42 + i * 30, text, i === 0 ? '#ffe58a' : '#d8e2ff',
            { size: i === 0 ? 22 : 17, life: 3, rise: 0.15, pop: i === 0 });
    });
}

// Clearing a level (bricks gone, or the boss beaten): on to the next one with a fresh ball
function completeLevel() {
    level++;
    gameState = 'won';
    powerups.length = 0;
    clearTimedEffects();
    combo = 0;
    spawnLevel();
    playWinJingle();
    addShake(6);
    haptic([30, 60, 30, 60, 80], true);
    const sp = currentSpeed();
    balls = [makeBall(paddle.x + paddle.w / 2, paddle.y - BALL_RADIUS, sp, -sp)];
    inputLockUntil = performance.now() + 700;
    showOverlay(getLaunchMessage(true), 'Continue', buildSummary(true));
}

// --- Weird events ---
// Now and then the game does something odd for ~10 seconds, with a 2 second warning first:
//   UPSIDE DOWN (view flips vertically), REVERSED CONTROLS (drag right, paddle goes left),
//   FULL FLIP (view rotates 180 degrees; controls follow what you see) and TIME WARP (turbo or slow-mo).
// Each unlocks at its own level, and a level either has them or not (see planLevel).
const CHAOS = {
    timeWarp: { name: 'TIME WARP', seconds: 9, unlock: UNLOCK.chaos },
    upsideDown: { name: 'UPSIDE DOWN', seconds: 10, unlock: UNLOCK.chaos, visual: true },
    reverse: { name: 'REVERSED CONTROLS', seconds: 8, unlock: UNLOCK.reverse },
    fullFlip: { name: 'FULL FLIP', seconds: 10, unlock: UNLOCK.fullFlip, visual: true }
};
const CHAOS_WARN_FRAMES = 120;
const TIME_WARP = { turbo: 1.6, slow: 0.5 };
let chaos = { type: null, pending: null, warn: 0, left: 0, total: 0, scale: 1 };
let chaosTimer = Infinity;   // frames until the next event's warning
let chaosEventsLeft = 0;     // events still to come on this level
let timeScale = 1;           // game speed multiplier (Time Warp)
let reverseFrames = 0;       // controls reversed by the boss's mind-flip beam (separate from the timed events)
let reverseTotal = 1;

function controlsReversed() {
    return chaos.type === 'reverse' || reverseFrames > 0;
}
function viewMirrored() {
    return chaos.type === 'fullFlip';
}
// Left/right in what you touch vs canvas coordinates: swapped when the view is mirrored (so touch follows
// the screen) and swapped again when controls are reversed
function mapMirror() {
    return viewMirrored() !== controlsReversed();
}

function chaosPool() {
    return Object.keys(CHAOS).filter(k => level >= CHAOS[k].unlock && !(reduceMotion && CHAOS[k].visual));
}

function scheduleChaos(minSeconds, spreadSeconds) {
    chaosTimer = Math.round(60 * (minSeconds + Math.random() * spreadSeconds));
}

function applyView() {
    if (!canvas) return;
    canvas.style.transform = chaos.type === 'upsideDown' ? 'scaleY(-1)' : chaos.type === 'fullFlip' ? 'rotate(180deg)' : '';
}

// A drag in progress must not jump when the mapping flips underneath it
function refreshInputMapping() {
    if (dragPointerId === null || lastDragClientX === null) return;
    if (touchMode === 'follow') followTarget = followPaddleTarget(lastDragClientX);
    else dragOffset = paddle.x - canvasX(lastDragClientX);
}

const bannerCache = { text: null, pct: -1, kind: null };
// `low` puts the banner at the bottom: when the view is flipped vertically the paddle is at the top of the screen
function setBanner(text, fraction = 0, kind = 'active', low = false) {
    const el = document.getElementById('event-banner');
    if (!el) return;
    if (text === null) {
        if (bannerCache.text !== null) {
            el.style.display = 'none';
            bannerCache.text = null;
        }
        return;
    }
    const pct = Math.round(fraction * 100);
    const cls = kind + (low ? ' low' : '');
    if (bannerCache.text !== text || bannerCache.kind !== cls) {
        el.lastElementChild.textContent = text;
        el.className = cls;
        el.style.display = 'block';
        bannerCache.text = text;
        bannerCache.kind = cls;
        bannerCache.pct = -1;
    }
    if (bannerCache.pct !== pct) {
        el.firstElementChild.style.width = pct + '%';
        bannerCache.pct = pct;
    }
}

function chaosLabel(key) {
    if (key === 'timeWarp') return chaos.scale > 1 ? '\u23e9 TURBO \u00d7' + chaos.scale : '\ud83d\udc22 SLOW-MO \u00d7' + chaos.scale;
    return CHAOS[key].name;
}

function updateBanner() {
    if (chaos.warn > 0) {
        setBanner('\u26a0 ' + chaosLabel(chaos.pending) + ' in ' + Math.ceil(chaos.warn / 60) + '\u2026', chaos.warn / CHAOS_WARN_FRAMES, 'warn');
    } else if (chaos.type) {
        const flippedVertically = chaos.type === 'upsideDown' || chaos.type === 'fullFlip';
        setBanner(chaosLabel(chaos.type) + '  ' + Math.ceil(chaos.left / 60) + 's', chaos.left / chaos.total, 'active', flippedVertically);
    } else if (reverseFrames > 0) {
        setBanner('MIND FLIP: CONTROLS REVERSED ' + Math.ceil(reverseFrames / 60) + 's', reverseFrames / reverseTotal, 'active');
    } else {
        setBanner(null);
    }
}

function endChaos(reschedule) {
    chaos.type = null;
    chaos.pending = null;
    chaos.warn = 0;
    chaos.left = 0;
    timeScale = 1;
    reverseFrames = 0;
    applyView();
    refreshInputMapping();
    setBanner(null);
    if (reschedule && chaosEventsLeft > 0) scheduleChaos(20, 20);
}

function initChaos() {
    endChaos(false);
    chaosEventsLeft = plan.chaos ? plan.chaos.events : 0;
    if (plan.chaos) scheduleChaos(22, 18); // the first one arrives 22-40 seconds in
    else chaosTimer = Infinity;
}

function startChaosWarning() {
    const pool = chaosPool();
    if (!pool.length) {
        chaosEventsLeft = 0;
        return;
    }
    chaos.pending = pool[Math.floor(Math.random() * pool.length)];
    if (chaos.pending === 'timeWarp') chaos.scale = Math.random() < 0.5 ? TIME_WARP.turbo : TIME_WARP.slow;
    chaos.warn = CHAOS_WARN_FRAMES;
    tone(330, 0.15, { type: 'sawtooth', vol: 0.18, key: 'chaos' });
    tone(440, 0.15, { type: 'sawtooth', vol: 0.18, delay: 0.17, force: true });
    tone(330, 0.15, { type: 'sawtooth', vol: 0.18, delay: 0.34, force: true });
    haptic([30, 50, 30], true);
}

function startChaos(key) {
    chaos.type = key;
    chaos.pending = null;
    chaos.warn = 0;
    chaos.total = chaos.left = CHAOS[key].seconds * 60;
    chaosEventsLeft--;
    if (key === 'timeWarp') timeScale = chaos.scale;
    applyView();
    refreshInputMapping();
    addShake(6);
    haptic([40, 40, 80], true);
    tone(200, 0.4, { type: 'sawtooth', vol: 0.25, slideTo: 800, key: 'chaosStart', force: true });
}

function updateChaos() {
    if (reverseFrames > 0 && --reverseFrames === 0) refreshInputMapping();
    if (chaos.warn > 0) {
        if (--chaos.warn === 0) startChaos(chaos.pending);
    } else if (chaos.type) {
        if (--chaos.left <= 0) endChaos(true);
    } else if (chaosEventsLeft > 0 && --chaosTimer <= 0) {
        startChaosWarning();
    }
    updateBanner();
}

// --- Boss fights (every 5th level) ---
// A mothership with a health bar and a weak point (the amber x3 hatch on its belly, worth triple damage). Three phases as its health drops: aimed fans of bolts; then bolt rain and
// summoned aliens; then a "mind flip" beam that reverses your controls. Bolts punch holes in the paddle
// like any alien's. Beating it clears the level, awards points and an extra life.
let boss = null;
const BOSS_HOLE_SECONDS = 5; // holes from a boss's bolts close faster than an alien's
const BEAM_HALF = 26;        // half-width of the mind-flip beam
const BOSS_CHAIN_FRAMES = 300; // hit the boss again within 5 seconds to keep a damage chain going

// Damage multiplier for the n-th boss hit in a chain: x1, then x2 from the 2nd hit, x3 from the 4th
function bossChainMult(n) {
    return n >= 4 ? 3 : n >= 2 ? 2 : 1;
}

function bossPhase() {
    const ratio = boss.hp / boss.maxHp;
    return ratio > 0.66 ? 1 : ratio > 0.33 ? 2 : 3;
}

function spawnBoss() {
    const n = Math.floor(level / UNLOCK.boss);
    const hp = 6 + 8 * n; // 14, 22, 30, 38 ... (a chain multiplies damage, so later bosses need to grow faster)
    boss = {
        n, hp, maxHp: hp, x: CANVAS_W / 2, y: -70, homeY: 130, t: 0, mt: 0, intro: 100,
        atk: null, atkIn: 150, lastAtk: null, minionIn: 60 * 12, flash: 0, cool: 0,
        dying: 0, beamFx: 0, beamX: 0, lastPhase: 1, chain: 0, chainT: 0
    };
    spawnCrates();
}

// Hull and dome as two rectangles (x0, y0, x1, y1)
function bossRects() {
    const B = boss;
    return [[B.x - 108, B.y - 17, B.x + 108, B.y + 43], [B.x - 46, B.y - 43, B.x + 46, B.y - 17]];
}

// The weak point: a fixed hatch on the belly. A ball touching the hull from below is ~21px under its centre.
function bossCore() {
    return { x: boss.x, y: boss.y + 30 };
}

function inBossHatch(x, y) {
    const core = bossCore();
    return Math.hypot(x - core.x, y - core.y) < 34;
}

function bossInterval() {
    // Frames between attacks: 260 / 240 / 220 (phases 1-3) for the first boss, noticeably faster for later ones
    return Math.max(110, 280 - 20 * boss.n - (bossPhase() - 1) * 20);
}

function bossBoltSpeed() {
    return Math.min(3 + 0.2 * boss.n + 0.3 * bossPhase(), 6);
}

function fireBossFan() {
    const B = boss;
    const count = bossPhase() >= 2 ? 4 : 3;
    const speed = bossBoltSpeed();
    const y0 = B.y + 40;
    const base = Math.atan2(paddle.x + paddle.w / 2 - B.x, paddle.y - y0);
    for (let i = 0; i < count; i++) {
        const a = base + (i - (count - 1) / 2) * 0.28;
        alienBullets.push({ x: B.x, y: y0, vx: Math.sin(a) * speed, vy: Math.cos(a) * speed, hole: BOSS_HOLE_SECONDS });
    }
    tone(900, 0.14, { type: 'square', vol: 0.15, slideTo: 300, key: 'laser' });
}

function startBossAttack() {
    const B = boss;
    const phase = bossPhase();
    const pool = ['fan'];
    if (phase >= 2) pool.push('rain', 'fan');
    if (phase >= 3) pool.push('beam', 'rain');
    let kind = pool[Math.floor(Math.random() * pool.length)];
    if (kind === B.lastAtk) kind = pool[Math.floor(Math.random() * pool.length)]; // avoid the same attack twice in a row
    const atk = { kind, t: 0, dur: kind === 'fan' ? 40 : kind === 'rain' ? 46 : 90 };
    if (kind === 'rain') {
        atk.cols = [];
        const count = Math.min(3 + B.n, 7);
        for (let tries = 0; atk.cols.length < count && tries < 60; tries++) {
            const x = 30 + Math.random() * (CANVAS_W - 60);
            if (atk.cols.every(c => Math.abs(c - x) > 60)) atk.cols.push(x);
        }
    }
    if (kind === 'beam') atk.x = paddle.x + paddle.w / 2;
    B.atk = atk;
    tone(220, 0.25, { type: 'triangle', vol: 0.2, slideTo: 330, key: 'bossWarn' });
}

function endBossAttack() {
    const B = boss;
    B.lastAtk = B.atk.kind;
    B.atk = null;
    B.atkIn = Math.round(bossInterval() * (0.8 + Math.random() * 0.4));
}

function updateBossAttacks() {
    const B = boss;
    if (!B.atk) {
        if (--B.atkIn <= 0) startBossAttack();
    } else {
        const a = B.atk;
        a.t++;
        if (a.kind === 'fan') {
            if (a.t === a.dur) {
                fireBossFan();
                endBossAttack();
            }
        } else if (a.kind === 'rain') {
            if (a.t === a.dur) {
                const speed = Math.min(3.6 + 0.25 * B.n, 6);
                for (const x of a.cols) alienBullets.push({ x, y: 70, vx: 0, vy: speed, hole: BOSS_HOLE_SECONDS });
                tone(700, 0.2, { type: 'square', vol: 0.14, slideTo: 250, key: 'laser' });
                endBossAttack();
            }
        } else if (a.kind === 'beam') {
            if (a.t < a.dur - 30) a.x = paddle.x + paddle.w / 2; // tracks you, then locks on (30 frames to get out of the way)
            if (a.t === a.dur) {
                B.beamFx = 18;
                B.beamX = a.x;
                addShake(7);
                tone(150, 0.4, { type: 'sawtooth', vol: 0.3, slideTo: 60, key: 'beam', force: true });
                if (paddle.x < a.x + BEAM_HALF && paddle.x + paddle.w > a.x - BEAM_HALF) {
                    reverseFrames = reverseTotal = 180;
                    refreshInputMapping();
                    addPopup(paddle.x + paddle.w / 2, paddle.y - 40, 'MIND FLIP!', '#ff4dd8', { size: 24, life: 1.4, pop: true });
                    haptic([40, 30, 40, 30, 80], true);
                }
            }
            if (a.t >= a.dur + 18) endBossAttack();
        }
    }
    if (B.phase >= 2 || bossPhase() >= 2) {
        if (--B.minionIn <= 0) {
            if (aliens.length < 1) spawnAlien();
            B.minionIn = 60 * 18;
        }
    }
}

function updateBoss() {
    const B = boss;
    if (!B) return;
    B.t++;
    if (B.dying > 0) {
        updateBossDeath();
        return;
    }
    if (B.intro > 0) {
        if (B.t === 1) {
            addPopup(CANVAS_W / 2, 215, 'BOSS INCOMING!', '#ff4d6a', { size: 30, life: 1.8, rise: 0.3, pop: true });
            tone(300, 0.5, { type: 'sawtooth', vol: 0.25, slideTo: 200, key: 'siren', force: true });
            haptic([60, 40, 60], true);
            shield = Math.min(shield + 1, SHIELD_MAX); // a free miss to start the fight, on top of any already banked
            addPopup(CANVAS_W / 2, 380, 'Free shield!', '#33ddff', { size: 18, life: 1.8, rise: 0.2 });
        }
        B.intro--;
        const k = 1 - B.intro / 100;
        B.y = -70 + (B.homeY + 70) * (1 - (1 - k) * (1 - k)); // ease out
        return;
    }
    const phase = bossPhase();
    const rate = 0.011 + 0.0015 * B.n + 0.002 * (phase - 1);
    B.mt += timeScale; // boss motion follows Time Warp; its attack timers do not
    B.x = CANVAS_W / 2 + Math.sin(B.mt * rate) * (CANVAS_W / 2 - 108 - 14);
    B.y = B.homeY + Math.sin(B.mt / 40) * 8;
    if (B.flash > 0) B.flash--;
    if (B.cool > 0) B.cool--;
    if (B.beamFx > 0) B.beamFx--;
    if (B.chainT > 0 && --B.chainT === 0) B.chain = 0; // the chain ran out
    updateBossAttacks();
}

function checkBossPhase() {
    const B = boss;
    const p = bossPhase();
    if (p === B.lastPhase) return;
    B.lastPhase = p;
    B.atk = null;
    B.atkIn = 110;
    alienBullets.length = 0; // a breather between phases
    addPopup(CANVAS_W / 2, 215, p === 3 ? 'ENRAGED!' : 'PHASE ' + p, '#ff8a2a', { size: 30, life: 1.6, rise: 0.3, pop: true });
    addShake(9);
    haptic([50, 30, 50], true);
    tone(180, 0.5, { type: 'sawtooth', vol: 0.28, slideTo: 90, key: 'phase', force: true });
}

function bossBallCollision(b) {
    const B = boss;
    if (!B || B.intro > 0 || B.dying > 0 || B.cool > 0) return;
    for (const [x0, y0, x1, y1] of bossRects()) {
        const cx = Math.max(x0, Math.min(b.x, x1));
        const cy = Math.max(y0, Math.min(b.y, y1));
        const dx = b.x - cx;
        const dy = b.y - cy;
        if (dx * dx + dy * dy >= b.r * b.r) continue;

        B.cool = 8; // one contact = one hit
        B.flash = 6;
        const crit = inBossHatch(b.x, b.y);
        const prevMult = B.chainT > 0 ? bossChainMult(B.chain) : 1;
        B.chain = B.chainT > 0 ? B.chain + 1 : 1; // hitting again in time extends the chain
        B.chainT = BOSS_CHAIN_FRAMES;
        const chainMult = bossChainMult(B.chain);
        let dmg = (fireTimer > 0 ? 3 : 1) * (crit ? 3 : 1) * chainMult;
        if (explosiveReady) {
            explosiveReady = false;
            dmg += 5;
            addBlast(b.x, b.y);
            boom();
            addShake(10);
        }
        B.hp -= dmg;
        addScore(15 * dmg * (doubleTimer > 0 ? 2 : 1));
        addPopup(b.x, b.y - 12, (crit ? 'CRITICAL! -' : '-') + dmg + (chainMult > 1 ? '  \u00d7' + chainMult : ''), crit ? '#FFD700' : '#ffffff',
            { size: crit ? 22 : 16, pop: crit, life: 0.9 });
        if (chainMult > prevMult) { // the chain just stepped up
            addPopup(B.x, B.y - 62, 'CHAIN \u00d7' + chainMult + '!', '#ffb300', { size: 24, life: 1.1, rise: 0.5, pop: true });
            tone(660 + 220 * chainMult, 0.12, { type: 'triangle', vol: 0.25, key: 'chain' });
            addShake(4);
            haptic([15, 20, 25], true);
        }
        spawnParticles(b.x, b.y, crit ? '#ffd23f' : '#c9a0ff', crit ? 14 : 6);
        if (crit) {
            tone(880, 0.1, { type: 'triangle', vol: 0.25, key: 'crit' });
            tone(1320, 0.14, { type: 'triangle', vol: 0.25, delay: 0.06, force: true });
        } else {
            clink();
        }
        addShake(crit ? 6 : 3);
        haptic(crit ? [20, 20, 40] : 20, crit);
        if (fireTimer <= 0) { // a fire ball goes straight through; anything else bounces off
            if (Math.abs(dx) > Math.abs(dy)) {
                const dir = dx >= 0 ? 1 : -1;
                b.vx = dir * Math.abs(b.vx);
                b.x = dir > 0 ? x1 + b.r : x0 - b.r;
            } else {
                const dir = dy >= 0 ? 1 : -1;
                b.vy = dir * Math.abs(b.vy);
                b.y = dir > 0 ? y1 + b.r : y0 - b.r;
            }
        }
        if (B.hp <= 0) killBoss();
        else checkBossPhase();
        return;
    }
}

// A lost ball gives the boss a breather too (it never heals)
function bossBreather() {
    if (boss && boss.dying <= 0) {
        boss.atk = null;
        boss.atkIn = 150;
        boss.beamFx = 0;
        boss.chain = 0;
        boss.chainT = 0;
    }
}

function killBoss() {
    const B = boss;
    B.dying = 150;
    B.atk = null;
    B.beamFx = 0;
    alienBullets.length = 0;
    for (const a of aliens) { // its summoned aliens go down with the ship
        spawnParticles(a.x, a.y, ALIEN_COLOR, 14);
        addBlast(a.x, a.y);
    }
    aliens.length = 0;
    addShake(12);
    haptic([60, 40, 60, 40, 120], true);
    tone(400, 0.6, { type: 'sawtooth', vol: 0.3, slideTo: 40, key: 'bossDie', force: true });
    addPopup(CANVAS_W / 2, 250, 'MOTHERSHIP DESTROYED!', '#ffd23f', { size: 28, life: 2.2, rise: 0.2, pop: true });
}

function updateBossDeath() {
    const B = boss;
    B.dying--;
    if (B.dying % 6 === 0) {
        const ex = B.x + (Math.random() - 0.5) * 190;
        const ey = B.y + (Math.random() - 0.5) * 70;
        addBlast(ex, ey);
        spawnParticles(ex, ey, Math.random() < 0.5 ? '#ff9a1f' : '#ffffff', 10);
        addShake(5);
        haptic(15);
        beep(200 + Math.random() * 300, 'bossBoom');
    }
    if (B.dying <= 0) finishBoss();
}

function finishBoss() {
    const points = 1500 * boss.n * (doubleTimer > 0 ? 2 : 1);
    addScore(points);
    runStats.bosses++;
    lives = Math.min(lives + 1, 5);
    boss = null;
    addPopup(CANVAS_W / 2, 210, 'BOSS DEFEATED! +' + points, '#ffd23f', { size: 26, life: 2.4, rise: 0.2, pop: true });
    addPopup(CANVAS_W / 2, 245, '+1 LIFE', '#33cc33', { size: 20, life: 2.4, rise: 0.2 });
    completeLevel();
}

// --- Boss supply crates ---
// A few gold crates hang in the arena during a boss fight, each holding a guaranteed powerup (its icon is on
// the face, so you can choose). The ball breaks them, and so does any bolt that crosses one (the boss's or a
// summoned alien's): either way the powerup drops for you to catch. Every fight has at least one damage
// powerup (fire / explosive / guided) and one defensive one (wide / shield / sticky).
let crates = [];
const CRATE_COUNT = 4;
let crateTimer = 0; // frames until the next replacement crate (0 = none pending); one comes back 10-18s after a break

function dropPowerup(type, x, y) {
    const t = POWERUP_TYPES.find(p => p.type === type);
    powerups.push({ x: x, y: y, type: t.type, label: t.label, color: t.color, vy: 2.5 });
}

function spawnCrates() {
    const pool = POWERUP_TYPES.filter(p => level >= (POWERUP_UNLOCK[p.type] || 1));
    const pickFrom = names => {
        const list = pool.filter(p => names.includes(p.type));
        return list[Math.floor(Math.random() * list.length)];
    };
    const chosen = [pickFrom(['fire', 'explosive', 'guided']), pickFrom(['wide', 'shield', 'sticky'])];
    while (chosen.length < CRATE_COUNT) {
        const p = pool[Math.floor(Math.random() * pool.length)];
        if (!chosen.includes(p)) chosen.push(p);
    }
    // Shuffle so the damage/defence crates aren't always in the same places
    for (let i = chosen.length - 1; i > 0; i--) {
        const j = Math.floor(Math.random() * (i + 1));
        [chosen[i], chosen[j]] = [chosen[j], chosen[i]];
    }
    const slot = (CANVAS_W - 2 * 60) / CRATE_COUNT;
    crates = chosen.map((def, i) => ({
        x: 60 + slot * i + Math.random() * (slot - BRICK_W),
        y: 255 + Math.random() * 70,
        w: BRICK_W,
        h: BRICK_H,
        alive: true,
        type: def.type,
        label: def.label,
        color: def.color,
        age: 999 // (replacement crates pop in; the first ones are just there)
    }));
    crateTimer = 0;
}

// A spot for a replacement crate: random, clear of other crates and of the balls
function freeCrateSpot() {
    for (let attempt = 0; attempt < 30; attempt++) {
        const x = 40 + Math.random() * (CANVAS_W - 80 - BRICK_W);
        const y = 250 + Math.random() * 80;
        const clear = crates.every(c => !c.alive || Math.abs(c.x - x) > BRICK_W + 12 || Math.abs(c.y - y) > BRICK_H + 12) &&
            balls.every(b => Math.hypot(b.x - (x + BRICK_W / 2), b.y - (y + BRICK_H / 2)) > 50);
        if (clear) return { x, y };
    }
    return null;
}

function respawnCrate() {
    const spot = freeCrateSpot();
    if (!spot) return false;
    const taken = crates.filter(c => c.alive).map(c => c.type);
    const options = POWERUP_TYPES.filter(p => level >= (POWERUP_UNLOCK[p.type] || 1) && !taken.includes(p.type));
    let roll = Math.random() * options.reduce((sum, p) => sum + p.weight, 0);
    let def = options[options.length - 1];
    for (const p of options) {
        roll -= p.weight;
        if (roll < 0) {
            def = p;
            break;
        }
    }
    crates = crates.filter(c => c.alive); // drop the broken ones from the list
    crates.push({ x: spot.x, y: spot.y, w: BRICK_W, h: BRICK_H, alive: true, type: def.type, label: def.label, color: def.color, age: 0 });
    const cx = spot.x + BRICK_W / 2;
    const cy = spot.y + BRICK_H / 2;
    spawnParticles(cx, cy, '#ffd23f', 10);
    addPopup(cx, cy - 14, 'NEW CRATE', '#ffe58a', { size: 14, life: 1 });
    tone(520, 0.12, { type: 'triangle', vol: 0.18, key: 'crateSpawn' });
    tone(780, 0.14, { type: 'triangle', vol: 0.18, delay: 0.08, force: true });
    return true;
}

function updateCrates() {
    if (!boss || boss.intro > 0 || boss.dying > 0) return;
    for (const c of crates) if (c.age !== undefined) c.age++; // drives the pop-in of new crates
    if (crateTimer > 0 && --crateTimer === 0) {
        if (crates.filter(c => c.alive).length < CRATE_COUNT) {
            const ok = respawnCrate();
            const stillMissing = crates.filter(c => c.alive).length < CRATE_COUNT;
            crateTimer = !ok ? 90 : (stillMissing ? Math.round(60 * (10 + Math.random() * 8)) : 0); // no room: retry in 1.5s
        }
    }
}

const crateSprites = {};
function crateSprite(cr) {
    if (!crateSprites[cr.type]) {
        crateSprites[cr.type] = makeSprite(BRICK_W, BRICK_H, g => {
            g.drawImage(brickSprite({ color: '#c9971c', steel: false, tnt: false }), 0, 0); // a gold brick...
            g.strokeStyle = 'rgba(255, 240, 170, 0.8)'; // ...with a crate frame
            g.lineWidth = 1.5;
            g.strokeRect(2, 2, BRICK_W - 4, BRICK_H - 4);
            // The powerup's badge, so you can see what's inside
            const cx = BRICK_W / 2;
            const cy = BRICK_H / 2;
            g.fillStyle = cr.color;
            g.beginPath();
            g.arc(cx, cy, 8, 0, Math.PI * 2);
            g.fill();
            g.strokeStyle = '#ffffff';
            g.lineWidth = 1;
            g.stroke();
            g.fillStyle = '#ffffff';
            if (cr.label) {
                g.font = cr.label.length > 1 ? 'bold 9px sans-serif' : 'bold 11px sans-serif';
                g.textAlign = 'center';
                g.textBaseline = 'middle';
                g.fillText(cr.label, cx, cy + 1);
            } else { // shield icon
                g.beginPath();
                g.moveTo(cx, cy - 5);
                g.lineTo(cx + 4, cy - 3);
                g.lineTo(cx + 4, cy + 1);
                g.quadraticCurveTo(cx + 3, cy + 4, cx, cy + 5.5);
                g.quadraticCurveTo(cx - 3, cy + 4, cx - 4, cy + 1);
                g.lineTo(cx - 4, cy - 3);
                g.closePath();
                g.fill();
            }
        });
    }
    return crateSprites[cr.type];
}

function drawCrates() {
    for (const cr of crates) {
        if (!cr.alive) continue;
        const k = cr.age === undefined ? 1 : Math.min(1, cr.age / 18);
        if (k >= 1) {
            ctx.drawImage(crateSprite(cr), cr.x, cr.y);
            continue;
        }
        // A new crate pops in: grows and fades up over ~0.3s
        const sc = 0.3 + 0.7 * k;
        ctx.save();
        ctx.globalAlpha = k;
        ctx.translate(cr.x + cr.w / 2, cr.y + cr.h / 2);
        ctx.scale(sc, sc);
        ctx.drawImage(crateSprite(cr), -cr.w / 2, -cr.h / 2);
        ctx.restore();
    }
}

function breakCrate(cr) {
    cr.alive = false;
    const cx = cr.x + cr.w / 2;
    const cy = cr.y + cr.h / 2;
    dropPowerup(cr.type, cx, cy + 6);
    spawnParticles(cx, cy, '#ffd23f', 12);
    addScore(25 * (doubleTimer > 0 ? 2 : 1));
    addPopup(cx, cy - 12, 'POWERUP!', '#ffe58a', { size: 14, life: 0.9 });
    beep(720, 'crate');
    addShake(2);
    haptic(15);
    if (crateTimer <= 0) crateTimer = Math.round(60 * (10 + Math.random() * 8)); // a replacement arrives in 10-18s
}

// Ball vs crates: it breaks one and bounces (a fire ball goes straight through)
function crateBallCollision(b) {
    for (const cr of crates) {
        if (!cr.alive) continue;
        const cx = Math.max(cr.x, Math.min(b.x, cr.x + cr.w));
        const cy = Math.max(cr.y, Math.min(b.y, cr.y + cr.h));
        const dx = b.x - cx;
        const dy = b.y - cy;
        if (dx * dx + dy * dy >= b.r * b.r) continue;
        breakCrate(cr);
        if (fireTimer <= 0) {
            if (Math.abs(dx) > Math.abs(dy)) {
                const dir = dx >= 0 ? 1 : -1;
                b.vx = dir * Math.abs(b.vx);
                b.x = dir > 0 ? cr.x + cr.w + b.r : cr.x - b.r;
            } else {
                const dir = dy >= 0 ? 1 : -1;
                b.vy = dir * Math.abs(b.vy);
                b.y = dir > 0 ? cr.y + cr.h + b.r : cr.y - b.r;
            }
        }
        return;
    }
}

// -- Boss drawing --
function paintBossSprite(g) {
    // Hull
    let gr = g.createLinearGradient(0, 38, 0, 98);
    gr.addColorStop(0, '#9a9ab8');
    gr.addColorStop(0.5, '#565673');
    gr.addColorStop(1, '#25253a');
    g.fillStyle = gr;
    g.beginPath();
    g.ellipse(120, 68, 108, 30, 0, 0, Math.PI * 2);
    g.fill();
    g.strokeStyle = 'rgba(255, 255, 255, 0.25)';
    g.lineWidth = 2;
    g.beginPath();
    g.ellipse(120, 66, 106, 28, 0, Math.PI * 1.05, Math.PI * 1.95);
    g.stroke();
    g.strokeStyle = 'rgba(0, 0, 0, 0.3)';
    g.lineWidth = 1;
    for (let i = -3; i <= 3; i++) {
        g.beginPath();
        g.moveTo(120 + i * 28, 42);
        g.lineTo(120 + i * 34, 96);
        g.stroke();
    }
    // Glass dome with the pilot inside
    gr = g.createRadialGradient(120, 44, 4, 120, 50, 46);
    gr.addColorStop(0, 'rgba(200, 255, 255, 0.95)');
    gr.addColorStop(1, 'rgba(60, 140, 210, 0.85)');
    g.fillStyle = gr;
    g.beginPath();
    g.ellipse(120, 52, 46, 40, 0, Math.PI, Math.PI * 2);
    g.closePath();
    g.fill();
    g.strokeStyle = 'rgba(255, 255, 255, 0.5)';
    g.lineWidth = 1.5;
    g.beginPath();
    g.ellipse(120, 52, 46, 40, 0, Math.PI, Math.PI * 2);
    g.stroke();
    g.drawImage(alienSprite(0, '#1f6b34'), 96, 28, 48, 36);

    // Weak-point hatch on the belly (sprite centre is the boss origin + (120, 55)): an amber panel marked x3
    gr = g.createLinearGradient(0, 74, 0, 96);
    gr.addColorStop(0, '#ffe58a');
    gr.addColorStop(1, '#e08a00');
    g.fillStyle = gr;
    roundRectOn(g, 88, 74, 64, 22, 6);
    g.fill();
    g.strokeStyle = '#3a2a00';
    g.lineWidth = 2;
    g.stroke();
    g.fillStyle = '#3a2a00';
    g.font = 'bold 15px sans-serif';
    g.textAlign = 'center';
    g.textBaseline = 'middle';
    g.fillText('\u00d73', 120, 86);
}

function roundRectOn(g, x, y, w, h, r) {
    g.beginPath();
    g.moveTo(x + r, y);
    g.arcTo(x + w, y, x + w, y + h, r);
    g.arcTo(x + w, y + h, x, y + h, r);
    g.arcTo(x, y + h, x, y, r);
    g.arcTo(x, y, x + w, y, r);
    g.closePath();
}

let bossSprite = null;

function drawBossTelegraph(B) {
    const a = B.atk;
    const y0 = B.y + 40;
    ctx.save();
    if (a.kind === 'fan') {
        const count = bossPhase() >= 2 ? 4 : 3;
        const base = Math.atan2(paddle.x + paddle.w / 2 - B.x, paddle.y - y0);
        ctx.strokeStyle = 'rgba(255, 90, 90, 0.35)';
        ctx.lineWidth = 1.5;
        ctx.setLineDash([4, 6]);
        ctx.beginPath();
        for (let i = 0; i < count; i++) {
            const ang = base + (i - (count - 1) / 2) * 0.28;
            ctx.moveTo(B.x, y0);
            ctx.lineTo(B.x + Math.sin(ang) * (paddle.y - y0) / Math.cos(ang), paddle.y);
        }
        ctx.stroke();
    } else if (a.kind === 'rain') {
        ctx.fillStyle = 'rgba(255, 70, 70, ' + (0.1 + 0.08 * Math.sin(performance.now() / 60)) + ')';
        for (const x of a.cols) ctx.fillRect(x - 5, 0, 10, paddle.y);
    } else if (a.kind === 'beam' && B.beamFx <= 0) {
        ctx.strokeStyle = 'rgba(255, 77, 216, ' + (a.t > a.dur - 30 ? 0.8 : 0.4) + ')'; // brighter once it has locked on
        ctx.lineWidth = 2;
        ctx.setLineDash([6, 6]);
        ctx.strokeRect(a.x - BEAM_HALF, B.y + 43, BEAM_HALF * 2, CANVAS_H - B.y - 43);
    }
    ctx.restore();
}

function drawBoss() {
    const B = boss;
    if (!B) return;
    if (B.atk) drawBossTelegraph(B);
    if (!bossSprite) bossSprite = makeSprite(240, 110, paintBossSprite);
    const jitter = B.dying > 0 ? (Math.random() - 0.5) * 8 : 0;
    const sx = B.x - 120 + jitter;
    const sy = B.y - 55 + (B.dying > 0 ? (Math.random() - 0.5) * 8 : 0);
    ctx.drawImage(bossSprite, sx, sy);

    // Blinking rim lights
    const beat = Math.floor(B.t / 8);
    for (let i = 0; i < 9; i++) {
        const th = Math.PI * (0.12 + i * 0.095);
        ctx.fillStyle = (beat + i) % 2 === 0 ? '#ffd23f' : '#ff4d6a';
        ctx.beginPath();
        ctx.arc(B.x + jitter + Math.cos(th) * 96, B.y + 13 + Math.sin(th) * 26, 3, 0, Math.PI * 2);
        ctx.fill();
    }

    // A soft pulse around the hatch draws the eye to the weak point
    const core = bossCore();
    ctx.strokeStyle = 'rgba(255, 210, 90, ' + (0.35 + 0.3 * Math.sin(B.t / 10)) + ')';
    ctx.lineWidth = 2;
    ctx.beginPath();
    ctx.arc(core.x + jitter, core.y, 40 + 3 * Math.sin(B.t / 10), 0, Math.PI * 2);
    ctx.stroke();

    if (B.flash > 0) { // damage flash
        ctx.save();
        ctx.globalCompositeOperation = 'lighter';
        ctx.globalAlpha = (B.flash / 6) * 0.7;
        ctx.drawImage(bossSprite, sx, sy);
        ctx.restore();
    }

    if (B.beamFx > 0) { // the mind-flip beam itself
        ctx.save();
        ctx.globalAlpha = B.beamFx / 18;
        ctx.fillStyle = '#ff4dd8';
        ctx.fillRect(B.beamX - BEAM_HALF, B.y + 43, BEAM_HALF * 2, CANVAS_H - B.y - 43);
        ctx.fillStyle = '#ffffff';
        ctx.fillRect(B.beamX - 8, B.y + 43, 16, CANVAS_H - B.y - 43);
        ctx.restore();
    }
}

function drawBossBar() {
    const B = boss;
    if (!B || B.dying > 0) return;
    const w = 460;
    const x = (CANVAS_W - w) / 2;
    const y = 64; // below the event banner, which can appear over the top of the playfield
    const h = 12;
    const phase = bossPhase();
    const roman = ['', 'I', 'II', 'III', 'IV', 'V', 'VI', 'VII', 'VIII', 'IX', 'X'][B.n] || B.n;
    ctx.save();
    ctx.fillStyle = 'rgba(0, 0, 0, 0.65)';
    ctx.fillRect(x - 3, y - 3, w + 6, h + 6);
    ctx.fillStyle = phase === 1 ? '#4de08c' : phase === 2 ? '#ff9a2e' : '#ff4d4d';
    ctx.fillRect(x, y, w * Math.max(0, B.hp / B.maxHp), h);
    ctx.fillStyle = 'rgba(255, 255, 255, 0.5)'; // phase notches
    ctx.fillRect(x + w * 0.33 - 1, y, 2, h);
    ctx.fillRect(x + w * 0.66 - 1, y, 2, h);
    ctx.font = 'bold 12px sans-serif';
    ctx.textAlign = 'center';
    ctx.fillStyle = '#ffffff';
    ctx.fillText('MOTHERSHIP ' + roman + '   ' + Math.max(0, B.hp) + ' / ' + B.maxHp, CANVAS_W / 2, y - 6);
    if (B.chainT > 0) {
        const mult = bossChainMult(B.chain);
        const next = bossChainMult(B.chain + 1);
        const pw = 220;
        const ph = 16;
        const px = (CANVAS_W - pw) / 2;
        const py = y + h + 9;
        ctx.fillStyle = 'rgba(0, 0, 0, 0.65)';
        ctx.fillRect(px - 3, py - 3, pw + 6, ph + 6);
        ctx.fillStyle = '#ffb300';
        ctx.fillRect(px, py, pw * (B.chainT / BOSS_CHAIN_FRAMES), ph);
        ctx.fillStyle = '#2a1c00';
        ctx.font = 'bold 11px sans-serif';
        ctx.textBaseline = 'middle';
        ctx.fillText((mult > 1 ? 'CHAIN \u00d7' + mult : 'HIT IT AGAIN!') + (next > mult ? '  \u2192 next \u00d7' + next : '  MAX'), CANVAS_W / 2, py + ph / 2 + 1);
    }
    ctx.restore();
}

// --- Warp rifts ---
// A rare, random shortcut: a shimmering portal appears somewhere in the open play area, gives a few
// seconds' warning, then sits there for a while, pulling the ball in like gravity once it's within range.
// Getting sucked in jumps you forward 1-5 levels (randomly, never more), so a run stuck on a hard level
// always has an escape hatch. It skips boss intros/deaths so it can't interrupt those, and killing an
// alien has a 50% chance of opening one on the spot, as a bonus for the fight.
const WARP_MAX_STEPS = 5;
const WARP_WARN_FRAMES = 90;   // 1.5s telegraph before it's live
const WARP_LIFE_FRAMES = 480;  // ~8s to reach it once live, or it closes unused
const WARP_R = 30;             // the rift's own visible/consuming size
const WARP_PULL_R = 130;       // how far out it starts pulling the ball in
const WARP_PULL_MAX = 0.9;     // strongest pull, applied right at the edge of the rift itself
const WARP_ON_ALIEN_KILL_CHANCE = 0.5;
let warpRift = null;    // { x, y, r, pullR, warn, life, t }
let warpTimer = 0;      // frames until the next one may appear

// Longer than a boss/ghost level takes to notice help is needed, shorter later on; always some randomness
function warpInterval() {
    const base = Math.max(38, 75 - level * 0.6);
    return Math.round(60 * base * (0.75 + Math.random() * 0.6));
}

function canSpawnWarp() {
    return gameState === 'playing' && !warpRift &&
        !(boss && (boss.intro > 0 || boss.dying > 0)) &&
        !(ghost && ghostCount() <= 6) &&
        !(!ghost && !boss && bricksLeft <= 3);
}

function spawnWarpRift() {
    warpRift = {
        x: 90 + Math.random() * (CANVAS_W - 180),
        y: 300 + Math.random() * 140,
        r: WARP_R,
        pullR: WARP_PULL_R,
        warn: WARP_WARN_FRAMES,
        life: WARP_LIFE_FRAMES,
        t: 0
    };
    addPopup(CANVAS_W / 2, 100, '⚡ WARP RIFT OPENING…', '#7be8ff', { size: 20, life: 1.6, rise: 0.2, pop: true });
    tone(220, 0.4, { type: 'sine', vol: 0.2, slideTo: 600, key: 'warpWarn', force: true });
    haptic([20, 40, 20, 40], true);
}

function triggerWarp() {
    const from = level;
    const steps = 1 + Math.floor(Math.random() * WARP_MAX_STEPS); // 1-5 levels forward, never more
    level += steps;
    gameState = 'ready';
    runStats.warps++;
    powerups.length = 0;
    clearTimedEffects();
    endChaos(false);
    combo = 0;
    addScore(50 * steps);
    warpRift = null;
    spawnLevel();
    const sp = currentSpeed();
    balls = [makeBall(paddle.x + paddle.w / 2, paddle.y - BALL_RADIUS, sp, -sp)];
    inputLockUntil = performance.now() + 700;
    addShake(8);
    haptic([30, 20, 30, 20, 60], true);
    tone(300, 0.12, { type: 'sine', vol: 0.22, key: 'warpJump', force: true });
    tone(900, 0.35, { type: 'sine', vol: 0.22, slideTo: 1800, delay: 0.1, force: true });
    showOverlay('WARP!\nJumped from level ' + from + ' to ' + level, 'Continue');
}

function updateWarpRift() {
    if (warpRift) {
        warpRift.t++;
        if (warpRift.warn > 0) {
            warpRift.warn--;
        } else if (--warpRift.life <= 0) {
            warpRift = null; // closed unused
        }
    } else if (canSpawnWarp() && --warpTimer <= 0) {
        spawnWarpRift();
        warpTimer = warpInterval();
    }
}

function warpRiftBallCollision(b) {
    if (!warpRift || warpRift.warn > 0) return;
    const dx = warpRift.x - b.x;
    const dy = warpRift.y - b.y;
    const dist = Math.hypot(dx, dy);
    if (dist < warpRift.pullR) {
        // Gravity: bend the ball's velocity toward the rift's centre, stronger the closer it gets, then
        // restore its original speed so it curves in rather than speeding up or stalling
        const speed = Math.hypot(b.vx, b.vy);
        const pull = 1 - dist / warpRift.pullR; // 0 at the edge of the field, 1 at the rift's own centre
        const nx = dist > 0.01 ? dx / dist : 0;
        const ny = dist > 0.01 ? dy / dist : 0;
        b.vx += nx * pull * WARP_PULL_MAX;
        b.vy += ny * pull * WARP_PULL_MAX;
        const mag = Math.hypot(b.vx, b.vy);
        if (mag > 0.01) {
            const f = speed / mag;
            b.vx *= f;
            b.vy *= f;
        }
        if (Math.random() < 0.4) spawnParticles(b.x, b.y, '#a78bff', 1);
    }
    if (dist < warpRift.r + b.r) triggerWarp();
}

function drawWarpRift() {
    if (!warpRift) return;
    const r = warpRift;
    ctx.save();
    if (r.warn > 0) {
        // Telegraph: a growing dashed ring
        const k = 1 - r.warn / WARP_WARN_FRAMES;
        ctx.globalAlpha = 0.5 + 0.4 * k;
        ctx.strokeStyle = '#7be8ff';
        ctx.lineWidth = 2;
        ctx.setLineDash([5, 5]);
        ctx.beginPath();
        ctx.arc(r.x, r.y, 4 + r.r * k, 0, Math.PI * 2);
        ctx.stroke();
    } else {
        const spin = r.t / 12;
        const fade = r.life < 90 && Math.floor(r.life / 6) % 2 === 0 ? 0.35 : 1; // blinks just before closing
        ctx.globalAlpha = fade;
        // The pull field itself: a faint vignette out to pullR, so its reach is visible, not just felt
        const field = ctx.createRadialGradient(r.x, r.y, r.r, r.x, r.y, r.pullR);
        field.addColorStop(0, 'rgba(120, 90, 255, 0.16)');
        field.addColorStop(1, 'rgba(120, 90, 255, 0)');
        ctx.fillStyle = field;
        ctx.beginPath();
        ctx.arc(r.x, r.y, r.pullR, 0, Math.PI * 2);
        ctx.fill();
        ctx.translate(r.x, r.y);
        for (let i = 0; i < 3; i++) {
            ctx.rotate(spin * (i % 2 === 0 ? 1 : -1) + i);
            const grad = ctx.createRadialGradient(0, 0, 2, 0, 0, r.r - i * 5);
            grad.addColorStop(0, 'rgba(255, 255, 255, 0.9)');
            grad.addColorStop(0.5, 'rgba(120, 90, 255, 0.55)');
            grad.addColorStop(1, 'rgba(60, 30, 180, 0)');
            ctx.fillStyle = grad;
            ctx.beginPath();
            ctx.ellipse(0, 0, r.r - i * 5, (r.r - i * 5) * 0.4, 0, 0, Math.PI * 2);
            ctx.fill();
        }
    }
    ctx.restore();
}

// --- Ghost rows ("Tetris") levels ---
// The bricks are ghosts: the ball flies straight through them, and each ghost it has passed through turns
// solid once the ball has left it. Solid cells bounce the ball like walls and are never destroyed by it.
// Instead, when every cell of a row is solid the row clears (like a Tetris line) and the rows above fall.
// Clear every row to finish the level. Rows have random gaps so they complete at different times, and a
// ghost the ball can no longer reach (walled in by solid cells) solidifies by itself, so a level can
// always be finished.
const TETRIS_COLORS = ['#00e5ff', '#ffd23f', '#b56bff', '#4de08c', '#ff5a5a', '#3d7bff', '#ff9a2e', '#e05cff'];
let ghost = null;        // { rows, cells[c][r] = { state, dy } }; state 0 none, 1 ghost, 2 arming (ball inside), 3 solid
let ghostFlashes = [];   // row-clear flashes: { y, t }
let ghostIntroSeen = false;

function buildGhostGrid(l) {
    const rand = seededRandom(l * 6700417 + 11);
    const rows = 6 + (l >= 12 ? 1 : 0) + (l >= 18 ? 1 : 0);
    const cells = [];
    for (let c = 0; c < BRICK_COLS; c++) {
        cells[c] = [];
        for (let r = 0; r < rows; r++) cells[c][r] = { state: 1, dy: 0 };
    }
    for (let r = 0; r < rows; r++) {
        // 0-2 gaps per row, so rows have different shapes and finish at different times
        const gaps = Math.floor(rand() * 3);
        for (let g = 0; g < gaps; g++) {
            const w = 1 + Math.floor(rand() * 3);
            const c0 = Math.floor(rand() * (BRICK_COLS - w + 1));
            for (let c = c0; c < c0 + w; c++) cells[c][r].state = 0;
        }
        // ...but never fewer than 5 cells in a row
        for (let c = 0; c < BRICK_COLS && cells.filter(col => col[r].state > 0).length < 5; c++) cells[c][r].state = 1;
    }
    return { rows, cells };
}

function ghostCount() {
    let n = 0;
    for (const col of ghost.cells) for (const cell of col) if (cell.state > 0) n++;
    return n;
}

function ghostCellX(c) {
    return BRICK_OFFSET_LEFT + c * BRICK_W;
}
function ghostCellY(r) {
    return BRICK_OFFSET_TOP + r * BRICK_H;
}

// Every ghost cell around (x, y) that the ball currently overlaps
function ballOverlaps(b, c, r, margin = 0) {
    const x = ghostCellX(c);
    const y = ghostCellY(r);
    const cx = Math.max(x, Math.min(b.x, x + BRICK_W));
    const cy = Math.max(y, Math.min(b.y, y + BRICK_H));
    const dx = b.x - cx;
    const dy = b.y - cy;
    const rr = b.r + margin;
    return dx * dx + dy * dy < rr * rr;
}

// Cells the ball can never reach (all four neighbours solid, or walled off from outside) solidify
function fillPockets() {
    const R = ghost.rows;
    const seen = [];
    for (let c = 0; c < BRICK_COLS; c++) seen[c] = new Array(R).fill(false);
    const stack = [];
    const open = (c, r) => ghost.cells[c][r].state !== 3; // empty, ghost and arming cells can all be flown through
    const push = (c, r) => {
        if (c >= 0 && c < BRICK_COLS && r >= 0 && r < R && !seen[c][r] && open(c, r)) {
            seen[c][r] = true;
            stack.push([c, r]);
        }
    };
    // The ball can get at the grid from above, below and from both sides
    for (let c = 0; c < BRICK_COLS; c++) {
        push(c, 0);
        push(c, R - 1);
    }
    for (let r = 0; r < R; r++) {
        push(0, r);
        push(BRICK_COLS - 1, r);
    }
    while (stack.length) {
        const [c, r] = stack.pop();
        push(c + 1, r);
        push(c - 1, r);
        push(c, r + 1);
        push(c, r - 1);
    }
    let changed = false;
    for (let c = 0; c < BRICK_COLS; c++) {
        for (let r = 0; r < R; r++) {
            const cell = ghost.cells[c][r];
            if ((cell.state === 1 || cell.state === 2) && !seen[c][r]) {
                cell.state = 3;
                changed = true;
            }
        }
    }
    return changed;
}

// Rows whose every cell is solid
function completeRows() {
    const full = [];
    for (let r = 0; r < ghost.rows; r++) {
        let n = 0;
        let solid = 0;
        for (let c = 0; c < BRICK_COLS; c++) {
            const st = ghost.cells[c][r].state;
            if (st > 0) {
                n++;
                if (st === 3) solid++;
            }
        }
        if (n > 0 && solid === n) full.push(r);
    }
    return full;
}

const GHOST_CLEAR_DELAY = 14; // frames a finished row waits, so rows finished by the same pass clear together

function clearRows(full) {
    const R = ghost.rows;
    // Score and fanfare
    const n = full.length;
    let removed = 0;
    for (const r of full) {
        for (let c = 0; c < BRICK_COLS; c++) if (ghost.cells[c][r].state > 0) removed++;
    }
    const points = 100 * n * n * (doubleTimer > 0 ? 2 : 1);
    addScore(points);
    runStats.bricks += removed;
    const label = ['', 'LINE!', 'DOUBLE!', 'TRIPLE!', 'TETRIS!'][Math.min(n, 4)];
    const topY = ghostCellY(full[0]);
    addPopup(CANVAS_W / 2, topY + 34, label + '  +' + points, ['', '#ffffff', '#ffd23f', '#ff9a2e', '#ff4d6a'][Math.min(n, 4)],
        { size: 20 + 4 * Math.min(n, 4), life: 1.5, rise: 0.4, pop: true });
    for (const r of full) {
        ghostFlashes.push({ y: ghostCellY(r), t: 14 });
        for (let c = 0; c < BRICK_COLS; c += 2) spawnParticles(ghostCellX(c) + BRICK_W / 2, ghostCellY(r) + BRICK_H / 2, TETRIS_COLORS[r % TETRIS_COLORS.length], 3);
        spawnPowerup(ghostCellX(1 + Math.floor(Math.random() * (BRICK_COLS - 2))) + BRICK_W / 2, ghostCellY(r) + BRICK_H / 2); // a reward per cleared row
    }
    for (let i = 0; i < n; i++) tone(440 * Math.pow(2, i / 4), 0.14, { type: 'triangle', vol: 0.22, delay: i * 0.08, force: true });
    addShake(4 + 3 * Math.min(n, 4));
    haptic(n >= 3 ? [30, 30, 60] : [20, 20, 30], true);

    // Remove the cleared rows; everything above falls to fill the gap (with a short falling animation)
    for (let c = 0; c < BRICK_COLS; c++) {
        const col = [];
        const dys = [];
        for (let r = 0; r < R; r++) {
            if (full.includes(r)) continue;
            col.push(ghost.cells[c][r]);
            dys.push(full.filter(fr => fr > r).length * BRICK_H); // how far this cell falls
        }
        const top = R - col.length;
        for (let r = 0; r < R; r++) {
            if (r < top) {
                ghost.cells[c][r] = { state: 0, dy: 0 };
            } else {
                const cell = col[r - top];
                cell.dy = dys[r - top];
                ghost.cells[c][r] = cell;
            }
        }
    }
    bricksLeft = ghostCount();
    // A falling solid cell must not land inside the ball: those cells become "arming" until the ball leaves
    for (let c = 0; c < BRICK_COLS; c++) {
        for (let r = 0; r < R; r++) {
            if (ghost.cells[c][r].state === 3 && balls.some(b => ballOverlaps(b, c, r, 1))) ghost.cells[c][r].state = 2;
        }
    }
    fillPockets();
    if (bricksLeft <= 0) completeLevel();
}

// A ball touches a ghost: it starts turning solid (finishes when the ball has left it)
function activateGhost(c, r, b) {
    ghost.cells[c][r].state = 2;
    combo++;
    runStats.maxCombo = Math.max(runStats.maxCombo, combo);
    const mult = Math.min(combo, COMBO_MAX);
    addScore(5 * mult * (doubleTimer > 0 ? 2 : 1));
    beep(420 + 45 * (ghost.rows - r), 'ghost');
    spawnParticles(ghostCellX(c) + BRICK_W / 2, ghostCellY(r) + BRICK_H / 2, TETRIS_COLORS[r % TETRIS_COLORS.length], 3);
    if (combo >= 3 && combo <= COMBO_MAX) comboShout(combo, ghostCellX(c) + BRICK_W / 2, ghostCellY(r) + BRICK_H / 2);
    if (Math.random() < 0.03) spawnPowerup(ghostCellX(c) + BRICK_W / 2, ghostCellY(r) + BRICK_H / 2);
    if (explosiveReady) blastGhost(c, r);
}

// Explosive: instantly solidifies a 3x3 area (and gets used up)
function blastGhost(c, r) {
    explosiveReady = false;
    for (let cc = c - 1; cc <= c + 1; cc++) {
        for (let rr = r - 1; rr <= r + 1; rr++) {
            if (cc >= 0 && cc < BRICK_COLS && rr >= 0 && rr < ghost.rows) {
                const cell = ghost.cells[cc][rr];
                if (cell.state === 1 || cell.state === 2) {
                    // a cell with a ball inside turns solid once the ball has left, like any other
                    cell.state = balls.some(b => ballOverlaps(b, cc, rr, 1)) ? 2 : 3;
                }
            }
        }
    }
    addBlast(ghostCellX(c) + BRICK_W / 2, ghostCellY(r) + BRICK_H / 2);
    boom();
    addShake(8);
    haptic(40, true);
    addPopup(ghostCellX(c) + BRICK_W / 2, ghostCellY(r) - 8, 'SOLID!', '#ff9a2e', { size: 16, life: 0.9 });
    fillPockets();
}

function ghostBallCollision(b) {
    if (!ghost) return;
    let bounced = false;
    for (let c = 0; c < BRICK_COLS; c++) {
        for (let r = 0; r < ghost.rows; r++) {
            const cell = ghost.cells[c][r];
            if (cell.state === 0 || !ballOverlaps(b, c, r)) continue;
            if (cell.state === 1) {
                activateGhost(c, r, b); // flies straight through
                if (gameState !== 'playing' || !ghost) return; // an Explosive blast can finish the level
            } else if (cell.state === 3 && !bounced && fireTimer <= 0) {
                const x = ghostCellX(c);
                const y = ghostCellY(r);
                const cx = Math.max(x, Math.min(b.x, x + BRICK_W));
                const cy = Math.max(y, Math.min(b.y, y + BRICK_H));
                const dx = b.x - cx;
                const dy = b.y - cy;
                if (Math.abs(dx) > Math.abs(dy)) {
                    const dir = dx >= 0 ? 1 : -1;
                    b.vx = dir * Math.abs(b.vx);
                    b.x = dir > 0 ? x + BRICK_W + b.r : x - b.r;
                } else {
                    const dir = dy >= 0 ? 1 : -1;
                    b.vy = dir * Math.abs(b.vy);
                    b.y = dir > 0 ? y + BRICK_H + b.r : y - b.r;
                }
                beep(240, 'tink');
                bounced = true;
                // A ball bouncing straight up and down between two solid cells (no sideways speed) could be trapped
                // in a one-cell slot forever: give it a little sideways push, keeping its speed
                if (Math.abs(b.vx) < 0.6) {
                    const sp = Math.hypot(b.vx, b.vy);
                    b.vx = (Math.random() < 0.5 ? -1 : 1) * (0.8 + Math.random() * 0.8);
                    b.vy = (b.vy < 0 ? -1 : 1) * Math.sqrt(Math.max(1, sp * sp - b.vx * b.vx));
                }
                if (explosiveReady) {
                    blastGhost(c, r);
                    if (gameState !== 'playing' || !ghost) return;
                }
            }
        }
    }
}

function updateGhostGrid() {
    if (!ghost) return;
    // Watchdog: a ball that has been inside the grid for 5 seconds (cornered in a slot or a sealed pocket) is
    // released below it, so a ghost level can never soft-lock
    const gridTop = ghostCellY(0) - 12;
    const gridBottom = ghostCellY(ghost.rows) + 12;
    for (const b of balls) {
        if (b.y > gridTop && b.y < gridBottom && !b.stuck) {
            if (++b.gridT > 300) {
                b.y = gridBottom + 14;
                b.vy = Math.abs(b.vy) || currentSpeed();
                b.gridT = 0;
                addPopup(b.x, gridBottom + 30, 'FREED', '#aab4c8', { size: 12, life: 0.8 });
            }
        } else {
            b.gridT = 0;
        }
    }
    let changed = false;
    for (let c = 0; c < BRICK_COLS; c++) {
        for (let r = 0; r < ghost.rows; r++) {
            const cell = ghost.cells[c][r];
            if (cell.dy > 0) cell.dy = Math.max(0, cell.dy - 3);
            if (cell.state === 2 && !balls.some(b => ballOverlaps(b, c, r, 1))) {
                cell.state = 3; // the ball has passed through: now it is solid
                changed = true;
            }
        }
    }
    if (changed) fillPockets();
    for (let i = ghostFlashes.length - 1; i >= 0; i--) {
        if (--ghostFlashes[i].t <= 0) ghostFlashes.splice(i, 1);
    }
    // A finished row waits a moment before it clears: a ball flying up a column finishes several rows in
    // quick succession, and they should clear together (LINE! / DOUBLE! / TRIPLE! / TETRIS!)
    if (completeRows().length) {
        if (!ghost.clearIn) ghost.clearIn = GHOST_CLEAR_DELAY;
        else if (--ghost.clearIn === 0) clearRows(completeRows());
    } else {
        ghost.clearIn = 0;
    }
}

// The guided ball prefers shots that cross ghosts in rows that are nearly complete. Shots are planned with the
// ball's real width (a thin line would happily "thread" gaps the ball actually clips), and it picks at random
// among the near-best shots, so it can never repeat one hopeless shot forever.
function bestAimGhost(x, y) {
    const speed = currentSpeed();
    const rowWeight = r => {
        let n = 0;
        let solid = 0;
        for (let c = 0; c < BRICK_COLS; c++) {
            const st = ghost.cells[c][r].state;
            if (st > 0) n++;
            if (st === 3) solid++;
        }
        return n ? 1 + 4 * (solid / n) * (solid / n) : 0;
    };
    // Would a ball centred here overlap a solid cell?
    const blocked = (px, py) => {
        const c0 = Math.floor((px - BRICK_OFFSET_LEFT) / BRICK_W);
        const r0 = Math.floor((py - BRICK_OFFSET_TOP) / BRICK_H);
        for (let c = c0 - 1; c <= c0 + 1; c++) {
            for (let r = r0 - 1; r <= r0 + 1; r++) {
                if (c < 0 || c >= BRICK_COLS || r < 0 || r >= ghost.rows || ghost.cells[c][r].state !== 3) continue;
                const cx = ghostCellX(c);
                const cy = ghostCellY(r);
                const dx = px - Math.max(cx, Math.min(px, cx + BRICK_W));
                const dy = py - Math.max(cy, Math.min(py, cy + BRICK_H));
                if (dx * dx + dy * dy < (BALL_RADIUS + 1) * (BALL_RADIUS + 1)) return true;
            }
        }
        return false;
    };
    const shots = [];
    for (let deg = -70; deg <= 70; deg += 7) {
        const a = (deg * Math.PI) / 180;
        const dx0 = Math.sin(a);
        const dy0 = -Math.cos(a);
        let dx = dx0;
        let px = x;
        let py = y;
        const seen = new Set();
        let value = 0;
        for (let i = 0; i < 170; i++) {
            px += dx * 5;
            py += dy0 * 5;
            if (px < BALL_RADIUS) {
                px = 2 * BALL_RADIUS - px;
                dx = -dx;
            } else if (px > CANVAS_W - BALL_RADIUS) {
                px = 2 * (CANVAS_W - BALL_RADIUS) - px;
                dx = -dx;
            }
            if (py < 0 || py > CANVAS_H) break;
            if (blocked(px, py)) break; // a solid cell stops the shot
            const c = Math.floor((px - BRICK_OFFSET_LEFT) / BRICK_W);
            const r = Math.floor((py - BRICK_OFFSET_TOP) / BRICK_H);
            if (c < 0 || c >= BRICK_COLS || r < 0 || r >= ghost.rows) continue;
            if (ghost.cells[c][r].state === 1 && !seen.has(c * 100 + r)) {
                seen.add(c * 100 + r);
                value += rowWeight(r);
            }
        }
        value *= 1 - Math.abs(deg) / 400;
        if (value > 0) shots.push({ value, vx: dx0 * speed, vy: dy0 * speed });
    }
    if (!shots.length) return null;
    const top = Math.max(...shots.map(sh => sh.value));
    const good = shots.filter(sh => sh.value >= 0.75 * top);
    const pick = good[Math.floor(Math.random() * good.length)];
    return { vx: pick.vx, vy: pick.vy, ghost: true };
}

// -- drawing --
function drawGhostGrid() {
    if (!ghost) return;
    const now = performance.now();
    // Ghosts: faint, shimmering, with dashed outlines
    ctx.save();
    ctx.strokeStyle = 'rgba(200, 230, 255, 0.4)';
    ctx.lineWidth = 1;
    ctx.setLineDash([3, 3]);
    ctx.beginPath();
    for (let c = 0; c < BRICK_COLS; c++) {
        for (let r = 0; r < ghost.rows; r++) {
            const cell = ghost.cells[c][r];
            if (cell.state !== 1) continue;
            const x = ghostCellX(c);
            const y = ghostCellY(r) - cell.dy;
            ctx.globalAlpha = 0.27 + 0.09 * Math.sin(now / 350 + c * 0.7 + r * 0.9);
            ctx.drawImage(brickSprite({ color: TETRIS_COLORS[r % TETRIS_COLORS.length], steel: false, tnt: false }), x, y);
            ctx.rect(x + 0.5, y + 0.5, BRICK_W - 1, BRICK_H - 1);
        }
    }
    ctx.globalAlpha = 0.45;
    ctx.stroke();
    ctx.restore();
    // Arming (the ball is inside) and solid cells
    for (let c = 0; c < BRICK_COLS; c++) {
        for (let r = 0; r < ghost.rows; r++) {
            const cell = ghost.cells[c][r];
            if (cell.state < 2) continue;
            const x = ghostCellX(c);
            const y = ghostCellY(r) - cell.dy;
            ctx.drawImage(brickSprite({ color: TETRIS_COLORS[r % TETRIS_COLORS.length], steel: false, tnt: false }), x, y);
            if (cell.state === 2) {
                ctx.fillStyle = 'rgba(255, 255, 255, 0.55)';
                ctx.fillRect(x, y, BRICK_W, BRICK_H);
            }
        }
    }
    // Rows that are finished and about to clear pulse
    if (ghost.clearIn > 0) {
        ctx.fillStyle = 'rgba(255, 255, 255, ' + (0.18 + 0.14 * Math.sin(now / 45)) + ')';
        for (const r of completeRows()) ctx.fillRect(BRICK_OFFSET_LEFT, ghostCellY(r), BRICK_COLS * BRICK_W, BRICK_H);
    }
    // Row-clear flashes
    for (const f of ghostFlashes) {
        ctx.fillStyle = 'rgba(255, 255, 255, ' + (f.t / 14) * 0.85 + ')';
        ctx.fillRect(BRICK_OFFSET_LEFT, f.y, BRICK_COLS * BRICK_W, BRICK_H);
    }
}

// TNT bricks: how many is decided by planLevel(). Placed only where they have neighbours so the blast is
// worth it (never in the top row), seeded per level like the steel clusters. Adjacent TNTs chain.
const TNT_COLOR = '#7a1010';
function placeTnt() {
    const rand = seededRandom(level * 104729);
    const target = plan.tnt;
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
    if (plan.walls >= 1) {
        const y = BRICK_OFFSET_TOP + BRICK_ROWS * BRICK_H + 35; // floats below the brick grid
        const speed = Math.min(2.2 + (level - 3) * 0.5, 6.5);
        walls.push({ x: CANVAS_W / 2 - 60, y: y, w: 120, h: 14, vx: speed, hits: 0 });
        if (plan.walls >= 2) {
            walls.push({ x: 60, y: y + 50, w: 90, h: 14, vx: -speed, hits: 0 });
        }
    }
    return walls;
}

function spawnLevel() {
    plan = planLevel(level);
    boss = null;
    crates = [];
    crateTimer = 0;
    warpRift = null; // any rift belonged to the level just left
    const layout = currentLayout();
    const isSteel = buildSteelMask(layout, STEEL_STYLES[(level - 1) % STEEL_STYLES.length]);

    bricksLeft = 0;
    for (let c = 0; c < BRICK_COLS; c++) {
        for (let r = 0; r < BRICK_ROWS; r++) {
            const brick = bricks[c][r];
            brick.x = (c * BRICK_W) + BRICK_OFFSET_LEFT;
            brick.y = (r * BRICK_H) + BRICK_OFFSET_TOP;
            brick.alive = !plan.boss && !plan.tetris && layout.alive(c, r); // boss arenas and ghost rows have no ordinary bricks
            brick.tnt = false;
            brick.crack = null;
            brick.sprite = null;
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
    ghost = plan.tetris ? buildGhostGrid(level) : null;
    ghostFlashes = [];
    if (ghost) bricksLeft = ghostCount();
    levelBricksTotal = bricksLeft;
    resetAliens(plan.aliens ? plan.aliens.grace : 999, 8); // no aliens carry over; a grace period before the first
    initChaos();
    if (plan.boss) spawnBoss();
    introPending = true;

    movingWalls = buildWalls();
    buildBackground();
}

function makeBall(x, y, vx, vy) {
    return {
        x, y, r: BALL_RADIUS, vx, vy, trail: [], stuck: false, stuckFor: 0, aim: null, aimIn: 0, gridT: 0,
        onWallRef: null, // which moving wall (if any) the ball is currently resting against
        rallyLast: null, rallyStreak: 0, rallyDistinct: null, rallyT: 0, rallyAllShown: false // ping-pong rally
    };
}

// --- Ping-pong rallies ---
// Bouncing the ball off DIFFERENT solid surfaces (the paddle and any moving walls) back and forth in quick
// succession is a real rally: alternate fast enough and it's called out, with a growing score bonus. Using
// every surface currently in play in one streak (only possible from level 8, with two moving walls) is the
// big version.
const RALLY_WINDOW_FRAMES = 150; // ~2.5s between alternating touches to keep the rally alive
const RALLY_THRESHOLD = 4;       // touches needed (two full paddle<->wall round trips) before it calls out
const RALLY_MAX_SHOUT = 7;       // the popup stops growing past this streak; the bonus keeps scaling

function registerRallyTouch(b, surface) {
    const continuing = b.rallyLast !== null && b.rallyLast !== surface && b.rallyT <= RALLY_WINDOW_FRAMES;
    if (continuing) {
        b.rallyStreak++;
        b.rallyDistinct.add(surface);
    } else {
        b.rallyStreak = 1;
        b.rallyDistinct = new Set([surface]);
        b.rallyAllShown = false;
    }
    b.rallyLast = surface;
    b.rallyT = 0;
    if (b.rallyStreak < RALLY_THRESHOLD) return;

    const surfaceCount = 1 + movingWalls.length; // the paddle plus every wall currently in play
    const allSurfaces = surfaceCount > 1 && b.rallyDistinct.size >= surfaceCount;
    const scoreMult = doubleTimer > 0 ? 2 : 1;
    const shoutStreak = Math.min(b.rallyStreak, RALLY_MAX_SHOUT);
    const bonus = 30 * shoutStreak * scoreMult;

    if (allSurfaces && !b.rallyAllShown) {
        // First time this particular rally has touched every surface in play: the big version
        b.rallyAllShown = true;
        const allBonus = 250 * scoreMult;
        addScore(bonus + allBonus);
        addPopup(b.x, b.y - 24, 'ALL SURFACES! PING PONG!! +' + (bonus + allBonus), '#ffd23f',
            { size: 26, life: 1.6, rise: 0.6, pop: true });
        addShake(11);
        haptic([25, 25, 25, 25, 70], true);
        tone(700, 0.12, { type: 'triangle', vol: 0.25, key: 'pingpong', force: true });
        tone(1050, 0.16, { type: 'triangle', vol: 0.25, delay: 0.1, force: true });
    } else {
        addScore(bonus);
        const word = b.rallyStreak === RALLY_THRESHOLD ? 'PING PONG!' : (b.rallyStreak % 2 === 0 ? 'PONG!' : 'PING!');
        addPopup(b.x, b.y - 20, word + ' +' + bonus, '#7be8ff',
            { size: 16 + Math.min(shoutStreak - RALLY_THRESHOLD, 4) * 2, life: 1.1, rise: 0.5, pop: true });
        addShake(3 + shoutStreak * 0.6);
        haptic([14, 14, 18], true);
        tone(b.rallyStreak % 2 === 0 ? 520 : 700, 0.09, { type: 'triangle', vol: 0.2, key: 'pingpong' });
    }
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
        for (const cr of crates) {
            if (cr.alive && x >= cr.x && x <= cr.x + cr.w && y >= cr.y && y <= cr.y + cr.h) return { crate: true };
        }
        if (boss && boss.hp > 0 && boss.intro <= 0 && boss.dying <= 0) {
            for (const [x0, y0, x1, y1] of bossRects()) {
                if (x >= x0 && x <= x1 && y >= y0 && y <= y1) return { boss: true, x, y };
            }
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
    if (ghost) return bestAimGhost(x, y);
    const speed = currentSpeed();
    let best = null;
    let bestValue = 0;
    for (let deg = -70; deg <= 70; deg += 7) {
        const a = (deg * Math.PI) / 180;
        const dx = Math.sin(a);
        const dy = -Math.cos(a);
        const hit = castRay(x, y, dx, dy);
        if (!hit || hit === 'wall') continue;
        let value;
        if (hit.crate) {
            value = 40; // worth a powerup, but less than hitting the boss
        } else if (hit.boss) {
            value = inBossHatch(hit.x, hit.y) ? 150 : 45; // the hatch is worth triple
        } else {
            value = hitValue(hit.c, hit.r);
        }
        const v = value * (1 - Math.abs(deg) / 400); // slight preference for straighter shots
        if (v > bestValue) {
            bestValue = v;
            best = { vx: dx * speed, vy: dy * speed, c: hit.c, r: hit.r, boss: !!hit.boss, crate: !!hit.crate };
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
    const progress = levelBricksTotal > 0 ? 1 - bricksLeft / levelBricksTotal : (boss ? 1 - boss.hp / boss.maxHp : 0);
    const cleared = Math.max(0, Math.min(1, progress));
    return base + 1.2 * cleared;
}

// --- Ambience: level-tinted gradient backdrop with slow parallax stars ---
let bgGradient = null;
const STAR_LAYERS = 3;
const stars = Array.from({ length: 70 }, () => {
    const z = 0.2 + Math.random() * 0.8; // depth: nearer stars are bigger, brighter and move faster
    return {
        x: Math.random() * CANVAS_W,
        y: Math.random() * CANVAS_H,
        z: z,
        layer: Math.min(STAR_LAYERS - 1, Math.floor(((z - 0.2) / 0.8) * STAR_LAYERS))
    };
});

function buildBackground() {
    const hue = plan.boss ? 350 : (235 + (level - 1) * 28) % 360;
    bgGradient = ctx.createLinearGradient(0, 0, 0, CANVAS_H);
    bgGradient.addColorStop(0, 'hsl(' + hue + ', 55%, 5%)');
    bgGradient.addColorStop(1, 'hsl(' + ((hue + 30) % 360) + ', 60%, 17%)');
}

function drawBackground() {
    ctx.fillStyle = bgGradient;
    ctx.fillRect(0, 0, CANVAS_W, CANVAS_H);
    const parallax = paddle ? (paddle.x + paddle.w / 2 - CANVAS_W / 2) * 0.04 : 0;
    // Stars in three depth layers: one path and one fill per layer (was one state change + fill per star),
    // with a shared twinkle per layer
    ctx.fillStyle = '#cfd8ff';
    const twinkle = performance.now() / 700;
    for (let layer = 0; layer < STAR_LAYERS; layer++) {
        ctx.globalAlpha = (0.25 + 0.55 * (layer + 0.5) / STAR_LAYERS) * (0.7 + 0.3 * Math.sin(twinkle + layer * 2.1));
        ctx.beginPath();
        for (const s of stars) {
            if (s.layer !== layer) continue;
            s.y += (0.06 + s.z * 0.3) * timeScale; // the stars are a speedometer
            if (s.y > CANVAS_H) {
                s.y = 0;
                s.x = Math.random() * CANVAS_W;
            }
            const x =(((s.x - parallax * s.z) % CANVAS_W) + CANVAS_W) % CANVAS_W;
            const size = 0.7 + s.z * 1.5;
            ctx.rect(x, s.y, size, size);
        }
        ctx.fill();
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

function fillPoly(g, points, style) {
    g.beginPath();
    g.moveTo(points[0][0], points[0][1]);
    for (let i = 1; i < points.length; i++) g.lineTo(points[i][0], points[i][1]);
    g.closePath();
    g.fillStyle = style;
    g.fill();
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
function drawReticleAt(cx, cy) {
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

// Ball glow sprites per look (trail blob, halo, body), built once on first use. Nothing here creates a
// gradient per frame: a 4-ball fire scene used to build ~70 gradients every frame, which is a lot of
// garbage for a phone to collect.
const ballSprites = {};
function ballSpriteSet(name) {
    if (ballSprites[name]) return ballSprites[name];
    const look = BALL_LOOKS[name];
    const r = BALL_RADIUS;

    // Trail blob: full-alpha radial falloff, drawn scaled with globalAlpha
    const blob = makeSprite(64, 64, g => {
        const gr = g.createRadialGradient(32, 32, 0, 32, 32, 32);
        gr.addColorStop(0, 'rgba(' + look.trailCore + ', 1)');
        gr.addColorStop(1, 'rgba(' + look.trailEdge + ', 0)');
        g.fillStyle = gr;
        g.fillRect(0, 0, 64, 64);
    });

    // Halo behind the ball
    const haloR = r * look.haloR;
    const haloSize = Math.ceil(haloR * 2) + 2;
    const halo = makeSprite(haloSize, haloSize, g => {
        const c = haloSize / 2;
        const gr = g.createRadialGradient(c, c, r * 0.6, c, c, haloR);
        gr.addColorStop(0, 'rgba(' + look.halo + ', ' + look.haloA + ')');
        gr.addColorStop(1, 'rgba(' + look.halo + ', 0)');
        g.fillStyle = gr;
        g.beginPath();
        g.arc(c, c, haloR, 0, Math.PI * 2);
        g.fill();
    });

    // The ball: a sphere with a highlight
    const bodySize = r * 2 + 2;
    const body = makeSprite(bodySize, bodySize, g => {
        const c = bodySize / 2;
        const gr = g.createRadialGradient(c - r * 0.35, c - r * 0.35, 1, c, c, r);
        gr.addColorStop(0, '#ffffff');
        gr.addColorStop(0.35, look.mid);
        gr.addColorStop(1, look.edge);
        g.fillStyle = gr;
        g.beginPath();
        g.arc(c, c, r, 0, Math.PI * 2);
        g.fill();
    });

    ballSprites[name] = { blob, halo, body, haloSize, bodySize };
    return ballSprites[name];
}

function drawBall() {
    const name = fireTimer > 0 ? 'fire' : guidedTimer > 0 ? 'guided' : 'normal';
    const look = BALL_LOOKS[name];
    const sp = ballSpriteSet(name);
    for (const b of balls) {
        if (b.stuck) drawStuckAim(b);
        if (guidedTimer > 0 && b.aim) {
            if (b.aim.boss) {
                if (boss && boss.hp > 0) {
                    const core = bossCore();
                    drawReticleAt(core.x, core.y);
                }
            } else if (b.aim.c !== undefined && bricks[b.aim.c][b.aim.r].alive) {
                const t = bricks[b.aim.c][b.aim.r];
                drawReticleAt(t.x + t.w / 2, t.y + t.h / 2);
            }
        }
        // Glowing trail: additive blending so overlapping ghosts brighten into a comet tail
        if (b.trail && b.trail.length) {
            ctx.save();
            ctx.globalCompositeOperation = 'lighter';
            for (let t = 0; t < b.trail.length; t++) {
                const tr = b.trail[t];
                const ratio = (t + 1) / b.trail.length;
                const rad = b.r * (0.4 + look.trailGrow * ratio);
                ctx.globalAlpha = look.trailA * ratio;
                ctx.drawImage(sp.blob, tr.x - rad, tr.y - rad, rad * 2, rad * 2);
            }
            ctx.restore();
        }
        ctx.drawImage(sp.halo, b.x - sp.haloSize / 2, b.y - sp.haloSize / 2);
        ctx.drawImage(sp.body, b.x - sp.bodySize / 2, b.y - sp.bodySize / 2);
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
    if (shield <= 0) return;
    // Shields compound: the line reads thicker and brighter the more misses are banked
    const stacks = Math.min(shield, SHIELD_MAX);
    ctx.save();
    ctx.strokeStyle = '#33ddff';
    ctx.globalAlpha = 0.7 + 0.3 * Math.sin(performance.now() / 150);
    ctx.beginPath();
    ctx.moveTo(0, CANVAS_H - 2);
    ctx.lineTo(CANVAS_W, CANVAS_H - 2);
    ctx.lineWidth = 3 + (stacks - 1);
    ctx.stroke();
    ctx.globalAlpha *= 0.3; // wide faint stroke as the glow
    ctx.lineWidth = 9 + (stacks - 1) * 2;
    ctx.stroke();
    ctx.restore();
    if (shield > 1) {
        ctx.save();
        ctx.font = 'bold 12px sans-serif';
        ctx.textAlign = 'center';
        ctx.fillStyle = '#dffcff';
        ctx.shadowColor = '#33ddff';
        ctx.shadowBlur = 4;
        ctx.fillText('×' + shield, CANVAS_W / 2, CANVAS_H - 8);
        ctx.restore();
    }
}

// --- Brick sprites ---
// A brick's beveled look (fill, four bevel polygons, sheen, outline, steel border, TNT stripes and
// label) is drawn once into a small offscreen canvas per look and reused with drawImage. Drawing ~10
// paths per brick per frame added up on phones. A crack is baked into its own sprite when it happens.
// Only the genuinely animated bits (TNT pulse, impact flash) are drawn live.
function makeSprite(w, h, paint) {
    const sprite = document.createElement('canvas');
    sprite.width = w;
    sprite.height = h;
    paint(sprite.getContext('2d'));
    return sprite;
}

function paintBrick(g, color, steel, tnt) {
    const w = BRICK_W;
    const h = BRICK_H;
    const bev = 3; // bevel thickness
    g.fillStyle = color;
    g.fillRect(0, 0, w, h);
    // Beveled edges: light from the top-left, shadow on the bottom-right
    fillPoly(g, [[0, 0], [w, 0], [w - bev, bev], [bev, bev]], 'rgba(255, 255, 255, 0.38)');
    fillPoly(g, [[0, 0], [bev, bev], [bev, h - bev], [0, h]], 'rgba(255, 255, 255, 0.2)');
    fillPoly(g, [[0, h], [bev, h - bev], [w - bev, h - bev], [w, h]], 'rgba(0, 0, 0, 0.38)');
    fillPoly(g, [[w, 0], [w, h], [w - bev, h - bev], [w - bev, bev]], 'rgba(0, 0, 0, 0.25)');
    // Soft sheen on the upper half of the face
    g.fillStyle = 'rgba(255, 255, 255, 0.08)';
    g.fillRect(bev, bev, w - 2 * bev, (h - 2 * bev) / 2);
    g.strokeStyle = 'rgba(0, 0, 0, 0.45)';
    g.lineWidth = 1;
    g.strokeRect(0.5, 0.5, w - 1, h - 1);

    if (steel) {
        // Steel brick metallic border
        g.strokeStyle = '#B0C4DE';
        g.lineWidth = 1.5;
        g.strokeRect(2, 2, w - 4, h - 4);
    }
    if (tnt) {
        // Hazard stripes and a label so it reads as a bomb
        for (let sx = 4; sx < w - 8; sx += 14) {
            fillPoly(g, [[sx, h - bev], [sx + 6, h - bev], [sx + 10, bev], [sx + 4, bev]], 'rgba(255, 210, 0, 0.28)');
        }
        g.font = 'bold 12px sans-serif';
        g.textAlign = 'center';
        g.textBaseline = 'middle';
        g.fillStyle = '#ffe14d';
        g.fillText('TNT', w / 2, h / 2 + 1);
    }
}

const brickSprites = {};
function brickSprite(brick) {
    const key = brick.tnt ? 'tnt' : brick.color + (brick.steel ? '|steel' : '');
    if (!brickSprites[key]) {
        brickSprites[key] = makeSprite(BRICK_W, BRICK_H, g => paintBrick(g, brick.tnt ? TNT_COLOR : brick.color, brick.steel, brick.tnt));
    }
    return brickSprites[key];
}

// A crack: a dented spot where the ball struck, then each fissure as a dark groove with a bright lip
function paintCrack(g, crack) {
    const dent = g.createRadialGradient(crack.ox, crack.oy, 0, crack.ox, crack.oy, 10);
    dent.addColorStop(0, 'rgba(15, 20, 25, 0.6)');
    dent.addColorStop(1, 'rgba(15, 20, 25, 0)');
    g.fillStyle = dent;
    g.fillRect(0, 0, BRICK_W, BRICK_H);

    g.lineJoin = 'round';
    g.lineCap = 'round';
    const passes = [
        { off: 0.9, style: 'rgba(0, 0, 0, 0.7)', width: 2.6 },
        { off: 0, style: 'rgba(255, 255, 255, 0.92)', width: 1.2 }
    ];
    for (const pass of passes) {
        g.strokeStyle = pass.style;
        g.lineWidth = pass.width;
        g.beginPath();
        for (const line of crack.lines) {
            g.moveTo(line[0][0] + pass.off, line[0][1] + pass.off);
            for (let i = 1; i < line.length; i++) {
                g.lineTo(line[i][0] + pass.off, line[i][1] + pass.off);
            }
        }
        g.stroke();
    }
}

// Called once when a steel brick cracks: bake the cracked look into that brick's own sprite
function bakeCrack(brick) {
    brick.sprite = makeSprite(BRICK_W, BRICK_H, g => {
        g.drawImage(brickSprite(brick), 0, 0);
        paintCrack(g, brick.crack);
    });
}

function drawBricks() {
    const pulse = 'rgba(255, 90, 0, ' + (0.15 + 0.15 * Math.sin(performance.now() / 180)) + ')';
    for (let c = 0; c < BRICK_COLS; c++) {
        for (let r = 0; r < BRICK_ROWS; r++) {
            const brick = bricks[c][r];
            if (!brick.alive) continue;
            const { x, y, w, h } = brick;
            ctx.drawImage(brick.sprite || brickSprite(brick), x, y);

            if (brick.tnt) {
                // Pulsing glow so TNT reads as live
                ctx.fillStyle = pulse;
                ctx.fillRect(x + 3, y + 3, w - 6, h - 6);
            }
            // Brief white flash on impact (a steel brick cracking)
            if (brick.flash > 0) {
                ctx.fillStyle = 'rgba(255, 255, 255, ' + (brick.flash / 6) * 0.6 + ')';
                ctx.fillRect(x, y, w, h);
                brick.flash--;
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
    if (shield > 0) chips.push({ text: 'SHIELD ×' + shield, color: '#33ddff' });
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
    setText('lives', 'Lives: ' + '●'.repeat(Math.max(0, lives)));
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
    if (isMuted || reduceMotion || document.hidden) return;
    // Chrome ignores (and logs a warning for) vibrate() before the user has interacted with the page
    if (navigator.userActivation && !navigator.userActivation.hasBeenActive) return;
    const now = performance.now();
    if (!strong && now - lastHapticAt < MIN_HAPTIC_GAP_MS) return;
    lastHapticAt = now;
    if (navigator.vibrate) {
        try {
            navigator.vibrate(pattern);
        } catch (e) {
            // Vibration not available; ignore
        }
    } else {
        iosHapticTick(); // iOS Safari has no navigator.vibrate at all; see iosHapticTick()
    }
}

// iOS Safari has never implemented navigator.vibrate(). Toggling a native <input type="checkbox" switch>
// (the iOS 17.4+ "switch" control, https://www.npmjs.com/package/ios-vibrator-pro-max) fires the OS's
// switch-flip haptic tick, the closest thing to vibrate() iOS exposes to the web. It is one short, fixed
// tap only (no custom patterns or durations) and is silently a no-op on every other browser.
let iosHapticEl = null;
function ensureIosHapticEl() {
    if (iosHapticEl || typeof document === 'undefined' || !document.body) return iosHapticEl;
    const label = document.createElement('label');
    label.style.cssText = 'position:fixed; left:-9999px; top:-9999px; width:1px; height:1px; overflow:hidden;';
    const input = document.createElement('input');
    input.type = 'checkbox';
    input.setAttribute('switch', '');
    input.tabIndex = -1;
    input.setAttribute('aria-hidden', 'true');
    label.appendChild(input);
    document.body.appendChild(label);
    iosHapticEl = input;
    return iosHapticEl;
}
function iosHapticTick() {
    try {
        const el = ensureIosHapticEl();
        if (el) el.click();
    } catch (e) {
        // Not supported on this browser; ignore
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
const SHIELD_MAX = 5; // shields compound: each catch banks one more free miss, up to this cap
const STICKY_MAX_FRAMES = 180; // a stuck ball auto-releases after 3s so it can never soft-lock the game
let powerups = [];
let slowTimer = 0;
let wideTimer = 0;
let doubleTimer = 0;       // seconds of 2x score left
let fireTimer = 0;         // seconds of fire ball left: pierces every brick, never bounces off them
let guidedTimer = 0;       // seconds of guided ball left: aims for the highest-damage shot
let stickyCatches = 0;     // the next N paddle catches stick to the paddle until released
let blasts = [];           // expanding shockwave rings from explosions (decoration)
let shield = 0;            // banked free misses: a falling ball bounces off the bottom edge instead of costing a life
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
    // Weighted pick among the powerups unlocked by this level
    const pool = POWERUP_TYPES.filter(p => level >= (POWERUP_UNLOCK[p.type] || 1));
    let roll = Math.random() * pool.reduce((sum, p) => sum + p.weight, 0);
    let t = pool[pool.length - 1];
    for (const p of pool) {
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
        shield = Math.min(shield + 1, SHIELD_MAX); // shields compound: catching another banks one more
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
        p.y += p.vy * timeScale;
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

function punchHole(worldX, seconds = HOLE_SECONDS) {
    const lx = Math.max(HOLE_W / 2, Math.min(paddle.w - HOLE_W / 2, worldX - paddle.x)); // hole stays inside the paddle
    const near = paddleHoles.find(h => Math.abs(h.x - lx) < HOLE_W * 0.6);
    if (near) {
        near.life = Math.max(near.life, seconds); // hitting an existing hole just refreshes it
    } else {
        paddleHoles.push({ x: lx, w: HOLE_W, life: seconds });
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

function alienMax(l = level) {
    return Math.min(1 + Math.floor((l - 1) / 5), 3);
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
    if (!boss) addPopup(CANVAS_W / 2, 46, 'ALIEN INCOMING!', ALIEN_COLOR, { size: 24, life: 1.4, rise: 0.2, pop: true }); // (a boss's summons need no banner over its health bar)
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
    alienKillBonus();
}

// A downed alien has a 50% chance of something fun happening right on the spot: either a warp rift opens,
// or one of the timed weird events (upside down, reversed controls, full flip, time warp) kicks off
// immediately, picked at random between whichever of the two are currently possible. The chaos event is a
// bonus and does not spend the level's own chaos budget (see the matching chaosEventsLeft++ below).
function alienKillBonus() {
    if (Math.random() >= WARP_ON_ALIEN_KILL_CHANCE) return;
    const canWarp = canSpawnWarp();
    const canChaos = chaosPool().length > 0 && !chaos.type && chaos.warn === 0;
    if (canWarp && (!canChaos || Math.random() < 0.5)) {
        spawnWarpRift();
        warpTimer = warpInterval();
    } else if (canChaos) {
        chaosEventsLeft++;
        startChaosWarning();
    }
}

function updateAliens() {
    // Holes repair themselves
    for (let i = paddleHoles.length - 1; i >= 0; i--) {
        paddleHoles[i].life -= 1 / 60;
        if (paddleHoles[i].life <= 0) paddleHoles.splice(i, 1);
    }

    // Random arrivals (not when the level is nearly cleared)
    if (plan.aliens && aliens.length < plan.aliens.max && bricksLeft > 3 && --alienTimer <= 0) {
        spawnAlien();
        alienTimer = alienInterval();
    }

    for (let i = aliens.length - 1; i >= 0; i--) {
        const a = aliens[i];
        a.t++;
        a.x += a.vx * timeScale;
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
        b.x += b.vx * timeScale;
        b.y += b.vy * timeScale;
        // A ball destroys bolts
        if (balls.some(ball => Math.hypot(ball.x - b.x, ball.y - b.y) < ball.r + 4)) {
            spawnParticles(b.x, b.y, ALIEN_COLOR, 6);
            beep(900, 'shot');
            alienBullets.splice(i, 1);
            continue;
        }
        // Any bolt crossing a supply crate breaks it (the boss shooting down its own supplies)
        const hitCrate = crates.find(cr => cr.alive && b.x >= cr.x - 3 && b.x <= cr.x + cr.w + 3 && b.y >= cr.y - 3 && b.y <= cr.y + cr.h + 3);
        if (hitCrate) {
            breakCrate(hitCrate);
            spawnParticles(b.x, b.y, ALIEN_COLOR, 6);
            alienBullets.splice(i, 1);
            continue;
        }
        // Hits solid paddle (a bolt over an existing hole just passes through)
        if (b.y + 6 >= paddle.y && b.y - 6 <= paddle.y + paddle.h && paddleSegments().some(([s0, s1]) => b.x >= s0 && b.x <= s1)) {
            punchHole(b.x, b.hole || HOLE_SECONDS);
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
// Each animation frame x colour is drawn once into a small sprite (the sprite is 60+ cell fills)
const alienSprites = {};
function alienSprite(frame, color) {
    const key = frame + color;
    if (!alienSprites[key]) {
        alienSprites[key] = makeSprite(11 * 3, 8 * 3, g => {
            g.fillStyle = color;
            const sprite = ALIEN_SPRITES[frame];
            for (let r = 0; r < 8; r++) {
                for (let c = 0; c < 11; c++) {
                    if (sprite[r][c] === '1') g.fillRect(c * 3, r * 3, 3, 3);
                }
            }
        });
    }
    return alienSprites[key];
}

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

        const color = a.flash > 0 ? '#ffffff' : (charging && Math.floor(a.t / 3) % 2 === 0 ? '#ff5a5a' : ALIEN_COLOR);
        ctx.drawImage(alienSprite(Math.floor(a.t / 14) % 2, color), sx, sy);
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

let paddleGradient = null;
function drawPaddle() {
    ctx.save();
    for (const [a, b] of paddleSegments()) {
        ctx.globalAlpha = 0.25; // glow underlay
        ctx.fillStyle = '#0095DD';
        roundRectPath(a - 3, paddle.y - 3, b - a + 6, paddle.h + 6, 8);
        ctx.fill();
        ctx.globalAlpha = 1;
        if (!paddleGradient) { // the paddle's y never changes, so one gradient serves every frame
            paddleGradient = ctx.createLinearGradient(0, paddle.y, 0, paddle.y + paddle.h);
            paddleGradient.addColorStop(0, '#6fd6ff');
            paddleGradient.addColorStop(1, '#0070b0');
        }
        ctx.fillStyle = paddleGradient;
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
                        bakeCrack(brick);
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
                        completeLevel();
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
        wall.x += wall.vx * timeScale;
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

        if (b.rallyT <= RALLY_WINDOW_FRAMES) b.rallyT++; // a rally that's timed out just stays timed out

        // Update ball trail (store previous positions)
        if (!b.trail) b.trail = [];
        b.trail.push({ x: b.x, y: b.y });
        if (b.trail.length > 12) {
            b.trail.shift();
        }

        if (guidedTimer > 0) steerGuided(b);
        b.x += b.vx * timeScale; // Time Warp: the world moves faster/slower, your paddle does not
        b.y += b.vy * timeScale;

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
        let touchingWall = null;
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
                // Effects only on new contact; a wall carrying the ball, or already-touched-this-frame,
                // stays "in contact" (tracks WHICH wall so two walls close together are told apart)
                if (b.onWallRef !== wall) {
                    beep(580, 'wall');
                    spawnParticles(b.x, b.y, '#00ffff', 5);
                    registerRallyTouch(b, wall);
                    wall.hits++;
                    // The first hit just bounces; from the second hit on, a wall can drop a powerup too
                    if (wall.hits > 1 && Math.random() < POWERUP_CHANCE) {
                        spawnPowerup(b.x, b.y);
                    }
                }
                touchingWall = wall;
            }
        }
        b.onWallRef = touchingWall;

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
                registerRallyTouch(b, 'paddle');
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
            } else if (b.y + b.r > CANVAS_H && (shield > 0 || (boss && boss.dying > 0))) {
                // Shield: shields compound, so this consumes just one banked miss and any others carry over.
                // (While a boss is blowing up you can't lose a life to it: the edge bounces for free.)
                const free = !!(boss && boss.dying > 0);
                if (!free) shield--;
                b.y = CANVAS_H - b.r;
                b.vy = -Math.abs(b.vy);
                for (let x = 0; x < CANVAS_W; x += 60) spawnParticles(x, CANVAS_H - 2, '#33ddff', 3);
                if (!free) addPopup(b.x, CANVAS_H - 40, shield > 0 ? 'Shield saved you! (' + shield + ' left)' : 'Shield saved you!', '#33ddff', { life: 1.2 });
                addShake(6);
                haptic([20, 40, 20], true);
                tone(300, 0.25, { type: 'sawtooth', vol: 0.2, slideTo: 900 });
            } else if (b.y + b.r > CANVAS_H) {
                // Ball fell past the paddle
                balls.splice(i, 1);
                if (gameState === 'lost') continue; // a second ball falling on the same frame as the last life
                if (balls.length > 0) { // other balls are still in play: just lose this one (a life goes with the LAST ball)
                    addShake(3);
                    haptic(25);
                    continue;
                }
                lives = Math.max(0, lives - 1);
                combo = 0;
                powerups.length = 0;
                clearTimedEffects();
                // Aliens and an active weird event (mirrored view, reversed controls, ...) survive a lost
                // ball: a surprise event is often what causes the ball to be lost in the first place, and
                // cutting it short right then would mean never really getting to react to it
                bossBreather();
                addShake(7);
                haptic(70, true);
                if (lives === 0) {
                    gameState = 'lost';
                    playLoseJingle();
                    haptic(250, true);
                    inputLockUntil = performance.now() + 700;
                    showOverlay('Game over\nTap or press R to play again', 'Play again', buildSummary(false));
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

    // 2f. Weird events and the boss
    updateChaos();
    updateBoss();
    updateCrates();
    updateWarpRift();

    // 3. Brick collisions for each ball
    for (const b of balls) {
        if (gameState !== 'playing') break; // a level clear / game over mid-loop ends this frame's collisions
        if (b.stuck) continue;
        collisionDetection(b);
        if (gameState === 'playing') alienBallCollision(b);
        if (gameState === 'playing') bossBallCollision(b);
        if (gameState === 'playing') crateBallCollision(b);
        if (gameState === 'playing') ghostBallCollision(b);
        if (gameState === 'playing') warpRiftBallCollision(b);
    }
    if (gameState === 'playing') updateGhostGrid();
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

// Time Warp: a warm tint with speed streaks in turbo, a cool tint in slow-mo
function drawTimeWarpFx() {
    if (timeScale === 1) return;
    ctx.save();
    if (timeScale > 1) {
        ctx.fillStyle = 'rgba(255, 110, 30, 0.10)';
        ctx.fillRect(0, 0, CANVAS_W, CANVAS_H);
        ctx.fillStyle = 'rgba(255, 255, 255, 0.16)';
        for (let i = 0; i < 10; i++) ctx.fillRect(Math.random() * CANVAS_W, Math.random() * CANVAS_H, 50 + Math.random() * 90, 1.5);
    } else {
        ctx.fillStyle = 'rgba(70, 130, 255, 0.14)';
        ctx.fillRect(0, 0, CANVAS_W, CANVAS_H);
    }
    ctx.restore();
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
    drawGhostGrid();
    drawCrates();
    drawWarpRift();
    drawMovingWalls();
    drawShield();
    drawBoss();
    drawAliens();
    drawAlienBullets();
    drawBall();
    drawPaddle();
    drawPowerups();
    drawBlasts();
    drawParticles();
    drawPopups();
    ctx.restore();

    drawTimeWarpFx();
    drawStatusChips();
    drawBossBar();
    if (PERF) drawPerf();
    updateHUD();
    updateTouchpad();
}

// --- Rendering Loop (always runs; physics only while playing) ---
let paddleVX = 0;
let paddlePrevX = 0;
// One 60 Hz simulation step
function fixedStep() {
    // Track paddle velocity per step (used for the paddle "throw")
    paddleVX = paddle.x - paddlePrevX;
    paddlePrevX = paddle.x;
    // Continuous paddle keyboard control (works before launch too)
    if (gameState === 'ready' || gameState === 'playing') {
        if (followTarget !== null) { // touch follow mode: slide toward the finger at a capped speed
            const d = followTarget - paddle.x;
            paddle.x = Math.max(0, Math.min(CANVAS_W - paddle.w, paddle.x + Math.max(-FOLLOW_MAX_STEP, Math.min(FOLLOW_MAX_STEP, d))));
        }
        const dir = mapMirror() ? -1 : 1; // reversed controls / a flipped view swap left and right
        if (keys.left) paddle.x = Math.max(0, Math.min(CANVAS_W - paddle.w, paddle.x - 10 * dir));
        if (keys.right) paddle.x = Math.max(0, Math.min(CANVAS_W - paddle.w, paddle.x + 10 * dir));
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
}

// Fixed timestep. All game speeds are per-step, so the simulation must advance at exactly 60 steps
// per second no matter what the display does. Running one step per screen refresh made the game run
// at double speed on 120 Hz screens and in slow motion whenever the refresh rate (variable-refresh
// phones) or the frame rate (a busy device) dropped.
const STEP_MS = 1000 / 60;
const MAX_STEPS_PER_FRAME = 3; // if the device can't keep up, drop the backlog instead of spiralling
let lastFrameTime = 0;
let stepAccumulator = 0;
function gameLoop(now) {
    requestAnimationFrame(gameLoop);
    now = now || performance.now();
    if (PERF) perfFrame(now);
    if (!lastFrameTime) lastFrameTime = now;
    let dt = Math.min(now - lastFrameTime, 100); // a long gap (tab switch) is not a backlog
    lastFrameTime = now;
    // Frame times jitter around 16.7 ms on a 60 Hz display: snap those to exactly one step
    if (Math.abs(dt - STEP_MS) < 2) dt = STEP_MS;
    stepAccumulator += dt; // (Time Warp scales movement per step instead, so it is smooth and the paddle stays responsive)

    let steps = 0;
    while (stepAccumulator >= STEP_MS && steps < MAX_STEPS_PER_FRAME) {
        fixedStep();
        stepAccumulator -= STEP_MS;
        steps++;
    }
    if (steps === MAX_STEPS_PER_FRAME) stepAccumulator = 0;
    // Render once per 60 Hz tick too: on a 90/120 Hz screen the in-between refreshes are skipped, which
    // keeps the particle/popup/shake animations (advanced in render) at the same speed as the simulation
    if (steps > 0) {
        const t0 = PERF ? performance.now() : 0;
        render();
        if (PERF) perfRender(steps, performance.now() - t0);
    }
}

// --- ?perf readout ---
const perf = { last: 0, intervals: [], renderMs: 0, worstRender: 0, maxSteps: 0, dropped: 0 };
function perfFrame(now) {
    if (perf.last) {
        perf.intervals.push(now - perf.last);
        if (perf.intervals.length > 120) perf.intervals.shift();
    }
    perf.last = now;
}
function perfRender(steps, ms) {
    perf.renderMs = perf.renderMs ? perf.renderMs * 0.9 + ms * 0.1 : ms;
    perf.worstRender = Math.max(ms, perf.worstRender * 0.99);
    perf.maxSteps = Math.max(steps, perf.maxSteps * 0.995);
    if (steps >= MAX_STEPS_PER_FRAME) perf.dropped++;
}
function drawPerf() {
    const iv = perf.intervals;
    if (!iv.length) return;
    const sorted = [...iv].sort((a, b) => a - b);
    const median = sorted[Math.floor(sorted.length / 2)];
    const worst = sorted[sorted.length - 1];
    const lines = [
        'display ' + Math.round(1000 / median) + ' Hz   worst frame ' + Math.round(worst) + ' ms   render ' + perf.renderMs.toFixed(1) + ' ms (max ' + perf.worstRender.toFixed(1) + ')',
        'catch-up steps ' + perf.maxSteps.toFixed(1) + '   dropped ' + perf.dropped + '   balls ' + balls.length + '  particles ' + particles.length +
            '  popups ' + popups.length + '  aliens ' + aliens.length + '  bolts ' + alienBullets.length + '  voices ' + activeVoices
    ];
    ctx.save();
    ctx.font = '11px monospace';
    ctx.textAlign = 'right';
    ctx.fillStyle = 'rgba(0, 0, 0, 0.6)';
    ctx.fillRect(CANVAS_W - 560, 4, 556, 36);
    ctx.fillStyle = '#9dffb0';
    ctx.fillText(lines[0], CANVAS_W - 10, 19);
    ctx.fillText(lines[1], CANVAS_W - 10, 34);
    ctx.restore();
}

// --- Event Handlers ---
const keys = {};
// --- Touch controls ---
// Two modes, switched with the button in the HUD and remembered:
//   FOLLOW (default): the paddle follows your finger's horizontal position from ANYWHERE on the screen.
//     Rest your thumb below or beside the game instead of on top of the paddle, and after lifting just
//     touch again anywhere: there is nothing to find. The screen's full width maps to the full paddle
//     range (with a small inset so the edges are reachable), and the paddle slides toward the target at
//     a capped speed instead of teleporting.
//   DRAG: relative drag from wherever the finger lands (works from anywhere too).
let touchMode = 'follow';
let followTarget = null;      // paddle.x that follow mode is sliding toward
const FOLLOW_MAX_STEP = 55;   // canvas px per 60 Hz step
let stageEl = null;
let touchpadDot = null;
let touchpadPct = -1;

function followPaddleTarget(clientX) {
    const inset = 0.04;
    const norm = Math.max(0, Math.min(1, (clientX / window.innerWidth - inset) / (1 - 2 * inset)));
    let centre = norm * CANVAS_W;
    if (mapMirror()) centre = CANVAS_W - centre;
    return Math.max(0, Math.min(CANVAS_W - paddle.w, centre - paddle.w / 2));
}

// Touches on buttons or the overlay belong to them, not to the paddle
function isControlTarget(target) {
    return !!(target && target.closest && target.closest('button, #overlay, a'));
}

// Displayed pixels -> canvas coordinate space, mirrored when the view is flipped or controls are reversed
function canvasX(clientX) {
    if (!stageEl) stageEl = document.getElementById('stage');
    const rect = stageEl.getBoundingClientRect(); // the stage never gets the flip transform the canvas does
    if (rect.width <= 0) return 0;
    const x = (clientX - rect.left) * (canvas.width / rect.width);
    return mapMirror() ? CANVAS_W - x : x;
}

function updateTouchUi() {
    const touch = isTouchDevice();
    document.body.classList.toggle('touch', touch);
    const btn = document.getElementById('touch-btn');
    if (btn) {
        btn.style.display = touch ? 'inline-block' : 'none';
        btn.textContent = touchMode === 'follow' ? '👆 Follow' : '↔ Drag';
        btn.title = touchMode === 'follow'
            ? 'Paddle follows your finger from anywhere. Tap to switch to relative drag.'
            : 'Drag anywhere to nudge the paddle. Tap to switch to follow.';
    }
    const label = document.getElementById('touchpad-label');
    if (label) {
        label.textContent = touchMode === 'follow'
            ? 'Slide your thumb anywhere: the paddle follows'
            : 'Drag anywhere to move the paddle';
    }
    updateLockUi(); // the two buttons are mutually exclusive: only one device type is in play at a time
}

// --- Pointer Lock (mouse only, desktop) ---
// Grabs the OS mouse cursor: the browser reports only relative movement (movementX) instead of an absolute
// position, so the paddle is never limited by screen edges or window size, and moving the mouse fast keeps
// working even past the edge of the monitor. Opt-in (a friend asked for it) since it hides the cursor and
// takes over the mouse, which not everyone wants.
const POINTER_LOCK_SENSITIVITY = 1.6;
let pointerLockWanted = false; // the player turned it on; the browser may still grant/revoke it independently
let pointerLocked = false;     // document.pointerLockElement === canvas, cached on pointerlockchange

function updateLockUi() {
    const btn = document.getElementById('lock-btn');
    if (!btn) return;
    const supported = !!(canvas && canvas.requestPointerLock);
    btn.style.display = supported && !isTouchDevice() ? 'inline-block' : 'none';
    btn.textContent = pointerLocked ? '🔒 Locked' : '🔓 Lock';
    btn.classList.toggle('active', pointerLocked);
    btn.title = pointerLocked
        ? 'Mouse is locked to the game (Esc to release, or click here) (L)'
        : 'Lock the mouse for unlimited-range relative control (L)';
}

function requestLock() {
    if (!canvas || !canvas.requestPointerLock) return;
    pointerLockWanted = true;
    try {
        canvas.requestPointerLock();
    } catch (e) {
        // Refused (e.g. no recent gesture); the button/UI just stays unlocked
    }
}

function releaseLock() {
    pointerLockWanted = false;
    try {
        if (document.exitPointerLock) document.exitPointerLock();
    } catch (e) {
        // Ignore
    }
}

function toggleLock() {
    if (pointerLocked || pointerLockWanted) releaseLock();
    else requestLock();
}

function setTouchMode(mode) {
    touchMode = mode;
    followTarget = null;
    try {
        localStorage.setItem('breakout-touch-mode', mode);
    } catch (e) {
        // Storage unavailable; the choice lasts for this session
    }
    updateTouchUi();
}

function initTouchUi() {
    try {
        if (localStorage.getItem('breakout-touch-mode') === 'drag') touchMode = 'drag';
    } catch (e) {
        // Storage unavailable
    }
    updateTouchUi();
    const btn = document.getElementById('touch-btn');
    if (btn) btn.addEventListener('click', () => setTouchMode(touchMode === 'follow' ? 'drag' : 'follow'));
    // Switching apps or tabs pauses the game rather than dropping the ball
    document.addEventListener('visibilitychange', () => {
        if (document.hidden && gameState === 'playing') togglePause();
    });
}

// The thumb pad's dot shows where your finger maps to on the playfield
function updateTouchpad() {
    if (!document.body.classList.contains('touch')) return;
    if (!touchpadDot) touchpadDot = document.getElementById('touchpad-dot');
    if (!touchpadDot) return;
    let frac = (paddle.x + paddle.w / 2) / CANVAS_W;
    if (mapMirror()) frac = 1 - frac;
    const pct = Math.round(frac * 100);
    if (pct !== touchpadPct) {
        touchpadPct = pct;
        touchpadDot.style.left = pct + '%';
    }
}

function setPaddleX(x) {
    if (gameState !== 'ready' && gameState !== 'playing') return;
    followTarget = null; // a direct move (mouse, relative drag) overrides any follow slide
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
let dragOffset = 0;       // paddle.x minus the finger's canvas x at touch-down (drag mode)
let lastDragClientX = null; // where the dragging finger currently is

function handlePointerDown(e) {
    if (e.pointerType === 'mouse') {
        if (e.target !== canvas) return; // a mouse only steers over the game itself
        if (!pointerLocked) movePaddleTo(e.clientX); // once locked, movement is relative (see handlePointerMove)
        if (pointerLockWanted && !pointerLocked) requestLock(); // this click is the gesture the browser requires
    } else {
        if (dragPointerId !== null) return; // ignore extra fingers
        if (isControlTarget(e.target)) return;
        touchDetected = true;
        dragPointerId = e.pointerId;
        lastDragClientX = e.clientX;
        if (touchMode === 'follow') {
            followTarget = followPaddleTarget(e.clientX);
        } else {
            dragOffset = paddle.x - canvasX(e.clientX);
        }
        try {
            e.target.setPointerCapture(e.pointerId);
        } catch (err) {
            // Capture unsupported; touch pointers are captured implicitly anyway
        }
    }
    isTap = true;
    tapStartX = e.clientX;
    tapStartY = e.clientY;
}

function handlePointerMove(e) {
    if (e.pointerType === 'mouse') {
        if (pointerLocked) {
            // Locked: clientX is frozen, so steer from the relative delta instead (reversed controls / a
            // flipped view swap the direction, same as the keyboard)
            const dir = mapMirror() ? -1 : 1;
            const scale = (canvas.width / canvas.getBoundingClientRect().width) * POINTER_LOCK_SENSITIVITY;
            setPaddleX(paddle.x + (e.movementX || 0) * scale * dir);
            return;
        }
        if (e.target !== canvas) return;
        movePaddleTo(e.clientX);
    } else {
        if (e.pointerId !== dragPointerId) return;
        lastDragClientX = e.clientX;
        if (touchMode === 'follow') {
            followTarget = followPaddleTarget(e.clientX);
        } else {
            setPaddleX(canvasX(e.clientX) + dragOffset);
        }
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
        }
    }
    isTap = false;
}

function togglePause() {
    const pauseBtn = document.getElementById('pause-btn');
    if (gameState === 'playing') {
        gameState = 'paused';
        if (pauseBtn) pauseBtn.textContent = '▶ Resume';
        showOverlay('Paused\nTap or press P to resume', 'Resume');
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
    if (e.key === 'l' || e.key === 'L') {
        // Toggle mouse pointer lock (desktop only; a no-op button is hidden on touch devices)
        toggleLock();
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
        followTarget = null;
    } else if (e.key === 'ArrowRight') {
        keys.right = true;
        followTarget = null;
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
    // Window-level so a finger can steer from anywhere on the screen (a mouse still only steers over the canvas)
    window.addEventListener('pointerdown', handlePointerDown);
    window.addEventListener('pointermove', handlePointerMove);
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
        updateTouchUi();
        const msg = document.getElementById('overlay-message');
        if (gameState === 'ready' && msg && msg.textContent.includes('SPACE')) {
            setOverlayMessage(getLaunchMessage(false));
        }
    }, { once: true, passive: true });
    
    initTouchUi();
    initPointerLock();

    // Start the always-running render loop
    requestAnimationFrame(gameLoop);
});

function initPointerLock() {
    const btn = document.getElementById('lock-btn');
    if (btn) btn.addEventListener('click', toggleLock);
    document.addEventListener('pointerlockchange', () => {
        pointerLocked = document.pointerLockElement === canvas;
        updateLockUi();
    });
    document.addEventListener('pointerlockerror', () => {
        pointerLocked = false;
        pointerLockWanted = false;
        updateLockUi();
    });
    updateLockUi();
}