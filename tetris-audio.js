(function () {
  let audioCtx = null;
  let musicGain = null;
  let sfxGain = null;
  let musicIntervalId = null;
  const MUSIC_NOTES = [220, 165, 220, 165, 262, 330, 392, 440];
  const MUSIC_BEAT_MS = 480;
  let musicNoteIndex = 0;

  function getCtx() {
    if (!audioCtx) {
      audioCtx = new (window.AudioContext || window.webkitAudioContext)();
      musicGain = audioCtx.createGain();
      musicGain.gain.value = 0.12;
      musicGain.connect(audioCtx.destination);
      sfxGain = audioCtx.createGain();
      sfxGain.gain.value = 0.25;
      sfxGain.connect(audioCtx.destination);
    }
    return audioCtx;
  }

  function playNote(freq, duration, destNode, when) {
    const ctx = getCtx();
    when = when ?? ctx.currentTime;
    const osc = ctx.createOscillator();
    const gain = ctx.createGain();
    osc.type = 'triangle';
    osc.frequency.value = freq;
    osc.connect(gain);
    gain.connect(destNode);
    gain.gain.setValueAtTime(0, when);
    gain.gain.linearRampToValueAtTime(0.3, when + 0.02);
    gain.gain.exponentialRampToValueAtTime(0.01, when + duration);
    osc.start(when);
    osc.stop(when + duration);
  }

  function startMusic() {
    if (musicIntervalId) return;
    getCtx();
    if (audioCtx.state === 'suspended') audioCtx.resume();
    const scheduleNext = () => {
      playNote(MUSIC_NOTES[musicNoteIndex], 0.35, musicGain);
      musicNoteIndex = (musicNoteIndex + 1) % MUSIC_NOTES.length;
    };
    scheduleNext();
    musicIntervalId = setInterval(scheduleNext, MUSIC_BEAT_MS);
  }

  function stopMusic() {
    if (musicIntervalId) {
      clearInterval(musicIntervalId);
      musicIntervalId = null;
    }
  }

  function sfxLock() {
    const ctx = getCtx();
    const t = ctx.currentTime;
    playNote(180, 0.06, sfxGain, t);
  }

  function sfxLineClear(count) {
    const ctx = getCtx();
    const t = ctx.currentTime;
    const base = 400 + count * 120;
    for (let i = 0; i < count; i++) {
      playNote(base + i * 80, 0.12, sfxGain, t + i * 0.08);
    }
  }

  function sfxLevelUp() {
    const ctx = getCtx();
    const t = ctx.currentTime;
    [523, 659, 784, 1047].forEach((freq, i) => {
      playNote(freq, 0.15, sfxGain, t + i * 0.1);
    });
  }

  function sfxGameOver() {
    const ctx = getCtx();
    const t = ctx.currentTime;
    [392, 330, 262, 196].forEach((freq, i) => {
      playNote(freq, 0.25, sfxGain, t + i * 0.15);
    });
  }

  window.TetrisAudio = {
    init: getCtx,
    startMusic,
    stopMusic,
    play: function (type, data) {
      getCtx();
      if (audioCtx.state === 'suspended') audioCtx.resume();
      switch (type) {
        case 'lock':
          sfxLock();
          break;
        case 'lineclear':
          sfxLineClear(data || 1);
          break;
        case 'levelup':
          sfxLevelUp();
          break;
        case 'gameover':
          sfxGameOver();
          break;
        default:
          break;
      }
    }
  };
})();
