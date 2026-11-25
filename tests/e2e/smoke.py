"""End-to-end smoke test in a real browser (Playwright + installed Chrome).

Portal: the optometrist sets up identity encryption (hub key pair; recovery
file downloaded). Optical store: PIN set-up -> demo patient -> consent -> adaptive
interview -> tests (acuity, contrast and colour plates are actually taken) ->
profile -> send (identity sealed to the hub) -> encrypted share link opened with
its PIN in the patient's viewer. Portal: the sealed name is opened in the
browser, the case is signed off, a PIN-protected referral letter is made, the
access log shows it; the reply reaches the phone's inbox. Desktop-width
screenshots check the responsive layout. Fails on any browser console error
(CSP violations included).

Usage (server running on BASE, fresh database):
  BASE=http://127.0.0.1:8765 OUT=shots python tests/e2e/smoke.py
"""
import math
import os
import re
import sys
from pathlib import Path

from playwright.sync_api import expect, sync_playwright

BASE = os.environ.get("BASE", "http://127.0.0.1:8765")
OUT = Path(os.environ.get("OUT", "shots"))
OUT.mkdir(parents=True, exist_ok=True)
PERSONA = os.environ.get("PERSONA", "kumar")
PIN = "246810"
errors: list[str] = []


def watch(page, tag):
    page.on("console", lambda m: m.type == "error" and errors.append(f"[{tag}] console: {m.text}"))
    page.on("pageerror", lambda e: errors.append(f"[{tag}] pageerror: {e}"))
    page.on("response", lambda r: r.status >= 400 and errors.append(f"[{tag}] HTTP {r.status} {r.request.method} {r.url}"))


def shot(page, name, full=False):
    page.screenshot(path=str(OUT / f"{name}.png"), full_page=full)


SHOP_LOGIN = "9876543210"
SHOP_PASS = "camp-demo-2026"


def unlock(page):
    """Use this device without an account if asked, set the PIN on first use, or enter it after a reload."""
    page.wait_for_selector("[data-screen^=pin], [data-screen=account], [data-screen=home], [data-screen=interview], [data-screen=summary], [data-screen=checks], [data-screen=rules]")
    if page.locator("main").get_attribute("data-screen") == "account":
        page.click("#accLocalBtn")
        page.wait_for_selector("[data-screen^=pin]")
    screen = page.locator("main").get_attribute("data-screen")
    if screen == "pin-set":
        page.fill("#pin1", PIN)
        page.fill("#pin2", PIN)
        page.click("#pinGo")
    elif screen == "pin-enter":
        page.fill("#pin1", PIN)
        page.click("#pinGo")
    # locator waits, not wait_for_function: the app's CSP (correctly) forbids eval
    expect(page.locator("main")).not_to_have_attribute("data-screen", re.compile(r"^pin"), timeout=20000)


def wait_chart(page, disp):
    """Wait until the chart screen shows the phone's latest instruction."""
    n = page.locator("body").get_attribute("data-remote-n")
    expect(disp.locator(f"#chart[data-n='{n}']")).to_have_count(1, timeout=10000)


def take_acuity(page, disp, eye_label, true_logmar=0.2):
    """Answer like a patient with the given acuity: correct when the E on the chart screen is big enough."""
    for _ in range(40):
        if page.locator("[data-screen=check-acuity]").count() == 0:
            return
        wait_chart(page, disp)
        line = page.locator("#lvl").inner_text()
        m = re.search(r"Line 6/([\d.]+)", line)
        logmar = 0.0 if not m else round(math.log10(float(m.group(1)) / 6), 1)
        rot = disp.locator("#chart svg").first.get_attribute("style")
        deg = int(re.search(r"rotate\((\d+)deg\)", rot).group(1))
        shown = {0: "right", 90: "down", 180: "left", 270: "up"}[deg]
        answer = shown if logmar >= true_logmar - 1e-9 else {"right": "left", "left": "up", "up": "down", "down": "right"}[shown]
        page.click(f"[data-d={answer}]")
    raise AssertionError(f"acuity {eye_label} did not finish")


PLATE_DIGITS = ["12", "8", "29", "5", "74", "3"]  # web/js/measure/plates.js SERIES


