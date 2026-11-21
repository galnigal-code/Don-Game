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
        <ol id="calib-steps">
          <li data-s="neutral"><span class="n"><span class="num">1</span></span>החזק ישר ויציב</li>
          <li data-s="right"><span class="n"><span class="num">2</span></span>הטה <b>ימינה</b> והחזק</li>
          <li data-s="left"><span class="n"><span class="num">3</span></span>הטה <b>שמאלה</b> והחזק</li>
          <li data-s="center"><span class="n"><span class="num">4</span></span>חזור למרכז והחזק</li>
        </ol>
        <p class="note">ימינה = הצד הימני של הטלפון יורד, כמו הגה ימינה</p>
        <div class="gauge" dir="ltr">
          <span id="lbl-left">◀ שמאלה</span>
          <div class="gtrack"><div class="gmid"></div><div class="gdot" id="gdot"></div></div>
          <span id="lbl-right">ימינה ▶</span>
        </div>
        <div class="status" id="calib-status"></div>
        <div class="row">
          <div class="seg" id="seg-sens">
            <button data-v="low">נמוכה</button><button data-v="normal">רגילה</button><button data-v="high">גבוהה</button>
          </div>
          <button class="ghost" id="btn-invert">↔ הפוך כיוון</button>
          <button class="ghost" id="btn-redo">כיול מחדש</button>
        </div>
        <button class="big" id="btn-start" disabled>התחל</button>
        <p class="hint" id="hint-calib" hidden>לחוויה הכי טובה החזק את הטלפון לרוחב</p>
      </div>
    </div>`;
  root.appendChild(el);
  const $ = (id) => el.querySelector('#' + id);
  const menu = $('scr-menu'), calib = $('scr-calib');

  $('btn-play').addEventListener('click', () => onPlay());
  $('btn-start').addEventListener('click', () => onStart());
  $('btn-invert').addEventListener('click', () => tilt.flipDirection());
  $('btn-redo').addEventListener('click', () => tilt.beginProtocol());
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
      tilt.beginProtocol();
    },
    hide() { visible = null; menu.hidden = true; calib.hidden = true; },
    /** call every frame */
    update() {
      if (visible !== 'calib') return;
      tilt.updateProtocol();
      const s = tilt.previewSteer;
      $('gdot').style.left = (50 + s * 46) + '%';
      $('lbl-left').classList.toggle('lit', s < -0.15);
      $('lbl-right').classList.toggle('lit', s > 0.15);
      // which side the player is asked to tilt now
      $('lbl-left').classList.toggle('ask', tilt.active && tilt.step === 'left');
      $('lbl-right').classList.toggle('ask', tilt.active && tilt.step === 'right');
      const idx = tilt.stepIndex;
      el.querySelectorAll('#calib-steps li').forEach((li, i) => {
        li.classList.toggle('done', tilt.active && i < idx);
        li.classList.toggle('now', tilt.active && i === idx);
      });
      const st = $('calib-status');
      const noSensor = !tilt.active && performance.now() - openedAt > 1500;
      let text = 'בודק חיישנים…';
      if (tilt.active) {
        const d = `${tilt.previewDeg.toFixed(0)}°`;
        text = {
          neutral: `החזק ישר ויציב… (${d})`,
          right: `עכשיו הטה ימינה והחזק (${d})`,
          left: `✓ ימינה נקלט. עכשיו הטה שמאלה והחזק (${d})`,
          center: `✓ שמאלה נקלט. חזור למרכז והחזק (${d})`,
          done: '✓ הכיול הושלם. אפשר להתחיל',
        }[tilt.step];
      } else if (noSensor) text = 'לא מזוהים חיישני תנועה. אפשר להמשיך עם מקלדת או מגע (נגיעה בצד שמאל / ימין).';
      if (st.textContent !== text) st.textContent = text;
      st.classList.toggle('bad', noSensor);
      st.classList.toggle('ok', tilt.step === 'done' && tilt.active);
      const startBtn = $('btn-start');
      const canStart = tilt.ready;           // finished, or no sensor at all
      if (startBtn.disabled === canStart) startBtn.disabled = !canStart;
    },
  };
  return api;
}
