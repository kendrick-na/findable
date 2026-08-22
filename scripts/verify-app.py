#!/usr/bin/env python3
"""app.findable.co.kr 화면을 실제 로그인해서 자동 검증한다.

왜 있나(2026-08-10 세션N-13): 화면 변경마다 사용자에게 "직접 눌러보세요"를
요청해 왔는데, 그건 느리고 놓치기 쉽다. Playwright 로 직접 로그인해
렌더링·콘솔에러·요소 존재를 확인하면 훨씬 빠르고 정확하다.

사용:
    export FINDABLE_TEST_PW=...          # 비밀번호는 환경변수로만(로그 노출 금지)
    python3 scripts/verify-app.py                    # 기본 경로 전체
    python3 scripts/verify-app.py /actions /brand    # 특정 경로만
    python3 scripts/verify-app.py --local            # localhost:3000 대상
    python3 scripts/verify-app.py --expect "완료로 표시"   # 이 문구가 있어야 통과

주의:
  · 심사용 계정(kendrick+pay@)은 **진단 이력이 없어** 무료진단 폴백 화면을 못 본다.
    그 경로를 보려면 그 이메일로 진단이 1건 있어야 한다.
  · Clerk Client Trust 가 꺼져 있어야 인증번호 없이 로그인된다
    (심사 통과 후 다시 켜면 이 스크립트도 막힌다 → 그때 계정 전략 재검토).
"""

import argparse
import os
import re
import sys
from pathlib import Path

from playwright.sync_api import sync_playwright

DEFAULT_PATHS = ["/", "/actions", "/brand", "/history", "/billing"]
OUT = Path("/tmp/findable-verify")
ENV_FILE = Path(__file__).resolve().parent.parent / "apps/app/.env.local"


def creds() -> tuple[str, str]:
    """검증 계정을 읽는다 — 환경변수가 우선, 없으면 .env.local(git 제외됨).

    ⚠️ 값을 절대 출력하지 않는다(로그·터미널에 비밀번호가 남으면 안 된다).
    """
    email = os.environ.get("FINDABLE_TEST_EMAIL", "")
    pw = os.environ.get("FINDABLE_TEST_PW", "")
    if email and pw:
        return email, pw
    if ENV_FILE.exists():
        text = ENV_FILE.read_text()
        found = dict(re.findall(r"^(FINDABLE_TEST_\w+)=(.*)$", text, re.M))
        email = email or found.get("FINDABLE_TEST_EMAIL", "").strip()
        pw = pw or found.get("FINDABLE_TEST_PW", "").strip()
    return email, pw


