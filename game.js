// --- Game Constants ---
const CANVAS_W = 900;
const CANVAS_H = 600;

// --- Game Entities ---
let canvas, ctx;
let balls, paddle, bricks, score = 0, lives = 3, level = 1;
let gameState = 'ready'; // ready, playing, won, lost
let isMuted = false;
let movingWall = null; // sliding barrier from level 3+
const BRICK_ROWS = 6;
const BRICK_COLS = 12;
const BRICK_W = 64;
const BRICK_H = 20;
const BRICK_OFFSET_TOP = 60;
const BRICK_OFFSET_LEFT = (CANVAS_W - BRICK_COLS * BRICK_W) / 2;
const PADDLE_W = 110;
const PADDLE_H = 12;
const BALL_RADIUS = 8;

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
    
    // Initialize game state with optional URL level parameter
    resetGame(getStartingLevel());
}

function resetGame(startLevel = 1) {
    score = 0;
    lives = 3;
    level = startLevel;
    gameState = 'ready';

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
    slowTimer = 0;
    wideTimer = 0;
    explosiveReady = false;
    combo = 0;
    popups.length = 0;
    paddle.w = PADDLE_W;

    // Show the launch prompt
    const msg = document.getElementById('overlay-message');
    const overlay = document.getElementById('overlay');
    if (msg) msg.textContent = 'Press SPACE to launch';
    if (overlay) overlay.style.display = 'block';
}

function spawnLevel() {
    // Regenerate brick layout based on level
    // Layout patterns:
    // Level 1: Standard solid wall with top row steel
    // Level 2: Checkerboard layout
    // Level 3: Vertical Stripes layout
    // Level 4: Pyramid / Diamond layout
    // Level 5+: Castle / Fortress layout (alternating battlements & pillars)
    const patternType = (level - 1) % 5; // 0: solid, 1: checkerboard, 2: stripes, 3: pyramid, 4: castle

    for (let c = 0; c < BRICK_COLS; c++) {
        for (let r = 0; r < BRICK_ROWS; r++) {
            const brick = bricks[c][r];
            brick.x = (c * BRICK_W) + BRICK_OFFSET_LEFT;
            brick.y = (r * BRICK_H) + BRICK_OFFSET_TOP;

            let alive = true;
            if (patternType === 1) {
                // Checkerboard
                alive = (c + r) % 2 === 0;
            } else if (patternType === 2) {
                // Vertical stripes: pairs of active columns with gaps
                alive = (c % 3 !== 2);
            } else if (patternType === 3) {
                // Pyramid / Diamond
                const centerCol = (BRICK_COLS - 1) / 2;
                const distFromCenter = Math.abs(c - centerCol);
                alive = (distFromCenter <= (r + 1.2));
            } else if (patternType === 4) {
                // Castle: top row battlements (every 2nd brick), rows 1-3 side towers + center gate, bottom rows solid
                if (r === 0) {
                    alive = (c % 2 === 0);
                } else if (r === 1 || r === 2) {
                    alive = (c < 3 || c >= BRICK_COLS - 3 || c === 5 || c === 6);
                } else {
                    alive = true;
                }
            } else {
                // Solid wall (Level 1, 6, etc.)
                alive = true;
            }

            brick.alive = alive;

            // Two-hit "steel" bricks: top row (r === 0) is steel!
            if (r === 0 && alive) {
                brick.steel = true;
                brick.maxHits = 2;
                brick.hitsLeft = 2;
                brick.points = 0; // "no points" per requirements
                brick.color = '#71797E'; // Steel gray
            } else {
                brick.steel = false;
                brick.maxHits = 1;
                brick.hitsLeft = 1;

                // Row-based scoring and coloring
                let rowScore;
                let color;
                switch (r) {
                    case 0: rowScore = 30; color = '#FFD700'; break;
                    case 1: rowScore = 25; color = '#FFA500'; break; // Orange
                    case 2: rowScore = 20; color = '#FF4500'; break; // Orange-Red
                    case 3: rowScore = 15; color = '#FF0000'; break; // Red
                    case 4: rowScore = 10; color = '#8B0000'; break; // Dark Red
                    default: rowScore = 5; color = '#006400'; // Dark Green (Bottom)
                }
                brick.points = rowScore;
                brick.color = color;
            }
        }
    }

    // Moving walls: from level 3+, spawn a sliding horizontal barrier
    if (level >= 3) {
        movingWall = {
            x: CANVAS_W / 2 - 60,
            y: BRICK_OFFSET_TOP + BRICK_ROWS * BRICK_H + 35, // Floats below the brick grid
            w: 120,
            h: 14,
            vx: 2.2 + (level - 3) * 0.4
        };
    } else {
        movingWall = null;
    }
}

