// === music.js ===
// Procedural synthwave soundtrack, and the sound settings behind the speaker button's dialog.
//
// No audio files: a small step sequencer schedules every note with Web Audio, so there's nothing to load
// or license, and it keeps working offline like the rest of the game. Notes are queued a little ahead on
// the audio clock (a "lookahead" scheduler driven by a timer), so timing stays tight even when a frame
// runs long. Ordinary levels rotate through four upbeat, spacey tunes (pumping pads, a space echo, risers
// into each phrase); each boss has its own theme (faster, darker, with a driving bass and busier drums, plus
// a lead riff once the boss is down to its last third). Every tune plays a 16-bar A A B A form, and a
// change of tune waits for the next bar line, so it lands on the beat.
//
// Music and sound effects run through their own gain nodes (see ensureAudio in audio.js), so each has an
// on/off switch and a volume; the M key still mutes everything, vibration included.

const MUSIC_LOOKAHEAD = 0.12;  // seconds of notes queued ahead of the audio clock
const MUSIC_TICK_MS = 25;      // how often the scheduler tops the queue up
const MUSIC_MAX_GAIN = 0.9;    // the music bus's ceiling (a full mix peaks around 0.3, well clear of clipping)
const SFX_MAX_GAIN = 1;

const audioSettings = { musicOn: true, sfxOn: true, music: 60, sfx: 80, muted: false };
try {
    Object.assign(audioSettings, JSON.parse(localStorage.getItem('breakout-audio')) || {});
} catch (e) {
    // Storage unavailable or corrupt: defaults it is
}
isMuted = !!audioSettings.muted;

function saveAudioSettings() {
    audioSettings.muted = isMuted;
    try {
        localStorage.setItem('breakout-audio', JSON.stringify(audioSettings));
    } catch (e) {
        // Storage unavailable; settings just won't persist
    }
}

const volCurve = v => Math.pow(Math.max(0, Math.min(100, v)) / 100, 2); // sliders feel even to the ear

function musicLevel() {
    if (isMuted || !audioSettings.musicOn) return 0;
    return volCurve(audioSettings.music) * MUSIC_MAX_GAIN * (gameState === 'paused' ? 0.35 : 1); // ducked while paused
}

function sfxLevel() {
    return isMuted || !audioSettings.sfxOn ? 0 : volCurve(audioSettings.sfx) * SFX_MAX_GAIN;
}

// Push the current settings into the gain nodes (smoothly, so a slider drag doesn't click)
function applyAudioSettings() {
    if (audioCtx && musicGain && sfxGain) {
        musicGain.gain.setTargetAtTime(musicLevel(), audioCtx.currentTime, 0.05);
        sfxGain.gain.setTargetAtTime(sfxLevel(), audioCtx.currentTime, 0.02);
    }
    updateSoundButton();
}

function updateSoundButton() {
    const btn = document.getElementById('mute-btn');
    if (!btn) return;
    const silent = isMuted || (musicLevel() === 0 && sfxLevel() === 0);
    btn.classList.toggle('active', silent);
    btn.title = 'Sound & music (M mutes all)';
}

