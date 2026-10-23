// store.js - the data layer. Everything is saved as JSON files in a folder on THIS PC that the
// nurse picks once (File System Access API, Edge/Chrome). Nothing is ever sent over the network:
// the website only delivers the page; the data never leaves the ward PC.
//
// Folder layout (every file is SCRAMBLED - unreadable in File Explorer, see scramble() below):
//   nurses.json
//   settings.json                                      admin password + recovery code (hashed)
//   trainees/<id>/raw/<date>_<shift>_<stamp>.json      one file per form (never overwritten)
//   trainees/<id>/voids/<stamp>.json                   one file per cancelled form
//   trainees/<id>/decisions/<stamp>.json               one file per decision
// Summaries are computed live, only after the admin password is entered. No plain-text summary file is kept.

const SKILLS = META.skills.map(s => s.key);   // codes come from charts.js META: one source of truth
const RECS = META.recs.map(r => r.key);
const DECISIONS = META.decisions.map(d => d.key);
const SHIFTS = META.shifts;
const MAX_NOTE = 2000;

const Store = (() => {
  let root = null;            // FileSystemDirectoryHandle of the data folder
  let password = null;        // admin password while unlocked (in memory only; used for the PDF password)

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
  const decode = buf => new TextDecoder('utf-8', { fatal: true }).decode(buf);

  // ---------- scrambling ----------
  // ponytail: SCRAMBLING, not real secrecy (agreed with the head nurse). Files are unreadable in File Explorer,
  // but the key is in this public code, so a technical person could unscramble them. Chosen on purpose:
  // no forgotten password or lost code can ever lock the data away. Real encryption = a key that can be lost.
  const MAGIC = 'NTX1:';
  let aesKey = null;
  const getKey = async () => aesKey ??= crypto.subtle.importKey('raw',
    await crypto.subtle.digest('SHA-256', new TextEncoder().encode('nurse-orientation-tracker/scramble/v1')),
    'AES-GCM', false, ['encrypt', 'decrypt']);
  const toB64 = bytes => { let s = ''; for (let i = 0; i < bytes.length; i += 0x8000) s += String.fromCharCode(...bytes.subarray(i, i + 0x8000)); return btoa(s); };
  const fromB64 = b64 => Uint8Array.from(atob(b64), c => c.charCodeAt(0));
  async function scramble(text) {
    const iv = crypto.getRandomValues(new Uint8Array(12));
    const ct = new Uint8Array(await crypto.subtle.encrypt({ name: 'AES-GCM', iv }, await getKey(), new TextEncoder().encode(text)));
    const all = new Uint8Array(12 + ct.length); all.set(iv); all.set(ct, 12);
    return MAGIC + toB64(all);
  }
  async function unscramble(text) {
    if (!text.startsWith(MAGIC)) return text;   // a plain file (older version, or hand-made)
    const all = fromB64(text.slice(MAGIC.length));
    // AES-GCM also detects a changed or cut file: it throws, and the file is reported as damaged
    return new TextDecoder().decode(await crypto.subtle.decrypt({ name: 'AES-GCM', iv: all.subarray(0, 12) }, await getKey(), all.subarray(12)));
  }
  const parseFile = async f => JSON.parse(await unscramble(decode(await (await f.getFile()).arrayBuffer())));
  const writeJson = async (parts, name, obj) => writeText(parts, name, await scramble(JSON.stringify(obj, null, 2)));

  async function readJson(parts, name, dflt) {
    let f;
    try { f = await (await dir(parts, false)).getFileHandle(name); }
    catch (e) { if (e.name === 'NotFoundError' || e.name === 'TypeMismatchError') return dflt; throw e; }
    return parseFile(f); // damaged file -> error, never "empty"
  }

  // Older versions saved plain files plus plain summaries. Scramble the files, delete the plain summaries.
  async function migrate(d = root, depth = 0) {
    for await (const [name, h] of d.entries()) {
      if (h.kind === 'directory') {
        if (depth === 2 && name === 'processed') await d.removeEntry(name, { recursive: true }); // trainees/<id>/processed
        else await migrate(h, depth + 1);
      } else if (name.endsWith('.json')) {
        const text = await (await h.getFile()).text();
        if (!text.startsWith(MAGIC)) {
          const w = await h.createWritable(); await w.write(await scramble(text)); await w.close();
        }
      }
    }
  }

  // ---------- admin password ----------
  // Stored as a slow salted hash (PBKDF2), so the password itself is never in any file.
  const ITER = 600000;
  async function hash(secret, salt = crypto.getRandomValues(new Uint8Array(16)), iter = ITER) {
    const k = await crypto.subtle.importKey('raw', new TextEncoder().encode(secret), 'PBKDF2', false, ['deriveBits']);
    const bits = await crypto.subtle.deriveBits({ name: 'PBKDF2', hash: 'SHA-256', salt, iterations: iter }, k, 256);
    return { salt: toB64(salt), iter, hash: toB64(new Uint8Array(bits)) };
  }
  const matches = async (secret, h) => !!h && (await hash(secret, fromB64(h.salt), h.iter)).hash === h.hash;
  const normCode = c => String(c ?? '').toUpperCase().replace(/[^A-Z0-9]/g, '');
  function newCode() { // 16 characters, no look-alikes (0/O, 1/I/L), shown as XXXX-XXXX-XXXX-XXXX
    const abc = 'ABCDEFGHJKMNPQRSTUVWXYZ23456789', r = crypto.getRandomValues(new Uint8Array(16));
    return [...r].map(b => abc[b % abc.length]).join('').match(/.{4}/g).join('-');
  }
  const checkPassword = pw => (typeof pw === 'string' && pw.length >= 6) || fail('הסיסמה חייבת להכיל לפחות 6 תווים');
  const loadSettings = () => readJson([], 'settings.json', null);
  const needUnlock = () => password !== null || fail('נעול - יש להזין את סיסמת המנהלת');
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
        const r = await parseFile(await d.getFileHandle(name));
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

  async function summary(tid) { // internal: no password check (saveFeedback uses it for the overwrite question)
    const nurses = await loadNurses();
    const name = nameOf(nurses, 'trainees', tid);
    return summarize(tid, name, Object.fromEntries(nurses.seniors.map(n => [n.id, n.name])));
  }

  // ---------- public API (all writes go through the lock) ----------
  return {
    SKILLS, today, validateFeedback, makeId, unscramble,
    get folderName() { return root?.name; },
    get isUnlocked() { return password !== null; },
    get password() { return password; },

    async open(handle) {
      root = handle;
      password = null;
      await locked(() => migrate());
    },
    nurses: loadNurses,
    summary: tid => { needUnlock(); return summary(tid); },

    // ---- admin password ----
    hasPassword: async () => !!(await loadSettings()),
    settingsMissing: async () => !!(await loadNurses()).password_set && !(await loadSettings()),
    setupPassword: pw => locked(async () => {   // first use only; returns the recovery code to print
      if (await loadSettings()) fail('כבר הוגדרה סיסמה');
      checkPassword(pw);
      const code = newCode();
      await writeJson([], 'settings.json', { created_at: localIso(), password: await hash(pw), recovery: await hash(normCode(code)) });
      // remembered in nurses.json too, so a deleted settings.json is noticed instead of silently allowing a new password
      const nurses = await loadNurses();
      await writeJson([], 'nurses.json', { ...nurses, password_set: true });
      password = pw;
      return code;
    }),
    unlock: async pw => {
      const st = await loadSettings();
      if (!st) fail('עדיין לא הוגדרה סיסמה');
      if (!await matches(pw, st.password)) fail('סיסמה שגויה');
      password = pw;
    },
    lock: () => { password = null; },
    // Forgotten password: the printed recovery code sets a new one. The data is never affected.
    resetPassword: (code, pw) => locked(async () => {
      const st = await loadSettings();
      if (!st || !await matches(normCode(code), st.recovery)) fail('קוד השחזור שגוי');
      checkPassword(pw);
      await writeJson([], 'settings.json', { ...st, password: await hash(pw), reset_at: localIso() });
      password = pw;
    }),
    changePassword: pw => locked(async () => {
      needUnlock(); checkPassword(pw);
      const st = await loadSettings();
      await writeJson([], 'settings.json', { ...st, password: await hash(pw), changed_at: localIso() });
      password = pw;
    }),

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
      needUnlock();
      checkKind(kind);
      const nurses = await loadNurses();
      const nurse = nurses[kind].find(n => n.id === id) || fail('האחות לא נמצאה');
      nurse.name = cleanName(nurses, kind, name, id);
      nurse.active = active !== false;
      await writeJson([], 'nurses.json', nurses);
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
      return { ok: true, file };
    }),

    // Cancel one saved form. Nothing is deleted: a void record is appended.
    // Also used by the nurse's "undo" right after saving, so no password; the summary comes back only when unlocked.
    voidForm: (tid, file) => locked(async () => {
      nameOf(await loadNurses(), 'trainees', tid);
      if (!isStr(file) || !(await jsonNames([...tpath(tid), 'raw'])).includes(file)) fail('הטופס לא נמצא');
      const rec = await readJson([...tpath(tid), 'raw'], file, {}).catch(() => ({}));
      await writeJson([...tpath(tid), 'voids'], `${stamp()}.json`, {
        voided_at: localIso(), file, shift_date: rec.shift_date, shift: rec.shift, senior_name: rec.senior_name });
      return password !== null ? summary(tid) : { ok: true };
    }),

    decide: ({ trainee_id, decision, decider_id, note }) => locked(async () => {
      needUnlock();
      const nurses = await loadNurses();
      nameOf(nurses, 'trainees', trainee_id);
      const decider_name = nameOf(nurses, 'seniors', decider_id);
      if (!DECISIONS.includes(decision)) fail('החלטה לא חוקית');
      note = note ?? '';
      if (!isStr(note) || note.length > MAX_NOTE) fail('הערה ארוכה מדי');
      await writeJson([...tpath(trainee_id), 'decisions'], `${stamp()}.json`,
        { decided_at: localIso(), decision, decider_id, decider_name, note: note.trim() });
      return summary(trainee_id);
    }),
  };
})();
