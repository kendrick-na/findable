#!/usr/bin/env python3
"""N-48 검증 — **새 측정을 1회 돌려 perplexity 출처가 실제로 채워지는지** 본다.

💰 **원가가 나간다**(측정 1건 ≈ ₩150~300). 👤 승인 후에만 실행한다(2026-08-20 승인됨).

## 왜 이게 필요한가
`extractPerplexitySources()` 는 **새 측정에만** 적용된다. 기존 53행은 파싱 수정 전에
저장된 것이라 영원히 비어 있다. 즉 **측정을 한 번 돌려야만** 수정이 증명된다.

⚠️ 로컬에서는 원리적으로 불가 — 엔진 키가 프로덕션 전용 + Sensitive(값 열람 불가).

## 전략: 1회로 최대한 뽑는다
측정이 백그라운드로 도는 동안 추가 검증을 붙인다(원가 0원).
"""

import os
import re
import sys
from pathlib import Path

from playwright.sync_api import sync_playwright

BASE = "https://app.findable.co.kr"
OUT = Path("/tmp/findable-n48")
ENV_FILE = Path(__file__).resolve().parent.parent / "apps/app/.env.local"


def creds() -> tuple[str, str]:
    email = os.environ.get("FINDABLE_TEST_EMAIL", "")
    pw = os.environ.get("FINDABLE_TEST_PW", "")
    if email and pw:
        return email, pw
    if ENV_FILE.exists():
        found = dict(re.findall(r"^(FINDABLE_TEST_\w+)=(.*)$", ENV_FILE.read_text(), re.M))
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
        page.on("console", lambda m: errs.append(m.text) if m.type == "error" else None)

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

        # ── 측정 시작 버튼을 실제로 누른다(고객이 쓰는 경로 그대로)
        # 🔴 대시보드의 「측정 시작」은 /brand 로 가는 **링크**다(실측 — 클릭해도 측정이
        #   시작되지 않았고 DB 에 새 행이 0건이었다). 진짜 트리거는 /brand 의 브랜드 카드
        #   오른쪽 **버튼**이다. → 처음부터 /brand 로 간다.
        page.goto(f"{BASE}/brand", wait_until="networkidle")
        page.wait_for_timeout(1500)
        btn = page.get_by_role("button", name=re.compile("^측정 시작$"))
        if btn.count() == 0:
            page.screenshot(path=str(OUT / "no-button.png"), full_page=True)
            body = page.inner_text("body")[:400]
            print("🔴 「측정 시작」을 못 찾았다. 본문:", body)
            browser.close()
            return 1
        print("🔎 「측정 시작」 발견 — 클릭한다(원가 발생)")
        btn.first.click()
        page.wait_for_timeout(4000)
        page.screenshot(path=str(OUT / "after-click.png"), full_page=True)
        print("   직후 본문:", page.inner_text("body")[:260].replace("\n", " / "))

        # ── 측정이 도는 동안 기다린다(최대 6분). 완료 신호를 폴링한다.
        done = False
        for i in range(36):
            page.wait_for_timeout(10000)
            page.goto(f"{BASE}/sources", wait_until="networkidle")
            body = page.inner_text("body")
            if re.search(r"Perplexity", body):
                m = re.search(r"Perplexity[^\n]{0,60}", body)
                print(f"   [{(i+1)*10}s] {m.group(0) if m else '?'}")
                # 인용 숫자가 붙었으면 완료로 본다
                if re.search(r"Perplexity[\s\S]{0,80}?인용\s*\d+", body):
                    done = True
                    break
        page.screenshot(path=str(OUT / "sources-after.png"), full_page=True)
        print(("✅ 측정 반영 확인" if done else "⚠️ 시간 내 반영 미확인(백그라운드 계속 도는 중일 수 있다)"))
        print("🔴 콘솔 에러:", len(errs))
        print("📸", OUT)
        browser.close()
    return 0


if __name__ == "__main__":
    sys.exit(main())
