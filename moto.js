(function () {
  const canvas = document.getElementById('motoCanvas');
  const ctx = canvas.getContext('2d');
  const overlay = document.getElementById('motoOverlay');
  const overlayText = document.getElementById('motoOverlayText');
  const restartBtn = document.getElementById('motoRestartBtn');
  const scoreEl = document.getElementById('motoScore');

  const W = canvas.width = 900;
  const H = canvas.height = 400;
  const GRAVITY = 0.22;
  const THROTTLE = 0.32;
  const FRICTION_GROUND = 0.92;
  const FRICTION_AIR = 0.998;
  const ANGULAR_ACCEL = 0.018;
  const MAX_ANGLE_SPEED = 0.35;
  const BIKE_LENGTH = 36;
  const BIKE_HEIGHT = 18;
  const WHEEL_R = 10;
  const GROUND_BASE = H - 160;
  const CAMERA_LEAD = 120;
  const SEGMENT_LENGTH = 80;
  const MAX_SLOPE = 0.45;

  // Terrain shaping
  const JUMP_CHANCE = 0.08;
  const JUMP_SEGMENTS = 5;
  const JUMP_BOOST_MIN = 90;
  const JUMP_BOOST_MAX = 160;
  const GROUND_MIN = GROUND_BASE - 100;
  const GROUND_MAX = GROUND_BASE + 60;

  // Jet (rocket boost) power
  const JET_THRUST = 0.85; // extra vx while holding J
  const JET_MAX_VX = 18; // soft cap for stability

  // Jet particles (purely visual)
  const JET_PARTICLES_MAX = 180;
  const JET_PARTICLE_GRAVITY = 0.16;
  const JET_PARTICLE_LIFE_MIN = 18;
  const JET_PARTICLE_LIFE_MAX = 30;

  let running = false;
  let score = 0;
  let terrain = [];
  let bike = null;
  let cameraX = 0;
  let seed = 0;
  let baseSeed = 0;
  let trees = [];
  let nextTreeX = 0;
  let groundPattern = null;
  let jumpState = { remaining: 0, total: 0, boost: 0 };
  // Suspension "compression" visual after landing (big jump feel).
  // Positive pushes the sprite down; physics collision stays unchanged.
  let suspensionPos = 0;
  let suspensionVel = 0;
  let wasOnGround = false;
  let jetParticles = [];

  function rnd() {
    seed = (seed * 9301 + 49297) % 233280;
    return seed / 233280;
  }

  function initTerrain() {
    terrain = [];
    jumpState.remaining = 0;
    jumpState.total = 0;
    jumpState.boost = 0;
    let x = -200;
    let y = GROUND_BASE;
    while (x < 5000) {
      const prevY = y;
      const bump = (rnd() - 0.5) * 55;
      const ramp = (rnd() - 0.45) * 50;
      let nextY = y + bump + ramp;

      // Occasionally lift the ground into a jump arc.
      if (jumpState.remaining <= 0 && x > 150 && rnd() < JUMP_CHANCE) {
        jumpState.total = JUMP_SEGMENTS;
        jumpState.remaining = JUMP_SEGMENTS;
        jumpState.boost = JUMP_BOOST_MIN + rnd() * (JUMP_BOOST_MAX - JUMP_BOOST_MIN);
      }
      if (jumpState.remaining > 0) {
        const jumpIndex = jumpState.total - jumpState.remaining;
        const progress = jumpIndex / (jumpState.total - 1);
        const factor = Math.sin(Math.PI * progress);
        nextY += factor * jumpState.boost;
        jumpState.remaining -= 1;
      }

      nextY = Math.max(GROUND_MIN, Math.min(GROUND_MAX, nextY));
      let slope = (nextY - prevY) / SEGMENT_LENGTH;
      slope = Math.max(-MAX_SLOPE, Math.min(MAX_SLOPE, slope));
      nextY = prevY + slope * SEGMENT_LENGTH;
      terrain.push({ x0: x, y0: prevY, x1: x + SEGMENT_LENGTH, y1: nextY, slope });
      y = nextY;
      x += SEGMENT_LENGTH;
    }
  }

  function getGroundAt(x) {
    for (let i = 0; i < terrain.length; i++) {
      const t = terrain[i];
      if (x >= t.x0 && x < t.x1) {
        const t0 = (x - t.x0) / (t.x1 - t.x0);
        return {
          y: t.y0 + t0 * (t.y1 - t.y0),
          slope: t.slope
        };
      }
    }
    return { y: GROUND_BASE, slope: 0 };
  }

  function randAt(n) {
    // Deterministic pseudo-random for visuals (does not affect physics).
    const s = baseSeed || seed || 1;
    const v = Math.sin((n + 1) * 12.9898 + s * 0.12345) * 43758.5453;
    return v - Math.floor(v);
  }

  function getTerrainMaxX() {
    if (!terrain.length) return 0;
    return terrain[terrain.length - 1].x1;
  }

  function getGroundPattern() {
    if (groundPattern) return groundPattern;
    const c = document.createElement('canvas');
    c.width = 64;
    c.height = 64;
    const p = c.getContext('2d');

    // Base + stripe variation.
    p.fillStyle = '#2d5016';
    p.fillRect(0, 0, 64, 64);
    for (let i = 0; i < 64; i += 6) {
      p.fillStyle = i % 12 === 0 ? '#254b16' : '#1f3f12';
      p.fillRect(i, 0, 3, 64);
      p.fillStyle = i % 12 === 0 ? '#1a3009' : '#2a5a1d';
      p.fillRect(i + 3, 0, 2, 64);
    }

    // Speckles (rocks/dirt).
    for (let i = 0; i < 220; i++) {
      const x = Math.floor(randAt(i * 3 + 99) * 64);
      const y = Math.floor(randAt(i * 7 + 13) * 64);
      const r = 1 + Math.floor(randAt(i * 11 + 1) * 2);
      p.fillStyle = randAt(i * 17 + 3) > 0.5 ? '#1a3009' : '#244b16';
      p.fillRect(x, y, r, r);
    }

    groundPattern = ctx.createPattern(c, 'repeat');
    return groundPattern;
  }

  function ensureTreesUpTo(worldX) {
    const maxX = getTerrainMaxX();
    const targetX = Math.min(worldX, maxX);
    while (nextTreeX < targetX) {
      const idx = trees.length;
      const spacing = 70 + randAt(200000 + idx * 17) * 95;
      nextTreeX += spacing;

      const h = 50 + randAt(300000 + idx * 19) * 90;
      const variant = randAt(400000 + idx * 23);
      trees.push({ x: nextTreeX, h, variant });
    }
  }

  function drawBackground() {
    const par = 0.28; // parallax strength
    const s = 0.85; // overall distant scale

    ensureTreesUpTo(cameraX + W + 600);
    for (let i = 0; i < trees.length; i++) {
      const t = trees[i];
      const dx = t.x - cameraX;
      if (dx < -120 || dx > W + 120) continue;

      const screenX = dx * par;
      const baseY = getGroundAt(t.x).y;

      const trunkH = t.h * 0.42 * s;
      const foliageH = t.h * 0.75 * s;

      ctx.save();
      ctx.translate(screenX, baseY);
      ctx.globalAlpha = 0.7;

      // Trunk
      ctx.fillStyle = '#3a2a1a';
      ctx.fillRect(-2, -trunkH, 4, trunkH);

      // Foliage layers
      const leaf1 = t.variant > 0.66 ? '#1f5a22' : t.variant > 0.33 ? '#1a4d1f' : '#16421a';
      const leaf2 = t.variant > 0.66 ? '#1a4d1f' : t.variant > 0.33 ? '#175013' : '#123b16';

      // 3-layer blob foliage (bigger so it reads as trees).
      ctx.fillStyle = leaf2;
      ctx.beginPath();
      ctx.arc(0, -trunkH - foliageH * 0.25, foliageH * 0.48, 0, Math.PI * 2);
      ctx.fill();
      ctx.fillStyle = leaf1;
      ctx.beginPath();
      ctx.arc(0, -trunkH - foliageH * 0.48, foliageH * 0.38, 0, Math.PI * 2);
      ctx.fill();
      ctx.fillStyle = leaf2;
      ctx.beginPath();
      ctx.arc(0, -trunkH - foliageH * 0.70, foliageH * 0.30, 0, Math.PI * 2);
      ctx.fill();

      ctx.restore();
    }
  }

  function extendTerrain() {
    let last = terrain[terrain.length - 1];
    while (last.x1 < cameraX + W + 400) {
      const prevY = last.y1;
      const segX = last.x1;
      const bump = (rnd() - 0.5) * 55;
      const ramp = (rnd() - 0.45) * 50;
      let y = Math.max(GROUND_MIN, Math.min(GROUND_MAX, prevY + bump + ramp));

      // Occasionally lift the ground into a jump arc.
      if (jumpState.remaining <= 0 && segX > 150 && rnd() < JUMP_CHANCE) {
        jumpState.total = JUMP_SEGMENTS;
        jumpState.remaining = JUMP_SEGMENTS;
        jumpState.boost = JUMP_BOOST_MIN + rnd() * (JUMP_BOOST_MAX - JUMP_BOOST_MIN);
      }
      if (jumpState.remaining > 0) {
        const jumpIndex = jumpState.total - jumpState.remaining;
        const progress = jumpIndex / (jumpState.total - 1);
        const factor = Math.sin(Math.PI * progress);
        y += factor * jumpState.boost;
        jumpState.remaining -= 1;
      }

      y = Math.max(GROUND_MIN, Math.min(GROUND_MAX, y));

      let slope = (y - prevY) / SEGMENT_LENGTH;
      slope = Math.max(-MAX_SLOPE, Math.min(MAX_SLOPE, slope));
      y = prevY + slope * SEGMENT_LENGTH;
      const seg = { x0: last.x1, y0: last.y1, x1: last.x1 + SEGMENT_LENGTH, y1: y, slope };
      terrain.push(seg);
      last = seg;
    }
  }

  function initBike() {
    const g = getGroundAt(0);
    bike = {
      x: 80,
      y: g.y - BIKE_HEIGHT / 2 - WHEEL_R,
      vx: 0,
      vy: 0,
      angle: g.slope * 0.6,
      angleSpeed: 0
    };
  }

  function getWheelPositions() {
    const cos = Math.cos(bike.angle);
    const sin = Math.sin(bike.angle);
    const half = BIKE_LENGTH / 2;
    const back = { x: bike.x - cos * half, y: bike.y + sin * half };
    const front = { x: bike.x + cos * half, y: bike.y - sin * half };
    return { back, front };
  }

  function drawTerrain() {
    const startX = cameraX - 50;
    const endX = cameraX + W + 50;
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

    // Base fill.
    ctx.fillStyle = '#2d5016';
    ctx.fill();

    // Pattern overlay + some texture strokes.
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
      const screenX = x - cameraX;
      const len = 6 + randAt(x * 0.01) * 12;
      const sway = (randAt(x * 0.02) - 0.5) * 3;
      ctx.beginPath();
      ctx.moveTo(screenX, g.y);
      ctx.lineTo(screenX + sway, g.y - len);
      ctx.stroke();
    }
    ctx.restore();

    ctx.strokeStyle = '#1a3009';
    ctx.lineWidth = 2;
    ctx.stroke();
  }

  function drawBike() {
    const sx = bike.x - cameraX;
    const sy = bike.y + suspensionPos;
    const half = BIKE_LENGTH / 2;

    ctx.save();
    ctx.translate(sx, sy);

    // Keep sprite aligned with physics wheel locations.
    ctx.rotate(-bike.angle);

    const rearX = -half;
    const frontX = half;
    const headX = frontX - 6;
    const headY = -18;

    function drawJet() {
      for (let i = 0; i < jetParticles.length; i++) {
        const p = jetParticles[i];
        if (p.life <= 0) continue;

        const x = p.x;
        const y = p.y;

        ctx.globalAlpha = p.alpha;
        ctx.fillStyle = p.color;
        ctx.beginPath();
        // Small flame-ish triangle
        ctx.moveTo(x, y);
        ctx.lineTo(x - p.size * 0.25, y + p.size);
        ctx.lineTo(x + p.size * 0.25, y + p.size);
        ctx.closePath();
        ctx.fill();

        ctx.globalAlpha = p.alpha * 0.55;
        ctx.fillStyle = '#fff4c2';
        ctx.beginPath();
        ctx.arc(x - p.size * 0.08, y + p.size * 0.35, p.size * 0.22, 0, Math.PI * 2);
        ctx.fill();
      }
      ctx.globalAlpha = 1;
    }

    drawJet();

    function wheel(cx) {
      // Tire
      ctx.fillStyle = '#141414';
      ctx.beginPath();
      ctx.arc(cx, 0, WHEEL_R, 0, Math.PI * 2);
      ctx.fill();

      // Rim
      ctx.strokeStyle = '#c9a227';
      ctx.lineWidth = 3;
      ctx.beginPath();
      ctx.arc(cx, 0, WHEEL_R - 2, 0, Math.PI * 2);
      ctx.stroke();

      // Spokes
      ctx.strokeStyle = '#b78b2d';
      ctx.lineWidth = 1;
      for (let i = 0; i < 10; i++) {
        const a = (i / 10) * Math.PI * 2;
        ctx.beginPath();
        ctx.moveTo(cx + Math.cos(a) * (WHEEL_R - 5), Math.sin(a) * (WHEEL_R - 5));
        ctx.lineTo(cx + Math.cos(a) * 3, Math.sin(a) * 3);
        ctx.stroke();
      }
    }

    // Wheels
    wheel(rearX);
    wheel(frontX);

    // Rear swingarm / shock
    ctx.strokeStyle = '#2a2a2a';
    ctx.lineWidth = 6;
    ctx.lineCap = 'round';
    ctx.beginPath();
    ctx.moveTo(rearX + 2, 0);
    ctx.lineTo(rearX + 16, -10);
    ctx.stroke();

    // Frame (filled triangle-ish silhouette)
    ctx.fillStyle = '#262626';
    ctx.strokeStyle = '#3d3d3d';
    ctx.lineWidth = 2;
    ctx.beginPath();
    ctx.moveTo(rearX + 8, -2);
    ctx.lineTo(-2, -14); // backbone
    ctx.lineTo(headX, headY); // steering head
    ctx.lineTo(frontX - 2, -10);
    ctx.lineTo(rearX + 8, -2);
    ctx.closePath();
    ctx.fill();
    ctx.stroke();

    // Tank (rounded polygon)
    ctx.fillStyle = '#0e8fb8';
    ctx.strokeStyle = '#043b4d';
    ctx.lineWidth = 2;
    ctx.beginPath();
    ctx.moveTo(-10, -12);
    ctx.quadraticCurveTo(-2, -18, 8, -12);
    ctx.lineTo(6, -6);
    ctx.quadraticCurveTo(-2, -8, -10, -6);
    ctx.closePath();
    ctx.fill();
    ctx.stroke();

    // Tank stripe
    ctx.strokeStyle = 'rgba(255,255,255,0.25)';
    ctx.lineWidth = 2;
    ctx.beginPath();
    ctx.moveTo(-8, -10);
    ctx.quadraticCurveTo(-1, -15, 6, -10);
    ctx.stroke();

    // Seat
    ctx.fillStyle = '#2f1f12';
    ctx.strokeStyle = '#5c4033';
    ctx.lineWidth = 2;
    ctx.beginPath();
    ctx.ellipse(-2, -13, 10, 4.5, 0, 0, Math.PI * 2);
    ctx.fill();
    ctx.stroke();

    // Engine
    ctx.fillStyle = '#1d1d1d';
    ctx.strokeStyle = '#3a3a3a';
    ctx.lineWidth = 2;
    ctx.beginPath();
    ctx.roundRect?.(-9, -7.5, 18, 9, 3);
    if (!ctx.roundRect) {
      ctx.rect(-9, -7.5, 18, 9);
    }
    ctx.fill();
    ctx.stroke();

    // Exhaust pipe
    ctx.strokeStyle = '#6a6a6a';
    ctx.lineWidth = 6;
    ctx.lineCap = 'round';
    ctx.beginPath();
    ctx.moveTo(-1, -3);
    ctx.quadraticCurveTo(6, -5, 10, -9);
    ctx.stroke();

    // Front forks (two legs)
    ctx.strokeStyle = '#3f3f3f';
    ctx.lineWidth = 6;
    ctx.lineCap = 'round';
    ctx.beginPath();
    ctx.moveTo(headX - 3, headY + 1);
    ctx.lineTo(frontX - 8, -2);
    ctx.moveTo(headX + 3, headY + 1);
    ctx.lineTo(frontX - 8 + 14, -2);
    ctx.stroke();

    // Headlight / steering column
    ctx.fillStyle = '#2a2a2a';
    ctx.strokeStyle = '#444';
    ctx.lineWidth = 2;
    ctx.beginPath();
    ctx.arc(headX, headY, 6, 0, Math.PI * 2);
    ctx.fill();
    ctx.stroke();
    ctx.fillStyle = '#8fd3ff';
    ctx.beginPath();
    ctx.arc(headX + 1, headY + 1, 2.5, 0, Math.PI * 2);
    ctx.fill();

    // Handlebar (U-shape)
    ctx.strokeStyle = '#2e2e2e';
    ctx.lineWidth = 6;
    ctx.lineCap = 'round';
    ctx.beginPath();
    ctx.moveTo(headX - 2, headY - 2);
    ctx.quadraticCurveTo(headX + 10, headY - 20, headX + 20, headY - 6);
    ctx.stroke();
    ctx.beginPath();
    // Right bar leg down to the grip
    ctx.moveTo(headX + 20, headY - 6);
    ctx.lineTo(headX + 22, headY - 3);
    ctx.stroke();

    // Hand grips (simple)
    ctx.fillStyle = '#111';
    ctx.beginPath();
    ctx.arc(headX + 16, headY - 10, 2.5, 0, Math.PI * 2);
    ctx.fill();
    ctx.beginPath();
    ctx.arc(headX + 5, headY - 4, 2.5, 0, Math.PI * 2);
    ctx.fill();

    // Rear fender (small)
    ctx.strokeStyle = '#2c2c2c';
    ctx.lineWidth = 4;
    ctx.beginPath();
    ctx.moveTo(rearX - 2, -2);
    ctx.lineTo(rearX + 10, -10);
    ctx.stroke();

    // Front fender (small)
    ctx.strokeStyle = '#2c2c2c';
    ctx.lineWidth = 4;
    ctx.beginPath();
    ctx.moveTo(frontX - 10, -4);
    ctx.lineTo(frontX + 2, -16);
    ctx.stroke();

    // Jet flame core (draw on top for readability)
    if (keys['j'] || keys['J']) {
      const coreX = rearX - 8;
      const coreY = -8;
      ctx.globalAlpha = 0.95;
      ctx.fillStyle = '#ff6a00';
      ctx.beginPath();
      ctx.moveTo(coreX, coreY);
      ctx.lineTo(coreX - 6, coreY + 14);
      ctx.lineTo(coreX + 6, coreY + 14);
      ctx.closePath();
      ctx.fill();

      ctx.fillStyle = '#ffd36b';
      ctx.beginPath();
      ctx.arc(coreX, coreY + 7, 4, 0, Math.PI * 2);
      ctx.fill();
      ctx.globalAlpha = 1;
    }

    // Rider (optional but helps "bike" read)
    ctx.fillStyle = '#0f0f0f';
    ctx.strokeStyle = '#333';
    ctx.lineWidth = 2;
    ctx.beginPath();
    ctx.arc(-6, -20, 4.2, 0, Math.PI * 2);
    ctx.fill();
    ctx.stroke();
    ctx.beginPath();
    ctx.moveTo(-7, -16);
    ctx.lineTo(-2, -10);
    ctx.lineTo(-3, -14);
    ctx.closePath();
    ctx.fill();

    ctx.restore();
  }

  function updateBike(throttle, tilt, jetActive) {
    if (!bike) return;
    extendTerrain();
    bike.vx *= FRICTION_AIR;
    bike.vy *= FRICTION_AIR;
    if (throttle) bike.vx += THROTTLE;
    if (jetActive) bike.vx += JET_THRUST;
    if (bike.vx > JET_MAX_VX) bike.vx = JET_MAX_VX;
    bike.vy += GRAVITY;
    bike.x += bike.vx;
    bike.y += bike.vy;
    bike.angleSpeed *= 0.98;
    bike.angleSpeed += tilt * ANGULAR_ACCEL;
    bike.angleSpeed = Math.max(-MAX_ANGLE_SPEED, Math.min(MAX_ANGLE_SPEED, bike.angleSpeed));
    bike.angle += bike.angleSpeed;

    // Update jet particles in bike-local space.
    if (!jetParticles) jetParticles = [];
    const half = BIKE_LENGTH / 2;
    const spawnX = -half - 8;
    const spawnY = -8;
    if (jetActive) {
      for (let i = 0; i < 4; i++) {
        if (jetParticles.length >= JET_PARTICLES_MAX) break;
        const life = JET_PARTICLE_LIFE_MIN + Math.floor(Math.random() * (JET_PARTICLE_LIFE_MAX - JET_PARTICLE_LIFE_MIN + 1));
        const vx = -(1.8 + Math.random() * 3.2);
        const vy = (Math.random() - 0.5) * 1.2 - 0.2;
        const size = 3 + Math.random() * 4;
        const colorRoll = Math.random();
        const color = colorRoll > 0.7 ? '#ff4d00' : colorRoll > 0.35 ? '#ff9b2f' : '#ffd36b';
        jetParticles.push({
          x: spawnX + (Math.random() - 0.5) * 3,
          y: spawnY + (Math.random() - 0.5) * 3,
          vx,
          vy,
          size,
          life,
          maxLife: life,
          alpha: 1,
          color
        });
      }
    }
    for (let i = jetParticles.length - 1; i >= 0; i--) {
      const p = jetParticles[i];
      p.life -= 1;
      p.x += p.vx;
      p.y += p.vy;
      p.vy += JET_PARTICLE_GRAVITY;
      p.alpha = Math.max(0, p.life / p.maxLife);
      if (p.life <= 0) jetParticles.splice(i, 1);
    }

    const { back, front } = getWheelPositions();
    const gBack = getGroundAt(back.x);
    const gFront = getGroundAt(front.x);

    // Wheel contact forgiveness shrinks when moving fast,
    // so you can actually pop off hills/bumps.
    const speed = Math.abs(bike.vx);
    const marginAbove = Math.max(1.5, 4 - Math.min(2, speed * 0.15));
    const marginBelow = Math.max(10, 14 - Math.min(4, speed * 0.3));

    const onGroundBack = back.y >= gBack.y - marginAbove && back.y <= gBack.y + marginBelow;
    const onGroundFront = front.y >= gFront.y - marginAbove && front.y <= gFront.y + marginBelow;
    const onGroundNow = onGroundBack || onGroundFront;
    const wasOnGroundPrev = wasOnGround;

    // When we touch down after being in the air, compress the suspension visually.
    // Physics collision remains as-is; we only add a small rendered "sink" and rebound.
    if (!wasOnGroundPrev && onGroundNow) {
      const impact = Math.max(0, Math.min(1, bike.vy / 10));
      // Start with a little compression, then allow spring to move further.
      suspensionPos = Math.max(suspensionPos, impact * 2);
      suspensionVel = Math.max(suspensionVel, impact * 4 + 0.5);
    }
    // If we just left the ground at decent speed, kick the bike up a bit
    // to simulate a dirt-bike takeoff.
    if (wasOnGroundPrev && !onGroundNow) {
      const speed = Math.abs(bike.vx);
      if (speed > 3) {
        const lift = Math.min(10, (speed - 3) * 0.35) * (jetActive ? 1.25 : 1.0);
        bike.vy -= lift;
      }
    }
    wasOnGround = onGroundNow;

    // Damped spring toward 0 displacement.
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
      const wheel = onGroundBack ? back : front;
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

  function gameOver() {
    running = false;
    overlay.classList.remove('hidden');
    overlayText.textContent = 'Wiped out! Distance: ' + Math.floor(score) + 'm';
    restartBtn.style.display = 'block';
  }

  function loop() {
    if (!running || !bike) return;
    const throttle = keys[' '] || keys['ArrowUp'];
    const jetActive = keys['j'] || keys['J'];
    // Invert so arrow directions feel natural:
    //   Left (lean back) should lean "back", Right (lean forward) should lean "forward".
    const tilt = (keys['ArrowLeft'] ? 1 : 0) - (keys['ArrowRight'] ? 1 : 0);
    const crashed = updateBike(throttle, tilt, jetActive);
    score = bike.x;
    scoreEl.textContent = Math.floor(score);
    cameraX = bike.x - CAMERA_LEAD;
    if (cameraX < 0) cameraX = 0;

    ctx.fillStyle = '#87CEEB';
    ctx.fillRect(0, 0, W, H);
    const gradient = ctx.createLinearGradient(0, 0, 0, H);
    gradient.addColorStop(0, 'rgba(135, 206, 235, 0.3)');
    gradient.addColorStop(1, 'rgba(70, 130, 180, 0.5)');
    ctx.fillStyle = gradient;
    ctx.fillRect(0, 0, W, H);
    drawTerrain();
    drawBackground();
    drawBike();
    if (crashed) {
      gameOver();
      return;
    }
    requestAnimationFrame(loop);
  }

  const keys = {};
  document.addEventListener('keydown', function (e) {
    if ([' ', 'ArrowUp', 'ArrowDown', 'ArrowLeft', 'ArrowRight'].indexOf(e.key) !== -1) e.preventDefault();
    keys[e.key] = true;
    if (!running && (e.key === ' ' || e.key === 'ArrowUp')) {
      e.preventDefault();
      startGame();
    }
  });
  document.addEventListener('keyup', function (e) {
    keys[e.key] = false;
  });

  function startGame() {
    seed = Date.now() % 100000;
    baseSeed = seed;
    trees = [];
    nextTreeX = -200;
    groundPattern = null;
    jetParticles = [];
    suspensionPos = 0;
    suspensionVel = 0;
    wasOnGround = false;
    initTerrain();
    initBike();
    score = 0;
    scoreEl.textContent = '0';
    running = true;
    overlay.classList.add('hidden');
    restartBtn.style.display = 'none';
    loop();
  }

  function init() {
    seed = Date.now() % 100000;
    baseSeed = seed;
    trees = [];
    nextTreeX = -200;
    groundPattern = null;
    jetParticles = [];
    suspensionPos = 0;
    suspensionVel = 0;
    wasOnGround = false;
    initTerrain();
    initBike();
    cameraX = 0;
    // Initial background so the overlay looks good before you start.
    ctx.fillStyle = '#87CEEB';
    ctx.fillRect(0, 0, W, H);
    const gradient = ctx.createLinearGradient(0, 0, 0, H);
    gradient.addColorStop(0, 'rgba(135, 206, 235, 0.3)');
    gradient.addColorStop(1, 'rgba(70, 130, 180, 0.5)');
    ctx.fillStyle = gradient;
    ctx.fillRect(0, 0, W, H);
    drawTerrain();
    drawBackground();
    drawBike();
  }

  overlay.addEventListener('click', () => {
    if (!running) startGame();
  });
  restartBtn.addEventListener('click', (e) => {
    e.stopPropagation();
    startGame();
  });

  init();
  overlay.classList.remove('hidden');
})();
