# 읽기 전용 MCP 실DB 통합시험 — 실행 방법

**핵심: 가짜 DB 없이 진짜 Prisma로 `/api/mcp` 를 부르는 시험입니다. 주소(`TEST_DATABASE_URL`)를 주면 돌고, 안 주면 「건너뜀」으로 표시됩니다.**

시험 파일: `apps/web/__tests__/mcp-geo-real-db.test.ts`

## 무엇을 확인하나

| 확인 | 방법 |
|---|---|
| 허용 목록 밖 브랜드 거부 | DB에 있는 남의 브랜드 / 목록 안인데 DB에 없는 브랜드 / 아예 모르는 ID 가 모두 같은 `not_available`, 브랜드 이름 안 샘 |
| 요약의 분모·노출률 | 고정 입력 12행 → 판정 끝난 11건 중 5건(5/11), 측정 실패 1건은 「측정하지 못한 이유」에 건수로 남음 |
| 분포의 분모 | 5분류 건수 5·1·5·1, 분모 11, 전체 12, 측정 실패는 비율 칸에서 제외 |
| 확인 불가 처리 | 완료 회차 없음·전부 측정 실패 → 거부가 아니라 `unverifiable`, 숫자 0 으로 위장하지 않음, 반복 1회면 신뢰구간은 「확인 불가」 |
| DB 쓰기 0 | 모든 도구·모든 경로 호출 전후로 **전 테이블 행 수 + Brand·AuditJob 내용 해시**가 같음. 점검 장치 자체도 「일부러 한 줄 고치면 달라지는지」로 확인 |
| 응답 크기 상한 | 출처 주소 61개 입력 → 50개로 줄고 `truncated: true`, 모든 응답 64KB 이하 |
| 비공개 정보 | 법인명·사업자번호·이메일·답변 원문이 응답 어디에도 없음 |

> 이 시험은 `check_official_facts`(사이트 접속 도구)는 다루지 않습니다. 토큰이 꺼져 있으면 등록되지 않는 도구이고, 외부 접속을 쓰기 때문입니다. 그건 기존 모의 DNS 시험(`mcp-geo-route-integration.test.ts`)이 맡습니다.

## 방법 A. 이 Mac 에서 (Homebrew postgresql 이 이미 있을 때)

```bash
# 1) 임시 DB 켜기 + Prisma 스키마 적용 (127.0.0.1:54329, 외부 접속 없음)
bash apps/web/__tests__/support/mcp-real-db-local.sh start

# 2) 시험 실행
cd apps/web
TEST_DATABASE_URL=postgresql://test@127.0.0.1:54329/mcp_test pnpm exec vitest run __tests__/mcp-geo-real-db.test.ts

# 3) 끄고 임시 폴더 삭제
bash apps/web/__tests__/support/mcp-real-db-local.sh stop
```

- 새로 설치하는 것은 없습니다. 이미 있는 `initdb`·`pg_ctl`·`psql`·`prisma` 만 씁니다.
- 스키마는 `prisma migrate diff --from-empty --to-schema` 로 현재 `schema.prisma` 를 그대로 적용합니다(운영 마이그레이션 28개 이력과는 별개의 「현재 모양」 사본).
- 처음 한 번 `pnpm install` 이 되어 있어야 하고, `pnpm --filter @repo/database build`(Prisma 클라이언트 생성)가 되어 있어야 합니다.

## 방법 B. 대표가 Neon 미리보기 사본 주소를 줄 때

```bash
cd apps/web
TEST_DATABASE_URL='<Neon 미리보기 사본 주소>' pnpm exec vitest run __tests__/mcp-geo-real-db.test.ts
```

- 주소는 **미리보기 사본**만. 시험이 시작 전에 아래 주소를 거부합니다: `supabase.co/.com` 호스트, 이름에 `prod` 포함, 현재 앱이 쓰는 DB 주소와 같은 원격 주소. (이것은 명백한 실수를 막는 최소 장치이지 「시험용이 맞다」는 보증이 아닙니다. 어떤 DB인지는 주소를 주는 사람이 확인해야 합니다.)
- 시험은 **고유 ID 의 조직 1·브랜드 5·완료 측정 4건을 넣고 끝나면 지웁니다.** 그 외 행은 건드리지 않습니다. 도중에 강제 종료되면 이름이 「통합시험 조직」인 조직 1개와 그 브랜드가 남을 수 있으니, 그때는 그 조직만 지우면 됩니다.
- 주소 값은 채팅·로그에 출력하지 않도록 환경변수로만 넘깁니다.

## 이 시험이 증명하지 못하는 것 (약점)

- 스키마는 `schema.prisma` 기준 사본입니다. 운영 DB 가 마이그레이션 이력 때문에 이 모양과 어긋나 있으면 못 잡습니다(Neon 사본으로 돌리면 그 위험이 줄어듭니다).
- 로컬 Postgres 는 Neon 의 연결 방식(풀러·SSL)과 다릅니다. 연결 문제는 방법 B 에서만 드러납니다.
- 「쓰기 0」은 앱이 쓰는 같은 연결로 한 전후 비교입니다. DB 계정 권한을 읽기 전용으로 제한한 시험은 아닙니다(그건 운영 설정 영역).
- 저장된 측정 결과의 모양은 고정 입력 기준입니다. 실제 운영 데이터의 예외적인 모양은 방법 B 에서 실제 사본으로 확인해야 합니다.
