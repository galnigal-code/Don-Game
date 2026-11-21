// Menu and calibration screens (Hebrew, RTL).
export function createScreens(root, tilt, { onPlay, onStart }) {
  const el = document.createElement('div');
  el.id = 'screens';
  el.innerHTML = `
    <div class="screen" id="scr-menu" hidden>
      <div class="panel">
        <div class="logo">Don Game</div>
        <p>מרוץ מדבר. מטים את הטלפון כמו הגה, אוספים הפתעות ומכשילים את היריבים.</p>
        <button class="big" id="btn-play">שחק</button>
        <p class="hint" id="hint-menu" hidden>לחוויה הכי טובה החזק את הטלפון לרוחב</p>
      </div>
    </div>
    <div class="screen" id="scr-calib" hidden>
      <div class="panel">
        <div class="title">כיול הגה</div>
        <p>החזק את הטלפון יציב בתנוחה נוחה, כמו הגה.<br><b>עכשיו הטה אותו ימינה</b>, כמו שמסובבים הגה ימינה (הצד הימני של הטלפון יורד), והמשחק ילמד את הכיוון. אחר כך לחץ "התחל".</p>
        <div class="gauge" dir="ltr">
          <span id="lbl-left">◀ שמאלה</span>
          <div class="gtrack"><div class="gmid"></div><div class="gdot" id="gdot"></div></div>
          <span id="lbl-right">ימינה ▶</span>
        </div>
        <div class="status" id="calib-status"></div>
        <div class="row"><span>רגישות</span>
          <div class="seg" id="seg-sens">
            <button data-v="low">נמוכה</button><button data-v="normal">רגילה</button><button data-v="high">גבוהה</button>
          </div>
        </div>
        <button class="ghost" id="btn-invert">↔ הפוך כיוון ידנית</button>
        <button class="big" id="btn-start">התחל</button>
        <p class="hint" id="hint-calib" hidden>לחוויה הכי טובה החזק את הטלפון לרוחב</p>
      </div>
    </div>`;
  root.appendChild(el);
  const $ = (id) => el.querySelector('#' + id);
  const menu = $('scr-menu'), calib = $('scr-calib');

  $('btn-play').addEventListener('click', () => onPlay());
  $('btn-start').addEventListener('click', () => onStart());
  $('btn-invert').addEventListener('click', () => tilt.flipDirection());
  $('seg-sens').addEventListener('click', (e) => {
    const v = e.target.dataset?.v;
    if (v) { tilt.sensitivity = v; tilt.save(); refreshSeg(); }
  });
  const refreshSeg = () => {
    for (const b of $('seg-sens').children) b.classList.toggle('on', b.dataset.v === tilt.sensitivity);
  };
  const portrait = () => innerHeight > innerWidth;

  let openedAt = 0, visible = null;
  const api = {
    showMenu() { visible = 'menu'; menu.hidden = false; calib.hidden = true; $('hint-menu').hidden = !portrait(); },
    showCalibrate() {
      visible = 'calib'; menu.hidden = true; calib.hidden = false; openedAt = performance.now();
      refreshSeg(); $('hint-calib').hidden = !portrait();
      tilt.beginDirectionTest();
    },
    hide() { visible = null; menu.hidden = true; calib.hidden = true; },
    /** call every frame */
    update() {
      if (visible !== 'calib') return;
      tilt.updateDirectionTest();
      const s = tilt.previewSteer;
      $('gdot').style.left = (50 + s * 46) + '%';
      $('lbl-left').classList.toggle('lit', s < -0.15);
      $('lbl-right').classList.toggle('lit', s > 0.15);
      const st = $('calib-status');
      if (tilt.active) st.textContent = tilt.dirLearned ? `✓ הכיוון זוהה. סובב שמאלה וימינה כדי לוודא (${tilt.previewDeg.toFixed(0)}°)`
        : tilt.dirTest ? `חיישן פעיל ✓  מחכה שתטה ימינה… (${tilt.previewDeg.toFixed(0)}°)` : `חיישן פעיל ✓  (${tilt.previewDeg.toFixed(0)}°)`;
      else if (performance.now() - openedAt > 1500) st.textContent = 'לא מזוהים חיישני תנועה. אפשר להמשיך עם מקלדת או מגע (נגיעה בצד שמאל / ימין).';
      else st.textContent = 'בודק חיישנים…';
      st.classList.toggle('bad', !tilt.active && performance.now() - openedAt > 1500);
    },
  };
  return api;
}
