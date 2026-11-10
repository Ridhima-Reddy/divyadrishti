"""End-to-end smoke test in a real browser (Playwright + installed Chrome).

Field app: demo patient -> consent -> adaptive interview -> checks (the acuity
staircase is actually taken) -> profile -> send. Portal: the case arrives,
the optometrist signs it off, the reply reaches the phone's inbox.

Usage (server running on BASE):
  BASE=http://127.0.0.1:8765 OUT=shots python tests/e2e/smoke.py
"""
import os
import re
import sys
from pathlib import Path

from playwright.sync_api import sync_playwright, expect

BASE = os.environ.get("BASE", "http://127.0.0.1:8765")
OUT = Path(os.environ.get("OUT", "shots"))
OUT.mkdir(parents=True, exist_ok=True)
PERSONA = os.environ.get("PERSONA", "kumar")
errors: list[str] = []


def watch(page, tag):
    page.on("console", lambda m: m.type == "error" and errors.append(f"[{tag}] console: {m.text}"))
    page.on("pageerror", lambda e: errors.append(f"[{tag}] pageerror: {e}"))


def shot(page, name, full=False):
    page.screenshot(path=str(OUT / f"{name}.png"), full_page=full)


def take_acuity(page, eye_label, true_logmar=0.2):
    """Answer like a patient with the given acuity: correct when the E is big enough."""
    for _ in range(40):
        if page.locator("[data-screen=check-acuity]").count() == 0:
            return
        line = page.locator("#lvl").inner_text()
        m = re.search(r"Line 6/([\d.]+)", line)
        logmar = 0.0 if not m else round(__import__("math").log10(float(m.group(1)) / 6), 1)
        rot = page.locator("svg.optotype").get_attribute("style")
        deg = int(re.search(r"rotate\((\d+)deg\)", rot).group(1))
        shown = {0: "right", 90: "down", 180: "left", 270: "up"}[deg]
        answer = shown if logmar >= true_logmar - 1e-9 else {"right": "left", "left": "up", "up": "down", "down": "right"}[shown]
        page.click(f"[data-d={answer}]")
    raise AssertionError(f"acuity {eye_label} did not finish")


def main():
    with sync_playwright() as p:
        browser = p.chromium.launch(channel="chrome", headless=True, args=[
            "--use-fake-ui-for-media-stream", "--use-fake-device-for-media-stream", "--autoplay-policy=no-user-gesture-required"])
        phone = browser.new_context(viewport={"width": 390, "height": 844}, device_scale_factor=2, is_mobile=True, has_touch=True,
                                    permissions=["camera", "microphone"])
        # voice off: headless Chrome has real Windows voices and would speak every question
        phone.add_init_script("localStorage.setItem('dd.settings', JSON.stringify({voice: false}))")
        page = phone.new_page()
        watch(page, "field")
        page.goto(f"{BASE}/")
        expect(page.locator("#newBtn")).to_be_visible()
        shot(page, "01_home")

        # ---- demo patient through the interview (autopilot answers)
        page.click(f"[data-demo={PERSONA}]")
        page.click("#agree")
        page.wait_for_selector("[data-screen=interview]")
        page.wait_for_function("document.querySelector('#heard') && !document.querySelector('#heard').hidden", timeout=15000)
        shot(page, "02_interview")
        page.wait_for_selector("[data-screen=checks]", timeout=120000)
        shot(page, "03_checks")

        # ---- checks: take the acuity test for real; use demo values for camera checks
        checks = page.locator("[data-chk]").evaluate_all("els => els.map(e => e.dataset.chk)")
        print("checks suggested:", checks)
        if "acuity" in checks:
            page.click("[data-chk=acuity]")
            page.wait_for_selector("svg.optotype")
            shot(page, "04_acuity")
            take_acuity(page, "R", 0.2)
            if page.locator("[data-screen=pinhole]").count():
                page.click("#noph")
            take_acuity(page, "L", 0.2)
            page.wait_for_selector("[data-screen=checks]")
        for k in checks:
            if k == "acuity":
                continue
            page.click(f"[data-chk={k}]")
            page.wait_for_selector("#demoFill", timeout=10000)
            if k == "amsler":
                shot(page, "05_amsler")
            if k == "reading_distance":
                page.wait_for_timeout(1500)
                shot(page, "05_camera")
            page.click("#demoFill")
            page.wait_for_selector("[data-screen=checks]")
        shot(page, "06_checks_done")
        page.click("#toSummary")
        page.wait_for_selector("[data-screen=summary]")
        shot(page, "07_summary", full=True)
        acuity_txt = page.locator(".kv", has_text="Distance vision").inner_text()
        assert "6/9" in acuity_txt, f"staircase result not shown: {acuity_txt}"
        page.click("#sendBtn")
        expect(page.locator("#sendState")).to_contain_text("✓", timeout=10000)
        shot(page, "08_passport", full=True)

        # ---- optometrist portal: the case arrives and is signed off
        desk = browser.new_context(viewport={"width": 1440, "height": 900}, device_scale_factor=1)
        portal = desk.new_page()
        watch(portal, "portal")
        portal.goto(f"{BASE}/portal.html")
        portal.wait_for_selector(".crow")
        shot(portal, "09_portal_queue")
        name = page.locator(".eyebrow").first.inner_text().split("·")[0].strip()
        row = portal.locator(".crow", has_text=name).first
        expect(row).to_be_visible()
        row.click()
        portal.wait_for_selector("#rvForm")
        shot(portal, "10_portal_case", full=True)
        portal.fill("textarea[name=notes]", "E2E: checked trace and measurements.")
        portal.click("#rvForm button[type=submit]")
        expect(portal.locator(".reviewed")).to_be_visible(timeout=10000)
        portal.click("[data-tab=planning]")
        portal.wait_for_selector(".tiles")
        shot(portal, "11_planning", full=True)

        # ---- the reply reaches the phone
        page.click("#nextPt")
        page.click("#inboxBtn")
        expect(page.locator(".inbox")).to_contain_text("🩺", timeout=10000)
        shot(page, "12_inbox")

        # ---- Tamil and Hindi question screens for the deck (static)
        for key, q, nm in (("lakshmi", 5, "13_tamil_question"), ("priya", 8, "14_hindi_question"), ("ravi", 4, "15_red_flag")):
            page.goto(f"{BASE}/?demo={key}&screen=interview&q={q}&still=1")
            page.wait_for_selector("[data-screen=interview]")
            page.wait_for_timeout(400)
            shot(page, nm)
        page.goto(f"{BASE}/?demo=lakshmi&screen=summary")
        page.wait_for_selector("[data-screen=summary]")
        shot(page, "16_summary_lakshmi", full=True)
        browser.close()

    benign = ("favicon", "TensorFlow Lite XNNPACK")  # MediaPipe logs this INFO line via console.error
    real = [e for e in errors if not any(b in e for b in benign)]
    if real:
        print("\n".join(real))
        sys.exit(1)
    print(f"OK: no console errors; screenshots in {OUT}")


if __name__ == "__main__":
    main()
