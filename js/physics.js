// === physics.js ===
// Shared ball-vs-shape helpers. Bricks, sliding walls, crates, ghost cells and bumpers all used to carry
// their own copy of the same circle-vs-box maths, each with slightly different rounding of the edge cases
// (which side wins on an exact tie, what happens when the ball's centre is already inside). One copy here
// keeps them all behaving the same way.

// Circle vs axis-aligned box: the ball centre's offset from the closest point of the box, or null when
// they don't overlap. (Only allocates on an actual contact.)
function rectContact(b, x, y, w, h) {
    const dx = b.x - Math.max(x, Math.min(b.x, x + w));
    const dy = b.y - Math.max(y, Math.min(b.y, y + h));
    const d2 = dx * dx + dy * dy;
    return d2 < b.r * b.r ? { dx, dy, d2 } : null;
}

// Bounce the ball off a box it touches (hit from rectContact) and push it clear, so a surface can never
// register the same contact again on the next step. Velocity is set by direction rather than flipped, so
// a ball already heading away is never turned back into the box. When the centre is already inside (a
// fast ball), the ball is sent back out the way it came.
function bounceOffRect(b, x, y, w, h, hit) {
    if (Math.abs(hit.dx) > Math.abs(hit.dy)) {
        const dir = hit.dx > 0 ? 1 : -1;
        b.vx = dir * Math.abs(b.vx);
        b.x = dir > 0 ? x + w + b.r : x - b.r;
    } else {
        const dir = hit.dy > 0 ? 1 : hit.dy < 0 ? -1 : (b.vy > 0 ? -1 : 1);
        b.vy = dir * Math.abs(b.vy);
        b.y = dir > 0 ? y + h + b.r : y - b.r;
    }
}

// Circle vs circle (bumpers): when they touch, push the ball clear of the obstacle and, if it was heading
// in, reflect its velocity about the contact normal. Returns null when they don't touch, else whether it
// actually bounced (a ball shoved in from behind while already moving away just gets pushed out).
function bounceOffCircle(b, cx, cy, radius) {
    const dx = b.x - cx;
    const dy = b.y - cy;
    const reach = radius + b.r;
    const d2 = dx * dx + dy * dy;
    if (d2 >= reach * reach) return null;
    const d = Math.sqrt(d2);
    const nx = d > 0 ? dx / d : 0; // dead centre (never in practice): out the top
    const ny = d > 0 ? dy / d : -1;
    const along = b.vx * nx + b.vy * ny;
    if (along < 0) {
        b.vx -= 2 * along * nx;
        b.vy -= 2 * along * ny;
    }
    b.x = cx + nx * (reach + 0.5);
    b.y = cy + ny * (reach + 0.5);
    return { bounced: along < 0 };
}

// Weighted random pick from a list of { weight } entries
function weightedPick(list) {
    let roll = Math.random() * list.reduce((sum, p) => sum + p.weight, 0);
    for (const p of list) {
        roll -= p.weight;
        if (roll < 0) return p;
    }
    return list[list.length - 1];
}

// Remove the entries of arr that fail keep(), in place and in order: one pass, where splicing each dead
// entry out shifted the rest of the array along every time (a 220-particle burst ending together did
// ~24,000 moves in one step)
function keepWhere(arr, keep) {
    let j = 0;
    for (let i = 0; i < arr.length; i++) {
        if (keep(arr[i])) arr[j++] = arr[i];
    }
    arr.length = j;
}
