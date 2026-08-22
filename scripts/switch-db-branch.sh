#!/usr/bin/env bash
# .env.local 의 DB 연결을 Neon 브랜치로 교체한다.
#
# 🔴 값을 화면에 찍지 않는다(비밀번호 포함). 호스트만 마스킹해서 보여준다.
# 🔴 바꾸기 전 자동 백업 → 언제든 되돌릴 수 있다.
#
# 사용:
#   bash scripts/switch-db-branch.sh '<pooled URL>' '<direct URL>'
#   bash scripts/switch-db-branch.sh --restore      # 되돌리기

set -euo pipefail
cd "$(dirname "$0")/.."
ENV=".env.local"
BAK="_백업/.env.local_$(date +%Y%m%d-%H%M%S).bak"

mask() { sed -E 's#://[^@]*@#://***:***@#g' <<<"$1" | cut -c1-70; }

if [[ "${1:-}" == "--restore" ]]; then
  last=$(ls -t _백업/.env.local_*.bak 2>/dev/null | head -1 || true)
  [[ -z "$last" ]] && { echo "백업이 없다."; exit 1; }
  cp "$last" "$ENV"
  echo "✅ 되돌렸다: $last"
  exit 0
fi

POOLED="${1:-}"
DIRECT="${2:-}"

# ── 붙여넣기 편의: 콘솔에서 복사한 덩어리를 그대로 받아 URL 만 뽑아낸다 ──
#   `psql '...'` · `DATABASE_URL=...` · 따옴표 · 앞뒤 공백을 전부 걷어낸다.
#   (실측: Neon Connect 기본 탭이 psql 이라 `psql '…'` 통째로 복사되기 쉽다)
clean_url() {
  local v="$1"
  v="$(sed -E "s/^[[:space:]]*psql[[:space:]]+//" <<<"$v")"   # psql 접두
  v="$(sed -E "s/^[A-Z_]+=//" <<<"$v")"                        # KEY= 접두
  v="$(tr -d "\"'" <<<"$v")"                                   # 따옴표
  v="$(sed -E 's/^[[:space:]]+|[[:space:]]+$//g' <<<"$v")"     # 앞뒤 공백
  # 문장 안에 섞여 있어도 URL 만 집어낸다.
  grep -oE 'postgres(ql)?://[^[:space:]]+' <<<"$v" | head -1 || printf '%s' "$v"
}
POOLED="$(clean_url "$POOLED")"
DIRECT="$(clean_url "$DIRECT")"

if [[ -z "$POOLED" || -z "$DIRECT" ]]; then
  cat <<'USAGE'
사용법:
  bash scripts/switch-db-branch.sh '<pooled URL>' '<direct URL>'

  · pooled = 호스트에 -pooler 가 **있는** 것  → DATABASE_URL
  · direct = 호스트에 -pooler 가 **없는** 것  → DATABASE_URL_UNPOOLED
  · 따옴표로 감쌀 것(URL 안 특수문자가 셸에 먹힌다)

되돌리기:
  bash scripts/switch-db-branch.sh --restore
USAGE
  exit 1
fi

# ── 검증: 헷갈리기 쉬운 두 값을 바꿔 넣는 사고를 막는다 ──
# 진단을 함께 낸다 — "아니다"만 말하면 뭘 고쳐야 할지 알 수 없다.
diagnose() { # $1=라벨 $2=값
  local label="$1" v="$2"
  echo "🔴 ${label} 인자가 postgres URL 이 아니다."
  echo "   받은 값 앞부분: $(cut -c1-40 <<<"$v")…"
  echo "   길이: ${#v} 자"
  case "$v" in
    *psql*|*'-c '*) echo "   👉 psql 명령 전체를 붙여넣은 것 같다. **URL 만** 필요하다(postgresql:// 부터).";;
    'DATABASE_URL='*|*'='*'postgres'*) echo "   👉 'KEY=값' 형태다. **= 뒤의 값만** 넣어라.";;
    *' '*) echo "   👉 공백이 섞였다. 따옴표로 감쌌는지 확인해라.";;
    http*) echo "   👉 http 주소다. DB 연결 문자열이 아니다.";;
    "") echo "   👉 비어 있다. 따옴표 안이 비었거나 셸이 값을 먹었다.";;
    *) echo "   👉 postgresql:// 또는 postgres:// 로 시작해야 한다.";;
  esac
  exit 1
}
[[ "$POOLED" == postgres*://* ]] || diagnose "1번(pooled)" "$POOLED"
[[ "$DIRECT" == postgres*://* ]] || diagnose "2번(direct)" "$DIRECT"
[[ "$POOLED" == *-pooler* ]] || { echo "🔴 1번(pooled)에 -pooler 가 없다. 순서가 바뀐 것 같다."; exit 1; }
[[ "$DIRECT" == *-pooler* ]] && { echo "🔴 2번(direct)에 -pooler 가 있다. 순서가 바뀐 것 같다."; exit 1; }

# 같은 브랜치인지: 엔드포인트 이름(ep-...)이 같아야 한다.
ep_of() { sed -E 's#.*://[^@]*@(ep-[^.]*)\..*#\1#' <<<"$1" | sed 's/-pooler$//'; }
[[ "$(ep_of "$POOLED")" == "$(ep_of "$DIRECT")" ]] || {
  echo "🔴 두 URL 의 엔드포인트가 다르다 — 서로 다른 브랜치를 복사한 것 같다."
  echo "   pooled: $(ep_of "$POOLED")"
  echo "   direct: $(ep_of "$DIRECT")"
  exit 1
}

mkdir -p _백업
cp "$ENV" "$BAK"

python3 - "$POOLED" "$DIRECT" <<'PY'
import re, sys
pooled, direct = sys.argv[1], sys.argv[2]
p = ".env.local"
lines = open(p).read().split("\n")
out, done = [], {"DATABASE_URL": False, "DATABASE_URL_UNPOOLED": False}
for ln in lines:
    m = re.match(r'^(DATABASE_URL_UNPOOLED|DATABASE_URL)=', ln)
    if m:
        key = m.group(1)
        out.append(f"# (이전) {ln}")                      # 원본은 주석으로 보존
        out.append(f'{key}={pooled if key=="DATABASE_URL" else direct}')
        done[key] = True
    else:
        out.append(ln)
for key, ok in done.items():
    if not ok:
        out.append(f'{key}={pooled if key=="DATABASE_URL" else direct}')
open(p, "w").write("\n".join(out))
PY

echo "✅ 교체 완료 (백업: $BAK)"
echo "   DATABASE_URL          → $(mask "$POOLED")"
echo "   DATABASE_URL_UNPOOLED → $(mask "$DIRECT")"
echo ""
echo "되돌리려면: bash scripts/switch-db-branch.sh --restore"
