#!/usr/bin/env python3
"""등록 → 자동 측정 → 대기 화면 → 결과 자동이동 **전 구간**을 눌러서 검증한다.

왜 있나(2026-08-14 세션N-30): 재설계안 v2 §7 의 2·3·4 번이 만든 흐름은
  **버튼을 눌러야만** 드러난다. 대기 화면은 로그인 + **진행 중인 job** 이 있어야 뜨므로
  정적 확인이 불가능하다(로컬 dev 는 Clerk 개발 인스턴스라 로그인 자체가 안 된다).

💰 **원가가 나간다** — 등록 1건 = AI 엔진 22~56회 호출 ≈ 150~300원.
   👤 승인 후에만 실행할 것(승인 없이 원가를 쓴 사고 이력이 있다).

⭐ **전략: 1회로 최대한 뽑는다.** 측정이 1~3분 백그라운드로 도는 **그 시간에**
   추가 계약을 검증한다(원가 0원). 지금 아니면 24시간 뒤에나 볼 수 있는 것들이다:
     · 측정 **중** → `/brand` 목록의 진행 표시 · 새로고침해도 대기 유지
     · 측정 중 재등록 → **`rate_limited`**(§3-b ⑴ 이 막으려던 조용한 실패의 핵심)
     · 완료 **후** 재측정 → 24h 한도 차단(무료 플랜)

🔴 재시도가 불가능하므로 **매 단계 증거를 남긴다**(스크린샷 + 본문 텍스트).
   중간에 죽어도 어디까지 갔는지 알 수 있어야 한다.
"""

import argparse
import json
import re
import sys
import time
from pathlib import Path

from playwright.sync_api import sync_playwright

OUT = Path("/tmp/findable-measuring")
ENV_FILE = Path(__file__).resolve().parent.parent / "apps/app/.env.local"
BASE = "https://app.findable.co.kr"

# 증거 원장 — 단계마다 append 하고 매번 파일로 flush(중간에 죽어도 남는다).
LEDGER: list[dict] = []


def creds() -> tuple[str, str]:
    """검증 계정 — ⚠️ 값을 절대 출력하지 않는다."""
    text = ENV_FILE.read_text()
    found = dict(re.findall(r"^(FINDABLE_TEST_\w+)=(.*)$", text, re.M))
    return (
        found.get("FINDABLE_TEST_EMAIL", "").strip(),
        found.get("FINDABLE_TEST_PW", "").strip(),
    )


def record(page, step: str, note: str = "") -> str:
    """스크린샷 + 본문을 원장에 남긴다. 반환 = 본문 텍스트."""
    OUT.mkdir(parents=True, exist_ok=True)
    page.screenshot(path=str(OUT / f"{step}.png"))
    try:
        body = page.inner_text("body")
    except Exception:
        body = ""
    LEDGER.append(
        {
            "step": step,
            "url": page.url.replace(BASE, ""),
            "note": note,
            "body_head": body[:400],
            "at": time.strftime("%H:%M:%S"),
        }
    )
    (OUT / "ledger.json").write_text(
        json.dumps(LEDGER, ensure_ascii=False, indent=2)
    )
    print(f"  📸 {step}.png  {note}")
    return body


def check(label: str, ok: bool, detail: str = "") -> bool:
    print(f"  {'✅' if ok else '🔴'} {label}{(' — ' + detail) if detail else ''}")
    return ok


def login(page, email: str, pw: str) -> bool:
    page.goto(f"{BASE}/sign-in", wait_until="networkidle")
    page.fill('input[name="identifier"]', email)
    page.keyboard.press("Enter")
    page.wait_for_timeout(2500)
    if page.locator('input[name="password"]').count() > 0:
        page.fill('input[name="password"]', pw)
        page.keyboard.press("Enter")
        page.wait_for_timeout(4000)
    # 성공 판정은 문구가 아니라 **구조**로(문구는 계속 다듬는다 · S6-b 오탐 사고).
    try:
        page.wait_for_selector('[data-slot="sidebar"], nav', timeout=20000)
        return True
    except Exception:
        record(page, "00-login-failed")
        return False