// --- The tunes ---
// Chords are MIDI note numbers, one per bar. Each tune has two 4-bar sections, A and B, played A A B A
// (16 bars) with a snare fill closing the loop, so it isn't one short phrase over and over. The bass plays
// each chord's root down in the 2nd octave; the arpeggio walks `arp` (chord-tone indices, one per 16th)
// an octave or two up, switching to `arpB` in the B section.
//   bass: 'drive8' straight root 8ths (the classic synthwave drive) | 'octaves8' pumping 8ths with
//         octave jumps | 'offbeat8' root, then octaves on the off-beats | 'drive16' relentless 16ths |
//         'long' held half-bar notes
//   bass 'seq16': Moroder-style sequencer 16ths, root and octave, its filter opening over every 4 bars
//   arp indices 3-5 are the chord's notes an octave up, for arpeggios that climb across two octaves
//   pad: true for a soft triangle chord, 'saw' for a wide pair of detuned saws; bigSnare: an 80s snare
//         with a long gated tail; melody: an optional lead line per section, one array of 16 steps per bar
//         (a MIDI note, held until the next one or the end of the bar; _ for a rest/hold)
//   pump: the pad ducks on every kick and swells back (the "sidechain pump" of dance music); echo: how
//         much of the arp and melody feeds the dotted-8th space echo; fx: a noise riser into every 4th bar
//         and a crash on each new phrase
// Ordinary levels rotate through NORMAL_TUNES; each boss has its own theme, with a lead riff on top once
// the boss is down to its last third.
const _ = null; // a rest (in arpeggios) or a held note (in melodies)
const NORMAL_TUNES = [
    { name: 'Star Chase', bpm: 136, // A minor space disco: sequencer bass, a two-octave arp echoing into space
        a: [[57, 60, 64], [53, 57, 60], [55, 59, 62], [57, 60, 64]], b: [[50, 53, 57], [53, 57, 60], [55, 59, 62], [52, 56, 59]],
        bass: 'seq16', bassType: 'sawtooth', bassVol: 0.2, bassCutoff: 380,
        arp: [0, 1, 2, 3, 4, 5, 4, 3], arpB: [5, 4, 3, 2, 1, 2, 3, 4], arpOctave: 12, arpType: 'square', arpVol: 0.028, pad: 'saw',
        melody: {
            a: [[76, _, _, _, _, _, 79, _, 81, _, _, _, _, _, 79, _],
                [77, _, _, _, _, _, 76, _, 72, _, _, _, _, _, _, _],
                [74, _, _, _, _, _, 76, _, 79, _, _, _, _, _, _, _],
                [81, _, _, _, _, _, _, _, _, _, _, _, _, _, _, _]],
            b: [[77, _, _, _, 76, _, _, _, 74, _, _, _, 72, _, _, _],
                [72, _, _, _, 74, _, _, _, 77, _, _, _, 81, _, _, _],
                [79, _, _, _, _, _, _, _, 83, _, _, _, _, _, _, _],
                [80, _, _, _, _, _, _, _, _, _, _, _, 76, _, _, _]]
        },
        pump: true, echo: 0.35, fx: true,
        kick: [0, 4, 8, 12], snare: [4, 12], bigSnare: true, hat: [0, 1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12, 13, 14, 15], hatVol: 0.022 },
    { name: 'Night City', bpm: 112, // C minor, moody but moving
        a: [[48, 51, 55], [44, 48, 51], [51, 55, 58], [46, 50, 53]], b: [[53, 56, 60], [48, 51, 55], [44, 48, 51], [43, 47, 50]],
        bass: 'offbeat8', bassType: 'sawtooth', bassVol: 0.28, bassCutoff: 600,
        arp: [0, 2, 1, 2], arpB: [2, 1, 0, 1], arpOctave: 24, arpType: 'triangle', arpVol: 0.055, pad: 'saw',
        pump: true, echo: 0.3, fx: true,
        kick: [0, 8], snare: [4, 12], bigSnare: true, hat: [2, 6, 10, 14], hatVol: 0.04 },
    { name: 'Sunset Grid', bpm: 124, // E minor, four on the floor
        a: [[52, 55, 59], [48, 52, 55], [55, 59, 62], [50, 54, 57]], b: [[57, 60, 64], [52, 55, 59], [48, 52, 55], [47, 51, 54]],
        bass: 'octaves8', bassType: 'sawtooth', bassVol: 0.24, bassCutoff: 800,
        arp: [0, 1, 2, 1, 0, 2, 1, 2], arpB: [2, 1, 0, 1], arpOctave: 12, arpType: 'square', arpVol: 0.04, pad: 'saw',
        pump: true, echo: 0.25, fx: true,
        kick: [0, 4, 8, 12], snare: [4, 12], hat: [2, 6, 10, 14], hatVol: 0.07 },
    { name: 'Starlight', bpm: 118, // F# minor, starry arps over a steady drive
        a: [[54, 57, 61], [50, 54, 57], [57, 61, 64], [52, 56, 59]], b: [[59, 62, 66], [54, 57, 61], [50, 54, 57], [49, 53, 56]],
        bass: 'drive8', bassType: 'sawtooth', bassVol: 0.24, bassCutoff: 600,
        arp: [0, null, 1, null, 2, null, 1, null], arpB: [2, null, 1, null, 0, null, 1, null], arpOctave: 24, arpType: 'triangle', arpVol: 0.06, pad: true,
        pump: true, echo: 0.35, fx: true,
        kick: [0, 8], snare: [4, 12], bigSnare: true, hat: [2, 6, 10, 14], hatVol: 0.05 }
];
const BOSS_LEAD = [0, null, 7, null, 12, null, 10, 7, 0, null, 3, null, 5, 7, null, 10]; // semitones over the root (+24)
const BOSS_TUNES = {
    snake: { name: 'Venom', bpm: 132, // E phrygian: that F over E hisses
        a: [[52, 55, 59], [53, 57, 60], [52, 55, 59], [50, 54, 57]], b: [[48, 52, 55], [47, 51, 54], [52, 55, 59], [53, 57, 60]],
        bass: 'drive16', bassType: 'sawtooth', bassVol: 0.24, bassCutoff: 650,
        arp: [0, 1, 2, 1], arpB: [2, 0, 1, 0], arpOctave: 24, arpType: 'square', arpVol: 0.035, pad: false,
        kick: [0, 4, 8, 12], snare: [4, 12], hat: [0, 2, 3, 4, 6, 7, 8, 10, 11, 12, 14, 15], hatVol: 0.035, lead: BOSS_LEAD, fx: true },
    mothership: { name: 'Overdrive', bpm: 140, // D minor; the A major pulls hard back home
        a: [[50, 53, 57], [46, 50, 53], [48, 52, 55], [45, 49, 52]], b: [[55, 58, 62], [50, 53, 57], [46, 50, 53], [45, 49, 52]],
        bass: 'drive16', bassType: 'sawtooth', bassVol: 0.26, bassCutoff: 700,
        arp: [0, 1, 2, 1], arpB: [0, 2, 1, 2], arpOctave: 24, arpType: 'square', arpVol: 0.035, pad: false,
        kick: [0, 4, 8, 12], snare: [4, 12], hat: [0, 1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12, 13, 14, 15], hatVol: 0.035, lead: BOSS_LEAD, fx: true },
    pong: { name: 'Rally', bpm: 150, // G minor, the arpeggio bouncing between octaves like a rally
        a: [[55, 58, 62], [51, 55, 58], [53, 57, 60], [50, 54, 57]], b: [[48, 51, 55], [55, 58, 62], [51, 55, 58], [50, 54, 57]],
        bass: 'octaves8', bassType: 'sawtooth', bassVol: 0.26, bassCutoff: 750,
        arp: [0, 0, 1, 1, 2, 2, 1, 1], arpB: [2, 2, 1, 1, 0, 0, 1, 1], arpOctave: 24, arpJump: true, arpType: 'square', arpVol: 0.035, pad: false,
        kick: [0, 4, 8, 12], snare: [4, 12], hat: [2, 6, 10, 14], hatVol: 0.06, lead: BOSS_LEAD, fx: true },
    asteroids: { name: 'Debris', bpm: 128, // B minor, broken beat
        a: [[47, 50, 54], [43, 47, 50], [50, 54, 57], [45, 49, 52]], b: [[52, 55, 59], [47, 50, 54], [43, 47, 50], [42, 46, 49]],
        bass: 'drive16', bassType: 'sawtooth', bassVol: 0.25, bassCutoff: 600,
        arp: [0, 1, 2, 1], arpB: [1, 2, 0, 2], arpOctave: 24, arpType: 'square', arpVol: 0.035, pad: true,
        kick: [0, 3, 8, 11], snare: [4, 12], hat: [0, 2, 4, 6, 8, 10, 12, 14], hatVol: 0.045, lead: BOSS_LEAD, fx: true },
    kong: { name: 'Girders', bpm: 118, // C minor stomp: a heavy four-on-the-floor for a heavy ape
        a: [[48, 51, 55], [48, 51, 55], [44, 48, 51], [46, 50, 53]], b: [[53, 56, 60], [51, 55, 58], [44, 48, 51], [43, 47, 50]],
        bass: 'octaves8', bassType: 'square', bassVol: 0.24, bassCutoff: 550,
        arp: [0, 2, 1, 2], arpB: [2, 1, 0, 1], arpOctave: 24, arpType: 'square', arpVol: 0.035, pad: false,
        kick: [0, 4, 8, 12], snare: [4, 12], hat: [2, 6, 10, 14], hatVol: 0.05, lead: BOSS_LEAD, fx: true },
    // Kong's HAMMER TIME: bright, frantic C major, everything doubled up
    hammer: { name: 'Hammer Time', bpm: 184,
        a: [[60, 64, 67], [65, 69, 72], [60, 64, 67], [67, 71, 74]], b: [[65, 69, 72], [67, 71, 74], [64, 67, 71], [67, 71, 74]],
        bass: 'octaves8', bassType: 'square', bassVol: 0.24, bassCutoff: 900,
        arp: [0, 1, 2, 1], arpB: [2, 1, 0, 1], arpOctave: 24, arpType: 'square', arpVol: 0.045, pad: false,
        kick: [0, 4, 8, 12], snare: [4, 12], hat: [0, 2, 4, 6, 8, 10, 12, 14], hatVol: 0.05, lead: BOSS_LEAD, fx: true }
};
const TUNE_FORM = ['a', 'a', 'b', 'a']; // which section each group of 4 bars plays

