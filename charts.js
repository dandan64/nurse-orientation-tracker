// Shared by index.html (app) and processed/progress.html (standalone, inlined by server.py).

const META = {
  skills: [
    { key: 'safety', title: 'בטיחות מטופל ושיפוט קליני', desc: 'מזהה הידרדרות נשימתית (סטורציה, מצוקה, שינוי הכרה), מגיבה בזמן ויודעת מתי לקרוא לעזרה.' },
    { key: 'respiratory', title: 'מיומנויות נשימתיות', desc: 'טיפול בטרכאוסטומיה, סקשן, חמצן ומכשירי הנשמה, הבנה ותגובה נכונה לאזעקות.' },
    { key: 'meds', title: 'תרופות, נהלים ותיעוד', desc: 'מתן תרופות בטוח לפי הנהלים, מניעת זיהומים, תיעוד מלא ומדויק.' },
    { key: 'time', title: 'ניהול זמן וסדרי עדיפויות', desc: 'מנהלת את כל המטופלים שלה במשמרת, קובעת עדיפויות ומסיימת משימות.' },
    { key: 'communication', title: 'תקשורת ועבודת צוות', desc: 'מול מטופלים, משפחות, רופאים וצוות; מוסרת דיווח ברור ומקבלת משוב.' },
  ],
  scale: { 1: 'לא בטוח', 2: 'הנחיה צמודה', 3: 'צריכה גיבוי', 4: 'עצמאית' },
  recs: [
    { key: 'continue', label: 'להמשיך כרגיל', color: '#0ca30c', icon: '✓' },
    { key: 'continue_reinforce', label: 'להמשיך עם חיזוק בנקודות', color: '#fab219', icon: '!' },
    { key: 'concern', label: 'יש חשש – לדון', color: '#ec835a', icon: '?' },
    { key: 'stop', label: 'לא מומלץ להמשיך', color: '#d03b3b', icon: '✕' },
  ],
  decisions: [
    { key: 'complete', label: 'סיום אוריינטציה' },
    { key: 'continue', label: 'המשך אוריינטציה' },
    { key: 'extend', label: 'הארכת אוריינטציה' },
    { key: 'discuss', label: 'לדיון' },
  ],
  shifts: ['בוקר', 'ערב', 'לילה'],
};
const SERIES = ['#2a78d6']; // slot 1 of the validated reference palette

const esc = s => String(s ?? '').replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
const ddmm = iso => iso.slice(8, 10) + '/' + iso.slice(5, 7);
const fmt = v => v == null ? '—' : (Math.round(v * 10) / 10).toString();
const recOf = k => META.recs.find(r => r.key === k);
const decOf = k => META.decisions.find(d => d.key === k);

// Line chart on the fixed 1-4 scale. null values leave a gap in the line.
// Time runs right-to-left (oldest on the right) to match the Hebrew page; scale labels sit on the right.
function lineChart({ labels, tips, series, refLine }) {
  const W = 760, H = 290, L = 24, R = 120, T = 16, B = 44;
  const w = W - L - R, h = H - T - B, n = labels.length;
  const x = i => W - R - (n === 1 ? w / 2 : i * w / (n - 1));
  const y = v => T + (4 - v) / 3 * h;
  let s = `<svg viewBox="0 0 ${W} ${H}" class="chart" direction="ltr" role="img">`; // ltr so text-anchor means what it says
  for (let v = 1; v <= 4; v++) {
    s += `<line x1="${L}" x2="${W - R}" y1="${y(v)}" y2="${y(v)}" class="${v === 1 ? 'axis' : 'grid'}"/>`;
    s += `<text x="${W - R + 10}" y="${y(v) + 4}" text-anchor="start" class="tick">${v} · ${META.scale[v]}</text>`;
  }
  if (refLine) s += `<line x1="${L}" x2="${W - R}" y1="${y(refLine)}" y2="${y(refLine)}" class="ref"/>`;
  const every = Math.ceil(n / 12);
  labels.forEach((lab, i) => {
    if (i % every === 0 || i === n - 1)
      s += `<text x="${x(i)}" y="${H - B + 20}" text-anchor="middle" class="tick">${esc(lab)}</text>`;
  });
  series.forEach(se => {
    let d = '', pen = false;
    se.values.forEach((v, i) => {
      if (v == null) { pen = false; return; }
      d += (pen ? 'L' : 'M') + x(i).toFixed(1) + ' ' + y(v).toFixed(1) + ' ';
      pen = true;
    });
    if (d) s += `<path d="${d}" fill="none" stroke="${se.color}" stroke-width="2" stroke-linejoin="round" stroke-linecap="round"/>`;
    se.values.forEach((v, i) => {
      if (v == null) return;
      s += `<g class="pt"><circle cx="${x(i)}" cy="${y(v)}" r="12" fill="transparent"/>` +
        `<circle cx="${x(i)}" cy="${y(v)}" r="4" fill="${se.color}" stroke="#fcfcfb" stroke-width="2"/>` +
        `<title>${esc(se.name)} — ${esc(tips[i])}: ${fmt(v)}</title></g>`;
    });
  });
  return s + '</svg>';
}

