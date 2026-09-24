// === share.js ===
// Sharing, so a run can spread: the game keeps a screenshot of the run's best moment, turns it into a
// retro "share card" at game over, and hands it to the Web Share API (or, where that can't take files,
// downloads the image and copies the text). Found cheat codes can be shared as a link that drops a friend
// straight into that level (?code=XXXX — see getStartingLevel in level.js).

// Tabler "share" icon (tabler.io/icons, MIT), same family as the HUD buttons
const SHARE_ICON_SVG = '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M3 12a3 3 0 1 0 6 0a3 3 0 1 0 -6 0" /><path d="M15 6a3 3 0 1 0 6 0a3 3 0 1 0 -6 0" /><path d="M15 18a3 3 0 1 0 6 0a3 3 0 1 0 -6 0" /><path d="M8.7 10.7l6.6 -3.4" /><path d="M8.7 13.3l6.6 3.4" /></svg>';

// --- Great-moment camera ---
// Events call noteMoment() with a weight for how screenshot-worthy they are. The best one so far is
// captured a few frames later (so its popup has popped in and the particles are flying) by copying the
// canvas into an offscreen one — a single drawImage, cheap enough to do mid-play; no PNG encoding until
// someone actually asks to share.
let momentCanvas = null;
let momentInfo = null;    // { weight, label } of the captured moment, or null this run
let pendingMoment = null; // a moment waiting out its capture delay
let shareCard = null;     // { file, url, text } once built at game over

function noteMoment(weight, label, delayFrames = 10) {
    const w = weight + Math.min(level, 40) * 0.5; // the same feat later in a run is the better story
    if (momentInfo && w < momentInfo.weight) return;
    if (pendingMoment && w < pendingMoment.weight) return;
    pendingMoment = { weight: w, label, delay: delayFrames };
}

// Called right after each rendered frame
function captureMomentIfDue() {
    if (!pendingMoment || pendingMoment.delay > 0) return; // counted down per step in tickFx
    copyCanvasToMoment();
    momentInfo = { weight: pendingMoment.weight, label: pendingMoment.label };
    pendingMoment = null;
}

function copyCanvasToMoment() {
    if (!momentCanvas) {
        momentCanvas = document.createElement('canvas');
        momentCanvas.width = CANVAS_W;
        momentCanvas.height = CANVAS_H;
    }
    momentCanvas.getContext('2d').drawImage(canvas, 0, 0);
}

function resetMoments() {
    momentInfo = null;
    pendingMoment = null;
    setShareVisible(false);
}

// --- Share card ---
function gameUrl() {
    return location.origin + location.pathname;
}

// Built as soon as the game-over screen goes up, so the click handler can call navigator.share()
// synchronously: Safari only allows it within the tap's own user-activation window, and awaiting a PNG
// encode first can lose that.
function prepareShareCard(summary) {
    if (pendingMoment) { // the run ended while a highlight was still waiting out its capture delay
        pendingMoment.delay = 0;
        captureMomentIfDue();
    }
    if (!momentInfo) { // no highlight this run — the last frame before the ball dropped will do
        copyCanvasToMoment();
        momentInfo = { weight: 0, label: 'GAME OVER' };
    }
    const newBest = !!(summary && summary.newBest);
    const card = drawShareCard(newBest);
    const text = (newBest ? 'New high score: ' + score.toLocaleString() + ' points' : score.toLocaleString() + ' points')
        + ' and level ' + level + ' in Neon Smash. Can you beat it? ' + gameUrl();
    card.toBlob(blob => {
        if (!blob || gameState !== 'lost') return; // already restarted
        if (shareCard) URL.revokeObjectURL(shareCard.url);
        shareCard = {
            file: new File([blob], 'neon-smash-' + score + '.png', { type: 'image/png' }),
            url: URL.createObjectURL(blob),
            text
        };
        const thumb = document.getElementById('share-thumb');
        if (thumb) thumb.src = shareCard.url;
        setShareVisible(true);
    }, 'image/png');
}

