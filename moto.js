(function () {
  const canvas = document.getElementById('motoCanvas');
  const ctx = canvas.getContext('2d');
  const overlay = document.getElementById('motoOverlay');
  const overlayText = document.getElementById('motoOverlayText');
  const restartBtn = document.getElementById('motoRestartBtn');
  const scoreEl = document.getElementById('motoScore');
  const highScoreEl = document.getElementById('motoHighScore');
  const fuelBarEl = document.getElementById('motoFuelBar');

  const W = canvas.width = 900;
  const H = canvas.height = 400;

  // --- Physics constants ---
  const GRAVITY = 0.22;
  const THROTTLE = 0.32;
  const FRICTION_GROUND = 0.92;
  const FRICTION_AIR = 0.998;
  const ANGULAR_ACCEL = 0.018;
  const MAX_ANGLE_SPEED = 0.35;
  const BIKE_LENGTH = 50;
  const BIKE_HEIGHT = 22;
  const WHEEL_R = 13;
  const GROUND_BASE = H - 160;
  const CAMERA_LEAD = 140;
  const SEGMENT_LENGTH = 80;
  const MAX_SLOPE = 0.45;

  // Terrain
  const GROUND_MIN = GROUND_BASE - 100;
  const GROUND_MAX = GROUND_BASE + 60;
  const JUMP_SEGMENTS = 5;
  const JUMP_BOOST_MIN = 90;
  const JUMP_BOOST_MAX = 160;

  // Jet boost
  const JET_THRUST = 0.85;
  const JET_MAX_VX = 18;
  const JET_PARTICLES_MAX = 180;
  const JET_PARTICLE_GRAVITY = 0.16;
  const JET_PARTICLE_LIFE_MIN = 18;
  const JET_PARTICLE_LIFE_MAX = 30;

  // Fuel
  const MAX_FUEL = 300;
  const FUEL_DRAIN = 1.2;
  const FUEL_REGEN_GROUND = 0.45;
  const FUEL_REGEN_AIR = 0.08;

  // Tricks
  const FLIP_THRESHOLD = Math.PI * 1.8;

  // --- State ---
  let running = false;
  let score = 0;
  let highScore = parseInt(localStorage.getItem('motoHighScore') || '0', 10);
  let terrain = [];
  let bike = null;
  let cameraX = 0;
  let seed = 0;
  let baseSeed = 0;
  let trees = [];
  let nextTreeX = 0;
  let groundPattern = null;
  let jumpState = { remaining: 0, total: 0, boost: 0 };
  let suspensionPos = 0;
  let suspensionVel = 0;
  let wasOnGround = false;
  let jetParticles = [];
  let dustParticles = [];
  let fuelLevel = MAX_FUEL;
  let jumpChance = 0.08;

  // Tricks
  let airborneFrames = 0;
  let airborneRotation = 0;
  let trickText = '';
  let trickTimer = 0;
  let totalTrickBonus = 0;

  // Rider visual lean
  let visualTilt = 0;

  // Clouds
  let clouds = [];

  // --- Audio ---
  const audio = (function () {
    let actx = null;
    let engineOsc = null;
    let engineGain = null;

    function getCtx() {
      if (!actx) {
        try { actx = new (window.AudioContext || window.webkitAudioContext)(); } catch (e) { return null; }
      }
      return actx;
    }

    return {
      startEngine: function () {
        const c = getCtx();
        if (!c || engineOsc) return;
        engineGain = c.createGain();
        engineGain.gain.value = 0.055;
        engineGain.connect(c.destination);
        engineOsc = c.createOscillator();
        engineOsc.type = 'sawtooth';
        engineOsc.frequency.value = 55;
        engineOsc.connect(engineGain);
        engineOsc.start();
      },
      updateEngine: function (vx, jetOn) {
        if (!engineOsc || !actx) return;
        const target = 55 + vx * 12 + (jetOn ? 35 : 0);
        engineOsc.frequency.setTargetAtTime(target, actx.currentTime, 0.1);
        engineGain.gain.setTargetAtTime(jetOn ? 0.09 : 0.055, actx.currentTime, 0.05);
      },
      stopEngine: function () {
        if (!engineOsc) return;
        try { engineOsc.stop(); } catch (e) {}
        engineOsc = null;
        engineGain = null;
      },
      crash: function () {
        const c = getCtx();
        if (!c) return;
        const osc = c.createOscillator();
        const g = c.createGain();
        osc.connect(g); g.connect(c.destination);
        osc.type = 'sawtooth';
        osc.frequency.value = 90;
        g.gain.value = 0.28;
        osc.start();
        osc.frequency.exponentialRampToValueAtTime(25, c.currentTime + 0.45);
        g.gain.exponentialRampToValueAtTime(0.001, c.currentTime + 0.55);
        osc.stop(c.currentTime + 0.6);
      },
      trick: function () {
        const c = getCtx();
        if (!c) return;
        [523, 659, 784, 1047].forEach(function (freq, i) {
          const osc = c.createOscillator();
          const g = c.createGain();
          osc.connect(g); g.connect(c.destination);
          osc.type = 'sine';
          osc.frequency.value = freq;
          const t = c.currentTime + i * 0.08;
          g.gain.setValueAtTime(0.15, t);
          g.gain.exponentialRampToValueAtTime(0.001, t + 0.22);
          osc.start(t); osc.stop(t + 0.28);
        });
      },
      land: function (impact) {
        const c = getCtx();
        if (!c || impact < 0.15) return;
        const osc = c.createOscillator();
        const g = c.createGain();
        osc.connect(g); g.connect(c.destination);
        osc.type = 'sine';
        osc.frequency.value = 100 + impact * 40;
        g.gain.value = impact * 0.12;
        osc.start();
        g.gain.exponentialRampToValueAtTime(0.001, c.currentTime + 0.12);
        osc.stop(c.currentTime + 0.15);
      }
    };
  }());

  // --- RNG ---
  function rnd() {
    seed = (seed * 9301 + 49297) % 233280;
    return seed / 233280;
  }

  function randAt(n) {
    const s = baseSeed || seed || 1;
    const v = Math.sin((n + 1) * 12.9898 + s * 0.12345) * 43758.5453;
    return v - Math.floor(v);
  }

  // --- Terrain ---
  function buildSegment(segX, prevY) {
    const bump = (rnd() - 0.5) * 55;
    const ramp = (rnd() - 0.45) * 50;
    let nextY = prevY + bump + ramp;

    if (jumpState.remaining <= 0 && segX > 150 && rnd() < jumpChance) {
      jumpState.total = JUMP_SEGMENTS;
      jumpState.remaining = JUMP_SEGMENTS;
      jumpState.boost = JUMP_BOOST_MIN + rnd() * (JUMP_BOOST_MAX - JUMP_BOOST_MIN);
    }
    if (jumpState.remaining > 0) {
      const jumpIndex = jumpState.total - jumpState.remaining;
      const progress = jumpIndex / (jumpState.total - 1);
      nextY += Math.sin(Math.PI * progress) * jumpState.boost;
      jumpState.remaining -= 1;
    }

    nextY = Math.max(GROUND_MIN, Math.min(GROUND_MAX, nextY));
    let slope = (nextY - prevY) / SEGMENT_LENGTH;
    slope = Math.max(-MAX_SLOPE, Math.min(MAX_SLOPE, slope));
    nextY = prevY + slope * SEGMENT_LENGTH;
    return { x0: segX, y0: prevY, x1: segX + SEGMENT_LENGTH, y1: nextY, slope: slope };
  }

  function initTerrain() {
    terrain = [];
    jumpState.remaining = 0;
    jumpState.total = 0;
    jumpState.boost = 0;
    jumpChance = 0.08;
    let x = -200, y = GROUND_BASE;
    while (x < 5000) {
      const seg = buildSegment(x, y);
      terrain.push(seg);
      y = seg.y1;
      x = seg.x1;
    }
  }

  function extendTerrain() {
    let last = terrain[terrain.length - 1];
    while (last.x1 < cameraX + W + 400) {
      // Difficulty ramp: jump chance increases with distance
      if (bike) jumpChance = Math.min(0.2, 0.08 + bike.x / 18000);
      const seg = buildSegment(last.x1, last.y1);
      terrain.push(seg);
      last = seg;
    }
  }

  function getGroundAt(x) {
    for (let i = 0; i < terrain.length; i++) {
      const t = terrain[i];
      if (x >= t.x0 && x < t.x1) {
        const t0 = (x - t.x0) / (t.x1 - t.x0);
        return { y: t.y0 + t0 * (t.y1 - t.y0), slope: t.slope };
      }
    }
    return { y: GROUND_BASE, slope: 0 };
  }

  function getTerrainMaxX() {
    return terrain.length ? terrain[terrain.length - 1].x1 : 0;
  }

  // --- Clouds ---
  function initClouds() {
    clouds = [];
    for (let i = 0; i < 10; i++) {
      clouds.push({
        x: randAt(600000 + i * 31) * 4000,
        y: 25 + randAt(700000 + i * 37) * 80,
        w: 80 + randAt(800000 + i * 41) * 130,
        h: 28 + randAt(900000 + i * 43) * 22,
        par: 0.03 + randAt(1000000 + i * 47) * 0.07
      });
    }
  }

  // --- Drawing: Sky ---
  function drawSky() {
    const grad = ctx.createLinearGradient(0, 0, 0, GROUND_BASE + 20);
    grad.addColorStop(0, '#3a7fd5');
    grad.addColorStop(0.5, '#6fb0e8');
    grad.addColorStop(1, '#b8ddf4');
    ctx.fillStyle = grad;
    ctx.fillRect(0, 0, W, H);
  }

  function drawSun() {
    const sx = W - 110, sy = 55, r = 26;
    // Glow halo
    const glow = ctx.createRadialGradient(sx, sy, r * 0.4, sx, sy, r * 2.8);
    glow.addColorStop(0, 'rgba(255,245,160,0.55)');
    glow.addColorStop(1, 'rgba(255,245,160,0)');
    ctx.fillStyle = glow;
    ctx.beginPath();
    ctx.arc(sx, sy, r * 2.8, 0, Math.PI * 2);
    ctx.fill();
    // Disc
    ctx.fillStyle = '#FFE033';
    ctx.beginPath();
    ctx.arc(sx, sy, r, 0, Math.PI * 2);
    ctx.fill();
    // Rays
    ctx.strokeStyle = 'rgba(255,230,80,0.55)';
    ctx.lineWidth = 2;
    for (let i = 0; i < 12; i++) {
      const a = (i / 12) * Math.PI * 2;
      ctx.beginPath();
      ctx.moveTo(sx + Math.cos(a) * (r + 5), sy + Math.sin(a) * (r + 5));
      ctx.lineTo(sx + Math.cos(a) * (r + 16), sy + Math.sin(a) * (r + 16));
      ctx.stroke();
    }
  }

  function drawClouds() {
    ctx.save();
    ctx.globalAlpha = 0.9;
    for (let i = 0; i < clouds.length; i++) {
      const c = clouds[i];
      const wrap = W + c.w + 300;
      let sx = (c.x - cameraX * c.par) % wrap;
      if (sx < -c.w) sx += wrap;
      drawCloud(sx, c.y, c.w, c.h);
    }
    ctx.restore();
  }

  function drawCloud(x, y, w, h) {
    ctx.fillStyle = '#ffffff';
    // Base puffs
    ctx.beginPath(); ctx.ellipse(x + w * 0.5, y + h * 0.65, w * 0.44, h * 0.38, 0, 0, Math.PI * 2); ctx.fill();
    ctx.beginPath(); ctx.ellipse(x + w * 0.28, y + h * 0.62, w * 0.30, h * 0.33, 0, 0, Math.PI * 2); ctx.fill();
    ctx.beginPath(); ctx.ellipse(x + w * 0.72, y + h * 0.60, w * 0.27, h * 0.30, 0, 0, Math.PI * 2); ctx.fill();
    // Top puffs
    ctx.beginPath(); ctx.ellipse(x + w * 0.50, y + h * 0.32, w * 0.27, h * 0.34, 0, 0, Math.PI * 2); ctx.fill();
    ctx.beginPath(); ctx.ellipse(x + w * 0.34, y + h * 0.42, w * 0.21, h * 0.27, 0, 0, Math.PI * 2); ctx.fill();
    ctx.beginPath(); ctx.ellipse(x + w * 0.66, y + h * 0.40, w * 0.19, h * 0.25, 0, 0, Math.PI * 2); ctx.fill();
    // Shadow underside
    ctx.fillStyle = 'rgba(200,220,240,0.5)';
    ctx.beginPath(); ctx.ellipse(x + w * 0.5, y + h * 0.78, w * 0.40, h * 0.15, 0, 0, Math.PI * 2); ctx.fill();
  }

  // --- Drawing: Trees ---
  function ensureTreesUpTo(worldX) {
    const targetX = Math.min(worldX, getTerrainMaxX());
    while (nextTreeX < targetX) {
      const idx = trees.length;
      nextTreeX += 70 + randAt(200000 + idx * 17) * 95;
      trees.push({
        x: nextTreeX,
        h: 50 + randAt(300000 + idx * 19) * 90,
        variant: randAt(400000 + idx * 23)
      });
    }
  }

  function drawTrees() {
    const par = 0.28, s = 0.85;
    ensureTreesUpTo(cameraX + W + 600);
    for (let i = 0; i < trees.length; i++) {
      const t = trees[i];
      const dx = t.x - cameraX;
      if (dx < -120 || dx > W + 120) continue;
      const screenX = dx * par;
      const baseY = getGroundAt(t.x).y;
      const trunkH = t.h * 0.42 * s;
      const foliH = t.h * 0.75 * s;
      ctx.save();
      ctx.translate(screenX, baseY);
      ctx.globalAlpha = 0.7;
      ctx.fillStyle = '#3a2a1a';
      ctx.fillRect(-2, -trunkH, 4, trunkH);
      const l1 = t.variant > 0.66 ? '#1f5a22' : t.variant > 0.33 ? '#1a4d1f' : '#16421a';
      const l2 = t.variant > 0.66 ? '#1a4d1f' : t.variant > 0.33 ? '#175013' : '#123b16';
      ctx.fillStyle = l2;
      ctx.beginPath(); ctx.arc(0, -trunkH - foliH * 0.25, foliH * 0.48, 0, Math.PI * 2); ctx.fill();
      ctx.fillStyle = l1;
      ctx.beginPath(); ctx.arc(0, -trunkH - foliH * 0.48, foliH * 0.38, 0, Math.PI * 2); ctx.fill();
      ctx.fillStyle = l2;
      ctx.beginPath(); ctx.arc(0, -trunkH - foliH * 0.70, foliH * 0.30, 0, Math.PI * 2); ctx.fill();
      ctx.restore();
    }
  }

  // --- Drawing: Ground ---
  function getGroundPattern() {
    if (groundPattern) return groundPattern;
    const c = document.createElement('canvas');
    c.width = 64; c.height = 64;
    const p = c.getContext('2d');
    p.fillStyle = '#2d5016';
    p.fillRect(0, 0, 64, 64);
    for (let i = 0; i < 64; i += 6) {
      p.fillStyle = i % 12 === 0 ? '#254b16' : '#1f3f12';
      p.fillRect(i, 0, 3, 64);
      p.fillStyle = i % 12 === 0 ? '#1a3009' : '#2a5a1d';
      p.fillRect(i + 3, 0, 2, 64);
    }
    for (let i = 0; i < 220; i++) {
      const rx = Math.floor(randAt(i * 3 + 99) * 64);
      const ry = Math.floor(randAt(i * 7 + 13) * 64);
      const rr = 1 + Math.floor(randAt(i * 11 + 1) * 2);
      p.fillStyle = randAt(i * 17 + 3) > 0.5 ? '#1a3009' : '#244b16';
      p.fillRect(rx, ry, rr, rr);
    }
    groundPattern = ctx.createPattern(c, 'repeat');
    return groundPattern;
  }

  function drawTerrain() {
    const startX = cameraX - 50, endX = cameraX + W + 50;
    ctx.beginPath();
    let started = false;
    for (let i = 0; i < terrain.length; i++) {
      const t = terrain[i];
      if (t.x1 < startX || t.x0 > endX) continue;
      if (!started) {
        ctx.moveTo(t.x0 - cameraX, H);
        ctx.lineTo(t.x0 - cameraX, t.y0);
        started = true;
      }
      ctx.lineTo(t.x1 - cameraX, t.y1);
    }
    ctx.lineTo(endX - cameraX + 100, H);
    ctx.closePath();
    ctx.fillStyle = '#2d5016';
    ctx.fill();
    ctx.save();
    ctx.clip();
    ctx.globalAlpha = 0.22;
    ctx.fillStyle = getGroundPattern();
    ctx.fillRect(0, 0, W, H);
    ctx.globalAlpha = 0.55;
    ctx.strokeStyle = '#1a3009';
    ctx.lineWidth = 1;
    const tuftStep = 55;
    const xStart = Math.floor(startX / tuftStep) * tuftStep;
    for (let x = xStart; x < endX; x += tuftStep) {
      const g = getGroundAt(x);
      const sx = x - cameraX;
      const len = 6 + randAt(x * 0.01) * 12;
      const sway = (randAt(x * 0.02) - 0.5) * 3;
      ctx.beginPath();
      ctx.moveTo(sx, g.y);
      ctx.lineTo(sx + sway, g.y - len);
      ctx.stroke();
    }
    ctx.restore();
    ctx.strokeStyle = '#1a3009';
    ctx.lineWidth = 2;
    ctx.stroke();
  }

  // --- Drawing: Bike ---
  function drawWheel(cx, cy, r, rimCol) {
    // Tire
    ctx.fillStyle = '#111';
    ctx.beginPath(); ctx.arc(cx, cy, r, 0, Math.PI * 2); ctx.fill();
    // Knobs (slightly raised bumps around tread)
    ctx.fillStyle = '#252525';
    for (let i = 0; i < 16; i++) {
      const a = (i / 16) * Math.PI * 2;
      ctx.beginPath();
      ctx.arc(cx + Math.cos(a) * r, cy + Math.sin(a) * r, 2.2, 0, Math.PI * 2);
      ctx.fill();
    }
    // Rim ring
    ctx.strokeStyle = rimCol;
    ctx.lineWidth = 2;
    ctx.beginPath(); ctx.arc(cx, cy, r - 3, 0, Math.PI * 2); ctx.stroke();
    // Spokes
    ctx.strokeStyle = rimCol;
    ctx.lineWidth = 1;
    for (let i = 0; i < 10; i++) {
      const a = (i / 10) * Math.PI * 2;
      ctx.beginPath();
      ctx.moveTo(cx + Math.cos(a) * 3.5, cy + Math.sin(a) * 3.5);
      ctx.lineTo(cx + Math.cos(a) * (r - 4), cy + Math.sin(a) * (r - 4));
      ctx.stroke();
    }
    // Hub
    ctx.fillStyle = '#666';
    ctx.beginPath(); ctx.arc(cx, cy, 3.5, 0, Math.PI * 2); ctx.fill();
  }

  function drawJetParticles() {
    for (let i = 0; i < jetParticles.length; i++) {
      const p = jetParticles[i];
      if (p.life <= 0) continue;
      ctx.globalAlpha = p.alpha;
      ctx.fillStyle = p.color;
      ctx.beginPath();
      ctx.moveTo(p.x, p.y);
      ctx.lineTo(p.x - p.size * 0.28, p.y + p.size);
      ctx.lineTo(p.x + p.size * 0.28, p.y + p.size);
      ctx.closePath();
      ctx.fill();
      ctx.globalAlpha = p.alpha * 0.5;
      ctx.fillStyle = '#fff4c2';
      ctx.beginPath();
      ctx.arc(p.x, p.y + p.size * 0.4, p.size * 0.22, 0, Math.PI * 2);
      ctx.fill();
    }
    ctx.globalAlpha = 1;
  }

  function drawRider(swPivX, swPivY, steerX, steerY) {
    // Hip sits on seat, slightly back of center
    const hipX = swPivX - 10;
    const hipY = swPivY - 8;

    // Lean forward, adjusts with tilt input
    const shoulderX = hipX + 14 + visualTilt * 6;
    const shoulderY = hipY - 14;
    const helmetX = shoulderX + 3;
    const helmetY = shoulderY - 10;

    ctx.save();

    // --- Legs ---
    ctx.lineCap = 'round';
    // Thigh
    ctx.strokeStyle = '#1e2560';
    ctx.lineWidth = 6;
    ctx.beginPath();
    ctx.moveTo(hipX, hipY);
    ctx.lineTo(hipX - 6, hipY + 9);
    ctx.stroke();
    // Shin
    ctx.strokeStyle = '#2a3070';
    ctx.lineWidth = 5;
    ctx.beginPath();
    ctx.moveTo(hipX - 6, hipY + 9);
    ctx.lineTo(hipX - 10, hipY + 5);
    ctx.stroke();
    // Boot
    ctx.fillStyle = '#0d0d0d';
    ctx.strokeStyle = '#333';
    ctx.lineWidth = 1.5;
    ctx.beginPath();
    ctx.ellipse(hipX - 13, hipY + 5, 5, 3, -0.2, 0, Math.PI * 2);
    ctx.fill();
    ctx.stroke();
    // Boot buckle highlight
    ctx.fillStyle = '#555';
    ctx.beginPath();
    ctx.rect(hipX - 15, hipY + 3, 4, 2);
    ctx.fill();

    // --- Torso ---
    ctx.fillStyle = '#1840b0';
    ctx.strokeStyle = '#0e2870';
    ctx.lineWidth = 1.5;
    ctx.beginPath();
    ctx.moveTo(hipX, hipY);
    ctx.lineTo(shoulderX, shoulderY);
    ctx.lineTo(shoulderX + 5, shoulderY + 5);
    ctx.lineTo(hipX + 4, hipY + 2);
    ctx.closePath();
    ctx.fill();
    ctx.stroke();
    // Jersey white stripe
    ctx.strokeStyle = 'rgba(255,255,255,0.28)';
    ctx.lineWidth = 2;
    ctx.beginPath();
    ctx.moveTo(hipX + 2, hipY - 1);
    ctx.lineTo(shoulderX + 1, shoulderY + 1);
    ctx.stroke();

    // --- Arm to handlebar ---
    ctx.strokeStyle = '#1840b0';
    ctx.lineWidth = 4;
    ctx.lineCap = 'round';
    ctx.beginPath();
    ctx.moveTo(shoulderX + 3, shoulderY + 3);
    ctx.lineTo(steerX + 15, steerY - 5);
    ctx.stroke();
    // Glove
    ctx.fillStyle = '#111';
    ctx.beginPath();
    ctx.arc(steerX + 16, steerY - 5, 3, 0, Math.PI * 2);
    ctx.fill();

    // --- Helmet ---
    ctx.fillStyle = '#cc1500';
    ctx.strokeStyle = '#8b0f00';
    ctx.lineWidth = 2;
    ctx.beginPath();
    ctx.arc(helmetX, helmetY, 9, 0, Math.PI * 2);
    ctx.fill();
    ctx.stroke();
    // Visor
    ctx.fillStyle = 'rgba(40,60,180,0.75)';
    ctx.beginPath();
    ctx.moveTo(helmetX - 7, helmetY - 1);
    ctx.quadraticCurveTo(helmetX + 3, helmetY + 6, helmetX + 9, helmetY);
    ctx.lineTo(helmetX + 7, helmetY - 5);
    ctx.quadraticCurveTo(helmetX + 1, helmetY - 8, helmetX - 5, helmetY - 5);
    ctx.closePath();
    ctx.fill();
    // Helmet highlight
    ctx.fillStyle = 'rgba(255,255,255,0.22)';
    ctx.beginPath();
    ctx.ellipse(helmetX - 2, helmetY - 5, 4, 2.5, -0.4, 0, Math.PI * 2);
    ctx.fill();
    // Helmet peak/visor brim
    ctx.fillStyle = '#8b0f00';
    ctx.beginPath();
    ctx.moveTo(helmetX - 6, helmetY + 2);
    ctx.lineTo(helmetX + 10, helmetY + 2);
    ctx.lineTo(helmetX + 11, helmetY + 5);
    ctx.lineTo(helmetX - 5, helmetY + 5);
    ctx.closePath();
    ctx.fill();

    ctx.restore();
  }

  function drawBike() {
    const sx = bike.x - cameraX;
    const sy = bike.y + suspensionPos;
    const half = BIKE_LENGTH / 2;  // 25
    const rX = -half;   // rear wheel X (-25)
    const fX = half;    // front wheel X (25)
    const rWR = WHEEL_R;      // rear: 13
    const fWR = WHEEL_R - 1;  // front: 12

    // Frame key points
    const swPivX = -3,  swPivY = -24;  // swingarm/frame pivot
    const steerX = 19,  steerY = -29;  // steering head
    const seatRX = -23, seatRY = -30;  // rear seat edge
    const seatFX = 3,   seatFY = -30;  // front seat edge (meets tank)

    ctx.save();
    ctx.translate(sx, sy);
    ctx.rotate(-bike.angle);

    // Jet particles (behind everything)
    drawJetParticles();

    // --- Exhaust system ---
    // Header pipe from engine, sweeps back and up
    ctx.strokeStyle = '#888';
    ctx.lineWidth = 4;
    ctx.lineCap = 'round';
    ctx.beginPath();
    ctx.moveTo(2, -12);
    ctx.quadraticCurveTo(-4, -4, rX + 18, -4);
    ctx.stroke();
    // Canister
    ctx.strokeStyle = '#666';
    ctx.lineWidth = 6;
    ctx.beginPath();
    ctx.moveTo(rX + 18, -4);
    ctx.lineTo(rX + 10, -16);
    ctx.stroke();
    // Tip cap
    ctx.fillStyle = '#555';
    ctx.beginPath();
    ctx.arc(rX + 9, -17, 4, 0, Math.PI * 2);
    ctx.fill();

    // --- Rear wheel ---
    drawWheel(rX, 0, rWR, '#c0c0c0');

    // --- Swingarm ---
    ctx.strokeStyle = '#202020';
    ctx.lineWidth = 6;
    ctx.lineCap = 'round';
    ctx.beginPath();
    ctx.moveTo(rX + 2, 0);
    ctx.lineTo(swPivX, swPivY);
    ctx.stroke();
    // Swingarm lower rail (parallel, creates triangular look)
    ctx.strokeStyle = '#2c2c2c';
    ctx.lineWidth = 3;
    ctx.beginPath();
    ctx.moveTo(rX + 2, -4);
    ctx.lineTo(swPivX - 2, swPivY + 4);
    ctx.stroke();

    // --- Rear suspension shock ---
    ctx.strokeStyle = '#888';
    ctx.lineWidth = 4;
    ctx.beginPath();
    ctx.moveTo(swPivX + 4, swPivY + 2);
    ctx.lineTo(rX + 16, -8);
    ctx.stroke();
    ctx.strokeStyle = '#ff6600';
    ctx.lineWidth = 3;
    ctx.beginPath();
    ctx.moveTo(swPivX + 2, swPivY + 1);
    ctx.lineTo(rX + 18, -6);
    ctx.stroke();

    // --- Main frame (filled polygon) ---
    ctx.fillStyle = '#181818';
    ctx.strokeStyle = '#2e2e2e';
    ctx.lineWidth = 2;
    ctx.beginPath();
    ctx.moveTo(swPivX, swPivY);
    ctx.lineTo(steerX, steerY);
    ctx.lineTo(steerX - 1, -14);
    ctx.lineTo(4, -8);
    ctx.lineTo(rX + 14, -8);
    ctx.lineTo(swPivX, swPivY);
    ctx.closePath();
    ctx.fill();
    ctx.stroke();

    // Seat stays (from swingarm pivot up to seat rear)
    ctx.strokeStyle = '#252525';
    ctx.lineWidth = 4;
    ctx.lineCap = 'round';
    ctx.beginPath();
    ctx.moveTo(swPivX, swPivY);
    ctx.lineTo(seatRX, seatRY);
    ctx.stroke();
    ctx.strokeStyle = '#1e1e1e';
    ctx.lineWidth = 3;
    ctx.beginPath();
    ctx.moveTo(swPivX - 3, swPivY + 3);
    ctx.lineTo(seatRX - 2, seatRY + 5);
    ctx.stroke();

    // --- Engine block ---
    ctx.fillStyle = '#191919';
    ctx.strokeStyle = '#303030';
    ctx.lineWidth = 2;
    if (ctx.roundRect) {
      ctx.beginPath(); ctx.roundRect(-9, -22, 22, 15, 2); ctx.fill(); ctx.stroke();
    } else {
      ctx.fillRect(-9, -22, 22, 15);
      ctx.strokeRect(-9, -22, 22, 15);
    }
    // Engine cooling fins
    ctx.strokeStyle = '#2a2a2a';
    ctx.lineWidth = 1;
    for (let i = 0; i < 4; i++) {
      ctx.beginPath();
      ctx.moveTo(-8, -20 + i * 3);
      ctx.lineTo(11, -20 + i * 3);
      ctx.stroke();
    }
    // Radiator (small colored grid, front of engine)
    ctx.fillStyle = '#0a3060';
    ctx.beginPath();
    ctx.rect(8, -21, 4, 13);
    ctx.fill();

    // --- Gas tank ---
    ctx.fillStyle = '#c81800';
    ctx.strokeStyle = '#8a1000';
    ctx.lineWidth = 2;
    ctx.beginPath();
    ctx.moveTo(seatFX, seatFY);
    ctx.quadraticCurveTo(12, seatFY - 12, steerX, steerY);
    ctx.lineTo(steerX - 2, steerY + 7);
    ctx.quadraticCurveTo(10, seatFY - 2, seatFX, seatFY + 5);
    ctx.closePath();
    ctx.fill();
    ctx.stroke();
    // Tank highlight
    ctx.strokeStyle = 'rgba(255,255,255,0.20)';
    ctx.lineWidth = 2;
    ctx.beginPath();
    ctx.moveTo(seatFX + 2, seatFY - 1);
    ctx.quadraticCurveTo(11, seatFY - 10, steerX - 2, steerY + 2);
    ctx.stroke();
    // Tank logo panel (white rectangle on side)
    ctx.fillStyle = 'rgba(255,255,255,0.12)';
    ctx.beginPath();
    ctx.rect(4, seatFY - 4, 10, 6);
    ctx.fill();

    // --- Seat ---
    ctx.fillStyle = '#0f0f0f';
    ctx.strokeStyle = '#282828';
    ctx.lineWidth = 2;
    ctx.beginPath();
    ctx.moveTo(seatRX, seatRY);
    ctx.lineTo(seatFX, seatFY);
    ctx.lineTo(seatFX, seatFY + 5);
    ctx.lineTo(seatRX, seatRY + 5);
    ctx.closePath();
    ctx.fill();
    ctx.stroke();
    // Seat stitching line
    ctx.strokeStyle = 'rgba(100,100,100,0.4)';
    ctx.lineWidth = 1;
    ctx.setLineDash([3, 3]);
    ctx.beginPath();
    ctx.moveTo(seatRX + 2, seatRY + 2);
    ctx.lineTo(seatFX - 1, seatFY + 2);
    ctx.stroke();
    ctx.setLineDash([]);

    // --- Front forks ---
    ctx.strokeStyle = '#4a4a4a';
    ctx.lineWidth = 5;
    ctx.lineCap = 'round';
    // Left leg
    ctx.beginPath();
    ctx.moveTo(steerX - 3, steerY + 2);
    ctx.lineTo(fX - 5, -4);
    ctx.stroke();
    // Right leg
    ctx.beginPath();
    ctx.moveTo(steerX + 3, steerY + 2);
    ctx.lineTo(fX + 1, -4);
    ctx.stroke();
    // Fork brace crossbar
    ctx.strokeStyle = '#3a3a3a';
    ctx.lineWidth = 3;
    const bt = 0.42;
    const bx1 = steerX - 3 + (fX - 5 - (steerX - 3)) * bt;
    const by1 = steerY + 2 + (-4 - steerY - 2) * bt;
    const bx2 = steerX + 3 + (fX + 1 - (steerX + 3)) * bt;
    ctx.beginPath();
    ctx.moveTo(bx1, by1);
    ctx.lineTo(bx2, by1);
    ctx.stroke();
    // Fork lower gaiters (rubber boots - slightly wider near wheel)
    ctx.strokeStyle = '#333';
    ctx.lineWidth = 7;
    ctx.beginPath();
    ctx.moveTo(fX - 5, -4);
    ctx.lineTo(fX - 5, 2);
    ctx.stroke();
    ctx.beginPath();
    ctx.moveTo(fX + 1, -4);
    ctx.lineTo(fX + 1, 2);
    ctx.stroke();

    // --- Front fender ---
    ctx.strokeStyle = '#c81800';
    ctx.lineWidth = 4;
    ctx.lineCap = 'round';
    ctx.beginPath();
    ctx.moveTo(fX - 3, -fWR + 1);
    ctx.quadraticCurveTo(fX + fWR * 0.6, -fWR - 5, fX, -fWR - 11);
    ctx.stroke();

    // --- Steering head ---
    ctx.fillStyle = '#222';
    ctx.strokeStyle = '#383838';
    ctx.lineWidth = 2;
    ctx.beginPath();
    ctx.arc(steerX, steerY, 5, 0, Math.PI * 2);
    ctx.fill();
    ctx.stroke();

    // --- Headlight ---
    ctx.fillStyle = '#ffe090';
    ctx.strokeStyle = '#c8a000';
    ctx.lineWidth = 1.5;
    ctx.beginPath();
    ctx.ellipse(fX - 1, -11, 6, 5, -0.2, 0, Math.PI * 2);
    ctx.fill();
    ctx.stroke();
    ctx.fillStyle = '#fff5cc';
    ctx.beginPath();
    ctx.ellipse(fX, -11, 3.5, 3, -0.2, 0, Math.PI * 2);
    ctx.fill();

    // --- Handlebars ---
    ctx.strokeStyle = '#1a1a1a';
    ctx.lineWidth = 5;
    ctx.lineCap = 'round';
    ctx.beginPath();
    ctx.moveTo(steerX - 2, steerY - 1);
    ctx.quadraticCurveTo(steerX + 7, steerY - 16, steerX + 20, steerY - 7);
    ctx.stroke();
    // Bar ends / grips
    ctx.strokeStyle = '#0f0f0f';
    ctx.lineWidth = 4;
    ctx.beginPath();
    ctx.moveTo(steerX + 20, steerY - 7);
    ctx.lineTo(steerX + 22, steerY - 4);
    ctx.stroke();
    ctx.beginPath();
    ctx.moveTo(steerX - 2, steerY - 1);
    ctx.lineTo(steerX - 4, steerY + 2);
    ctx.stroke();

    // Number board on front fork area
    ctx.fillStyle = '#fff';
    ctx.strokeStyle = '#ccc';
    ctx.lineWidth = 1;
    ctx.beginPath();
    ctx.rect(fX - 16, -24, 11, 8);
    ctx.fill();
    ctx.stroke();
    ctx.fillStyle = '#cc0000';
    ctx.font = 'bold 6px sans-serif';
    ctx.textAlign = 'center';
    ctx.fillText('42', fX - 10, -17);
    ctx.textAlign = 'left';

    // --- Front wheel ---
    drawWheel(fX, 0, fWR, '#aaaaaa');

    // --- Rider (drawn last so they're on top of bike) ---
    drawRider(swPivX, swPivY, steerX, steerY);

    // --- Jet flame core (topmost layer) ---
    if ((keys['j'] || keys['J'] || touchKeys.jet) && fuelLevel > 0) {
      const cX = rX - 2, cY = -18;
      ctx.globalAlpha = 0.9;
      ctx.fillStyle = '#ff6a00';
      ctx.beginPath();
      ctx.moveTo(cX, cY);
      ctx.lineTo(cX - 9, cY + 18);
      ctx.lineTo(cX + 9, cY + 18);
      ctx.closePath();
      ctx.fill();
      ctx.fillStyle = '#ffd36b';
      ctx.beginPath();
      ctx.arc(cX, cY + 9, 5.5, 0, Math.PI * 2);
      ctx.fill();
      ctx.globalAlpha = 1;
    }

    ctx.restore();
  }

  // --- Dust Particles ---
  function spawnDust(x, y, count) {
    for (let i = 0; i < count; i++) {
      dustParticles.push({
        x: x + (Math.random() - 0.5) * 12,
        y: y,
        vx: (Math.random() - 0.65) * 2.5,
        vy: -(Math.random() * 2 + 0.3),
        life: 22 + Math.floor(Math.random() * 16),
        maxLife: 38,
        size: 2.5 + Math.random() * 4.5
      });
    }
  }

  function updateAndDrawDust() {
    ctx.save();
    for (let i = dustParticles.length - 1; i >= 0; i--) {
      const p = dustParticles[i];
      p.life--;
      if (p.life <= 0) { dustParticles.splice(i, 1); continue; }
      p.x += p.vx;
      p.y += p.vy;
      p.vy += 0.06;
      p.vx *= 0.95;
      const t = p.life / p.maxLife;
      ctx.globalAlpha = t * 0.45;
      ctx.fillStyle = '#c8a06a';
      ctx.beginPath();
      ctx.arc(p.x - cameraX, p.y, p.size * t, 0, Math.PI * 2);
      ctx.fill();
    }
    ctx.restore();
  }

  // --- Bike Physics ---
  function initBike() {
    const g = getGroundAt(0);
    bike = {
      x: 80,
      y: g.y - BIKE_HEIGHT / 2 - WHEEL_R,
      vx: 0, vy: 0,
      angle: g.slope * 0.6,
      angleSpeed: 0
    };
    airborneFrames = 0;
    airborneRotation = 0;
    visualTilt = 0;
  }

  function getWheelPositions() {
    const cos = Math.cos(bike.angle);
    const sin = Math.sin(bike.angle);
    const half = BIKE_LENGTH / 2;
    return {
      back:  { x: bike.x - cos * half, y: bike.y + sin * half },
      front: { x: bike.x + cos * half, y: bike.y - sin * half }
    };
  }

  function updateBike(throttle, tilt, jetActive) {
    if (!bike) return false;
    extendTerrain();

    // Update visual lean
    visualTilt += (tilt * 0.18 - visualTilt) * 0.12;

    bike.vx *= FRICTION_AIR;
    bike.vy *= FRICTION_AIR;
    if (throttle) bike.vx += THROTTLE;

    const jetOn = jetActive && fuelLevel > 0;
    if (jetOn) {
      bike.vx += JET_THRUST;
      fuelLevel = Math.max(0, fuelLevel - FUEL_DRAIN);
    }
    if (bike.vx > JET_MAX_VX) bike.vx = JET_MAX_VX;

    bike.vy += GRAVITY;
    bike.x += bike.vx;
    bike.y += bike.vy;
    bike.angleSpeed *= 0.98;
    bike.angleSpeed += tilt * ANGULAR_ACCEL;
    bike.angleSpeed = Math.max(-MAX_ANGLE_SPEED, Math.min(MAX_ANGLE_SPEED, bike.angleSpeed));
    bike.angle += bike.angleSpeed;

    // Jet particles
    if (!jetParticles) jetParticles = [];
    if (jetOn) {
      for (let i = 0; i < 4; i++) {
        if (jetParticles.length >= JET_PARTICLES_MAX) break;
        const life = JET_PARTICLE_LIFE_MIN + Math.floor(Math.random() * (JET_PARTICLE_LIFE_MAX - JET_PARTICLE_LIFE_MIN + 1));
        const colorRoll = Math.random();
        jetParticles.push({
          x: -BIKE_LENGTH / 2 - 8 + (Math.random() - 0.5) * 3,
          y: -8 + (Math.random() - 0.5) * 3,
          vx: -(1.8 + Math.random() * 3.2),
          vy: (Math.random() - 0.5) * 1.2 - 0.2,
          size: 3 + Math.random() * 4,
          life: life,
          maxLife: life,
          alpha: 1,
          color: colorRoll > 0.7 ? '#ff4d00' : colorRoll > 0.35 ? '#ff9b2f' : '#ffd36b'
        });
      }
    }
    for (let i = jetParticles.length - 1; i >= 0; i--) {
      const p = jetParticles[i];
      p.life--;
      p.x += p.vx;
      p.y += p.vy;
      p.vy += JET_PARTICLE_GRAVITY;
      p.alpha = Math.max(0, p.life / p.maxLife);
      if (p.life <= 0) jetParticles.splice(i, 1);
    }

    const { back, front } = getWheelPositions();
    const gBack = getGroundAt(back.x);
    const gFront = getGroundAt(front.x);

    const speed = Math.abs(bike.vx);
    const marginAbove = Math.max(1.5, 4 - Math.min(2, speed * 0.15));
    const marginBelow = Math.max(10, 14 - Math.min(4, speed * 0.3));

    const onGroundBack  = back.y  >= gBack.y  - marginAbove && back.y  <= gBack.y  + marginBelow;
    const onGroundFront = front.y >= gFront.y - marginAbove && front.y <= gFront.y + marginBelow;
    const onGroundNow = onGroundBack || onGroundFront;
    const wasOnGroundPrev = wasOnGround;

    if (!wasOnGroundPrev && onGroundNow) {
      const impact = Math.max(0, Math.min(1, bike.vy / 10));
      suspensionPos = Math.max(suspensionPos, impact * 2);
      suspensionVel = Math.max(suspensionVel, impact * 4 + 0.5);

      // Dust on landing
      const landX = (back.x + front.x) / 2;
      spawnDust(landX, getGroundAt(landX).y, Math.floor(impact * 10 + 3));
      audio.land(impact);

      // Trick detection on landing
      if (airborneFrames > 18 && Math.abs(airborneRotation) >= FLIP_THRESHOLD) {
        const fullFlips = Math.floor(Math.abs(airborneRotation) / (Math.PI * 2) + 0.35);
        const isBack = airborneRotation > 0;
        const name = (fullFlips >= 2 ? fullFlips + 'x ' : '') + (isBack ? 'Backflip' : 'Frontflip') + '!';
        const bonus = fullFlips * 120;
        trickText = name + ' +' + bonus + 'm';
        trickTimer = 130;
        totalTrickBonus += bonus;
        audio.trick();
      }
      airborneFrames = 0;
      airborneRotation = 0;
    }

    if (!onGroundNow) {
      airborneFrames++;
      airborneRotation += bike.angleSpeed;
      fuelLevel = Math.min(MAX_FUEL, fuelLevel + FUEL_REGEN_AIR);
    } else {
      fuelLevel = Math.min(MAX_FUEL, fuelLevel + FUEL_REGEN_GROUND);
      // Rolling dust at speed
      if (speed > 5 && Math.random() < 0.25) {
        spawnDust(back.x, gBack.y, 1);
      }
    }

    if (wasOnGroundPrev && !onGroundNow) {
      if (speed > 3) {
        const lift = Math.min(10, (speed - 3) * 0.35) * (jetOn ? 1.25 : 1.0);
        bike.vy -= lift;
      }
    }
    wasOnGround = onGroundNow;

    const k = onGroundNow ? 0.22 : 0.08;
    const d = onGroundNow ? 0.82 : 0.35;
    const acc = -k * suspensionPos - d * suspensionVel;
    suspensionVel += acc;
    suspensionPos += suspensionVel;
    suspensionPos = Math.max(-2, Math.min(12, suspensionPos));

    if (onGroundBack && onGroundFront) {
      const slope = (gFront.y - gBack.y) / (front.x - back.x);
      bike.angle = bike.angle * 0.6 + Math.atan(slope) * 0.4;
      bike.angleSpeed *= 0.7;
      const groundY = (gBack.y + gFront.y) / 2 - BIKE_HEIGHT / 2;
      bike.y = bike.y * 0.3 + groundY * 0.7;
      bike.vy = 0;
      bike.vx *= FRICTION_GROUND;
    } else if (onGroundBack || onGroundFront) {
      const g = onGroundBack ? gBack : gFront;
      if (Math.abs(bike.angle) > 1.2) return true;
      bike.angle = bike.angle * 0.85 + Math.atan(g.slope) * 0.15;
      bike.y = g.y - BIKE_HEIGHT / 2;
      bike.vy *= 0.5;
      bike.vx *= FRICTION_GROUND;
    }

    if (bike.y > H + 50) return true;
    if (Math.abs(bike.angle) > Math.PI * 0.85) return true;
    const backG = getGroundAt(back.x);
    const frontG = getGroundAt(front.x);
    if (back.y > backG.y + 18 || front.y > frontG.y + 18) return true;
    return false;
  }

  // --- Trick text (drawn on canvas) ---
  function drawTrickText() {
    if (trickTimer <= 0) return;
    trickTimer--;
    const alpha = Math.min(1, trickTimer / 25);
    const scale = trickTimer > 105 ? 1 + (130 - trickTimer) * 0.025 : 1;
    ctx.save();
    ctx.globalAlpha = alpha;
    ctx.translate(W / 2, H / 2 - 70);
    ctx.scale(scale, scale);
    ctx.font = 'bold 28px sans-serif';
    ctx.textAlign = 'center';
    ctx.strokeStyle = 'rgba(0,0,0,0.8)';
    ctx.lineWidth = 5;
    ctx.strokeText(trickText, 0, 0);
    ctx.fillStyle = '#FFD700';
    ctx.fillText(trickText, 0, 0);
    ctx.restore();
  }

  // --- HUD ---
  function updateHUD() {
    score = bike.x + totalTrickBonus;
    scoreEl.textContent = Math.floor(score);
    if (highScoreEl) highScoreEl.textContent = Math.max(Math.floor(score), highScore);
    if (fuelBarEl) {
      const pct = fuelLevel / MAX_FUEL;
      fuelBarEl.style.width = (pct * 100) + '%';
      fuelBarEl.style.background = pct > 0.5 ? '#4caf50' : pct > 0.22 ? '#ff9800' : '#f44336';
    }
  }

  // --- Game Over ---
  function gameOver() {
    running = false;
    audio.stopEngine();
    audio.crash();
    const finalScore = Math.floor(score);
    if (finalScore > highScore) {
      highScore = finalScore;
      localStorage.setItem('motoHighScore', highScore);
    }
    overlay.classList.remove('hidden');
    overlayText.innerHTML =
      'Wiped out!<br>' +
      '<strong style="font-size:1.4rem">' + finalScore + ' m</strong><br>' +
      '<small style="color:#aaa">Best: ' + highScore + ' m</small>';
    restartBtn.style.display = 'block';
  }

  // --- Input ---
  const keys = {};
  const touchKeys = { gas: false, leanBack: false, leanFwd: false, jet: false };

  document.addEventListener('keydown', function (e) {
    if ([' ', 'ArrowUp', 'ArrowDown', 'ArrowLeft', 'ArrowRight'].indexOf(e.key) !== -1) e.preventDefault();
    keys[e.key] = true;
    if (!running && (e.key === ' ' || e.key === 'ArrowUp')) startGame();
  });
  document.addEventListener('keyup', function (e) { keys[e.key] = false; });

  function setupTouchControls() {
    document.querySelectorAll('.moto-touch-btn').forEach(function (btn) {
      const action = btn.dataset.action;
      function on(e) { e.preventDefault(); touchKeys[action] = true; }
      function off(e) { e.preventDefault(); touchKeys[action] = false; }
      btn.addEventListener('touchstart', on, { passive: false });
      btn.addEventListener('touchend', off, { passive: false });
      btn.addEventListener('touchcancel', off, { passive: false });
      btn.addEventListener('mousedown', function () { touchKeys[action] = true; });
      btn.addEventListener('mouseup', function () { touchKeys[action] = false; });
      btn.addEventListener('mouseleave', function () { touchKeys[action] = false; });
    });
  }

  // --- Game Loop ---
  function loop() {
    if (!running || !bike) return;
    const throttle = keys[' '] || keys['ArrowUp'] || touchKeys.gas;
    const jetActive = keys['j'] || keys['J'] || touchKeys.jet;
    const tilt = ((keys['ArrowLeft'] || touchKeys.leanBack) ? 1 : 0) -
                 ((keys['ArrowRight'] || touchKeys.leanFwd) ? 1 : 0);

    audio.updateEngine(bike.vx, jetActive && fuelLevel > 0);
    const crashed = updateBike(throttle, tilt, jetActive);
    updateHUD();
    cameraX = bike.x - CAMERA_LEAD;
    if (cameraX < 0) cameraX = 0;

    drawSky();
    drawSun();
    drawClouds();
    drawTrees();
    drawTerrain();
    updateAndDrawDust();
    drawBike();
    drawTrickText();

    if (crashed) { gameOver(); return; }
    requestAnimationFrame(loop);
  }

  // --- Start / Init ---
  function startGame() {
    seed = Date.now() % 100000;
    baseSeed = seed;
    trees = []; nextTreeX = -200;
    groundPattern = null;
    jetParticles = []; dustParticles = [];
    suspensionPos = 0; suspensionVel = 0;
    wasOnGround = false;
    fuelLevel = MAX_FUEL;
    totalTrickBonus = 0; trickText = ''; trickTimer = 0;
    airborneFrames = 0; airborneRotation = 0;
    visualTilt = 0;
    initClouds();
    initTerrain();
    initBike();
    score = 0;
    scoreEl.textContent = '0';
    if (highScoreEl) highScoreEl.textContent = highScore;
    running = true;
    overlay.classList.add('hidden');
    restartBtn.style.display = 'none';
    audio.startEngine();
    loop();
  }

  function init() {
    seed = Date.now() % 100000;
    baseSeed = seed;
    trees = []; nextTreeX = -200;
    groundPattern = null;
    jetParticles = []; dustParticles = [];
    fuelLevel = MAX_FUEL;
    initClouds();
    initTerrain();
    initBike();
    cameraX = 0;
    drawSky(); drawSun(); drawClouds(); drawTrees(); drawTerrain(); drawBike();
    if (highScoreEl) highScoreEl.textContent = highScore;
    setupTouchControls();
  }

  overlay.addEventListener('click', function () { if (!running) startGame(); });
  restartBtn.addEventListener('click', function (e) { e.stopPropagation(); startGame(); });

  init();
  overlay.classList.remove('hidden');
}());
