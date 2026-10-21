# Improvements: review of the Nurse Orientation Tracker

A review of the current code (`server.py`, `index.html`, `charts.js`, `style.css`, the release build), written from two points of view:

- **Part A: the Head Nurse.** Wants better *training*: faster, safer orientation and better decisions.
- **Part B: the Head Programmer and HR.** Wants a system nurses can actually use on a busy ward, data that can be trusted, and something the organization can learn from.

Part C merges both into one prioritized roadmap. Every finding names where in the code it lives, and how hard it is to fix: **S** = hours, **M** = a day or two, **L** = several days.

## Update 2026-10-21: moved to a web page

The exe was blocked on the ward PC, so the app is now a static web page (GitHub Pages) that saves into a folder on the ward PC through the browser (see `README.md`). The Python server became `store.js` in the page. Effects on this list:
- **B1, B3, B4, B5, B8, B9:** carried over unchanged in behavior, re-tested in `test_web.py`.
- **B2:** no server any more, so nothing to attack on the PC. Replaced by a Content-Security-Policy that blocks the page from sending data to any other site (tested).
- **B18:** solved. The codes live only in `META` (`charts.js`); `store.js` derives its lists from it.
- **B19:** less relevant: `progress.html` is rebuilt on every change, and the page always computes live.
- **B21:** gone (no exe).
- **New risk:** whoever controls the GitHub account controls the page. Use 2-factor login.

References below to `server.py`, `Handler` or `ward-release` describe the old exe version (kept locally in `legacy-exe/`).

## Status (2026-10-17)

| # | Status | What was built |
|---|---|---|
| B1 | ✅ done | `load_records()` in `server.py` skips damaged raw/decision/void files and lists them in `bad_files`; red "קובץ פגום" line on the dashboard. Unexpected errors now return 500 with a message (details in the black window) instead of a dropped connection. |
| B2 | ✅ done | `Handler.guard()`: every request needs `Host` 127.0.0.1:8765 / localhost:8765; every POST needs `Content-Type: application/json` and, if sent, the app's own `Origin`. Otherwise 403. |
| B3 | ✅ done | Rule used: **night shift = the date it started** (pending your answer to question 1). Picking "לילה" before 12:00 sets the date to yesterday unless the date was picked by hand; hint under the date field. |
| B4 | ✅ done | `POST /api/void` appends `voids/<stamp>.json` (raw file kept). "טעות? ביטול הטופס הזה" button right after saving, and "ביטול טופס" per row in the all-shifts table. Dashboard shows "N טפסים בוטלו". |
| B5 | ✅ done | Saving a shift that already has a form returns 409; the page asks "כבר קיים משוב למשמרת זו מ-<name>. להחליף?" and only replaces on yes. |
| B8 | ✅ done | New tab "ניהול אחיות": rename (id and folder unchanged), trainee "סיימה אוריינטציה", senior "לא פעילה". Hidden from the form, still in the summary picker (marked "(סיימה)"). Old forms show the senior's current name; affected `progress.html` files are rebuilt. Duplicate check also collapses extra spaces. |
| B9 | ✅ done | Draft saved to `localStorage` on every change, restored after refresh with a note, cleared on save or "ניקוי הטופס". Leaving with unsaved changes asks first. |

Not yet done: everything else, including the rest of Phase 0 (**B13 automatic backup**).

