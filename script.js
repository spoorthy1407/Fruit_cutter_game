/* ===================================================
   FRUIT SLASH — script.js  (AAA visual upgrade)
   Phaser 3 game engine + MediaPipe hand tracking.
   =================================================== */

// ─── Constants ─────────────────────────────────────────────────────────────

const FRUIT_TYPES = [
  { emoji: '🍉', color: 0xff4466, name: 'watermelon' },
  { emoji: '🍊', color: 0xff8c00, name: 'orange'     },
  { emoji: '🍋', color: 0xffe600, name: 'lemon'      },
  { emoji: '🍇', color: 0xcc44ff, name: 'grape'      },
  { emoji: '🍓', color: 0xff2255, name: 'strawberry' },
  { emoji: '🍍', color: 0xffcc00, name: 'pineapple'  },
  { emoji: '🥝', color: 0x66dd44, name: 'kiwi'       },
  { emoji: '🍑', color: 0xff9966, name: 'peach'      },
];

const MAX_LIVES      = 3;
const SPAWN_INTERVAL = 1200;
const MIN_INTERVAL   = 450;
const GRAVITY        = 480;   // reduced so fruits hang in the air longer
const FRUIT_SIZE     = 96;    // bigger fruits — easier to see and hit

// ── Slash Trail ──────────────────────────────────────────────────────────────
const TRAIL_MAX_POINTS   = 12;
const TRAIL_LIFETIME_MS  = 120;
const TRAIL_CORE_WIDTH   = 4;
const TRAIL_GLOW_WIDTH   = 18;
const TRAIL_CORE_COLOR   = 0xffffff;
const TRAIL_GLOW_COLOR   = 0x00f5ff;
const TRAIL_CORE_ALPHA   = 1.0;
const TRAIL_GLOW_ALPHA   = 0.45;

// ── Swipe / velocity ─────────────────────────────────────────────────────────
const SLICE_MIN_SPEED      = 20;   // lowered: easier to register a slice
const VELOCITY_SMOOTH      = 0.7;
const SEGMENT_RADIUS       = FRUIT_SIZE * 1.1;  // larger hit radius for forgiveness
const SLICE_MIN_SEGMENT_PX = 4;    // shorter segments still count
const SLICE_DIR_SAMPLES    = 2;

// ── Effects ──────────────────────────────────────────────────────────────────
const SHAKE_DURATION     = 180;   // ms
const SHAKE_INTENSITY    = 7;     // px max offset
const SLOWMO_THRESHOLD   = 3;     // rapid slices to trigger
const SLOWMO_WINDOW_MS   = 800;   // window to count rapid slices
const SLOWMO_DURATION    = 2200;  // ms slow-mo lasts
const SLOWMO_TIMESCALE   = 0.35;  // physics speed multiplier
const COMBO_WINDOW_MS    = 1200;  // ms between slices to keep combo

// ── Bombs ────────────────────────────────────────────────────────────────────
const BOMB_CHANCE        = 0.18;  // probability a spawn slot becomes a bomb (0–1)
const BOMB_SIZE          = 64;    // px — same hitbox as fruit
const BOMB_SHAKE_INT     = 28;    // camera shake intensity on explosion
const BOMB_SHAKE_DUR     = 500;   // ms

// ── Power-ups ────────────────────────────────────────────────────────────────
const POWERUP_CHANCE     = 0.10;  // probability a spawn slot becomes a power-up
const POWERUP_SIZE       = 56;    // px
const FREEZE_DURATION    = 3000;  // ms freeze lasts
const DOUBLE_DURATION    = 5000;  // ms double-score lasts

// ─── Game State ─────────────────────────────────────────────────────────────

let score              = 0;
let lives              = MAX_LIVES;
let gameRunning        = false;
let combo              = 0;
let comboTimer         = null;
let highScore          = parseInt(localStorage.getItem('fruitSlashHigh') || '0');
let spawnDelay         = SPAWN_INTERVAL;
let diffTimer          = null;
let spawnTimer         = null;
let rapidSliceCount    = 0;
let rapidSliceTimer    = null;

// Power-up state
let doubleScoreActive  = false;
let doubleScoreTimer   = null;
let freezeActive       = false;
let freezeTimer        = null;

// Pause state
let gamePaused         = false;
const PALM_HOLD_FRAMES = 18;   // ~0.6s of open palm before pausing

// ─── DOM References ──────────────────────────────────────────────────────────

const scoreEl        = document.getElementById('score-value');
const lifeIcons      = document.querySelectorAll('.life-icon');
const comboEl        = document.getElementById('combo-display');
const gameOverEl     = document.getElementById('game-over-screen');
const finalScoreEl   = document.getElementById('final-score');
const highScoreEl    = document.getElementById('high-score-value');
const startScreen    = document.getElementById('start-screen');
const startBtn       = document.getElementById('start-btn');
const restartBtn     = document.getElementById('restart-btn');
const slowMoVignette = document.getElementById('slow-mo-vignette');
const powerupHUD     = document.getElementById('powerup-hud');
const gameOverReason = document.getElementById('game-over-reason');
const pauseScreen    = document.getElementById('pause-screen');
const resumeBtn      = document.getElementById('resume-btn');

// ─── FINGERTIP TRACKING (MediaPipe Hands) ────────────────────────────────────
// Supports up to 2 hands simultaneously.
// Each hand has its own position, SwipeDetector, and SlashTrail.
// Slot 0 = RIGHT hand (cyan)  |  Slot 1 = LEFT hand (orange)
// Slot assignment is based on MediaPipe's handedness label, NOT array index.
// This means switching between 1 and 2 hands never causes trail cross-connection.

const FINGER_SMOOTH     = 0.55;
const FINGER_LERP_STEPS = 3;

// Per-slot state arrays  (slot 0 = right hand, slot 1 = left hand)
const fingerX   = [null, null];
const fingerY   = [null, null];
const _prevHand = [
  { x: null, y: null, lastResultTime: 0 },
  { x: null, y: null, lastResultTime: 0 },
];

// Trail colours: slot 0 cyan (right), slot 1 orange (left)
const HAND_GLOW_COLORS = [0x00f5ff, 0xff8c00];
const HAND_CORE_COLORS = [0xffffff, 0xffe0a0];
const HAND_DOT_COLORS  = [0x00f5ff, 0xff8c00];

