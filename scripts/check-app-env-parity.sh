#!/usr/bin/env bash
# app 배포 전 env parity 체크 (P6 — 세션E-2 재발방지)
#
# 왜: P2에서 러너를 apps/web→@repo/audit로 옮겨 app이 직접 실행하게 됐는데,
#   러너가 process.env로 직접 읽는 엔진 키(LETSUR·CLOVA·NAVER·KAKAO·GOOGLE·PERPLEXITY 등)를
#   app Vercel env에 안 넣어서 전부 Gateway 폴백→크레딧 에러→측정 전면 실패했다.
#   tsc·import 그래프엔 안 잡히는 런타임 계약이라 "tsc 통과·라이브만 터짐" 재발.
# 무엇: 러너/엔진이 읽는 process.env 키 목록을 뽑아, app production env에 다 있는지 대조.
#
# 사용: bash scripts/check-app-env-parity.sh   (루트가 findable-app에 링크된 상태에서)
set -euo pipefail

echo "== 러너/엔진/결제가 읽는 process.env 키 (packages/ai + audit + payments) =="
# payments 추가(2026-07-30): 앱 내 결제 서버액션이 PORTONE_API_SECRET을 app 런타임에서 읽음.
KEYS=$(grep -rhoE "process\.env\.[A-Z_]+" packages/ai packages/audit packages/payments --include="*.ts" \
  | sed 's/process.env.//' | sort -u \
  | grep -vE "^(NODE_ENV|VERCEL|VERCEL_.*|NEXT_RUNTIME|AWS_LAMBDA.*|CHROME_PATH)$")

# 순수 모델/토글 env(값 없어도 기본값으로 동작하는 것)는 필수 아님 → 실제 시크릿만 게이트.
# 옵셔널 제외: 본류 7엔진 측정에 불필요한 키.
#   OPENAI_API_KEY = chatgpt는 Letsur로 도니 불필요(@repo/ai/keys optional)
#   FIRECRAWL_API_KEY = 네이버 AI 브리핑용.
#     🔴 N-45: 브리핑이 **본류에 편입**됐다(`AUDIT_BRIEFING_IN_MAIN_ENABLED`).
#       다만 그 플래그는 **기본 off** 라 여전히 필수는 아니다 —
#       ⚠️ **플래그를 켜는 순간 이 키는 필수가 된다.** 켤 때 이 줄에서 빼라.
#       (없으면 어댑터가 STUB 을 돌려주고, 화면은 「연결이 아직 켜지지 않았어요」를 띄운다)
#   BROWSERBASE_API_KEY/PROJECT_ID = chatgpt-web 크롤용, 본류에서 제외됨
#   GOOGLE_API_KEY/PERPLEXITY_API_KEY = 로컬에도 실값 없어 gemini·perplexity 2엔진은
#     의도적으로 폴백/제외 운영 중(2026-07-30, 5엔진 측정). 키 발급해 복구하면 이 줄에서 빼라.
#   PORTONE_WEBHOOK_SECRET/STRIPE_* = 미사용(웹훅 미구현·Stripe는 next-forge 템플릿 잔재).
OPTIONAL="OPENAI_API_KEY|FIRECRAWL_API_KEY|BROWSERBASE_API_KEY|BROWSERBASE_PROJECT_ID|GOOGLE_API_KEY|PERPLEXITY_API_KEY|PORTONE_WEBHOOK_SECRET|STRIPE_SECRET_KEY|STRIPE_WEBHOOK_SECRET"
REQUIRED=$(echo "$KEYS" | grep -E "API_KEY|API_SECRET|CLIENT_ID|CLIENT_SECRET|DATABASE_URL|WEBHOOK_SECRET|STUDIO" \
  | grep -vE "^($OPTIONAL)$" || true)

