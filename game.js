// --- Game Constants ---
const CANVAS_W = 900;
const CANVAS_H = 600;

// --- Game Entities ---
let canvas, ctx;
let balls, paddle, bricks, score = 0, lives = 3, level = 1;
let gameState = 'ready'; // ready, playing, won, lost
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
    
    // Initialize game state
    resetGame();
}

function resetGame() {
    score = 0;
    lives = 3;
    level = 1;
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
                points: 0
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
    // Regenerate brick positions for the current level
    for (let c = 0; c < BRICK_COLS; c++) {
        for (let r = 0; r < BRICK_ROWS; r++) {
            bricks[c][r].x = (c * BRICK_W) + BRICK_OFFSET_LEFT;
            bricks[c][r].y = (r * BRICK_H) + BRICK_OFFSET_TOP;
            bricks[c][r].alive = true;
        }
    }
    // From level 2 on, leave a few random gaps for variety
    // (always keep at least 12 bricks alive so the level stays playable)
    if (level >= 2) {
        const all = [];
        for (let c = 0; c < BRICK_COLS; c++)
            for (let r = 0; r < BRICK_ROWS; r++)
                all.push([c, r]);
        // Shuffle
        for (let i = all.length - 1; i > 0; i--) {
            const j = Math.floor(Math.random() * (i + 1));
            [all[i], all[j]] = [all[j], all[i]];
        }
        const gaps = Math.floor(all.length * 0.2);
        for (let i = 0; i < gaps; i++) {
            bricks[all[i][0]][all[i][1]].alive = false;
        }
    }
}

function makeBall(x, y, vx, vy) {
    return { x, y, r: BALL_RADIUS, vx, vy };
}

// Ball speed ramps up slightly each level (difficulty increases)
function currentSpeed() {
    return Math.min(5 + (level - 1) * 0.4, 8);
}

// --- Drawing Functions ---
function drawBall() {
    for (const b of balls) {
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

function drawBricks() {
    for (let c = 0; c < BRICK_COLS; c++) {
        for (let r = 0; r < BRICK_ROWS; r++) {
            const brick = bricks[c][r];
            if (brick.alive) {
                brick.x = (c * BRICK_W) + BRICK_OFFSET_LEFT;
                brick.y = (r * BRICK_H) + BRICK_OFFSET_TOP;
                
                // Row-based scoring and coloring (Step 5 Polish)
                let rowScore;
                let color;
                switch (r) {
                    case 0: rowScore = 30; color = '#FFD700'; break; // Gold (Top)
                    case 1: rowScore = 25; color = '#FFA500'; break; // Orange
                    case 2: rowScore = 20; color = '#FF4500'; break; // Orange-Red
                    case 3: rowScore = 15; color = '#FF0000'; break; // Red
                    case 4: rowScore = 10; color = '#8B0000'; break; // Dark Red
                    default: rowScore = 5; color = '#006400'; // Dark Green (Bottom)
                }

                brick.color = color;
                brick.points = rowScore;
                
                ctx.beginPath();
                ctx.rect(brick.x, brick.y, brick.w, brick.h);
                ctx.fillStyle = brick.color;
                ctx.fill();
                ctx.closePath();
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
function beep(freq = 440) {
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

// Short explosion boom (low, thuddy)
function boom() {
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
                    // Explosive ball: if ready, detonate the 3x3 area around the hit brick
                    const wasExplosive = explosiveReady;
                    explosiveReady = false;
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
                    popups.push({
                        x: brick.x + brick.w / 2,
                        y: brick.y + brick.h / 2,
                        text: wasExplosive
                            ? '+' + totalEarned + ' (boom)'
                            : (mult > 1 ? '+' + totalEarned + ' (x' + mult + ')' : '+' + totalEarned),
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
                        // Reset ball on the paddle
                        const sp = currentSpeed();
                        balls = [makeBall(paddle.x + paddle.w / 2, paddle.y - BALL_RADIUS, sp, -sp)];
                        const msg = document.getElementById('overlay-message');
                        if (msg) msg.textContent = 'Level ' + level + ' unlocked! Press SPACE to continue.';
                        const overlay = document.getElementById('overlay');
                        if (overlay) overlay.style.display = 'block';
                        return;
                    }
                    
                    // (particle burst logic would go here in step 5)
                }
            }
        }
    }
}


// --- Game Logic Update ---
function update() {
    // 1. Move each ball
    for (let i = balls.length - 1; i >= 0; i--) {
        const b = balls[i];

        b.x += b.vx;
        b.y += b.vy;

        // 2. Wall collisions
        if (b.x + b.r > CANVAS_W || b.x - b.r < 0) {
            b.vx *= -1;
        }
        if (b.y - b.r < 0) {
            // Top wall bounce
            b.y = b.r;
            b.vy *= -1;
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
        ctx.globalAlpha = Math.max(0, Math.min(1, p.life * 2));
        ctx.fillStyle = '#ffffff';
        ctx.font = 'bold 16px sans-serif';
        ctx.textAlign = 'center';
        ctx.fillText(p.text, p.x, p.y);
        ctx.globalAlpha = 1;
    }
}

function render() {
    // Clear canvas
    ctx.clearRect(0, 0, CANVAS_W, CANVAS_H);

    // Draw elements
    drawBricks();
    drawBall();
    drawPaddle();
    drawPowerups();
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
                resetGame();
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
            resetGame();
        }
        return;
    }
    if (e.key === 'p' || e.key === 'P') {
        // Pause / resume
        togglePause();
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
    
    // Start the always-running render loop
    requestAnimationFrame(gameLoop);
});