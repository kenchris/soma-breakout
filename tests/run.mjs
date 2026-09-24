// Regression tests for Neon Smash. Run from the repo root:
//
//     node tests/run.mjs            (all tests)
//     node tests/run.mjs hammer     (only tests whose name contains "hammer")
//
// No install step: it serves the repo itself on a free port and drives the real game in headless Chromium
// through Playwright (found from the normal module path, or a global install). Each test loads the page
// fresh, then steps the game's fixed-timestep simulation directly (fixedStep) instead of waiting on real
// frames, so minutes of play take seconds. Exit code 1 if anything fails.
//
// Every bug fixed and every feature added should get a test here (see CLAUDE.md).

import http from 'node:http';
import fs from 'node:fs';
import path from 'node:path';
import { createRequire } from 'node:module';
import { fileURLToPath } from 'node:url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');

function loadPlaywright() {
    const tries = [import.meta.url, '/opt/node22/lib/node_modules/', '/usr/local/lib/node_modules/', '/usr/lib/node_modules/'];
    for (const base of tries) {
        try { return createRequire(base.endsWith('/') ? base : base)('playwright'); } catch (e) { /* next */ }
    }
    console.error('Playwright not found. Install it (npm i -g playwright) or run where it is available.');
    process.exit(2);
}

function findChromium() {
    if (process.env.CHROMIUM_PATH) return process.env.CHROMIUM_PATH;
    const base = '/opt/pw-browsers';
    if (!fs.existsSync(base)) return undefined; // let Playwright use its own download
    for (const d of fs.readdirSync(base).filter(d => d.startsWith('chromium')).sort().reverse()) {
        for (const p of ['chrome-linux/chrome', 'chrome-linux64/chrome']) {
            const full = path.join(base, d, p);
            if (fs.existsSync(full)) return full;
        }
    }
    return undefined;
}

const TYPES = { '.html': 'text/html', '.js': 'text/javascript', '.json': 'application/json', '.png': 'image/png', '.svg': 'image/svg+xml' };

function serve() {
    const server = http.createServer((req, res) => {
        const url = new URL(req.url, 'http://x');
        let file = path.join(ROOT, decodeURIComponent(url.pathname));
        if (!file.startsWith(ROOT)) { res.writeHead(403); return res.end(); }
        if (fs.existsSync(file) && fs.statSync(file).isDirectory()) file = path.join(file, 'index.html');
        if (!fs.existsSync(file)) { res.writeHead(404); return res.end(); }
        res.writeHead(200, { 'content-type': TYPES[path.extname(file)] || 'application/octet-stream', 'cache-control': 'no-store' });
        fs.createReadStream(file).pipe(res);
    });
    return new Promise(r => server.listen(0, '127.0.0.1', () => r(server)));
}

// --- In-page helpers, installed on every test page as window.T ---
function installHelpers() {
    window.requestAnimationFrame = () => 0; // the tests drive the simulation themselves
    try { localStorage.clear(); } catch (e) { /* none */ }
    const T = window.T = {};
    T.step = () => { snapshotMovers(); fixedStep(); tickFx(); };
    // Autopilot: keeps the paddle under the lowest falling ball, launches, dismisses cards and dialogs.
    // opts.immortal keeps lives topped up; returns when until() is true, the game is lost, or time runs out.
    T.play = (seconds, until = () => false, opts = {}) => {
        const steps = seconds * 60;
        let s = 0;
        for (; s < steps; s++) {
            if (opts.immortal) lives = Math.max(lives, 3);
            if (introCard) introCard = null;
            if (typeof warpOffer !== 'undefined' && warpOffer) declineWarp();
            if (gameState === 'paused') hideModal();
            if (gameState === 'ready' || gameState === 'won') { hideOverlay(); launchGame(); }
            if (gameState === 'lost') break;
            const t = balls.filter(b => b.vy > 0).sort((a, b) => b.y - a.y)[0] || balls[0];
            if (t) paddle.x = Math.max(0, Math.min(CANVAS_W - paddle.w, t.x - paddle.w / 2 + Math.sin(s / 31) * 25));
            T.step();
            if (until()) break;
        }
        return s / 60;
    };
    // Counts calls to a global function (by name) from now on
    T.count = (name) => {
        const f = window[name];
        const c = { n: 0 };
        window[name] = (...a) => { c.n++; return f(...a); };
        return c;
    };
}

