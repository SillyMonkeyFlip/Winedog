// Runs inside each game page (added by sw.js). Lets the WineDog player mute the game.
(() => {
  if (window.__wdHook) return;
  window.__wdHook = true;

  let muted = false;
  try { muted = !!window.top.__wdMuted; } catch {}

  const masters = new Set();
  const mutedByUs = new Set();

  // Web Audio: route everything that goes to the speakers through one volume knob per context.
  const proto = window.AudioNode && AudioNode.prototype;
  if (proto && proto.connect) {
    const origConnect = proto.connect;
    const byCtx = new WeakMap();
    const master = (ctx) => {
      let g = byCtx.get(ctx);
      if (!g) {
        g = ctx.createGain();
        origConnect.call(g, ctx.destination);
        g.gain.value = muted ? 0 : 1;
        byCtx.set(ctx, g);
        masters.add(g);
      }
      return g;
    };
    proto.connect = function (dest, ...rest) {
      const ctx = this.context;
      const offline = window.OfflineAudioContext && ctx instanceof OfflineAudioContext;
      if (dest && ctx && dest === ctx.destination && !offline) {
        return origConnect.call(this, master(ctx), ...rest);
      }
      return origConnect.call(this, dest, ...rest);
    };
  }

  // <audio> and <video>
  const media = window.HTMLMediaElement && HTMLMediaElement.prototype;
  if (media && media.play) {
    const origPlay = media.play;
    media.play = function (...args) {
      if (muted && !this.muted) { this.muted = true; mutedByUs.add(this); }
      return origPlay.apply(this, args);
    };
  }

  function apply(m) {
    muted = m;
    for (const g of masters) {
      try { g.gain.setValueAtTime(m ? 0 : 1, g.context.currentTime); } catch { g.gain.value = m ? 0 : 1; }
    }
    if (m) {
      document.querySelectorAll('audio,video').forEach((el) => {
        if (!el.muted) { el.muted = true; mutedByUs.add(el); }
      });
    } else {
      mutedByUs.forEach((el) => { el.muted = false; });
      mutedByUs.clear();
    }
    // Pass it on to any frames inside the game.
    for (let i = 0; i < window.frames.length; i++) {
      try { window.frames[i].postMessage({ __wdMute: m }, '*'); } catch {}
    }
  }

  window.addEventListener('message', (e) => {
    if (e.data && typeof e.data.__wdMute === 'boolean') apply(e.data.__wdMute);
  });
})();
