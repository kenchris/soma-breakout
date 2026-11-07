// === intro.js === The trailer that plays when the game loads, before the player starts.
//
// It covers the page (#intro in index.html) and plays muted: browsers only let a page start sound after a
// tap or key press, so the sound button is the way in. Any key press or tap skips it, and the key press is
// swallowed so a Space meant to skip doesn't also launch the ball behind it. It goes away by itself when it
// ends, and at once when the video can't play (offline and never cached, a browser without either format,
// a slow connection), so it can never be the reason the game doesn't start.
//
// Not shown for a deep link (?level=N, a shared ?code=XXXX): that player wants to play. ?nointro turns it off
// (tests, kiosks), and so does the reduced-motion setting, since the trailer flashes and shakes.

const INTRO_FADE_MS = 400;
const INTRO_START_TIMEOUT_MS = 6000; // no frame by then: give up and show the game

let introEl = null;
let introTimer = null;

function introWanted() {
    if (reduceMotion) return false;
    try {
        const p = new URLSearchParams(window.location.search);
        return !(p.has('level') || p.has('code') || p.has('nointro'));
    } catch (e) {
        return true;
    }
}

function introActive() {
    return !!introEl;
}

function closeIntro() {
    if (!introEl) return;
    const el = introEl;
    introEl = null;
    clearTimeout(introTimer);
    for (const type of INTRO_POINTER_EVENTS) window.removeEventListener(type, introPointer, true);
    window.removeEventListener('keydown', introKey, true);
    const v = el.querySelector('video');
    if (v) {
        v.pause();
        for (const s of v.querySelectorAll('source')) s.remove(); // let go of the file (and its memory)
        v.removeAttribute('src');
        v.load();
    }
    el.classList.add('closing');
    setTimeout(() => el.remove(), INTRO_FADE_MS);
}

function toggleIntroSound() {
    const v = introEl && introEl.querySelector('video');
    if (!v) return;
    v.muted = !v.muted;
    document.getElementById('intro-sound').textContent = v.muted ? 'SOUND: OFF' : 'SOUND: ON';
}

// Keys that must keep working while the trailer is up (browser shortcuts, fullscreen, reload), and bare modifiers
function introIgnoresKey(e) {
    return e.ctrlKey || e.metaKey || e.altKey || /^(Shift|Control|Alt|Meta|CapsLock|F\d+)$/.test(e.key);
}

function introKey(e) {
    if (introIgnoresKey(e)) return;
    e.preventDefault();
    e.stopImmediatePropagation(); // (the game's own key handlers never see it)
    closeIntro();
}

const INTRO_POINTER_EVENTS = ['pointerdown', 'pointerup', 'mousedown', 'mouseup', 'touchstart', 'touchend', 'click'];

// Everything aimed at the trailer stays there: a tap that skips it must not also be a tap on the game under it
function introPointer(e) {
    if (!introEl || !introEl.contains(e.target)) return;
    e.stopImmediatePropagation();
    if (e.type !== 'click') return;
    if (e.target.closest('#intro-sound')) toggleIntroSound();
    else closeIntro();
}

function initIntro() {
    const el = document.getElementById('intro');
    if (!el) return;
    if (!introWanted()) {
        el.remove();
        return;
    }
    const v = el.querySelector('video');
    v.muted = true;
    el.hidden = false;
    introEl = el;
    for (const type of INTRO_POINTER_EVENTS) window.addEventListener(type, introPointer, true);
    window.addEventListener('keydown', introKey, true);
    v.addEventListener('ended', closeIntro);
    v.addEventListener('error', closeIntro);
    const last = v.querySelector('source:last-of-type'); // a failed <source> reports on itself, not on the video
    if (last) last.addEventListener('error', closeIntro);
    v.addEventListener('playing', () => clearTimeout(introTimer), { once: true });
    // The file can fail (a missing file, offline) before this script runs, and then no error event is left to hear
    if (v.networkState === v.NETWORK_NO_SOURCE) {
        closeIntro();
        return;
    }
    introTimer = setTimeout(closeIntro, INTRO_START_TIMEOUT_MS);
    const started = v.play();
    if (started && started.catch) started.catch(closeIntro); // autoplay refused even when muted
}

initIntro();
