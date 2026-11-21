// HUD: timer, speed, progress, turbo + item buttons, respawn fade, result card.
// Turbo is physically on the LEFT, item on the RIGHT (also in RTL layout).
export function createHud(root, { onRestart }) {
  root.innerHTML = `
    <div id="hud-top">
      <div id="hud-speed"><b>0</b> קמ"ש</div>
      <div id="hud-timer">0:00.0</div>
      <div id="hud-lap"></div>
    </div>
    <div id="hud-progress"><div id="hud-progress-fill"></div></div>
    <button id="btn-turbo" class="gbtn" aria-label="טורבו"><span class="ico">🔥</span><span id="turbo-count">2</span></button>
    <button id="btn-item" class="gbtn" aria-label="פריט" disabled><span class="ico">🎁</span></button>
    <div id="fade"></div>
    <div id="result" hidden>
      <div class="card">
        <div id="result-title">סיימת!</div>
        <div id="result-time"></div>
        <button id="btn-again">מרוץ חדש</button>
      </div>
    </div>`;
  const $ = (id) => root.querySelector('#' + id);
  const turbo = $('btn-turbo');
  const hud = { turboHeld: false, turboPulse: false };
  const press = (e) => { e.preventDefault(); hud.turboHeld = true; hud.turboPulse = true; navigator.vibrate?.(20); };
  const release = () => { hud.turboHeld = false; };
  turbo.addEventListener('pointerdown', press);
  turbo.addEventListener('pointerup', release);
  turbo.addEventListener('pointercancel', release);
  turbo.addEventListener('pointerleave', release);
  $('btn-again').addEventListener('click', () => onRestart());
  $('btn-again').style.pointerEvents = 'auto';

  hud.consumePulse = () => { const p = hud.turboPulse; hud.turboPulse = false; return p; };

  const fmt = (t) => { const m = Math.floor(t / 60); const s = t - m * 60; return `${m}:${s < 10 ? '0' : ''}${s.toFixed(1)}`; };
  let last = {};
  const set = (key, el, text) => { if (last[key] !== text) { last[key] = text; el.textContent = text; } };

  hud.update = ({ time, car, length }) => {
    set('t', $('hud-timer'), fmt(time));
    $('hud-speed').firstElementChild.textContent = Math.round(car.speed * 3.6);
    const p = Math.max(0, Math.min(1, car.s / length));
    const w = (p * 100).toFixed(1) + '%';
    if (last.p !== w) { last.p = w; $('hud-progress-fill').style.width = w; }
    set('tc', $('turbo-count'), String(car.turbosLeft));
    const active = car.turboT > 0;
    turbo.classList.toggle('active', active);
    turbo.classList.toggle('empty', car.turbosLeft === 0 && !active);
    const fade = car.state === 'respawning' ? '1' : '0';
    if (last.f !== fade) { last.f = fade; $('fade').style.opacity = fade; }
  };
  hud.showResult = (time) => {
    $('result-time').textContent = 'זמן: ' + fmt(time);
    $('result').hidden = false;
  };
  hud.hideResult = () => { $('result').hidden = true; };
  hud.reset = () => { last = {}; hud.hideResult(); };
  return hud;
}