**`ward-release\` was NOT rebuilt** (as asked). It still holds the previous version. When ready for the ward: `python build_release.py`, then `python test_release.py`, then copy `ward-release\`.

Tests after the change: `test_server.py` (adds damaged files, voids, rename, and a live-server check of 403/409/void/rename), `test_browser.py` (adds overwrite question, draft restore, night date, cancel form, manage nurses), `simulate_demo.py`: all pass.

---

## Part A: Head Nurse ("I want my new nurses trained better")

### A1. Rotating seniors lose continuity. Add a "before the shift" briefing (high value, M)
Every shift has a different senior. Today the senior who starts a shift with a trainee has no quick way to know what the previous senior asked her to work on. The note from the last shift is buried in the dashboard.

**Improve:** a "תדריך לפני משמרת" (pre-shift briefing) view. Pick the trainee and see, on one screen:
- the focus area
- the improvement points from the last 2–3 shifts
- the skills that were "לא נצפה" (not observed) recently
- the latest recommendation

This turns 4 separate opinions into one continuous training plan. It is the single biggest training gain available.

### A2. Split the note into "strength" and "to work on next shift" (S)
The form has one free-text box (`index.html`, `note`). Mixed text can't be shown to the next senior as a clear task.

**Improve:** two short fields, "חוזקה" (strength) and "לעבוד עליו במשמרת הבאה" (to work on next shift). The second one feeds the briefing (A1). Both stay optional.

### A3. No expected pace: "Is she on track for week 3?" (high value, M)
The grid shows scores, but nothing says what is *expected* by now. A 2 in week 1 is fine; a 2 in week 4 is a problem.

**Improve:** a per-week target in one small settings block. For example:

| Week | Expected level |
|---|---|
| 1 | 2 |
| 2 | 2–3 |
| 3 | 3 |
| 4+ | 3–4 |

Then:
- draw it as a band on the average chart
- outline grid cells that are below expectation for that week
- show "on track / behind" in the header tiles

### A4. Early warning for at-risk trainees (high value, M)
Today a "יש חשש" (concern) or "לא מומלץ להמשיך" (not recommended to continue) recommendation is just a colored mark. Nobody is alerted.

**Improve:** a red banner on the summary tab whenever any trainee has one of these:
- a "stop" recommendation
- two "concern" recommendations in a row
- patient safety ≤ 2 after week 2
- no improvement over 3 shifts

The head nurse clicks "נצפה" (acknowledged) to clear it, and that is logged. Safety issues should never wait for the next time someone happens to open the dashboard.

### A5. All trainees on one screen (M)
The summary tab shows one trainee at a time (`#pick`). With 4–8 trainees in orientation, the head nurse needs the group view.

**Improve:** an overview table, one row per trainee:
- week
- shifts
- average trend (a small sparkline)
- focus area
- latest recommendation
- on-track status (A3)
- latest decision
- any open alerts (A4)

Click a row to open the existing dashboard.

### A6. Define "ready for independence" explicitly (M)
The decision ("סיום אוריינטציה", orientation complete) is a judgment call with no visible criteria.

**Improve:** configurable readiness criteria, for example:
- every skill ≥ 3 in the last 3 observed shifts
- patient safety = 4 at least twice
- at least one shift of each type (morning, evening, night)
- no "concern" in the last 2 weeks

Show them as a checklist in the decision panel, ✓ met or ✗ not yet. Decisions become consistent between trainees and defensible to HR.

### A7. Exposure gaps: what she has never practiced (S)
"לא נצפה" (not observed) is counted per skill but not flagged.

**Improve:** flag a skill not observed in the last 3 shifts. The simulation showed medications often not observed on night shifts. Also show the shift-type split, for example "בוקר 5 · ערב 2 · לילה 0" (morning 5, evening 2, night 0). A trainee who never did a night shift is not ready for nights.

### A8. A skills checklist, not only 5 broad ratings (L)
The 5 categories come from the PDF and are good for a trend. Respiratory orientation, though, also has concrete one-time skills: changing a tracheostomy, handling each ventilator alarm, a code drill, an oxygen-delivery setup.

**Improve:** a separate checklist module. Each item gets a status ("performed with supervision" / "performed independently") plus the date and senior. It complements the shift form; it does not replace it.

### A9. Context for the scores (S)
A 2 on a shift with 6 heavy, ventilated patients is not the same as a 2 with 3 stable ones.

**Improve:** two optional quick fields: number of patients, and number of ventilated patients. Show them in the grid tooltip.

### A10. Hear from the trainee (M, sensitive)
**Improve:**
- **Optional self-assessment:** the trainee rates herself on the same 5 skills once a week. A big gap between self and senior ratings is a teaching signal, in either direction.
- **Optional anonymous trainee feedback** on the orientation itself: "did I learn on this shift?"

This touches on evaluating seniors, so involve staff before adding it (see B10).

---

## Part B: Head Programmer and HR ("it has to work on a real ward, and the data has to be trustworthy")

### Must fix before go-live

**B1. One damaged file breaks a trainee's whole dashboard (bug, S).**
- `read_json` (`server.py`) only catches `FileNotFoundError`.
- A file that was hand-edited or half-copied raises an error: invalid JSON → `400`; a missing field (`KeyError` in `summarize`) → the connection drops.
- After that, the trainee's summary never loads again.

*Fix:* skip unreadable or invalid raw and decision files, and list them in the summary as `bad_files` with a visible warning: "קובץ פגום: …" (damaged file). Add a test.

**✅ Done 2026-10-17** (dev copy only, see Status).