// The game has started (initGame has run resetGame: the paddle and the level plan exist)
const READY = () => typeof paddle !== 'undefined' && !!paddle && typeof plan !== 'undefined' && !!plan;

// --- Tests ---
// Each: { name, url (query string), viewport?, run: async (page, check) => {} }.
// check(cond, message) records a failure without stopping the test.

const tests = [];
const test = (name, url, run, viewport) => tests.push({ name, url, run, viewport });

test('smoke: key levels load, render and play 20s without errors', '', async (page, check) => {
    for (const lv of [1, 6, 9, 10, 12, 14, 15, 19, 20, 22, 25, 30]) {
        await page.goto(page.baseUrl + '?level=' + lv);
        await page.waitForFunction(READY);
        const r = await page.evaluate(() => { installHelpers(); T.play(20, () => false, { immortal: true }); render(); return level; });
        check(r >= 1, 'level ' + lv + ' ran');
    }
});

test('level codes: round-trip for levels 1-80, known codes unchanged', '', async (page, check) => {
    const bad = await page.evaluate(() => {
        const out = [];
        for (let l = 1; l <= 80; l++) if (codeToLevel(levelToCode(l)) !== l) out.push(l);
        return out;
    });
    check(bad.length === 0, 'codes that do not decode back: ' + bad.join(', '));    // The play-test table in CLAUDE.md: players share these, so they must never change
    const table = { 1: '7XK5', 6: '9G0K', 9: '14JT9', 10: 'EQTC', 12: 'RJP6', 14: 'AA9O', 15: 'WRCJ', 19: '56R3', 20: 'RNTU', 22: 'AHK4', 25: '1455P', 30: '9VKC' };
    const wrong = await page.evaluate(t => Object.entries(t).filter(([l, c]) => levelToCode(+l) !== c || codeToLevel(c) !== +l).map(([l]) => l), table);
    check(wrong.length === 0, 'level codes changed for levels: ' + wrong.join(', '));
});

test('lives: start with 5, cap 6, a boss win refills to 5', '?level=10', async (page, check) => {
    const r = await page.evaluate(() => {
        installHelpers();
        const out = { start: lives };
        lives = 2; winBossLevel('#fff'); out.afterLow = lives;
        boss = { n: 1 }; plan.boss = true; lives = 5; winBossLevel('#fff'); out.afterFull = lives;
        return out;
    });
    check(r.start === 5, 'starts with 5 lives, got ' + r.start);
    check(r.afterLow === 5, 'boss win at 2 lives refills to 5, got ' + r.afterLow);
    check(r.afterFull === 6, 'boss win at 5 lives gives 6, got ' + r.afterFull);
});

test('assist: steps up after 2 lost balls, scales points, eases on a clean clear', '?level=8', async (page, check) => {
    const r = await page.evaluate(() => {
        installHelpers();
        launchGame();
        loseLife(); const t1 = assistTier;
        loseLife(); const t2 = assistTier;
        const s = score; addScore(100); const pts = score - s;
        completeLevel(); const afterDirty = assistTier; // this level lost balls: no easing
        completeLevel(); const afterClean = assistTier;
        setAssistAuto(false); const off = assistTier;
        return { t1, t2, pts, afterDirty, afterClean, off };
    });
    check(r.t1 === 0 && r.t2 === 1, 'tier after 1 and 2 losses: ' + r.t1 + ', ' + r.t2);
    check(r.pts === 80, 'tier 1 scores 80 of 100, got ' + r.pts);
    check(r.afterDirty === 1, 'clear with lost balls keeps the tier, got ' + r.afterDirty);
    check(r.afterClean === 0, 'clean clear eases the tier, got ' + r.afterClean);
    check(r.off === 0, 'switching assist off resets the tier');
});