window.FingerCursor = (() => {
  let _hands         = null;
  let _videoEl       = null;
  let _ready         = false;
  let _lastVideoTime = -1;

  // palm-held-frames per slot (either triggers pause)
  const _palmFrames = [0, 0];

  // Which slots were filled last frame — used to detect disappearances
  const _slotActive = [false, false];

  // Map a MediaPipe handedness label to a fixed slot index.
  // MediaPipe labels from the camera mirror perspective:
  //   "Right" label = the hand on the right of the mirrored image = user's LEFT hand
  //   "Left"  label = the hand on the left  of the mirrored image = user's RIGHT hand
  // We just need a stable mapping — label → slot index.
  function _handednessToSlot(label) {
    // "Right" → slot 0 (cyan), "Left" → slot 1 (orange)
    return label === 'Right' ? 0 : 1;
  }

  function _processHand(lms, slot, now) {
    const lm8  = lms[8];
    const lm12 = lms[12];
    const rawX = (1 - ((lm8.x + lm12.x) / 2)) * window.innerWidth;
    const rawY =      ((lm8.y + lm12.y) / 2)   * window.innerHeight;

    const prev = _prevHand[slot];

    if (fingerX[slot] === null) {
      fingerX[slot] = rawX;
      fingerY[slot] = rawY;
    } else {
      fingerX[slot] += FINGER_SMOOTH * (rawX - fingerX[slot]);
      fingerY[slot] += FINGER_SMOOTH * (rawY - fingerY[slot]);
    }

    const scene = window._phaserScene;
    if (!scene || !gameRunning) {
      prev.x = fingerX[slot];
      prev.y = fingerY[slot];
      return;
    }

    // ── Palm-pause detection (either hand) ──────────────────────────────────
    if (PalmDetector.isOpenPalm(lms)) {
      _palmFrames[slot]++;
      if (_palmFrames[slot] >= PALM_HOLD_FRAMES && !gamePaused) {
        pauseGame();
      }
    } else {
      _palmFrames[slot] = 0;
    }

    if (gamePaused) {
      prev.x = fingerX[slot];
      prev.y = fingerY[slot];
      return;
    }

    const dt = prev.lastResultTime > 0
      ? Math.min(now - prev.lastResultTime, 100) : 16;
    prev.lastResultTime = now;

    const fx = fingerX[slot], fy = fingerY[slot];

    // Teleport guard — catches any residual swap artifacts
    // If position jumped > 25% of screen width in one frame, treat as new appearance
    const MAX_JUMP = window.innerWidth * 0.25;
    const jumped   = prev.x !== null &&
      Math.hypot(fx - prev.x, fy - prev.y) > MAX_JUMP;

    if (jumped) {
      HandTrails[slot].markAbsent();
      HandDetectors[slot].reset();
      prev.x = null;
      prev.y = null;
    }

    // Lerp intermediate points only when we have a real previous position
    // for THIS slot — never bridge from another slot's last position
    if (prev.x !== null) {
      for (let s = 1; s <= FINGER_LERP_STEPS; s++) {
        const t = s / (FINGER_LERP_STEPS + 1);
        HandTrails[slot].addPoint(
          prev.x + t * (fx - prev.x),
          prev.y + t * (fy - prev.y)
        );
      }
    }

    HandTrails[slot].addPoint(fx, fy);
    HandDetectors[slot].update(fx, fy, dt);
    checkSliceHand.call(scene, fx, fy, slot);

    prev.x = fx;
    prev.y = fy;
  }

  function _onResults(results) {
    const detected    = results.multiHandLandmarks  || [];
    const handedness  = results.multiHandedness     || [];

    // Build a map: slot → landmark set, based on handedness label
    // Any slot not present in this frame gets cleared
    const slotLms = [null, null];

    for (let i = 0; i < detected.length && i < 2; i++) {
      const label = handedness[i]?.label ?? 'Right'; // default to slot 0 if missing
      const slot  = _handednessToSlot(label);
      slotLms[slot] = detected[i];
    }

    const now = performance.now();

    for (let slot = 0; slot < 2; slot++) {
      if (slotLms[slot]) {
        // Hand is present in this slot
        _slotActive[slot] = true;
        _processHand(slotLms[slot], slot, now);
      } else {
        // Hand absent from this slot — clean up only if it was active before
        if (_slotActive[slot]) {
          HandTrails[slot].markAbsent();
        }
        _slotActive[slot]              = false;
        fingerX[slot]                  = null;
        fingerY[slot]                  = null;
        _prevHand[slot].x              = null;
        _prevHand[slot].y              = null;
        _prevHand[slot].lastResultTime = 0;
        _palmFrames[slot]              = 0;
        HandDetectors[slot].reset();
        // Let trail points fade naturally — don't hard-clear the buffer
      }
    }
  }

  function _loop() {
    requestAnimationFrame(_loop);
    if (!_ready || !_videoEl || _videoEl.readyState < 2) return;
    if (_videoEl.currentTime === _lastVideoTime) return;
    _lastVideoTime = _videoEl.currentTime;
    _hands.send({ image: _videoEl });
  }

  async function start(videoEl) {
    if (_ready) return;
    _videoEl = videoEl;
    console.log('[FingerCursor] Constructing MediaPipe Hands (2-hand mode)...');
    _hands = new Hands({
      locateFile: (f) =>
        `https://cdn.jsdelivr.net/npm/@mediapipe/hands@0.4.1646424915/${f}`
    });
    _hands.setOptions({
      maxNumHands          : 2,    // ← track both hands
      modelComplexity      : 1,
      minDetectionConfidence: 0.5,
      minTrackingConfidence : 0.4,
    });
    _hands.onResults(_onResults);
    console.log('[FingerCursor] Loading WASM model...');
    await _hands.initialize();
    console.log('[FingerCursor] Ready — 2-hand mode active.');
    _ready = true;
    _loop();
  }

  return { start };
})();

// ─── PALM DETECTOR ───────────────────────────────────────────────────────────
// Analyses MediaPipe landmarks every frame to decide if the hand is an open
// palm (all 5 fingers extended and spread).  Requires ~0.6 s of sustained
// open-palm before triggering pause so accidental flashes don't interrupt play.
//
// Detection logic:
//   For each finger (index, middle, ring, pinky) the tip landmark must sit
//   clearly ABOVE its MCP (knuckle) landmark in image-space (y decreases
//   upward). The thumb is checked separately — its tip must be clearly to
//   the LEFT or RIGHT of the thumb base depending on handedness, but we
//   simplify to: thumb tip y < thumb IP y (extended).
//   Additionally, fingertips should be spread apart (average inter-tip
//   distance > threshold relative to hand size).

const PalmDetector = (() => {

  // Landmark indices we care about
  // Tip:  4(thumb), 8(index), 12(middle), 16(ring), 20(pinky)
  // MCP:  2(thumb-ip), 5(index), 9(middle), 13(ring), 17(pinky)
  const TIPS = [4, 8, 12, 16, 20];
  const MCPS = [2, 5,  9, 13, 17];

  function isOpenPalm(landmarks) {
    if (!landmarks || landmarks.length < 21) return false;

    // ── 1. All four fingers (skip thumb) must be extended ────────────────────
    // Extended = tip.y significantly above mcp.y  (smaller y = higher on screen)
    let extendedCount = 0;
    for (let f = 1; f < 5; f++) {          // index→pinky (fingers 1-4)
      const tip = landmarks[TIPS[f]];
      const mcp = landmarks[MCPS[f]];
      if (tip.y < mcp.y - 0.06) extendedCount++; // 0.06 = ~6% of frame height
    }
    if (extendedCount < 4) return false;

    // ── 2. Thumb extended (tip above thumb IP joint) ─────────────────────────
    const thumbTip = landmarks[4];
    const thumbIP  = landmarks[3];
    if (thumbTip.y > thumbIP.y - 0.02) return false;  // thumb curled

    // ── 3. Fingers spread apart (open palm, not fist pointing up) ────────────
    // Measure distance between index tip (8) and pinky tip (20)
    const idx   = landmarks[8];
    const pinky = landmarks[20];
    const spread = Math.abs(idx.x - pinky.x);
    if (spread < 0.12) return false;   // too close together = closed / pointing

    return true;
  }

  return { isOpenPalm };
})();

// ─── PAUSE / RESUME ──────────────────────────────────────────────────────────

function pauseGame() {
  if (!gameRunning || gamePaused) return;
  gamePaused = true;

  // Freeze Phaser physics and time
  const scene = window._phaserScene;
  if (scene) {
    scene.physics.world.pause();
    scene.time.paused = true;
  }

  // Pause the spawn & difficulty timers
  clearInterval(spawnTimer);
  clearInterval(diffTimer);

  // Show pause overlay
  pauseScreen.classList.remove('hidden');
}

