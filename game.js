(function () {
  const canvas = document.getElementById('gameCanvas');
  const ctx = canvas.getContext('2d');
  const overlay = document.getElementById('gameOverlay');
  const overlayText = document.getElementById('overlayText');
  const restartBtn = document.getElementById('restartBtn');
  const scoreEl = document.getElementById('score');
  const livesEl = document.getElementById('lives');

  const PADDLE_WIDTH = 100;
  const PADDLE_HEIGHT = 14;
  const BALL_RADIUS = 8;
  const BRICK_COLS = 12;
  const BRICK_ROWS = 6;
  const BRICK_PADDING = 4;
  const BRICK_OFFSET_TOP = 60;
  const BRICK_OFFSET_LEFT = 20;

  let paddleX;
  let ballX, ballY, ballDx, ballDy;
  let bricks = [];
  let score = 0;
  let lives = 3;
  let running = false;
  let animationId;
  let paddleDir = 0;

  const BRICK_COLORS = ['#e74c3c', '#e67e22', '#f1c40f', '#2ecc71', '#3498db', '#9b59b6'];

  function getBrickWidth() {
    return (canvas.width - BRICK_OFFSET_LEFT * 2 - (BRICK_COLS - 1) * BRICK_PADDING) / BRICK_COLS;
  }

  function getBrickHeight() {
    return 22;
  }

  function initBricks() {
    const bw = getBrickWidth();
    const bh = getBrickHeight();
    bricks = [];
    for (let row = 0; row < BRICK_ROWS; row++) {
      for (let col = 0; col < BRICK_COLS; col++) {
        bricks.push({
          x: BRICK_OFFSET_LEFT + col * (bw + BRICK_PADDING),
          y: BRICK_OFFSET_TOP + row * (bh + BRICK_PADDING),
          w: bw,
          h: bh,
          color: BRICK_COLORS[row % BRICK_COLORS.length],
          alive: true
        });
      }
    }
  }

  function resetBall() {
    ballX = canvas.width / 2;
    ballY = canvas.height - PADDLE_HEIGHT - 50;
    ballDx = 4;
    ballDy = -4;
  }

  function init() {
    paddleX = (canvas.width - PADDLE_WIDTH) / 2;
    score = 0;
    lives = 3;
    initBricks();
    resetBall();
    scoreEl.textContent = '0';
    livesEl.textContent = '3';
  }

  function drawPaddle() {
    ctx.fillStyle = '#e0e0e0';
    ctx.beginPath();
    const y = canvas.height - PADDLE_HEIGHT - 10;
    ctx.roundRect(paddleX, y, PADDLE_WIDTH, PADDLE_HEIGHT, 6);
    ctx.fill();
  }

  function drawBall() {
    ctx.fillStyle = '#fff';
    ctx.beginPath();
    ctx.arc(ballX, ballY, BALL_RADIUS, 0, Math.PI * 2);
    ctx.fill();
  }

  function drawBricks() {
    bricks.forEach(function (b) {
    if (!b.alive) return;
      ctx.fillStyle = b.color;
      ctx.strokeStyle = 'rgba(0,0,0,0.2)';
      ctx.lineWidth = 1;
      ctx.beginPath();
      ctx.roundRect(b.x, b.y, b.w, b.h, 2);
      ctx.fill();
      ctx.stroke();
    });
  }

  function movePaddle() {
    const speed = 8;
    paddleX += paddleDir * speed;
    if (paddleX < 0) paddleX = 0;
    if (paddleX > canvas.width - PADDLE_WIDTH) paddleX = canvas.width - PADDLE_WIDTH;
  }

  function moveBall() {
    ballX += ballDx;
    ballY += ballDy;

    const paddleY = canvas.height - PADDLE_HEIGHT - 10;

    if (ballX - BALL_RADIUS <= 0 || ballX + BALL_RADIUS >= canvas.width) ballDx = -ballDx;
    if (ballY - BALL_RADIUS <= 0) ballDy = -ballDy;

    if (ballY + BALL_RADIUS >= paddleY && ballY - BALL_RADIUS <= paddleY + PADDLE_HEIGHT &&
        ballX >= paddleX && ballX <= paddleX + PADDLE_WIDTH) {
      const hitPos = (ballX - paddleX) / PADDLE_WIDTH;
      ballDx = (hitPos - 0.5) * 10;
      ballDy = -Math.abs(ballDy);
      ballY = paddleY - BALL_RADIUS;
    }

    bricks.forEach(function (b) {
      if (!b.alive) return;
      if (ballX + BALL_RADIUS >= b.x && ballX - BALL_RADIUS <= b.x + b.w &&
          ballY + BALL_RADIUS >= b.y && ballY - BALL_RADIUS <= b.y + b.h) {
        b.alive = false;
        score += 10;
        scoreEl.textContent = score;
        if (ballX + BALL_RADIUS <= b.x || ballX - BALL_RADIUS >= b.x + b.w) ballDx = -ballDx;
        else ballDy = -ballDy;
      }
    });

    if (ballY - BALL_RADIUS > canvas.height) {
      lives--;
      livesEl.textContent = lives;
      if (lives <= 0) {
        endGame(false);
        return;
      }
      resetBall();
      running = false;
      if (animationId) cancelAnimationFrame(animationId);
      overlay.classList.remove('hidden');
      overlayText.textContent = 'Ball lost! Click or press Space to continue';
      return;
    }

    const allGone = bricks.every(function (b) { return !b.alive; });
    if (allGone) {
      endGame(true);
    }
  }

  function endGame(won) {
    running = false;
    if (animationId) cancelAnimationFrame(animationId);
    overlay.classList.remove('hidden');
    overlayText.textContent = won ? 'You won! Final score: ' + score : 'Game over. Score: ' + score;
    restartBtn.style.display = 'block';
  }

  function startGame() {
    if (lives <= 0) {
      init();
    }
    overlay.classList.add('hidden');
    restartBtn.style.display = 'none';
    overlayText.textContent = 'Click or press Space to start';
    running = true;
    loop();
  }

  function loop() {
    if (!running) return;
    movePaddle();
    moveBall();
    ctx.fillStyle = '#0d0d0d';
    ctx.fillRect(0, 0, canvas.width, canvas.height);
    drawBricks();
    drawPaddle();
    drawBall();
    animationId = requestAnimationFrame(loop);
  }

  canvas.addEventListener('mousemove', function (e) {
    const rect = canvas.getBoundingClientRect();
    const scale = canvas.width / rect.width;
    const mouseX = (e.clientX - rect.left) * scale;
    paddleX = mouseX - PADDLE_WIDTH / 2;
    if (paddleX < 0) paddleX = 0;
    if (paddleX > canvas.width - PADDLE_WIDTH) paddleX = canvas.width - PADDLE_WIDTH;
  });

  document.addEventListener('keydown', function (e) {
    if (e.key === 'ArrowLeft') paddleDir = -1;
    if (e.key === 'ArrowRight') paddleDir = 1;
    if (e.key === ' ') {
      e.preventDefault();
      if (!running && overlay.classList.contains('hidden') && lives > 0) return;
      if (!running) startGame();
    }
  });
  document.addEventListener('keyup', function (e) {
    if (e.key === 'ArrowLeft' || e.key === 'ArrowRight') paddleDir = 0;
  });

  overlay.addEventListener('click', function () {
    if (running) return;
    startGame();
  });
  restartBtn.addEventListener('click', function (e) {
    e.stopPropagation();
    init();
    startGame();
  });

  init();
  overlay.classList.remove('hidden');
})();
