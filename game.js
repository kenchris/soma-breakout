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
let runStats = { maxCombo: 0, bricks: 0 };
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
            ['Bricks broken', runStats.bricks]
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
            if (docEl.requestFullscreen) {
                await docEl.requestFullscreen();
            } else if (docEl.webkitRequestFullscreen) {
                await docEl.webkitRequestFullscreen();
            }
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
    runStats = { maxCombo: 0, bricks: 0 };
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
    levelBricksTotal = bricksLeft;

    movingWalls = buildWalls();
    buildBackground();
}

function makeBall(x, y, vx, vy) {
    return { x, y, r: BALL_RADIUS, vx, vy, trail: [] };
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
function drawBall() {
    for (const b of balls) {
        // Glowing trail: additive blending so overlapping ghosts brighten into a comet tail
        if (b.trail && b.trail.length) {
            ctx.save();
            ctx.globalCompositeOperation = 'lighter';
            for (let t = 0; t < b.trail.length; t++) {
                const tr = b.trail[t];
                const ratio = (t + 1) / b.trail.length;
                const rad = b.r * (0.4 + 0.9 * ratio);
                const g = ctx.createRadialGradient(tr.x, tr.y, 0, tr.x, tr.y, rad);
                g.addColorStop(0, 'rgba(255, 150, 70, ' + (0.32 * ratio) + ')');
                g.addColorStop(1, 'rgba(255, 60, 60, 0)');
                ctx.fillStyle = g;
                ctx.beginPath();
                ctx.arc(tr.x, tr.y, rad, 0, Math.PI * 2);
                ctx.fill();
            }
            ctx.restore();
        }

        // Main ball: glowing sphere with a highlight
        ctx.save();
        ctx.shadowColor = '#ff4d4d';
        ctx.shadowBlur = 16;
        const g = ctx.createRadialGradient(b.x - b.r * 0.35, b.y - b.r * 0.35, 1, b.x, b.y, b.r);
        g.addColorStop(0, '#ffffff');
        g.addColorStop(0.35, '#ff6b6b');
        g.addColorStop(1, '#d40000');
        ctx.fillStyle = g;
        ctx.beginPath();
        ctx.arc(b.x, b.y, b.r, 0, Math.PI * 2);
        ctx.fill();
        ctx.restore();
    }
}

function drawPaddle() {
    ctx.save();
    ctx.shadowColor = '#0095DD';
    ctx.shadowBlur = 12;
    const g = ctx.createLinearGradient(0, paddle.y, 0, paddle.y + paddle.h);
    g.addColorStop(0, '#6fd6ff');
    g.addColorStop(1, '#0070b0');
    ctx.fillStyle = g;
    roundRectPath(paddle.x, paddle.y, paddle.w, paddle.h, 6);
    ctx.fill();
    ctx.restore();
}

function drawMovingWalls() {
    for (const wall of movingWalls) {
        ctx.save();
        ctx.fillStyle = "#00ffff";
        ctx.shadowColor = "#00e5ff";
        ctx.shadowBlur = 8;
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
    ctx.lineWidth = 3;
    ctx.shadowColor = '#33ddff';
    ctx.shadowBlur = 14;
    ctx.globalAlpha = 0.7 + 0.3 * Math.sin(performance.now() / 150);
    ctx.beginPath();
    ctx.moveTo(0, CANVAS_H - 2);
    ctx.lineTo(CANVAS_W, CANVAS_H - 2);
    ctx.stroke();
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

                // If cracked (took 1 hit), draw crack marks
                if (brick.hitsLeft === 1) {
                    ctx.strokeStyle = "#FFFFFF";
                    ctx.lineWidth = 1.8;
                    ctx.beginPath();
                    ctx.moveTo(x + w * 0.25, y + 3);
                    ctx.lineTo(x + w * 0.45, y + h * 0.55);
                    ctx.lineTo(x + w * 0.38, y + h - 3);
                    ctx.moveTo(x + w * 0.45, y + h * 0.55);
                    ctx.lineTo(x + w * 0.72, y + h * 0.4);
                    ctx.stroke();
                }
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
        tone(523, 0.12, { type: 'triangle', vol: 0.2 });
        tone(659, 0.12, { type: 'triangle', vol: 0.2, delay: 0.09 });
        tone(784, 0.12, { type: 'triangle', vol: 0.2, delay: 0.18 });
        tone(1047, 0.25, { type: 'triangle', vol: 0.2, delay: 0.27 });
    }
}

// --- Sound ---
let audioCtx = null;
function toggleMute() {
    isMuted = !isMuted;
    const btn = document.getElementById('mute-btn');
    if (btn) {
        btn.textContent = isMuted ? '🔇 Muted' : '🔊 Sound';
        btn.title = isMuted ? 'Unmute sound (M)' : 'Mute sound (M)';
    }
}

// Generic one-shot tone: optional pitch slide and start delay (seconds)
function tone(freq, dur, { type = 'square', vol = 0.15, slideTo = null, delay = 0 } = {}) {
    if (isMuted) return;
    try {
        if (!audioCtx) audioCtx = new AudioContext();
        const t0 = audioCtx.currentTime + delay;
        const osc = audioCtx.createOscillator();
        const gain = audioCtx.createGain();
        osc.type = type;
        osc.frequency.setValueAtTime(freq, t0);
        if (slideTo) osc.frequency.exponentialRampToValueAtTime(slideTo, t0 + dur);
        gain.gain.setValueAtTime(vol, t0);
        gain.gain.exponentialRampToValueAtTime(0.001, t0 + dur);
        osc.connect(gain);
        gain.connect(audioCtx.destination);
        osc.start(t0);
        osc.stop(t0 + dur);
    } catch (e) {
        // Audio not available; ignore
    }
}

function beep(freq = 440) {
    if (isMuted) return;
    try {
        if (!audioCtx) audioCtx = new AudioContext();
        const osc = audioCtx.createOscillator();
        const gain = audioCtx.createGain();
        osc.type = 'square';
        osc.frequency.value = freq;
        gain.gain.setValueAtTime(0.15, audioCtx.currentTime);
        gain.gain.exponentialRampToValueAtTime(0.001, audioCtx.currentTime + 0.08);
        osc.connect(gain);
        gain.connect(audioCtx.destination);
        osc.start();
        osc.stop(audioCtx.currentTime + 0.08);
    } catch (e) {
        // Audio not available; ignore
    }
}

// Short metallic clink when hitting steel brick
function clink() {
    if (isMuted) return;
    try {
        if (!audioCtx) audioCtx = new AudioContext();
        const osc = audioCtx.createOscillator();
        const gain = audioCtx.createGain();
        osc.type = 'triangle';
        osc.frequency.setValueAtTime(1100, audioCtx.currentTime);
        osc.frequency.exponentialRampToValueAtTime(600, audioCtx.currentTime + 0.06);
        gain.gain.setValueAtTime(0.2, audioCtx.currentTime);
        gain.gain.exponentialRampToValueAtTime(0.001, audioCtx.currentTime + 0.07);
        osc.connect(gain);
        gain.connect(audioCtx.destination);
        osc.start();
        osc.stop(audioCtx.currentTime + 0.07);
    } catch (e) {
        // Audio not available; ignore
    }
}

// Short explosion boom (low, thuddy)
function boom() {
    if (isMuted) return;
    try {
        if (!audioCtx) audioCtx = new AudioContext();
        const osc = audioCtx.createOscillator();
        const gain = audioCtx.createGain();
        osc.type = 'sawtooth';
        osc.frequency.setValueAtTime(90, audioCtx.currentTime);
        osc.frequency.exponentialRampToValueAtTime(30, audioCtx.currentTime + 0.2);
        gain.gain.setValueAtTime(0.3, audioCtx.currentTime);
        gain.gain.exponentialRampToValueAtTime(0.001, audioCtx.currentTime + 0.25);
        osc.connect(gain);
        gain.connect(audioCtx.destination);
        osc.start();
        osc.stop(audioCtx.currentTime + 0.25);
    } catch (e) {
        // Audio not available; ignore
    }
}

// Win jingle: cheerful rising arpeggio
function playWinJingle() {
    if (isMuted) return;
    try {
        if (!audioCtx) audioCtx = new AudioContext();
        const notes = [523.25, 659.25, 783.99, 1046.50]; // C5, E5, G5, C6
        const now = audioCtx.currentTime;
        notes.forEach((freq, idx) => {
            const osc = audioCtx.createOscillator();
            const gain = audioCtx.createGain();
            osc.type = 'sine';
            osc.frequency.value = freq;
            const startTime = now + idx * 0.1;
            gain.gain.setValueAtTime(0.2, startTime);
            gain.gain.exponentialRampToValueAtTime(0.001, startTime + 0.25);
            osc.connect(gain);
            gain.connect(audioCtx.destination);
            osc.start(startTime);
            osc.stop(startTime + 0.25);
        });
    } catch (e) {
        // Audio not available; ignore
    }
}

// Lose jingle: descending sad tones
function playLoseJingle() {
    if (isMuted) return;
    try {
        if (!audioCtx) audioCtx = new AudioContext();
        const notes = [392.00, 349.23, 311.13, 261.63]; // G4, F4, Eb4, C4
        const now = audioCtx.currentTime;
        notes.forEach((freq, idx) => {
            const osc = audioCtx.createOscillator();
            const gain = audioCtx.createGain();
            osc.type = 'sawtooth';
            osc.frequency.value = freq;
            const startTime = now + idx * 0.15;
            gain.gain.setValueAtTime(0.18, startTime);
            gain.gain.exponentialRampToValueAtTime(0.001, startTime + 0.3);
            osc.connect(gain);
            gain.connect(audioCtx.destination);
            osc.start(startTime);
            osc.stop(startTime + 0.3);
        });
    } catch (e) {
        // Audio not available; ignore
    }
}

function spawnParticles(x, y, color) {
    for (let i = 0; i < 12; i++) {
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
const POWERUP_TYPES = [
    { type: 'life', label: '+', color: '#33cc33', text: '+1 Life' },
    { type: 'slow', label: 'S', color: '#cc33cc', text: 'Slow Ball' },
    { type: 'wide', label: 'W', color: '#ff9900', text: 'Wide Paddle' },
    { type: 'explosive', label: 'E', color: '#ff3366', text: 'Explosive!' },
    { type: 'multi', label: 'M', color: '#3399ff', text: 'Multi-Ball!' },
    { type: 'double', label: '2×', color: '#c98f00', text: '2× Score!' },
    { type: 'shield', label: null, color: '#22bbdd', text: 'Shield!' } // label null: drawn as a shield icon
];
let powerups = [];
let slowTimer = 0;
let wideTimer = 0;
let doubleTimer = 0;       // seconds of 2x score left
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
    explosiveReady = false;
    multiReady = false;
    paddle.w = PADDLE_W;
}

function addShake(amount) {
    if (reduceMotion) return;
    shake = Math.min(shake + amount, 16);
}

function addPopup(x, y, text, color, { life = 1, size = 16, rise = 1.5, pop = false } = {}) {
    popups.push({ x, y, text, color, life, maxLife: life, size, rise, pop });
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
}

function spawnPowerup(x, y) {
    const t = POWERUP_TYPES[Math.floor(Math.random() * POWERUP_TYPES.length)];
    powerups.push({ x: x, y: y, type: t.type, label: t.label, color: t.color, vy: 2.5 });
}

function applyPowerup(type) {
    const def = POWERUP_TYPES.find(p => p.type === type);
    addPopup(paddle.x + paddle.w / 2, paddle.y - 10, def.text, def.color, { life: 1.2 });

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
    }
}

function updatePowerups() {
    for (let i = powerups.length - 1; i >= 0; i--) {
        const p = powerups[i];
        p.y += p.vy;
        // Circle-vs-AABB catch test against the paddle
        const cx = Math.max(paddle.x, Math.min(p.x, paddle.x + paddle.w));
        const cy = Math.max(paddle.y, Math.min(p.y, paddle.y + paddle.h));
        const dx = p.x - cx;
        const dy = p.y - cy;
        if (dx * dx + dy * dy < 12 * 12) {
            applyPowerup(p.type);
            spawnParticles(p.x, p.y, p.color);
            beep();
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
        ctx.shadowColor = p.color;
        ctx.shadowBlur = 10;
        ctx.beginPath();
        ctx.arc(p.x, p.y, 10, 0, Math.PI * 2);
        ctx.fillStyle = p.color;
        ctx.fill();
        ctx.shadowBlur = 0;
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
function collisionDetection(b) {
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

                    // If it's a steel brick with 2 hits left and NOT hit by explosive burst:
                    // First hit cracks it, does not destroy it, awards 0 points
                    if (brick.steel && brick.hitsLeft > 1 && !wasExplosive) {
                        brick.hitsLeft--;
                        clink();
                        addShake(2);
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

                    // Brick destruction (either 1-hit brick, cracked steel brick second hit, or explosive)
                    let targets = [[c, r]];
                    if (wasExplosive) {
                        for (let cc = c - 1; cc <= c + 1; cc++) {
                            for (let rr = r - 1; rr <= r + 1; rr++) {
                                if (cc >= 0 && cc < BRICK_COLS && rr >= 0 && rr < BRICK_ROWS) {
                                    targets.push([cc, rr]);
                                }
                            }
                        }
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
                    bricksLeft -= destroyed;
                    runStats.bricks += destroyed;
                    addScore(totalEarned);

                    // Floating score popup at the break point
                    const tags = [];
                    if (wasExplosive) tags.push('boom');
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

                    // Screen shake: light per brick (heavier deeper in a combo), big for explosions
                    addShake(wasExplosive ? 12 : brick.steel ? 3 : 1.5 + mult * 0.4);

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

                    if (wasExplosive) {
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

        // Update ball trail (store previous positions)
        if (!b.trail) b.trail = [];
        b.trail.push({ x: b.x, y: b.y });
        if (b.trail.length > 12) {
            b.trail.shift();
        }

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
        for (const wall of movingWalls) {
            const cx = Math.max(wall.x, Math.min(b.x, wall.x + wall.w));
            const cy = Math.max(wall.y, Math.min(b.y, wall.y + wall.h));
            const dx = b.x - cx;
            const dy = b.y - cy;
            if (dx * dx + dy * dy < b.r * b.r) {
                // Rebound off moving wall
                if (Math.abs(dx) > Math.abs(dy)) {
                    b.vx = (dx > 0 ? 1 : -1) * Math.abs(b.vx);
                } else {
                    b.vy = (dy > 0 ? 1 : -1) * Math.abs(b.vy);
                }
                beep(580);
                spawnParticles(b.x, b.y, '#00ffff');
            }
        }

        // 2b. Paddle bounce: circle vs AABB test, only while moving down
        if (b.vy > 0) {
            const cx = Math.max(paddle.x, Math.min(b.x, paddle.x + paddle.w));
            const cy = Math.max(paddle.y, Math.min(b.y, paddle.y + paddle.h));
            const dx = b.x - cx;
            const dy = b.y - cy;
            if (dx * dx + dy * dy < b.r * b.r) {
                // Snap the ball to the top of the paddle
                b.y = paddle.y - b.r;
                // Classic paddle bounce logic (steer)
                let hitRatio = (b.x - (paddle.x + paddle.w / 2)) / (paddle.w / 2);
                hitRatio = Math.max(-1, Math.min(1, hitRatio));
                const bSpeed = currentSpeed();
                let newVX = hitRatio * bSpeed * 0.866;
                let newVY = -Math.sqrt(bSpeed * bSpeed - newVX * newVX);
                b.vx = newVX;
                b.vy = newVY;
                if (paddleVX !== 0) {
                    b.vx += paddleVX * 0.4;
                    const mag = Math.hypot(b.vx, b.vy);
                    const maxSpeed = currentSpeed() * 1.6;
                    if (mag > maxSpeed) {
                        const f = maxSpeed / mag;
                        b.vx *= f;
                        b.vy *= f;
                    }
                }
                beep(660);
                combo = 0;
                // Multi-ball split: the "multi" powerup causes this ball to split on the next paddle bounce
                if (multiReady) {
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
                for (let x = 0; x < CANVAS_W; x += 45) spawnParticles(x, CANVAS_H - 2, '#33ddff');
                addPopup(b.x, CANVAS_H - 40, 'Shield saved you!', '#33ddff', { life: 1.2 });
                addShake(6);
                tone(300, 0.25, { type: 'sawtooth', vol: 0.2, slideTo: 900 });
            } else if (b.y + b.r > CANVAS_H) {
                // Ball fell past the paddle
                balls.splice(i, 1);
                lives--;
                combo = 0;
                powerups.length = 0;
                clearTimedEffects();
                addShake(7);
                if (lives === 0) {
                    gameState = 'lost';
                    playLoseJingle();
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

    // 2d. Falling powerups
    updatePowerups();

    // 3. Brick collisions for each ball
    for (const b of balls) {
        collisionDetection(b);
    }
}

// Floating score popups: drift upward and fade out
function drawPopups() {
    for (let i = popups.length - 1; i >= 0; i--) {
        const p = popups[i];
        p.y -= 1.5;
        p.life -= 0.02;
        if (p.life <= 0) {
            popups.splice(i, 1);
            continue;
        }
        ctx.save();
        ctx.globalAlpha = Math.max(0, Math.min(1, p.life * 2));
        ctx.fillStyle = p.color || '#ffffff';
        ctx.font = 'bold 16px sans-serif';
        ctx.textAlign = 'center';
        ctx.shadowColor = 'rgba(0, 0, 0, 0.6)';
        ctx.shadowBlur = 4;
        ctx.fillText(p.text, p.x, p.y);
        ctx.restore();
    }
}

function render() {
    // Clear canvas
    ctx.clearRect(0, 0, CANVAS_W, CANVAS_H);

    // Draw elements
    drawBricks();
    drawMovingWall();
    drawBall();
    drawPaddle();
    drawPowerups();
    drawPopups();
    updateHUD();
    drawParticles();
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
    if (gameState === 'playing') {
        update();
    }
    render();
    requestAnimationFrame(gameLoop);
}

// --- Event Handlers ---
const keys = {};
function movePaddleTo(clientX) {
    if (gameState !== 'ready' && gameState !== 'playing') return;
    const rect = canvas.getBoundingClientRect();
    if (rect.width <= 0) return;
    // Scale from displayed size to canvas coordinate space
    const relativeX = (clientX - rect.left) * (canvas.width / rect.width);
    paddle.x = relativeX - paddle.w / 2;
    if (paddle.x < 0) paddle.x = 0;
    if (paddle.x + paddle.w > CANVAS_W) paddle.x = CANVAS_W - paddle.w;
}

// Pointer-based paddle control (mouse + touch unified).
// Tap detection: a pointerdown that moves >12px becomes a drag and stops
// counting as a tap. Single tap = launch (restart on game over), double tap = pause.
let lastTapAt = 0;
let isTap = false;
let tapStartX = 0;
let tapStartY = 0;

function handlePointerDown(e) {
    touchDetected = true;
    isTap = true;
    tapStartX = e.clientX;
    tapStartY = e.clientY;
    movePaddleTo(e.clientX);
}

function handlePointerMove(e) {
    // Increased tolerance to 25px so natural fingertip touch on mobile doesn't cancel tap
    if (isTap && Math.hypot(e.clientX - tapStartX, e.clientY - tapStartY) > 25) {
        isTap = false; // it's a drag now, not a tap
    }
    movePaddleTo(e.clientX);
}

function handlePointerUp() {
    if (isTap) {
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
        if (gameState === 'ready' || gameState === 'won' || gameState === 'lost') {
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
        if (gameState === 'ready' || gameState === 'won') {
            launchGame();
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
    window.addEventListener('pointerup', handlePointerUp);
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