const midiHz = m => 440 * Math.pow(2, (m - 69) / 12);

let musicTimer = null;
let nextStepTime = 0;
let musicStep = 0;
let musicBar = 0;   // 0-15 through the A A B A form
let musicTune = NORMAL_TUNES[0];
let musicRate = 1;  // tape speed: tempo multiplier, eased toward musicRateTarget()
let musicPitch = 1; // pitch multiplier that goes with it

// The music runs at the game's speed, like a tape machine: Time Warp's Turbo (and the snake's Venom Rush,
// which is one) speeds it up, Slow-mo slows it down, and the Slow powerup eases it down a notch.
function musicRateTarget() {
    return timeScale * (slowTimer > 0 ? 0.85 : 1);
}

// --- Under water ---
// While the world is flipped (UPSIDE DOWN, FULL FLIP, the snake's mirror poison) or your controls are
// reversed, the game sounds like it's under water: the music heavily muffled behind a slowly swaying
// filter, its pitch warbling (a slowly modulated delay), the effects muffled a little too, with a dive on
// the way in, bubbles while it lasts and a splash coming out. Both buses always run through these nodes;
// on dry land the filters are wide open and the warble is silent.
const WATER_EVENTS = ['upsideDown', 'fullFlip', 'reverse'];
let water = null;
let underwater = false;
let nextBubbleAt = 0;