// Skill x shift grid. Scores are whole numbers 1-4, so a grid reads far better than overlapping lines.
// One-hue ordinal ramp (light = weak, dark = independent); the number is printed in every cell, so color is never alone.
const SCORE_BG = { 1: '#cde2fb', 2: '#86b6ef', 3: '#2a78d6', 4: '#104281' };
const SCORE_INK = { 1: '#0b0b0b', 2: '#0b0b0b', 3: '#ffffff', 4: '#ffffff' };

function heatmap(S) {
  const sh = S.shifts;
  const head = sh.map(s => `<th title="${esc(`שבוע ${s.week} · ${s.senior}`)}">${ddmm(s.date)}<small>${esc(s.shift)}</small></th>`).join('');
  const cell = (v, tip) => v == null
    ? `<td class="na" title="${esc(tip)}: לא נצפה">—</td>`
    : `<td style="background:${SCORE_BG[v]};color:${SCORE_INK[v]}" title="${esc(tip)}: ${v} · ${META.scale[v]}">${v}</td>`;
  const rows = META.skills.map(sk => `<tr><th>${sk.title}</th>` +
    sh.map(s => cell(s.scores[sk.key], `${sk.title} · ${ddmm(s.date)} ${s.shift}`)).join('') + '</tr>').join('');
  const avg = '<tr class="sep"><th>ממוצע</th>' + sh.map(s => `<td class="avg">${fmt(s.avg)}</td>`).join('') + '</tr>';
  const rec = '<tr><th>המלצה</th>' + sh.map(s => { const r = recOf(s.recommendation);
    return `<td><span class="rec-dot sm" style="background:${r.color}" title="${esc(`${r.label} · ${s.senior}`)}">${r.icon}</span></td>`; }).join('') + '</tr>';
  const key = '<div class="legend">' + [1, 2, 3, 4].map(v =>
    `<span><b class="swatch" style="background:${SCORE_BG[v]};color:${SCORE_INK[v]}">${v}</b>${META.scale[v]}</span>`).join('') +
    '<span><b class="swatch na">—</b>לא נצפה</span></div>';
  return `${key}<div class="table-wrap heat-wrap"><table class="heat"><thead><tr><th></th>${head}</tr></thead><tbody>${rows}${avg}${rec}</tbody></table></div>`;
}