function resumeGame() {
  if (!gamePaused) return;
  gamePaused = false;

  // Hide overlay
  pauseScreen.classList.add('hidden');

  // Resume Phaser
  const scene = window._phaserScene;
  if (scene) {
    scene.physics.world.resume();
    scene.time.paused = false;
  }

  // Restart spawn & difficulty timers
  spawnTimer = setInterval(spawnFruit, spawnDelay);
  diffTimer  = setInterval(() => {
    clearInterval(spawnTimer);
    spawnDelay = Math.max(MIN_INTERVAL, spawnDelay - 80);
    spawnTimer = setInterval(spawnFruit, spawnDelay);
  }, 10000);
}

// ─── Phaser Configuration ────────────────────────────────────────────────────

const config = {
  type: Phaser.AUTO,
  width: window.innerWidth,
  height: window.innerHeight,
  backgroundColor: 'rgba(0,0,0,0)',
  transparent: true,
  physics: {
    default: 'arcade',
    arcade: { gravity: { y: GRAVITY }, debug: false }
  },
  scene: { preload, create, update }
};

const game = new Phaser.Game(config);

window.addEventListener('resize', () => {
  game.scale.resize(window.innerWidth, window.innerHeight);
});

// ─── Phaser Scene Variables ───────────────────────────────────────────────────

let fruits    = [];
let _legacyGfx;
let _dotGfx;
let particles = [];

// ─── SCREEN SHAKE MODULE ─────────────────────────────────────────────────────
// Applies decaying random camera offset each frame — no DOM transforms.
// Public: ScreenShake.trigger(scene, intensity?, duration?)  .tick(delta)
const ScreenShake = (() => {
  let _timer     = 0;
  let _intensity = 0;
  let _scene     = null;

  function trigger(scene, intensity = SHAKE_INTENSITY, duration = SHAKE_DURATION) {
    _scene     = scene;
    _timer     = duration;
    // Only escalate intensity, never reduce an ongoing shake
    if (intensity > _intensity) _intensity = intensity;
  }

  function tick(delta) {
    if (_timer <= 0 || !_scene) return;
    _timer -= delta;
    const decay = Math.max(0, _timer / SHAKE_DURATION);
    const amp   = _intensity * decay;
    _scene.cameras.main.setScroll(
      (Math.random() * 2 - 1) * amp,
      (Math.random() * 2 - 1) * amp
    );
    if (_timer <= 0) {
      _scene.cameras.main.setScroll(0, 0);
      _intensity = 0;
    }
  }

  return { trigger, tick };
})();

// ─── SLOW MOTION MODULE ───────────────────────────────────────────────────────
// Slows Phaser physics + time manager; DOM vignette shows the effect.
// Public: SlowMotion.trigger(scene)  .isActive()
const SlowMotion = (() => {
  let _active  = false;
  let _timeout = null;

  function trigger(scene) {
    if (_active) return;
    _active = true;
    scene.physics.world.timeScale = 1 / SLOWMO_TIMESCALE;
    scene.time.timeScale           = SLOWMO_TIMESCALE;
    if (slowMoVignette) slowMoVignette.classList.add('active');
    clearTimeout(_timeout);
    _timeout = setTimeout(() => {
      scene.physics.world.timeScale = 1;
      scene.time.timeScale           = 1;
      if (slowMoVignette) slowMoVignette.classList.remove('active');
      _active = false;
    }, SLOWMO_DURATION);
  }

  function isActive() { return _active; }
  return { trigger, isActive };
})();

// ─── SLASH TRAIL MODULE (per-hand) ───────────────────────────────────────────
// Factory that creates an independent trail for each hand.
// Hand 0 = cyan glow, Hand 1 = orange glow.
// Public: HandTrails[0].init(scene) / HandTrails[1].init(scene)
//         .addPoint(x,y)  .clear()  .draw(now)

function _makeTrail(glowColor, coreColor) {
  // Each buffer entry: { x, y, t, gap } where gap=true means
  // "do NOT draw a line segment FROM the previous point TO this one".
  // A gap is inserted whenever the hand disappears and reappears.
  const buf = new Array(TRAIL_MAX_POINTS).fill(null);
  let head  = 0;
  let count = 0;
  let gfxGlow, gfxCore;
  let _wasAbsent = false;   // tracks whether hand was missing last frame

  function init(scene, depthOffset) {
    gfxGlow = scene.add.graphics(); gfxGlow.setDepth(8 + depthOffset);
    gfxCore = scene.add.graphics(); gfxCore.setDepth(9 + depthOffset);
  }

  // Call this every frame the hand is NOT detected — marks next addPoint as a gap
  function markAbsent() {
    _wasAbsent = true;
  }

  function addPoint(x, y) {
    const gap = _wasAbsent;   // first point after absence = gap marker
    _wasAbsent = false;
    buf[head] = { x, y, t: performance.now(), gap };
    head      = (head + 1) % TRAIL_MAX_POINTS;
    if (count < TRAIL_MAX_POINTS) count++;
  }

  function clear() {
    count = 0; head = 0; buf.fill(null);
    _wasAbsent = true;   // next addPoint after clear is always a gap
  }

  function _livePoints(now) {
    const out = [];
    for (let i = 0; i < count; i++) {
      const idx = (head - 1 - i + TRAIL_MAX_POINTS) % TRAIL_MAX_POINTS;
      const pt  = buf[idx];
      if (!pt) continue;
      const age = now - pt.t;
      if (age > TRAIL_LIFETIME_MS) break;
      // prepend — oldest first; carry the gap flag forward
      out.unshift({ x: pt.x, y: pt.y, alpha: 1 - age / TRAIL_LIFETIME_MS, gap: pt.gap });
    }
    return out;
  }

  function _cr(p0, p1, p2, p3, t) {
    const t2 = t*t, t3 = t2*t;
    return 0.5*((2*p1)+(-p0+p2)*t+(2*p0-5*p1+4*p2-p3)*t2+(-p0+3*p1-3*p2+p3)*t3);
  }

  function _buildCurve(pts) {
    if (pts.length < 2) return pts;
    const STEPS = 3;
    const out   = [];
    for (let i = 0; i < pts.length - 1; i++) {
      const p1 = pts[i];
      const p2 = pts[i + 1];
      // If the NEXT point is a gap start, don't interpolate into it — push p1 with a break
      if (p2.gap) {
        out.push({ x: p1.x, y: p1.y, alpha: p1.alpha, gap: false });
        out.push({ x: p2.x, y: p2.y, alpha: p2.alpha, gap: true  }); // gap preserved
        continue;
      }
      const p0 = pts[Math.max(0, i - 1)];
      const p3 = pts[Math.min(pts.length - 1, i + 2)];
      for (let s = 0; s < STEPS; s++) {
        const t = s / STEPS;
        out.push({
          x    : _cr(p0.x, p1.x, p2.x, p3.x, t),
          y    : _cr(p0.y, p1.y, p2.y, p3.y, t),
          alpha: p1.alpha + (p2.alpha - p1.alpha) * t,
          gap  : s === 0 && p1.gap,   // carry gap only for first sub-step of a gap point
        });
      }
    }
    out.push(pts[pts.length - 1]);
    return out;
  }

  function draw(now) {
    gfxGlow.clear(); gfxCore.clear();
    const live = _livePoints(now);
    if (live.length < 2) return;
    const curve = _buildCurve(live);
    if (curve.length < 2) return;

    for (let i = 1; i < curve.length; i++) {
      // Skip this segment if this point is a gap marker — no line drawn across the break
      if (curve[i].gap) continue;
      const a = curve[i].alpha * TRAIL_GLOW_ALPHA;
      if (a < 0.01) continue;
      gfxGlow.lineStyle(TRAIL_GLOW_WIDTH, glowColor, a);
      gfxGlow.beginPath();
      gfxGlow.moveTo(curve[i - 1].x, curve[i - 1].y);
      gfxGlow.lineTo(curve[i].x,     curve[i].y);
      gfxGlow.strokePath();
    }
    for (let i = 1; i < curve.length; i++) {
      if (curve[i].gap) continue;
      const a = curve[i].alpha * TRAIL_CORE_ALPHA;
      if (a < 0.01) continue;
      gfxCore.lineStyle(TRAIL_CORE_WIDTH, coreColor, a);
      gfxCore.beginPath();
      gfxCore.moveTo(curve[i - 1].x, curve[i - 1].y);
      gfxCore.lineTo(curve[i].x,     curve[i].y);
      gfxCore.strokePath();
    }
  }

  return { init, addPoint, markAbsent, clear, draw };
}

