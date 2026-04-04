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

  // --- Biome zones ---
  // zone 0 = grass/forest, 1 = dirt, 2 = desert
  // Returns a float 0–2 with smooth transitions
  function getZoneAt(worldX) {
    const x = Math.max(0, worldX);
    if (x < 1800) return 0;
    if (x < 2800) return (x - 1800) / 1000;
    if (x < 4200) return 1;
    if (x < 5200) return 1 + (x - 4200) / 1000;
    return 2;
  }

  function lerpC(a, b, t) {
    return Math.round(a + (b - a) * t);
  }

  // RGB arrays for each zone: [fill, edgeHighlight, detailDark]
  const ZONE = [
    { fill: [45,80,22],    edge: [74,122,40],   detail: [26,48,9],    sky0: [58,127,213], sky1: [184,221,244] },
    { fill: [120,88,38],   edge: [158,122,62],  detail: [80,55,20],   sky0: [72,140,210], sky1: [190,210,235] },
    { fill: [200,148,58],  edge: [220,172,88],  detail: [155,108,28], sky0: [120,170,220], sky1: [220,190,140] }
  ];

  function zoneColors(worldX) {
    const z = getZoneAt(worldX);
    const i0 = Math.min(1, Math.floor(z));
    const i1 = Math.min(2, i0 + 1);
    const t = z - Math.floor(z);
    const Z0 = ZONE[i0], Z1 = ZONE[i1];
    function lerp3(a, b) { return [lerpC(a[0],b[0],t),lerpC(a[1],b[1],t),lerpC(a[2],b[2],t)]; }
    function rgb(c) { return `rgb(${c[0]},${c[1]},${c[2]})`; }
    return {
      fill:   rgb(lerp3(Z0.fill,   Z1.fill)),
      edge:   rgb(lerp3(Z0.edge,   Z1.edge)),
      detail: rgb(lerp3(Z0.detail, Z1.detail)),
      sky0:   rgb(lerp3(Z0.sky0,   Z1.sky0)),
      sky1:   rgb(lerp3(Z0.sky1,   Z1.sky1)),
      zone: z
    };
  }

  // --- State ---
  let running = false;
  let score = 0;
  let highScore = parseInt(localStorage.getItem('motoHighScore') || '0', 10);
  let terrain = [];
  let bike = null;
  let cameraX = 0;
  let seed = 0;
  let baseSeed = 0;
  let decorations = [];       // trees, cacti, rocks
  let nextDecoX = 0;
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
    let actx = null, engineOsc = null, engineGain = null;
    function getCtx() {
      if (!actx) try { actx = new (window.AudioContext || window.webkitAudioContext)(); } catch(e){ return null; }
      return actx;
    }
    return {
      startEngine() {
        const c = getCtx(); if (!c || engineOsc) return;
        engineGain = c.createGain(); engineGain.gain.value = 0.055; engineGain.connect(c.destination);
        engineOsc = c.createOscillator(); engineOsc.type = 'sawtooth';
        engineOsc.frequency.value = 55; engineOsc.connect(engineGain); engineOsc.start();
      },
      updateEngine(vx, jetOn) {
        if (!engineOsc || !actx) return;
        engineOsc.frequency.setTargetAtTime(55 + vx * 12 + (jetOn ? 35 : 0), actx.currentTime, 0.1);
        engineGain.gain.setTargetAtTime(jetOn ? 0.09 : 0.055, actx.currentTime, 0.05);
      },
      stopEngine() {
        if (!engineOsc) return;
        try { engineOsc.stop(); } catch(e){}
        engineOsc = null; engineGain = null;
      },
      crash() {
        const c = getCtx(); if (!c) return;
        const o = c.createOscillator(), g = c.createGain();
        o.connect(g); g.connect(c.destination); o.type = 'sawtooth';
        o.frequency.value = 90; g.gain.value = 0.28; o.start();
        o.frequency.exponentialRampToValueAtTime(25, c.currentTime + 0.45);
        g.gain.exponentialRampToValueAtTime(0.001, c.currentTime + 0.55);
        o.stop(c.currentTime + 0.6);
      },
      trick() {
        const c = getCtx(); if (!c) return;
        [523,659,784,1047].forEach((freq,i) => {
          const o = c.createOscillator(), g = c.createGain();
          o.connect(g); g.connect(c.destination); o.type = 'sine';
          o.frequency.value = freq;
          const t = c.currentTime + i * 0.08;
          g.gain.setValueAtTime(0.15, t); g.gain.exponentialRampToValueAtTime(0.001, t + 0.22);
          o.start(t); o.stop(t + 0.28);
        });
      },
      land(impact) {
        const c = getCtx(); if (!c || impact < 0.15) return;
        const o = c.createOscillator(), g = c.createGain();
        o.connect(g); g.connect(c.destination); o.type = 'sine';
        o.frequency.value = 100 + impact * 40; g.gain.value = impact * 0.12; o.start();
        g.gain.exponentialRampToValueAtTime(0.001, c.currentTime + 0.12);
        o.stop(c.currentTime + 0.15);
      }
    };
  }());

  // --- RNG ---
  function rnd() { seed = (seed * 9301 + 49297) % 233280; return seed / 233280; }
  function randAt(n) {
    const s = baseSeed || seed || 1;
    const v = Math.sin((n + 1) * 12.9898 + s * 0.12345) * 43758.5453;
    return v - Math.floor(v);
  }

  // --- Terrain ---
  function buildSegment(segX, prevY) {
    const bump = (rnd() - 0.5) * 55, ramp = (rnd() - 0.45) * 50;
    let nextY = prevY + bump + ramp;
    if (jumpState.remaining <= 0 && segX > 150 && rnd() < jumpChance) {
      jumpState.total = JUMP_SEGMENTS; jumpState.remaining = JUMP_SEGMENTS;
      jumpState.boost = JUMP_BOOST_MIN + rnd() * (JUMP_BOOST_MAX - JUMP_BOOST_MIN);
    }
    if (jumpState.remaining > 0) {
      const idx = jumpState.total - jumpState.remaining;
      nextY += Math.sin(Math.PI * idx / (jumpState.total - 1)) * jumpState.boost;
      jumpState.remaining--;
    }
    nextY = Math.max(GROUND_MIN, Math.min(GROUND_MAX, nextY));
    let slope = (nextY - prevY) / SEGMENT_LENGTH;
    slope = Math.max(-MAX_SLOPE, Math.min(MAX_SLOPE, slope));
    nextY = prevY + slope * SEGMENT_LENGTH;
    return { x0: segX, y0: prevY, x1: segX + SEGMENT_LENGTH, y1: nextY, slope };
  }

  function initTerrain() {
    terrain = []; jumpState.remaining = 0; jumpState.total = 0; jumpState.boost = 0; jumpChance = 0.08;
    let x = -200, y = GROUND_BASE;
    while (x < 5000) { const s = buildSegment(x, y); terrain.push(s); y = s.y1; x = s.x1; }
  }

  function extendTerrain() {
    let last = terrain[terrain.length - 1];
    while (last.x1 < cameraX + W + 400) {
      if (bike) jumpChance = Math.min(0.22, 0.08 + bike.x / 18000);
      const s = buildSegment(last.x1, last.y1); terrain.push(s); last = s;
    }
  }

  function getGroundAt(x) {
    for (let i = 0; i < terrain.length; i++) {
      const t = terrain[i];
      if (x >= t.x0 && x < t.x1) {
        return { y: t.y0 + (x - t.x0) / (t.x1 - t.x0) * (t.y1 - t.y0), slope: t.slope };
      }
    }
    return { y: GROUND_BASE, slope: 0 };
  }

  function getTerrainMaxX() { return terrain.length ? terrain[terrain.length - 1].x1 : 0; }

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
    const col = zoneColors(cameraX + W / 2);
    const grad = ctx.createLinearGradient(0, 0, 0, GROUND_BASE + 20);
    grad.addColorStop(0, col.sky0);
    grad.addColorStop(1, col.sky1);
    ctx.fillStyle = grad;
    ctx.fillRect(0, 0, W, H);
  }

  function drawSun() {
    const zone = getZoneAt(cameraX + W / 2);
    // Sun shifts warmer in desert
    const sx = W - 110, sy = 55, r = 26;
    const sunCol = zone < 1 ? '#FFE033' : zone < 2 ? `hsl(${45 - zone * 15},100%,55%)` : '#FF9900';
    const glow = ctx.createRadialGradient(sx, sy, r * 0.4, sx, sy, r * 2.8);
    glow.addColorStop(0, zone > 1 ? 'rgba(255,180,60,0.55)' : 'rgba(255,245,160,0.55)');
    glow.addColorStop(1, 'rgba(255,200,80,0)');
    ctx.fillStyle = glow;
    ctx.beginPath(); ctx.arc(sx, sy, r * 2.8, 0, Math.PI * 2); ctx.fill();
    ctx.fillStyle = sunCol;
    ctx.beginPath(); ctx.arc(sx, sy, r, 0, Math.PI * 2); ctx.fill();
    ctx.strokeStyle = zone > 1 ? 'rgba(255,160,40,0.5)' : 'rgba(255,230,80,0.5)';
    ctx.lineWidth = 2;
    for (let i = 0; i < 12; i++) {
      const a = (i / 12) * Math.PI * 2;
      ctx.beginPath();
      ctx.moveTo(sx + Math.cos(a) * (r + 5), sy + Math.sin(a) * (r + 5));
      ctx.lineTo(sx + Math.cos(a) * (r + 16), sy + Math.sin(a) * (r + 16));
      ctx.stroke();
    }
  }

  // Distant mesa silhouettes (desert zone)
  function drawMesas() {
    const zone = getZoneAt(cameraX + W / 2);
    if (zone < 1.2) return;
    const alpha = Math.min(1, (zone - 1.2) / 0.6) * 0.55;
    ctx.save();
    ctx.globalAlpha = alpha;
    const par = 0.04;
    const ox = -(cameraX * par) % (W + 800);
    // Draw a series of flat-top mesa shapes
    const mesas = [
      [ox + 40,  GROUND_BASE - 75, 110, 45],
      [ox + 230, GROUND_BASE - 55, 80,  32],
      [ox + 420, GROUND_BASE - 90, 140, 52],
      [ox + 620, GROUND_BASE - 62, 95,  38],
      [ox + 800, GROUND_BASE - 78, 120, 44],
      [ox + 960, GROUND_BASE - 50, 70,  28],
    ];
    ctx.fillStyle = '#7a3d1a';
    mesas.forEach(([x, y, w, h]) => {
      ctx.beginPath();
      ctx.moveTo(x,         y);
      ctx.lineTo(x + w,     y);
      ctx.lineTo(x + w + 18, y + h);
      ctx.lineTo(x - 18,    y + h);
      ctx.closePath();
      ctx.fill();
      // Mesa top edge highlight
      ctx.fillStyle = '#9a5228';
      ctx.beginPath();
      ctx.rect(x, y, w, 4);
      ctx.fill();
      ctx.fillStyle = '#7a3d1a';
    });
    ctx.restore();
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
    ctx.beginPath(); ctx.ellipse(x+w*.50, y+h*.65, w*.44, h*.38, 0,0,Math.PI*2); ctx.fill();
    ctx.beginPath(); ctx.ellipse(x+w*.28, y+h*.62, w*.30, h*.33, 0,0,Math.PI*2); ctx.fill();
    ctx.beginPath(); ctx.ellipse(x+w*.72, y+h*.60, w*.27, h*.30, 0,0,Math.PI*2); ctx.fill();
    ctx.beginPath(); ctx.ellipse(x+w*.50, y+h*.32, w*.27, h*.34, 0,0,Math.PI*2); ctx.fill();
    ctx.beginPath(); ctx.ellipse(x+w*.34, y+h*.42, w*.21, h*.27, 0,0,Math.PI*2); ctx.fill();
    ctx.beginPath(); ctx.ellipse(x+w*.66, y+h*.40, w*.19, h*.25, 0,0,Math.PI*2); ctx.fill();
    ctx.fillStyle = 'rgba(200,220,240,0.5)';
    ctx.beginPath(); ctx.ellipse(x+w*.5, y+h*.78, w*.40, h*.15, 0,0,Math.PI*2); ctx.fill();
  }

  // --- Drawing: Decorations ---
  function ensureDecorationsUpTo(worldX) {
    const targetX = Math.min(worldX, getTerrainMaxX());
    while (nextDecoX < targetX) {
      const idx = decorations.length;
      const spacing = 55 + randAt(200000 + idx * 17) * 100;
      nextDecoX += spacing;
      const zone = getZoneAt(nextDecoX);
      const v = randAt(400000 + idx * 23);
      const v2 = randAt(500000 + idx * 29);
      let type;
      if (zone < 0.4)       type = v > 0.45 ? 'pine' : 'deciduous';
      else if (zone < 0.7)  type = v > 0.55 ? 'pine' : (v > 0.25 ? 'deciduous' : 'dead');
      else if (zone < 1.1)  type = v > 0.6  ? 'dead' : (v > 0.3 ? 'rock' : 'deciduous');
      else if (zone < 1.5)  type = v > 0.55 ? 'rock' : 'dead';
      else if (zone < 1.8)  type = v > 0.4  ? 'cactus' : 'rock';
      else                  type = v > 0.25  ? 'cactus' : 'rock';
      decorations.push({
        x: nextDecoX,
        h: 45 + randAt(300000 + idx * 19) * 85,
        variant: v,
        variant2: v2,
        type
      });
    }
  }

  function drawPineTree(sx, baseY, h, v) {
    const trunkH = h * 0.32;
    // Trunk
    ctx.fillStyle = '#3a2010';
    ctx.fillRect(sx - 2.5, baseY - trunkH, 5, trunkH);
    // Shadow side
    ctx.fillStyle = '#251508';
    ctx.fillRect(sx + 0.5, baseY - trunkH, 2, trunkH);
    // Three triangle layers (bottom to top)
    const layers = 3 + (h > 80 ? 1 : 0);
    for (let i = 0; i < layers; i++) {
      const layerBottom = baseY - trunkH * 0.6 - (h * 0.55 / layers) * i;
      const layerTop    = layerBottom - (h * 0.55 / layers) * 1.35;
      const hw = h * 0.38 * (1 - i * 0.18);
      // Shadow layer
      ctx.fillStyle = i === 0 ? '#1a4510' : i === 1 ? '#1e4e12' : '#1a4510';
      ctx.beginPath();
      ctx.moveTo(sx,      layerTop);
      ctx.lineTo(sx - hw, layerBottom);
      ctx.lineTo(sx + hw, layerBottom);
      ctx.closePath(); ctx.fill();
      // Light face
      ctx.fillStyle = i === 0 ? '#226018' : i === 1 ? '#286b1c' : '#2e7820';
      ctx.beginPath();
      ctx.moveTo(sx,          layerTop);
      ctx.lineTo(sx + hw * 0.05, layerBottom);
      ctx.lineTo(sx + hw,     layerBottom);
      ctx.closePath(); ctx.fill();
      // Snow / highlight on top layer edge
      if (i === layers - 1) {
        ctx.fillStyle = 'rgba(255,255,255,0.10)';
        ctx.beginPath();
        ctx.moveTo(sx, layerTop);
        ctx.lineTo(sx - hw * 0.35, layerTop + (layerBottom - layerTop) * 0.35);
        ctx.lineTo(sx - hw * 0.1, layerTop + 2);
        ctx.closePath(); ctx.fill();
      }
    }
  }

  function drawDeciduousTree(sx, baseY, h, v) {
    const trunkH = h * 0.42;
    // Trunk with slight taper
    ctx.strokeStyle = '#4a3018';
    ctx.lineWidth = 5;
    ctx.lineCap = 'round';
    ctx.beginPath(); ctx.moveTo(sx, baseY); ctx.lineTo(sx, baseY - trunkH); ctx.stroke();
    ctx.strokeStyle = '#3a2410';
    ctx.lineWidth = 2.5;
    ctx.beginPath(); ctx.moveTo(sx + 1, baseY); ctx.lineTo(sx + 1.5, baseY - trunkH); ctx.stroke();
    // Two visible branches
    ctx.strokeStyle = '#3e2814';
    ctx.lineWidth = 2.5;
    ctx.beginPath();
    ctx.moveTo(sx, baseY - trunkH * 0.65);
    ctx.lineTo(sx - h * 0.20, baseY - trunkH * 0.90);
    ctx.stroke();
    ctx.beginPath();
    ctx.moveTo(sx, baseY - trunkH * 0.78);
    ctx.lineTo(sx + h * 0.16, baseY - trunkH * 0.98);
    ctx.stroke();
    // Canopy: layered shadow + light ellipses
    const col1 = v > 0.5 ? '#2d6e1a' : '#255e14';
    const col2 = v > 0.5 ? '#226014' : '#1c5010';
    const col3 = v > 0.5 ? '#388a20' : '#2e7818';
    const cy = baseY - h * 0.80;
    ctx.fillStyle = col2;
    ctx.beginPath(); ctx.ellipse(sx - h*.11, cy + h*.06, h*.26, h*.20, -.15,0,Math.PI*2); ctx.fill();
    ctx.beginPath(); ctx.ellipse(sx + h*.10, cy + h*.04, h*.22, h*.18,  .15,0,Math.PI*2); ctx.fill();
    ctx.beginPath(); ctx.ellipse(sx,         cy - h*.02, h*.30, h*.24,    0,0,Math.PI*2); ctx.fill();
    ctx.fillStyle = col1;
    ctx.beginPath(); ctx.ellipse(sx - h*.05, cy - h*.08, h*.22, h*.18, -.1,0,Math.PI*2); ctx.fill();
    ctx.beginPath(); ctx.ellipse(sx + h*.13, cy + h*.02, h*.18, h*.15,  .2,0,Math.PI*2); ctx.fill();
    ctx.fillStyle = col3;
    ctx.beginPath(); ctx.ellipse(sx,         cy - h*.15, h*.18, h*.14,    0,0,Math.PI*2); ctx.fill();
    // Light highlight
    ctx.fillStyle = 'rgba(255,255,255,0.07)';
    ctx.beginPath(); ctx.ellipse(sx - h*.04, cy - h*.10, h*.09, h*.06, -.3,0,Math.PI*2); ctx.fill();
  }

  function drawDeadTree(sx, baseY, h, v) {
    const trunkH = h * 0.55;
    ctx.strokeStyle = '#5a4020';
    ctx.lineWidth = 4;
    ctx.lineCap = 'round';
    ctx.beginPath(); ctx.moveTo(sx, baseY); ctx.lineTo(sx, baseY - trunkH); ctx.stroke();
    // Bare branches
    ctx.strokeStyle = '#4a3418';
    ctx.lineWidth = 2;
    const branchCount = 3 + Math.floor(v * 3);
    for (let i = 0; i < branchCount; i++) {
      const by = baseY - trunkH * (0.5 + i * 0.14);
      const dir = i % 2 === 0 ? -1 : 1;
      const bl = h * (0.12 + v * 0.08);
      ctx.beginPath();
      ctx.moveTo(sx, by);
      ctx.lineTo(sx + dir * bl, by - bl * 0.5);
      ctx.stroke();
      // sub-branch
      ctx.lineWidth = 1;
      ctx.beginPath();
      ctx.moveTo(sx + dir * bl * 0.6, by - bl * 0.3);
      ctx.lineTo(sx + dir * bl * 0.9, by - bl * 0.7);
      ctx.stroke();
      ctx.lineWidth = 2;
    }
  }

  function drawCactus(sx, baseY, h, v) {
    const armY = baseY - h * 0.46;
    // Left arm
    ctx.strokeStyle = '#4a7a28';
    ctx.lineWidth = Math.max(3, h * 0.12);
    ctx.lineCap = 'round';
    ctx.beginPath();
    ctx.moveTo(sx - h * 0.10, armY);
    ctx.quadraticCurveTo(sx - h * 0.28, armY - h * 0.05, sx - h * 0.28, armY - h * 0.28);
    ctx.stroke();
    // Arm top curve
    ctx.lineWidth = Math.max(3, h * 0.10);
    ctx.beginPath();
    ctx.moveTo(sx - h * 0.28, armY - h * 0.28);
    ctx.quadraticCurveTo(sx - h * 0.28, armY - h * 0.38, sx - h * 0.22, armY - h * 0.38);
    ctx.stroke();
    // Right arm (only some cacti)
    if (v > 0.28) {
      ctx.lineWidth = Math.max(3, h * 0.11);
      ctx.beginPath();
      ctx.moveTo(sx + h * 0.08, armY + h * 0.06);
      ctx.quadraticCurveTo(sx + h * 0.26, armY, sx + h * 0.26, armY - h * 0.22);
      ctx.stroke();
      ctx.lineWidth = Math.max(3, h * 0.09);
      ctx.beginPath();
      ctx.moveTo(sx + h * 0.26, armY - h * 0.22);
      ctx.quadraticCurveTo(sx + h * 0.26, armY - h * 0.32, sx + h * 0.20, armY - h * 0.32);
      ctx.stroke();
    }
    // Main trunk
    ctx.strokeStyle = '#4a7a28';
    ctx.lineWidth = Math.max(4, h * 0.15);
    ctx.beginPath();
    ctx.moveTo(sx, baseY);
    ctx.lineTo(sx, baseY - h * 0.96);
    ctx.stroke();
    // Light face stripe
    ctx.strokeStyle = '#5e9a34';
    ctx.lineWidth = Math.max(1.5, h * 0.05);
    ctx.beginPath();
    ctx.moveTo(sx + h * 0.03, baseY - 2);
    ctx.lineTo(sx + h * 0.03, baseY - h * 0.94);
    ctx.stroke();
    // Rib lines
    ctx.strokeStyle = '#3a6220';
    ctx.lineWidth = 0.8;
    for (let i = 0; i < 5; i++) {
      const ry = baseY - (h * 0.18) * i - h * 0.06;
      ctx.beginPath();
      ctx.moveTo(sx - h * 0.07, ry);
      ctx.quadraticCurveTo(sx, ry - h * 0.03, sx + h * 0.07, ry);
      ctx.stroke();
    }
    // Top dome
    ctx.fillStyle = '#508830';
    ctx.beginPath(); ctx.arc(sx, baseY - h * 0.97, h * 0.08, 0, Math.PI*2); ctx.fill();
  }

  function drawRock(sx, baseY, h, v) {
    const w = h * 0.9;
    const rh = h * 0.45;
    ctx.fillStyle = v > 0.5 ? '#666050' : '#5a5848';
    ctx.strokeStyle = v > 0.5 ? '#7a7060' : '#6e6858';
    ctx.lineWidth = 1;
    ctx.beginPath();
    ctx.moveTo(sx - w * 0.5, baseY);
    ctx.lineTo(sx - w * 0.45, baseY - rh * 0.8);
    ctx.lineTo(sx - w * 0.1, baseY - rh);
    ctx.lineTo(sx + w * 0.2, baseY - rh * 0.9);
    ctx.lineTo(sx + w * 0.5, baseY - rh * 0.4);
    ctx.lineTo(sx + w * 0.45, baseY);
    ctx.closePath();
    ctx.fill(); ctx.stroke();
    ctx.fillStyle = 'rgba(255,255,255,0.08)';
    ctx.beginPath();
    ctx.moveTo(sx - w * 0.1, baseY - rh);
    ctx.lineTo(sx + w * 0.2, baseY - rh * 0.9);
    ctx.lineTo(sx, baseY - rh * 0.7);
    ctx.closePath(); ctx.fill();
  }

  function drawScenery() {
    ensureDecorationsUpTo(cameraX + W + 600);
    ctx.save();
    ctx.globalAlpha = 0.72;
    for (let i = 0; i < decorations.length; i++) {
      const d = decorations[i];
      const dx = d.x - cameraX;
      if (dx < -160 || dx > W + 160) continue;
      const screenX = dx * 0.28; // parallax
      const baseY = getGroundAt(d.x).y;
      ctx.save();
      switch (d.type) {
        case 'pine':       drawPineTree(screenX, baseY, d.h, d.variant);       break;
        case 'deciduous':  drawDeciduousTree(screenX, baseY, d.h, d.variant);  break;
        case 'dead':       drawDeadTree(screenX, baseY, d.h, d.variant);       break;
        case 'cactus':     drawCactus(screenX, baseY, d.h, d.variant);         break;
        case 'rock':       drawRock(screenX, baseY, d.h * 0.55, d.variant);   break;
      }
      ctx.restore();
    }
    ctx.restore();
  }

  // --- Drawing: Terrain ---
  function drawTerrain() {
    const startX = cameraX - 50, endX = cameraX + W + 50;

    // Build the terrain path
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

    // Horizontal gradient based on zone colours at left/right edges
    const colL = zoneColors(cameraX);
    const colR = zoneColors(cameraX + W);
    if (colL.fill === colR.fill) {
      ctx.fillStyle = colL.fill;
    } else {
      const grad = ctx.createLinearGradient(0, 0, W, 0);
      grad.addColorStop(0, colL.fill);
      grad.addColorStop(1, colR.fill);
      ctx.fillStyle = grad;
    }
    ctx.fill();

    // Surface details (clip to terrain shape)
    ctx.save();
    // Re-clip
    ctx.beginPath();
    started = false;
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
    ctx.clip();

    const zoneCenter = getZoneAt(cameraX + W / 2);
    const step = 48;
    const xStart = Math.floor(startX / step) * step;

    if (zoneCenter < 1.2) {
      // --- Grass tufts ---
      ctx.globalAlpha = 0.6;
      ctx.strokeStyle = colL.detail;
      ctx.lineWidth = 1;
      for (let x = xStart; x < endX; x += step) {
        const g = getGroundAt(x);
        const sx = x - cameraX;
        const len = 5 + randAt(x * 0.01) * 10;
        const sway = (randAt(x * 0.02) - 0.5) * 3;
        ctx.beginPath(); ctx.moveTo(sx, g.y); ctx.lineTo(sx + sway, g.y - len); ctx.stroke();
        // second tuft
        const len2 = 4 + randAt(x * 0.013 + 7) * 7;
        const sway2 = (randAt(x * 0.025 + 5) - 0.5) * 2;
        ctx.beginPath(); ctx.moveTo(sx + 8, g.y); ctx.lineTo(sx + 8 + sway2, g.y - len2); ctx.stroke();
      }
    } else if (zoneCenter < 1.8) {
      // --- Dirt/rocks ---
      ctx.globalAlpha = 0.45;
      for (let x = xStart; x < endX; x += step) {
        const g = getGroundAt(x);
        const sx = x - cameraX;
        // small pebble
        ctx.fillStyle = randAt(x * 0.03 + 11) > 0.5 ? colL.detail : colR.detail;
        const pr = 1.5 + randAt(x * 0.04) * 3;
        ctx.beginPath(); ctx.arc(sx + randAt(x * 0.05) * 20 - 10, g.y - 1, pr, 0, Math.PI*2); ctx.fill();
        // crack line
        ctx.strokeStyle = colL.detail;
        ctx.lineWidth = 0.8;
        const cl = 4 + randAt(x * 0.06) * 8;
        ctx.beginPath(); ctx.moveTo(sx - 5, g.y - 0.5); ctx.lineTo(sx - 5 + cl, g.y - 0.5 - cl * 0.3); ctx.stroke();
      }
    } else {
      // --- Sand ripples ---
      ctx.globalAlpha = 0.35;
      ctx.strokeStyle = colR.detail;
      ctx.lineWidth = 1;
      for (let x = xStart; x < endX; x += step * 0.6) {
        const g = getGroundAt(x);
        const sx = x - cameraX;
        const rw = 14 + randAt(x * 0.03) * 20;
        ctx.beginPath();
        ctx.moveTo(sx, g.y - 2);
        ctx.quadraticCurveTo(sx + rw / 2, g.y - 4, sx + rw, g.y - 2);
        ctx.stroke();
      }
    }
    ctx.restore();

    // Top edge stroke (changes with zone)
    const edgeGrad = ctx.createLinearGradient(0, 0, W, 0);
    edgeGrad.addColorStop(0, colL.edge);
    edgeGrad.addColorStop(1, colR.edge);
    ctx.strokeStyle = edgeGrad;
    ctx.lineWidth = 2;
    ctx.beginPath();
    started = false;
    for (let i = 0; i < terrain.length; i++) {
      const t = terrain[i];
      if (t.x1 < startX || t.x0 > endX) continue;
      if (!started) { ctx.moveTo(t.x0 - cameraX, t.y0); started = true; }
      ctx.lineTo(t.x1 - cameraX, t.y1);
    }
    ctx.stroke();
  }

  // --- Drawing: Wheels ---
  function drawWheel(cx, cy, r, rimCol) {
    // Outer tire (thick knobby)
    ctx.fillStyle = '#141414';
    ctx.beginPath(); ctx.arc(cx, cy, r, 0, Math.PI*2); ctx.fill();
    // Tread knobs
    ctx.fillStyle = '#2a2a2a';
    for (let i = 0; i < 18; i++) {
      const a = (i / 18) * Math.PI * 2;
      ctx.beginPath();
      ctx.arc(cx + Math.cos(a) * r, cy + Math.sin(a) * r, 2, 0, Math.PI*2);
      ctx.fill();
    }
    // Inner rim
    ctx.strokeStyle = rimCol;
    ctx.lineWidth = 2;
    ctx.beginPath(); ctx.arc(cx, cy, r - 3.5, 0, Math.PI*2); ctx.stroke();
    // Spokes (18 thin silver ones)
    ctx.strokeStyle = rimCol;
    ctx.lineWidth = 0.8;
    for (let i = 0; i < 18; i++) {
      const a = (i / 18) * Math.PI * 2;
      ctx.beginPath();
      ctx.moveTo(cx + Math.cos(a) * 4, cy + Math.sin(a) * 4);
      ctx.lineTo(cx + Math.cos(a) * (r - 4), cy + Math.sin(a) * (r - 4));
      ctx.stroke();
    }
    // Hub
    ctx.fillStyle = '#888';
    ctx.strokeStyle = '#aaa';
    ctx.lineWidth = 1;
    ctx.beginPath(); ctx.arc(cx, cy, 4.5, 0, Math.PI*2); ctx.fill(); ctx.stroke();
    ctx.fillStyle = '#555';
    ctx.beginPath(); ctx.arc(cx, cy, 2.5, 0, Math.PI*2); ctx.fill();
  }

  // --- Drawing: Jet particles ---
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
      ctx.closePath(); ctx.fill();
      ctx.globalAlpha = p.alpha * 0.5;
      ctx.fillStyle = '#fff4c2';
      ctx.beginPath(); ctx.arc(p.x, p.y + p.size * 0.4, p.size * 0.22, 0, Math.PI*2); ctx.fill();
    }
    ctx.globalAlpha = 1;
  }

  // --- Drawing: Rider ---
  function drawRider(steerX, steerY) {
    // Rider positioned on seat (seat is roughly at y=-38, x from -24 to -4)
    const hipX = -14, hipY = -41;
    const lean = 0.28 + visualTilt * 0.14;
    const shoulderX = hipX + 10 + lean * 10;
    const shoulderY = hipY - 16;
    const helmetX = shoulderX + 4;
    const helmetY = shoulderY - 11;
    const pegX = -4, pegY = -2;  // footpeg position

    ctx.save();
    ctx.lineCap = 'round';

    // --- Legs ---
    // Thigh
    ctx.strokeStyle = '#1e2560';
    ctx.lineWidth = 7;
    ctx.beginPath(); ctx.moveTo(hipX, hipY); ctx.lineTo(pegX - 6, pegY + 3); ctx.stroke();
    // Shin
    ctx.strokeStyle = '#252e70';
    ctx.lineWidth = 6;
    ctx.beginPath(); ctx.moveTo(pegX - 6, pegY + 3); ctx.lineTo(pegX - 10, pegY - 3); ctx.stroke();
    // Boot
    ctx.fillStyle = '#0d0d0d'; ctx.strokeStyle = '#1e1e1e'; ctx.lineWidth = 1.5;
    ctx.beginPath(); ctx.ellipse(pegX - 14, pegY - 2, 7, 3.5, -0.15, 0, Math.PI*2); ctx.fill(); ctx.stroke();
    // Boot buckles
    ctx.fillStyle = '#555';
    ctx.beginPath(); ctx.rect(pegX - 18, pegY - 5, 5, 2); ctx.fill();
    ctx.beginPath(); ctx.rect(pegX - 18, pegY - 1, 5, 2); ctx.fill();

    // --- Torso ---
    ctx.fillStyle = '#1840b0'; ctx.strokeStyle = '#0e2870'; ctx.lineWidth = 2;
    ctx.beginPath();
    ctx.moveTo(hipX, hipY);
    ctx.lineTo(shoulderX, shoulderY);
    ctx.lineTo(shoulderX + 7, shoulderY + 7);
    ctx.lineTo(hipX + 7, hipY + 4);
    ctx.closePath(); ctx.fill(); ctx.stroke();
    // Jersey number/logo block
    ctx.fillStyle = '#FF5C00';
    ctx.beginPath(); ctx.rect(hipX + 5, hipY - 9, 7, 5); ctx.fill();
    // Jersey stripe
    ctx.strokeStyle = 'rgba(255,255,255,0.22)'; ctx.lineWidth = 2.5;
    ctx.beginPath(); ctx.moveTo(hipX + 3, hipY - 2); ctx.lineTo(shoulderX + 2, shoulderY + 2); ctx.stroke();

    // --- Arm ---
    ctx.strokeStyle = '#1840b0'; ctx.lineWidth = 5;
    ctx.beginPath();
    ctx.moveTo(shoulderX + 4, shoulderY + 3);
    ctx.lineTo(steerX - 14, steerY - 3);
    ctx.stroke();
    // Glove
    ctx.fillStyle = '#111'; ctx.strokeStyle = '#333'; ctx.lineWidth = 1;
    ctx.beginPath(); ctx.arc(steerX - 14, steerY - 3, 3.5, 0, Math.PI*2); ctx.fill(); ctx.stroke();

    // --- Helmet ---
    // Main shell
    ctx.fillStyle = '#cc1500'; ctx.strokeStyle = '#8b0f00'; ctx.lineWidth = 2;
    ctx.beginPath(); ctx.arc(helmetX, helmetY, 10, 0, Math.PI*2); ctx.fill(); ctx.stroke();
    // Chin guard
    ctx.fillStyle = '#9a1000';
    ctx.beginPath();
    ctx.moveTo(helmetX - 8, helmetY + 2);
    ctx.quadraticCurveTo(helmetX + 1, helmetY + 13, helmetX + 10, helmetY + 3);
    ctx.lineTo(helmetX + 8, helmetY + 1);
    ctx.quadraticCurveTo(helmetX, helmetY + 8, helmetX - 6, helmetY + 1);
    ctx.closePath(); ctx.fill();
    // Visor (large goggle-style)
    ctx.fillStyle = 'rgba(20,50,200,0.78)'; ctx.strokeStyle = '#6688bb'; ctx.lineWidth = 0.8;
    ctx.beginPath();
    ctx.moveTo(helmetX - 9, helmetY - 2);
    ctx.quadraticCurveTo(helmetX + 1, helmetY + 5, helmetX + 11, helmetY - 1);
    ctx.lineTo(helmetX + 9, helmetY - 7);
    ctx.quadraticCurveTo(helmetX + 1, helmetY - 10, helmetX - 7, helmetY - 7);
    ctx.closePath(); ctx.fill(); ctx.stroke();
    // Visor reflection
    ctx.fillStyle = 'rgba(255,255,255,0.18)';
    ctx.beginPath(); ctx.ellipse(helmetX - 3, helmetY - 5, 4.5, 2.2, -0.4, 0, Math.PI*2); ctx.fill();
    // Peak/brim
    ctx.fillStyle = '#8b0f00';
    ctx.beginPath();
    ctx.moveTo(helmetX - 9, helmetY - 3);
    ctx.lineTo(helmetX + 12, helmetY - 3);
    ctx.lineTo(helmetX + 13, helmetY + 0.5);
    ctx.lineTo(helmetX - 8, helmetY + 0.5);
    ctx.closePath(); ctx.fill();
    // Shell highlight
    ctx.fillStyle = 'rgba(255,255,255,0.16)';
    ctx.beginPath(); ctx.ellipse(helmetX - 3, helmetY - 7, 5, 3, -0.3, 0, Math.PI*2); ctx.fill();

    ctx.restore();
  }

  // --- Drawing: Bike (KTM enduro style) ---
  function drawBike() {
    const sx = bike.x - cameraX;
    const sy = bike.y + suspensionPos;

    // Physics axle positions
    const rX = -BIKE_LENGTH / 2;  // -25
    const fX =  BIKE_LENGTH / 2;  // +25
    const rWR = WHEEL_R;           // 13
    const fWR = WHEEL_R + 1;       // 14 (enduro front 21" slightly bigger)

    // Key geometry points (y negative = upward from axle line)
    const swPivX = -3,  swPivY = -17;  // swingarm/frame pivot
    const steerX = 22,  steerY = -42;  // steering head
    const seatRX = -24, seatRY = -38;  // rear of seat
    const seatFX = -3,  seatFY = -37;  // front of seat

    ctx.save();
    ctx.translate(sx, sy);
    ctx.rotate(-bike.angle);

    // === EXHAUST SYSTEM (draw first — behind everything) ===
    // Header pipe exits engine front right, sweeps forward/down/back
    ctx.strokeStyle = '#aaaaaa';
    ctx.lineWidth = 3;
    ctx.lineCap = 'round';
    ctx.beginPath();
    ctx.moveTo(10, -13);
    ctx.quadraticCurveTo(18, -5, 18, 4);
    ctx.quadraticCurveTo(16, 10, 2, 10);
    ctx.quadraticCurveTo(-10, 10, -16, 5);
    ctx.stroke();
    // Expansion chamber (large oval canister under seat)
    ctx.fillStyle = '#8c8c8c';
    ctx.strokeStyle = '#5a5a5a';
    ctx.lineWidth = 1;
    ctx.beginPath(); ctx.ellipse(-17, 2, 13, 7, 0, 0, Math.PI*2); ctx.fill(); ctx.stroke();
    // Canister end cap
    ctx.fillStyle = '#6a6a6a';
    ctx.beginPath(); ctx.ellipse(-29.5, 2, 3.5, 6, 0, 0, Math.PI*2); ctx.fill();
    // Silencer tip
    ctx.strokeStyle = '#4a4a4a'; ctx.lineWidth = 3;
    ctx.beginPath(); ctx.moveTo(-29.5, 2); ctx.lineTo(-33, 2); ctx.stroke();
    ctx.fillStyle = '#333';
    ctx.beginPath(); ctx.arc(-33, 2, 2.5, 0, Math.PI*2); ctx.fill();
    // Heat shield
    ctx.strokeStyle = '#505050'; ctx.lineWidth = 1.5;
    ctx.beginPath(); ctx.moveTo(-7, -4); ctx.quadraticCurveTo(-17, -7, -28, -4); ctx.stroke();

    // === JET PARTICLES ===
    drawJetParticles();

    // === REAR WHEEL ===
    drawWheel(rX, 0, rWR, '#c8c8c8');

    // === SWINGARM (silver aluminium) ===
    // Upper rail
    ctx.strokeStyle = '#b8b8b8'; ctx.lineWidth = 5; ctx.lineCap = 'round';
    ctx.beginPath(); ctx.moveTo(rX + 2, -2); ctx.lineTo(swPivX, swPivY); ctx.stroke();
    // Lower rail
    ctx.strokeStyle = '#909090'; ctx.lineWidth = 3;
    ctx.beginPath(); ctx.moveTo(rX + 2, 4); ctx.lineTo(swPivX + 1, swPivY + 6); ctx.stroke();
    // Cross brace on swingarm
    ctx.strokeStyle = '#a0a0a0'; ctx.lineWidth = 2;
    ctx.beginPath();
    ctx.moveTo(rX + 14, -2); ctx.lineTo(rX + 14, 3);
    ctx.moveTo(rX + 8, -1); ctx.lineTo(rX + 8, 3);
    ctx.stroke();

    // === REAR SHOCK ===
    ctx.strokeStyle = '#888'; ctx.lineWidth = 5;
    ctx.beginPath(); ctx.moveTo(-20, -7); ctx.lineTo(swPivX - 1, swPivY - 10); ctx.stroke();
    // Orange spring (KTM signature)
    ctx.strokeStyle = '#E05000'; ctx.lineWidth = 3.5;
    ctx.beginPath(); ctx.moveTo(-22, -5); ctx.lineTo(swPivX + 1, swPivY - 7); ctx.stroke();
    // Shaft
    ctx.strokeStyle = '#d0d0d0'; ctx.lineWidth = 2;
    ctx.beginPath(); ctx.moveTo(-18, -9); ctx.lineTo(swPivX, swPivY - 11); ctx.stroke();

    // === MAIN TRELLIS FRAME (orange, KTM) ===
    const ORange = '#D45800';
    const ODark  = '#A84200';
    // Main backbone: steering head → swingarm pivot
    ctx.strokeStyle = ORange; ctx.lineWidth = 5; ctx.lineCap = 'round';
    ctx.beginPath(); ctx.moveTo(steerX, steerY); ctx.lineTo(swPivX, swPivY); ctx.stroke();
    // Down tube: steering head → bottom of engine → swingarm pivot
    ctx.strokeStyle = ODark; ctx.lineWidth = 4;
    ctx.beginPath(); ctx.moveTo(steerX, steerY); ctx.lineTo(12, -11); ctx.lineTo(swPivX, swPivY); ctx.stroke();
    // Seat stays: swingarm pivot → rear seat
    ctx.strokeStyle = ORange; ctx.lineWidth = 4;
    ctx.beginPath(); ctx.moveTo(swPivX, swPivY); ctx.lineTo(seatRX, seatRY); ctx.stroke();
    ctx.strokeStyle = ODark; ctx.lineWidth = 3;
    ctx.beginPath(); ctx.moveTo(swPivX + 1, swPivY + 4); ctx.lineTo(seatRX + 3, seatRY + 7); ctx.stroke();
    // Frame highlight
    ctx.strokeStyle = 'rgba(255,120,40,0.30)'; ctx.lineWidth = 2;
    ctx.beginPath(); ctx.moveTo(steerX - 1, steerY + 3); ctx.lineTo(swPivX + 1, swPivY - 1); ctx.stroke();
    // Gusset at swingarm pivot
    ctx.fillStyle = ODark;
    ctx.beginPath();
    ctx.moveTo(swPivX, swPivY); ctx.lineTo(swPivX - 5, swPivY + 5); ctx.lineTo(swPivX + 7, swPivY + 4);
    ctx.closePath(); ctx.fill();

    // === ENGINE (2-stroke single cylinder) ===
    // Engine cases (dark silver/grey)
    ctx.fillStyle = '#252525'; ctx.strokeStyle = '#3a3a3a'; ctx.lineWidth = 1.5;
    ctx.beginPath();
    ctx.moveTo(-7, -10); ctx.lineTo(11, -10); ctx.lineTo(11, -26); ctx.lineTo(6, -28); ctx.lineTo(-7, -26);
    ctx.closePath(); ctx.fill(); ctx.stroke();
    // Engine interior highlight
    ctx.fillStyle = '#303030';
    ctx.beginPath(); ctx.rect(-5, -11, 14, 14); ctx.fill();
    // Ignition/stator cover (circular, right side)
    ctx.fillStyle = '#2e2e2e'; ctx.strokeStyle = '#484848'; ctx.lineWidth = 1;
    ctx.beginPath(); ctx.arc(9, -17, 5.5, 0, Math.PI*2); ctx.fill(); ctx.stroke();
    ctx.fillStyle = '#3e3e3e';
    ctx.beginPath(); ctx.arc(9, -17, 3.5, 0, Math.PI*2); ctx.fill();
    // Cylinder (forward-inclined 2-stroke)
    ctx.fillStyle = '#1e1e1e'; ctx.strokeStyle = '#353535'; ctx.lineWidth = 1.5;
    ctx.beginPath();
    ctx.moveTo(4, -26); ctx.lineTo(11, -26); ctx.lineTo(13, -38); ctx.lineTo(6, -38);
    ctx.closePath(); ctx.fill(); ctx.stroke();
    // Cylinder cooling fins
    ctx.strokeStyle = '#2a2a2a'; ctx.lineWidth = 1;
    for (let i = 0; i < 5; i++) {
      const fy = -27 - i * 2.2;
      ctx.beginPath(); ctx.moveTo(3.5, fy); ctx.lineTo(12, fy - 2.2 * 0.8); ctx.stroke();
    }
    // Cylinder head
    ctx.fillStyle = '#181818'; ctx.strokeStyle = '#2a2a2a'; ctx.lineWidth = 1;
    ctx.beginPath(); ctx.rect(5, -38, 8, -5); ctx.fill(); ctx.stroke();
    // Power valve (orange accent)
    ctx.fillStyle = '#E05000';
    ctx.beginPath(); ctx.arc(5, -37, 2.8, 0, Math.PI*2); ctx.fill();
    // Radiator hose
    ctx.strokeStyle = '#184060'; ctx.lineWidth = 2.5;
    ctx.beginPath(); ctx.moveTo(13, -32); ctx.quadraticCurveTo(18, -30, 20, -28); ctx.stroke();
    // Radiator (right, blue-grey fins)
    ctx.fillStyle = '#1a3a5a'; ctx.strokeStyle = '#1e4a70'; ctx.lineWidth = 1;
    ctx.beginPath(); ctx.rect(18, -36, 5, 16); ctx.fill(); ctx.stroke();
    ctx.strokeStyle = '#1a4060'; ctx.lineWidth = 0.6;
    for (let i = 0; i < 6; i++) { ctx.beginPath(); ctx.moveTo(19, -35 + i * 2.4); ctx.lineTo(22, -35 + i * 2.4); ctx.stroke(); }
    // Sprocket/clutch cover (orange, left side)
    ctx.fillStyle = '#E05000'; ctx.strokeStyle = '#c04000'; ctx.lineWidth = 1;
    ctx.beginPath(); ctx.arc(-9, -13, 6.5, 0, Math.PI*2); ctx.fill(); ctx.stroke();
    ctx.fillStyle = '#cc3a00';
    ctx.beginPath(); ctx.arc(-9, -13, 4, 0, Math.PI*2); ctx.fill();
    // Kickstarter
    ctx.strokeStyle = '#484848'; ctx.lineWidth = 3; ctx.lineCap = 'round';
    ctx.beginPath(); ctx.moveTo(7, -10); ctx.lineTo(13, -4); ctx.stroke();
    // Footpeg bracket (orange anodised)
    ctx.fillStyle = '#E05000';
    ctx.beginPath(); ctx.rect(-5, -4, 6, 4); ctx.fill();
    ctx.fillStyle = '#c0c0c0'; // peg bar
    ctx.beginPath(); ctx.rect(-7, -2, 10, 2); ctx.fill();

    // === GAS TANK (white/off-white with orange graphics — KTM style) ===
    ctx.fillStyle = '#f2f2f2'; ctx.strokeStyle = '#cccccc'; ctx.lineWidth = 1.5;
    ctx.beginPath();
    ctx.moveTo(seatFX, seatFY);
    ctx.quadraticCurveTo(4, seatFY - 7, steerX, steerY + 3);
    ctx.lineTo(steerX - 3, steerY - 4);
    ctx.quadraticCurveTo(7, seatFY - 16, seatFX - 1, seatFY - 9);
    ctx.closePath(); ctx.fill(); ctx.stroke();
    // Orange side graphic
    ctx.fillStyle = '#E05000';
    ctx.beginPath();
    ctx.moveTo(seatFX + 1, seatFY - 1);
    ctx.quadraticCurveTo(8, seatFY - 6, 19, steerY + 6);
    ctx.lineTo(17, steerY + 10);
    ctx.quadraticCurveTo(6, seatFY - 3, seatFX + 1, seatFY + 3);
    ctx.closePath(); ctx.fill();
    // White highlight on tank top
    ctx.fillStyle = 'rgba(255,255,255,0.50)';
    ctx.beginPath(); ctx.ellipse(8, seatFY - 10, 6.5, 3, -0.3, 0, Math.PI*2); ctx.fill();
    // KTM number panel outline
    ctx.strokeStyle = 'rgba(255,255,255,0.55)'; ctx.lineWidth = 0.8;
    ctx.beginPath(); ctx.rect(3, seatFY - 8, 10, 6); ctx.stroke();

    // === SEAT ===
    ctx.fillStyle = '#111'; ctx.strokeStyle = '#222'; ctx.lineWidth = 1.5;
    ctx.beginPath();
    ctx.moveTo(seatRX, seatRY);
    ctx.lineTo(seatFX, seatFY);
    ctx.lineTo(seatFX, seatFY + 5);
    ctx.quadraticCurveTo(-12, seatRY + 8, seatRX, seatRY + 5);
    ctx.closePath(); ctx.fill(); ctx.stroke();
    // Grip texture
    ctx.strokeStyle = 'rgba(80,80,80,0.4)'; ctx.lineWidth = 0.8;
    ctx.setLineDash([2,3]);
    ctx.beginPath(); ctx.moveTo(seatRX + 3, seatRY + 2); ctx.lineTo(seatFX - 2, seatFY + 2); ctx.stroke();
    ctx.setLineDash([]);

    // === AIRBOX SIDE PANEL ===
    ctx.fillStyle = '#0d0d0d'; ctx.strokeStyle = '#1a1a1a'; ctx.lineWidth = 1;
    ctx.beginPath();
    ctx.moveTo(seatRX + 5, seatRY + 3);
    ctx.lineTo(-13, seatRY + 5);
    ctx.lineTo(-13, swPivY + 5);
    ctx.lineTo(seatRX + 8, swPivY + 3);
    ctx.closePath(); ctx.fill(); ctx.stroke();
    // Vent slots
    ctx.strokeStyle = '#282828'; ctx.lineWidth = 1;
    for (let i = 0; i < 4; i++) {
      ctx.beginPath(); ctx.moveTo(-19 + i * 2, seatRY + 6); ctx.lineTo(-19 + i * 2, swPivY + 7); ctx.stroke();
    }

    // === REAR FENDER (white with orange stripe) ===
    ctx.strokeStyle = '#efefef'; ctx.lineWidth = 5; ctx.lineCap = 'round';
    ctx.beginPath();
    ctx.moveTo(seatRX, seatRY + 1);
    ctx.quadraticCurveTo(rX - 5, seatRY + 7, rX - 2, seatRY + 18);
    ctx.stroke();
    ctx.strokeStyle = '#E05000'; ctx.lineWidth = 2;
    ctx.beginPath();
    ctx.moveTo(seatRX - 1, seatRY + 2);
    ctx.quadraticCurveTo(rX - 6, seatRY + 9, rX - 3, seatRY + 18);
    ctx.stroke();

    // === FRONT FORKS (USD — upside-down) ===
    // Triple clamp
    ctx.fillStyle = '#2e2e2e'; ctx.strokeStyle = '#404040'; ctx.lineWidth = 1.5;
    ctx.beginPath(); ctx.rect(steerX - 5, steerY - 2, 10, 6); ctx.fill(); ctx.stroke();
    // Upper fork tubes (chrome, narrower)
    ctx.strokeStyle = '#d8d8d8'; ctx.lineWidth = 3.5; ctx.lineCap = 'round';
    ctx.beginPath(); ctx.moveTo(steerX - 3, steerY + 4); ctx.lineTo(fX - 4, -10); ctx.stroke();
    ctx.beginPath(); ctx.moveTo(steerX + 3, steerY + 4); ctx.lineTo(fX + 4, -10); ctx.stroke();
    // Lower fork legs (wider, USD style)
    ctx.strokeStyle = '#b0b0b0'; ctx.lineWidth = 6;
    ctx.beginPath(); ctx.moveTo(fX - 4, -10); ctx.lineTo(fX - 4, -1); ctx.stroke();
    ctx.beginPath(); ctx.moveTo(fX + 4, -10); ctx.lineTo(fX + 4, -1); ctx.stroke();
    // Fork brace
    ctx.strokeStyle = '#909090'; ctx.lineWidth = 4; ctx.lineCap = 'round';
    ctx.beginPath(); ctx.moveTo(fX - 6, -10); ctx.lineTo(fX + 6, -10); ctx.stroke();
    // Brake caliper
    ctx.fillStyle = '#E05000';
    ctx.beginPath(); ctx.rect(fX + 5, -8, 5, 9); ctx.fill();
    // Brake disc (partial arc)
    ctx.strokeStyle = '#585858'; ctx.lineWidth = 2;
    ctx.beginPath(); ctx.arc(fX, 0, fWR - 4, -Math.PI * 0.5, Math.PI * 0.35); ctx.stroke();

    // === FRONT FENDER (white, high-mounted) ===
    ctx.strokeStyle = '#eeeeee'; ctx.lineWidth = 4.5; ctx.lineCap = 'round';
    ctx.beginPath();
    ctx.moveTo(fX - 2, -10);
    ctx.quadraticCurveTo(fX - 11, -fWR - 2, fX - 7, -fWR - 16);
    ctx.stroke();
    ctx.strokeStyle = '#E05000'; ctx.lineWidth = 2;
    ctx.beginPath();
    ctx.moveTo(fX - 3, -10);
    ctx.quadraticCurveTo(fX - 10, -fWR - 1, fX - 6, -fWR - 14);
    ctx.stroke();

    // === HEADLIGHT (modern rectangular LED) ===
    // Surround (orange)
    ctx.fillStyle = '#E05000'; ctx.strokeStyle = '#c04000'; ctx.lineWidth = 1;
    ctx.beginPath();
    if (ctx.roundRect) { ctx.roundRect(fX - 12, -26, 17, 12, 3); }
    else { ctx.rect(fX - 12, -26, 17, 12); }
    ctx.fill(); ctx.stroke();
    // Lens
    ctx.fillStyle = '#ffee80';
    ctx.beginPath(); ctx.rect(fX - 10, -24, 13, 8); ctx.fill();
    // LED strips
    ctx.fillStyle = 'rgba(255,250,200,0.9)';
    ctx.beginPath(); ctx.rect(fX - 9, -23, 11, 2); ctx.fill();
    ctx.beginPath(); ctx.rect(fX - 9, -19, 11, 1.5); ctx.fill();
    // DRL glow
    ctx.fillStyle = 'rgba(255,255,180,0.4)';
    ctx.beginPath(); ctx.ellipse(fX - 3, -20, 9, 5, 0, 0, Math.PI*2); ctx.fill();

    // === NUMBER PLATE ===
    ctx.fillStyle = '#fff'; ctx.strokeStyle = '#ddd'; ctx.lineWidth = 1;
    ctx.beginPath(); ctx.rect(fX - 18, -25, 12, 9); ctx.fill(); ctx.stroke();
    ctx.fillStyle = '#cc0000'; ctx.font = 'bold 6.5px sans-serif'; ctx.textAlign = 'center';
    ctx.fillText('42', fX - 12, -18);
    ctx.textAlign = 'left';

    // === HANDLEBARS (wide MX bars) ===
    // Bar pad (orange foam)
    ctx.fillStyle = '#E05000';
    ctx.beginPath(); ctx.ellipse(steerX, steerY - 9, 9, 3.8, 0, 0, Math.PI*2); ctx.fill();
    // Left bar (to rider)
    ctx.strokeStyle = '#181818'; ctx.lineWidth = 4.5; ctx.lineCap = 'round';
    ctx.beginPath(); ctx.moveTo(steerX - 8, steerY - 9); ctx.lineTo(steerX - 20, steerY - 6); ctx.stroke();
    // Right bar (forward)
    ctx.beginPath(); ctx.moveTo(steerX + 8, steerY - 9); ctx.lineTo(steerX + 20, steerY - 5); ctx.stroke();
    // Clutch lever
    ctx.strokeStyle = '#555'; ctx.lineWidth = 2;
    ctx.beginPath(); ctx.moveTo(steerX - 19, steerY - 6); ctx.lineTo(steerX - 25, steerY - 2); ctx.stroke();
    // Brake lever
    ctx.beginPath(); ctx.moveTo(steerX + 19, steerY - 5); ctx.lineTo(steerX + 25, steerY - 1); ctx.stroke();
    // Grip ends
    ctx.fillStyle = '#0d0d0d';
    ctx.beginPath(); ctx.arc(steerX - 20, steerY - 6, 2.8, 0, Math.PI*2); ctx.fill();
    ctx.beginPath(); ctx.arc(steerX + 20, steerY - 5, 2.8, 0, Math.PI*2); ctx.fill();

    // === FRONT WHEEL ===
    drawWheel(fX, 0, fWR, '#aaaaaa');

    // === RIDER ===
    drawRider(steerX, steerY);

    // === JET FLAME ===
    if ((keys['j'] || keys['J'] || touchKeys.jet) && fuelLevel > 0) {
      const cX = rX - 2, cY = -14;
      ctx.globalAlpha = 0.9;
      ctx.fillStyle = '#ff6a00';
      ctx.beginPath(); ctx.moveTo(cX, cY); ctx.lineTo(cX - 10, cY + 20); ctx.lineTo(cX + 10, cY + 20); ctx.closePath(); ctx.fill();
      ctx.fillStyle = '#ffd36b';
      ctx.beginPath(); ctx.arc(cX, cY + 10, 6, 0, Math.PI*2); ctx.fill();
      ctx.globalAlpha = 1;
    }

    ctx.restore();
  }

  // --- Dust Particles ---
  function spawnDust(x, y, count) {
    const zone = getZoneAt(x);
    const dustCol = zone < 0.8 ? '#c8a06a' : zone < 1.5 ? '#b09060' : '#d4a855';
    for (let i = 0; i < count; i++) {
      dustParticles.push({
        x: x + (Math.random() - 0.5) * 12, y,
        vx: (Math.random() - 0.65) * 2.5,
        vy: -(Math.random() * 2 + 0.3),
        life: 22 + Math.floor(Math.random() * 16),
        maxLife: 38,
        size: 2.5 + Math.random() * 4.5,
        col: dustCol
      });
    }
  }

  function updateAndDrawDust() {
    ctx.save();
    for (let i = dustParticles.length - 1; i >= 0; i--) {
      const p = dustParticles[i];
      p.life--;
      if (p.life <= 0) { dustParticles.splice(i, 1); continue; }
      p.x += p.vx; p.y += p.vy; p.vy += 0.06; p.vx *= 0.95;
      const t = p.life / p.maxLife;
      ctx.globalAlpha = t * 0.45;
      ctx.fillStyle = p.col || '#c8a06a';
      ctx.beginPath(); ctx.arc(p.x - cameraX, p.y, p.size * t, 0, Math.PI*2); ctx.fill();
    }
    ctx.restore();
  }

  // --- Bike Physics ---
  function initBike() {
    const g = getGroundAt(0);
    bike = { x: 80, y: g.y - BIKE_HEIGHT / 2 - WHEEL_R, vx: 0, vy: 0, angle: g.slope * 0.6, angleSpeed: 0 };
    airborneFrames = 0; airborneRotation = 0; visualTilt = 0;
  }

  function getWheelPositions() {
    const cos = Math.cos(bike.angle), sin = Math.sin(bike.angle), half = BIKE_LENGTH / 2;
    return {
      back:  { x: bike.x - cos * half, y: bike.y + sin * half },
      front: { x: bike.x + cos * half, y: bike.y - sin * half }
    };
  }

  function updateBike(throttle, tilt, jetActive) {
    if (!bike) return false;
    extendTerrain();
    visualTilt += (tilt * 0.18 - visualTilt) * 0.12;
    bike.vx *= FRICTION_AIR; bike.vy *= FRICTION_AIR;
    if (throttle) bike.vx += THROTTLE;
    const jetOn = jetActive && fuelLevel > 0;
    if (jetOn) { bike.vx += JET_THRUST; fuelLevel = Math.max(0, fuelLevel - FUEL_DRAIN); }
    if (bike.vx > JET_MAX_VX) bike.vx = JET_MAX_VX;
    bike.vy += GRAVITY; bike.x += bike.vx; bike.y += bike.vy;
    bike.angleSpeed *= 0.98;
    bike.angleSpeed += tilt * ANGULAR_ACCEL;
    bike.angleSpeed = Math.max(-MAX_ANGLE_SPEED, Math.min(MAX_ANGLE_SPEED, bike.angleSpeed));
    bike.angle += bike.angleSpeed;

    // Jet particles
    if (jetOn) {
      for (let i = 0; i < 4; i++) {
        if (jetParticles.length >= JET_PARTICLES_MAX) break;
        const life = JET_PARTICLE_LIFE_MIN + Math.floor(Math.random() * (JET_PARTICLE_LIFE_MAX - JET_PARTICLE_LIFE_MIN + 1));
        const cr = Math.random();
        jetParticles.push({
          x: -BIKE_LENGTH / 2 - 8 + (Math.random() - 0.5) * 3,
          y: -8 + (Math.random() - 0.5) * 3,
          vx: -(1.8 + Math.random() * 3.2), vy: (Math.random() - 0.5) * 1.2 - 0.2,
          size: 3 + Math.random() * 4, life, maxLife: life, alpha: 1,
          color: cr > 0.7 ? '#ff4d00' : cr > 0.35 ? '#ff9b2f' : '#ffd36b'
        });
      }
    }
    for (let i = jetParticles.length - 1; i >= 0; i--) {
      const p = jetParticles[i];
      p.life--; p.x += p.vx; p.y += p.vy; p.vy += JET_PARTICLE_GRAVITY;
      p.alpha = Math.max(0, p.life / p.maxLife);
      if (p.life <= 0) jetParticles.splice(i, 1);
    }

    const { back, front } = getWheelPositions();
    const gBack = getGroundAt(back.x), gFront = getGroundAt(front.x);
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
      const landX = (back.x + front.x) / 2;
      spawnDust(landX, getGroundAt(landX).y, Math.floor(impact * 10 + 3));
      audio.land(impact);
      if (airborneFrames > 18 && Math.abs(airborneRotation) >= FLIP_THRESHOLD) {
        const flips = Math.floor(Math.abs(airborneRotation) / (Math.PI * 2) + 0.35);
        const name = (flips >= 2 ? flips + 'x ' : '') + (airborneRotation > 0 ? 'Backflip' : 'Frontflip') + '!';
        const bonus = flips * 120;
        trickText = name + ' +' + bonus + 'm'; trickTimer = 130; totalTrickBonus += bonus;
        audio.trick();
      }
      airborneFrames = 0; airborneRotation = 0;
    }

    if (!onGroundNow) {
      airborneFrames++; airborneRotation += bike.angleSpeed;
      fuelLevel = Math.min(MAX_FUEL, fuelLevel + FUEL_REGEN_AIR);
    } else {
      fuelLevel = Math.min(MAX_FUEL, fuelLevel + FUEL_REGEN_GROUND);
      if (speed > 5 && Math.random() < 0.25) spawnDust(back.x, gBack.y, 1);
    }

    if (wasOnGroundPrev && !onGroundNow && speed > 3) {
      bike.vy -= Math.min(10, (speed - 3) * 0.35) * (jetOn ? 1.25 : 1.0);
    }
    wasOnGround = onGroundNow;

    const k = onGroundNow ? 0.22 : 0.08, d = onGroundNow ? 0.82 : 0.35;
    suspensionVel += -k * suspensionPos - d * suspensionVel;
    suspensionPos += suspensionVel;
    suspensionPos = Math.max(-2, Math.min(12, suspensionPos));

    if (onGroundBack && onGroundFront) {
      const slope = (gFront.y - gBack.y) / (front.x - back.x);
      bike.angle = bike.angle * 0.6 + Math.atan(slope) * 0.4;
      bike.angleSpeed *= 0.7;
      bike.y = bike.y * 0.3 + ((gBack.y + gFront.y) / 2 - BIKE_HEIGHT / 2) * 0.7;
      bike.vy = 0; bike.vx *= FRICTION_GROUND;
    } else if (onGroundBack || onGroundFront) {
      const g = onGroundBack ? gBack : gFront;
      if (Math.abs(bike.angle) > 1.2) return true;
      bike.angle = bike.angle * 0.85 + Math.atan(g.slope) * 0.15;
      bike.y = g.y - BIKE_HEIGHT / 2;
      bike.vy *= 0.5; bike.vx *= FRICTION_GROUND;
    }

    if (bike.y > H + 50) return true;
    if (Math.abs(bike.angle) > Math.PI * 0.85) return true;
    if (back.y > getGroundAt(back.x).y + 18 || front.y > getGroundAt(front.x).y + 18) return true;
    return false;
  }

  // --- Trick Text ---
  function drawTrickText() {
    if (trickTimer <= 0) return;
    trickTimer--;
    const alpha = Math.min(1, trickTimer / 25);
    const scale = trickTimer > 105 ? 1 + (130 - trickTimer) * 0.025 : 1;
    ctx.save();
    ctx.globalAlpha = alpha;
    ctx.translate(W / 2, H / 2 - 70);
    ctx.scale(scale, scale);
    ctx.font = 'bold 28px sans-serif'; ctx.textAlign = 'center';
    ctx.strokeStyle = 'rgba(0,0,0,0.8)'; ctx.lineWidth = 5;
    ctx.strokeText(trickText, 0, 0);
    ctx.fillStyle = '#FFD700'; ctx.fillText(trickText, 0, 0);
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
    running = false; audio.stopEngine(); audio.crash();
    const finalScore = Math.floor(score);
    if (finalScore > highScore) { highScore = finalScore; localStorage.setItem('motoHighScore', highScore); }
    overlay.classList.remove('hidden');
    overlayText.innerHTML = 'Wiped out!<br><strong style="font-size:1.4rem">' + finalScore + ' m</strong><br><small style="color:#aaa">Best: ' + highScore + ' m</small>';
    restartBtn.style.display = 'block';
  }

  // --- Input ---
  const keys = {};
  const touchKeys = { gas: false, leanBack: false, leanFwd: false, jet: false };

  document.addEventListener('keydown', function (e) {
    if ([' ','ArrowUp','ArrowDown','ArrowLeft','ArrowRight'].includes(e.key)) e.preventDefault();
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
      btn.addEventListener('mousedown', () => { touchKeys[action] = true; });
      btn.addEventListener('mouseup', () => { touchKeys[action] = false; });
      btn.addEventListener('mouseleave', () => { touchKeys[action] = false; });
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
    cameraX = Math.max(0, bike.x - CAMERA_LEAD);

    drawSky();
    drawSun();
    drawMesas();
    drawClouds();
    drawScenery();
    drawTerrain();
    updateAndDrawDust();
    drawBike();
    drawTrickText();

    if (crashed) { gameOver(); return; }
    requestAnimationFrame(loop);
  }

  // --- Start / Init ---
  function startGame() {
    seed = Date.now() % 100000; baseSeed = seed;
    decorations = []; nextDecoX = -200;
    jetParticles = []; dustParticles = [];
    suspensionPos = 0; suspensionVel = 0; wasOnGround = false;
    fuelLevel = MAX_FUEL; totalTrickBonus = 0; trickText = ''; trickTimer = 0;
    airborneFrames = 0; airborneRotation = 0; visualTilt = 0;
    initClouds(); initTerrain(); initBike();
    score = 0; scoreEl.textContent = '0';
    if (highScoreEl) highScoreEl.textContent = highScore;
    running = true;
    overlay.classList.add('hidden');
    restartBtn.style.display = 'none';
    audio.startEngine();
    loop();
  }

  function init() {
    seed = Date.now() % 100000; baseSeed = seed;
    decorations = []; nextDecoX = -200;
    jetParticles = []; dustParticles = [];
    fuelLevel = MAX_FUEL;
    initClouds(); initTerrain(); initBike();
    cameraX = 0;
    drawSky(); drawSun(); drawMesas(); drawClouds(); drawScenery(); drawTerrain(); drawBike();
    if (highScoreEl) highScoreEl.textContent = highScore;
    setupTouchControls();
  }

  overlay.addEventListener('click', function () { if (!running) startGame(); });
  restartBtn.addEventListener('click', function (e) { e.stopPropagation(); startGame(); });

  init();
  overlay.classList.remove('hidden');
}());