test('assist: the whole game slows down (steps per real second)', '?level=8', async (page, check) => {
    const n = await page.evaluate(async () => {
        setAssistTier(2, false);
        hideOverlay();
        let n = 0; const f = window.fixedStep; window.fixedStep = () => { n++; f(); };
        await new Promise(r => setTimeout(r, 1500));
        return n / 1.5;
    });
    check(n > 40 && n < 53, 'tier 2 should run ~47 steps/s, got ' + n.toFixed(1));
});

test('helpful drops: more +Life when low, Wide/Slow by kind of miss', '?level=12', async (page, check) => {
    const r = await page.evaluate(() => {
        installHelpers();
        const share = (type) => { const l = unlockedPowerups(); const w = l.reduce((s, p) => s + p.weight, 0); return l.find(p => p.type === type).weight / w; };
        const out = {};
        lives = 5; out.life5 = share('life');
        lives = 1; out.life1 = share('life');
        lives = 5; paddle.x = 300;
        const w0 = share('wide'), s0 = share('slow');
        noteMiss({ x: paddle.x + paddle.w + 30, y: CANVAS_H + 5, vx: 1, vy: 5 }); out.wideUp = share('wide') > w0;
        noteMiss({ x: 850, y: CANVAS_H + 5, vx: 1, vy: 5 }); out.slowUp = share('slow') > s0;
        return out;
    });
    check(r.life1 > r.life5 * 3, '+Life should be much more likely on the last heart: ' + r.life5.toFixed(3) + ' -> ' + r.life1.toFixed(3));
    check(r.wideUp, 'a near miss makes Wide more likely');
    check(r.slowUp, 'a far miss makes Slow more likely');
});

test('space gorilla: hitting barrels back drops a hammer (3rd always)', '?level=30', async (page, check) => {
    const r = await page.evaluate(() => {
        installHelpers();
        T.play(8, () => false, { immortal: true }); // past the intro
        const out = {};
        for (let i = 0; i < 3; i++) {
            const br = { x: 300 + i * 50, y: 400, vx: 0, vy: 0, g: 0, state: 'fall', spin: 0 };
            boss.barrels.push(br);
            kickBarrel(br, 0, -1);
        }
        out.hammers = boss.hammers.length;
        out.hammerY = boss.hammers[0] && boss.hammers[0].y;
        // and in real play: the autopilot should get HAMMER TIME at least once in 3 minutes
        boss.hammers.length = 0; boss.smashed = 0; boss.hammerTime = 0;
        let got = 0;
        T.play(180, () => { if (boss && boss.hammerTime > 0) got++; return got > 0 || !boss; }, { immortal: true });
        out.playGot = got > 0 || !boss;
        return out;
    });
    check(r.hammers === 1, 'three knocked-back barrels drop one hammer, got ' + r.hammers);
    check(r.hammerY <= 460, 'the hammer starts high enough to see, y=' + r.hammerY);
    check(r.playGot, 'autopilot never got HAMMER TIME in 3 minutes of play');
});

test('warp rift: opens within ~2 minutes of play and is reachable', '?level=8', async (page, check) => {
    // The timer only runs while a rift is allowed (not while portals are open, not with the level nearly
    // cleared...), so give it a worst case of 8s grace + ~52s interval, doubled for blocked time
    const r = await page.evaluate(() => {
        installHelpers();
        let opened = false;
        const secs = T.play(150, () => { if (warpRift) opened = true; return opened; }, { immortal: true });
        return { opened, secs, r: WARP_R, life: WARP_LIFE_FRAMES };
    });
    check(r.opened, 'no warp rift in 150s of play');
    check(r.r >= 36 && r.life >= 600, 'rift big and long-lived enough to reach');
});

test('secret code (keyboard): opens a warp rift once per game', '?level=8', async (page, check) => {
    await page.evaluate(() => { installHelpers(); T.play(3, () => false, { immortal: true }); warpRift = null; portals = null; });
    const keys = ['ArrowUp', 'ArrowUp', 'ArrowDown', 'ArrowDown', 'ArrowLeft', 'ArrowRight', 'ArrowLeft', 'ArrowRight', 'b', 'a'];
    for (const k of keys) await page.keyboard.press(k);
    const first = await page.evaluate(() => !!warpRift);
    await page.evaluate(() => { warpRift = null; });
    for (const k of keys) await page.keyboard.press(k);
    const second = await page.evaluate(() => !!warpRift);
    check(first, 'the code should open a warp rift');
    check(!second, 'the code works only once per game');
    const again = await page.evaluate(() => { resetGame(8); return secretUsed; });
    check(!again, 'a new game gets the code back');
});

