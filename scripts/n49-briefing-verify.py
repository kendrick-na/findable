#!/usr/bin/env python3
"""N-49 검증 — **브리핑 본류 편입이 실제로 도는지** 측정 1회로 확인한다.

💰 원가가 나간다(측정 ≈ ₩150~300 + Firecrawl 최대 3콜). 👤 승인 후에만 실행한다
   (2026-08-20 승인: *"렛서 돌리는거니까 얼마 들지도 않음 테스트 잘하셈"*).

## 왜 필요한가
`AUDIT_BRIEFING_IN_MAIN_ENABLED=true` + `FIRECRAWL_API_KEY` 를 넣고 배포했다.
그런데 **켰다고 도는 게 아니다** — 📕 N-46 교훈: *"스토리 목업은 깨끗해서 실데이터
버그를 못 잡는다. 라이브 화면을 봐야 한다."*

## 무엇을 보는가 (STUB 과 진짜를 구분한다)
🔴 키가 없으면 어댑터가 **STUB** 을 돌려준다(크래시가 아니다). 그래서
「브리핑 행이 생겼다」만으로는 부족하고 **`isStub` 이 false 인지**까지 봐야 한다.
→ DB 를 읽어 판정한다(읽기전용 SELECT).

⚠️ 브리핑은 **정보형 질의에만** 뜬다("효과·후기·장단점"). 추천형엔 원리상 안 뜬다.
   그래서 「미노출」이 나와도 그것만으로 실패가 아니다 — **STUB 인지 실패인지**를 가른다.
"""

import os
import re
import sys
from pathlib import Path

from playwright.sync_api import sync_playwright

BASE = "https://app.findable.co.kr"
OUT = Path("/tmp/findable-n49")
ENV_FILE = Path(__file__).resolve().parent.parent / "apps/app/.env.local"


def creds() -> tuple[str, str]:
    email = os.environ.get("FINDABLE_TEST_EMAIL", "")
    pw = os.environ.get("FINDABLE_TEST_PW", "")
    if email and pw:
        return email, pw
    if ENV_FILE.exists():
        found = dict(
            re.findall(r"^(FINDABLE_TEST_\w+)=(.*)$", ENV_FILE.read_text(), re.M)
        )
        email = email or found.get("FINDABLE_TEST_EMAIL", "").strip()
        pw = pw or found.get("FINDABLE_TEST_PW", "").strip()
    return email, pw


def main() -> int:
    OUT.mkdir(parents=True, exist_ok=True)
    email, pw = creds()
    if not (email and pw):
        print("🔴 검증 계정이 없다(.env.local FINDABLE_TEST_*)")
        return 1

    with sync_playwright() as pw_ctx:
        browser = pw_ctx.chromium.launch()
        ctx = browser.new_context(viewport={"width": 1440, "height": 1000})
        page = ctx.new_page()
        errs: list[str] = []
        page.on(
            "console", lambda m: errs.append(m.text) if m.type == "error" else None
        )

        page.goto(f"{BASE}/sign-in", wait_until="networkidle")
        page.fill('input[name="identifier"]', email)
        page.keyboard.press("Enter")
        page.wait_for_timeout(2500)
        if page.locator('input[name="password"]').count() > 0:
            page.fill('input[name="password"]', pw)
            page.keyboard.press("Enter")
            page.wait_for_timeout(4000)
        try:
            page.wait_for_selector('[data-slot="sidebar"], nav', timeout=20000)
        except Exception:
            page.screenshot(path=str(OUT / "login-failed.png"))
            print("🔴 로그인 실패 —", OUT / "login-failed.png")
            browser.close()
            return 1
        print(f"✅ 로그인 성공 ({email})")

        # 🔴 진짜 트리거는 /brand 의 브랜드 카드 오른쪽 버튼이다(N-48 실측).
        page.goto(f"{BASE}/brand", wait_until="networkidle")
        page.wait_for_timeout(1500)
        btn = page.get_by_role("button", name=re.compile("^측정 시작$"))
        if btn.count() == 0:
            page.screenshot(path=str(OUT / "no-button.png"), full_page=True)
            print("🔴 「측정 시작」을 못 찾았다:", page.inner_text("body")[:400])
            browser.close()
            return 1
        print("🔎 「측정 시작」 클릭 (원가 발생)")
        btn.first.click()
        page.wait_for_timeout(5000)
        page.screenshot(path=str(OUT / "01-after-click.png"), full_page=True)

        # 측정이 시작됐는지만 화면으로 확인하고 빠진다.
        #
        # 🔴 **진행/완료를 화면 문구로 판정하지 않는다.** 「네이버 블로그·뉴스·나무위키
        #   중 어디가 근거로 쓰였는지」는 `/sources` 의 **정적 안내문**이라 항상 매칭된다.
        #   그걸 진행 신호로 읽고 4번이나 *"측정이 돌고 있다"* 고 오판했다(N-49).
        #   ⭐ 판정은 **DB** 로 한다 → `scripts/n49-briefing-db.mjs`
        #   ⚠️ 「측정 중」 배지조차 신뢰하지 말 것 — 배지가 떠도 `Tracking` 이
        #      0건인 경우를 실제로 봤다(env 가 빌드에 반영되지 않았을 때).
        page.goto(f"{BASE}/brand", wait_until="networkidle")
        page.wait_for_timeout(3000)
        started = page.get_by_text("측정 중").count() > 0
        print(f"화면 「측정 중」 표시: {'있음' if started else '없음'}")
        print("⭐ 실제 판정은 DB 로 한다 → node scripts/n49-briefing-db.mjs")
        page.screenshot(path=str(OUT / "02-sources.png"), full_page=True)
        page.goto(f"{BASE}/", wait_until="networkidle")
        page.wait_for_timeout(2000)
        page.screenshot(path=str(OUT / "03-dashboard.png"), full_page=True)
        print("🔴 콘솔 에러:", len(errs))
        print("📸", OUT)
        browser.close()
    return 0


if __name__ == "__main__":
    sys.exit(main())