function buildWater(ac) {
    const lp = (freq, q) => {
        const f = ac.createBiquadFilter();
        f.type = 'lowpass';
        f.frequency.value = freq;
        f.Q.value = q;
        return f;
    };
    const gain = v => {
        const g = ac.createGain();
        g.gain.value = v;
        return g;
    };
    const lfo = (hz, depth, target) => { // a slow sine nudging an AudioParam; depth 0 = no effect
        const osc = ac.createOscillator();
        const amount = gain(depth);
        osc.frequency.value = hz;
        osc.connect(amount);
        amount.connect(target);
        osc.start();
        return amount;
    };
    const musicIn = lp(20000, 0.7);
    const dry = gain(1);
    const warble = ac.createDelay(0.1);
    warble.delayTime.value = 0.015;
    const wet = gain(0);
    musicIn.connect(dry);
    dry.connect(ac.destination);
    musicIn.connect(warble);
    warble.connect(wet);
    wet.connect(ac.destination);
    const sway = lfo(0.3, 0, musicIn.frequency); // the filter swaying open and shut, like a current
    lfo(0.9, 0.005, warble.delayTime); // the pitch wobble (only heard through wet)
    const sfxIn = lp(20000, 0.7);
    sfxIn.connect(ac.destination);
    water = { musicIn, dry, wet, sway, sfxIn };
    return water;
}

