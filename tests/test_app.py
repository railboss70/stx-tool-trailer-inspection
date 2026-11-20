"""
End-to-end tests for the STX Tool Trailer Inspection app.

Runs the real app in a phone-sized Chromium and checks the screens, validation,
follow-up questions, autosave, navigation, PDF import and the generated PDF.

    pip install pytest playwright pypdf
    python -m playwright install chromium        # or set CHROME_PATH to an installed Chrome
    pytest tests -q
"""
import base64
import functools
import http.server
import json
import os
import re
import threading
from datetime import date, timedelta

import pytest
from playwright.sync_api import sync_playwright, expect
from pypdf import PdfReader

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
FIX = os.path.join(ROOT, "tests", "fixtures")
PORT = 8771
URL = f"http://127.0.0.1:{PORT}/index.html"
TODAY = date.today().isoformat()
YYMMDD = date.today().strftime("%y%m%d")


# ---------------------------------------------------------------- fixtures
@pytest.fixture(scope="session")
def server():
    handler = functools.partial(http.server.SimpleHTTPRequestHandler, directory=ROOT)
    handler.log_message = lambda *a, **k: None
    httpd = http.server.ThreadingHTTPServer(("127.0.0.1", PORT), handler)
    t = threading.Thread(target=httpd.serve_forever, daemon=True)
    t.start()
    yield URL
    httpd.shutdown()


@pytest.fixture(scope="session")
def browser():
    with sync_playwright() as p:
        kw = {}
        if os.environ.get("CHROME_PATH"):
            kw["executable_path"] = os.environ["CHROME_PATH"]
        b = p.chromium.launch(**kw)
        yield b
        b.close()


class Phone:
    """One simulated phone (its own storage)."""

    def __init__(self, browser, url, tmp_path):
        self.ctx = browser.new_context(viewport={"width": 390, "height": 844}, device_scale_factor=2,
                                       is_mobile=True, has_touch=True, accept_downloads=True)
        self.page = self.ctx.new_page()
        self.errors = []
        self.page.on("pageerror", lambda e: self.errors.append(str(e)))
        self.page.on("console", lambda m: self.errors.append(m.text) if m.type == "error" else None)
        self.page.on("dialog", lambda d: d.accept())
        self.url = url
        self.tmp = tmp_path
        self.page.goto(url)

    # --- navigation helpers
    def screen(self):
        return self.page.evaluate("window.STX_app.current")

    def next(self):
        self.page.click("#btn-next")
        self.page.wait_for_timeout(80)

    def start(self):
        self.page.click("#btn-start")
        assert self.screen() == "info"

    def fill_info(self, trailer="TT-14", job="UP Houston – Englewood Yard", inspector="Jose Garcia", when=TODAY):
        p = self.page
        p.fill("#trailerId", trailer)
        p.fill("#date", when)
        p.fill("#job", job)
        p.fill("#inspector", inspector)

    def item(self, name):
        return self.page.locator(f'.item:has(.item-name:text-is("{name}"))')

    def all_good(self):
        self.page.evaluate("""document.querySelectorAll('.inv-section:not([data-section="Other"]) .seg button[data-v="GOOD"]').forEach(b => b.click())""")

    def flag(self, name, status="NEED", method="YARD", urgency="NORMAL", repeat="NO", ordered=None, eta=None, qty=None, notes=None):
        it = self.item(name)
        it.locator(f'.seg button[data-v="{status}"]').click()
        it.locator(f'.opts[data-f="method"] button[data-val="{method}"]').click()
        if method == "YARD":
            it.locator(f'.opts[data-f="urgency"] button[data-val="{urgency}"]').click()
        it.locator(f'.opts[data-f="repeat"] button[data-val="{repeat}"]').click()
        if ordered:
            it.locator(f'.opts[data-f="ordered"] button[data-val="{ordered}"]').click()
        if eta == "UNKNOWN":
            if not it.locator(".eta-unknown.on").count():
                it.locator(".eta-unknown").click()
        elif eta:
            it.locator(".fu-eta").fill(eta)
        if qty:
            it.locator(".fu-qty").fill(str(qty))
        if notes:
            it.locator(".fu-notes").fill(notes)

    def photos(self):
        self.page.set_input_files('.photo-input[data-slot="0"]', os.path.join(FIX, "photo1.jpg"))
        self.page.set_input_files('.photo-input[data-slot="1"]', os.path.join(FIX, "portrait.jpg"))
        self.page.wait_for_function("window.STX_app.state.photos.every(Boolean)")

    def sign(self):
        self.page.locator("#sig").scroll_into_view_if_needed()
        self.page.wait_for_timeout(100)
        box = self.page.locator("#sig").bounding_box()
        x, y = box["x"] + 30, box["y"] + box["height"] - 70
        self.page.mouse.move(x, y)
        self.page.mouse.down()
        for i in range(30):
            self.page.mouse.move(x + i * 7, y - (i % 6) * 6)
        self.page.mouse.up()
        self.page.wait_for_function("!!window.STX_app.state.signature")

    def to_sign_screen(self, **info):
        self.start()
        self.fill_info(**info)
        self.next()
        self.all_good()
        self.next()
        self.next()          # requests (optional)
        self.photos()
        self.next()
        assert self.screen() == "sign"

    def finish(self):
        """Sign, finish, download; returns (path, filename)."""
        if not self.page.evaluate("window.STX_app.state.signature"):
            self.sign()
        self.page.click("#btn-next")
        self.page.wait_for_selector('.screen[data-screen="done"].active')
        with self.page.expect_download() as dl:
            self.page.click("#btn-download")
        d = dl.value
        path = os.path.join(self.tmp, d.suggested_filename)
        d.save_as(path)
        return path, d.suggested_filename

    def close(self):
        self.ctx.close()