// Two trail instances — one per hand
const HandTrails = [
  _makeTrail(HAND_GLOW_COLORS[0], HAND_CORE_COLORS[0]),
  _makeTrail(HAND_GLOW_COLORS[1], HAND_CORE_COLORS[1]),
];

// ─── BOMB SYSTEM ──────────────────────────────────────────────────────────────
// Bombs share the same physics pipeline as fruits (added to the `fruits` array
// with kind:'bomb'). checkSliceHand routes them here instead of sliceFruit.
// Public: BombSystem.spawn(scene)  .explode(fruit, scene)
const BombSystem = (() => {

  function spawn(scene) {
    if (!gameRunning || !scene) return;
    const W = window.innerWidth, H = window.innerHeight;
    const x = Phaser.Math.Between(W * 0.15, W * 0.85);

    // Invisible physics sprite (same pattern as fruits)
    const gfx = scene.add.graphics();
    gfx.fillStyle(0x111111, 0.0);
    gfx.fillCircle(BOMB_SIZE/2, BOMB_SIZE/2, BOMB_SIZE/2);
    gfx.generateTexture('bomb_' + Date.now(), BOMB_SIZE, BOMB_SIZE);
    gfx.destroy();

    const sprite = scene.physics.add.sprite(x, H + 40, 'bomb_' + Date.now());
    sprite.setCircle(BOMB_SIZE/2);
    sprite.setAlpha(0);
    sprite.setDepth(1);

    // Emoji label: bomb with warning glow
    const label = scene.add.text(x, H + 40, '💣', {
      fontSize: `${BOMB_SIZE}px`, align: 'center'
    });
    label.setOrigin(0.5, 0.5);
    label.setDepth(2);

    // Pulsing red glow ring around the bomb
    const glow = scene.add.circle(x, H + 40, BOMB_SIZE * 0.7, 0xff2200, 0);
    glow.setStrokeStyle(3, 0xff4400, 0.8);
    glow.setDepth(1);
    scene.tweens.add({
      targets: glow, scaleX: 1.25, scaleY: 1.25, alpha: 0.6,
      duration: 500, yoyo: true, repeat: -1, ease: 'Sine.easeInOut'
    });

    sprite.body.setVelocity(
      Phaser.Math.Between(-180, 180),
      Phaser.Math.Between(-920, -680)
    );
    sprite.body.setMaxVelocityY(1400);

    fruits.push({
      sprite, text: label, glow,
      kind: 'bomb',
      type: { color: 0xff2200, name: 'bomb', emoji: '💣' },
      sliced: false,
      spinSpeed: Phaser.Math.Between(-120, 120)
    });
  }

  function explode(fruit, scene) {
    const cx = fruit.sprite.x;
    const cy = fruit.sprite.y;

    // Destroy the bomb visuals
    if (fruit.glow?.active)   fruit.glow.destroy();
    if (fruit.sprite?.active) fruit.sprite.destroy();
    if (fruit.text?.active)   fruit.text.destroy();

    // Shockwave ring
    const ring = scene.add.circle(cx, cy, 10, 0xffffff, 0);
    ring.setStrokeStyle(5, 0xff4400, 1);
    ring.setDepth(30);
    scene.tweens.add({
      targets: ring, scaleX: 9, scaleY: 9, alpha: 0,
      duration: 500, ease: 'Sine.easeOut',
      onComplete: () => { if (ring.active) ring.destroy(); }
    });

    // Bright orange flash
    const flash = scene.add.circle(cx, cy, BOMB_SIZE * 0.8, 0xff6600, 0.95);
    flash.setDepth(29);
    scene.tweens.add({
      targets: flash, scaleX: 3.5, scaleY: 3.5, alpha: 0,
      duration: 280, ease: 'Quad.easeOut',
      onComplete: () => { if (flash.active) flash.destroy(); }
    });

    // Debris dots — 10 orange + dark particles
    for (let i = 0; i < 10; i++) {
      const angle = (i / 10) * Math.PI * 2;
      const speed = Phaser.Math.Between(120, 300);
      const col   = i % 2 === 0 ? 0xff4400 : 0x222222;
      const dot   = scene.add.circle(cx, cy, Phaser.Math.Between(5, 9), col, 1);
      dot.setDepth(28);
      scene.tweens.add({
        targets: dot,
        x: cx + Math.cos(angle) * speed,
        y: cy + Math.sin(angle) * speed,
        scaleX: 0.1, scaleY: 0.1, alpha: 0,
        duration: 450 + Math.random() * 200,
        ease: 'Quad.easeOut',
        onComplete: () => { if (dot.active) dot.destroy(); }
      });
    }

    // Full-screen red flash
    const screenFlash = scene.add.rectangle(
      window.innerWidth/2, window.innerHeight/2,
      window.innerWidth, window.innerHeight, 0xff2200, 0.5
    );
    screenFlash.setDepth(50);
    scene.tweens.add({
      targets: screenFlash, alpha: 0, duration: 600, ease: 'Quad.easeOut',
      onComplete: () => { if (screenFlash.active) screenFlash.destroy(); }
    });

    // Heavy screen shake then game over after brief delay so explosion plays
    ScreenShake.trigger(scene, BOMB_SHAKE_INT, BOMB_SHAKE_DUR);
    setTimeout(() => triggerGameOver('💣 BOMB HIT!'), 550);
  }

  return { spawn, explode };
})();