// opts.canVoid: the app (not progress.html) shows a "cancel form" button per shift.
function renderDashboard(S, el, opts = {}) {
  const sh = S.shifts;
  const latestRec = sh.length ? recOf(sh[sh.length - 1].recommendation) : null;
  const latestDec = S.decisions.length ? S.decisions[S.decisions.length - 1] : null;
  // Focus area = skill with the lowest average over its last 3 observed shifts.
  const focus = META.skills.filter(sk => S.skills[sk.key].last3_avg != null)
    .sort((a, b) => S.skills[a.key].last3_avg - S.skills[b.key].last3_avg)[0];
  let html = `<header class="dash-head"><h2>${esc(S.trainee_name)}</h2>
    <p class="muted">עודכן ${esc(S.generated_at.replace('T', ' '))}${S.superseded_count ? ` · ${S.superseded_count} טפסים הוחלפו בטופס חדש יותר לאותה משמרת` : ''}${S.voided_count ? ` · ${S.voided_count} טפסים בוטלו` : ''}</p>
    ${(S.bad_files || []).length ? `<p class="msg err">קובץ פגום, לא נכלל בסיכום: ${S.bad_files.map(esc).join(', ')}</p>` : ''}</header>
    <div class="stats">
      <div class="stat"><span>משמרות</span><b>${S.shift_count}</b></div>
      <div class="stat"><span>שבוע נוכחי</span><b>${S.current_week ?? '—'}</b></div>
      <div class="stat"><span>חונכות</span><b>${S.seniors.length}</b></div>
      <div class="stat"><span>המלצה אחרונה</span><b>${latestRec ? `<span class="rec-dot" style="background:${latestRec.color}">${latestRec.icon}</span> ${latestRec.label}` : '—'}</b></div>
      <div class="stat"><span>תחום לחיזוק</span><b>${focus ? `${focus.title} <small>(${fmt(S.skills[focus.key].last3_avg)})</small>` : '—'}</b></div>
      <div class="stat"><span>החלטה אחרונה</span><b>${latestDec ? esc(decOf(latestDec.decision).label) : '—'}</b></div>
    </div>`;

  if (!sh.length) {
    el.innerHTML = html + '<p class="empty">עדיין אין משובים לאחות זו.</p>' + decisionsHtml(S);
    return;
  }

  const labels = sh.map(s => ddmm(s.date));
  const tips = sh.map(s => `${ddmm(s.date)} ${s.shift}`);

  html += `<section class="card"><h3>מפת התקדמות לפי תחום</h3>
    <p class="muted">כל עמודה היא משמרת (הישנה מימין). כהה יותר = עצמאית יותר.</p>${heatmap(S)}
    <div class="legend">` + META.recs.map(r =>
      `<span><span class="rec-dot sm" style="background:${r.color}">${r.icon}</span>${r.label}: <b>${S.rec_counts[r.key]}</b></span>`).join('') + `</div></section>`;

  html += `<section class="card"><h3>ממוצע כללי למשמרת</h3>
    <p class="muted">הקו המקווקו = 3 (עצמאית ברוב המקרים, צריכה גיבוי).</p>
    <div class="chart-wrap">${lineChart({ labels, tips, refLine: 3, series: [{ name: 'ממוצע', color: SERIES[0], values: sh.map(s => s.avg) }] })}</div></section>`;

  html += `<section class="card"><h3>סיכום לפי תחום</h3><div class="table-wrap"><table>
    <thead><tr><th>תחום</th><th>ראשון</th><th>אחרון</th><th>ממוצע 3 אחרונות</th><th>שינוי</th><th>נצפה</th></tr></thead><tbody>` +
    META.skills.map(sk => {
      const k = S.skills[sk.key];
      const diff = k.first != null && k.latest != null ? k.latest - k.first : null;
      const arrow = diff == null ? '—' : diff > 0 ? `<span class="up">▲ ${diff}</span>` : diff < 0 ? `<span class="down">▼ ${-diff}</span>` : '=';
      return `<tr><td>${sk.title}</td><td>${fmt(k.first)}</td><td>${fmt(k.latest)}</td><td>${fmt(k.last3_avg)}</td><td>${arrow}</td><td>${k.observed}/${S.shift_count}</td></tr>`;
    }).join('') + '</tbody></table></div></section>';

  html += `<section class="card"><h3>הערות החונכות</h3>` +
    (S.notes.length ? '<ul class="notes">' + S.notes.map(n =>
      `<li><div class="muted">${ddmm(n.date)} ${esc(n.shift)} · ${esc(n.senior)}</div>${esc(n.text)}</li>`).join('') + '</ul>'
      : '<p class="muted">אין הערות.</p>') + '</section>';

  html += decisionsHtml(S);

  html += `<details class="card"><summary>כל המשמרות (טבלה)</summary><div class="table-wrap"><table>
    <thead><tr><th>תאריך</th><th>משמרת</th><th>שבוע</th><th>חונכת</th>${META.skills.map(sk => `<th>${sk.title}</th>`).join('')}<th>ממוצע</th><th>המלצה</th>${opts.canVoid ? '<th></th>' : ''}</tr></thead><tbody>` +
    sh.map(s => `<tr><td>${ddmm(s.date)}</td><td>${esc(s.shift)}</td><td>${s.week}</td><td>${esc(s.senior)}</td>` +
      META.skills.map(sk => `<td>${fmt(s.scores[sk.key])}</td>`).join('') +
      `<td>${fmt(s.avg)}</td><td>${recOf(s.recommendation).label}</td>` +
      (opts.canVoid ? `<td><button type="button" class="btn ghost sm" data-void="${esc(s.file)}" data-label="${ddmm(s.date)} ${esc(s.shift)} · ${esc(s.senior)}">ביטול טופס</button></td>` : '') +
      '</tr>').join('') +
    '</tbody></table></div></details>';

  el.innerHTML = html;
  el.querySelectorAll('.heat-wrap').forEach(w => { w.scrollLeft = -w.scrollWidth; }); // RTL: open on the newest shifts
}

function decisionsHtml(S) {
  return `<section class="card"><h3>היסטוריית החלטות</h3>` +
    (S.decisions.length ? '<ul class="notes">' + S.decisions.slice().reverse().map(d =>
      `<li><div class="muted">${esc(d.decided_at.slice(0, 16).replace('T', ' '))} · ${esc(d.decider_name)}</div><b>${esc(decOf(d.decision).label)}</b>${d.note ? ' — ' + esc(d.note) : ''}</li>`).join('') + '</ul>'
      : '<p class="muted">עדיין לא נרשמה החלטה.</p>') + '</section>';
}