@pytest.fixture
def phone(browser, server, tmp_path):
    ph = Phone(browser, server, tmp_path)
    yield ph
    errs = ph.errors
    ph.close()
    assert not errs, f"JavaScript errors: {errs}"


@pytest.fixture
def make_phone(browser, server, tmp_path):
    phones = []

    def _make():
        ph = Phone(browser, server, tmp_path)
        phones.append(ph)
        return ph
    yield _make
    for ph in phones:
        errs = ph.errors
        ph.close()
        assert not errs, f"JavaScript errors: {errs}"


def pdf_pages(path):
    return [pg.extract_text() or "" for pg in PdfReader(path).pages]


def pdf_stamp(path):
    kw = PdfReader(path).metadata.get("/Keywords")
    assert kw and kw.startswith("STXTTI1:")
    return json.loads(base64.b64decode(kw[len("STXTTI1:"):]).decode("utf-8"))


# ---------------------------------------------------------------- app shell & navigation
def test_home_screen_and_app_bar(phone):
    p = phone.page
    assert phone.screen() == "home"
    expect(p.locator("#nav-back")).to_be_hidden()
    expect(p.locator("#nav-settings")).to_be_visible()
    expect(p.locator("#bottombar")).to_be_hidden()
    expect(p.locator("#btn-start")).to_be_visible()
    phone.start()
    expect(p.locator("#appbar-title")).to_have_text("Trailer & Inspector")
    expect(p.locator("#appbar-sub")).to_have_text("Step 1 of 5")
    expect(p.locator("#nav-back")).to_be_visible()
    expect(p.locator("#bottombar")).to_be_visible()
    expect(p.locator("#btn-next")).to_have_text("Next: Inventory")


def test_header_back_and_phone_back(phone):
    p = phone.page
    phone.start()
    phone.fill_info()
    phone.next()
    assert phone.screen() == "inventory"
    expect(p.locator("#appbar-sub")).to_have_text("Step 2 of 5 · TT-14")
    p.click("#nav-back")
    assert phone.screen() == "info"
    phone.next()
    p.go_back()                      # Android back button / swipe
    p.wait_for_timeout(100)
    assert phone.screen() == "info"
    p.go_back()
    p.wait_for_timeout(100)
    assert phone.screen() == "home"
    expect(p.locator("#draft-card")).to_be_visible()
    expect(p.locator("#draft-title")).to_contain_text("TT-14")


