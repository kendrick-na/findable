#!/usr/bin/env python3
"""카카오페이 심사 제출용 — 결제경로 화면을 실제로 눌러가며 캡쳐한다.

왜 있나(2026-08-11 세션N-18): 카카오페이 심사관이 "결제경로(단건/정기 모두)"
자료를 요청했는데, 결제창은 **실제로 결제 버튼을 눌러야** 뜬다. `verify-app.py`
는 페이지 이동만 하므로 결제창을 못 찍는다.

⚠️ 심사 제출물이라 **실제 화면 그대로**여야 한다. 합성·편집 금지.
⚠️ 결제창까지만 띄우고 **결제는 완료하지 않는다**(실제 청구 없음).

사용:
    export FINDABLE_PAY_EMAIL=kendrick+pay@indigochild.kr
    export FINDABLE_PAY_PW=...        # 비밀번호는 환경변수로만
    python3 scripts/capture-payment-path.py
    python3 scripts/capture-payment-path.py --headed   # 눈으로 보며 디버그
"""

import argparse
import os
import sys
from pathlib import Path

from playwright.sync_api import sync_playwright

WEB = "https://www.findable.co.kr"
APP = "https://app.findable.co.kr"
OUT = Path(__file__).resolve().parent.parent / "_카카오페이_심사보완/_캡쳐_2026-08-11"


def shoot(page, name: str, full: bool = True) -> Path:
    OUT.mkdir(parents=True, exist_ok=True)
    path = OUT / f"{name}.png"
    page.screenshot(path=str(path), full_page=full)
    print(f"  📸 {name}.png")
    return path