test('secret code (touch): pause, swipe, tap B then A, from anywhere on the screen', '?level=8', async (page, check) => {
    // Real touch input through the browser (CDP), not synthetic events: a swipe that starts on the pause
    // dialog gets its pointer events cancelled by the browser (the dialog can scroll), which synthetic
    // events never show. Each area of the screen is tried: HUD, canvas, the pause dialog, below, thumb pad.
    const cdp = await page.context().newCDPSession(page);
    const touch = (type, x, y) => cdp.send('Input.dispatchTouchEvent', { type, touchPoints: type === 'touchEnd' ? [] : [{ x, y }] });
    const wait = ms => new Promise(r => setTimeout(r, ms));
    const swipe = async (x, y, dx, dy) => {
        await touch('touchStart', x, y);
        for (let i = 1; i <= 6; i++) { await touch('touchMove', x + dx * i / 6, y + dy * i / 6); await wait(16); }
        await touch('touchEnd');
        await wait(30);
    };
    const tap = async (x, y) => { await touch('touchStart', x, y); await wait(40); await touch('touchEnd'); await wait(80); };
    await page.evaluate(() => { installHelpers(); T.play(3, () => false, { immortal: true }); });
    for (const [name, y] of [['HUD', 60], ['canvas', 170], ['pause dialog', 420], ['below the canvas', 560], ['thumb pad', 800]]) {
        await page.evaluate(() => { hideOverlay(); gameState = 'playing'; warpRift = null; portals = null; secretUsed = false; secretProgress = 0; togglePause(); });
        for (const [dx, dy] of [[0, -80], [0, -80], [0, 80], [0, 80], [-80, 0], [80, 0], [-80, 0], [80, 0]]) await swipe(195, y, dx, dy);
        const afterSwipes = await page.evaluate(() => ({ p: secretProgress, s: gameState }));
        await tap(60, y);  // B: left half
        await tap(330, y); // A: right half
        const r = await page.evaluate(() => ({ rift: !!warpRift, s: gameState }));
        check(afterSwipes.p === 8 && afterSwipes.s === 'paused', name + ': swipes should all count and keep the game paused (' + JSON.stringify(afterSwipes) + ')');
        check(r.rift, name + ': the code should open a warp rift');
        check(r.s === 'paused', name + ': the B/A taps must not resume the game');
    }
    await wait(600);
    await tap(195, 420); // an ordinary tap afterwards resumes as usual
    check(await page.evaluate(() => gameState) === 'playing', 'a normal tap afterwards should resume');
}, { width: 390, height: 844, isMobile: true, hasTouch: true });

test('secret code: not used up where no rift can open (tutorial)', '?level=2', async (page, check) => {
    await page.evaluate(() => { installHelpers(); T.play(3, () => false, { immortal: true }); });
    for (const k of ['ArrowUp', 'ArrowUp', 'ArrowDown', 'ArrowDown', 'ArrowLeft', 'ArrowRight', 'ArrowLeft', 'ArrowRight', 'b', 'a']) await page.keyboard.press(k);
    const r = await page.evaluate(() => ({ rift: !!warpRift, used: secretUsed }));
    check(!r.rift && !r.used, 'tutorial: no rift, code not spent');
});

test('warp rift: never on a boss level (random, alien bonus or secret code)', '', async (page, check) => {
    for (const lv of [10, 15, 20, 25, 30]) {
        await page.goto(page.baseUrl + '?level=' + lv);
        await page.waitForFunction(READY);
        const r = await page.evaluate(() => {
            installHelpers();
            let seen = false;
            warpTimer = 1; // due right away
            T.play(180, () => { if (warpRift) seen = true; return seen || !plan.boss; }, { immortal: true });
            const canAlien = plan.boss ? canSpawnWarp() : false;
            return { seen, canAlien, secretOk: plan.boss ? canOpenSecretRift() : false };
        });
        check(!r.seen, 'level ' + lv + ': a warp rift opened in the boss fight');
        check(!r.canAlien, 'level ' + lv + ': a downed alien could open a rift');
        check(!r.secretOk, 'level ' + lv + ': the secret code could open a rift');
    }
});

