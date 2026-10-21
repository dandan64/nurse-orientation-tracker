// store.js - the data layer. Everything is saved as JSON files in a folder on THIS PC that the
// nurse picks once (File System Access API, Edge/Chrome). Nothing is ever sent over the network:
// the website only delivers the page; the data never leaves the ward PC.
//
// Folder layout (same as the old exe version):
//   nurses.json
//   trainees/<id>/raw/<date>_<shift>_<stamp>.json      one file per form (never overwritten)
//   trainees/<id>/voids/<stamp>.json                   one file per cancelled form
//   trainees/<id>/decisions/<stamp>.json               one file per decision
//   trainees/<id>/processed/summary.json + progress.html   rebuilt after every change

const SKILLS = META.skills.map(s => s.key);   // codes come from charts.js META: one source of truth
const RECS = META.recs.map(r => r.key);
const DECISIONS = META.decisions.map(d => d.key);
const SHIFTS = META.shifts;
const MAX_NOTE = 2000;

const Store = (() => {
  let root = null;            // FileSystemDirectoryHandle of the data folder
  let assets = null;          // style.css + charts.js text, inlined into progress.html

  const fail = msg => { throw new Error(msg); };
  const pad = (n, w = 2) => String(n).padStart(w, '0');
  const localIso = (d = new Date()) =>
    `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}T${pad(d.getHours())}:${pad(d.getMinutes())}:${pad(d.getSeconds())}.${pad(d.getMilliseconds(), 3)}`;
  const today = () => localIso().slice(0, 10);
  const stamp = () => localIso().replace(/[-:.]/g, '');
  // Web Locks: one write at a time, even with the page open in two tabs.
  const locked = fn => navigator.locks.request('nurse-tracker-write', fn);

  // ---------- files ----------
  async function dir(parts, create = true) {
    let d = root;
    for (const p of parts) d = await d.getDirectoryHandle(p, { create });
    return d;
  }
  async function writeText(parts, name, text) {
    const f = await (await dir(parts)).getFileHandle(name, { create: true });
    const w = await f.createWritable();   // writes to a temp file; replaces the real file only on close()
    await w.write(text);
    await w.close();
  }
  const writeJson = (parts, name, obj) => writeText(parts, name, JSON.stringify(obj, null, 2));
  const decode = buf => new TextDecoder('utf-8', { fatal: true }).decode(buf);

  async function readJson(parts, name, dflt) {
    let f;
    try { f = await (await dir(parts, false)).getFileHandle(name); }
    catch (e) { if (e.name === 'NotFoundError' || e.name === 'TypeMismatchError') return dflt; throw e; }
    return JSON.parse(decode(await (await f.getFile()).arrayBuffer())); // damaged file -> error, never "empty"
  }
  async function jsonNames(parts) {
    let d;
    try { d = await dir(parts, false); } catch (e) { if (e.name === 'NotFoundError') return []; throw e; }
    const out = [];
    for await (const [name, h] of d.entries()) if (h.kind === 'file' && name.endsWith('.json')) out.push(name);
    return out.sort();
  }

  // ---------- nurses ----------
  const loadNurses = () => readJson([], 'nurses.json', { trainees: [], seniors: [] });

  function cleanName(nurses, kind, name, id = null) {
    name = String(name ?? '').split(/\s+/).filter(Boolean).join(' ');
    if (!name || name.length > 80) fail('שם לא חוקי');
    if (nurses[kind].some(n => n.name === name && n.id !== id)) fail('השם כבר קיים');
    return name;
  }
  function makeId(name, taken) {
    // letters (any language), digits, _ and - only: safe as a Windows folder name
    const base = name.trim().replace(/[^\p{L}\p{N}_-]+/gu, '_').replace(/^_+|_+$/g, '') || 'nurse';
    let id = base, n = 2;
    while (taken.has(id)) id = `${base}_${n++}`;
    return id;
  }
  function nameOf(nurses, kind, id) {
    const n = nurses[kind].find(n => n.id === id);
    return n ? n.name : fail(kind === 'trainees' ? 'אחות חדשה לא קיימת' : 'אחות חונכת לא קיימת');
  }
  const checkKind = k => (k === 'trainees' || k === 'seniors') ? k : fail('סוג לא חוקי');
  const tpath = id => ['trainees', id];

  // ---------- validation ----------
  function validDate(s) {
    if (typeof s !== 'string' || !/^\d{4}-\d{2}-\d{2}$/.test(s)) return false;
    const [y, m, d] = s.split('-').map(Number), dt = new Date(y, m - 1, d);
    return dt.getFullYear() === y && dt.getMonth() === m - 1 && dt.getDate() === d;
  }
  const isScore = v => v === null || [1, 2, 3, 4].includes(v);

  function validateFeedback(b, nurses, now = today()) {
    if (!b || typeof b !== 'object') fail('גוף בקשה לא חוקי');
    const trainee_name = nameOf(nurses, 'trainees', b.trainee_id);
    const senior_name = nameOf(nurses, 'seniors', b.senior_id);
    if (!validDate(b.shift_date)) fail('תאריך לא חוקי');
    if (b.shift_date > now) fail('תאריך עתידי');
    if (!SHIFTS.includes(b.shift)) fail('משמרת לא חוקית');
    if (!Number.isInteger(b.week) || b.week < 1 || b.week > 52) fail('שבוע באוריינטציה חייב להיות 1-52');
    const sc = b.scores;
    if (!sc || typeof sc !== 'object' || Object.keys(sc).sort().join() !== [...SKILLS].sort().join()) fail('חסר ציון לאחד הסעיפים');
    if (!SKILLS.every(k => isScore(sc[k]))) fail('ציון לא חוקי');
    if (!RECS.includes(b.recommendation)) fail('חסרה המלצה להמשך');
    const note = b.note ?? '';
    if (typeof note !== 'string' || note.length > MAX_NOTE) fail('הערה ארוכה מדי');
    return {
      submitted_at: localIso(), trainee_id: b.trainee_id, trainee_name, senior_id: b.senior_id, senior_name,
      shift_date: b.shift_date, shift: b.shift, week: b.week,
      scores: Object.fromEntries(SKILLS.map(k => [k, sc[k]])), recommendation: b.recommendation, note: note.trim(),
    };
  }

  // ---------- reading records (a damaged file is skipped and reported, never fatal) ----------
  const isStr = v => typeof v === 'string';
  const rawOk = r => r.scores && typeof r.scores === 'object' && SKILLS.every(k => k in r.scores && isScore(r.scores[k]))
    && SHIFTS.includes(r.shift) && RECS.includes(r.recommendation) && Number.isInteger(r.week)
    && ['shift_date', 'submitted_at', 'senior_name', 'note'].every(k => isStr(r[k]));
  const decisionOk = r => DECISIONS.includes(r.decision) && ['decided_at', 'decider_name', 'note'].every(k => isStr(r[k]));
  const voidOk = r => isStr(r.file) && isStr(r.voided_at);

  async function loadRecords(parts, ok, bad) {
    const out = [], d = await dir(parts, false).catch(() => null);
    if (!d) return out;
    for (const name of await jsonNames(parts)) {
      try {
        const r = JSON.parse(decode(await (await (await d.getFileHandle(name)).getFile()).arrayBuffer()));
        if (!r || typeof r !== 'object' || Array.isArray(r) || !ok(r)) throw 0;
        r._file = name;
        out.push(r);
      } catch { bad.push(`${parts[parts.length - 1]}/${name}`); }
    }
    return out;
  }

  // ---------- processing ----------
  async function summarize(tid, trainee_name, seniorNames = {}) {
    const bad = [], base = tpath(tid);
    const voided = new Set((await loadRecords([...base, 'voids'], voidOk, bad)).map(v => v.file));
    let raws = await loadRecords([...base, 'raw'], rawOk, bad);
    const voided_count = raws.filter(r => voided.has(r._file)).length;
    raws = raws.filter(r => !voided.has(r._file));
    // Same date+shift saved twice: the newest submitted_at wins (that is how corrections work).
    const latest = new Map();
    for (const r of raws) {
      const key = r.shift_date + '|' + r.shift, cur = latest.get(key);
      if (!cur || r.submitted_at > cur.submitted_at) latest.set(key, r);
    }
    const rows = [...latest.values()].sort((a, b) =>
      a.shift_date < b.shift_date ? -1 : a.shift_date > b.shift_date ? 1 : SHIFTS.indexOf(a.shift) - SHIFTS.indexOf(b.shift));
    const round2 = x => Math.round(x * 100) / 100;
    const mean = a => a.length ? round2(a.reduce((s, v) => s + v, 0) / a.length) : null;

    const shifts = rows.map(r => {
      const seen = SKILLS.map(k => r.scores[k]).filter(v => v !== null);
      return {
        date: r.shift_date, shift: r.shift, week: r.week, file: r._file,
        senior: seniorNames[r.senior_id] ?? r.senior_name,   // current name, so a rename shows everywhere
        scores: r.scores, avg: mean(seen), recommendation: r.recommendation, note: r.note,
      };
    });
    const skills = {};
    for (const k of SKILLS) {
      const vals = shifts.map(s => s.scores[k]).filter(v => v !== null);
      skills[k] = { first: vals[0] ?? null, latest: vals.at(-1) ?? null, last3_avg: mean(vals.slice(-3)), observed: vals.length };
    }
    const decisions = await loadRecords([...base, 'decisions'], decisionOk, bad);
    return {
      trainee_name,
      generated_at: localIso().slice(0, 19),
      shift_count: shifts.length,
      superseded_count: raws.length - shifts.length,
      voided_count,
      bad_files: bad,
      current_week: shifts.length ? Math.max(...shifts.map(s => s.week)) : null,
      seniors: [...new Set(shifts.map(s => s.senior))].sort(),
      shifts,
      skills,
      rec_counts: Object.fromEntries(RECS.map(k => [k, shifts.filter(s => s.recommendation === k).length])),
      notes: shifts.filter(s => s.note).reverse().map(s => ({ date: s.date, shift: s.shift, senior: s.senior, text: s.note })),
      decisions,
    };
  }

  async function summary(tid) {
    const nurses = await loadNurses();
    const name = nameOf(nurses, 'trainees', tid);
    return summarize(tid, name, Object.fromEntries(nurses.seniors.map(n => [n.id, n.name])));
  }

  const PROGRESS = (name, css, charts, data) => `<!doctype html>
<html lang="he" dir="rtl"><head><meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>התקדמות - ${esc(name)}</title>
<style>${css}</style></head>
<body><main class="wrap"><div id="dash"></div></main>
<script>${charts}</script>
<script>renderDashboard(${data}, document.getElementById('dash'));</script>
</body></html>`;

  async function regenerate(tid) {
    const s = await summary(tid);
    await writeJson([...tpath(tid), 'processed'], 'summary.json', s);
    const data = JSON.stringify(s).replace(/<\//g, '<\\/');  // never close the <script> early
    await writeText([...tpath(tid), 'processed'], 'progress.html', PROGRESS(s.trainee_name, assets.css, assets.charts, data));
    return s;
  }

  // ---------- public API (all writes go through the lock) ----------
  return {
    SKILLS, today, validateFeedback, makeId,
    get folderName() { return root?.name; },

    async open(handle) {
      root = handle;
      if (!assets) {
        const [css, charts] = await Promise.all(['style.css', 'charts.js'].map(f => fetch(f).then(r => r.text())));
        assets = { css, charts };
      }
    },
    nurses: loadNurses,
    summary,

    addNurse: (kind, name) => locked(async () => {
      checkKind(kind);
      const nurses = await loadNurses();
      name = cleanName(nurses, kind, name);
      const nurse = { id: makeId(name, new Set(nurses[kind].map(n => n.id))), name, active: true };
      nurses[kind].push(nurse);
      await writeJson([], 'nurses.json', nurses);
      return nurse;
    }),

    // Rename and/or mark finished (trainee) / inactive (senior). The id - and so the folder - never changes.
    updateNurse: ({ kind, id, name, active }) => locked(async () => {
      checkKind(kind);
      const nurses = await loadNurses();
      const nurse = nurses[kind].find(n => n.id === id) || fail('האחות לא נמצאה');
      nurse.name = cleanName(nurses, kind, name, id);
      nurse.active = active !== false;
      await writeJson([], 'nurses.json', nurses);
      const names = new Set(await (async () => { // trainees that have a folder
        const out = []; const d = await dir(['trainees'], false).catch(() => null);
        if (d) for await (const [n, h] of d.entries()) if (h.kind === 'directory') out.push(n);
        return out;
      })());
      for (const t of kind === 'seniors' ? nurses.trainees : [nurse]) if (names.has(t.id)) await regenerate(t.id);
      return nurse;
    }),

    // Throws an error with status 409 when the shift already has a form and replace !== true.
    saveFeedback: body => locked(async () => {
      const rec = validateFeedback(body, await loadNurses());
      const tid = rec.trainee_id;
      const old = (await summary(tid)).shifts.find(s => s.date === rec.shift_date && s.shift === rec.shift);
      if (old && body.replace !== true)
        throw Object.assign(new Error(`כבר קיים משוב למשמרת זו מ-${old.senior}`), { status: 409 });
      const file = `${rec.shift_date}_${rec.shift}_${stamp()}.json`;
      await writeJson([...tpath(tid), 'raw'], file, rec);
      await regenerate(tid);
      return { ok: true, file };
    }),

    // Cancel one saved form. Nothing is deleted: a void record is appended.
    voidForm: (tid, file) => locked(async () => {
      nameOf(await loadNurses(), 'trainees', tid);
      if (!isStr(file) || !(await jsonNames([...tpath(tid), 'raw'])).includes(file)) fail('הטופס לא נמצא');
      const rec = await readJson([...tpath(tid), 'raw'], file, {}).catch(() => ({}));
      await writeJson([...tpath(tid), 'voids'], `${stamp()}.json`, {
        voided_at: localIso(), file, shift_date: rec.shift_date, shift: rec.shift, senior_name: rec.senior_name });
      return regenerate(tid);
    }),

    decide: ({ trainee_id, decision, decider_id, note }) => locked(async () => {
      const nurses = await loadNurses();
      nameOf(nurses, 'trainees', trainee_id);
      const decider_name = nameOf(nurses, 'seniors', decider_id);
      if (!DECISIONS.includes(decision)) fail('החלטה לא חוקית');
      note = note ?? '';
      if (!isStr(note) || note.length > MAX_NOTE) fail('הערה ארוכה מדי');
      await writeJson([...tpath(trainee_id), 'decisions'], `${stamp()}.json`,
        { decided_at: localIso(), decision, decider_id, decider_name, note: note.trim() });
      return regenerate(trainee_id);
    }),
  };
})();
