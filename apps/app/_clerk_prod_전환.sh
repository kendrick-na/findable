#!/bin/bash
# Clerk 프로덕션 키 교체 + 재배포 (한 방)
# 실행: bash _clerk_prod_전환.sh
set -e

APPDIR="/Users/easymilli/Downloads/바이브코딩/Findable/apps/app"
ROOT="/Users/easymilli/Downloads/바이브코딩/Findable"
cd "$APPDIR"

echo ""
echo "=================================================="
echo "  Clerk 프로덕션 키 교체 → findable-app 재배포"
echo "=================================================="
echo ""
echo "Clerk 대시보드 > Instance > API keys 에서 두 값을 복사해 두세요."
echo "  - Publishable key : pk_live_... 로 시작"
echo "  - Secret key      : sk_live_... 로 시작"
echo ""

# --- 키 입력 받기 (붙여넣기) ---
read -r -p "① pk_live 값을 붙여넣고 Enter: " PK
echo ""
read -r -s -p "② sk_live 값을 붙여넣고 Enter (화면에 안 보임): " SK
echo ""
echo ""

# --- 형식 최소 검증 ---
if [[ "$PK" != pk_live_* ]]; then
  echo "⚠️  pk 값이 pk_live_ 로 시작하지 않습니다. 개발용(pk_test)이면 중단합니다."
  echo "    입력값 앞부분: ${PK:0:8}..."
  exit 1
fi
if [[ "$SK" != sk_live_* ]]; then
  echo "⚠️  sk 값이 sk_live_ 로 시작하지 않습니다. 개발용(sk_test)이면 중단합니다."
  exit 1
fi
echo "✅ 형식 확인: pk_live / sk_live 맞음"
echo ""

# --- 기존 Production 키 제거 (없어도 무시) ---
echo "→ 기존 Production 키 제거 중..."
vercel env rm NEXT_PUBLIC_CLERK_PUBLISHABLE_KEY production -y 2>/dev/null || true
vercel env rm CLERK_SECRET_KEY production -y 2>/dev/null || true

# --- 새 키 추가 (stdin으로 값 주입) ---
echo "→ 새 pk_live / sk_live 추가 중..."
printf '%s' "$PK" | vercel env add NEXT_PUBLIC_CLERK_PUBLISHABLE_KEY production
printf '%s' "$SK" | vercel env add CLERK_SECRET_KEY production
echo "✅ env 교체 완료"
echo ""

# --- 재배포 (루트에서 findable-app 링크로 교체 → 배포 → 복구) ---
echo "→ findable-app 프로덕션 재배포 중... (몇 분 걸립니다)"
cd "$ROOT"
cp .vercel/project.json .vercel/project.json.web-bak
cp apps/app/.vercel/project.json .vercel/project.json
vercel deploy --prod --yes
mv .vercel/project.json.web-bak .vercel/project.json
echo ""
echo "=================================================="
echo "  ✅ 완료. 이제 Claude에게 '배포 끝났어' 라고 알려주세요."
echo "     (크롬 시크릿창으로 로그인 검증 진행)"
echo "=================================================="
