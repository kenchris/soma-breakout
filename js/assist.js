// === assist.js === Automatic assist: a fair handicap for players who find the game too hard.
//
// Lose two balls on the same level (or get a game over) and the game steps up one assist tier: the
// whole game runs in gentle slow motion (ball, aliens, bosses, timers, everything) and from tier 2
// the paddle grows a little. In exchange every point scored is scaled down by that tier's score
// multiplier, so a score made with help never outranks the same run played without it. Clear a
// level without losing a ball and it steps back down one tier. The tier is remembered between
// visits, and the help dialog has a switch to turn the whole thing off.

const ASSIST_TIERS = [
    { speed: 1, score: 1, paddle: 0 },
    { speed: 0.88, score: 0.8, paddle: 0 },
    { speed: 0.78, score: 0.6, paddle: 16 },
    { speed: 0.7, score: 0.45, paddle: 30 }
];
const ASSIST_LOSSES_TO_RAISE = 2; // balls lost on one level before the game steps in

let assistTier = 0;
let assistAuto = true;
let assistLosses = 0; // balls lost on the current level since the tier last changed
let assistLevelLosses = 0; // balls lost on the current level, in all

function assistSpeed() {
    return ASSIST_TIERS[assistTier].speed;
}

function assistScoreMult() {
    return ASSIST_TIERS[assistTier].score;
}

// The paddle's normal width: what every "back to normal" (a new ball, Wide/Narrow running out) returns to
function paddleBaseW() {
    return PADDLE_W + ASSIST_TIERS[assistTier].paddle;
}

function loadAssist() {
    try {
        const saved = JSON.parse(localStorage.getItem('breakout-assist'));
        if (saved) {
            assistAuto = saved.auto !== false;
            const t = saved.tier | 0;
            assistTier = assistAuto ? Math.max(0, Math.min(ASSIST_TIERS.length - 1, t)) : 0;
        }
    } catch (e) {
        // Storage unavailable; start without assist
    }
}

function saveAssist() {
    try {
        localStorage.setItem('breakout-assist', JSON.stringify({ auto: assistAuto, tier: assistTier }));
    } catch (e) {
        // Storage unavailable; skip
    }
}

function setAssistTier(t, announce = true) {
    t = Math.max(0, Math.min(ASSIST_TIERS.length - 1, t));
    assistLosses = 0;
    if (t === assistTier) return;
    const up = t > assistTier;
    const oldBase = paddleBaseW();
    assistTier = t;
    saveAssist();
    if (paddle) { // keep whatever Wide/Narrow is doing, relative to the new normal width
        paddle.w = Math.round(paddle.w * paddleBaseW() / oldBase);
        paddle.x = Math.max(0, Math.min(paddle.x, CANVAS_W - paddle.w));
    }
    updateAssistUi();
    if (!announce) return;
    const pct = Math.round(assistScoreMult() * 100);
    const text = t === 0 ? 'ASSIST OFF: FULL POINTS' : up ? 'ASSIST ON: SLOWER, ' + pct + '% POINTS' : 'ASSIST EASED: ' + pct + '% POINTS';
    addPopup(CANVAS_W / 2, CANVAS_H * 0.62, text, up ? '#8fd3ff' : '#9dff8f', { size: 20, life: 2.2, rise: 0.3, pop: true });
}

// A ball was lost (lives already reduced). Game over always steps up, for the next try.
function assistOnLifeLost() {
    if (!assistAuto) return;
    assistLosses++;
    assistLevelLosses++;
    if (lives === 0 || assistLosses >= ASSIST_LOSSES_TO_RAISE) setAssistTier(assistTier + 1, lives > 0);
}

// A level was cleared: without losing a ball, the help eases off one tier
function assistOnLevelCleared() {
    if (assistAuto && assistLevelLosses === 0 && assistTier > 0) setAssistTier(assistTier - 1);
    easeHelpNeed(assistLevelLosses === 0);
    assistLosses = 0;
    assistLevelLosses = 0;
}

// --- Helpful drops ---
// Short on hearts, +Life drops come more often. And each lost ball is looked at for why it was missed:
// a near miss (the ball came down just past the paddle's end) makes Wide more likely, a far miss or a
// ball too fast to reach makes Slow more likely. Each repeat of the same kind of miss boosts that drop
// further (up to 4x); a clean level clear forgets it all, any other clear forgets one step.
const MISS_NEAR_PX = 70;     // a ball landing within this of the paddle's end was a near miss
const MISS_FAST = 1.15;      // a ball this much faster than the level's normal speed was too fast to reach
const HELP_NEED_MAX = 3;
const helpNeed = { wide: 0, slow: 0 };

function noteMiss(b) {
    if (!assistAuto) return;
    // Where the ball crossed the paddle's line on its way down
    const x = b.vy > 0 ? b.x - b.vx * (b.y - paddle.y) / b.vy : b.x;
    const gap = Math.max(0, paddle.x - x, x - (paddle.x + paddle.w));
    const fast = Math.hypot(b.vx, b.vy) > currentSpeed() * MISS_FAST;
    const kind = gap <= MISS_NEAR_PX && !fast ? 'wide' : 'slow';
    helpNeed[kind] = Math.min(HELP_NEED_MAX, helpNeed[kind] + 1);
}

function easeHelpNeed(clean) {
    for (const k in helpNeed) helpNeed[k] = clean ? 0 : Math.max(0, helpNeed[k] - 1);
}

// A drop's weight in the random pick, with the help above folded in
function helpWeight(p) {
    if (!assistAuto) return p.weight;
    if (p.type === 'life') return p.weight * (lives <= 1 ? 5 : lives <= 3 ? 3 : 1);
    if (p.type in helpNeed) return p.weight * (1 + helpNeed[p.type]);
    return p.weight;
}

function setAssistAuto(on) {
    assistAuto = on;
    if (!on) setAssistTier(0, false);
    saveAssist();
    updateAssistUi();
}

function updateAssistUi() {
    const chip = document.getElementById('hud-assist');
    if (chip) {
        chip.style.display = assistTier > 0 ? '' : 'none';
        const val = document.getElementById('assist-val');
        if (val) val.textContent = Math.round(assistScoreMult() * 100) + '%';
        chip.title = 'Assist: the game runs at ' + Math.round(assistSpeed() * 100) + '% speed and points count ' +
            Math.round(assistScoreMult() * 100) + '%. Clear a level without losing a ball to ease it off.';
    }
    const box = document.getElementById('assist-on');
    if (box) box.checked = assistAuto;
}

function initAssistUi() {
    const box = document.getElementById('assist-on');
    if (box) box.addEventListener('change', () => setAssistAuto(box.checked));
    updateAssistUi();
}
