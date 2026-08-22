#!/usr/bin/env python3
"""Findable 검증용 관리자 헬퍼 — Clerk 프로덕션 API + DB.

왜 있나(2026-08-10 세션N-13): 화면 검증을 매번 사용자에게 부탁하던 것을
자동화한다. 브라우저 로그인보다 이쪽이 **빠르고 강하다**:
  · 로그인 폼·Cloudflare 봇 차단을 거치지 않는다(sign-in token)
  · plan 을 직접 바꿔 **유료 화면**까지 검증할 수 있다(무료만 보던 한계 해소)
  · 테스트 사용자를 만들고 지운다

🔒 키는 `apps/app/.env.local` 의 `CLERK_PROD_SECRET_KEY`(git 제외).
   **값을 절대 출력하지 않는다.**

사용:
    python3 scripts/findable_admin.py users            # 사용자·plan 목록
    python3 scripts/findable_admin.py orgs             # 조직 목록
    python3 scripts/findable_admin.py plan <email> growth   # plan 변경
    python3 scripts/findable_admin.py token <email>    # 로그인 토큰(자동화용)
    python3 scripts/findable_admin.py memberships     # 조직↔사용자 실제 소속(backfill 대조용)
"""

from __future__ import annotations

import json
import re
import subprocess
import sys
from urllib.parse import quote
from pathlib import Path

ENV = Path(__file__).resolve().parent.parent / "apps/app/.env.local"
API = "https://api.clerk.com/v1"


def _key() -> str:
    if not ENV.exists():
        sys.exit("🔴 apps/app/.env.local 없음")
    found = dict(re.findall(r"^([A-Z_]+)=(.*)$", ENV.read_text(), re.M))
    key = found.get("CLERK_PROD_SECRET_KEY", "").strip()
    if not key.startswith("sk_live_"):
        sys.exit("🔴 CLERK_PROD_SECRET_KEY(sk_live_) 가 .env.local 에 필요합니다")
    return key


def api(path: str, method: str = "GET", body: dict | None = None):
    """curl 로 호출한다 — 이 환경의 python ssl 이 api.clerk.com 을 못 뚫는다(실측)."""
    cmd = ["curl", "-s", "-X", method, f"{API}{path}", "-H", f"Authorization: Bearer {_key()}"]
    if body is not None:
        cmd += ["-H", "Content-Type: application/json", "-d", json.dumps(body)]
    out = subprocess.run(cmd, capture_output=True, text=True, check=True).stdout
    data = json.loads(out) if out.strip() else {}
    if isinstance(data, dict) and data.get("errors"):
        sys.exit(f"🔴 {data['errors'][0].get('message')}")
    return data


def mask(email: str) -> str:
    return re.sub(r"^(.{3}).*@", r"\1***@", email)


def find_user(email: str) -> dict:
    # 🔴 `+` 를 반드시 인코딩한다(N-46 에 발견 · N-47 에 고침).
    #   쿼리스트링에서 `+` 는 **공백**으로 해석된다 → `nayoy2+qa@` 가 `nayoy2 qa@` 로 조회돼
    #   "사용자를 찾을 수 없습니다" 가 뜬다. 계정은 멀쩡히 있는데 도구가 못 찾은 것이다.
    for u in api(f"/users?email_address={quote(email, safe='')}"):
        return u
    sys.exit(f"🔴 사용자를 찾을 수 없습니다: {mask(email)}")


def cmd_users() -> None:
    users = api("/users?limit=50")
    print(f"사용자 {len(users)}명\n")
    for u in users:
        emails = [mask(e["email_address"]) for e in u.get("email_addresses", [])]
        plan = u.get("public_metadata", {}).get("plan", "—")
        print(f"  {u['id']}  {str(emails):42} plan={plan}")


def cmd_orgs() -> None:
    res = api("/organizations?limit=50")
    data = res.get("data", res) if isinstance(res, dict) else res
    print(f"조직 {len(data)}개\n")
    for o in data:
        print(f"  {o['id']}  {o['name']}  members={o.get('members_count')}")


def cmd_memberships() -> None:
    """조직별 **실제 소속**을 찍는다 — DB `User.organizationId` backfill 의 정답지.

    🔴 왜 필요한가(N-47): DB 는 `Organization.ownerId` 로 「누가 만들었나」만 안다.
      **소유자가 아닌 멤버**는 DB 만 봐선 알 수 없다. 진실은 Clerk 에 있다.
    """
    res = api("/organizations?limit=50")
    orgs = res.get("data", res) if isinstance(res, dict) else res
    print(f"조직 {len(orgs)}개 — 소속 전수\n")
    for o in orgs:
        res_m = api(f"/organizations/{o['id']}/memberships?limit=50")
        mems = res_m.get("data", res_m) if isinstance(res_m, dict) else res_m
        print(f"  {o['id']}  {o['name']}  ({len(mems)}명)")
        for m in mems:
            pud = m.get("public_user_data") or {}
            ident = pud.get("identifier") or ""
            print(f"      {pud.get('user_id','?')}  {mask(ident):32} role={m.get('role')}")


def cmd_plan(email: str, plan: str) -> None:
    valid = {"free", "starter", "growth", "scale", "enterprise"}
    if plan not in valid:
        sys.exit(f"🔴 plan 은 {sorted(valid)} 중 하나 (insider·pro 는 폐기됨)")
    user = find_user(email)
    api(
        f"/users/{user['id']}/metadata",
        "PATCH",
        {"public_metadata": {"plan": plan}},
    )
    print(f"✅ {mask(email)} → plan={plan}")


def cmd_token(email: str) -> None:
    """Playwright 가 로그인 폼을 건너뛰고 바로 진입할 수 있는 토큰."""
    user = find_user(email)
    res = api("/sign_in_tokens", "POST", {"user_id": user["id"], "expires_in_seconds": 600})
    print(res["token"])


def main() -> None:
    if len(sys.argv) < 2:
        sys.exit(__doc__)
    cmd, *args = sys.argv[1:]
    if cmd == "users":
        cmd_users()
    elif cmd == "orgs":
        cmd_orgs()
    elif cmd == "memberships":
        cmd_memberships()
    elif cmd == "plan" and len(args) == 2:
        cmd_plan(*args)
    elif cmd == "token" and len(args) == 1:
        cmd_token(*args)
    else:
        sys.exit(__doc__)


if __name__ == "__main__":
    main()