def test_settings_reachable_from_any_step_and_back_returns(phone):
    p = phone.page
    phone.start()
    phone.fill_info()
    phone.next()
    p.click("#nav-settings")
    assert phone.screen() == "settings"
    expect(p.locator("#bottombar")).to_be_hidden()
    p.click("#nav-back")
    assert phone.screen() == "inventory"


def test_continue_returns_to_last_step(phone):
    p = phone.page
    phone.start()
    phone.fill_info()
    phone.next()
    p.reload()
    assert phone.screen() == "home"
    p.click("#btn-continue")
    assert phone.screen() == "inventory"


# ---------------------------------------------------------------- validation
def test_info_step_requires_all_fields(phone):
    p = phone.page
    phone.start()
    p.fill("#date", "")
    phone.next()
    assert phone.screen() == "info"
    box = p.locator('.screen[data-screen="info"] .screen-errors')
    expect(box).to_be_visible()
    expect(box).to_contain_text("Fix 4 things")
    phone.fill_info()
    expect(box).to_be_hidden()      # errors clear live as fields are fixed
    phone.next()
    assert phone.screen() == "inventory"


def test_future_date_rejected(phone):
    phone.start()
    phone.fill_info(when=(date.today() + timedelta(days=3)).isoformat())
    phone.next()
    assert phone.screen() == "info"
    expect(phone.page.locator('.screen[data-screen="info"] .screen-errors')).to_contain_text("future")


def test_inventory_requires_every_item(phone):
    p = phone.page
    phone.start(); phone.fill_info(); phone.next()
    phone.next()
    assert phone.screen() == "inventory"
    expect(p.locator('.screen[data-screen="inventory"] .screen-errors')).to_contain_text("62 items not checked")
    phone.all_good()
    expect(p.locator("#progress-text")).to_have_text("62 of 62 checked")
    phone.next()
    assert phone.screen() == "requests"


def test_followup_question_chain(phone):
    p = phone.page
    phone.start(); phone.fill_info(); phone.next()
    phone.all_good()
    it = phone.item("Marking Paint")
    it.locator('.seg button[data-v="NEED"]').click()
    expect(it.locator(".followup")).to_be_visible()
    expect(it.locator('[data-show="urgency"]')).to_be_hidden()
    phone.next()
    errs = p.locator('.screen[data-screen="inventory"] .screen-errors')
    expect(errs).to_contain_text("Choose how “Marking Paint” will be replaced")
    expect(errs).to_contain_text("last week's inspection")

    it.locator('.opts[data-f="method"] button[data-val="YARD"]').click()
    expect(it.locator('[data-show="urgency"]')).to_be_visible()
    expect(errs).to_contain_text("overnight it, or as time allows")
    it.locator('.opts[data-f="urgency"] button[data-val="OVERNIGHT"]').click()
    # switching to Site Supervisor hides and clears the urgency answer
    it.locator('.opts[data-f="method"] button[data-val="SUPERVISOR"]').click()
    expect(it.locator('[data-show="urgency"]')).to_be_hidden()
    assert p.evaluate("window.STX_app.state.items['marking-paint'].urgency") == ""

    it.locator('.opts[data-f="repeat"] button[data-val="YES"]').click()
    expect(it.locator('[data-show="ordered"]')).to_be_visible()
    it.locator('.opts[data-f="ordered"] button[data-val="YES"]').click()
    expect(it.locator('[data-show="eta"]')).to_be_visible()
    expect(errs).to_contain_text("expected delivery date")
    it.locator(".eta-unknown").click()
    expect(errs).to_be_hidden()
    # "No / not sure" hides & clears the delivery date
    it.locator('.opts[data-f="ordered"] button[data-val="NO"]').click()
    expect(it.locator('[data-show="eta"]')).to_be_hidden()
    st = p.evaluate("window.STX_app.state.items['marking-paint']")
    assert st["eta"] == "" and st["etaUnknown"] is False
    # back to GOOD clears every follow-up answer
    it.locator('.seg button[data-v="GOOD"]').click()
    expect(it.locator(".followup")).to_be_hidden()
    st = p.evaluate("window.STX_app.state.items['marking-paint']")
    assert st["method"] == "" and st["repeat"] == "" and st["notes"] == ""
    phone.next()
    assert phone.screen() == "requests"


