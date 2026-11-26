import { CONFIG } from '../config.js';

// HUD: position, timer, speed, progress dots, turbo + item buttons, countdown, spectate panel, results.
// Turbo is physically on the LEFT, item on the RIGHT (also in RTL layout).
const hex = (c) => '#' + c.toString(16).padStart(6, '0');
const ICON = { mine: '💣', missile: '🚀', oil: '🛢️', gun: '🔫', shield: '🛡️', barrel: '🧱' };
const ICON_LIST = Object.values(ICON);
const fmt = (t) => { const m = Math.floor(t / 60); const s = t - m * 60; return `${m}:${s < 10 ? '0' : ''}${s.toFixed(1)}`; };

export function createHud(root, { onRestart, onRecalibrate, onSkip }) {
  root.innerHTML = `
    <div id="hud-top">
      <div id="hud-pos"><span class="lbl">מקום</span><b>1</b><span class="of">/4</span></div>
      <div id="hud-speed"><b>0</b> קמ"ש</div>
    </div>
    <div id="hud-progress"><div id="hud-dots"></div></div>
    <button id="btn-turbo" class="gbtn" aria-label="טורבו"><span id="turbo-ring"></span><span class="ico">🔥</span><span id="turbo-count">2</span></button>
    <button id="btn-item" class="gbtn" aria-label="פריט" disabled><span class="ico" id="item-ico">🎁</span></button>
    <div id="countdown" hidden></div>
    <div id="spectate" hidden>
      <div id="spectate-banner"></div>
      <div id="standings"></div>
      <button id="btn-skip">דלג לתוצאות</button>
      <div id="spectate-hint">נגיעה במסך מחליפה מכונית</div>
    </div>
    <div id="danger"></div>
    <div id="boost-fx"></div>
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
  const item = $('btn-item');
  const hud = { turboHeld: false, turboPulse: false, itemPulse: false };
  const press = (e) => { e.preventDefault(); hud.turboHeld = true; hud.turboPulse = true; navigator.vibrate?.(20); };
  const release = () => { hud.turboHeld = false; };
  turbo.addEventListener('pointerdown', press);
  turbo.addEventListener('pointerup', release);
  turbo.addEventListener('pointercancel', release);
  turbo.addEventListener('pointerleave', release);
  $('btn-again').addEventListener('click', () => onRestart());
  $('btn-recalib').addEventListener('click', () => onRecalibrate());
  $('btn-skip').addEventListener('click', () => onSkip());
  item.addEventListener('pointerdown', (e) => { e.preventDefault(); if (!item.disabled) { hud.itemPulse = true; navigator.vibrate?.(20); } });
  hud.consumePulse = () => { const p = hud.turboPulse; hud.turboPulse = false; return p; };
  hud.consumeItemPulse = () => { const p = hud.itemPulse; hud.itemPulse = false; return p; };

  let last = {}, dots = [], rollerDot = null;
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
    rollerDot = document.createElement('b');
    rollerDot.className = 'rdot'; rollerDot.textContent = '🚜'; rollerDot.hidden = true;
    box.appendChild(rollerDot);
  };

  hud.update = ({ car, cars, length, roller }) => {
    set('spd', $('hud-speed').firstElementChild, String(Math.round(car.speed * 3.6)));
    const posEl = $('hud-pos');
    set('pos', posEl.querySelector('b'), car.state === 'eliminated' ? '✕' : String(car.finishTime != null ? car.place : car.rank));
    set('of', posEl.querySelector('.of'), '/' + cars.length);
    cars.forEach((c, i) => {
      const w = (Math.max(0, Math.min(1, c.s / length)) * 100).toFixed(1) + '%';
      if (dots[i] && dots[i]._w !== w) { dots[i]._w = w; dots[i].style.left = w; }
    });
    if (rollerDot) {
      const show = !!(roller && roller.active);
      if (rollerDot.hidden === show) rollerDot.hidden = !show;
      if (show) { const w = (Math.max(0, Math.min(1, roller.s / length)) * 100).toFixed(1) + '%'; if (rollerDot._w !== w) { rollerDot._w = w; rollerDot.style.left = w; } }
    }
    set('tc', $('turbo-count'), String(car.turbosLeft));
    // recharge ring: fills over TURBO_RECHARGE seconds while fewer than the maximum are stored
    const charging = car.turbosLeft < CONFIG.car.TURBO_MAX;
    const p = charging ? Math.min(1, car.turboRecharge / CONFIG.car.TURBO_RECHARGE) : 0;
    const pv = p.toFixed(2);
    if (last.ring !== pv) { last.ring = pv; $('turbo-ring').style.setProperty('--p', pv); $('turbo-ring').style.opacity = charging ? '1' : '0'; }
    const active = car.turboT > 0;
    turbo.classList.toggle('active', active);
    const boosting = active || car.boostT > 0;
    if (last.bx !== boosting) { last.bx = boosting; $('boost-fx').classList.toggle('on', boosting); }
    turbo.classList.toggle('empty', car.turbosLeft === 0 && !active);
    // item button: roulette while rolling, then the item
    let icon = '🎁', usable = false, rolling = false;
    if (car.rouletteT > 0) { icon = ICON_LIST[Math.floor(performance.now() / 90) % ICON_LIST.length]; rolling = true; }
    else if (car.item) { icon = ICON[car.item]; usable = car.state === 'driving'; }
    set('ico', $('item-ico'), icon);
    if (item.disabled === usable) item.disabled = !usable;
    item.classList.toggle('rolling', rolling);
    item.classList.toggle('ready', usable);
    const fade = car.state === 'respawning' ? '1' : '0';
    if (last.f !== fade) { last.f = fade; $('fade').style.opacity = fade; }
  };

  /** 0 = safe .. 1 = the roller is right behind: red pulsing frame. */
  hud.setDanger = (k) => {
    const v = k.toFixed(2);
    if (last.dg === v) return;
    last.dg = v;
    const el = $('danger');
    el.style.opacity = String(k > 0 ? 0.25 + 0.75 * k : 0);
    el.style.setProperty('--dur', (1.1 - 0.75 * k).toFixed(2) + 's');
    el.classList.toggle('on', k > 0);
  };

  hud.showCountdown = (text) => { const el = $('countdown'); el.hidden = false; if (el.textContent !== text) { el.textContent = text; el.classList.remove('pop'); void el.offsetWidth; el.classList.add('pop'); } };
  hud.hideCountdown = () => { $('countdown').hidden = true; $('countdown').textContent = ''; };

  hud.setSpectate = (on, banner = '') => { $('spectate').hidden = !on; $('spectate-banner').textContent = banner; if (!on) last.st = null; };
  hud.updateStandings = (cars, watchedId) => {
    const html = cars.map((c) => `<div class="row${c.id === watchedId ? ' watch' : ''}${c.state === 'eliminated' ? ' out' : ''}"><span class="n">${c.rank}</span><i style="background:${hex(c.color)}"></i><span class="nm">${c.name}</span><span class="tm">${c.finishTime != null ? fmt(c.finishTime) : c.state === 'eliminated' ? 'נדרס' : '···'}</span></div>`).join('');
    if (last.st !== html) { last.st = html; $('standings').innerHTML = html; }
  };

  hud.showResults = (cars, player) => {
    const flat = player.state === 'eliminated';
    $('result-title').textContent = flat ? 'נדרסת! 🫓' : player.place === 1 ? 'ניצחת! 🏆' : `מקום ${player.place}`;
    $('result-title').className = player.place === 1 && !flat ? 'win' : flat ? 'flat' : '';
    $('result-table').innerHTML = cars.map((c) =>
      `<tr class="${c.isPlayer ? 'me' : ''}"><td class="n">${c.place}</td><td><i style="background:${hex(c.color)}"></i></td><td class="nm">${c.name}</td><td class="tm">${c.finishTime != null ? fmt(c.finishTime) : 'נדרס 🫓'}</td></tr>`).join('');
    $('result').hidden = false;
  };
  hud.hideResult = () => { $('result').hidden = true; };
  hud.reset = () => { last = {}; hud.hideResult(); hud.setSpectate(false); hud.hideCountdown(); };
  return hud;
}
