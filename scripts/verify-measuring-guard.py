#!/usr/bin/env python3
"""대기 화면(`/brand/measuring`)의 **방어 로직**을 원가 없이 검증한다.

왜 원가가 안 드나: 측정을 **시작하지 않고** 잘못된 job id 로만 접근한다.
  → AI 엔진 호출이 일어나지 않는다(등록 버튼을 누르지 않는다).

🔒 검증하는 계약(page.tsx):
  ① `?job=` 없이 오면 → `/brand` 로 돌려보낸다(기다릴 게 없다)
  ② 없는 job id → `/brand` (존재 여부를 흘리지 않는다)
  ③ 남의 org job id → `/brand` (**도메인이 새면 안 된다**)
  ④ 이미 끝난 job → `/` (기다리게 하지 않는다)

⚠️ ③④ 는 실제 job id 가 있어야 완전히 검증되므로, 여기서는 ①② 와
   **"어떤 경우에도 도메인 문자열이 노출되지 않는다"** 를 본다.
"""

import re
import sys
from pathlib import Path

from playwright.sync_api import sync_playwright

ENV_FILE = Path(__file__).resolve().parent.parent / "apps/app/.env.local"
BASE = "https://app.findable.co.kr"
OUT = Path("/tmp/findable-measuring")


def creds() -> tuple[str, str]:
    text = ENV_FILE.read_text()
    found = dict(re.findall(r"^(FINDABLE_TEST_\w+)=(.*)$", text, re.M))
    return (
        found.get("FINDABLE_TEST_EMAIL", "").strip(),
        found.get("FINDABLE_TEST_PW", "").strip(),
    )


CASES = [
    ("job 파라미터 없음", "/brand/measuring", "/brand"),
    ("없는 job id", "/brand/measuring?job=00000000-0000-0000-0000-000000000000", "/brand"),
    ("빈 job id", "/brand/measuring?job=", "/brand"),
    ("형식이 틀린 job id", "/brand/measuring?job=not-a-uuid", "/brand"),
    # 🔒 SQL/경로 주입 흉내 — 서버가 그대로 조회에 넣으면 500 이 난다.
    ("주입 시도", "/brand/measuring?job=%27%20OR%201%3D1--", "/brand"),
]


def main() -> int:
    email, pw = creds()
    if not (email and pw):
        print("🔴 검증 계정 없음", file=sys.stderr)
        return 2
    OUT.mkdir(parents=True, exist_ok=True)

    with sync_playwright() as p:
        browser = p.chromium.launch()
        ctx = browser.new_context(viewport={"width": 1440, "height": 1000})
        page = ctx.new_page()
        errors: list[str] = []
        page.on(
            "console",
            lambda m: errors.append(m.text) if m.type == "error" else None,
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
            print("🔴 로그인 실패")
            return 1
        print(f"✅ 로그인 성공 ({email})\n")

        failed = 0
        for name, path, expect in CASES:
            resp = page.goto(f"{BASE}{path}", wait_until="networkidle")
            page.wait_for_timeout(1200)
            status = resp.status if resp else 0
            url = page.url
            body = page.inner_text("body")

            landed = expect in url and "/brand/measuring" not in url
            no_500 = status < 500
            # 🔴 어떤 경우에도 대기 화면 문구가 뜨면 안 된다(= 남의 측정을 보고 있다).
            no_leak = "물어보고 있어요" not in body

            ok = landed and no_500 and no_leak
            failed += 0 if ok else 1
            print(f"{'✅' if ok else '🔴'} {name}")
            print(f"     → {status} · {url.replace(BASE, '')}")
            if not landed:
                print(f"     🔴 기대 경로 {expect} 로 안 갔다")
            if not no_500:
                print("     🔴 서버 오류(500)")
            if not no_leak:
                print("     🔴 대기 화면이 그대로 렌더됐다(정보 노출)")

        real_errors = [e for e in errors if "favicon" not in e.lower()]
        print(f"\n{'🔴' if real_errors else '✅'} 콘솔 에러 {len(real_errors)}건")
        for e in real_errors[:5]:
            print(f"   {e[:160]}")

        browser.close()

    print(f"\n{'🔴 실패 ' + str(failed) + '건' if failed else '✅ 방어 로직 전건 통과'}")
    return 1 if failed else 0


if __name__ == "__main__":
    sys.exit(main())