function makeBall(x, y, vx, vy) {
    return { x, y, r: BALL_RADIUS, vx, vy, trail: [] };
}

// Ball speed ramps up slightly each level (difficulty increases)
function currentSpeed() {
    return Math.min(5 + (level - 1) * 0.4, 8);
}

// --- Drawing Functions ---
function drawBall() {
    for (const b of balls) {
        // Draw fading ghost circles (ball trail)
        if (b.trail) {
            for (let t = 0; t < b.trail.length; t++) {
                const tr = b.trail[t];
                ctx.save();
                ctx.beginPath();
                // Ghost circles shrink and fade towards the tail
                const ratio = (t + 1) / b.trail.length;
                const trailRadius = b.r * (0.4 + 0.5 * ratio);
                ctx.arc(tr.x, tr.y, trailRadius, 0, Math.PI * 2);
                ctx.fillStyle = '#ff4d4d';
                ctx.globalAlpha = 0.08 + 0.28 * ratio;
                ctx.fill();
                ctx.closePath();
                ctx.restore();
            }
        }

        // Draw main ball
        ctx.beginPath();
        ctx.arc(b.x, b.y, b.r, 0, Math.PI * 2);
        ctx.fillStyle = "#FF0000";
        ctx.fill();
        ctx.closePath();
    }
}

function drawPaddle() {
    ctx.beginPath();
    ctx.rect(paddle.x, paddle.y, paddle.w, paddle.h);
    ctx.fillStyle = "#0095DD";
    ctx.fill();
    ctx.closePath();
}

function drawMovingWall() {
    if (!movingWall) return;
    ctx.save();
    ctx.fillStyle = "#00ffff";
    ctx.shadowColor = "#00e5ff";
    ctx.shadowBlur = 8;
    ctx.beginPath();
    ctx.rect(movingWall.x, movingWall.y, movingWall.w, movingWall.h);
    ctx.fill();
    ctx.closePath();

    // Subtle hazard striped pattern overlay
    ctx.fillStyle = "rgba(0, 0, 0, 0.25)";
    for (let x = movingWall.x; x < movingWall.x + movingWall.w; x += 16) {
        ctx.beginPath();
        ctx.rect(x, movingWall.y, 8, movingWall.h);
        ctx.fill();
        ctx.closePath();
    }
    ctx.restore();
}