// ─── POWER-UP SYSTEM ──────────────────────────────────────────────────────────
// Two types: 'freeze' (stops gravity on all fruits for 3 s)
//             'double' (doubles all scoring for 5 s)
// Power-ups also live in the `fruits` array with kind:'powerup'.
// Public: PowerUpSystem.spawn(scene)  .activate(fruit, scene)
//         PowerUpSystem.getScoreMultiplier()  .resetAll()
const PowerUpSystem = (() => {

  const TYPES = [
    {
      id      : 'freeze',
      emoji   : '❄️',
      color   : 0x00ccff,
      label   : '❄️ FREEZE!',
      duration: FREEZE_DURATION,
    },
    {
      id      : 'double',
      emoji   : '⚡',
      color   : 0xffdd00,
      label   : '⚡ 2× SCORE!',
      duration: DOUBLE_DURATION,
    },
  ];

  function spawn(scene) {
    if (!gameRunning || !scene) return;
    const W    = window.innerWidth, H = window.innerHeight;
    const type = TYPES[Phaser.Math.Between(0, TYPES.length - 1)];
    const x    = Phaser.Math.Between(W * 0.1, W * 0.9);

    const gfx = scene.add.graphics();
    gfx.fillStyle(type.color, 0.0);
    gfx.fillCircle(POWERUP_SIZE/2, POWERUP_SIZE/2, POWERUP_SIZE/2);
    gfx.generateTexture('pu_' + type.id + '_' + Date.now(), POWERUP_SIZE, POWERUP_SIZE);
    gfx.destroy();

    const sprite = scene.physics.add.sprite(x, H + 40, 'pu_' + type.id + '_' + Date.now());
    sprite.setCircle(POWERUP_SIZE/2);
    sprite.setAlpha(0);
    sprite.setDepth(1);

    const label = scene.add.text(x, H + 40, type.emoji, {
      fontSize: `${POWERUP_SIZE}px`, align: 'center'
    });
    label.setOrigin(0.5, 0.5);
    label.setDepth(2);

    // Spinning halo ring
    const glow = scene.add.circle(x, H + 40, POWERUP_SIZE * 0.75, 0xffffff, 0);
    glow.setStrokeStyle(3, type.color, 0.9);
    glow.setDepth(1);
    scene.tweens.add({
      targets: glow, angle: 360,
      duration: 1200, repeat: -1, ease: 'Linear'
    });
    // Pulse scale
    scene.tweens.add({
      targets: glow, scaleX: 1.18, scaleY: 1.18,
      duration: 600, yoyo: true, repeat: -1, ease: 'Sine.easeInOut'
    });

    sprite.body.setVelocity(
      Phaser.Math.Between(-150, 150),
      Phaser.Math.Between(-900, -680)
    );
    sprite.body.setMaxVelocityY(1400);

    fruits.push({
      sprite, text: label, glow,
      kind   : 'powerup',
      puType : type,
      type   : { color: type.color, name: type.id, emoji: type.emoji },
      sliced : false,
      spinSpeed: Phaser.Math.Between(-80, 80)
    });
  }

  function activate(fruit, scene) {
    const cx = fruit.sprite.x, cy = fruit.sprite.y;
    const pt = fruit.puType;

    // Collect visual
    const flash = scene.add.circle(cx, cy, POWERUP_SIZE * 0.6, pt.color, 0.9);
    flash.setDepth(20);
    scene.tweens.add({
      targets: flash, scaleX: 3, scaleY: 3, alpha: 0,
      duration: 350, ease: 'Quad.easeOut',
      onComplete: () => { if (flash.active) flash.destroy(); }
    });

    // Floating activation label in Phaser canvas
    const pop = scene.add.text(cx, cy - 20, pt.label, {
      fontFamily: 'Boogaloo, cursive', fontSize: '36px',
      color: '#ffffff',
      stroke: '#000000', strokeThickness: 5
    });
    pop.setOrigin(0.5, 0.5).setDepth(25);
    scene.tweens.add({
      targets: pop, y: cy - 130, alpha: 0, scaleX: 1.4, scaleY: 1.4,
      duration: 900, ease: 'Cubic.easeOut',
      onComplete: () => { if (pop.active) pop.destroy(); }
    });

    if (pt.id === 'freeze') _activateFreeze(scene, pt.duration);
    if (pt.id === 'double') _activateDouble(pt.duration);
  }

  function _activateFreeze(scene, dur) {
    // Don't stack — reset existing timer if re-triggered
    clearTimeout(freezeTimer);
    freezeActive = true;

    // Slow all fruit bodies to near-zero gravity
    fruits.forEach(f => {
      if (!f.sliced && f.kind !== 'bomb' && f.kind !== 'powerup' && f.sprite?.body) {
        f.sprite.body.setGravityY(-(GRAVITY)); // cancel world gravity
        f.sprite.body.setVelocityY(f.sprite.body.velocity.y * 0.1);
      }
    });

    _showPowerupBanner('❄️ FREEZE ACTIVE', 'freeze', dur);

    freezeTimer = setTimeout(() => {
      freezeActive = false;
      // Restore normal gravity (world gravity handles it, just remove override)
      fruits.forEach(f => {
        if (!f.sliced && f.kind !== 'bomb' && f.kind !== 'powerup' && f.sprite?.body) {
          f.sprite.body.setGravityY(0); // let world gravity take over again
        }
      });
      _hidePowerupBanner('freeze');
    }, dur);
  }

  function _activateDouble(dur) {
    clearTimeout(doubleScoreTimer);
    doubleScoreActive = true;
    _showPowerupBanner('⚡ 2× SCORE', 'double', dur);
    doubleScoreTimer = setTimeout(() => {
      doubleScoreActive = false;
      _hidePowerupBanner('double');
    }, dur);
  }

  function _showPowerupBanner(text, id, dur) {
    if (!powerupHUD) return;
    // Remove any old badge for this id before adding the new one
    const old = powerupHUD.querySelector(`[data-pu="${id}"]`);
    if (old) old.remove();

    const badge = document.createElement('div');
    badge.className   = 'pu-badge pu-badge--in';
    badge.dataset.pu  = id;
    badge.textContent = text;

    // Countdown bar inside the badge
    const bar = document.createElement('div');
    bar.className = 'pu-bar';
    badge.appendChild(bar);
    powerupHUD.appendChild(badge);

    // Trigger CSS entrance animation
    requestAnimationFrame(() => badge.classList.add('pu-badge--visible'));

    // Animate the countdown bar shrinking
    bar.style.transition = `width ${dur}ms linear`;
    requestAnimationFrame(() => { bar.style.width = '0%'; });
  }

  function _hidePowerupBanner(id) {
    if (!powerupHUD) return;
    const badge = powerupHUD.querySelector(`[data-pu="${id}"]`);
    if (!badge) return;
    badge.classList.remove('pu-badge--visible');
    badge.classList.add('pu-badge--out');
    setTimeout(() => badge.remove(), 350);
  }

  function getScoreMultiplier() {
    return doubleScoreActive ? 2 : 1;
  }

  function resetAll() {
    clearTimeout(freezeTimer);
    clearTimeout(doubleScoreTimer);
    freezeActive      = false;
    doubleScoreActive = false;
    if (powerupHUD) powerupHUD.innerHTML = '';
  }

  return { spawn, activate, getScoreMultiplier, resetAll };
})();

// ─── PRELOAD ──────────────────────────────────────────────────────────────────
function preload() {}

// ─── CREATE ───────────────────────────────────────────────────────────────────
function create() {
  // Init both hand trails with different depth offsets so they don't overlap z-fighting
  HandTrails[0].init(this, 0);
  HandTrails[1].init(this, 0.5);
  // 🔥 PRELOAD FRUIT TEXTURES (ADD THIS BLOCK)
this.fruitTextures = {};

FRUIT_TYPES.forEach(type => {
  const gfx = this.add.graphics();
  gfx.fillStyle(type.color, 1);
  gfx.fillCircle(FRUIT_SIZE/2, FRUIT_SIZE/2, FRUIT_SIZE/2);

  const key = 'fruit_' + type.name;
  gfx.generateTexture(key, FRUIT_SIZE, FRUIT_SIZE);
  gfx.destroy();

  this.fruitTextures[type.name] = key;
});
  _legacyGfx = this.add.graphics();
  _dotGfx    = this.add.graphics();
  _dotGfx.setDepth(20);
  this.input.enabled = true;
  if (this.input.mouse) this.input.mouse.disableContextMenu();
  window._phaserScene = this;

  // ── Mouse/touch fallback for slicing ──────────────────────────────────────
  // When no hand is detected, the player can use mouse pointer or touch to slice.
  this.input.on('pointermove', (pointer) => {
    if (!gameRunning || gamePaused) return;
    if (fingerX[0] !== null || fingerX[1] !== null) return; // hand tracking active
    const px = pointer.x, py = pointer.y;
    HandTrails[0].addPoint(px, py);
    HandDetectors[0].update(px, py, 16);
    checkSliceHand.call(this, px, py, 0);
  });
}

