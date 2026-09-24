// === secretCode.js === The old arcade cheat code: once per game it tears open a warp rift on the spot.
//
// Keyboard: up up down down left right left right B A, any time during play.
// Touch: pause first (so swiping doesn't steer the paddle), then swipe up, up, down, down, left, right,
// left, right, and tap the left half of the screen for B, the right half for A, like a pad's buttons.
// While a code is under way those taps don't resume the game. A wrong move starts it over.
//
// It works once per game (resetGame clears it). Where a rift can't open (the tutorial, a Space Chomp maze,
// a boss arriving or dying, a rift already open) it says so and isn't used up.

const SECRET_CODE = ['up', 'up', 'down', 'down', 'left', 'right', 'left', 'right', 'b', 'a'];
const SECRET_SWIPE_PX = 40;   // a touch that travels this far is a swipe...
const SECRET_TAP_PX = 18;     // ...and one that stays within this is a tap
const SECRET_TIMEOUT_MS = 6000; // pause too long between moves and the code starts over

let secretProgress = 0;
let secretLastAt = 0;
let secretUsed = false;
let secretSwallowUntil = 0; // a tap spent on the code must not also resume the game
let secretTouch = null;     // { id, x, y } of the touch being watched while paused

function secretInput(move) {
    const now = performance.now();
    if (now - secretLastAt > SECRET_TIMEOUT_MS) secretProgress = 0;
    secretLastAt = now;
    if (move === SECRET_CODE[secretProgress]) {
        secretProgress++;
        if (secretProgress >= 3) tone(500 + secretProgress * 70, 0.05, { type: 'square', vol: 0.08, key: 'secretTick' });
        if (secretProgress === SECRET_CODE.length) {
            secretProgress = 0;
            secretCodeEntered();
        }
        return true;
    }
    // A wrong move: it may still be the start of a fresh attempt
    secretProgress = move === SECRET_CODE[0] ? 1 : 0;
    return false;
}

function canOpenSecretRift() {
    return (gameState === 'playing' || gameState === 'paused') && !warpRift && !isTutorial() && !maze &&
        !(boss && (boss.intro > 0 || boss.dying > 0));
}

function secretCodeEntered() {
    if (secretUsed) {
        showToast('The secret works once per game');
        return;
    }
    if (!canOpenSecretRift()) {
        showToast('No warp rift can open here');
        return;
    }
    secretUsed = true;
    portals = null; // never both at once
    spawnWarpRift();
    warpTimer = warpInterval();
    addPopup(CANVAS_W / 2, 140, 'SECRET CODE!', '#ffd319', { size: 26, life: 2, rise: 0.2, pop: true });
    showToast('SECRET CODE! A warp rift opens' + (gameState === 'paused' ? ': resume to use it' : ''));
    haptic([30, 30, 30, 30, 80], true);
}

const SECRET_KEYS = { ArrowUp: 'up', ArrowDown: 'down', ArrowLeft: 'left', ArrowRight: 'right', b: 'b', B: 'b', a: 'a', A: 'a' };

function secretKey(e) {
    const move = SECRET_KEYS[e.key];
    if (!move || modalOpen()) return;
    if (gameState !== 'playing' && gameState !== 'paused') return;
    secretInput(move);
}

// Touch: only watched while paused, where a finger does nothing else but the tap that resumes
function secretPointerDown(e) {
    if (e.pointerType === 'mouse' || gameState !== 'paused' || modalOpen()) return;
    secretTouch = { id: e.pointerId, x: e.clientX, y: e.clientY };
}

function secretPointerUp(e) {
    const t = secretTouch;
    if (!t || e.pointerId !== t.id) return;
    secretTouch = null;
    if (gameState !== 'paused') return;
    const dx = e.clientX - t.x, dy = e.clientY - t.y;
    const dist = Math.hypot(dx, dy);
    if (dist >= SECRET_SWIPE_PX) {
        secretInput(Math.abs(dx) > Math.abs(dy) ? (dx > 0 ? 'right' : 'left') : (dy > 0 ? 'down' : 'up'));
    } else if (dist <= SECRET_TAP_PX && secretProgress >= SECRET_CODE.indexOf('b')) {
        // The code is at its B A end: this tap is a button press, not "resume"
        secretInput(e.clientX < window.innerWidth / 2 ? 'b' : 'a');
        secretSwallowUntil = performance.now() + 500;
    }
}

function secretSwallowsTap() {
    return performance.now() < secretSwallowUntil;
}

function resetSecretCode() {
    secretUsed = false;
    secretProgress = 0;
}

function initSecretCode() {
    document.addEventListener('keydown', secretKey);
    // Capture phase, so the code sees a tap before the game's own handlers decide it means "resume"
    window.addEventListener('pointerdown', secretPointerDown, true);
    window.addEventListener('pointerup', secretPointerUp, true);
}
