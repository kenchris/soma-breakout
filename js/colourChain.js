// === colourChain.js ===
// --- Colour Chain levels ---
// A level type in the spirit of the ghost rows, borrowed from Puyo Puyo and the match-3 games: every brick
// is one of a few bright colours, and so is the ball (the ring around it). Hitting a brick of the ball's
// OWN colour pops it together with every same-coloured brick connected to it, and bigger groups score far
// more. Hitting any other colour doesn't break anything: it repaints the ball that colour. After a pop the
// bricks above fall down into the gaps, and if the fall lines up four or more of one colour, they pop by
// themselves: a CHAIN, worth more for every link. So the game becomes choosing which colour to carry and
// where to spend it. A gold level-code brick pops whatever you're carrying; Explosive and Fire ignore
// colour and just blast through, and anything they break lets the rest fall too.

const CHAIN_UNLOCK = 11;            // curve level of the first one (level 16), then about 1 level in 5
const CHAIN_COLORS = ['#ff3b5c', '#ffd23f', '#3dfc8a', '#3d9bff', '#c46bff'];
const CHAIN_CASCADE_MIN = 4;
const chainLevelCache = {};
let chainRepaintTipShown = false;        // a group this big that the fall brought together pops by itself

function isChainLevel(l) {
    if (isTutorial(l) || isBossLevel(l) || curveLevel(l) < CHAIN_UNLOCK || isMazeLevel(l)) return false;
    if (chainLevelCache[l] === undefined) {
        chainLevelCache[l] = curveLevel(l) === CHAIN_UNLOCK || (seededRandom(l * 3571 + 29)() < 0.2 && !isChainLevel(l - 1));
    }
    return chainLevelCache[l];
}

// How many colours a chain level uses: four at first, five later on
function chainColorCount() {
    return curveLevel() >= 22 ? 5 : 4;
}

// Paint the level's bricks. Each brick often copies a neighbour's colour, so the wall starts with some
// clumps worth aiming for rather than pure noise.
function paintChainBricks() {
    const rand = seededRandom(level * 7727 + 41);
    const n = chainColorCount();
    for (let c = 0; c < BRICK_COLS; c++) {
        for (let r = 0; r < BRICK_ROWS; r++) {
            const brick = bricks[c][r];
            if (!brick.alive || brick.cheat) continue;
            let k = Math.floor(rand() * n);
            const left = c > 0 && bricks[c - 1][r].alive && bricks[c - 1][r].chainColor;
            const up = r > 0 && bricks[c][r - 1].alive && bricks[c][r - 1].chainColor;
            const roll = rand();
            if (left !== undefined && left !== false && roll < 0.25) k = left;
            else if (up !== undefined && up !== false && roll < 0.45) k = up;
            brick.chainColor = k;
            brick.color = CHAIN_COLORS[k];
            brick.points = 10;
        }
    }
}

// The colour a ball carries. A new ball (or one whose colour has been wiped off the board) picks one
// that's still there, so it never carries a colour nothing can use.
function ballChain(b) {
    if (b.chain === undefined || !chainColorAlive(b.chain)) {
        const left = [];
        for (const col of bricks) for (const br of col) if (br.alive && !br.cheat && !left.includes(br.chainColor)) left.push(br.chainColor);
        b.chain = left.length ? left[Math.floor(Math.random() * left.length)] : 0;
    }
    return b.chain;
}

function chainColorAlive(k) {
    for (const col of bricks) for (const br of col) if (br.alive && !br.cheat && br.chainColor === k) return true;
    return false;
}

// Every alive brick connected to (c, r) through same-coloured neighbours (4-way)
function chainGroup(c, r) {
    const k = bricks[c][r].chainColor;
    const seen = new Set([c * BRICK_ROWS + r]);
    const out = [[c, r]];
    for (let i = 0; i < out.length; i++) {
        const [cc, rr] = out[i];
        for (const [nc, nr] of [[cc + 1, rr], [cc - 1, rr], [cc, rr + 1], [cc, rr - 1]]) {
            if (nc < 0 || nc >= BRICK_COLS || nr < 0 || nr >= BRICK_ROWS || seen.has(nc * BRICK_ROWS + nr)) continue;
            const nb = bricks[nc][nr];
            if (!nb.alive || nb.cheat || nb.chainColor !== k) continue;
            seen.add(nc * BRICK_ROWS + nr);
            out.push([nc, nr]);
        }
    }
    return out;
}