def test_other_items(phone):
    p = phone.page
    phone.start(); phone.fill_info(); phone.next()
    phone.all_good()
    o1 = p.locator('.item[data-id="other-1"]')
    o1.locator('.seg button[data-v="GOOD"]').click()          # marked but no name
    phone.next()
    errs = p.locator('.screen[data-screen="inventory"] .screen-errors')
    expect(errs).to_contain_text("has no name")
    o1.locator(".other-name").fill("Generator")
    expect(errs).to_be_hidden()
    o2 = p.locator('.item[data-id="other-2"]')
    o2.locator(".other-name").fill("Air compressor")            # named but not marked
    phone.next()
    expect(errs).to_contain_text("Air compressor")
    o2.locator(".other-del").click()                            # remove it
    expect(errs).to_be_hidden()
    o1.locator('.seg button[data-v="GOOD"]').click()            # tap again to un-set
    assert p.evaluate("window.STX_app.state.items['other-1'].status") == ""
    for _ in range(12):
        p.click("#btn-add-other")
    assert p.locator("#others .item").count() == 10            # capped


def test_photos_and_signature_required(phone):
    p = phone.page
    phone.start(); phone.fill_info(); phone.next(); phone.all_good(); phone.next(); phone.next()
    assert phone.screen() == "photos"
    phone.next()
    expect(p.locator('.screen[data-screen="photos"] .screen-errors')).to_contain_text("Fix 2 things")
    p.set_input_files('.photo-input[data-slot="0"]', os.path.join(FIX, "photo1.jpg"))
    p.wait_for_function("!!window.STX_app.state.photos[0]")
    phone.next()
    assert phone.screen() == "photos"
    p.set_input_files('.photo-input[data-slot="1"]', os.path.join(FIX, "photo2.jpg"))
    p.wait_for_function("!!window.STX_app.state.photos[1]")
    phone.next()
    assert phone.screen() == "sign"
    phone.next()
    assert phone.screen() == "sign"
    expect(p.locator('.screen[data-screen="sign"] .screen-errors')).to_contain_text("signature")


# ---------------------------------------------------------------- PDF output
def test_full_inspection_pdf(phone):
    p = phone.page
    phone.start(); phone.fill_info(); phone.next(); phone.all_good()
    phone.flag("25-Man First Aid Kit", "NEED", "YARD", "OVERNIGHT", qty=1, notes="Restock eyewash")
    phone.flag("Hyd Impact", "REPAIR", "SUPERVISOR", repeat="YES", ordered="NO", notes="Leaking")
    phone.flag("Gloves – L", "NEED", "YARD", "NORMAL", repeat="YES", ordered="YES", eta="2026-12-01", qty=12)
    phone.next()
    p.fill("#requests", "Second spill kit please.")
    phone.next(); phone.photos(); phone.next()
    expect(p.locator("#review")).to_contain_text("1 OVERNIGHT")
    expect(p.locator("#review")).to_contain_text("2 REPEAT")
    path, fn = phone.finish()

    assert fn == f"TT-14-{YYMMDD} Jose Garcia.pdf"
    pages = pdf_pages(path)
    assert len(pages) == 2
    assert "WEEKLY TOOL TRAILER INVENTORY" in pages[0] and "Chain Saw" in pages[0]
    assert "OVERNIGHT: 1" in pages[0] and "REPEAT: 2" in pages[0]
    p2 = pages[1]
    order = [p2.rindex(s) for s in ["TOOL / CONSUMABLE REQUESTS", "OTHER REQUESTS / COMMENTS",
                                    "TRAILER CLEANLINESS PHOTOS", "SIGN-OFF"]]
    assert order == sorted(order), "page 2 order must be requests, comments, photos, sign-off"
    # most urgent first, repeat status wording
    assert p2.index("25-Man First Aid Kit") < p2.index("Hyd Impact") < p2.index("Gloves")
    assert "REPEAT – NOT ordered" in p2 or "REPEAT – NOT" in p2
    assert "ETA 12/01/2026" in p2
    assert "Second spill kit please." in p2
    # hidden data stamp round-trips
    stamp = pdf_stamp(path)
    assert stamp["trailerId"] == "TT-14" and stamp["date"] == TODAY
    names = {f["name"]: f for f in stamp["flagged"]}
    assert set(names) == {"25-Man First Aid Kit", "Hyd Impact", "Gloves – L"}
    assert names["Gloves – L"]["eta"] == "2026-12-01"