function drawBricks() {
    for (let c = 0; c < BRICK_COLS; c++) {
        for (let r = 0; r < BRICK_ROWS; r++) {
            const brick = bricks[c][r];
            if (brick.alive) {
                brick.x = (c * BRICK_W) + BRICK_OFFSET_LEFT;
                brick.y = (r * BRICK_H) + BRICK_OFFSET_TOP;

                ctx.beginPath();
                ctx.rect(brick.x, brick.y, brick.w, brick.h);
                ctx.fillStyle = brick.color;
                ctx.fill();
                ctx.closePath();

                if (brick.steel) {
                    // Steel brick metallic borders
                    ctx.save();
                    ctx.strokeStyle = "#B0C4DE";
                    ctx.lineWidth = 1.5;
                    ctx.strokeRect(brick.x + 1, brick.y + 1, brick.w - 2, brick.h - 2);

                    // If cracked (took 1 hit), draw crack marks
                    if (brick.hitsLeft === 1) {
                        ctx.strokeStyle = "#FFFFFF";
                        ctx.lineWidth = 1.8;
                        ctx.beginPath();
                        ctx.moveTo(brick.x + brick.w * 0.25, brick.y + 3);
                        ctx.lineTo(brick.x + brick.w * 0.45, brick.y + brick.h * 0.55);
                        ctx.lineTo(brick.x + brick.w * 0.38, brick.y + brick.h - 3);
                        ctx.moveTo(brick.x + brick.w * 0.45, brick.y + brick.h * 0.55);
                        ctx.lineTo(brick.x + brick.w * 0.72, brick.y + brick.h * 0.4);
                        ctx.stroke();
                        ctx.closePath();
                    }
                    ctx.restore();
                } else {
                    // Slight bevel highlight for normal bricks
                    ctx.save();
                    ctx.fillStyle = "rgba(255, 255, 255, 0.25)";
                    ctx.fillRect(brick.x, brick.y, brick.w, 3);
                    ctx.fillStyle = "rgba(0, 0, 0, 0.2)";
                    ctx.fillRect(brick.x, brick.y + brick.h - 3, brick.w, 3);
                    ctx.restore();
                }
            }
        }
    }
}

function updateHUD() {
    const scoreEl = document.getElementById('score');
    const livesEl = document.getElementById('lives');
    const levelEl = document.getElementById('level');
    if (scoreEl) scoreEl.textContent = 'Score: ' + score;
    if (livesEl) livesEl.textContent = 'Lives: ' + '●'.repeat(lives);
    if (levelEl) levelEl.textContent = 'Level: ' + level;

    // Best score (persisted)
    let best = 0;
    try {
        best = parseInt(localStorage.getItem('breakout-best')) || 0;
        if (score > best) {
            best = score;
            localStorage.setItem('breakout-best', best);
        }
    } catch (e) {
        // Storage unavailable; skip
    }
    const bestEl = document.getElementById('best');
    if (bestEl) bestEl.textContent = 'Best: ' + best;
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
    { type: 'life', label: '+', color: '#33cc33' },
    { type: 'slow', label: 'S', color: '#cc33cc' },
    { type: 'wide', label: 'W', color: '#ff9900' },
    { type: 'explosive', label: 'E', color: '#ff3366' },
    { type: 'multi', label: 'M', color: '#3399ff' }
];
let powerups = [];
let slowTimer = 0;
let wideTimer = 0;
let explosiveReady = false; // next brick hit detonates a 3x3 area
let multiReady = false;    // next paddle bounce splits the ball (cap 4)
let combo = 0; // bricks destroyed in a row without a paddle bounce
let popups = []; // floating score popups
let particles = []; // brick shrapnel

function spawnPowerup(x, y) {
    const t = POWERUP_TYPES[Math.floor(Math.random() * POWERUP_TYPES.length)];
    powerups.push({ x: x, y: y, type: t.type, label: t.label, color: t.color, vy: 2.5 });
}