function drawShareCard(newBest) {
    const S = 1080;
    const card = document.createElement('canvas');
    card.width = S;
    card.height = S;
    const g = card.getContext('2d');

    const bg = g.createLinearGradient(0, 0, 0, S);
    bg.addColorStop(0, '#07040f');
    bg.addColorStop(0.55, '#140a26');
    bg.addColorStop(1, '#2a0f47');
    g.fillStyle = bg;
    g.fillRect(0, 0, S, S);
    // Synthwave floor lines behind the stats, echoing the page backdrop
    g.strokeStyle = 'rgba(255, 47, 180, 0.25)';
    g.lineWidth = 2;
    for (let i = -10; i <= 10; i++) {
        g.beginPath();
        g.moveTo(S / 2 + i * 30, 860);
        g.lineTo(S / 2 + i * 190, S);
        g.stroke();
    }
    for (const y of [880, 910, 950, 1005, 1075]) {
        g.beginPath();
        g.moveTo(0, y);
        g.lineTo(S, y);
        g.stroke();
    }

    g.textAlign = 'center';
    g.textBaseline = 'alphabetic';
    // Logo
    g.font = pixelFont(64);
    g.fillStyle = '#4a0d6b';
    g.fillText('NEON SMASH', S / 2 + 5, 115);
    const logo = g.createLinearGradient(0, 55, 0, 115);
    logo.addColorStop(0, '#fff7d1');
    logo.addColorStop(0.45, '#ffd319');
    logo.addColorStop(1, '#ff2fb4');
    g.fillStyle = logo;
    g.fillText('NEON SMASH', S / 2, 110);
    // What happened
    g.font = pixelFont(26);
    g.fillStyle = '#2de2e6';
    g.fillText(momentInfo.label, S / 2, 172);

    // The moment itself, in a neon frame
    const sw = 960, sh = 640, sx = (S - sw) / 2, sy = 200;
    g.save();
    g.shadowColor = 'rgba(255, 47, 180, 0.8)';
    g.shadowBlur = 30;
    g.fillStyle = '#ff2fb4';
    g.fillRect(sx - 5, sy - 5, sw + 10, sh + 10);
    g.restore();
    g.drawImage(momentCanvas, sx, sy, sw, sh);

    // Score, and either the high-score badge or how far the run got
    g.font = pixelFont(44);
    g.fillStyle = '#7a1560';
    g.fillText(score.toLocaleString() + ' PTS', S / 2 + 4, 922);
    g.fillStyle = '#ffd319';
    g.fillText(score.toLocaleString() + ' PTS', S / 2, 918);
    g.font = pixelFont(24);
    g.fillStyle = newBest ? '#ff2fb4' : '#f3eeff';
    g.fillText(newBest ? 'NEW HIGH SCORE!' : 'REACHED LEVEL ' + level, S / 2, 972);
    g.font = termFont(38);
    g.fillStyle = '#9a8cc0';
    g.fillText(location.host + location.pathname.replace(/\/(index\.html)?$/, ''), S / 2, 1040);
    return card;
}

function setShareVisible(show) {
    const area = document.getElementById('share-area');
    if (area) area.style.display = show ? 'flex' : 'none';
}

function shareRun() {
    if (!shareCard) return;
    const files = [shareCard.file];
    if (navigator.canShare && navigator.canShare({ files })) {
        // The link rides in the text, not a separate url field: several apps drop that field when a file is attached
        navigator.share({ files, title: 'Neon Smash', text: shareCard.text }).catch(() => {});
    } else {
        downloadFile(shareCard.url, shareCard.file.name);
        copyText(shareCard.text, 'Screenshot saved. Share text copied!', 'Screenshot saved!');
    }
}

// --- Cheat codes ---
function shareCheatCode(lvl, code) {
    const url = gameUrl() + '?code=' + encodeURIComponent(code);
    const text = 'I found a secret Neon Smash level code: ' + code + '. It unlocks level ' + lvl + '.';
    if (navigator.share) {
        navigator.share({ title: 'Neon Smash level code', text, url }).catch(() => {});
    } else {
        copyText(text + ' ' + url, 'Level code link copied!', 'Copy failed. The code is ' + code);
    }
}

// --- Fallback helpers ---
function downloadFile(href, name) {
    const a = document.createElement('a');
    a.href = href;
    a.download = name;
    document.body.appendChild(a);
    a.click();
    a.remove();
}

function copyText(text, okMsg, failMsg) {
    if (navigator.clipboard && navigator.clipboard.writeText) {
        navigator.clipboard.writeText(text).then(() => showToast(okMsg), () => showToast(failMsg));
    } else {
        showToast(failMsg);
    }
}

let toastTimer = 0;
function showToast(msg) {
    const el = document.getElementById('toast');
    if (!el) return;
    el.textContent = msg;
    el.classList.add('show');
    clearTimeout(toastTimer);
    toastTimer = setTimeout(() => el.classList.remove('show'), 2400);
}
