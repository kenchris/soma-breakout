# Neon Smash: notes for Claude

A neon breakout game in plain HTML/JS: no build step, no dependencies. `index.html` loads `js/*.js` as
classic scripts that share one global scope (the load order at the bottom of `index.html` matters).

## Before every commit / PR: run the tests

```
node tests/run.mjs            # everything, ~20s
node tests/run.mjs gorilla    # just the tests whose name contains "gorilla"
```

`tests/run.mjs` serves the repo itself and drives the real game in headless Chromium (Playwright; no
install needed in the Claude cloud environment). It steps the fixed-timestep simulation directly, so
minutes of play take a second. **All tests must pass before pushing.** If one fails, fix the cause; never
loosen a test just to get it green unless the test itself was wrong (and say so in the PR).

### Every fix and feature gets a test

When fixing a bug a player reported, first add a test that fails on the old code, then fix it, and check the
test now passes. Tests that were added this way (do not remove them):

- **Hammer never dropped** in the Space Gorilla fight: only smashed barrels counted toward it, but in normal
  play barrels are knocked back, not smashed.
- **HAMMER TIME felt like a normal ball**: now it's a short (6s) punch-out; every paddle hit punches the ball
  at the gorilla (>2x speed, homing, past the princess) for 3 damage, then it drops back.
- **Gorilla's barrels too easy to avoid**: wild throws about twice as fast, and the drop off the bottom
  girder takes about half a second.
- **Warp rift never seen**: too rare, too small and too short-lived on a phone.
- **Canvas jumping down on phones**: HUD chips re-wrapping when the score grew or the ASSIST chip appeared.
- **Secret code on touch only worked on part of the screen**: a swipe starting on the pause dialog (it can
  scroll) gets its pointer events cancelled by the browser, so touch input is read from touch events, and
  the test uses real touches (CDP), not synthetic events. B/A taps must not resume the paused game.
- **Secret code only spent when the warp is taken**: a rift it opened that closes unused, ends with the level,
  or gets a Stay gives the code back.
- **No warp rifts on boss levels** (random, from a downed alien, or the secret code).
- **Dialogs block the page under them**: on a phone the game's dialog (#overlay) is centred on the screen
  with an invisible #dialog-shield under it, so the level-code list can't scroll and nothing under it can be
  pressed. The secret code works whenever any dialog is up. The touch test aims at the part of the list the
  dialog doesn't cover (it fails without the shield).
- Assist tiers / score scaling, helpful drops, 5 lives + boss refill, level-code round-trip, Space Chomp
  clearable, every boss runs without errors.

Test helpers available inside `page.evaluate` (see `installHelpers`): `T.step()`, `T.play(seconds, until,
{ immortal })` (an autopilot), `T.count('fnName')`.

## House rules

- **Release number**: bump `APP_RELEASE` in `js/version.js` in every PR that changes the game. It's shown
  in the bottom-right corner so a tester can tell which version their phone is running, and a test fails
  if game files changed against origin/main without a bump.

- **Line endings**: most `js/*.js` files and `index.html` are CRLF. Preserve whatever a file uses; don't
  convert it. (Python edits that read text mode silently turn CRLF into LF across the whole file.)
- **New `js/*.js` file**: add its `<script>` tag in the right place in `index.html`, add it to the file list
  in `sw.js`, and bump `CACHE_VERSION` there.
- **Level codes** (`levelToCode` / `codeToLevel` in `level.js`) are shared by players: never change what a
  level's code is.
- **Points** all go through `addScore` (`fx.js`), which applies the assist multiplier. Don't add to `score`
  directly.
- **Paddle width**: use `paddleBaseW()` (assist can widen it), not `PADDLE_W`.
- **Timing**: gameplay runs on the fixed 60 Hz step (`fixedStep`); use step counters, not
  `performance.now()`, for anything that affects play. Movement is multiplied by `timeScale` (Time Warp).
- Comments explain *why*, in the same plain style as the surrounding code.
- Never put copyrighted names/designs in the game (it's "Neon Smash", "Space Gorilla", "space jellies").

## Manual play-test levels

Type the code into the level-code box, or open `?code=XXXX` (or `?level=N`).

| Level | Code | What |
|---|---|---|
| 1 | 7XK5 | tutorial start |
| 6 | 9G0K | first real level |
| 9 | 14JT9 | bumpers debut |
| 10 | EQTC | Mega Invader boss |
| 12 | RJP6 | ghost rows debut |
| 14 | AA9O | Colour Chain debut |
| 15 | WRCJ | The Rival boss |
| 19 | 56R3 | Space Chomp debut |
| 20 | RNTU | Snake boss |
| 22 | AHK4 | Space Chomp again |
| 25 | 1455P | Asteroid Field boss |
| 30 | 9VKC | Space Gorilla boss (barrels, ladders, HAMMER TIME, princess) |

Add `?perf` to any URL for a frame-time readout.
