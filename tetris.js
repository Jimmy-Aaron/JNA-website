(function () {
  const canvas = document.getElementById('tetrisCanvas');
  const ctx = canvas.getContext('2d');
  const overlay = document.getElementById('tetrisOverlay');
  const overlayText = document.getElementById('tetrisOverlayText');
  const restartBtn = document.getElementById('tetrisRestartBtn');
  const scoreEl = document.getElementById('tetrisScore');
  const levelEl = document.getElementById('tetrisLevel');
  const linesEl = document.getElementById('tetrisLines');
  const nextCanvas = document.getElementById('tetrisNextCanvas');
  const nextCtx = nextCanvas.getContext('2d');
  const holdCanvas = document.getElementById('tetrisHoldCanvas');
  const holdCtx = holdCanvas.getContext('2d');

  const COLS = 10;
  const ROWS = 20;
  const BLOCK_SIZE = 24;
  const BORDER = 2;
  const PREVIEW_BLOCK = 14;

  const COLORS = {
    I: '#00f0f0',
    O: '#f0f000',
    T: '#a000f0',
    S: '#00f000',
    Z: '#f00000',
    J: '#0000f0',
    L: '#f0a000',
    empty: '#0d0d0d',
    ghost: 'rgba(255,255,255,0.2)',
    grid: 'rgba(255,255,255,0.06)'
  };

  const SHAPES = {
    I: [
      [[0, 0], [1, 0], [2, 0], [3, 0]],
      [[1, 0], [1, 1], [1, 2], [1, 3]],
      [[0, 1], [1, 1], [2, 1], [3, 1]],
      [[0, 0], [0, 1], [0, 2], [0, 3]]
    ],
    O: [
      [[0, 0], [1, 0], [0, 1], [1, 1]]
    ],
    T: [
      [[1, 0], [0, 1], [1, 1], [2, 1]],
      [[1, 0], [1, 1], [1, 2], [2, 1]],
      [[0, 1], [1, 1], [2, 1], [1, 2]],
      [[1, 0], [0, 1], [1, 1], [1, 2]]
    ],
    S: [
      [[1, 0], [2, 0], [0, 1], [1, 1]],
      [[1, 0], [1, 1], [1, 2], [2, 2]]
    ],
    Z: [
      [[0, 0], [1, 0], [1, 1], [2, 1]],
      [[2, 0], [1, 1], [2, 1], [1, 2]]
    ],
    J: [
      [[0, 0], [0, 1], [1, 1], [2, 1]],
      [[1, 0], [2, 0], [1, 1], [1, 2]],
      [[0, 1], [1, 1], [2, 1], [2, 2]],
      [[1, 0], [1, 1], [0, 2], [1, 2]]
    ],
    L: [
      [[2, 0], [0, 1], [1, 1], [2, 1]],
      [[1, 0], [1, 1], [1, 2], [2, 2]],
      [[0, 1], [1, 1], [2, 1], [0, 2]],
      [[0, 0], [1, 0], [1, 1], [1, 2]]
    ]
  };

  const PIECE_NAMES = ['I', 'O', 'T', 'S', 'Z', 'J', 'L'];
  const LINE_SCORES = [0, 100, 300, 500, 800];
  const LINES_PER_LEVEL = 10;
  const BASE_FALL_MS = 1000;
  const MIN_FALL_MS = 80;

  let grid;
  let currentPiece;
  let nextPieceType;
  let holdPieceType;
  let canHold;
  let score;
  let level;
  let lines;
  let running;
  let dropIntervalId;
  let lastDrop;
  let lockDelayRemaining;
  let lockDelayMs = 500;
  let movedSinceDrop;

  const canvasWidth = COLS * BLOCK_SIZE + BORDER * 2;
  const canvasHeight = ROWS * BLOCK_SIZE + BORDER * 2;

  function getShape(type, rot) {
    const s = SHAPES[type];
    return s[rot % s.length];
  }

  function randomPiece() {
    return PIECE_NAMES[Math.floor(Math.random() * PIECE_NAMES.length)];
  }

  function createPiece(type, rot, x, y) {
    return { type, rot: rot || 0, x: x ?? Math.floor(COLS / 2) - 2, y: y ?? 0 };
  }

  function getBlocks(piece) {
    const shape = getShape(piece.type, piece.rot);
    return shape.map(([dx, dy]) => [piece.x + dx, piece.y + dy]);
  }

  function collides(piece, offX = 0, offY = 0) {
    const blocks = getBlocks(piece);
    for (const [bx, by] of blocks) {
      const nx = bx + offX;
      const ny = by + offY;
      if (nx < 0 || nx >= COLS || ny >= ROWS) return true;
      if (ny >= 0 && grid[ny][nx]) return true;
    }
    return false;
  }

  function getGhostY(piece) {
    let y = piece.y;
    while (!collides(piece, 0, 1)) {
      piece = { ...piece, y: piece.y + 1 };
      y = piece.y;
    }
    return y;
  }

  function mergePiece(piece) {
    const blocks = getBlocks(piece);
    const color = COLORS[piece.type];
    for (const [bx, by] of blocks) {
      if (by >= 0) grid[by][bx] = color;
    }
  }

  function clearLines() {
    let cleared = 0;
    for (let row = ROWS - 1; row >= 0; row--) {
      if (grid[row].every(c => c)) {
        grid.splice(row, 1);
        grid.unshift(Array(COLS).fill(null));
        cleared++;
        row++;
      }
    }
    return cleared;
  }

  function addScore(linesCleared) {
    if (linesCleared <= 0) return;
    const points = LINE_SCORES[linesCleared] * (level + 1);
    score += points;
    lines += linesCleared;
    const prevLevel = level;
    level = Math.floor(lines / LINES_PER_LEVEL);
    if (level > prevLevel) {
      if (window.TetrisAudio) TetrisAudio.play('levelup');
      if (dropIntervalId) {
        clearInterval(dropIntervalId);
        scheduleDrop();
      }
    }
    scoreEl.textContent = score;
    levelEl.textContent = level + 1;
    linesEl.textContent = lines;
  }

  function spawnNext() {
    const type = nextPieceType;
    nextPieceType = randomPiece();
    drawNext();
    currentPiece = createPiece(type, 0);
    canHold = true;
    if (collides(currentPiece)) {
      endGame();
      return;
    }
    lockDelayRemaining = lockDelayMs;
    movedSinceDrop = false;
  }

  function scheduleDrop() {
    const ms = Math.max(MIN_FALL_MS, BASE_FALL_MS - level * 80);
    dropIntervalId = setInterval(doDrop, ms);
    lastDrop = Date.now();
  }

  function doDrop() {
    if (!running || !currentPiece) return;
    if (collides(currentPiece, 0, 1)) {
      lockDelayRemaining -= Date.now() - (lastDrop || Date.now());
      lastDrop = Date.now();
      if (lockDelayRemaining <= 0 || !movedSinceDrop) {
        lockPiece();
      }
      return;
    }
    currentPiece.y++;
    movedSinceDrop = true;
    lockDelayRemaining = lockDelayMs;
    lastDrop = Date.now();
  }

  function lockPiece() {
    if (!currentPiece) return;
    if (window.TetrisAudio) TetrisAudio.play('lock');
    mergePiece(currentPiece);
    const cleared = clearLines();
    if (cleared > 0 && window.TetrisAudio) TetrisAudio.play('lineclear', cleared);
    addScore(cleared);
    currentPiece = null;
    spawnNext();
  }

  function hardDrop() {
    if (!running || !currentPiece) return;
    const ghostY = getGhostY({ ...currentPiece });
    score += (ghostY - currentPiece.y) * 2 * (level + 1);
    scoreEl.textContent = score;
    currentPiece.y = ghostY;
    lockPiece();
  }

  function move(dx) {
    if (!currentPiece || collides(currentPiece, dx, 0)) return;
    currentPiece.x += dx;
    movedSinceDrop = true;
    lockDelayRemaining = lockDelayMs;
  }

  function rotate(dir) {
    if (!currentPiece) return;
    const s = SHAPES[currentPiece.type];
    const nextRot = (currentPiece.rot + dir + s.length) % s.length;
    const next = { ...currentPiece, rot: nextRot };
    const kicks = [0, -1, 1, -2, 2];
    for (const k of kicks) {
      next.x = currentPiece.x + k;
      if (!collides(next)) {
        currentPiece.rot = nextRot;
        currentPiece.x = next.x;
        movedSinceDrop = true;
        lockDelayRemaining = lockDelayMs;
        return;
      }
    }
  }

  function hold() {
    if (!canHold || !currentPiece) return;
    const type = currentPiece.type;
    if (holdPieceType == null) {
      holdPieceType = type;
      drawHold();
      currentPiece = null;
      spawnNext();
    } else {
      const prevHold = holdPieceType;
      holdPieceType = type;
      drawHold();
      currentPiece = createPiece(prevHold, 0);
      if (collides(currentPiece)) endGame();
    }
    canHold = false;
  }

  function drawBlock(cx, cy, size, color, isGhost) {
    const x = BORDER + cx * size;
    const y = BORDER + cy * size;
    if (isGhost) {
      ctx.fillStyle = COLORS.ghost;
      ctx.fillRect(x + 1, y + 1, size - 2, size - 2);
      ctx.strokeStyle = 'rgba(255,255,255,0.35)';
      ctx.strokeRect(x + 1, y + 1, size - 2, size - 2);
      return;
    }
    ctx.fillStyle = color;
    ctx.fillRect(x, y, size, size);
    ctx.fillStyle = 'rgba(255,255,255,0.25)';
    ctx.fillRect(x, y, size, 2);
    ctx.fillRect(x, y, 2, size);
    ctx.fillStyle = 'rgba(0,0,0,0.25)';
    ctx.fillRect(x + size - 2, y, 2, size);
    ctx.fillRect(x, y + size - 2, size, 2);
  }

  function drawGridOnly() {
    ctx.fillStyle = '#0d0d0d';
    ctx.fillRect(0, 0, canvasWidth, canvasHeight);
    ctx.strokeStyle = '#1a1a1a';
    ctx.lineWidth = BORDER;
    ctx.strokeRect(0, 0, canvasWidth, canvasHeight);
    ctx.strokeStyle = COLORS.grid;
    ctx.lineWidth = 1;
    for (let c = 0; c <= COLS; c++) {
      ctx.beginPath();
      ctx.moveTo(BORDER + c * BLOCK_SIZE, BORDER);
      ctx.lineTo(BORDER + c * BLOCK_SIZE, BORDER + ROWS * BLOCK_SIZE);
      ctx.stroke();
    }
    for (let r = 0; r <= ROWS; r++) {
      ctx.beginPath();
      ctx.moveTo(BORDER, BORDER + r * BLOCK_SIZE);
      ctx.lineTo(BORDER + COLS * BLOCK_SIZE, BORDER + r * BLOCK_SIZE);
      ctx.stroke();
    }
  }

  function drawBoard() {
    drawGridOnly();
    for (let row = 0; row < ROWS; row++) {
      for (let col = 0; col < COLS; col++) {
        if (grid[row][col]) drawBlock(col, row, BLOCK_SIZE, grid[row][col], false);
      }
    }
    if (currentPiece) {
      const ghostY = getGhostY({ ...currentPiece });
      const blocks = getBlocks({ ...currentPiece, y: ghostY });
      for (const [bx, by] of blocks) {
        if (by >= 0) drawBlock(bx, by, BLOCK_SIZE, null, true);
      }
      const currBlocks = getBlocks(currentPiece);
      const color = COLORS[currentPiece.type];
      for (const [bx, by] of currBlocks) {
        if (by >= 0) drawBlock(bx, by, BLOCK_SIZE, color, false);
      }
    }
  }

  function drawNext() {
    nextCtx.fillStyle = '#0d0d0d';
    nextCtx.fillRect(0, 0, nextCanvas.width, nextCanvas.height);
    if (!nextPieceType) return;
    const shape = getShape(nextPieceType, 0);
    const color = COLORS[nextPieceType];
    const pad = nextPieceType === 'I' ? 0.5 : 1;
    shape.forEach(([dx, dy]) => {
      nextCtx.fillStyle = color;
      nextCtx.fillRect((dx + pad) * PREVIEW_BLOCK, (dy + 1) * PREVIEW_BLOCK, PREVIEW_BLOCK - 1, PREVIEW_BLOCK - 1);
    });
  }

  function drawHold() {
    holdCtx.fillStyle = '#0d0d0d';
    holdCtx.fillRect(0, 0, holdCanvas.width, holdCanvas.height);
    if (!holdPieceType) return;
    const shape = getShape(holdPieceType, 0);
    const color = COLORS[holdPieceType];
    const pad = holdPieceType === 'I' ? 0.5 : 1;
    shape.forEach(([dx, dy]) => {
      holdCtx.fillStyle = color;
      holdCtx.fillRect((dx + pad) * PREVIEW_BLOCK, (dy + 1) * PREVIEW_BLOCK, PREVIEW_BLOCK - 1, PREVIEW_BLOCK - 1);
    });
  }

  function gameLoop() {
    if (!running) return;
    drawBoard();
    requestAnimationFrame(gameLoop);
  }

  function init() {
    grid = Array(ROWS).fill(null).map(() => Array(COLS).fill(null));
    nextPieceType = randomPiece();
    holdPieceType = null;
    canHold = true;
    score = 0;
    level = 0;
    lines = 0;
    scoreEl.textContent = '0';
    levelEl.textContent = '1';
    linesEl.textContent = '0';
    drawNext();
    drawHold();
  }

  function startGame() {
    init();
    running = true;
    overlay.classList.add('hidden');
    restartBtn.style.display = 'none';
    if (window.TetrisAudio) {
      TetrisAudio.init();
      TetrisAudio.startMusic();
    }
    spawnNext();
    scheduleDrop();
    gameLoop();
  }

  function endGame() {
    running = false;
    if (dropIntervalId) {
      clearInterval(dropIntervalId);
      dropIntervalId = null;
    }
    if (window.TetrisAudio) {
      TetrisAudio.stopMusic();
      TetrisAudio.play('gameover');
    }
    overlay.classList.remove('hidden');
    overlayText.textContent = 'Game over! Score: ' + score;
    restartBtn.style.display = 'block';
  }

  document.addEventListener('keydown', function (e) {
    if (!running) {
      if (e.key === ' ') {
        e.preventDefault();
        startGame();
      }
      return;
    }
    switch (e.key) {
      case 'ArrowLeft':
        e.preventDefault();
        move(-1);
        break;
      case 'ArrowRight':
        e.preventDefault();
        move(1);
        break;
      case 'ArrowDown':
        e.preventDefault();
        doDrop();
        score += 1 * (level + 1);
        scoreEl.textContent = score;
        break;
      case 'ArrowUp':
      case 'x':
        e.preventDefault();
        rotate(1);
        break;
      case 'Control':
      case 'z':
        e.preventDefault();
        rotate(-1);
        break;
      case ' ':
        e.preventDefault();
        hardDrop();
        break;
      case 'c':
      case 'C':
        e.preventDefault();
        hold();
        break;
      default:
        break;
    }
  });

  overlay.addEventListener('click', () => {
    if (!running) startGame();
  });
  restartBtn.addEventListener('click', (e) => {
    e.stopPropagation();
    startGame();
  });

  canvas.width = canvasWidth;
  canvas.height = canvasHeight;
  nextCanvas.width = PREVIEW_BLOCK * 5;
  nextCanvas.height = PREVIEW_BLOCK * 5;
  holdCanvas.width = PREVIEW_BLOCK * 5;
  holdCanvas.height = PREVIEW_BLOCK * 5;

  init();
  drawBoard();
  drawNext();
  drawHold();
  overlay.classList.remove('hidden');
})();