def test_all_good_pdf(phone):
    phone.to_sign_screen()
    path, _ = phone.finish()
    pages = pdf_pages(path)
    assert len(pages) == 2
    assert "No repairs or replacements needed" in pages[1]
    assert "None." in pages[1]
    assert pdf_stamp(path)["flagged"] == []


def test_long_request_list_overflows_cleanly(phone):
    p = phone.page
    phone.start(); phone.fill_info(); phone.next()
    long_note = "Damaged beyond repair, needs full replacement before next shift. " * 3
    p.evaluate("""(note) => {
      const s = window.STX_app.state;
      document.querySelectorAll('.inv-section:not([data-section="Other"]) .item').forEach(el => {
        el.querySelector('.seg button[data-v="NEED"]').click();
        el.querySelector('.opts[data-f="method"] button[data-val="YARD"]').click();
        el.querySelector('.opts[data-f="urgency"] button[data-val="NORMAL"]').click();
        el.querySelector('.opts[data-f="repeat"] button[data-val="NO"]').click();
        s.items[el.dataset.id].notes = note.slice(0, 200);
      });
    }""", long_note)
    phone.next(); p.fill("#requests", "x " * 400); phone.next(); phone.photos(); phone.next()
    path, _ = phone.finish()
    pages = pdf_pages(path)
    assert len(pages) >= 4
    text = "\n".join(pages)
    assert text.count("Chain Saw") >= 2          # inventory + requests table
    # photos and sign-off always together, sign-off after photos, nothing after
    photo_pg = next(i for i, t in enumerate(pages) if "TRAILER CLEANLINESS PHOTOS" in t)
    sign_pg = next(i for i, t in enumerate(pages) if "Inspector Signature" in t)
    assert sign_pg == photo_pg == len(pages) - 1
    assert all("Page %d of %d" % (i + 1, len(pages)) in t for i, t in enumerate(pages))


def test_unicode_names_and_emoji_dont_break_pdf(phone):
    p = phone.page
    phone.start()
    phone.fill_info(trailer="TT-9", job="Muñoz Yard – Track 3", inspector="José Muñoz")
    phone.next(); phone.all_good()
    phone.flag("Hyd Saw", "REPAIR", "SUPERVISOR", notes="Chain broke 🔧😡 again")
    phone.next(); phone.next(); phone.photos(); phone.next()
    path, fn = phone.finish()
    assert fn == f"TT-9-{YYMMDD} José Muñoz.pdf"
    text = "\n".join(pdf_pages(path))
    assert "José Muñoz" in text and "Muñoz Yard" in text
    assert "Chain broke ? again" in text
    assert pdf_stamp(path)["inspector"] == "José Muñoz"