function updateUnderwater(ac) {
    const want = !!chaos.type && WATER_EVENTS.includes(chaos.type) && gameState !== 'lost';
    if (water && want !== underwater) {
        underwater = want;
        const t = ac.currentTime, tau = 0.25; // eases in and out over about a second
        water.musicIn.frequency.setTargetAtTime(want ? 480 : 20000, t, tau);
        water.musicIn.Q.setTargetAtTime(want ? 3 : 0.7, t, tau); // a little resonance: murky, not boomy
        water.sway.gain.setTargetAtTime(want ? 260 : 0, t, tau);
        water.dry.gain.setTargetAtTime(want ? 0.35 : 1, t, tau);
        water.wet.gain.setTargetAtTime(want ? 0.7 : 0, t, tau);
        water.sfxIn.frequency.setTargetAtTime(want ? 1500 : 20000, t, tau);
        if (want) sfxDive(); else sfxSurface();
        nextBubbleAt = t + 0.8;
    }
    if (underwater && gameState === 'playing' && ac.currentTime >= nextBubbleAt) {
        sfxBubble();
        if (Math.random() < 0.5) sfxBubble(0.06 + Math.random() * 0.06);
        nextBubbleAt = ac.currentTime + 0.4 + Math.random() * 0.9;
    }
}

function startMusic() {
    if (musicTimer || !audioCtx) return;
    nextStepTime = audioCtx.currentTime + 0.1;
    musicTimer = setInterval(scheduleMusic, MUSIC_TICK_MS);
}

// The boss's own theme during a fight; otherwise the level picks one of the ordinary tunes, so the next
// level always sounds different from this one
function wantedTune() {
    if (boss && boss.dying <= 0) {
        const hooks = bossHooks();
        return BOSS_TUNES[hooks.tune ? hooks.tune() : boss.kind] || BOSS_TUNES.mothership; // (a boss may switch tunes mid-fight)
    }
    return NORMAL_TUNES[(level - 1) % NORMAL_TUNES.length];
}

// How far through the fight the boss is (1 = fresh, 0 = beaten), for the final-stretch lead
function bossHealth() {
    if (!boss) return 1;
    const hooks = bossHooks();
    return hooks.health ? hooks.health() : boss.hp / boss.maxHp;
}

function scheduleMusic() {
    const ac = audioCtx;
    if (!ac || ac.state !== 'running') return;
    if (musicGain) musicGain.gain.setTargetAtTime(musicLevel(), ac.currentTime, 0.1); // follows the pause duck
    updateUnderwater(ac); // (before the early return below: the effects go under water even with the music off)
    // Nothing to hear (music off, or the tab hidden): don't queue notes, just keep the clock current
    if (document.hidden || musicLevel() === 0) {
        nextStepTime = ac.currentTime + 0.05;
        return;
    }
    // Ease the tape speed toward the game's, so a change winds up or down rather than jumping. Tempo follows
    // it fully; pitch only by its square root (Turbo ~+4 semitones, Slow-mo ~-6), so it still sounds sped
    // up or slowed down without turning into chipmunks or mud.
    musicRate += (musicRateTarget() - musicRate) * 0.15;
    if (Math.abs(musicRate - musicRateTarget()) < 0.005) musicRate = musicRateTarget();
    musicPitch = Math.sqrt(musicRate);
    while (nextStepTime < ac.currentTime + MUSIC_LOOKAHEAD) {
        if (musicStep === 0) {
            const tune = wantedTune();
            if (tune !== musicTune) {
                musicTune = tune;
                syncNowPlaying();
                musicBar = 0; // a new tune starts from the top of its form, on the bar line
            }
        }
        const tune = musicRate === 1 ? musicTune : { ...musicTune, bpm: musicTune.bpm * musicRate };
        playMusicStep(tune, musicBar, musicStep, nextStepTime);
        nextStepTime += 60 / tune.bpm / 4; // 16th notes
        musicStep = (musicStep + 1) % 16;
        if (musicStep === 0) musicBar = (musicBar + 1) % (TUNE_FORM.length * 4);
    }
}

