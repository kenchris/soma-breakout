// --- Game Constants ---
const CANVAS_W = 900;
const CANVAS_H = 600;

// --- Game Entities ---
let canvas, ctx;
let ball, paddle, bricks, score = 0, lives = 3, level = 1;
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

    // Ball setup
    ball = {
        x: CANVAS_W / 2,
        y: paddle.y - BALL_RADIUS,
        r: BALL_RADIUS,
        // Initial velocity (magnitude is kept constant)
        vx: 5, 
        vy: -5
    };

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

// Ball speed ramps up slightly each level (difficulty increases)
function currentSpeed() {
    return Math.min(5 + (level - 1) * 0.4, 8);
}

// --- Drawing Functions ---
function drawBall() {
    ctx.beginPath();
    ctx.arc(ball.x, ball.y, ball.r, 0, Math.PI * 2);
    ctx.fillStyle = "#FF0000";
    ctx.fill();
    ctx.closePath();
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
function beep() {
    try {
        if (!audioCtx) audioCtx = new AudioContext();
        const osc = audioCtx.createOscillator();
        const gain = audioCtx.createGain();
        osc.type = 'square';
        osc.frequency.value = 440;
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

// --- Particles ---
let particles = [];

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

// --- Collision Detection ---
function collisionDetection() {
    for (let c = 0; c < BRICK_COLS; c++) {
        for (let r = 0; r < BRICK_ROWS; r++) {
            const brick = bricks[c][r];
            if (brick.alive) {
                // Circle-AABB test: closest point on the brick's AABB to the ball center
                const cx = Math.max(brick.x, Math.min(ball.x, brick.x + brick.w));
                const cy = Math.max(brick.y, Math.min(ball.y, brick.y + brick.h));
                const dx = ball.x - cx;
                const dy = ball.y - cy;
                if (dx * dx + dy * dy < ball.r * ball.r) {
                    // Hit: flip the axis with the deeper penetration
                    brick.alive = false;
                    score += brick.points;

                    // Slightly speed up, then re-normalize to keep magnitude sane
                    const speed = Math.hypot(ball.vx, ball.vy);
                    const newSpeed = Math.min(speed * 1.02, 10);
                    const factor = newSpeed / speed;
                    ball.vx *= factor;
                    ball.vy *= factor;

                    if (Math.abs(dx) > Math.abs(dy)) {
                        // ball entered from the side -> flip vx
                        ball.vx *= -1;
                    } else {
                        // ball entered from top/bottom -> flip vy
                        ball.vy *= -1;
                    }

                    // Particle burst at the brick's center
                    spawnParticles(brick.x + brick.w / 2, brick.y + brick.h / 2, brick.color);
                    beep();
                    
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
                        spawnLevel();
                        // Reset ball on the paddle
                        ball.x = paddle.x + paddle.w / 2;
                        ball.y = paddle.y - ball.r;
                        const sp = currentSpeed();
                        ball.vx = sp;
                        ball.vy = -sp;
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
    // 1. Move the ball
    ball.x += ball.vx;
    ball.y += ball.vy;

    // 2. Wall Collision
    if (ball.x + ball.r > CANVAS_W || ball.x - ball.r < 0) {
        ball.vx *= -1;
    }
    if (ball.y - ball.r < 0) {
        // Top Wall Bounce
        ball.y = ball.r;
        ball.vy *= -1;
    }

    // 2b. Paddle bounce: circle-vs-AABB test, only while moving down
    if (ball.vy > 0) {
        const cx = Math.max(paddle.x, Math.min(ball.x, paddle.x + paddle.w));
        const cy = Math.max(paddle.y, Math.min(ball.y, paddle.y + paddle.h));
        const dx = ball.x - cx;
        const dy = ball.y - cy;
        if (dx * dx + dy * dy < ball.r * ball.r) {
            // Snap the ball to the paddle top
            ball.y = paddle.y - ball.r;
            // Classic paddle bounce logic (steer)
            // Hit point relative to paddle center: -1 (left) to 1 (right)
            let hitRatio = (ball.x - (paddle.x + paddle.w / 2)) / (paddle.w / 2);
            hitRatio = Math.max(-1, Math.min(1, hitRatio));
            // Cap the horizontal component so the bounce stays within ~60 degrees
            // of vertical — otherwise an edge hit yields vy ~ 0 and the ball
            // shuttles left-right off the side walls forever
            const bSpeed = currentSpeed();
            let newVX = hitRatio * bSpeed * 0.866;
            let newVY = -Math.sqrt(bSpeed * bSpeed - newVX * newVX);
            ball.vx = newVX;
            ball.vy = newVY;
        } else if (ball.y + ball.r > CANVAS_H) {
            // Ball fell past the paddle
            lives--;
            if (lives === 0) {
                gameState = 'lost';
                const msg = document.getElementById('overlay-message');
                const overlay = document.getElementById('overlay');
                if (msg) msg.textContent = 'Game over — press R to restart.';
                if (overlay) overlay.style.display = 'block';
            } else {
                // Reset ball on the paddle
                ball.x = paddle.x + paddle.w / 2;
                ball.y = paddle.y - ball.r;
                const sp = currentSpeed();
                ball.vx = sp;
                ball.vy = -sp;
                gameState = 'ready';
                const msg = document.getElementById('overlay-message');
                const overlay = document.getElementById('overlay');
                if (msg) msg.textContent = 'Press SPACE to launch';
                if (overlay) overlay.style.display = 'block';
            }
        }
    }

    // 3. Collision Check
    collisionDetection();
}

function render() {
    // Clear canvas
    ctx.clearRect(0, 0, CANVAS_W, CANVAS_H);

    // Draw elements
    drawBricks();
    drawBall();
    drawPaddle();
    updateHUD();
    drawParticles();
}

// --- Rendering Loop (always runs; physics only while playing) ---
function gameLoop() {
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
                ball.vx = sp;
                ball.vy = -sp;
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
            ball.vx = sp;
            ball.vy = -sp;
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