// Pop a group; `link` is 0 for the one you hit, 1, 2... for the chain reactions after it
function popChainGroup(group, link, b) {
    const n = group.length;
    const mult = Math.min(Math.max(combo, 1), COMBO_MAX) * (doubleTimer > 0 ? 2 : 1) * (link + 1);
    const points = 5 * n * (n + 1) * mult; // 10, 30, 60, 100, 150 ... for groups of 1, 2, 3, 4, 5
    let sx = 0, sy = 0;
    for (const [c, r] of group) {
        const t = bricks[c][r];
        t.alive = false;
        sx += t.x + t.w / 2;
        sy += t.y + t.h / 2;
        spawnParticles(t.x + t.w / 2, t.y + t.h / 2, t.color, 6);
    }
    bricksLeft -= n;
    runStats.bricks += n;
    addScore(points);
    const cx = sx / n, cy = sy / n;
    const color = CHAIN_COLORS[bricks[group[0][0]][group[0][1]].chainColor];
    if (link > 0) {
        addPopup(Math.max(90, Math.min(cx, CANVAS_W - 90)), cy - 30, 'CHAIN ×' + (link + 1) + '!  +' + points, color, { size: 22 + 3 * Math.min(link, 4), life: 1.4, rise: 0.6, pop: true });
        noteMoment(40 + 15 * link, 'CHAIN ×' + (link + 1) + '!');
        addShake(5 + 2 * link);
        haptic([20, 20, 40], true);
    } else {
        addPopup(cx, cy, '+' + points + (n > 1 ? '  (' + n + ')' : ''), n >= 4 ? color : '#ffffff', { size: n >= 6 ? 20 : 16, pop: n >= 6, life: 1 });
        addShake(1.5 + Math.min(n, 10) * 0.5);
        haptic(n >= 4 ? [12, 20, 12] : 8, n >= 4);
    }
    if (n >= 8) noteMoment(30 + n * 2, 'MEGA POP!');
    // A rising arpeggio: longer for bigger groups, higher for later links
    const base = 392 * Math.pow(2, Math.min(link, 6) / 6);
    for (let i = 0; i < Math.min(n, 6); i++) tone(base * Math.pow(2, i / 5), 0.08, { type: 'triangle', vol: 0.16, delay: i * 0.035, key: i === 0 ? 'chainPop' : null, force: i > 0 });
    // A big pop is worth a drop
    if (Math.random() < Math.min(0.1 + 0.04 * n, 0.5)) spawnPowerup(cx, cy);
}

// Everything falls down into the gaps. Returns the cells that received a brick.
function chainGravity() {
    const landed = [];
    for (let c = 0; c < BRICK_COLS; c++) {
        let to = BRICK_ROWS - 1;
        for (let r = BRICK_ROWS - 1; r >= 0; r--) {
            const from = bricks[c][r];
            if (!from.alive) continue;
            if (r !== to) {
                const dest = bricks[c][to];
                for (const k of ['color', 'chainColor', 'points', 'cheat', 'tnt', 'steel', 'hitsLeft', 'maxHits', 'crack', 'sprite']) dest[k] = from[k];
                dest.alive = true;
                dest.flash = 0;
                dest.dy = (from.dy || 0) + (to - r) * BRICK_H; // drawn sliding down into place
                from.alive = false;
                from.dy = 0;
                landed.push([c, to]);
            }
            to--;
        }
    }
    return landed;
}

// After a pop: let the wall fall, and pop any big same-colour group the fall made, again and again
function settleChain() {
    for (let link = 1; link < 12; link++) {
        const landed = chainGravity();
        const popped = new Set();
        let any = false;
        for (const [c, r] of landed) {
            const t = bricks[c][r];
            if (!t.alive || t.cheat || popped.has(c * BRICK_ROWS + r)) continue;
            const group = chainGroup(c, r);
            group.forEach(([gc, gr]) => popped.add(gc * BRICK_ROWS + gr));
            if (group.length < CHAIN_CASCADE_MIN) continue;
            popChainGroup(group, link);
            any = true;
        }
        if (!any) return;
    }
}

// A ball hitting brick (c, r) on a chain level. Returns true when it handled the hit (the normal brick
// rules take over for the gold code brick, and for Explosive and Fire).
function chainBallHit(b, c, r, hit) {
    const brick = bricks[c][r];
    if (brick.cheat || explosiveReady || fireTimer > 0) return false;
    const speed = Math.hypot(b.vx, b.vy);
    const f = Math.min(speed * 1.02, 10) / speed;
    b.vx *= f;
    b.vy *= f;
    bounceOffRect(b, brick.x, brick.y, brick.w, brick.h, hit);
    if (brick.chainColor !== ballChain(b)) {
        // Not your colour: the ball takes this one instead
        b.chain = brick.chainColor;
        brick.flash = 6;
        spawnParticles(b.x, b.y, brick.color, 5);
        tone(300 + 60 * brick.chainColor, 0.06, { type: 'square', vol: 0.12, key: 'repaint' });
        if (!chainRepaintTipShown) { // the first repaint of a session spells out the rule once
            chainRepaintTipShown = true;
            addPopup(CANVAS_W / 2, 300, 'SAME COLOUR POPS. OTHER COLOURS REPAINT THE BALL', '#ffffff', { size: 20, life: 2.6, rise: 0.15, pop: true });
        }
        return true;
    }
    combo++;
    runStats.maxCombo = Math.max(runStats.maxCombo, combo);
    if (combo >= 3 && combo <= COMBO_MAX) comboShout(combo, brick.x + brick.w / 2, brick.y + brick.h / 2);
    popChainGroup(chainGroup(c, r), 0, b);
    settleChain();
    if (bricksLeft <= 0) completeLevel();
    return true;
}

// Guided ball: a shot is worth the group it would pop (a repaint is worth a little: it's progress)
function chainHitValue(c, r) {
    const t = bricks[c][r];
    if (t.cheat) return 40;
    const carried = balls.length ? ballChain(balls[0]) : -1;
    if (t.chainColor !== carried) return 3;
    const n = chainGroup(c, r).length;
    return 5 * n * (n + 1);
}

// The ball's colour: a bright ring round it
function drawChainRings() {
    ctx.save();
    ctx.lineWidth = 3;
    for (const b of balls) {
        ctx.strokeStyle = CHAIN_COLORS[ballChain(b)];
        ctx.beginPath();
        ctx.arc(b.x, b.y, b.r + 4, 0, Math.PI * 2);
        ctx.stroke();
    }
    ctx.restore();
}

function tickChainFall() {
    for (const col of bricks) for (const br of col) if (br.dy > 0) br.dy = Math.max(0, br.dy - 4);
}
