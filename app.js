// app.js - the page logic. Data access is in store.js; charts in charts.js.
const $ = s => document.querySelector(s);
const form = $('#form'), decide = $('#decide');
let nurses = { trainees: [], seniors: [] };

// ---- build the option buttons from META ----
$('#skills').innerHTML = META.skills.map((sk, i) => `
  <fieldset class="card"><div class="q-head"><span class="q-num">${i + 1}</span><h3>${sk.title}</h3></div>
  <p class="muted">${sk.desc}</p><div class="opts">
  ${[1, 2, 3, 4].map(v => `<label class="opt"><input type="radio" name="${sk.key}" value="${v}" required><span><b>${v}</b>${META.scale[v]}</span></label>`).join('')}
  <label class="opt"><input type="radio" name="${sk.key}" value="na"><span><b>—</b>לא נצפה</span></label>
  </div></fieldset>`).join('');
$('#recs').innerHTML = META.recs.map(r => `<label class="opt"><input type="radio" name="recommendation" value="${r.key}" required><span>${r.label}</span></label>`).join('');
$('#decs').innerHTML = META.decisions.map(d => `<label class="opt"><input type="radio" name="decision" value="${d.key}" required><span>${d.label}</span></label>`).join('');

// ---- nurse dropdowns ----
const active = n => n.active !== false;
function fillSelects() {
  document.querySelectorAll('select[data-kind]').forEach(sel => {
    const keep = sel.value, all = sel.id === 'pick'; // summary picker also lists finished trainees
    sel.innerHTML = '<option value="">בחרי…</option>' +
      nurses[sel.dataset.kind].filter(n => all || active(n))
        .map(n => `<option value="${esc(n.id)}">${esc(n.name)}${active(n) ? '' : ' (סיימה)'}</option>`).join('');
    sel.value = keep;
  });
}
async function loadNurses() { nurses = await Store.nurses(); fillSelects(); }

document.querySelectorAll('[data-add]').forEach(b => b.onclick = async () => {
  const kind = b.dataset.add;
  const name = window.prompt(kind === 'trainees' ? 'שם האחות החדשה:' : 'שם האחות החונכת:');
  if (!name || !name.trim()) return;
  try {
    const n = await Store.addNurse(kind, name);
    await loadNurses();
    form.querySelector(`select[data-kind="${kind}"]`).value = n.id;
    form.dispatchEvent(new Event('input'));
  } catch (e) { showMsg('#msg', e.message, false); }
});

function showMsg(sel, text, ok) {
  const m = $(sel); m.textContent = text; m.className = 'msg ' + (ok ? 'ok' : 'err');
}

// ---- form tab ----
const day = d => d.toLocaleDateString('sv'); // YYYY-MM-DD, local time
// Rule: a shift belongs to the date it started. A night shift filled in before noon started yesterday.
function defaultDate() {
  const d = new Date();
  if (form.shift.value === 'לילה' && d.getHours() < 12) d.setDate(d.getDate() - 1);
  return day(d);
}
let autoDate = true, dirty = false; // autoDate: the nurse has not picked a date by hand
form.shift_date.max = day(new Date());
form.shift_date.value = defaultDate();
form.shift_date.addEventListener('input', () => { autoDate = false; });
form.shift.addEventListener('change', () => { if (autoDate) form.shift_date.value = defaultDate(); });

// Draft: a half-filled form survives a refresh or a closed tab (this browser only).
const DRAFT = 'nurse-tracker-draft';
const saveDraft = () => { try { localStorage.setItem(DRAFT, JSON.stringify(Object.fromEntries(new FormData(form)))); } catch {} };
const clearDraft = () => { try { localStorage.removeItem(DRAFT); } catch {} };
function restoreDraft() {
  let d = null;
  try { d = JSON.parse(localStorage.getItem(DRAFT)); } catch {}
  if (!d || !(META.skills.some(sk => d[sk.key]) || d.recommendation || d.note)) return; // nothing worth restoring
  for (const [k, v] of Object.entries(d)) if (form.elements[k]) form.elements[k].value = v;
  autoDate = false;
  $('#save').disabled = !form.checkValidity();
  showMsg('#msg', 'טיוטה שלא נשמרה שוחזרה - בדקי שהיא שלך, או לחצי "ניקוי הטופס"', false);
}
function clearForm() {
  form.reset(); clearDraft(); autoDate = true; dirty = false;
  form.shift_date.value = defaultDate();
  $('#save').disabled = true;
}
$('#clear').onclick = () => { clearForm(); $('#msg').textContent = ''; };
window.addEventListener('beforeunload', e => { if (dirty) e.preventDefault(); });