function playMusicStep(tune, bar, step, t) {
    const hz = m => midiHz(m) * musicPitch; // the tape speed bends pitch too (see scheduleMusic)
    const buses = musicBuses(audioCtx);
    const section = TUNE_FORM[Math.floor(bar / 4)];
    const chord = tune[section][bar % 4];
    const stepLen = 60 / tune.bpm / 4;
    const root = chord[0];
    const bassRoot = 36 + ((root - 36) % 12);
    const lastBar = bar === TUNE_FORM.length * 4 - 1;

    if (step === 0) buses.delay.delayTime.setValueAtTime(stepLen * 3, t); // the echo sits on a dotted 8th

    // Drums, with a snare fill over the last beat of the form; with pump, every kick ducks the pad
    if (tune.kick.includes(step)) {
        kickDrum(t);
        if (tune.pump) {
            buses.pad.gain.setValueAtTime(0.2, t);
            buses.pad.gain.linearRampToValueAtTime(1, t + stepLen * 3);
        }
    }
    if (tune.snare.includes(step) || (lastBar && step >= 12)) snareDrum(t, tune.bigSnare && tune.snare.includes(step));
    if (tune.hat.includes(step)) hiHat(t, tune.hatVol * (step % 4 === 2 ? 1.4 : 1));

    // Bass
    if (tune.bass === 'octaves8') {
        if (step % 2 === 0) musicNote(t, hz(bassRoot + (step % 4 === 2 ? 12 : 0)), stepLen * 1.8, tune.bassType, tune.bassVol, tune.bassCutoff);
    } else if (tune.bass === 'offbeat8') {
        if (step === 0 || step % 4 === 2) musicNote(t, hz(bassRoot + (step === 0 ? 0 : 12)), stepLen * 1.6, tune.bassType, tune.bassVol, tune.bassCutoff);
    } else if (tune.bass === 'drive8') {
        if (step % 2 === 0) musicNote(t, hz(bassRoot), stepLen * 1.7, tune.bassType, tune.bassVol * (step % 4 === 0 ? 1 : 0.8), tune.bassCutoff);
    } else if (tune.bass === 'seq16') {
        const open = ((bar % 4) * 16 + step) / 64; // 0 -> 1 over each 4 bars: the filter builds, then resets
        musicNote(t, hz(bassRoot + (step % 2 ? 12 : 0)), stepLen * 0.85, tune.bassType, tune.bassVol * (step % 4 === 0 ? 1 : 0.8), tune.bassCutoff * (1 + 2.5 * open));
    } else if (tune.bass === 'long') {
        if (step % 8 === 0) musicNote(t, hz(bassRoot), stepLen * 7.5, tune.bassType, tune.bassVol, tune.bassCutoff, 0.02);
    } else { // drive16
        musicNote(t, hz(bassRoot + (step % 8 === 6 ? 12 : 0)), stepLen * 0.9, tune.bassType, tune.bassVol, tune.bassCutoff);
    }

    // Arpeggio (null = rest); arpJump bounces every other note up an octave
    const pattern = section === 'b' ? tune.arpB : tune.arp;
    const idx = pattern[step % pattern.length];
    if (idx !== null) {
        const jump = tune.arpJump && step % 2 === 1 ? 12 : 0;
        const note = idx < 3 ? chord[idx] : chord[idx - 3] + 12;
        musicNote(t, hz(note + tune.arpOctave + jump), stepLen * 0.8, tune.arpType, tune.arpVol, 2600, 0.005, { echo: tune.echo });
    }

    // Melody: a held lead on two detuned saws, each note ringing on until the next one (or the bar's end)
    if (tune.melody) {
        const line = tune.melody[section][bar % 4];
        if (line[step] !== null) {
            let len = 1;
            while (step + len < 16 && line[step + len] === null) len++;
            const f = hz(line[step]);
            musicNote(t, f * 0.996, stepLen * len, 'sawtooth', 0.045, 2400, 0.02, { echo: tune.echo });
            musicNote(t, f * 1.004, stepLen * len, 'sawtooth', 0.035, 2400, 0.02, { echo: tune.echo });
        }
    }

    // Pad: the whole chord, swelling in over the bar (a pair of slightly detuned saws spreads it wide)
    if (tune.pad === 'saw' && step === 0) {
        for (const n of chord) {
            musicNote(t, hz(n) * 0.997, stepLen * 16, 'sawtooth', 0.016, 1100, stepLen * 4, { dest: buses.pad });
            musicNote(t, hz(n) * 1.003, stepLen * 16, 'sawtooth', 0.016, 1100, stepLen * 4, { dest: buses.pad });
        }
    } else if (tune.pad && step === 0) {
        for (const n of chord) musicNote(t, hz(n), stepLen * 16, 'triangle', 0.03, 1400, stepLen * 4);
    }

    // Build-ups: a noise riser sweeping up through every 4th bar, and a crash on each new phrase
    if (tune.fx && step === 0) {
        if (bar % 4 === 3) noiseHit(t, stepLen * 16, 0.05, 'bandpass', 300, { sweepTo: 6000, swell: true });
        if (bar % 4 === 0) noiseHit(t, 1.4, 0.07, 'highpass', 5000);
    }

    // A boss's last stretch: the lead riff on top
    if (tune.lead && bossHealth() <= 0.33) {
        const iv = tune.lead[step];
        if (iv !== null) musicNote(t, hz(root + 24 + iv), stepLen * 0.9, 'square', 0.05, 3200);
    }
}