// ─── UPDATE ───────────────────────────────────────────────────────────────────
function update(time, delta) {
  _legacyGfx.clear();
  ScreenShake.tick(delta);

  // Draw fingertip dots for each detected hand in their own color
  _dotGfx.clear();
  for (let h = 0; h < 2; h++) {
    const fx = fingerX[h], fy = fingerY[h];
    if (fx === null || fy === null) continue;
    const dc = HAND_DOT_COLORS[h];
    _dotGfx.fillStyle(dc, 0.10); _dotGfx.fillCircle(fx, fy, 48);
    _dotGfx.fillStyle(dc, 0.35); _dotGfx.fillCircle(fx, fy, 26);
    _dotGfx.fillStyle(0xffffff, 1.00); _dotGfx.fillCircle(fx, fy,  7);
  }

  if (!gameRunning) return;

  // Draw both slash trails
  const now = performance.now();
  HandTrails[0].draw(now);
  HandTrails[1].draw(now);

  if (!gameRunning || gamePaused) return;

  for (let i = fruits.length - 1; i >= 0; i--) {
    const fruit = fruits[i];
    if (!fruit || fruit.sliced) continue;
    const { sprite, text: label } = fruit;
    sprite.angle += fruit.spinSpeed * (delta / 1000);
    // 🚫 Prevent fruits from escaping horizontally
if (sprite.x < 50) {
  sprite.x = 50;
  sprite.body.setVelocityX(Math.abs(sprite.body.velocity.x));
}
if (sprite.x > window.innerWidth - 50) {
  sprite.x = window.innerWidth - 50;
  sprite.body.setVelocityX(-Math.abs(sprite.body.velocity.x));
}
    if (label) { label.setPosition(sprite.x, sprite.y); label.setAngle(sprite.angle); }
    // Sync glow ring (bombs & powerups) to the physics sprite position
    if (fruit.glow?.active) { fruit.glow.setPosition(sprite.x, sprite.y); }
    // Bombs and powerups that fall off-screen are silently removed (no life lost)
    if (sprite.y > window.innerHeight + 80 && sprite.body.velocity.y > 0) {
      if (fruit.kind === 'bomb' || fruit.kind === 'powerup') {
        if (fruit.glow?.active)   fruit.glow.destroy();
        if (sprite.active)        sprite.destroy();
        if (label?.active)        label.destroy();
        fruits.splice(i, 1);
      } else {
        missedFruit(i);
      }
    }
  }

  particles = particles.filter(p => {
    if (p && p.active) return true;
    if (p) p.destroy();
    return false;
  });
}

// ─── SPAWN FRUIT ─────────────────────────────────────────────────────────────
// Each spawn slot is first rolled against BOMB_CHANCE, then POWERUP_CHANCE.
// Only if both rolls miss does a regular fruit spawn.
function spawnFruit() {
  if (fruits.length > 6) return;
  if (!gameRunning || !window._phaserScene) return;
  const scene = window._phaserScene;

  const roll = Math.random();
  if (roll < BOMB_CHANCE)                          { BombSystem.spawn(scene);   return; }
  if (roll < BOMB_CHANCE + POWERUP_CHANCE)         { PowerUpSystem.spawn(scene); return; }

  // ── Regular fruit ─────────────────────────────────────────────────────────
  const W = window.innerWidth, H = window.innerHeight;
  const type = FRUIT_TYPES[Phaser.Math.Between(0, FRUIT_TYPES.length - 1)];
  const x    = Phaser.Math.Between(W * 0.08, W * 0.92);
  const y    = H + 40;

  const textureKey = scene.fruitTextures[type.name];
  const sprite = scene.physics.add.sprite(x, y, textureKey);
  sprite.setCircle(FRUIT_SIZE/2);
  sprite.setAlpha(0);
  sprite.setDepth(1);

  const label = scene.add.text(x, y, type.emoji, {
    fontSize: `${FRUIT_SIZE}px`, align: 'center'
  });
  label.setOrigin(0.5, 0.5);
  label.setDepth(2);

  sprite.body.setVelocity(Phaser.Math.Between(-120, 120), Phaser.Math.Between(-950, -720));
  sprite.body.setMaxVelocityY(1400);

  fruits.push({ sprite, text: label, kind: 'fruit', type, sliced: false, spinSpeed: Phaser.Math.Between(-200, 200) });
}

// ─── SWIPE DETECTOR MODULE (per-hand) ────────────────────────────────────────
// Factory producing an independent velocity + segment-hit detector per hand.
function _makeSwipeDetector() {
  let prevX = null, prevY = null;
  let _fromX = null, _fromY = null;
  let _speed = 0;
  const _angleWindow = [];

  function reset() {
    prevX = null; prevY = null;
    _fromX = null; _fromY = null;
    _speed = 0; _angleWindow.length = 0;
  }

  function update(x, y, dt) {
    if (prevX !== null && dt > 0) {
      const dx = x - prevX, dy = y - prevY;
      const dist = Math.sqrt(dx*dx + dy*dy);
      _speed = (1 - VELOCITY_SMOOTH) * _speed + VELOCITY_SMOOTH * (dist / (dt / 1000));
      if (dist >= SLICE_MIN_SEGMENT_PX * 0.5) {
        _angleWindow.push(Math.atan2(dy, dx));
        if (_angleWindow.length > SLICE_DIR_SAMPLES) _angleWindow.shift();
      }
    }
    _fromX = prevX; _fromY = prevY;
    prevX  = x;     prevY  = y;
  }

  function getFrom() { return { x: _fromX, y: _fromY }; }

  function canSlice() {
    return _fromX !== null && _speed >= SLICE_MIN_SPEED;
  }

  function segmentHitsFruit(fruit, currX, currY) {
    if (_fromX === null) return false;
    const ax = _fromX, ay = _fromY, bx = currX, by = currY;
    const abx = bx-ax, aby = by-ay;
    const abLenSq = abx*abx + aby*aby;
    if (abLenSq < SLICE_MIN_SEGMENT_PX * SLICE_MIN_SEGMENT_PX) return false;
    const cx = fruit.sprite.x, cy = fruit.sprite.y;
    const t  = Math.max(0, Math.min(1, ((cx-ax)*abx + (cy-ay)*aby) / abLenSq));
    const dx = (ax + t*abx) - cx, dy2 = (ay + t*aby) - cy;
    return (dx*dx + dy2*dy2) < (SEGMENT_RADIUS * SEGMENT_RADIUS);
  }

  return { reset, update, canSlice, segmentHitsFruit, getFrom };
}

// Two detector instances — one per hand
const HandDetectors = [_makeSwipeDetector(), _makeSwipeDetector()];

// ─── CHECK SLICE (per-hand) ───────────────────────────────────────────────────
// Called for each hand independently. Routes hits to sliceFruit, bomb, or powerup.
function checkSliceHand(currX, currY, handIdx) {
  const detector = HandDetectors[handIdx];
  if (!detector.canSlice()) return;

  const scene = this;

  for (let i = fruits.length - 1; i >= 0; i--) {
    const fruit = fruits[i];
    if (!fruit || fruit.sliced) continue;

    if (!detector.segmentHitsFruit(fruit, currX, currY)) continue;

    if (fruit.kind === 'bomb') {
      fruit.sliced = true;
      fruits.splice(i, 1);
      BombSystem.explode(fruit, scene);
      return;
    }

    if (fruit.kind === 'powerup') {
      fruit.sliced = true;
      if (fruit.glow?.active)   fruit.glow.destroy();
      if (fruit.sprite?.active) fruit.sprite.destroy();
      if (fruit.text?.active)   fruit.text.destroy();
      fruits.splice(i, 1);
      PowerUpSystem.activate(fruit, scene);
      continue;
    }

    // Normal fruit
    sliceFruit.call(scene, i);
  }
}

