// Screens for playing with friends: profile, join, lobby (+ results of the last race). Hebrew, RTL.
import { PLAYER_COLORS } from '../net/room/RoomCore.js';
import { EMOJIS } from '../net/protocol.js';

const hex = (c) => '#' + c.toString(16).padStart(6, '0');
const esc = (s) => String(s).replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
const fmt = (t) => { const m = Math.floor(t / 60), s = t - m * 60; return `${m}:${s.toFixed(1).padStart(4, '0')}`; };

export function loadProfile() {
  try { const p = JSON.parse(localStorage.getItem('dongame.profile')); if (p && typeof p.name === 'string' && PLAYER_COLORS.includes(p.color)) return p; } catch { /* none */ }
  return { name: '', color: PLAYER_COLORS[Math.floor(Math.random() * PLAYER_COLORS.length)] };
}
const saveProfile = (p) => { try { localStorage.setItem('dongame.profile', JSON.stringify(p)); } catch { /* ignore */ } };

export function createLobbyScreens(root, h) {
  const el = document.createElement('div');
  el.id = 'lobby-screens';
  el.innerHTML = `
    <div class="screen" id="scr-profile" hidden><div class="panel">
      <div class="title">מי אתה?</div>
      <input id="in-name" maxlength="12" placeholder="כינוי" autocomplete="off" />
      <div class="colors" id="colors"></div>
      <p class="hint" id="join-code-wrap" hidden>קוד חדר</p>
      <input id="in-code" maxlength="4" placeholder="KRTM" dir="ltr" autocapitalize="characters" autocomplete="off" hidden />
      <div class="status bad" id="profile-err"></div>
      <button class="big" id="btn-profile-go">המשך</button>
      <button class="ghost" id="btn-profile-back">חזרה</button>
    </div></div>
    <div class="screen" id="scr-lobby" hidden><div class="panel">
      <div class="title">חדר <span class="code" id="lobby-code" dir="ltr"></span></div>
      <div class="trkpick" id="lobby-trk"><button data-t="city">עיר בשקיעה</button><button data-t="desert">מדבר</button></div>
      <div class="row">
        <button class="ghost" id="btn-wa">שתף בוואטסאפ</button>
        <button class="ghost" id="btn-copy">העתק קישור</button>
      </div>
      <div id="lobby-players"></div>
      <div class="status" id="lobby-status"></div>
      <div class="row">
        <button class="big" id="btn-lobby-start" hidden>התחל עכשיו</button>
        <button class="big" id="btn-lobby-calib" hidden>כייל והתחל</button>
        <button class="big" id="btn-lobby-watch" hidden>צפה במרוץ</button>
      </div>
      <div class="row"><button class="ghost" id="btn-lobby-recal">כייל מחדש</button><button class="ghost" id="btn-lobby-leave">צא מהחדר</button></div>
      <div id="lobby-last" hidden></div>
      <div id="lobby-board" hidden></div>
    </div></div>
    <div id="emoji-bar" hidden>${EMOJIS.map((e) => `<button data-e="${e}">${e}</button>`).join('')}</div>`;
  root.appendChild(el);
  const $ = (id) => el.querySelector('#' + id);
  let mode = 'create', profile = loadProfile();

  /* ---- profile / join ---- */
  const colors = $('colors');
  colors.innerHTML = PLAYER_COLORS.map((c) => `<button data-c="${c}" style="background:${hex(c)}" aria-label="צבע"></button>`).join('');
  const paintColors = () => { for (const b of colors.children) b.classList.toggle('on', Number(b.dataset.c) === profile.color); };
  colors.addEventListener('click', (e) => { const c = Number(e.target.dataset?.c); if (c) { profile.color = c; paintColors(); } });
  $('in-code').addEventListener('input', (e) => { e.target.value = e.target.value.toUpperCase().replace(/[^A-Z]/g, ''); });
  $('btn-profile-back').addEventListener('click', () => h.onBack());
  $('btn-profile-go').addEventListener('click', () => {
    const name = $('in-name').value.trim();
    if (!name) { $('profile-err').textContent = 'כתוב כינוי'; return; }
    profile = { name, color: profile.color }; saveProfile(profile);
    $('profile-err').textContent = '';
    h.onProfileDone(mode, profile, $('in-code').value);
  });

  /* ---- lobby ---- */
  let lastRoom = null, me = null, timerT = null, shareUrl = '';
  $('btn-wa').addEventListener('click', () => {
    const text = `בוא למרוץ ב-Don Game! קוד החדר: ${lastRoom?.code}\n${shareUrl}`;
    if (navigator.share) navigator.share({ text }).catch(() => {});
    else window.open('https://wa.me/?text=' + encodeURIComponent(text), '_blank', 'noopener');
  });
  $('btn-copy').addEventListener('click', async () => { try { await navigator.clipboard.writeText(shareUrl); h.toast('הקישור הועתק'); } catch { h.toast(shareUrl, 4000); } });
  $('btn-lobby-start').addEventListener('click', () => h.onStartNow());
  $('lobby-trk').addEventListener('click', (e) => { const t = e.target.dataset?.t; if (t && lastRoom?.hostId === me) h.onTrack(t); });
  $('btn-lobby-watch').addEventListener('click', () => h.onWatch());
  $('btn-lobby-calib').addEventListener('click', () => h.onCalibrate());
  $('btn-lobby-recal').addEventListener('click', () => h.onCalibrate());
  $('btn-lobby-leave').addEventListener('click', () => h.onLeave());
  $('emoji-bar').addEventListener('click', (e) => { const em = e.target.dataset?.e; if (em) h.onEmoji(em); });

  const renderLobby = () => {
    if (!lastRoom) return;
    const r = lastRoom, mine = r.players.find((p) => p.id === me);
    $('lobby-code').textContent = r.code;
    { const host = r.hostId === me; for (const b of $('lobby-trk').children) { b.classList.toggle('on', b.dataset.t === r.trackId); b.disabled = !host || r.phase !== 'lobby'; } }       // the host picks the track, everybody sees it
    $('lobby-players').innerHTML = r.players.map((p) =>
      `<div class="pl${p.connected ? '' : ' off'}"><i style="background:${hex(p.color)}"></i><span class="nm">${esc(p.name)}${p.id === me ? ' (אתה)' : ''}</span>${p.id === r.hostId ? '<span>👑</span>' : ''}<span class="st">${!p.connected ? '📶' : p.calibrated ? '✓ מוכן' : '…מכייל'}</span></div>`).join('');
    const isHost = r.hostId === me, ready = !!mine?.calibrated;
    $('btn-lobby-start').hidden = !(isHost && ready && r.phase === 'lobby');
    $('btn-lobby-calib').hidden = !(!ready && r.phase === 'lobby');
    $('btn-lobby-recal').hidden = !ready;
    $('btn-lobby-watch').hidden = !(r.phase === 'racing' && !mine?.inRace && h.canWatch());
    const tbl = r.scores.filter((s) => s.races > 0);
    $('lobby-board').hidden = !tbl.length;
    $('lobby-board').innerHTML = tbl.length ? `<div class="sub">טבלת החדר</div>` + tbl.map((s, i) => `<div class="pl"><span class="n">${i + 1}</span><i style="background:${hex(s.color)}"></i><span class="nm">${esc(s.name)}</span><span class="st">${s.points} נק׳</span></div>`).join('') : '';
    updateStatus();
  };
  const updateStatus = () => {
    if (!lastRoom) return;
    const r = lastRoom, humans = r.players.filter((p) => p.connected).length;
    let t = '';
    if (r.phase === 'racing') t = 'מרוץ מתנהל כרגע, תיכנס למרוץ הבא';
    else if (r.phase === 'results') t = 'המרוץ נגמר…';
    else if (r.timerEnd) t = `המרוץ מתחיל בעוד ${Math.max(0, Math.ceil((r.timerEnd - h.serverNow()) / 1000))} שניות`;
    else if (humans < 4) t = `ממתינים לחברים (${humans}/4). בוטים ישלימו ל-4`;
    $('lobby-status').textContent = t;
  };

  return {
    profile: () => profile,
    showProfile(m, code = '') {
      mode = m; $('in-name').value = profile.name; paintColors();
      $('in-code').hidden = m !== 'join'; $('join-code-wrap').hidden = m !== 'join'; $('in-code').value = code; $('profile-err').textContent = '';
      $('scr-profile').hidden = false; $('scr-lobby').hidden = true; $('emoji-bar').hidden = true;
    },
    profileError(text) { $('profile-err').textContent = text; $('scr-profile').hidden = false; },
    showLobby(youId, shareLink) {
      me = youId; shareUrl = shareLink; $('scr-profile').hidden = true; $('scr-lobby').hidden = false; $('emoji-bar').hidden = true;
      clearInterval(timerT); timerT = setInterval(updateStatus, 500); renderLobby();
    },
    room(r) { lastRoom = r; renderLobby(); },
    lastResults(res, myId) {
      const box = $('lobby-last'); box.hidden = !res;
      if (!res) return;
      box.innerHTML = `<div class="sub">המרוץ האחרון</div>` + res.order.map((o) => `<div class="pl${o.id === myId ? ' me' : ''}"><span class="n">${o.place}</span><i style="background:${hex(o.color)}"></i><span class="nm">${esc(o.name)}</span><span class="st">${o.raceTime != null ? fmt(o.raceTime) : 'לא סיים'} · +${o.points}</span></div>`).join('');
    },
    hide() { clearInterval(timerT); $('scr-profile').hidden = true; $('scr-lobby').hidden = true; $('emoji-bar').hidden = true; },
    showEmojiBar(on) { $('emoji-bar').hidden = !on; },
  };
}
