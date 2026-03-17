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
    const cos = Math.cos(bike.angle);
    const sin = Math.sin(bike.angle);
    const sx = bike.x - cameraX;
    const sy = bike.y;
    ctx.save();
    ctx.translate(sx, sy);
    ctx.rotate(bike.angle);
    ctx.fillStyle = '#333';
    ctx.fillRect(-BIKE_LENGTH / 2 - 4, -BIKE_HEIGHT / 2, 8, BIKE_HEIGHT);
    ctx.fillStyle = '#8B4513';
    ctx.fillRect(-BIKE_LENGTH / 2, -BIKE_HEIGHT / 2 - 2, BIKE_LENGTH, BIKE_HEIGHT + 4);
    ctx.fillStyle = '#222';
    ctx.beginPath();
    ctx.arc(-BIKE_LENGTH / 2, 0, WHEEL_R, 0, Math.PI * 2);
    ctx.fill();
    ctx.strokeStyle = '#444';
    ctx.lineWidth = 2;
    ctx.stroke();
    ctx.beginPath();
    ctx.arc(BIKE_LENGTH / 2, 0, WHEEL_R, 0, Math.PI * 2);
    ctx.fill();
    ctx.stroke();
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
