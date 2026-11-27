// Shared sound effects for the WineDog games (loaded as ../sound.js).
// Every sound is generated in the browser, so there are no audio files to download.
//
//   SFX.play("jump")                       play a named effect
//   SFX.tone(440, 0.1, "square", 0.08)     play one beep: frequency, seconds, wave, volume
(() => {
  let ctx = null;

  function audio() {
    if (!ctx) {
      const AC = window.AudioContext || window.webkitAudioContext;
      if (!AC) return null;
      ctx = new AC();
    }
    if (ctx.state === 'suspended') ctx.resume().catch(() => {});
    return ctx;
  }

  // Browsers only allow sound after the player clicks or presses a key.
  for (const ev of ['pointerdown', 'keydown', 'touchstart']) {
    window.addEventListener(ev, () => audio(), { capture: true, passive: true });
  }

  // One note. `slide` bends the pitch to that frequency over the note.
  function tone(freq = 440, dur = 0.1, type = 'square', vol = 0.08, delay = 0, slide = null) {
    const c = audio();
    if (!c || !isFinite(freq) || freq <= 0) return;
    const t = c.currentTime + delay;
    const osc = c.createOscillator();
    const gain = c.createGain();
    osc.type = type;
    osc.frequency.setValueAtTime(freq, t);
    if (slide) osc.frequency.exponentialRampToValueAtTime(Math.max(20, slide), t + dur);
    gain.gain.setValueAtTime(0.0001, t);
    gain.gain.exponentialRampToValueAtTime(Math.max(0.0002, vol), t + 0.008);
    gain.gain.exponentialRampToValueAtTime(0.0001, t + dur);
    osc.connect(gain);
    gain.connect(c.destination);
    osc.start(t);
    osc.stop(t + dur + 0.02);
  }

  // A short burst of noise, for hits and crashes.
  function noise(dur = 0.15, vol = 0.12, delay = 0) {
    const c = audio();
    if (!c) return;
    const t = c.currentTime + delay;
    const len = Math.max(1, Math.floor(c.sampleRate * dur));
    const buf = c.createBuffer(1, len, c.sampleRate);
    const data = buf.getChannelData(0);
    for (let i = 0; i < len; i++) data[i] = (Math.random() * 2 - 1) * (1 - i / len);
    const src = c.createBufferSource();
    const gain = c.createGain();
    src.buffer = buf;
    gain.gain.value = vol;
    src.connect(gain);
    gain.connect(c.destination);
    src.start(t);
  }

  const seq = (notes, type = 'square', vol = 0.07, step = 0.08) =>
    notes.forEach((f, i) => tone(f, step * 1.1, type, vol, i * step));

  const SOUNDS = {
    move:   () => tone(220, 0.04, 'square', 0.04),
    turn:   () => tone(330, 0.05, 'square', 0.05),
    rotate: () => tone(440, 0.05, 'square', 0.05),
    slide:  () => tone(300, 0.07, 'triangle', 0.06, 0, 200),
    flip:   () => tone(700, 0.05, 'triangle', 0.06, 0, 900),
    hold:   () => seq([392, 523], 'triangle', 0.06, 0.05),
    drop:   () => tone(160, 0.12, 'square', 0.08, 0, 60),
    land:   () => tone(120, 0.08, 'triangle', 0.1),
    fall:   () => tone(600, 0.5, 'sine', 0.07, 0, 120),
    jump:   () => tone(300, 0.15, 'square', 0.06, 0, 650),
    flap:   () => tone(420, 0.08, 'triangle', 0.07, 0, 620),
    spring: () => tone(250, 0.25, 'sine', 0.08, 0, 1200),
    hit:    () => { noise(0.12, 0.12); tone(110, 0.12, 'square', 0.06, 0, 60); },
    die:    () => { noise(0.25, 0.1); seq([392, 330, 262, 196], 'square', 0.07, 0.11); },
    point:  () => seq([880, 1320], 'square', 0.05, 0.05),
    eat:    () => tone(600, 0.06, 'square', 0.06, 0, 900),
    gold:   () => seq([988, 1319, 1568], 'triangle', 0.07, 0.06),
    warp:   () => tone(200, 0.3, 'sine', 0.08, 0, 1600),
    merge:  () => tone(520, 0.08, 'triangle', 0.07, 0, 780),
    clear:  () => seq([523, 659, 784], 'square', 0.06, 0.06),
    tetris: () => seq([523, 659, 784, 1047, 1319], 'square', 0.07, 0.07),
    level:  () => seq([392, 523, 659, 784, 1047], 'triangle', 0.08, 0.08),
    win:    () => seq([523, 659, 784, 1047, 784, 1047], 'square', 0.07, 0.1),
  };

  window.SFX = {
    tone,
    noise,
    play(name) {
      try { (SOUNDS[name] || SOUNDS.point)(); } catch {}
    },
  };
})();