test('space chomp: autopilot clears level 19', '?level=19', async (page, check) => {
    const r = await page.evaluate(() => {
        installHelpers();
        const start = level;
        const secs = T.play(480, () => level !== 19, { immortal: true });
        return { start, level, secs };
    });
    check(r.start === 19, 'did not start on level 19 but ' + r.start);
    check(r.level === 20, 'level 19 not cleared in 8 minutes (still level ' + r.level + ')');
});

test('phone HUD: the canvas never moves when chips change', '?level=6', async (page, check) => {
    for (const [w, h] of [[320, 568], [360, 740], [375, 667], [390, 844], [430, 932]]) {
        await page.setViewportSize({ width: w, height: h });
        await page.goto(page.baseUrl + '?level=6');
        await page.waitForTimeout(300);
        const tops = await page.evaluate(async () => {
            const frame = () => new Promise(r => setTimeout(r, 50));
            const top = () => Math.round(document.getElementById('canvas').getBoundingClientRect().top);
            await frame();
            const out = [top()];
            hideOverlay();
            score = 9999999; bestScore = 9999999; level = 123; combo = 12; updateHUD(); await frame(); out.push(top());
            setAssistTier(3, false); await frame(); out.push(top());
            lives = 6; updateHUD(); await frame(); out.push(top());
            return out;
        });
        check(new Set(tops).size === 1, w + 'x' + h + ' canvas top moved: ' + tops.join(' -> '));
    }
}, { width: 390, height: 844, isMobile: true, hasTouch: true });

test('bosses: every boss fight runs 60s without errors', '', async (page, check) => {
    for (const lv of [10, 15, 20, 25, 30]) {
        await page.goto(page.baseUrl + '?level=' + lv);
        await page.waitForFunction(READY);
        const kind = await page.evaluate(() => { installHelpers(); const was = plan.boss; T.play(60, () => !boss, { immortal: true }); return was; });
        check(kind, 'level ' + lv + ' is a boss level');
    }
});

// --- Runner ---
const filter = process.argv[2] || '';
const { chromium } = loadPlaywright();
const server = await serve();
const baseUrl = 'http://127.0.0.1:' + server.address().port + '/index.html';
const browser = await chromium.launch({ executablePath: findChromium() });
let failed = 0;
const t0 = Date.now();
for (const t of tests.filter(t => t.name.includes(filter))) {
    const vp = t.viewport || { width: 1000, height: 800 };
    const page = await browser.newPage({ viewport: { width: vp.width, height: vp.height }, isMobile: !!vp.isMobile, hasTouch: !!vp.hasTouch });
    page.baseUrl = baseUrl;
    const errors = [];
    const fails = [];
    page.on('pageerror', e => errors.push(e.message));
    await page.addInitScript(installHelpers.toString() + ';window.installHelpers = installHelpers;');
    const started = Date.now();
    try {
        await page.goto(baseUrl + t.url);
        await page.waitForFunction(READY);
        await t.run(page, (ok, msg) => { if (!ok) fails.push(msg); });
    } catch (e) {
        fails.push('threw: ' + e.message.split('\n')[0]);
    }
    for (const e of errors) fails.push('page error: ' + e);
    const secs = ((Date.now() - started) / 1000).toFixed(1);
    if (fails.length) {
        failed++;
        console.log('FAIL  ' + t.name + '  (' + secs + 's)');
        for (const f of fails) console.log('        - ' + f);
    } else {
        console.log('ok    ' + t.name + '  (' + secs + 's)');
    }
    await page.close();
}
await browser.close();
server.close();
console.log((failed ? failed + ' failed' : 'all passed') + ' in ' + ((Date.now() - t0) / 1000).toFixed(0) + 's');
process.exit(failed ? 1 : 0);
