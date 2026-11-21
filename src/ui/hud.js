// HUD: position, timer, speed, progress dots, turbo + item buttons, countdown, spectate panel, results.
// Turbo is physically on the LEFT, item on the RIGHT (also in RTL layout).
const hex = (c) => '#' + c.toString(16).padStart(6, '0');
const fmt = (t) => { const m = Math.floor(t / 60); const s = t - m * 60; return `${m}:${s < 10 ? '0' : ''}${s.toFixed(1)}`; };

export function createHud(root, { onRestart, onRecalibrate, onSkip }) {
  root.innerHTML = `
    <div id="hud-top">
      <div id="hud-pos"><span class="lbl">מקום</span><b>1</b><span class="of">/4</span></div>
      <div id="hud-timer">0:00.0</div>
      <div id="hud-speed"><b>0</b> קמ"ש</div>
    </div>
    <div id="hud-progress"><div id="hud-dots"></div></div>
    <button id="btn-turbo" class="gbtn" aria-label="טורבו"><span class="ico">🔥</span><span id="turbo-count">2</span></button>
    <button id="btn-item" class="gbtn" aria-label="פריט" disabled><span class="ico">🎁</span></button>
    <div id="countdown" hidden></div>
    <div id="spectate" hidden>
      <div id="spectate-banner"></div>
      <div id="standings"></div>
      <button id="btn-skip">דלג לתוצאות</button>
      <div id="spectate-hint">נגיעה במסך מחליפה מכונית</div>
    </div>
    <div id="fade"></div>
    <div id="result" hidden>
      <div class="card">
        <div id="result-title"></div>
        <table id="result-table"></table>
        <div class="btns">
          <button id="btn-again">מרוץ חדש</button>
          <button id="btn-recalib" class="ghost">כיול מחדש</button>
        </div>
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
  $('btn-recalib').addEventListener('click', () => onRecalibrate());
  $('btn-skip').addEventListener('click', () => onSkip());
  hud.consumePulse = () => { const p = hud.turboPulse; hud.turboPulse = false; return p; };

  let last = {}, dots = [];
  const set = (key, el, text) => { if (last[key] !== text) { last[key] = text; el.textContent = text; } };

  hud.setCars = (cars) => {
    const box = $('hud-dots');
    box.innerHTML = '';
    dots = cars.map((c) => {
      const d = document.createElement('i');
      d.style.background = hex(c.color);
      if (c.isPlayer) d.className = 'me';
      box.appendChild(d);
      return d;
    });
  };

  hud.update = ({ time, car, cars, length }) => {
    set('t', $('hud-timer'), fmt(time));
    $('hud-speed').firstElementChild.textContent = Math.round(car.speed * 3.6);
    const posEl = $('hud-pos');
    set('pos', posEl.querySelector('b'), String(car.finishTime != null ? car.place : car.rank));
    set('of', posEl.querySelector('.of'), '/' + cars.length);
    cars.forEach((c, i) => {
      const w = (Math.max(0, Math.min(1, c.s / length)) * 100).toFixed(1) + '%';
      if (dots[i] && dots[i]._w !== w) { dots[i]._w = w; dots[i].style.left = w; }
    });
    set('tc', $('turbo-count'), String(car.turbosLeft));
    const active = car.turboT > 0;
    turbo.classList.toggle('active', active);
    turbo.classList.toggle('empty', car.turbosLeft === 0 && !active);
    const fade = car.state === 'respawning' ? '1' : '0';
    if (last.f !== fade) { last.f = fade; $('fade').style.opacity = fade; }
  };

  hud.showCountdown = (text) => { const el = $('countdown'); el.hidden = false; if (el.textContent !== text) { el.textContent = text; el.classList.remove('pop'); void el.offsetWidth; el.classList.add('pop'); } };
  hud.hideCountdown = () => { $('countdown').hidden = true; $('countdown').textContent = ''; };

  hud.setSpectate = (on, banner = '') => { $('spectate').hidden = !on; $('spectate-banner').textContent = banner; if (!on) last.st = null; };
  hud.updateStandings = (cars, watchedId) => {
    const html = cars.map((c) => `<div class="row${c.id === watchedId ? ' watch' : ''}"><span class="n">${c.rank}</span><i style="background:${hex(c.color)}"></i><span class="nm">${c.name}</span><span class="tm">${c.finishTime != null ? fmt(c.finishTime) : '···'}</span></div>`).join('');
    if (last.st !== html) { last.st = html; $('standings').innerHTML = html; }
  };

  hud.showResults = (cars, player) => {
    $('result-title').textContent = player.place === 1 ? 'ניצחת! 🏆' : `מקום ${player.place}`;
    $('result-title').className = player.place === 1 ? 'win' : '';
    $('result-table').innerHTML = cars.map((c) =>
      `<tr class="${c.isPlayer ? 'me' : ''}"><td class="n">${c.place}</td><td><i style="background:${hex(c.color)}"></i></td><td class="nm">${c.name}</td><td class="tm">${fmt(c.finishTime)}</td></tr>`).join('');
    $('result').hidden = false;
  };
  hud.hideResult = () => { $('result').hidden = true; };
  hud.reset = () => { last = {}; hud.hideResult(); hud.setSpectate(false); hud.hideCountdown(); };
  return hud;
}