def test_filename_strips_unsafe_characters(phone):
    phone.to_sign_screen(trailer="TT/14:A", inspector="Pat O'Brien")
    _, fn = phone.finish()
    assert fn == f"TT14A-{YYMMDD} Pat OBrien.pdf"


# ---------------------------------------------------------------- persistence
def test_autosave_restores_everything_after_reload(phone):
    p = phone.page
    phone.to_sign_screen()
    phone.sign()
    p.wait_for_timeout(400)          # autosave debounce
    p.reload()
    assert phone.screen() == "home"
    expect(p.locator("#draft-sub")).to_contain_text("62 of 62 items checked")
    p.click("#btn-continue")
    assert phone.screen() == "sign"
    st = p.evaluate("window.STX_app.state")
    assert all(st["photos"]) and st["signature"]
    p.wait_for_timeout(300)
    inked = p.evaluate("""() => { const c = document.getElementById('sig');
        const d = c.getContext('2d').getImageData(0, 0, c.width, c.height).data;
        for (let i = 3; i < d.length; i += 4) if (d[i]) return true; return false; }""")
    assert inked, "signature should be redrawn after reload"


def test_done_screen_buttons(phone):
    p = phone.page
    phone.to_sign_screen()
    phone.finish()
    p.click("#btn-edit")
    assert phone.screen() == "sign"
    phone.next()                      # finish again
    p.wait_for_selector('.screen[data-screen="done"].active')
    p.click("#btn-new")
    p.wait_for_timeout(200)
    assert phone.screen() == "home"
    expect(p.locator("#draft-card")).to_be_hidden()
    p.go_forward()                    # stale history must not show an old done/step screen
    p.wait_for_timeout(150)
    assert phone.screen() == "home"


def test_discard_from_settings(phone):
    p = phone.page
    phone.start(); phone.fill_info(); phone.next()
    p.click("#nav-settings")
    p.click("#btn-clear-draft")       # confirm() auto-accepted
    p.wait_for_timeout(200)
    assert phone.screen() == "home"
    expect(p.locator("#draft-card")).to_be_hidden()


def test_settings_name_prefills_new_inspections(phone):
    p = phone.page
    p.click("#nav-settings")
    p.fill("#set-name", "Ray Delgado")
    p.click("#nav-back")
    phone.start()
    expect(p.locator("#inspector")).to_have_value("Ray Delgado")


# ---------------------------------------------------------------- last inspection / import
def last_week():
    return (date.today() - timedelta(days=7)).isoformat()


def test_import_pdf_from_another_phone(make_phone):
    a = make_phone()
    a.start(); a.fill_info(inspector="Ray Delgado", when=last_week()); a.next(); a.all_good()
    a.flag("Track Jacks (4)", "NEED", "SUPERVISOR", qty=1, notes="One left at old job")
    a.flag("Gloves – L", "NEED", "YARD", "NORMAL", qty=12)
    a.next(); a.next(); a.photos(); a.next()
    path, _ = a.finish()

    b = make_phone()                   # different phone, empty storage
    pb = b.page
    pb.set_input_files("#screens .screen[data-screen=home] .import-pdf", path)
    expect(pb.locator("#home-msg")).to_contain_text("Loaded TT-14")
    expect(pb.locator("#home-msg")).to_contain_text("2 items flagged")
    b.start()
    expect(pb.locator("#trailerId")).to_have_value("TT-14")      # prefilled from the PDF
    expect(pb.locator("#lastweek")).to_contain_text("Ray Delgado")
    b.fill_info(inspector="Jose Garcia")
    b.next()
    jacks = b.item("Track Jacks (4)")
    jacks.locator('.seg button[data-v="NEED"]').click()
    expect(jacks.locator(".fu-hint")).to_contain_text("Also flagged NEED")
    expect(jacks.locator('.opts[data-f="repeat"] button[data-val="YES"]')).to_have_class(re.compile(r"\bon\b"))
    # an item that wasn't flagged last week gets no hint / pre-answer
    saw = b.item("Hyd Saw")
    saw.locator('.seg button[data-v="NEED"]').click()
    expect(saw.locator(".fu-hint")).to_be_hidden()