function onEdit() {
  $('#save').disabled = !form.checkValidity();
  dirty = true; saveDraft();
  const m = $('#msg'); // old "saved" must not linger while the next form is filled
  if (m.classList.contains('ok')) { m.textContent = ''; m.className = 'msg'; }
}
form.addEventListener('input', onEdit);
form.addEventListener('change', onEdit);

form.addEventListener('submit', async e => {
  e.preventDefault();
  if (!form.checkValidity()) return;
  const f = new FormData(form);
  const scores = {};
  META.skills.forEach(sk => { const v = f.get(sk.key); scores[sk.key] = v === 'na' ? null : Number(v); });
  const body = {
    trainee_id: f.get('trainee_id'), senior_id: f.get('senior_id'),
    shift_date: f.get('shift_date'), shift: f.get('shift'), week: Number(f.get('week')),
    scores, recommendation: f.get('recommendation'), note: f.get('note'),
  };
  $('#save').disabled = true;
  try {
    let res;
    try { res = await Store.saveFeedback(body); }
    catch (err) { // 409 = this trainee already has a form for this date+shift
      if (err.status !== 409 || !confirm(err.message + '.\nלהחליף אותו בטופס הזה?')) throw err;
      res = await Store.saveFeedback({ ...body, replace: true });
    }
    const date = form.shift_date.value, auto = autoDate;
    clearForm(); form.shift_date.value = date; autoDate = auto;
    showMsg('#msg', 'המשוב נשמר ✓', true);
    const undo = document.createElement('button');
    undo.type = 'button'; undo.className = 'btn ghost sm'; undo.textContent = 'טעות? ביטול הטופס הזה';
    undo.onclick = () => voidForm(body.trainee_id, res.file, `${body.shift_date} ${body.shift}`, '#msg');
    $('#msg').append(' ', undo);
  } catch (err) {
    showMsg('#msg', err.message, false);
    $('#save').disabled = false;
  }
});

// Cancel a saved form (wrong date, wrong nurse...). The server appends a void record; nothing is deleted.
async function voidForm(tid, file, label, msgSel) {
  if (!confirm(`לבטל את הטופס ${label}?\nהטופס לא יופיע בסיכום ובגרפים (הקובץ נשמר בארכיון).`)) return;
  try {
    const s = await Store.voidForm(tid, file);
    if (msgSel === '#msg') showMsg('#msg', 'הטופס בוטל', false);
    else renderDashboard(s, $('#dash'), { canVoid: true });
  } catch (e) { showMsg(msgSel, e.message, false); }
}

// ---- summary tab ----
async function showTrainee() {
  const tid = $('#pick').value;
  decide.hidden = !tid;
  if (!tid) { $('#dash').innerHTML = ''; return; }
  try {
    renderDashboard(await Store.summary(tid), $('#dash'), { canVoid: true });
    $('#filepath').textContent = `קובץ התקדמות עצמאי: ${Store.folderName}\\trainees\\${tid}\\processed\\progress.html`;
  } catch (e) { $('#dash').innerHTML = `<p class="msg err">${esc(e.message)}</p>`; }
}
$('#pick').onchange = showTrainee;
$('#dash').addEventListener('click', e => {
  const b = e.target.closest('[data-void]');
  if (b) voidForm($('#pick').value, b.dataset.void, b.dataset.label, '#dmsg');
});

decide.addEventListener('change', () => { $('#dsave').disabled = !decide.checkValidity(); });
decide.addEventListener('submit', async e => {
  e.preventDefault();
  const f = new FormData(decide);
  $('#dsave').disabled = true;
  try {
    renderDashboard(await Store.decide({
      trainee_id: $('#pick').value, decision: f.get('decision'), decider_id: f.get('decider_id'), note: f.get('note'),
    }), $('#dash'), { canVoid: true });
    decide.reset();
    showMsg('#dmsg', 'ההחלטה נשמרה ✓', true);
  } catch (err) { showMsg('#dmsg', err.message, false); $('#dsave').disabled = false; }
});

// ---- tabs ----
document.querySelectorAll('[data-tab]').forEach(t => t.onclick = () => {
  document.querySelectorAll('[data-tab]').forEach(x => x.setAttribute('aria-selected', x === t));
  document.querySelectorAll('[data-panel]').forEach(p => p.hidden = p.dataset.panel !== t.dataset.tab);
  if (t.dataset.tab === 'summary') showTrainee();
  if (t.dataset.tab === 'manage') renderManage();
  $('#msg').textContent = ''; $('#dmsg').textContent = ''; $('#mmsg').textContent = '';
});

