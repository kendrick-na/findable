#!/usr/bin/env bash
# 읽기 전용 MCP 실DB 통합시험용 「이 Mac 로컬 Postgres」 도우미(시험 전용, 운영 DB 와 무관).
#   사용: bash apps/web/__tests__/support/mcp-real-db-local.sh start   # 임시 DB 켜고 스키마 적용, 주소 출력
#         bash apps/web/__tests__/support/mcp-real-db-local.sh stop    # 끄고 임시 폴더 삭제
# 전제: Homebrew postgresql(initdb·pg_ctl·psql) 이 이미 설치돼 있을 것(새로 설치하지 않는다).
# 접속은 127.0.0.1:54329 한 곳뿐이고 외부 네트워크는 쓰지 않는다.
set -euo pipefail
export LC_ALL=C

PORT=54329
DIR="${MCP_TEST_PG_DIR:-${TMPDIR:-/tmp}/findable-mcp-test-pg}"
for cand in /opt/homebrew/opt/postgresql@17/bin /opt/homebrew/opt/postgresql@16/bin /opt/homebrew/bin /usr/local/bin; do
  if [ -x "$cand/initdb" ]; then PATH="$cand:$PATH"; break; fi
done
command -v initdb >/dev/null || { echo "postgres 가 없습니다 → 시험은 '건너뜀'으로 표시됩니다."; exit 2; }

ROOT="$(cd "$(dirname "$0")/../../../.." && pwd)"
URL="postgresql://test@127.0.0.1:${PORT}/mcp_test"

case "${1:-}" in
  start)
    rm -rf "$DIR"
    initdb -D "$DIR/data" -U test --auth=trust -E UTF8 --locale=C >/dev/null
    pg_ctl -D "$DIR/data" -o "-p $PORT -c unix_socket_directories= -c listen_addresses=127.0.0.1" -l "$DIR/pg.log" -w start >/dev/null
    createdb -h 127.0.0.1 -p "$PORT" -U test mcp_test
    # Prisma 스키마를 빈 DB 에 그대로 적용(새 패키지 없이 이미 설치된 prisma CLI 사용)
    (cd "$ROOT/packages/database" && DATABASE_URL="$URL" pnpm exec prisma migrate diff \
      --from-empty --to-schema prisma/schema.prisma --script 2>/dev/null \
      | grep -v '^Loaded Prisma config' > "$DIR/schema.sql")
    psql -q -v ON_ERROR_STOP=1 -h 127.0.0.1 -p "$PORT" -U test mcp_test -f "$DIR/schema.sql" >/dev/null
    echo "TEST_DATABASE_URL=$URL"
    ;;
  stop)
    pg_ctl -D "$DIR/data" -m fast stop >/dev/null 2>&1 || true
    rm -rf "$DIR"
    echo "stopped"
    ;;
  *)
    echo "usage: $0 start|stop" >&2
    exit 1
    ;;
esac
