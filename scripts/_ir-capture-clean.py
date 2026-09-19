"""IR용 깨끗한 화면 캡처 — 온보딩 가이드 오버레이를 닫고 찍는다.

verify-app.py 와 같은 로그인 경로를 쓰되, 첫 방문 투어("건너뛰기")를 닫는다.
사용: python3 scripts/_ir-capture-clean.py
"""

import os
import re
import sys
from pathlib import Path

from playwright.sync_api import sync_playwright

ENV_FILE = Path(__file__).resolve().parent.parent / "apps/app/.env.local"
OUT = Path(
    "/Users/easymilli/Downloads/바이브코딩/02_지원사업_공모전/"
    "KAIST_OverEdge_Findable/06_IR덱_작업/v14_첨삭반영/캡처"
)
BASE = "https://app.findable.co.kr"
PATHS = ["/", "/actions", "/history", "/compare"]


def creds() -> tuple[str, str]:
    email = os.environ.get("FINDABLE_TEST_EMAIL", "")
    pw = os.environ.get("FINDABLE_TEST_PW", "")
    if email and pw:
        return email, pw
    text = ENV_FILE.read_text()
    found = dict(re.findall(r"^(FINDABLE_TEST_\w+)=(.*)$", text, re.M))
    return (
        email or found.get("FINDABLE_TEST_EMAIL", "").strip(),
        pw or found.get("FINDABLE_TEST_PW", "").strip(),
    )


def dismiss_overlays(page) -> None:
    """온보딩 투어·모달을 닫는다. 문구가 바뀌어도 죽지 않게 여러 후보를 시도."""
    for _ in range(4):
        closed = False
        for label in ["건너뛰기", "닫기", "다음에 하기", "Skip", "Got it"]:
            btn = page.get_by_role("button", name=label)
            if btn.count() > 0 and btn.first.is_visible():
                btn.first.click()
                page.wait_for_timeout(700)
                closed = True
                break
        if not closed:
            break
    page.keyboard.press("Escape")
    page.wait_for_timeout(500)


def main() -> int:
    email, pw = creds()
    if not (email and pw):
        print("🔴 검증 계정 없음", file=sys.stderr)
        return 2
    OUT.mkdir(parents=True, exist_ok=True)

    with sync_playwright() as p:
        browser = p.chromium.launch(headless=False)
        ctx = browser.new_context(
            viewport={"width": 1440, "height": 1000}, device_scale_factor=2
        )
        page = ctx.new_page()
        page.goto(f"{BASE}/sign-in", wait_until="networkidle")
        page.fill('input[name="identifier"]', email)
        page.keyboard.press("Enter")
        page.wait_for_timeout(2500)
        if page.locator('input[name="password"]').count() > 0:
            page.fill('input[name="password"]', pw)
            page.keyboard.press("Enter")
            page.wait_for_timeout(4000)
        page.wait_for_selector('[data-slot="sidebar"], nav', timeout=25000)
        print(f"✅ 로그인 성공 ({email})")

        for path in PATHS:
            page.goto(f"{BASE}{path}", wait_until="networkidle")
            page.wait_for_timeout(1800)
            dismiss_overlays(page)
            page.wait_for_timeout(600)
            name = path.strip("/").replace("/", "_") or "home"
            shot = OUT / f"clean_{name}.png"
            page.screenshot(path=str(shot), full_page=True)
            print(f"📸 {shot.name}")

        browser.close()
    return 0


if __name__ == "__main__":
    sys.exit(main())