// ─── SLICE FRUIT ─────────────────────────────────────────────────────────────
function sliceFruit(index) {
  const fruit = fruits[index];
  if (!fruit || fruit.sliced) return;
  fruit.sliced = true;

  const scene = window._phaserScene;
  const cx    = fruit.sprite.x;
  const cy    = fruit.sprite.y;

  // ── Combo ────────────────────────────────────────────────────────────────
  combo++;
  clearTimeout(comboTimer);
  comboTimer = setTimeout(() => { combo = 0; }, COMBO_WINDOW_MS);

  // ── Rapid-slice → slow-motion trigger ─────────────────────────────────────
  rapidSliceCount++;
  clearTimeout(rapidSliceTimer);
  rapidSliceTimer = setTimeout(() => { rapidSliceCount = 0; }, SLOWMO_WINDOW_MS);
  if (rapidSliceCount >= SLOWMO_THRESHOLD) {
    SlowMotion.trigger(scene);
    rapidSliceCount = 0;
  }

  // ── Scoring with multiplier + power-up double ───────────────────────────
  const comboMult  = combo >= 4 ? 4 : combo >= 3 ? 3 : combo >= 2 ? 2 : 1;
  const multiplier = comboMult * PowerUpSystem.getScoreMultiplier();
  addScore(multiplier, cx, cy);
  showCombo(combo);

  // ── Screen shake (scales with combo) ────────────────────────────────────
  ScreenShake.trigger(scene, Math.min(SHAKE_INTENSITY + combo * 1.5, 18), SHAKE_DURATION);

  // ── Particle burst ───────────────────────────────────────────────────────
  spawnParticles(scene, fruit);

  // ── Slice animation: two emoji halves diverge along the cut ──────────────
  // Left half (cropped right side hidden)
  const halfL = scene.add.text(cx, cy, fruit.type.emoji, {
    fontSize: `${FRUIT_SIZE}px`, align: 'center'
  });
  halfL.setOrigin(0.5, 0.5);
  halfL.setDepth(7);
  halfL.setCrop(0, 0, Math.floor(halfL.width / 2), halfL.height);

  // Right half (cropped left side hidden)
  const halfR = scene.add.text(cx, cy, fruit.type.emoji, {
    fontSize: `${FRUIT_SIZE}px`, align: 'center'
  });
  halfR.setOrigin(0.5, 0.5);
  halfR.setDepth(7);
  halfR.setCrop(Math.ceil(halfR.width / 2), 0, halfR.width, halfR.height);

  const flyDist  = Phaser.Math.Between(65, 120);
  const flyAngle = Phaser.Math.FloatBetween(0, Math.PI * 2);

  scene.tweens.add({
    targets: halfL,
    x: cx - Math.cos(flyAngle) * flyDist,
    y: cy - Math.abs(Math.sin(flyAngle)) * flyDist - 30,
    angle: -Phaser.Math.Between(90, 180),
    alpha: 0, scaleX: 0.5, scaleY: 0.5,
    duration: 500, ease: 'Cubic.easeOut',
    onComplete: () => { if (halfL.active) halfL.destroy(); }
  });

  scene.tweens.add({
    targets: halfR,
    x: cx + Math.cos(flyAngle) * flyDist,
    y: cy - Math.abs(Math.sin(flyAngle)) * flyDist - 30,
    angle:  Phaser.Math.Between(90, 180),
    alpha: 0, scaleX: 0.5, scaleY: 0.5,
    duration: 500, ease: 'Cubic.easeOut',
    onComplete: () => { if (halfR.active) halfR.destroy(); }
  });

  // Fade out original sprites immediately
  scene.tweens.add({
    targets: [fruit.sprite, fruit.text],
    scaleX: 1.25, scaleY: 1.25, alpha: 0,
    duration: 70, ease: 'Quad.easeOut',
    onComplete: () => {
      if (fruit.sprite?.active) fruit.sprite.destroy();
      if (fruit.text?.active)   fruit.text.destroy();
    }
  });

  fruits.splice(index, 1);
}

// ─── SPAWN PARTICLES — 5-layer AAA juice burst ───────────────────────────────
function spawnParticles(scene, fruit) {
  const color = fruit.type.color;
  const cx    = fruit.sprite.x;
  const cy    = fruit.sprite.y;

  // Layer 1 — instant white core flash
  const flash = scene.add.circle(cx, cy, FRUIT_SIZE * 0.55, 0xffffff, 0.9);
  flash.setDepth(10);
  scene.tweens.add({
    targets: flash, scaleX: 2.5, scaleY: 2.5, alpha: 0,
    duration: 150, ease: 'Quad.easeOut',
    onComplete: () => { if (flash.active) flash.destroy(); }
  });

  // Layer 2 — expanding coloured ring shockwave
  const ring = scene.add.circle(cx, cy, FRUIT_SIZE * 0.3, 0xffffff, 0);
  ring.setStrokeStyle(4, color, 1.0);
  ring.setDepth(5);
  scene.tweens.add({
    targets: ring, scaleX: 5, scaleY: 5, alpha: 0,
    duration: 400, ease: 'Sine.easeOut',
    onComplete: () => { if (ring.active) ring.destroy(); }
  });

  // Second thinner ring slightly delayed
  const ring2 = scene.add.circle(cx, cy, FRUIT_SIZE * 0.2, 0xffffff, 0);
  ring2.setStrokeStyle(2, 0xffffff, 0.7);
  ring2.setDepth(5);
  scene.tweens.add({
    targets: ring2, scaleX: 6, scaleY: 6, alpha: 0,
    delay: 80, duration: 480, ease: 'Sine.easeOut',
    onComplete: () => { if (ring2.active) ring2.destroy(); }
  });

  // Layer 3 — chunky juice drops
  const DROP_COUNT = 6;
  for (let i = 0; i < DROP_COUNT; i++) {
    const baseAngle = (i / DROP_COUNT) * Math.PI * 2;
    const angle     = baseAngle + Phaser.Math.FloatBetween(-0.25, 0.25);
    const speed     = Phaser.Math.Between(70, 280);
    const radius    = Phaser.Math.Between(4, 10);
    const dropColor = i % 4 === 0 ? 0xffffff : color;
    const drop      = scene.add.circle(cx, cy, radius, dropColor, 1);
    drop.setDepth(6);
    scene.tweens.add({
      targets: drop,
      x: cx + Math.cos(angle) * speed,
      y: cy + Math.sin(angle) * speed - Phaser.Math.Between(0, 40),
      scaleX: 0.1, scaleY: 0.1, alpha: 0,
      duration: 420 + Math.random() * 260,
      ease: 'Quad.easeOut',
      onComplete: () => { if (drop.active) drop.destroy(); }
    });
  }

  // Layer 4 — elongated juice streaks
  const STREAK_COUNT = 4;
  for (let i = 0; i < STREAK_COUNT; i++) {
    const angle  = Phaser.Math.FloatBetween(0, Math.PI * 2);
    const speed  = Phaser.Math.Between(100, 300);
    const len    = Phaser.Math.Between(20, 50);
    const streak = scene.add.rectangle(cx, cy, len, Phaser.Math.Between(3, 5), color, 0.85);
    streak.setDepth(6);
    streak.setRotation(angle);
    scene.tweens.add({
      targets: streak,
      x: cx + Math.cos(angle) * speed,
      y: cy + Math.sin(angle) * speed,
      scaleX: 0.05, scaleY: 0.05, alpha: 0,
      duration: 360 + Math.random() * 200,
      ease: 'Cubic.easeOut',
      onComplete: () => { if (streak.active) streak.destroy(); }
    });
  }

  // Layer 5 — soft mist clouds
  for (let i = 0; i < 2; i++) {
    const ox   = Phaser.Math.Between(-25, 25);
    const oy   = Phaser.Math.Between(-25, 25);
    const mist = scene.add.circle(cx + ox, cy + oy,
      Phaser.Math.Between(18, 38), color, 0.15);
    mist.setDepth(4);
    scene.tweens.add({
      targets: mist,
      scaleX: 4, scaleY: 4, alpha: 0,
      duration: 550 + Math.random() * 200,
      ease: 'Sine.easeOut',
      onComplete: () => { if (mist.active) mist.destroy(); }
    });
  }
}