**B2. Any website open in the browser could post fake feedback (security, S).**
- `Handler.body()` parses JSON regardless of the request's `Content-Type`, and checks neither `Origin` nor `Host`.
- A malicious page could send a `text/plain` POST to `127.0.0.1:8765` that the browser doesn't block. It would need to guess nurse names, but those are guessable.
- The same gap allows a DNS-rebinding attack (a malicious domain made to point at the ward PC's local address).

*Fix:* on every POST require `Content-Type: application/json`, and reject a request whose `Host` is not `127.0.0.1:8765`/`localhost:8765` or whose `Origin` is anything other than the app itself. About 6 lines.

**✅ Done 2026-10-17** (dev copy only, see Status). The Host check also applies to GET, so a rebinding page cannot read evaluations either.

**B3. Night shift gets the wrong date by default (data quality, S).**
- `index.html` sets `shift_date` to *today*.
- A night shift that starts on the 16th is usually filled in at 07:00 on the 17th, so it saves as the 17th.
- The date-and-shift key then becomes wrong, and a correction may not replace the right form.

*Fix:* agree a rule ("the date of the shift = the day it started"). Then, when "לילה" (night) is picked before noon, default the date to yesterday, and show the rule next to the field.

**✅ Done 2026-10-17** (dev copy only, see Status). Rule "date it started" used until you decide (question 1).

**B4. A wrong date can never be removed (data quality, M).**
- A correction only works for the *same* date and shift (`summarize`, newest wins).
- If the senior picked the wrong date, the wrong form stays in the charts forever unless someone deletes the file by hand.

*Fix:* a "בטל טופס" (void form) action that appends a small void record (it still never deletes anything), plus a "my last saved forms" list right after saving.

**✅ Done 2026-10-17** (dev copy only, see Status). Instead of a list: an undo button right after saving, plus a cancel button per row in the summary tab. Cancelling a correction brings back the previous version of that shift. Not yet recorded: *who* cancelled (comes with the B11 PIN).

**B5. A silent overwrite between seniors (S).**
- Saving the same trainee + date + shift again replaces the earlier form without warning.
- If two seniors both think they had that shift, one overwrites the other.

*Fix:* before saving, warn: "כבר קיים משוב למשמרת זו מ-<name>. להחליף?" (feedback for this shift already exists from <name>; replace it?)

**✅ Done 2026-10-17** (dev copy only, see Status). Checked on the server, so it also works if two PCs ever post.

### Make it easy for nurses to enter data

**B6. "Week in orientation" is typed by hand (S).** It's redundant and error-prone, since different seniors will disagree. *Fix:* store each trainee's start date when she is added, and compute the week from the shift date. Remove the field, or show it read-only.

**B7. Adding a nurse uses a browser pop-up (S).** `window.prompt` is ugly, doesn't handle Hebrew right-to-left well, is easy to dismiss, and makes it easy to add a trainee as a senior by mistake. *Fix:* an inline "add" row under each dropdown, with a duplicate check that ignores extra spaces and letter case (catches "רינה לוי" vs "רינה  לוי").

**B8. The dropdown grows forever, and names can't be fixed (M).**
- Trainees who finished orientation stay in the list.
- A typo in a name is permanent.

*Fix:* a small "ניהול אחיות" (manage nurses) screen:
- rename (the id and folder stay the same)
- mark a trainee as finished (hidden from the form, still in the overview and archive)
- mark a senior as inactive

**✅ Done 2026-10-17** (dev copy only, see Status). Not protected by a PIN yet (B11).

**B9. A half-filled form is lost on refresh or closing the tab (S).** *Fix:* save a draft in the browser's own storage (`localStorage`) while typing; restore it with a "draft restored" note; clear it on save. Also warn before leaving the page with unsaved changes.

**✅ Done 2026-10-17** (dev copy only, see Status). On a shared PC the next nurse may see someone else's draft: the note says so and "ניקוי הטופס" clears it.

**B10. Wording and inclusiveness (S).**
- The UI uses feminine forms ("בחרי…", choose, feminine). Male nurses exist; use neutral wording ("בחירה…", selection).
- Raise the base font to 16px for readability on a ward monitor.

### Trust, accountability and HR records

**B11. Anyone can record a decision as anyone (M).** No login was the right choice for the form, but "סיום אוריינטציה" (orientation complete) is an HR act. *Fix:* a PIN, known only to the head nurse and deputies and stored hashed in a settings file, required for decisions and for the manage-nurses screen (B8). The form itself stays without login.

**B12. Personnel data on a shared PC (M, policy).**
- Evaluations are personnel records, and the `data\` folder is readable by anyone using that Windows account.
- *Fix:*
  - run the tracker under a restricted Windows account, or put `data\` in a folder with limited permissions
  - get the hospital's privacy or IT sign-off
  - record who viewed or decided in a simple append-only `audit.log`

**B13. Backup is manual, and the disk is a single point of failure (high, S).** One dead disk means the whole orientation history is gone. *Fix:* on every start (and once a day while running), zip `data\` into `backups\data-YYYY-MM-DD.zip`, keeping the last 30. Add an optional setting to also copy the zip to a network share path.

**B14. A printable report for the personnel file (S).** The original process was a paper form, and HR files need paper or PDF. *Fix:*
- print styles (`@media print`) for the dashboard: hide the tabs and decision form, keep the grid and charts in black-and-white-safe colors
- a "סיכום אוריינטציה" (orientation summary) print page with signature lines

**B15. Export for analysis (S).** *Fix:* a "ייצוא CSV" (export CSV) button: one row per shift for all trainees. HR can open it in Excel.

### Learning from the data (program level)

**B16. Rater calibration (M).** With 4 seniors rating everyone, some will be strict and some lenient. *Fix:* a private page for the head nurse with each senior's average score and recommendation mix across all trainees. Large differences point to a calibration meeting, not blame.

**B17. Cohort analytics: improve the program itself (M).** *Fix:* across all trainees ever, show the average number of shifts until each skill reaches 3. If respiratory skills are always the slowest, the program needs a respiratory workshop in week 1. This is how the data improves training for the next group.

### Code health

**B18. Score codes defined twice (S).** `SKILLS`/`RECS`/`DECISIONS`/`SHIFTS` live in `server.py` *and* `META` lives in `charts.js`. *Fix (smallest):* a test that loads `charts.js` and asserts that both lists match. *Fix (cleaner):* the server serves `META` from one Python source at `/api/meta`, and `progress.html` gets it embedded.

**B19. Old `progress.html` files go stale after an update (S).** Files are only rebuilt on submit or decision. After an app update with new charts, old files keep the old look. *Fix:* rebuild all trainees' `progress.html` once at startup.

**B20. Settings are hard-coded (S, only when needed).** The port, the backup path and the targets (A3) are constants. Once A3, A6 and B13 exist, gather them in one `settings.json` next to the exe. Don't add it before then.

**B21. The exe is unsigned (policy).** Windows SmartScreen warns on first run. *Fix:* ask hospital IT to allow it, or to sign it with the organization's certificate. The `start.bat` fallback already covers a block.

---

## Part C: Merged roadmap

### Phase 0: before go-live (about 1 day)
| # | What | Why | Effort |
|---|---|---|---|
| B1 | ✅ Survive damaged files | One bad file must not hide a trainee | S |
| B2 | ✅ Content-Type, Origin and Host checks | Stops fake submissions from websites | S |
| B3 | ✅ Night-shift date rule | Wrong dates corrupt the history | S |
| B13 | Automatic daily backup | Protects all records | S |
| B5 | ✅ Warn before overwriting a shift | Prevents silent data loss | S |
| B4 | ✅ Cancel a wrong form (pulled forward) | Wrong dates no longer stay forever | M |

### Phase 1: first month on the ward (training value)
| # | What | Who benefits |
|---|---|---|
| A1 + A2 | Pre-shift briefing + split note | Seniors, trainees |
| A4 | At-risk alerts | Head nurse, patient safety |
| A5 | All-trainees overview | Head nurse |
| B6 + B7 + B9 | Automatic week, inline add, draft autosave (✅ B9 done) | Every senior, every shift |
| B14 | Printable report | HR |

### Phase 2: after one full cohort
| # | What |
|---|---|
| A3 + A6 | Weekly targets + readiness checklist |
| A7 | Exposure gaps + shift-type split |
| B8 + B11 | Manage nurses (✅ B8 done, pulled forward) + PIN for decisions and the manage tab |
| B15 + B16 + B17 | CSV export, rater calibration, cohort analytics |

### Phase 3: optional, decide with staff
A8 (skills checklist), A9 (patient-load context), A10 (self-assessment and trainee feedback), B12 (privacy sign-off and audit log), B18–B20 (code cleanup as features land).

---

## Questions to decide together before building
1. **Night-shift date rule (B3):** does a night shift belong to the date it started (built this way for now) or the date it ended?
2. **Weekly targets (A3):** what level do you expect at the end of weeks 1, 2, 3 and 4?
3. **Readiness criteria (A6):** what must be true before "סיום אוריינטציה" (orientation complete)?
4. **Who may decide (B11):** head nurse only, or deputies too? Is a shared PIN acceptable?
5. **Backups (B13):** is there a network folder we may copy to, or only a local folder and USB?
6. **Rater view and trainee feedback (B16, A10):** is the staff comfortable with them? Who may see them?