// Per-context effect buses: the pad bus (ducked on kicks for the pump) and the space echo, a dotted-8th
// feedback delay, darkened a little on each repeat, that arps and leads send into
function musicBuses(ac) {
    if (ac.musicBuses) return ac.musicBuses;
    const pad = ac.createGain();
    pad.connect(musicGain);
    const echoIn = ac.createGain();
    const delay = ac.createDelay(1.5);
    const feedback = ac.createGain();
    const darken = ac.createBiquadFilter();
    const wet = ac.createGain();
    feedback.gain.value = 0.38;
    darken.type = 'lowpass';
    darken.frequency.value = 2800;
    wet.gain.value = 0.5;
    echoIn.connect(delay);
    delay.connect(darken);
    darken.connect(feedback);
    feedback.connect(delay);
    darken.connect(wet);
    wet.connect(musicGain);
    ac.musicBuses = { pad, echoIn, delay };
    return ac.musicBuses;
}

// One note: oscillator -> low-pass -> envelope -> the music bus (or opts.dest), plus opts.echo of it into
// the space echo
function musicNote(t, freq, dur, type, vol, cutoff, attack = 0.005, opts = {}) {
    const ac = audioCtx;
    const osc = ac.createOscillator();
    const filter = ac.createBiquadFilter();
    const env = ac.createGain();
    osc.type = type;
    osc.frequency.setValueAtTime(freq, t);
    filter.type = 'lowpass';
    filter.frequency.setValueAtTime(cutoff, t);
    env.gain.setValueAtTime(0.0001, t);
    env.gain.exponentialRampToValueAtTime(vol, t + attack);
    env.gain.exponentialRampToValueAtTime(0.0001, t + dur);
    osc.connect(filter);
    filter.connect(env);
    env.connect(opts.dest || musicGain);
    let send = null;
    if (opts.echo) {
        send = ac.createGain();
        send.gain.value = opts.echo;
        env.connect(send);
        send.connect(musicBuses(ac).echoIn);
    }
    osc.start(t);
    osc.stop(t + dur + 0.02);
    osc.onended = () => {
        osc.disconnect();
        filter.disconnect();
        env.disconnect();
        if (send) send.disconnect();
    };
}

function kickDrum(t) {
    const ac = audioCtx;
    const osc = ac.createOscillator();
    const env = ac.createGain();
    osc.frequency.setValueAtTime(150, t);
    osc.frequency.exponentialRampToValueAtTime(40, t + 0.12);
    env.gain.setValueAtTime(0.7, t);
    env.gain.exponentialRampToValueAtTime(0.0001, t + 0.18);
    osc.connect(env);
    env.connect(musicGain);
    osc.start(t);
    osc.stop(t + 0.2);
    osc.onended = () => {
        osc.disconnect();
        env.disconnect();
    };
}

