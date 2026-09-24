// === secretCode.js === The old arcade cheat code: once per game it tears open a warp rift on the spot.
//
// Keyboard: up up down down left right left right B A, any time.
// Touch: whenever a dialog is up (Pause, the launch / level cleared screen, Help, Sound: a swipe then
// steers nothing), swipe up, up, down, down, left, right, left, right anywhere on the screen, and tap the
// left half for B, the right half for A, like a pad's buttons. Those two taps don't launch, resume or press
// anything. A wrong move starts it over.
//
// It works once per game (resetGame clears it). Where a rift can't open (training levels, Space Chomp,
// boss fights, a rift already open) it says why and isn't used up.

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
        secretBuzz(secretProgress);
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

// Why a rift can't open right now, or null if it can
function secretRiftBlocker() {
    if (isTutorial()) return 'No warp rift can open in training levels';
    if (plan.boss) return 'No warp rift can open in boss fights'; // a boss has to be beaten, not skipped
    if (plan.maze || maze) return 'No warp rift can open in Space Chomp';
    if (warpRift) return 'A warp rift is already open';
    if (gameState === 'lost') return 'No warp rift can open after game over';
    return null;
}

// A buzz per correct move, stronger each time. A phone can't vibrate harder, only longer: 12ms at the first
// move up to ~57ms at the last. iOS has no vibrate(), only a fixed tick (see iosHapticTick in audio.js), so
// there it's more ticks instead: 1 at the start, up to 4 at the end.
function secretBuzz(n) {
    if (navigator.vibrate) {
        haptic(7 + n * 5, true);
        return;
    }
    const ticks = Math.ceil(n / 3);
    for (let i = 0; i < ticks; i++) setTimeout(() => haptic(1, true), i * 70);
}

// The game does a silly jelly wobble (CSS: body.secret-wobble in index.html)
function secretWobble() {
    const el = document.body;
    el.classList.remove('secret-wobble');
    void el.offsetWidth; // restart the animation
    el.classList.add('secret-wobble');
    setTimeout(() => el.classList.remove('secret-wobble'), 1000);
}

function canOpenSecretRift() {
    return secretRiftBlocker() === null;
}

// Touches count toward the code while a dialog is up (nothing else takes a swipe then)
function secretPadActive() {
    return gameState === 'paused' || modalOpen() || overlayOpen();
}

function secretCodeEntered() {
    if (secretUsed) {
        showToast('The secret works once per game');
        return;
    }
    const blocked = secretRiftBlocker();
    if (blocked) {
        showToast(blocked);
        return;
    }
    secretUsed = true;
    portals = null; // never both at once
    spawnWarpRift();
    warpTimer = warpInterval();
    addPopup(CANVAS_W / 2, 140, 'SECRET CODE!', '#ffd319', { size: 26, life: 2, rise: 0.2, pop: true });
    secretWobble();
    addShake(12);
    showToast('SECRET CODE! A warp rift opens');
    if (navigator.vibrate) haptic([30, 30, 30, 30, 80], true);
    else for (let i = 0; i < 5; i++) setTimeout(() => haptic(1, true), i * 90);
}

const SECRET_KEYS = { ArrowUp: 'up', ArrowDown: 'down', ArrowLeft: 'left', ArrowRight: 'right', b: 'b', B: 'b', a: 'a', A: 'a' };

function secretKey(e) {
    const move = SECRET_KEYS[e.key];
    if (!move) return;
    secretInput(move);
}

// Touch: only watched while paused, where a finger does nothing else but the tap that resumes. This
// listens to touch events, not pointer events: a swipe that starts on the pause dialog (which can scroll)
// gets its pointer events cancelled by the browser mid-swipe, but the touch events still arrive.
function secretTouchStart(e) {
    if (!secretPadActive() || e.touches.length !== 1) {
        secretTouch = null;
        return;
    }
    const p = e.changedTouches[0];
    secretTouch = { id: p.identifier, x: p.clientX, y: p.clientY, lastX: p.clientX, lastY: p.clientY };
}

function secretTouchMove(e) {
    const t = secretTouch;
    const p = t && Array.from(e.changedTouches).find(c => c.identifier === t.id);
    if (p) { t.lastX = p.clientX; t.lastY = p.clientY; }
}

// If the browser takes the touch over anyway (a scroll, a system gesture), judge the swipe by where the
// finger had got to
function secretTouchCancel(e) {
    const t = secretTouch;
    if (!t || !Array.from(e.changedTouches).some(c => c.identifier === t.id)) return;
    secretTouch = null;
    const dx = t.lastX - t.x, dy = t.lastY - t.y;
    if (Math.hypot(dx, dy) >= SECRET_SWIPE_PX) {
        secretInput(Math.abs(dx) > Math.abs(dy) ? (dx > 0 ? 'right' : 'left') : (dy > 0 ? 'down' : 'up'));
    }
}

function secretTouchEnd(e) {
    const t = secretTouch;
    const p = t && Array.from(e.changedTouches).find(c => c.identifier === t.id);
    if (!p) return;
    secretTouch = null;
    const dx = p.clientX - t.x, dy = p.clientY - t.y;
    const dist = Math.hypot(dx, dy);
    if (dist >= SECRET_SWIPE_PX) {
        secretInput(Math.abs(dx) > Math.abs(dy) ? (dx > 0 ? 'right' : 'left') : (dy > 0 ? 'down' : 'up'));
    } else if (dist <= SECRET_TAP_PX && secretProgress >= SECRET_CODE.indexOf('b')) {
        // The code is at its B A end: this tap is a button press, not "resume"
        secretInput(p.clientX < window.innerWidth / 2 ? 'b' : 'a');
        secretSwallowUntil = performance.now() + 500;
    }
}

function secretSwallowsTap() {
    return performance.now() < secretSwallowUntil;
}

// The code is waiting for its B/A taps. A tap's pointerup (where the game resumes) comes before its touchend
// (where the code reads it), so the game asks this first and leaves such a tap to the code.
function secretAwaitingButtons() {
    return secretProgress >= SECRET_CODE.indexOf('b') && performance.now() - secretLastAt < SECRET_TIMEOUT_MS;
}

function resetSecretCode() {
    secretUsed = false;
    secretProgress = 0;
}

function initSecretCode() {
    document.addEventListener('keydown', secretKey);
    // Capture phase, so the code sees a tap before the game's own handlers decide it means "resume"
    window.addEventListener('touchstart', secretTouchStart, { capture: true, passive: true });
    window.addEventListener('touchend', secretTouchEnd, { capture: true, passive: true });
    window.addEventListener('touchmove', secretTouchMove, { capture: true, passive: true });
    window.addEventListener('touchcancel', secretTouchCancel, { capture: true, passive: true });
    // A B/A tap presses nothing else either (Resume, a HUD button...): its click is dropped
    window.addEventListener('click', e => {
        if (!secretSwallowsTap()) return;
        e.stopPropagation();
        e.preventDefault();
    }, true);
}