// ─── MISSED FRUIT ────────────────────────────────────────────────────────────
function missedFruit(index) {
  const fruit = fruits[index];
  if (!fruit) return;
  if (fruit.sprite?.active) fruit.sprite.destroy();
  if (fruit.text?.active)   fruit.text.destroy();
  fruits.splice(index, 1);
  combo = 0;
  lives--;
  updateLivesUI();

  // Full-screen red flash on life loss
  const scene = window._phaserScene;
  if (scene) {
    const flash = scene.add.rectangle(
      window.innerWidth/2, window.innerHeight/2,
      window.innerWidth, window.innerHeight, 0xff0000, 0.25
    );
    flash.setDepth(50);
    scene.tweens.add({
      targets: flash, alpha: 0, duration: 500, ease: 'Quad.easeOut',
      onComplete: () => { if (flash.active) flash.destroy(); }
    });
    ScreenShake.trigger(scene, 12, 250);
  }

  if (lives <= 0) triggerGameOver('3 fruits missed');
}

// ─── ADD SCORE ────────────────────────────────────────────────────────────────
// Updates HUD + spawns a floating "+N ×M" pop-up at the slice position.
function addScore(points, cx, cy) {
  score += points;
  scoreEl.textContent = score;

  scoreEl.classList.remove('pop');
  requestAnimationFrame(() => scoreEl.classList.add('pop'));
  setTimeout(() => scoreEl.classList.remove('pop'), 150);

  const scene = window._phaserScene;
  if (scene && cx !== undefined) {
    const txt   = points > 1 ? `+${points} ×${points}` : `+${points}`;
    const color = points >= 4 ? '#ff2d78' : points >= 3 ? '#ff8c00' : points >= 2 ? '#ffe600' : '#ffffff';
    const pop   = scene.add.text(cx, cy - 10, txt, {
      fontFamily: 'Boogaloo, cursive',
      fontSize  : points > 1 ? '38px' : '28px',
      color,
      stroke         : '#000000',
      strokeThickness: 4,
    });
    pop.setOrigin(0.5, 0.5);
    pop.setDepth(15);
    scene.tweens.add({
      targets: pop,
      y: cy - 100, alpha: 0, scaleX: 1.5, scaleY: 1.5,
      duration: 750, ease: 'Cubic.easeOut',
      onComplete: () => { if (pop.active) pop.destroy(); }
    });
  }
}

// ─── UPDATE LIVES UI ─────────────────────────────────────────────────────────
function updateLivesUI() {
  lifeIcons.forEach((icon, i) => {
    if (i >= lives) icon.classList.add('lost');
  });
}

// ─── SHOW COMBO ───────────────────────────────────────────────────────────────
// Uses CSS level-classes for colour escalation + slam animation.
function showCombo(count) {
  if (count < 2) {
    comboEl.textContent = '';
    comboEl.classList.remove('show', 'combo-2', 'combo-3', 'combo-4', 'combo-mega');
    return;
  }

  const labels = ['', '', 'DOUBLE!', 'TRIPLE!', 'QUAD!', 'ULTRA!'];
  comboEl.textContent = count < labels.length ? labels[count] : `${count}× COMBO!`;

  // Force reflow so animation re-fires each consecutive slice
  comboEl.classList.remove('show', 'combo-2', 'combo-3', 'combo-4', 'combo-mega');
  void comboEl.offsetWidth;

  const lvl = count >= 5 ? 'combo-mega' : count === 4 ? 'combo-4' : count === 3 ? 'combo-3' : 'combo-2';
  comboEl.classList.add('show', lvl);

  clearTimeout(window._comboHideTimer);
  window._comboHideTimer = setTimeout(() => {
    comboEl.classList.remove('show', 'combo-2', 'combo-3', 'combo-4', 'combo-mega');
  }, 1100);
}

// ─── START GAME ───────────────────────────────────────────────────────────────
function startGame() {
  score           = 0;
  lives           = MAX_LIVES;
  combo           = 0;
  rapidSliceCount = 0;
  spawnDelay      = SPAWN_INTERVAL;
  gameRunning     = true;
  gamePaused      = false;

  // Hide pause screen if somehow still visible
  if (pauseScreen) pauseScreen.classList.add('hidden');

  clearFruits();
  PowerUpSystem.resetAll();

  scoreEl.textContent = '0';
  lifeIcons.forEach(icon => icon.classList.remove('lost'));
  comboEl.classList.remove('show', 'combo-2', 'combo-3', 'combo-4', 'combo-mega');
  if (slowMoVignette) slowMoVignette.classList.remove('active');
  if (gameOverReason) gameOverReason.textContent = '';

  // Reset slow-mo and physics if still active from last game
  const scene = window._phaserScene;
  if (scene) {
    scene.physics.world.timeScale = 1;
    scene.time.timeScale           = 1;
  }

  startScreen.classList.add('hidden');
  gameOverEl.classList.add('hidden');

  spawnTimer = setInterval(spawnFruit, spawnDelay);
  diffTimer  = setInterval(() => {
    clearInterval(spawnTimer);
    spawnDelay = Math.max(MIN_INTERVAL, spawnDelay - 80);
    spawnTimer = setInterval(spawnFruit, spawnDelay);
  }, 10000);
}

// ─── GAME OVER ────────────────────────────────────────────────────────────────
// reason: optional string shown under the GAME OVER heading (e.g. '💣 BOMB HIT!')
function triggerGameOver(reason) {
  if (!gameRunning) return;          // guard against double-call (bomb + timeout race)
  gameRunning = false;
  gamePaused  = false;
  if (pauseScreen) pauseScreen.classList.add('hidden');
  clearInterval(spawnTimer);
  clearInterval(diffTimer);
  clearFruits();

  // Restore time scale in case slow-mo was active
  const scene = window._phaserScene;
  if (scene) {
    scene.physics.world.timeScale = 1;
    scene.time.timeScale           = 1;
  }
  if (slowMoVignette) slowMoVignette.classList.remove('active');

  // Cancel any active power-ups
  PowerUpSystem.resetAll();

  // Leaderboard: update high score
  if (score > highScore) {
    highScore = score;
    localStorage.setItem('fruitSlashHigh', highScore);
  }

  // Show reason (bomb hit, lives depleted, etc.)
  if (gameOverReason) {
    gameOverReason.textContent = reason || '3 fruits missed';
  }

  finalScoreEl.textContent = score;
  highScoreEl.textContent  = highScore;
  gameOverEl.classList.remove('hidden');
}

// ─── CLEAR FRUITS ─────────────────────────────────────────────────────────────
function clearFruits() {
  for (const fruit of fruits) {
    if (fruit.glow?.active)   fruit.glow.destroy();   // bombs + powerups have a glow
    if (fruit.sprite?.active) fruit.sprite.destroy();
    if (fruit.text?.active)   fruit.text.destroy();
  }
  fruits = [];
}

// ─── BUTTON LISTENERS ─────────────────────────────────────────────────────────
startBtn.addEventListener('click', startGame);
restartBtn.addEventListener('click', startGame);
resumeBtn.addEventListener('click', resumeGame);

if (highScore > 0) {
  const hint = document.getElementById('hint-text');
  if (hint) hint.textContent = `Best: ${highScore} · Slice fruits · Miss 3 = game over`;
}