// A noise hit through a filter; sweepTo glides the cutoff over the hit, and swell fades it in instead of out
// (a riser)
function noiseHit(t, dur, vol, filterType, freq, { sweepTo = null, swell = false } = {}) {
    const ac = audioCtx;
    const src = ac.createBufferSource();
    const filter = ac.createBiquadFilter();
    const env = ac.createGain();
    src.buffer = getNoiseBuffer(ac);
    src.loop = true;
    filter.type = filterType;
    filter.frequency.setValueAtTime(freq, t);
    if (sweepTo) filter.frequency.exponentialRampToValueAtTime(sweepTo, t + dur);
    if (swell) {
        env.gain.setValueAtTime(0.0001, t);
        env.gain.exponentialRampToValueAtTime(vol, t + dur * 0.95);
        env.gain.linearRampToValueAtTime(0.0001, t + dur);
    } else {
        env.gain.setValueAtTime(vol, t);
        env.gain.exponentialRampToValueAtTime(0.0001, t + dur);
    }
    src.connect(filter);
    filter.connect(env);
    env.connect(musicGain);
    src.start(t);
    src.stop(t + dur + 0.02);
    src.onended = () => {
        src.disconnect();
        filter.disconnect();
        env.disconnect();
    };
}

// big: the 80s snare, its noise ringing out much longer (a stand-in for gated reverb)
function snareDrum(t, big = false) {
    noiseHit(t, 0.14, 0.22, 'bandpass', 1800);
    if (big) noiseHit(t, 0.38, 0.1, 'bandpass', 1200);
    musicNote(t, 185, 0.08, 'triangle', 0.12, 2000);
}

function hiHat(t, vol) {
    noiseHit(t, 0.035, vol, 'highpass', 7000);
}

// --- The sound dialog (opened by the speaker button; see showModal in ui.js) ---
function initSoundDialog() {
    const musicOn = document.getElementById('music-on');
    const sfxOn = document.getElementById('sfx-on');
    const musicVol = document.getElementById('music-vol');
    const sfxVol = document.getElementById('sfx-vol');
    const muteAll = document.getElementById('mute-all');
    if (!musicOn || !sfxOn || !musicVol || !sfxVol || !muteAll) return;
    const changed = () => {
        audioSettings.musicOn = musicOn.checked;
        audioSettings.sfxOn = sfxOn.checked;
        audioSettings.music = Number(musicVol.value);
        audioSettings.sfx = Number(sfxVol.value);
        saveAudioSettings();
        applyAudioSettings();
        syncSoundDialog();
    };
    for (const el of [musicOn, sfxOn, musicVol, sfxVol]) el.addEventListener('input', changed);
    // A test blip when you let go of the effects slider, so you can hear the level you picked
    sfxVol.addEventListener('change', () => tone(660, 0.1, { type: 'square', vol: 0.15, force: true }));
    muteAll.addEventListener('click', () => toggleMute());
    syncSoundDialog();
    updateSoundButton();
}

// Which tune is on, so a tune that grates can be named (it's in NORMAL_TUNES / BOSS_TUNES above)
function syncNowPlaying() {
    const el = document.getElementById('now-playing');
    if (el) el.textContent = musicTimer ? '♪ NOW PLAYING: ' + musicTune.name.toUpperCase() : '';
}

function syncSoundDialog() {
    const set = (id, prop, value) => {
        const el = document.getElementById(id);
        if (el) el[prop] = value;
    };
    set('music-on', 'checked', audioSettings.musicOn);
    set('sfx-on', 'checked', audioSettings.sfxOn);
    set('music-vol', 'value', audioSettings.music);
    set('sfx-vol', 'value', audioSettings.sfx);
    set('music-vol', 'disabled', !audioSettings.musicOn);
    set('sfx-vol', 'disabled', !audioSettings.sfxOn);
    set('mute-all', 'textContent', isMuted ? 'UNMUTE ALL (M)' : 'MUTE ALL (M)');
    syncNowPlaying();
    const dlg = document.getElementById('sound-dialog');
    if (dlg) dlg.classList.toggle('muted', isMuted);
}