function applyPowerup(type) {
    if (type === 'life') {
        lives = Math.min(lives + 1, 5);
        popups.push({
            x: paddle.x + paddle.w / 2,
            y: paddle.y - 10,
            text: '+1 Life',
            color: '#33cc33',
            life: 1.2
        });
    } else if (type === 'slow') {
        slowTimer = 6;
        popups.push({
            x: paddle.x + paddle.w / 2,
            y: paddle.y - 10,
            text: 'Slow Ball',
            color: '#cc33cc',
            life: 1.2
        });
    } else if (type === 'wide') {
        wideTimer = 8;
        // W stacks: each W widens the paddle further (1.4x -> 1.7x -> 2.0x, capped)
        const ratio = paddle.w / PADDLE_W;
        const steps = [1.4, 1.7, 2.0];
        const next = steps.find(s => s > ratio);
        if (next) paddle.w = Math.round(PADDLE_W * next);
        paddle.x = Math.max(0, Math.min(paddle.x, CANVAS_W - paddle.w));
        popups.push({
            x: paddle.x + paddle.w / 2,
            y: paddle.y - 10,
            text: 'Wide Paddle',
            color: '#ff9900',
            life: 1.2
        });
    } else if (type === 'explosive') {
        // Next brick hit detonates a 3x3 area around that brick
        explosiveReady = true;
        popups.push({
            x: paddle.x + paddle.w / 2,
            y: paddle.y - 10,
            text: 'Explosive!',
            color: '#ff3366',
            life: 1.2
        });
    } else if (type === 'multi') {
        // Next paddle bounce splits that ball into two (cap 4 balls)
        multiReady = true;
        popups.push({
            x: paddle.x + paddle.w / 2,
            y: paddle.y - 10,
            text: 'Multi-Ball!',
            color: '#3399ff',
            life: 1.2
        });
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
    for (const p of powerups) {
        ctx.beginPath();
        ctx.arc(p.x, p.y, 10, 0, Math.PI * 2);
        ctx.fillStyle = p.color;
        ctx.fill();
        ctx.fillStyle = '#ffffff';
        ctx.font = 'bold 14px sans-serif';
        ctx.textAlign = 'center';
        ctx.fillText(p.label, p.x, p.y + 5);
    }
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
                        spawnParticles(b.x, b.y, '#B0C4DE');
                        popups.push({
                            x: brick.x + brick.w / 2,
                            y: brick.y + brick.h / 2,
                            text: 'CRACK!',
                            color: '#E0E0E0',
                            life: 0.8
                        });

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
                    const mult = Math.min(combo, 5);
                    let totalEarned = 0;
                    for (const [tc, tr] of targets) {
                        const t = bricks[tc][tr];
                        if (!t.alive) continue;
                        t.alive = false;
                        totalEarned += t.points * mult;
                        spawnParticles(t.x + t.w / 2, t.y + t.h / 2, t.color);
                    }
                    score += totalEarned;

                    // Floating score popup at the break point
                    let popupText = '';
                    if (brick.steel) {
                        popupText = 'BROKEN!';
                    } else if (wasExplosive) {
                        popupText = '+' + totalEarned + ' (boom)';
                    } else if (mult > 1) {
                        popupText = '+' + totalEarned + ' (x' + mult + ')';
                    } else {
                        popupText = '+' + totalEarned;
                    }

                    popups.push({
                        x: brick.x + brick.w / 2,
                        y: brick.y + brick.h / 2,
                        text: popupText,
                        color: brick.steel ? '#B0C4DE' : (mult > 1 ? '#FFD700' : '#FFFFFF'),
                        life: 1
                    });

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
                    let bricksLeft = 0;
                    for(let i=0; i<BRICK_COLS; i++) {
                        for(let j=0; j<BRICK_ROWS; j++) {
                            if(bricks[i][j].alive) bricksLeft++;
                        }
                    }
                    if (bricksLeft === 0) {
                        level++;
                        gameState = 'won';
                        powerups.length = 0;
                        slowTimer = 0;
                        wideTimer = 0;
                        explosiveReady = false;
                        paddle.w = PADDLE_W;
                        spawnLevel();
                        playWinJingle();
                        // Reset ball on the paddle
                        const sp = currentSpeed();
                        balls = [makeBall(paddle.x + paddle.w / 2, paddle.y - BALL_RADIUS, sp, -sp)];
                        const msg = document.getElementById('overlay-message');
                        if (msg) msg.textContent = 'Level ' + level + ' unlocked! Press SPACE to continue.';
                        const overlay = document.getElementById('overlay');
                        if (overlay) overlay.style.display = 'block';
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
    if (movingWall) {
        movingWall.x += movingWall.vx;
        if (movingWall.x <= 0) {
            movingWall.x = 0;
            movingWall.vx *= -1;
        } else if (movingWall.x + movingWall.w >= CANVAS_W) {
            movingWall.x = CANVAS_W - movingWall.w;
            movingWall.vx *= -1;
        }
    }

    // 1. Move each ball
    for (let i = balls.length - 1; i >= 0; i--) {
        const b = balls[i];

        // Update ball trail (store previous positions)
        if (!b.trail) b.trail = [];
        b.trail.push({ x: b.x, y: b.y });
        if (b.trail.length > 8) {
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
        if (movingWall) {
            const cx = Math.max(movingWall.x, Math.min(b.x, movingWall.x + movingWall.w));
            const cy = Math.max(movingWall.y, Math.min(b.y, movingWall.y + movingWall.h));
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
            } else if (b.y + b.r > CANVAS_H) {
                // Ball fell past the paddle
                balls.splice(i, 1);
                lives--;
                combo = 0;
                powerups.length = 0;
                slowTimer = 0;
                wideTimer = 0;
                explosiveReady = false;
                multiReady = false;
                paddle.w = PADDLE_W;
                if (lives === 0) {
                    gameState = 'lost';
                    playLoseJingle();
                    const msg = document.getElementById('overlay-message');
                    const overlay = document.getElementById('overlay');
                    if (msg) msg.textContent = 'Game over — press R to restart.';
                    if (overlay) overlay.style.display = 'block';
                } else if (balls.length === 0) {
                    // All balls lost: reset one ball on the paddle
                    balls.push(makeBall(paddle.x + paddle.w / 2, paddle.y - BALL_RADIUS, currentSpeed(), -currentSpeed()));
                    gameState = 'ready';
                    const msg = document.getElementById('overlay-message');
                    const overlay = document.getElementById('overlay');
                    if (msg) msg.textContent = 'Press SPACE to launch';
                    if (overlay) overlay.style.display = 'block';
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
    isTap = true;
    tapStartX = e.clientX;
    tapStartY = e.clientY;
    movePaddleTo(e.clientX);
}

function handlePointerMove(e) {
    if (isTap && Math.hypot(e.clientX - tapStartX, e.clientY - tapStartY) > 12) {
        isTap = false; // it's a drag now, not a tap
    }
    movePaddleTo(e.clientX);
}

function handlePointerUp() {
    if (isTap) {
        const now = performance.now();
        if (now - lastTapAt < 300) {
            // Double tap = pause/resume (same as P)
            togglePause();
            lastTapAt = 0;
        } else {
            // Single tap = launch (same as SPACE), or restart on game over
            if (gameState === 'lost') {
                resetGame(getStartingLevel());
            } else if (gameState === 'ready' || gameState === 'won') {
                gameState = 'playing';
                const sp = currentSpeed();
                for (const b of balls) {
                    b.vx = sp;
                    b.vy = -sp;
                }
                const overlay = document.getElementById('overlay');
                if (overlay) overlay.style.display = 'none';
            }
            lastTapAt = now;
        }
    }
    isTap = false;
}

function togglePause() {
    if (gameState === 'playing') {
        gameState = 'paused';
        const msg = document.getElementById('overlay-message');
        const overlay = document.getElementById('overlay');
        if (msg) msg.textContent = 'Paused — tap or press P to resume.';
        if (overlay) overlay.style.display = 'block';
    } else if (gameState === 'paused') {
        gameState = 'playing';
        const overlay = document.getElementById('overlay');
        if (overlay) overlay.style.display = 'none';
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
    if (e.key === ' ' || e.key === 'Spacebar') {
        // Launch (or continue to next level)
        if (gameState === 'ready' || gameState === 'won') {
            gameState = 'playing';
            const sp = currentSpeed();
            for (const b of balls) {
                b.vx = sp;
                b.vy = -sp;
            }
            const overlay = document.getElementById('overlay');
            if (overlay) overlay.style.display = 'none';
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

    const muteBtn = document.getElementById('mute-btn');
    if (muteBtn) {
        muteBtn.addEventListener('click', toggleMute);
    }
    
    // Start the always-running render loop
    requestAnimationFrame(gameLoop);
});