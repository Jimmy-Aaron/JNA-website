(function () {
  const canvas = document.getElementById('motoCanvas');
  const ctx = canvas.getContext('2d');
  const overlay = document.getElementById('motoOverlay');
  const overlayText = document.getElementById('motoOverlayText');
  const restartBtn = document.getElementById('motoRestartBtn');
  const scoreEl = document.getElementById('motoScore');

  const W = canvas.width = 900;
  const H = canvas.height = 400;
  const GRAVITY = 0.45;
  const THROTTLE = 0.32;
  const FRICTION_GROUND = 0.92;
  const FRICTION_AIR = 0.998;
  const ANGULAR_ACCEL = 0.018;
  const MAX_ANGLE_SPEED = 0.35;
  const BIKE_LENGTH = 36;
  const BIKE_HEIGHT = 18;
  const WHEEL_R = 10;
  const GROUND_BASE = H - 60;
  const CAMERA_LEAD = 120;
  const SEGMENT_LENGTH = 80;
  const MAX_SLOPE = 0.45;

  let running = false;
  let score = 0;
  let terrain = [];
  let bike = null;
  let cameraX = 0;
  let seed = 0;

  function rnd() {
    seed = (seed * 9301 + 49297) % 233280;
    return seed / 233280;
  }

  function initTerrain() {
    terrain = [];
    let x = -200;
    let y = GROUND_BASE;
    while (x < 5000) {
      const prevY = y;
      const bump = (rnd() - 0.5) * 55;
      const ramp = (rnd() - 0.45) * 50;
      let nextY = y + bump + ramp;
      nextY = Math.max(GROUND_BASE - 100, Math.min(GROUND_BASE + 60, nextY));
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

  function extendTerrain() {
    let last = terrain[terrain.length - 1];
    while (last.x1 < cameraX + W + 400) {
      const prevY = last.y1;
      const bump = (rnd() - 0.5) * 55;
      const ramp = (rnd() - 0.45) * 50;
      let y = Math.max(GROUND_BASE - 100, Math.min(GROUND_BASE + 60, prevY + bump + ramp));
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
    ctx.fillStyle = '#2d5016';
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
    ctx.fill();
    ctx.strokeStyle = '#1a3009';
    ctx.lineWidth = 2;
    ctx.stroke();
  }

  function drawBike() {
    const sx = bike.x - cameraX;
    const sy = bike.y;
    const half = BIKE_LENGTH / 2;

    ctx.save();
    ctx.translate(sx, sy);

    // Keep sprite aligned with physics wheel locations.
    ctx.rotate(-bike.angle);

    const rearX = -half;
    const frontX = half;
    const headX = frontX - 6;
    const headY = -18;

    function wheel(cx) {
      // Tire
      ctx.fillStyle = '#141414';
      ctx.beginPath();
      ctx.arc(cx, 0, WHEEL_R, 0, Math.PI * 2);
      ctx.fill();

      // Rim
      ctx.strokeStyle = '#4a4a4a';
      ctx.lineWidth = 3;
      ctx.beginPath();
      ctx.arc(cx, 0, WHEEL_R - 2, 0, Math.PI * 2);
      ctx.stroke();

      // Spokes
      ctx.strokeStyle = '#6b6b6b';
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
    ctx.fillStyle = '#3a2a2a';
    ctx.strokeStyle = '#5c4033';
    ctx.lineWidth = 2;
    ctx.beginPath();
    ctx.moveTo(-10, -12);
    ctx.quadraticCurveTo(-2, -18, 8, -12);
    ctx.lineTo(6, -6);
    ctx.quadraticCurveTo(-2, -8, -10, -6);
    ctx.closePath();
    ctx.fill();
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
    ctx.moveTo(headX + 20, headY - 6);
    ctx.lineTo(headX + 20, headY - 6);
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

  function updateBike(throttle, tilt) {
    if (!bike) return;
    extendTerrain();
    bike.vx *= FRICTION_AIR;
    bike.vy *= FRICTION_AIR;
    if (throttle) bike.vx += THROTTLE;
    bike.vy += GRAVITY;
    bike.x += bike.vx;
    bike.y += bike.vy;
    bike.angleSpeed *= 0.98;
    bike.angleSpeed += tilt * ANGULAR_ACCEL;
    bike.angleSpeed = Math.max(-MAX_ANGLE_SPEED, Math.min(MAX_ANGLE_SPEED, bike.angleSpeed));
    bike.angle += bike.angleSpeed;

    const { back, front } = getWheelPositions();
    const gBack = getGroundAt(back.x);
    const gFront = getGroundAt(front.x);
    const onGroundBack = back.y >= gBack.y - 4 && back.y <= gBack.y + 14;
    const onGroundFront = front.y >= gFront.y - 4 && front.y <= gFront.y + 14;

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
    const tilt = (keys['ArrowRight'] ? 1 : 0) - (keys['ArrowLeft'] ? 1 : 0);
    const crashed = updateBike(throttle, tilt);
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
    initTerrain();
    initBike();
    cameraX = 0;
    drawTerrain();
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