def main() -> int:
    ap = argparse.ArgumentParser()
    ap.add_argument("--headed", action="store_true")
    args = ap.parse_args()

    email = os.environ.get("FINDABLE_PAY_EMAIL", "")
    pw = os.environ.get("FINDABLE_PAY_PW", "")
    if not (email and pw):
        print(
            "🔴 계정이 없습니다. FINDABLE_PAY_EMAIL / FINDABLE_PAY_PW 환경변수를 넣으세요.",
            file=sys.stderr,
        )
        return 2

    with sync_playwright() as p:
        browser = p.chromium.launch(headless=not args.headed)
        ctx = browser.new_context(
            viewport={"width": 1440, "height": 1000},
            locale="ko-KR",
        )
        ctx.add_cookies(
            [{"name": "NEXT_LOCALE", "value": "ko", "domain": ".findable.co.kr", "path": "/"}]
        )
        page = ctx.new_page()

        # ── 1. 메인화면 (로그인 불필요)
        # ⚠️ full_page=False — 랜딩이 세로 6,587px 라 전체를 찍으면 PPT 에서
        #   126px 폭으로 축소돼 심사관이 아무것도 못 읽는다(v1 의 문제).
        #   첫 화면(히어로)만 담아야 서비스가 무엇인지 한눈에 보인다.
        print("① 메인화면")
        page.goto(f"{WEB}/ko", wait_until="networkidle")
        page.wait_for_timeout(1500)
        shoot(page, "1_메인화면", full=False)

        # ── 2. 푸터 (사업자정보) — 하단만 보이게 뷰포트 캡쳐
        print("② 푸터(사업자정보)")
        page.keyboard.press("End")
        page.wait_for_timeout(1500)
        shoot(page, "2_푸터_사업자정보", full=False)

        # ── 3. 로그인 페이지
        print("③ 로그인 페이지")
        page.goto(f"{APP}/sign-in", wait_until="networkidle")
        page.wait_for_timeout(2000)
        shoot(page, "3_로그인", full=False)

        # ── 4. 판매상품 페이지(웹 요금제) — 로그인 전에도 공개된 상품 안내
        # ⚠️ 요금제 카드가 보이는 위치까지 스크롤 후 **뷰포트** 캡쳐.
        #   full_page 는 2,041px 라 PPT 에서 407px 로 줄어 가격이 안 읽힌다.
        print("④ 판매상품 페이지(요금제)")
        page.goto(f"{WEB}/ko/pricing", wait_until="networkidle")
        page.wait_for_timeout(1500)
        try:
            page.get_by_text("Starter", exact=False).first.scroll_into_view_if_needed()
            page.wait_for_timeout(1200)
        except Exception:
            pass
        shoot(page, "4_판매상품_요금제", full=False)

        # ── 로그인
        print("→ 로그인 시도")
        page.goto(f"{APP}/sign-in", wait_until="networkidle")
        page.fill('input[name="identifier"]', email)
        page.keyboard.press("Enter")
        page.wait_for_timeout(2500)
        if page.locator('input[name="password"]').count() > 0:
            page.fill('input[name="password"]', pw)
            page.keyboard.press("Enter")
            page.wait_for_timeout(5000)
        try:
            page.wait_for_selector("text=워크스페이스", timeout=20000)
        except Exception:
            shoot(page, "_로그인실패")
            body = page.inner_text("body").lower()
            print("🔴 로그인 실패.")
            if "incorrect" in body or "password" in body:
                print("   → 비밀번호 불일치 가능성")
            elif "code" in body:
                print("   → 인증코드 요구(Clerk Client Trust 켜짐)")
            browser.close()
            return 1
        print("✅ 로그인 성공")

        # ── 5. 상품 상세(앱 요금제 = 결제 진입점)
        print("⑤ 상품 상세(앱 요금제)")
        page.goto(f"{APP}/billing", wait_until="networkidle")
        page.wait_for_timeout(2000)
        shoot(page, "5_상품상세_앱요금제")

        # ── 6. 결제창 — Starter 시작하기 클릭
        print("⑥ 결제창 호출(Starter)")
        # ⚠️ 2026-08-11 정기결제 도입으로 버튼 라벨이 바뀌었다("1회만 결제하기").
        #   옛 라벨도 폴백으로 남겨 둔다(구버전 배포를 찍을 때를 대비).
        btn = page.get_by_role("button", name="1회만 결제하기")
        if btn.count() == 0:
            btn = page.get_by_role("button", name="Starter 시작하기")
        if btn.count() == 0:
            btn = page.get_by_text("Starter 시작하기", exact=False)
        btn.first.click()
        # PortOne 결제창은 iframe/새 레이어로 뜬다 — 넉넉히 기다린다.
        page.wait_for_timeout(9000)
        shoot(page, "6_결제창_단건", full=False)

        # 결제창이 실제로 떴는지 텍스트로 판정(빈 화면 캡쳐 방지)
        body = page.inner_text("body")
        markers = ["카카오페이", "결제", "108,900", "99,000"]
        hit = [m for m in markers if m in body]
        print(f"   결제창 감지 문구: {hit if hit else '❌ 없음'}")
        frames = [f.url for f in page.frames if "portone" in f.url or "kakao" in f.url]
        print(f"   결제 iframe: {frames if frames else '❌ 없음'}")

        # ── 7. 정기결제 사전 고지 (⚖️ 법정 고지 항목이 화면에 보이는지)
        print("⑦ 정기결제 사전 고지")
        page.goto(f"{APP}/billing", wait_until="networkidle")
        page.wait_for_timeout(2000)
        sub = page.get_by_role("button", name="Starter 월 자동결제 시작")
        if sub.count() == 0:
            sub = page.get_by_text("월 자동결제 시작", exact=False)
        sub.first.click()
        page.wait_for_timeout(1500)
        shoot(page, "7_정기결제_사전고지", full=False)
        body = page.inner_text("body")
        for k in ["결제 주기", "차기 결제일", "해지 방법", "108,900"]:
            print(f"   고지 '{k}': {'✅' if k in body else '❌'}")

        # ── 8. 정기결제 빌링키 발급창
        print("⑧ 빌링키 발급창")
        page.get_by_text("위 내용을 확인했으며", exact=False).first.click()
        page.wait_for_timeout(400)
        page.get_by_role("button", name="동의하고 정기결제 시작").first.click()
        page.wait_for_timeout(9000)
        shoot(page, "8_정기결제_결제창", full=False)
        body2 = page.inner_text("body")
        print(f"   결제창 감지: {[m for m in ['카카오페이','정기','결제'] if m in body2]}")

        print(f"\n📁 저장 위치: {OUT}")
        browser.close()
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