// ---- manage nurses tab: rename, finished / inactive ----
function renderManage() {
  for (const kind of ['trainees', 'seniors']) {
    $('#m-' + kind).innerHTML = '<thead><tr><th>שם</th><th></th><th></th></tr></thead><tbody>' +
      nurses[kind].map(n => `<tr data-kind="${kind}" data-id="${esc(n.id)}">
        <td><input type="text" value="${esc(n.name)}" maxlength="80" aria-label="שם"></td>
        <td><label><input type="checkbox" ${active(n) ? '' : 'checked'}> ${kind === 'trainees' ? 'סיימה אוריינטציה' : 'לא פעילה'}</label></td>
        <td><button type="button" class="btn ghost sm">שמירה</button></td></tr>`).join('') +
      (nurses[kind].length ? '' : '<tr><td colspan="3" class="muted">אין עדיין.</td></tr>') + '</tbody>';
  }
}
document.querySelectorAll('.manage table').forEach(t => t.addEventListener('click', async e => {
  if (!e.target.matches('button')) return;
  const tr = e.target.closest('tr');
  try {
    await Store.updateNurse({ kind: tr.dataset.kind, id: tr.dataset.id,
      name: tr.querySelector('input[type=text]').value, active: !tr.querySelector('input[type=checkbox]').checked });
    await loadNurses(); renderManage();
    showMsg('#mmsg', 'נשמר ✓', true);
  } catch (err) { showMsg('#mmsg', err.message, false); }
}));

// ---- data folder: picked once; the browser remembers the folder (IndexedDB keeps the handle, not the data) ----
function idb(mode, fn) {
  return new Promise((ok, bad) => {
    const r = indexedDB.open('nurse-tracker', 1);
    r.onupgradeneeded = () => r.result.createObjectStore('kv');
    r.onerror = () => bad(r.error);
    r.onsuccess = () => {
      const tx = r.result.transaction('kv', mode), q = fn(tx.objectStore('kv'));
      tx.oncomplete = () => ok(q.result);
      tx.onerror = () => bad(tx.error);
    };
  });
}

async function start(handle) {
  await Store.open(handle);
  $('#connect').hidden = true; $('#app').hidden = false;
  $('#foldername').textContent = handle.name;
  await loadNurses();
  restoreDraft();
}

async function pickFolder() {
  try {
    const h = await window.showDirectoryPicker({ id: 'nurse-data', mode: 'readwrite', startIn: 'documents' });
    // Guard against picking e.g. "Documents" itself: a folder with other files and no tracker data.
    let ours = false, other = false;
    for await (const name of h.keys()) name === 'nurses.json' ? ours = true : other = true;
    if (other && !ours && !confirm(`בתיקייה "${h.name}" יש קבצים אחרים ואין בה נתוני מעקב.\nלהשתמש בה בכל זאת? (מומלץ: תיקייה ריקה חדשה בשם NurseTracker-data)`)) return;
    await idb('readwrite', s => s.put(h, 'folder'));
    await start(h);
  } catch (e) {
    if (e.name !== 'AbortError') showMsg($('#app').hidden ? '#cmsg' : '#msg', e.message, false);
  }
}
$('#pickfolder').onclick = pickFolder;
$('#change').onclick = pickFolder;

async function boot() {
  // ponytail: test hook for test_web.py - uses the browser's private test folder instead of a real one.
  if (new URLSearchParams(location.search).has('test-opfs')) {
    $('#testbanner').hidden = false;
    return start(await navigator.storage.getDirectory());
  }
  if (!window.showDirectoryPicker) { $('#nosupport').hidden = false; return; }
  const h = await idb('readonly', s => s.get('folder')).catch(() => null);
  if (h && await h.queryPermission({ mode: 'readwrite' }) === 'granted') return start(h);
  $('#connect').hidden = false;
  if (!h) $('#pickfolder').className = 'btn'; // first use: choosing a folder is the main action
  if (h) { // the browser asks again after a restart: one click to allow
    const b = $('#reconnect');
    b.hidden = false;
    b.textContent = `חיבור לתיקייה "${h.name}"`;
    b.onclick = async () => {
      try { if (await h.requestPermission({ mode: 'readwrite' }) === 'granted') await start(h); }
      catch (e) { showMsg('#cmsg', 'התיקייה לא נמצאה - בחרי אותה מחדש. ' + e.message, false); }
    };
  }
}
boot().catch(e => { $('#connect').hidden = false; showMsg('#cmsg', e.message, false); });

// Offline: the page itself is cached by sw.js, so it still opens when the internet is down.
if ('serviceWorker' in navigator && location.protocol === 'https:') navigator.serviceWorker.register('sw.js');