def main() -> int:
    ap = argparse.ArgumentParser()
    ap.add_argument("paths", nargs="*", default=None, help="검사할 경로들")
    ap.add_argument("--local", action="store_true", help="localhost:3000 대상")
    ap.add_argument("--email", default=None, help="기본값은 .env.local 의 계정")
    ap.add_argument("--expect", action="append", default=[], help="본문에 있어야 할 문구")
    ap.add_argument("--headed", action="store_true", help="브라우저를 띄워서 본다")
    # 🔴 2026-08-17(N-37) — 예전엔 1440 고정이라 **모바일을 한 번도 못 봤다.**
    #   v4 P0-4 는 모바일을 실측(4개사 162프레임)해 하단탭까지 확정해뒀는데,
    #   정작 우리 화면이 375~390 에서 어떻게 보이는지는 아무도 안 찍었다.
    ap.add_argument(
        "--width", type=int, default=1440, help="뷰포트 폭(모바일 검증은 390)"
    )
    ap.add_argument("--tag", default="", help="파일명 접두어(폭별로 나눠 저장)")
    args = ap.parse_args()

    env_email, pw = creds()
    email = args.email or env_email
    if not (email and pw):
        print(
            "🔴 검증 계정이 없습니다. apps/app/.env.local 에 "
            "FINDABLE_TEST_EMAIL / FINDABLE_TEST_PW 를 넣으세요.",
            file=sys.stderr,
        )
        return 2

    base = "http://localhost:3000" if args.local else "https://app.findable.co.kr"
    paths = args.paths or DEFAULT_PATHS
    OUT.mkdir(parents=True, exist_ok=True)
    failed = []

    with sync_playwright() as p:
        browser = p.chromium.launch(headless=not args.headed)
        # 모바일 폭이면 터치 디바이스로 흉내낸다(hover 전용 UI 가 숨는 걸 잡기 위해).
        is_mobile = args.width < 768
        ctx = browser.new_context(
            viewport={"width": args.width, "height": 1000 if not is_mobile else 844},
            device_scale_factor=2 if is_mobile else 1,
            has_touch=is_mobile,
            is_mobile=is_mobile,
        )
        page = ctx.new_page()
        console_errors: list[str] = []
        page.on(
            "console",
            lambda m: console_errors.append(m.text) if m.type == "error" else None,
        )

        # ── 로그인 (Clerk 는 이메일 → 비밀번호 2단계)
        page.goto(f"{base}/sign-in", wait_until="networkidle")
        page.fill('input[name="identifier"]', email)
        page.keyboard.press("Enter")
        page.wait_for_timeout(2500)
        if page.locator('input[name="password"]').count() > 0:
            page.fill('input[name="password"]', pw)
            page.keyboard.press("Enter")
            page.wait_for_timeout(4000)
        # ⚠️ URL 로만 판정하면 안 된다(리다이렉트가 늦게 끝나 오탐한다 — 실제로 겪음).
        #   로그인 성공의 진짜 신호는 **앱 셸이 떴는가**(사이드바)다.
        # 🔴 S6-b(2026-08-11) — 예전엔 `text=워크스페이스` 를 기다렸는데, 그건 **사이드바
        #   그룹 라벨**이었다. S6-b 가 IA 를 3단(실행·측정·분석)으로 재편하면서 그 라벨이
        #   사라지자 **정상 배포인데 "로그인 실패"로 오탐**했다(이 스크립트가 나를 막았다).
        #   → 앱 셸의 신호를 **문구가 아니라 구조**(사이드바 엘리먼트)로 잡는다.
        #     문구는 계속 다듬을 것이고, 다듬을 때마다 검증 도구가 깨지면 안 된다.
        try:
            page.wait_for_selector('[data-slot="sidebar"], nav', timeout=20000)
        except Exception:
            page.screenshot(path=str(OUT / "login-failed.png"))
            body = page.inner_text("body")
            print("🔴 로그인 실패.")
            if "incorrect" in body.lower():
                print("   → 비밀번호 불일치. .env.local 의 FINDABLE_TEST_PW 확인.")
            elif "verify you are human" in body.lower():
                print("   → Cloudflare 봇 차단. 자동화로는 통과 불가.")
            elif "code" in body.lower():
                print("   → 이메일 인증코드 요구(Clerk Client Trust 켜짐 가능성).")
            print(f"   스크린샷: {OUT / 'login-failed.png'}")
            browser.close()
            return 1
        print(f"✅ 로그인 성공 ({email})\n")

        # ── 경로별 검사
        for path in paths:
            page.goto(f"{base}{path}", wait_until="networkidle")
            page.wait_for_timeout(1200)
            name = path.strip("/").replace("/", "_") or "home"
            shot = OUT / f"{args.tag}{name}.png"
            page.screenshot(path=str(shot), full_page=True)

            body = page.inner_text("body")
            # 사이드바는 모든 화면에 공통이라 본문 판별에서 잘라낸다.
            main = body.split("Toggle Sidebar", 1)[-1].strip()
            head = main.replace("\n\n", "\n").strip()[:180].replace("\n", " / ")

            ok = True
            notes = []
            if "Application error" in body or "500" == page.title():
                ok = False
                notes.append("서버 에러 화면")
            for phrase in args.expect:
                if phrase not in body:
                    ok = False
                    notes.append(f'"{phrase}" 없음')

            mark = "✅" if ok else "🔴"
            print(f"{mark} {path}  →  {head}")
            if notes:
                print(f"     {' · '.join(notes)}")
            if not ok:
                failed.append(path)

        if console_errors:
            print("\n🔴 콘솔 에러:")
            for e in dict.fromkeys(console_errors):
                print(f"   {e[:160]}")
        else:
            print("\n✅ 콘솔 에러 없음")

        print(f"\n📸 스크린샷: {OUT}")
        browser.close()

    return 1 if failed else 0


if __name__ == "__main__":
    sys.exit(main())