def test_import_rejects_other_pdfs(phone):
    p = phone.page
    p.set_input_files("#screens .screen[data-screen=home] .import-pdf", os.path.join(FIX, "not-from-app.pdf"))
    expect(p.locator("#home-msg")).to_contain_text("wasn't created by this app")


def test_import_keeps_newer_inspection(make_phone):
    a = make_phone()
    a.to_sign_screen(when=(date.today() - timedelta(days=14)).isoformat())
    old_path, _ = a.finish()
    b = make_phone()
    b.to_sign_screen(when=last_week())
    b.finish()                         # phone B now has the newer one
    b.page.click("#btn-new")
    b.page.set_input_files("#screens .screen[data-screen=home] .import-pdf", old_path)
    expect(b.page.locator("#home-msg")).to_contain_text("newer inspection")


def test_same_day_history_not_used_for_repeats(phone):
    p = phone.page
    phone.start(); phone.fill_info(); phone.next(); phone.all_good()
    phone.flag("Hyd Saw", "REPAIR", "SUPERVISOR")
    phone.next(); phone.next(); phone.photos(); phone.next()
    phone.finish()
    p.click("#btn-new")
    phone.start(); phone.fill_info(); phone.next()           # same trailer, same day
    phone.item("Hyd Saw").locator('.seg button[data-v="REPAIR"]').click()
    expect(phone.item("Hyd Saw").locator(".fu-hint")).to_be_hidden()


def test_settings_lists_and_removes_history(phone):
    p = phone.page
    phone.to_sign_screen(when=last_week())
    phone.finish()
    p.click("#btn-new")
    p.click("#nav-settings")
    expect(p.locator("#set-history")).to_contain_text("TT-14")
    p.click("#set-history [data-del]")
    expect(p.locator("#set-history")).to_contain_text("None yet")


# ---------------------------------------------------------------- phone polish
def test_double_tap_finish_creates_one_pdf(phone):
    p = phone.page
    phone.to_sign_screen()
    phone.sign()
    p.locator("#btn-next").dblclick()
    p.wait_for_selector('.screen[data-screen="done"].active')
    p.wait_for_timeout(300)
    p.go_back()                       # one back = sign screen (no duplicate "done" entry)
    p.wait_for_timeout(150)
    assert phone.screen() == "sign"


def test_next_bar_stays_when_no_keyboard(phone):
    p = phone.page
    phone.start()
    p.click("#job")                    # focus without an on-screen keyboard
    expect(p.locator("#bottombar")).to_be_visible()


def test_next_bar_hides_when_keyboard_shrinks_screen(phone):
    p = phone.page
    phone.start()
    p.click("#job")
    p.set_viewport_size({"width": 390, "height": 420})   # simulate keyboard opening
    p.wait_for_timeout(200)
    expect(p.locator("#bottombar")).to_be_hidden()
    p.locator("#job").blur()
    p.set_viewport_size({"width": 390, "height": 844})
    p.wait_for_timeout(250)
    expect(p.locator("#bottombar")).to_be_visible()


def test_long_job_name_and_many_other_items(phone):
    p = phone.page
    phone.start()
    phone.fill_info(job="Union Pacific Houston Terminal Sub – Englewood Yard Lead Track Switch Rehab Phase 2 (Nights)")
    phone.next(); phone.all_good()
    for i in range(8):
        p.click("#btn-add-other")
    items = p.locator("#others .item")
    for i in range(items.count()):
        items.nth(i).locator(".other-name").fill(f"Extra tool number {i + 1} with a long name")
        items.nth(i).locator('.seg button[data-v="GOOD"]').click()
    phone.next(); phone.next(); phone.photos(); phone.next()
    path, _ = phone.finish()
    pages = pdf_pages(path)
    assert "Extra tool number 10" in pages[0]          # all 10 others fit on page 1
    assert len(pages) == 2