def main() -> int:
    ap = argparse.ArgumentParser()
    ap.add_argument("--domain", required=True)
    ap.add_argument("--headed", action="store_true")
    args = ap.parse_args()

    email, pw = creds()
    if not (email and pw):
        print("🔴 검증 계정 없음(.env.local)", file=sys.stderr)
        return 2

    OUT.mkdir(parents=True, exist_ok=True)
    results: dict[str, bool] = {}

    with sync_playwright() as p:
        browser = p.chromium.launch(headless=not args.headed)
        ctx = browser.new_context(viewport={"width": 1440, "height": 1000})
        page = ctx.new_page()
        errors: list[str] = []
        page.on(
            "console",
            lambda m: errors.append(m.text) if m.type == "error" else None,
        )

        if not login(page, email, pw):
            print("🔴 로그인 실패")
            return 1
        print(f"✅ 로그인 성공 ({email})\n")

        # ══ 1단계: 등록 (도메인 하나만) ══
        print("── 1단계: 브랜드 등록 ──")
        page.goto(f"{BASE}/brand", wait_until="networkidle")
        page.wait_for_timeout(1500)
        record(page, "01-form", "등록 전")

        page.fill('input[name="domain"]', args.domain)
        # 🔴 브랜드 이름을 **일부러 비운다** — "비우면 도메인을 이름으로 쓴다"(§3-a) 검증.
        print(f"  입력: 도메인={args.domain} · 브랜드 이름=**비움**")

        t0 = time.time()
        page.click('button[type="submit"]')
        print("  ⏳ 등록 버튼 눌렀다…")

        # ══ 2단계: 대기 화면 진입 ══
        moved = False
        for _ in range(40):
            page.wait_for_timeout(1000)
            if "/brand/measuring" in page.url:
                moved = True
                break
        page.wait_for_timeout(1200)
        body = record(page, "02-after-submit", f"{time.time() - t0:.0f}초 경과")

        results["대기 화면 진입"] = check(
            "대기 화면 진입", moved, page.url.replace(BASE, "")
        )
        if moved:
            for must in ["물어보고 있어요", "1~3분", "계속돼요"]:
                results[f"문구:{must}"] = check(f"문구 '{must}'", must in body)
            # 🔴 설계안 §4-c 조건: 가짜 진행률을 만들지 않는다.
            fake = bool(re.search(r"\d\s*/\s*7\s*곳|\d+\s*%", body))
            results["가짜 진행률 없음"] = check("가짜 진행률 없음", not fake)
            results["도메인 표시"] = check(
                "측정 대상 도메인 표시", args.domain in body
            )

            # 모바일 확인(원가 0).
            page.set_viewport_size({"width": 390, "height": 844})
            page.wait_for_timeout(700)
            record(page, "03-waiting-mobile", "모바일")
            page.set_viewport_size({"width": 1440, "height": 1000})
            page.wait_for_timeout(500)

            # ⭐ 새로고침해도 대기 화면이 유지되는가(job 이 살아있는 동안만 검증 가능).
            wait_url = page.url
            page.reload(wait_until="networkidle")
            page.wait_for_timeout(1500)
            results["새로고침 유지"] = check(
                "새로고침해도 대기 유지", "/brand/measuring" in page.url
            )

            # ⭐ 측정 중 재등록 → rate_limited (§3-b ⑴ 핵심 경로 · 원가 0)
            print("\n── 2-b단계: 측정 중 재등록(조용한 실패 방지 검증) ──")
            page.goto(f"{BASE}/brand", wait_until="networkidle")
            page.wait_for_timeout(1500)
            b = record(page, "04-brand-during", "측정 진행 중 목록")
            results["진행 중 표시"] = check(
                "목록에 진행 상태 표시",
                ("측정 중" in b or "대기 중" in b),
            )
            if page.locator('input[name="domain"]').count() > 0:
                page.fill('input[name="domain"]', args.domain)
                page.click('button[type="submit"]')
                page.wait_for_timeout(6000)
                b2 = record(page, "05-duplicate-attempt", "같은 도메인 재등록")
                # 조용히 성공한 척하면 안 된다 — 이유가 화면에 있어야 한다.
                spoke = any(
                    k in b2
                    for k in ["이미", "진행 중", "24시간", "오늘", "등록된"]
                )
                results["재등록 시 이유 안내"] = check(
                    "재등록을 조용히 넘기지 않음", spoke
                )
            page.goto(wait_url, wait_until="networkidle")

            # ══ 3단계: 완료 대기 ══
            print("\n── 3단계: 측정 완료 대기(최대 5분) ──")
            done = False
            for i in range(30):
                page.wait_for_timeout(10000)
                if "/brand/measuring" not in page.url:
                    done = True
                    print(f"  ✅ 자동 이동 ({(i + 1) * 10}초) → {page.url.replace(BASE, '')}")
                    break
                if i % 3 == 2:
                    print(f"  … {(i + 1) * 10}초 경과")
            page.wait_for_timeout(2500)
            record(page, "06-after-complete", "완료 후")
            results["완료 시 자동 이동"] = check("완료 시 자동 이동", done)

        # ══ 4단계: 결과 반영 ══
        print("\n── 4단계: 대시보드 반영 ──")
        page.goto(f"{BASE}/", wait_until="networkidle")
        page.wait_for_timeout(3000)
        dash = record(page, "07-dashboard", "대시보드")
        results["대시보드에 결과"] = check(
            "대시보드에 측정 결과 반영",
            ("아직 측정한 적이 없어요" not in dash),
        )

        page.goto(f"{BASE}/history", wait_until="networkidle")
        page.wait_for_timeout(2000)
        hist = record(page, "08-history", "측정 이력")
        results["이력에 기록"] = check(
            "이력에 기록", "아직 측정한 적이 없어요" not in hist
        )

        real_errors = [e for e in errors if "favicon" not in e.lower()]
        results["콘솔 에러 0"] = check(
            "콘솔 에러 0", not real_errors, f"{len(real_errors)}건"
        )
        for e in real_errors[:5]:
            print(f"     {e[:150]}")

        browser.close()

    passed = sum(1 for v in results.values() if v)
    print(f"\n{'=' * 46}")
    print(f"결과: {passed}/{len(results)} 통과")
    for k, v in results.items():
        if not v:
            print(f"  🔴 {k}")
    print(f"📁 증거: {OUT}")
    return 0 if passed == len(results) else 1


if __name__ == "__main__":
    sys.exit(main())
