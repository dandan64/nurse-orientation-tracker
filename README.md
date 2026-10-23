# Nurse Orientation Tracker (משוב משמרת חניכה)

## 👉 Open the tracker: **https://dandan64.github.io/nurse-orientation-tracker/**

A web page for the LTAC respiratory unit. After every orientation shift, the senior nurse (החונכת) fills in the shift feedback form. Every form is saved as a file **in a folder on the ward PC**. The page builds a progress summary with charts, so the nurse in charge can follow each new nurse and record a decision.

**The ward PC needs nothing installed: no Python, no exe.** Only Edge or Chrome and the link above.

📖 **User guide (Hebrew), for the nurses:** https://dandan64.github.io/nurse-orientation-tracker/guide.html

**Privacy model:** the website (GitHub Pages) only delivers the page code. All data is read and written in a folder on the ward PC through the browser. Nothing is uploaded, and the page's security policy blocks it from contacting any other site.

**Admin password:** "סיכום והחלטה" and "ניהול אחיות" are locked with a password the head nurse sets on first use. The form stays open to all seniors. Data files are **scrambled**: unreadable in File Explorer. The password can never cause data loss: a forgotten password is replaced with the printed recovery code.

---

## 1. Quick start

### Ward PC: first time (about 2 minutes)
1. Open **Microsoft Edge** or **Google Chrome** (Firefox can't write to local folders).
2. Go to **https://dandan64.github.io/nurse-orientation-tracker/** and bookmark it. Optionally: Edge menu > Apps > Install this site as an app (opens like a program, with its own icon).
3. Create an empty folder, for example `Documents\NurseTracker-data`.
4. On the page, click **בחירת תיקיית נתונים**, choose that folder and allow "edit files".
   - If you pick a folder that already has other files and no tracker data, the page asks before using it (protects against choosing `Documents` itself).

### Ward PC: every day
- Senior nurse, end of shift: open the bookmark, tab **מילוי משוב**, fill in, **שמירת המשוב**.
- Nurse in charge: tab **סיכום והחלטה** (charts, decision, **ייצוא PDF מוגן בסיסמה**) and tab **ניהול אחיות** (rename, finished/inactive, change password). Both ask for the admin password; **🔒 נעילת אזור המנהלת** locks again, and it locks by itself after 10 minutes without use or when the page is closed.
- After a browser restart the page may show **חיבור לתיקייה "…"**: one click, then allow. Newer Edge/Chrome versions offer "Allow on every visit".
- Without internet: the page still opens from the browser's offline copy (`sw.js`) once it has been opened online.

### Admin password: first time (head nurse)
1. Click **סיכום והחלטה**. The page asks for a new password (at least 6 characters), twice.
2. A **recovery code** appears (like `9TC2-XM6T-C24J-JNDK`). Click **הדפסת הקוד**, keep one copy in the ward safe and one with nursing management.
3. Type the code back to confirm it was written down. The admin area opens.

**Forgot the password?** On the lock screen click **שכחתי סיסמה**, enter the recovery code and a new password. All data stays as it was.

### PDF for the personnel file
In **סיכום והחלטה**, pick a trainee and click **ייצוא PDF מוגן בסיסמה**. The PDF goes to the Downloads folder and opens only with the admin password (the password at the time of export). It is a picture of the dashboard, so the Hebrew and charts look exactly as on screen.

### Backups
Copy the data folder regularly (USB or a network folder). The data exists **only** in that folder.

### Developer only (not needed on the ward)
Python is used only on the developer's PC, to test changes before publishing:
- Try a change locally: `python -m http.server 8000 --bind 127.0.0.1`, then open http://127.0.0.1:8000. `localhost` counts as secure, so the folder picker works.
- Test: `python test_web.py` (local copy) or `python test_web.py https://dandan64.github.io/nurse-orientation-tracker/` (live site). See section 8.
- Publish: push to `main`. GitHub Pages serves the repo root; the ward gets the new version on its next page load.
- The old exe version is kept locally in `legacy-exe/` (not published), with its own README.

---

## 2. Files

```
index.html     the page: folder-connect screen, form tab, summary/decision tab, manage-nurses tab
app.js         page logic: form, draft, night-shift date, dialogs, folder connect
store.js       data layer: validation, scrambled files in the data folder, summary, admin password
charts.js      shared: labels and codes (META), SVG charts, dashboard renderer
style.css      styles
vendor/        html2canvas + jsPDF, copied in (pinned versions, hash-checked), used only for the PDF export
sw.js          offline copy of the page files (no data)
guide.html     user guide in Hebrew for seniors and the head nurse (linked from the page header)
guide/         screenshots for the guide (fictional demo names)
test_web.py    real-browser test (dev only)
README.md, improvements.md   documentation
```
Not published (see `.gitignore`): `data/`, `demo/`, the PDF, `legacy-exe/`, screenshots, tool folders.

---

## 3. Data folder layout

```
<data folder>/
  nurses.json
  trainees/<trainee-id>/
    raw/<shift_date>_<shift>_<timestamp>.json    one file per form, never overwritten
    voids/<timestamp>.json                       one file per cancelled form ("ביטול טופס")
    decisions/<timestamp>.json                   one file per decision
  settings.json                                  admin password + recovery code, as slow salted hashes
```
**Every file is scrambled** (AES-GCM, contents start with `NTX1:`): opening one in Notepad shows gibberish, and an edited or cut file is detected and reported as damaged. Older versions' plain files are scrambled automatically on the next start, and their plain `processed\` summaries are deleted. The examples below show the content *after* unscrambling.

**Scrambled, not secret:** the scrambling key is in the public code, so a technical person could unscramble the files. This was chosen on purpose with the head nurse: real encryption needs a key that can be lost, and then the data is gone. Scrambling stops colleagues browsing the folder; no password or code can ever lock the data away.

### `nurses.json`
```json
{
  "trainees": [{"id": "דנה_כהן", "name": "דנה כהן", "active": true}],
  "seniors":  [{"id": "רינה",    "name": "רינה",    "active": false}]
}
```
- `id` = the name with every character that is not a letter, digit, `_` or `-` replaced by `_`. If taken, a suffix is added (`_2`, `_3` …). The trainee's folder is named by this id, and **the id never changes**, even after a rename.
- `active: false` = trainee finished / senior inactive: hidden from the form dropdowns, data kept. Missing `active` = active.

### Raw form file (`raw/…json`)
```json
{
  "submitted_at": "2026-10-13T15:42:10.123",
  "trainee_id": "דנה_כהן", "trainee_name": "דנה כהן",
  "senior_id": "רינה", "senior_name": "רינה",
  "shift_date": "2026-10-13", "shift": "בוקר", "week": 3,
  "scores": {"safety": 3, "respiratory": 2, "meds": null, "time": 3, "communication": 4},
  "recommendation": "continue_reinforce",
  "note": "…"
}
```
Names are copied in, so each file is readable on its own. The dashboard shows the senior's *current* name (looked up by `senior_id`). Contents are UTF-8 JSON (then scrambled).

### Decision file and void file
```json
{"decided_at": "…", "decision": "complete", "decider_id": "רינה", "decider_name": "רינה", "note": "…"}
{"voided_at": "…", "file": "2026-10-13_בוקר_20261013T154210123.json", "shift_date": "2026-10-13", "shift": "בוקר", "senior_name": "רינה"}
```
A void's `file` names the raw file that no longer counts. The raw file itself stays.

### Codes
| Field | Code | Hebrew label |
|---|---|---|
| scores key | `safety` | בטיחות מטופל ושיפוט קליני |
| | `respiratory` | מיומנויות נשימתיות |
| | `meds` | תרופות, נהלים ותיעוד |
| | `time` | ניהול זמן וסדרי עדיפויות |
| | `communication` | תקשורת ועבודת צוות |
| score value | `1` / `2` / `3` / `4` / `null` | לא בטוח / הנחיה צמודה / צריכה גיבוי / עצמאית / לא נצפה |
| recommendation | `continue` / `continue_reinforce` / `concern` / `stop` | להמשיך כרגיל / עם חיזוק / יש חשש / לא מומלץ |
| decision | `complete` / `continue` / `extend` / `discuss` | סיום / המשך / הארכה / לדיון |
| shift | `בוקר` / `ערב` / `לילה` | stored as the Hebrew word |

All codes are defined once, in `META` in `charts.js`; `store.js` derives its lists from it.

---

## 4. How the code runs

### Opening the page
1. `index.html` loads `style.css`, `charts.js`, `store.js`, `app.js`.
2. `app.js` `boot()`:
   - no File System Access support → "use Edge or Chrome" message
   - folder handle saved in this browser (IndexedDB) and permission still granted → open it
   - saved handle but permission expired → button **חיבור לתיקייה "…"** (one click)
   - nothing saved → **בחירת תיקיית נתונים**
3. `Store.open(folder)` keeps the folder handle, starts locked, and scrambles any plain files left by an older version.
4. Dropdowns are filled from `nurses.json`; a saved draft is restored.

IndexedDB stores only the *folder handle* (a pointer the browser can reuse), never form data.

### Saving a form
```
app.js   collect form -> Store.saveFeedback(body)
store    take the write lock (Web Locks: one write at a time, even across tabs)
         validateFeedback()                -> Hebrew error message on any problem
         this trainee already has a form for this date+shift and no replace:true
                                           -> error with status 409 "כבר קיים משוב למשמרת זו מ-<senior>"
                                              page asks "להחליף?" and calls again with replace:true
         write raw/<date>_<shift>_<stamp>.json   (createWritable: the file appears only when complete)
         return {ok, file}      (no summary file: summaries are computed live, only when unlocked)
app.js   "המשוב נשמר ✓" + "טעות? ביטול הטופס הזה" button; form reset (date kept); draft cleared
```

### Other operations (all in `store.js`, writes under the lock)
| Function | Does |
|---|---|
| `nurses()` | read `nurses.json` (a damaged file is an error, never treated as empty) |
| `addNurse(kind, name)` | collapse spaces, reject empty / >80 chars / duplicate, create id |
| `updateNurse({kind, id, name, active})` | rename and/or finished/inactive; id unchanged (admin only) |
| `summary(tid)` | computed live from the files (admin only) |
| `setupPassword(pw)` | first use only; saves the hashes, returns the recovery code |
| `unlock(pw)` / `lock()` | the password is kept in memory only while unlocked (also used as the PDF password) |
| `resetPassword(code, pw)` / `changePassword(pw)` | new password; data untouched |
| `voidForm(tid, file)` | append a void record; returns the new summary |
| `decide({trainee_id, decision, decider_id, note})` | append a decision; returns the new summary (admin only) |

"Admin only" is checked inside `store.js`, not just by hiding tabs. `voidForm` stays open because the senior's "undo" right after saving uses it.

### Admin password (`store.js`)
- Stored as PBKDF2-SHA-256, 600,000 rounds, random salt; the recovery code likewise. Neither is ever written in plain.
- Recovery code: 16 characters without look-alikes (no 0/O, 1/I/L), checked ignoring case, spaces and dashes.
- `nurses.json` records `password_set: true`. If `settings.json` later disappears, the setup screen warns that it was probably deleted.
- Limit of the scrambling model: someone who deletes `settings.json` *and* ignores that warning can set a new password. It stops colleagues, not a determined person with file access.

### Form helpers (`app.js`)
- **Night-shift date:** a shift belongs to the date it *started*. Picking "לילה" before 12:00 sets yesterday, unless the date was picked by hand.
- **Draft:** every change is saved in the browser's `localStorage`; restored after a refresh or closed tab with a note; "ניקוי הטופס" clears it; leaving with unsaved changes asks first.

---

## 5. Processing rules (`summarize` in `store.js`)

1. Read every file in `raw/`, `voids/`, `decisions/`. A file that is not valid JSON/UTF-8 or is missing a required field is **skipped** and listed in `bad_files`; the dashboard shows a red "קובץ פגום" line. The rest still shows.
2. Drop raw files named in a void record (`voided_count`).
3. **Correction rule:** for the same `(shift_date, shift)` only the latest `submitted_at` counts (`superseded_count`).
4. Sort by date, then shift order (בוקר, ערב, לילה).
5. Per shift `avg` = mean of the non-null scores (null if none).
6. Per skill: `first`, `latest`, `last3_avg` (last 3 observed), `observed`.
7. `rec_counts`, `notes` (newest first), `current_week` (highest entered), `seniors`, `decisions` (oldest first).

### Dashboard
1. Stat tiles: shifts, current week, number of seniors, latest recommendation, **focus area** (lowest last-3 average), latest decision.
2. **Progress grid**: skills × shifts, oldest on the right (Hebrew reading order), opens scrolled to the newest. One-hue blue scale with the number printed in every cell; "לא נצפה" = gray "—"; average row and recommendation row (✓ ! ? ✕). Chosen over 5 overlapping lines, which hid each other on whole-number scores.
3. Line chart of the shift average, dashed reference at 3.
4. Skill table: first / latest / last-3 / change / observed.
5. Notes, decision history (plus decision form in the page only).
6. Collapsible table of all shifts; in the page each row has "ביטול טופס".

---

## 6. Assumptions and decisions

- **Data only on the ward PC.** GitHub Pages hosts the code; the data folder is local. The page's Content-Security-Policy allows loading only its own files and blocks sending anything to other sites (tested).
- **The code is public** (free GitHub Pages needs a public repo). It contains no data, names or hospital documents.
- **Trust in the code:** whoever controls the GitHub account controls the page. Use 2-factor login on that account.
- **Edge or Chrome only.**
- **One PC, one data folder.** The folder may be on a network drive, but simultaneous use from two PCs is not protected (the lock covers tabs in one browser only).
- **No login for the form.** Any senior can fill a form. Summaries, decisions, renaming and PDFs need the admin password.
- **Scrambled, not encrypted** (see section 3): chosen so that no lost password can ever lose data.
- **One admin password**, shared by the head nurse and deputies; the recovery code replaces email recovery (sending email needs a server, which would break the "nothing leaves the PC" promise).
- **Append-only.** Nothing is edited or deleted by the page. Corrections = resubmit (asks first, newest wins); wrong form = cancel (void record).
- **Night shift = the date it started** (pending the head nurse's confirmation).
- **The "future date" check uses the PC clock.**
- **No HTML injection:** all user text is escaped.
- No plain summary file is kept on disk; the PDF export is the shareable copy.
- **Test mode:** `?test-opfs` in the address stores data inside the browser instead of a folder, with a red banner. Used only by `test_web.py`.

---

## 7. Not included (add when needed)
- Automatic backup (B13 in `improvements.md`).
- Several PCs writing the same folder at once.
- Firefox / Safari.
- Export to Excel/CSV.

---

## 8. Testing

Developer PC only (the ward never runs tests or Python). One-time setup: `pip install playwright` and `playwright install chromium`.
```
python test_web.py
```
Serves this folder on `127.0.0.1`, opens the page in Chromium with `?test-opfs` (Playwright can't click the Windows folder picker; the browser's private folder has the same API), and checks:
- **privacy:** with the real security policy, `fetch` and image requests to another site are blocked
- files on disk are scrambled (no names or scores readable); no plain summary files
- admin password: summary refused before setup; first-use setup (too short / mismatch refused), recovery code format, wrong code typed back refused, right code (any case/spacing) opens; settings scrambled, password not stored
- lock button, summary/decide/rename refused while locked (in `store.js` itself), form stays open; wrong password; reset with wrong code refused, right code works, old password stops working; change password; auto-lock after 10 idle minutes (fake clock); reload locks
- adding nurses, filling 9 forms by clicking (including "לא נצפה" and a correction with the "להחליף?" question)
- every saved file matches what was clicked; Hebrew readable; summary numbers (averages, last-3, corrections)
- draft restore after refresh and in a new tab, leave warning, clear; night-shift date at 07:00 and 21:30 (fake clock); hand-picked date kept
- dashboard grid, focus area, decision; cancel form (decline/accept), void file written, raw kept
- manage nurses: duplicate refused, rename (spaces collapsed, id kept, new name on old forms), inactive hidden
- data-layer edge cases: 12 kinds of invalid form, `replace` must be exactly `true`, cancelling a correction restores the earlier form, bad cancel targets, 5 simultaneous saves of one shift (1 saved, 4 asked), 15 simultaneous saves (all saved)
- damaged files (empty, half, list, Latin-1, bad decision, bad void, an edited scrambled file): summary still works and lists them; damaged `nurses.json` is never overwritten
- upgrade from an older version: plain files scrambled on start, old plain `processed\` removed, old forms still counted
- PDF: downloads, needs a password, wrong password fails, admin password opens it, has the dashboard pages
- no sideways scroll at 400px on all tabs; first-use screen

Screenshots go to `test-screenshots/`.

### Manual check on the ward PC (once)
1. Open the link in Edge, choose an empty folder, add a trainee and a senior, save one form.
2. In File Explorer, check `trainees\<name>\raw\` has the file, and that opening it in Notepad shows gibberish (`NTX1:…`).
3. Set the admin password, print the recovery code, export one PDF and open it with the password.
4. Close and reopen Edge: the page reconnects (maybe one click) and the admin area is locked.

---

## 9. Troubleshooting

| Problem | Fix |
|---|---|
| "הדפדפן הזה לא נתמך" | Open the link in Edge or Chrome. |
| Page asks to choose the folder again | The folder was moved/renamed or browser data was cleared. Choose the same folder again: the data is still there. |
| "חיבור לתיקייה" every time | Normal after a restart in some versions; choose "Allow on every visit" when Edge offers it. |
| Page doesn't open at all | No internet and the page was never opened online on this PC, or the hospital blocks `github.io`. Ask IT to allow the site. |
| Forgot the admin password | Lock screen > **שכחתי סיסמה** > recovery code + new password. Data is not affected. |
| Lost the password **and** the recovery code | The data is still safe. Ask the developer: deleting `settings.json` lets a new password be set (the page warns that this happened). |
| Red "קובץ פגום" line | A file in the data folder was edited or damaged by hand. The named file is skipped; restore it from a backup or remove it. |