# 존재 여부(ls)뿐 아니라 값이 실값인지(pull)까지 본다.
#   ⚠️ 세션E-2 2차 실수: env가 "존재"는 하는데 값이 [SENSITIVE] 껍데기로 들어갔다
#      (마스킹된 pull 결과를 그대로 add함) → 존재 체크만으론 못 잡음. 값 검사 필수.
TMP=$(mktemp)
trap 'rm -f "$TMP"' EXIT
# 🔴🔴 N-49: **루트 `.vercel` 은 `findable`(web) 을 가리킨다.** 러너는 `findable-app`
#   에서 돈다 → 루트에서 pull 하면 **엉뚱한 프로젝트를 감사**한다(이 게이트가 그랬다).
#   실측: 루트 pull=66줄(BASEHUB_TOKEN·BLOB_* = web 것) / apps/app pull=53줄.
#   그래서 **반드시 `apps/app` 에서 pull 한다**. ⚠️ `vercel env ls` 는 실행 위치에 따라
#   다른 프로젝트를 찍으므로 「이름이 findable-app 이었다」로 안심하면 안 된다.
APP_DIR="$(cd "$(dirname "$0")/../apps/app" && pwd)"
(cd "$APP_DIR" && vercel env pull "$TMP" --environment=production --yes >/dev/null 2>&1) || {
  echo "!! vercel env pull 실패 — apps/app 이 findable-app 에 링크됐는지 확인"; exit 1; }
# 자기점검: 훑는 대상이 비어 있으면 조용히 통과하지 않는다(📕 N-47 「빈 glob」 교훈).
if [ ! -s "$TMP" ]; then
  echo "!! pull 결과가 비었다 — 이 게이트는 아무것도 검증하지 못했다"; exit 1
fi

# 🔴 N-45: 브리핑 본류 편입 플래그가 **켜져 있으면** FIRECRAWL_API_KEY 는 필수다.
#   플래그만 켜고 키를 안 넣으면 모든 측정이 STUB 브리핑을 만들고, 화면은
#   「연결이 아직 켜지지 않았어요」를 띄운다 = 조용한 반쪽 실패.
BRIEFING_ON=$(grep -E '^AUDIT_BRIEFING_IN_MAIN_ENABLED="?true"?$' "$TMP" 2>/dev/null || true)
if [ -n "$BRIEFING_ON" ]; then
  echo "== 브리핑 본류 편입 ON — FIRECRAWL_API_KEY 를 필수로 승격 =="
  REQUIRED=$(printf '%s\nFIRECRAWL_API_KEY\n' "$REQUIRED" | sort -u)
fi

MISSING=0
WARNED=0
echo "== app production env 대조 (존재 + 실값) =="
while read -r k; do
  [ -z "$k" ] && continue
  # ⚠️ set -e + pipefail 상태에서 grep 불일치(exit 1)가 스크립트를 소리 없이 죽였던 버그
  #    (2026-07-30 실측: 3번째 키가 MISS면 그 뒤 출력 전부 증발) → || true 필수.
  V=$(grep "^$k=" "$TMP" | head -1 | cut -d= -f2- | sed -E 's/^"//; s/"$//' || true)
  if [ -z "$V" ]; then
    echo "  MISS  $k   <<< app에 없음/빈값"
    MISSING=1
  elif [ "$V" = "[SENSITIVE]" ]; then
    # Vercel Sensitive 타입은 "실값이어도" pull이 [SENSITIVE]로 마스킹한다(대시보드에서 넣은 키가 대표적).
    # 실값 여부는 pull로 구분 불가 → 하드 실패 대신 WARN + 라이브 스모크(측정 1건) 검증 안내.
    # (E-2의 '마스킹값을 그대로 add' 실수도 같은 모양으로 보이므로, WARN 키는 스모크로만 확정 가능.)
    echo "  WARN  $k   <<< Sensitive 마스킹 — pull로 실값 확인 불가. 배포 후 측정 1건 스모크로 검증"
    WARNED=1
  else
    echo "  OK    $k   (길이 ${#V})"
  fi
done <<< "$REQUIRED"

if [ "$MISSING" = "1" ]; then
  echo ""
  echo "!! MISS 키를 실값으로 넣기 전엔 배포해도 측정이 폴백/실패한다."
  echo "   실값 소스: apps/web/.env.local (Vercel Sensitive는 재열람 불가라 pull값은 마스킹됨)."
  exit 1
fi
echo ""
if [ "$WARNED" = "1" ]; then
  echo "OK(조건부): MISS 없음. WARN 키는 배포 후 측정 1건으로 스모크 검증할 것."
else
  echo "OK: 러너 시크릿 env가 app에 실값으로 모두 존재."
fi