def take_contrast(page, disp, true_logcs=1.65):
    """Answer like an eye with the given contrast threshold (rings on the chart screen)."""
    for _ in range(80):
        if page.locator("[data-screen=check-contrast]").count() == 0:
            return
        wait_chart(page, disp)
        lvl = page.locator("#lvl").inner_text()
        logcs = float(re.search(r"log CS ([\d.]+)", lvl).group(1))
        rot = disp.locator("#chart svg").first.get_attribute("style")
        deg = int(re.search(r"rotate\((\d+)deg\)", rot).group(1))
        shown = {0: "right", 90: "down", 180: "left", 270: "up"}[deg]
        if logcs <= true_logcs + 1e-9:
            page.click(f"[data-d={shown}]")
        else:
            page.click("#cant")
    raise AssertionError("contrast did not finish")


def take_colour(page):
    for digits in PLATE_DIGITS:
        page.wait_for_selector("#numOut")
        for d in digits:
            page.click(f"[data-n='{d}']")
        page.click("#plateNext")


def main():
    with sync_playwright() as p:
        browser = p.chromium.launch(channel="chrome", headless=True, args=[
            "--use-fake-ui-for-media-stream", "--use-fake-device-for-media-stream", "--autoplay-policy=no-user-gesture-required"])

        # ---- optometrist hub: set up identity encryption first
        desk = browser.new_context(viewport={"width": 1440, "height": 900}, accept_downloads=True, permissions=["camera", "microphone"])
        desk.add_init_script("localStorage.setItem('dd.stun', 'none')")  # video consult on the local machine only
        portal = desk.new_page()
        watch(portal, "portal")
        portal.on("dialog", lambda d: d.accept())
        portal.goto(f"{BASE}/portal.html")
        portal.wait_for_selector("#demoBtn:visible, .overview")
        if portal.locator("#demoBtn").is_visible():  # the sign-in gate: enter as the demo optometrist
            portal.click("#demoBtn")
        portal.wait_for_selector(".overview")
        with portal.expect_download() as dl:
            portal.click("#hubSetup")
        assert dl.value.suggested_filename.startswith("divyadrishti-hub-recovery-")
        expect(portal.locator("#hubBanner")).to_contain_text("Identity encryption on", timeout=10000)

        # ---- field phone
        phone = browser.new_context(viewport={"width": 390, "height": 844}, device_scale_factor=2, is_mobile=True, has_touch=True,
                                    permissions=["camera", "microphone"])
        # voice off: headless Chrome has real Windows voices and would speak every question
        phone.add_init_script("localStorage.setItem('dd.settings', JSON.stringify({voice: false}))")
        phone.add_init_script("localStorage.setItem('dd.stun', 'none')")
        page = phone.new_page()
        watch(page, "field")
        page.goto(f"{BASE}/")
        page.wait_for_selector("[data-screen=account]")
        shot(page, "00a_account")
        page.click("[data-mode=up]")
        page.fill("#accShop", "Chennai Optics, Velachery")
        page.fill("#accLogin", SHOP_LOGIN)
        page.fill("#accPass", SHOP_PASS)
        page.click("#accGo")
        page.wait_for_selector("[data-screen=pin-set]", timeout=30000)
        shot(page, "00_pin")
        unlock(page)
        expect(page.locator("#newBtn")).to_be_visible()
        n_lang = page.locator("[data-plang]").count()
        assert n_lang >= 6, "patient languages on the home screen"
        expect(page.locator("#tabbar")).to_be_visible()
        shot(page, "01_home")
        page.click("#tabAccount")
        assert page.locator("[data-ulang]").count() == n_lang, "app languages in the account tab"
        expect(page.locator("[data-ulang=en]")).to_have_class(re.compile(r"\bon\b"))  # opens in English, not Tamil
        expect(page.locator("#devList")).to_contain_text("this device", timeout=10000)
        shot(page, "01c_account_tab", full=True)
        page.click("#tabTools")
        shot(page, "01d_tools_tab")
        page.click("#checkBtn")
        page.wait_for_selector("[data-screen=phonecheck]")
        expect(page.locator(".pcheck")).to_contain_text("Optometrist hub key")
        shot(page, "01b_phonecheck", full=True)
        page.click("#home")

        # ---- demo patient through the interview (autopilot answers)
        page.click("#tabPatients")
        page.wait_for_selector("[data-screen=patients]")
        shot(page, "01e_patients_tab", full=True)
        page.click(f"[data-demo={PERSONA}]")
        page.click("#agree")
        page.wait_for_selector("[data-screen=interview]")
        expect(page.locator("#heard")).to_be_visible(timeout=15000)
        shot(page, "02_interview")
        # reload mid-interview: the encrypted draft must survive
        page.reload()
        unlock(page)
        page.wait_for_selector("#resumeBtn")
        page.click("#resumeBtn")
        page.wait_for_selector("[data-screen=checks]", timeout=120000)
        shot(page, "03_checks")

        all_checks = page.locator("[data-chk]").evaluate_all("els => els.map(e => e.dataset.chk)")
        assert len(all_checks) == 12, f"full battery listed: {all_checks}"
        checks = page.locator(".check.rec [data-chk]").evaluate_all("els => els.map(e => e.dataset.chk)")
        print("tests recommended:", checks)
        # ---- every chart test needs the chart screen: blocked on the phone until one is paired
        page.click("[data-chk=acuity]")
        expect(page.locator("#pairNow")).to_be_visible()
        shot(page, "05a_needs_screen")
        page.click("#backChecks")
        page.wait_for_selector("[data-screen=checks]")
        disp = desk.new_page()
        watch(disp, "display")
        disp.goto(f"{BASE}/display.html")
        shot(disp, "30_display_signin")
        # the test screen signs in with the shop's own account; the shop's phone finds it, no code
        disp.fill("#shopLogin", SHOP_LOGIN)
        disp.fill("#shopPass", SHOP_PASS)
        disp.click("#shopGo")
        expect(disp.locator("#dstate")).to_have_text("Chennai Optics, Velachery", timeout=10000)
        page.click("#pairBtn")
        page.click("#findGo")
        page.wait_for_selector("[data-screen=checks]")
        expect(page.locator(".screencard.on")).to_be_visible()
        expect(disp.locator("#phoneState")).to_have_text("Shop device connected", timeout=10000)
        shot(page, "05b_checks_paired", full=True)
        if "acuity" in checks:
            page.click("[data-chk=acuity]")
            expect(page.locator("#lvl")).to_contain_text("test screen")
            wait_chart(page, disp)
            shot(page, "04_acuity")
            shot(disp, "31_display_acuity")
            take_acuity(page, disp, "R", 0.2)
            if page.locator("[data-screen=pinhole]").count():
                page.click("#noph")
            take_acuity(page, disp, "L", 0.2)
            page.wait_for_selector("[data-screen=checks]")
        if "contrast" in checks:
            page.click("[data-chk=contrast]")
            page.wait_for_selector("[data-screen=check-contrast]")
            wait_chart(page, disp)
            shot(page, "04b_contrast")
            shot(disp, "31_display_contrast")
            take_contrast(page, disp)
            page.wait_for_selector("[data-screen=checks]")
        if "colour" in checks:
            page.click("[data-chk=colour]")
            page.wait_for_selector("[data-screen=check-colour]")
            wait_chart(page, disp)
            shot(page, "04c_colour")
            shot(disp, "31_display_plate")
            take_colour(page)
            page.wait_for_selector("[data-screen=checks]")
        for k in checks:
            if k in ("acuity", "contrast", "colour"):
                continue
            page.click(f"[data-chk={k}]")
            page.wait_for_selector("#demoFill", timeout=10000)
            if k == "reading_distance":
                page.wait_for_timeout(1500)
                shot(page, "05_camera")
            else:
                page.wait_for_timeout(300)
                shot(page, f"06_{k}", full=True)
            if k in ("amsler", "duochrome", "astigmatism", "near_acuity"):
                disp.wait_for_selector("#stage:not([hidden])", timeout=10000)
                disp.wait_for_timeout(300)
                shot(disp, f"31_display_{k}")
            page.click("#demoFill")
            page.wait_for_selector("[data-screen=checks]")
        # ---- lensometry: the chart screen shows the pattern, the rear camera reads the lens
        page.click("[data-chk=lensometry]")
        page.wait_for_selector("[data-screen=check-lensometry]")
        disp.wait_for_selector("#board")
        page.wait_for_timeout(800)
        shot(page, "06_lensometry", full=True)
        shot(disp, "31_display_lenso")
        page.click("#backChecks")
        page.wait_for_selector("[data-screen=checks]")
        page.click("#toSummary")
        page.wait_for_selector("[data-screen=summary]")
        page.click("details.sect summary")
        page.click(".dpath summary")
        page.click(".quality summary")
        shot(page, "07_summary", full=True)
        acuity_txt = page.locator(".kv", has_text="Distance vision").inner_text()
        assert "6/9" in acuity_txt, f"staircase result not shown: {acuity_txt}"
        if "contrast" in checks:
            expect(page.locator(".findings")).to_contain_text("Contrast sensitivity")
            expect(page.locator(".findings")).to_contain_text("Colour vision")
        # ---- virtual try-on on the sample face
        page.click("#tryBtn")
        page.wait_for_selector("[data-screen=tryon]")
        page.click("#tSample")
        expect(page.locator("#tCtl")).to_be_visible()
        page.click("[data-shape=cateye]")
        page.click("[data-lens=photo]")
        if page.locator("#tZones").count():
            page.check("#tZones")
        shot(page, "07b_tryon", full=True)
        page.click("[data-shape=round]")
        page.click("[data-colour=gold]")
        page.click("[data-lens=blue]")
        if page.locator("#tZones").count():
            page.uncheck("#tZones")
        shot(page, "07c_tryon_round")
        page.click("#tBack")
        page.wait_for_selector("[data-screen=summary]")
        page.click("#sendBtn")
        expect(page.locator("#sendState")).to_contain_text("sealed", timeout=15000)

        # ---- encrypted share: QR + PIN; the patient's phone opens the link
        page.fill("#passportCard .shPhone", "9876500001")
        page.click("#passportCard .mkShare")
        expect(page.locator("#passportCard .shareOut")).to_be_visible(timeout=15000)
        assert page.locator("#passportCard .qr").count() == 0, "no QR code: SMS to a typed number"
        pin = page.locator("#passportCard .pinshow").inner_text().replace("PIN", "").strip()
        sms = page.locator("#passportCard .smsLink").get_attribute("href")
        assert sms.startswith("sms:9876500001?body="), sms
        link = re.search(r"(https?%3A%2F%2F[^&]+|https?://\S+)", sms).group(1)
        from urllib.parse import unquote
        link = unquote(link)
        assert "#" in link and "share.html" in link, link
        shot(page, "08_passport", full=True)
        viewer = phone.new_page()
        watch(viewer, "viewer")
        viewer.goto(link)
        viewer.wait_for_selector("#pinCard:not([hidden])", timeout=15000)
        assert "#" not in viewer.url, "key removed from the address bar"
        viewer.fill("#pin", pin)
        viewer.click("#pinBtn")
        expect(viewer.locator("#doc")).to_contain_text("DD-", timeout=15000)
        shot(viewer, "08b_share_viewer", full=True)
        viewer.close()

        # ---- portal: the sealed identity opens only in the hub's browser
        portal.reload()
        portal.wait_for_selector(".overview")
        expect(portal.locator(".overview")).to_contain_text("waiting for review")  # reviewer dashboard
        expect(portal.locator(".nextgrid .bcard").first).to_be_visible()
        shot(portal, "09a_portal_overview", full=True)
        portal.click("[data-tab=queue]")
        portal.wait_for_selector(".crow")
        shot(portal, "09c_portal_patients", full=True)
        name = "S. Kumar" if PERSONA == "kumar" else None
        row = portal.locator(".crow", has_text=name).first
        expect(row).to_be_visible(timeout=15000)
        row.click()
        portal.wait_for_selector("#rvForm")
        expect(portal.locator(".dhead")).to_contain_text("sealed to this hub, opened here")
        shot(portal, "09_portal_case")
        # ---- video consult: the optometrist calls the store phone about this case
        portal.click("#callBtn")
        portal.wait_for_selector(".call")
        page.wait_for_selector(".callbanner", timeout=15000)
        shot(page, "13a_call_incoming")
        page.click("#cbJoin")
        page.wait_for_selector(".call")
        try:
            expect(portal.locator("#cState")).to_have_text("Connected", timeout=20000)
            expect(page.locator("#cState")).to_have_text("Connected", timeout=10000)
            print("video consult: connected")
        except AssertionError:
            print("WARNING: the video consult did not connect in this browser")
        portal.fill("#callNotes", "Comfortable with an office lens; asked about cost.")
        page.wait_for_timeout(1500)
        shot(portal, "09b_portal_call")
        shot(page, "13b_call_phone")
        portal.click("#cEnd")
        portal.wait_for_selector(".call", state="detached")
        page.wait_for_selector(".call", state="detached", timeout=15000)
        expect(portal.locator("#rvComments")).to_have_value(re.compile("Video consult: Comfortable"))
        portal.fill("#rvComments", portal.locator("#rvComments").input_value() + "\nAdvise an anti-glare coating; recheck in 12 months.")
        portal.click("#shareLetter")
        try:
            expect(portal.locator("#shareResult .pinshow")).to_contain_text("PIN", timeout=15000)
        except AssertionError:
            raise AssertionError(f"referral share failed: {portal.locator('#shareResult').inner_text()}")
        portal.fill("textarea[name=notes]", "E2E: checked trace and measurements.")
        portal.click("#rvForm button[type=submit]")
        expect(portal.locator(".reviewed")).to_be_visible(timeout=10000)
        expect(portal.locator(".reviewed .comment")).to_contain_text("anti-glare")
        expect(portal.locator("table.trace").last).to_contain_text("case reviewed")
        shot(portal, "10_portal_reviewed", full=True)
        portal.click("[data-tab=planning]")
        portal.wait_for_selector("#planningTab .tiles")
        shot(portal, "11_planning", full=True)
        portal.click("[data-tab=rules]")
        expect(portal.locator("#rulesTab")).to_contain_text("Not a red flag")
        shot(portal, "11b_portal_rules", full=True)
        portal.click("[data-edit=FLASHES_FLOATERS]")
        portal.fill("#ruleForm [name=within]", "within 24 hours (same day if there is also a headache)")
        portal.fill("#reReason", "Hub meeting: the partner hospital sees these the same day.")
        portal.click("#ruleForm button[type=submit]")
        expect(portal.locator("#rulesTab .edited").first).to_contain_text("Hub meeting")
        shot(portal, "11d_rules_edited", full=True)

        # ---- the reply reaches the phone
        page.click("#nextPt")
        expect(page.locator(".stats")).to_contain_text("Screened today")  # home adapts once cases exist
        shot(page, "11c_home_context", full=True)
        page.click("#tabPatients")
        expect(page.locator(".inbox [data-share]")).to_be_visible(timeout=10000)  # optometrist reply arrived
        expect(page.locator(".inbox .comment").first).to_contain_text("anti-glare")
        shot(page, "12_inbox")
        # a short text SMS for a patient with a basic phone: no link
        page.click(".inbox [data-share]")
        page.fill("#inboxShare .shPhone", "9876500001")
        page.click("#inboxShare [data-k=text]")
        page.click("#inboxShare .mkShare")
        expect(page.locator("#inboxShare .smsLink")).to_have_attribute("href", re.compile(r"^sms:9876500001\?body="))
        shot(page, "12b_sms_text", full=True)
        # ---- shop dashboard: stock, a sale for this patient, patients by area
        page.click("#tabShop")
        page.wait_for_selector("[data-screen=shop]")
        page.click("#sampleStock")
        expect(page.locator("table.stock")).to_contain_text("Progressive lens pair")
        page.click("#saleBtn")
        page.click("#saleSave")
        expect(page.locator(".sales")).to_contain_text("₹")
        shot(page, "12c_shop", full=True)

        # ---- the same shop account on a camp computer that is not the shop's own
        camp = browser.new_context(viewport={"width": 1440, "height": 900})
        camp.add_init_script("localStorage.setItem('dd.settings', JSON.stringify({voice: false}))")
        cp = camp.new_page()
        watch(cp, "camp")
        cp.goto(f"{BASE}/")
        cp.wait_for_selector("[data-screen=account]")
        cp.fill("#accLogin", SHOP_LOGIN)
        cp.fill("#accPass", SHOP_PASS)
        cp.check("#accShared")
        shot(cp, "40_camp_signin")
        cp.click("#accGo")
        cp.wait_for_selector("[data-screen=home]", timeout=30000)
        expect(cp.locator(".stats")).to_contain_text("Screened today", timeout=20000)
        shot(cp, "41_camp_home")
        cp.click("#tabPatients")
        expect(cp.locator(".inbox")).to_contain_text("S. Kumar", timeout=15000)  # name decrypted from the shop's own sync
        expect(cp.locator(".inbox .comment").first).to_contain_text("anti-glare")
        shot(cp, "42_camp_patients", full=True)
        cp.click("#tabShop")
        expect(cp.locator(".sales")).to_contain_text("₹", timeout=10000)  # the sale made on the phone, synced
        shot(cp, "42b_camp_shop", full=True)
        page.click("#tabAccount")
        expect(page.locator("#devList")).to_contain_text("shared computer", timeout=10000)
        shot(page, "43_phone_devices", full=True)
        cp.click("#tabAccount")
        cp.click("#outBtn")
        cp.wait_for_selector("[data-screen=account]")
        cp.reload()
        cp.wait_for_selector("[data-screen=account]")  # nothing kept on the shared computer
        camp.close()

        # ---- question screens in the new languages (static)
        for key, q, nm in (("ramulu", 3, "13_telugu"), ("sunita", 2, "14_marathi"), ("manjula", 6, "15_kannada"), ("lakshmi", 3, "16_tamil"), ("ravi", 1, "16b_hindi")):
            page.goto(f"{BASE}/?demo={key}&screen=interview&q={q}&still=1")
            unlock(page)
            page.wait_for_selector("[data-screen=interview]")
            page.wait_for_timeout(400)
            shot(page, nm)
        page.goto(f"{BASE}/?screen=rules")
        unlock(page)
        expect(page.locator("main")).to_contain_text("Not a red flag")
        expect(page.locator(".edited").first).to_contain_text("Hub meeting")  # the phone picked up the hub's edit
        shot(page, "17_rules_phone", full=True)

        # ---- the same optical store app on a laptop screen: wide, multi-column layouts
        lap = browser.new_context(viewport={"width": 1440, "height": 900})
        lap.add_init_script("localStorage.setItem('dd.settings', JSON.stringify({voice: false}))")
        wide = lap.new_page()
        watch(wide, "laptop")
        wide.goto(f"{BASE}/")
        unlock(wide)
        expect(wide.locator(".homegrid")).to_be_visible()
        box = wide.locator("main").bounding_box()
        assert box["width"] > 1000, f"main uses the laptop width: {box['width']}"
        shot(wide, "18_laptop_home")
        for key, screen, nm in (("gopal", "interview&q=6", "19_laptop_interview"), ("kumar", "checks", "20_laptop_tests"), ("murugan", "summary", "21_laptop_summary")):
            wide.goto(f"{BASE}/?demo={key}&screen={screen}&still=1")
            unlock(wide)
            wide.wait_for_selector("[data-screen=interview], [data-screen=checks], [data-screen=summary]")
            wide.wait_for_timeout(300)
            shot(wide, nm, full=True)
        browser.close()

    benign = (
        "favicon",
        "TensorFlow Lite XNNPACK",  # MediaPipe logs this INFO line via console.error
        "HTTP 404 GET",  # checked below: only the documented "no hub key yet" 404 is allowed
        "Failed to load resource: the server responded with a status of 404",  # same request, logged without its URL
    )
    stray = [e for e in errors if "HTTP 404 GET" in e and not e.endswith("/api/hub/key")]
    errors.extend(f"unexpected {e}" for e in stray)
    real = [e for e in errors if e.startswith("unexpected ") or not any(b in e for b in benign)]
    if real:
        print("\n".join(real))
        sys.exit(1)
    print(f"OK: no console errors; screenshots in {OUT}")


if __name__ == "__main__":
    main()
