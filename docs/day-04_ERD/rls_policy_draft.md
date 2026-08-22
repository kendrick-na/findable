# A-04-O2 — 권한(RLS) 정책 초안 + 계정 A/B 검증 계획

> Findable · Day04 · 2026-07-08 · Track A
> ⚠️ **가장 중요한 치환**: 커리큘럼 = Supabase DB-level RLS(`CREATE POLICY`). Findable = **Clerk + Neon+Prisma, `relationMode="prisma"` → DB-level RLS 없음**. 격리는 **모든 Prisma 쿼리에 `where: { organizationId }`를 앱 코드가 강제**하는 앱레벨 스코핑. 이게 유일 격리선 = 누락 1건이면 조직 간 데이터 노출(PRD §5 보안 "상").
> 아래 §3 CREATE POLICY SQL은 **설계 사고 훈련용 미러**(만약 RLS를 쓴다면 이 규칙). 실제 강제는 §2 앱레벨 표.
> 🔒 service_role/anon 키·.env.local·실 고객정보 미포함(더미 기준).

---

## 1. 권한 모델 (Clerk 기반)

| 주체 | 출처 | 권한 |
|---|---|---|
| **org owner** | Clerk org `ownerId` | 자기 org 전체 CRUD + billing |
| **org member** | Clerk org role | 자기 org의 brand·prompt·tracking·report 조회/생성 |
| **anon(비로그인)** | org 없음 | AuditJob 생성만(무료진단 1회), 결과는 email로만 |
| **service(서버)** | 서버 전용 | 스코핑 우회 가능 → **브라우저·GitHub·제출물·캡처 노출 절대 금지** |

## 2. ★ 앱레벨 스코핑 표 (Findable 실제 격리 = 이게 정책)

| 테이블 | 스코핑 규칙(모든 쿼리) | SELECT | INSERT | UPDATE | DELETE |
|---|---|---|---|---|---|
| organizations | `id = clerkOrgId` | 본인 org | (Clerk가 생성) | owner | owner |
| users | `organizationId = clerkOrgId` | 같은 org | Clerk 웹훅 | 본인 | 본인 |
| **brands** | **`where:{ organizationId }` 필수** | 같은 org | 같은 org | member | owner |
| prompts | `brand.organizationId = clerkOrgId` | 같은 org | 같은 org | member | member |
| **trackings** | ⚠️**brand 경유** `brand.organizationId` | 같은 org | 시스템(배치) | ✕(불변) | ✕ |
| reports | `organizationId ∥ brandId` org 확인 | 같은 org | 시스템 | ✕ | owner |
| engines | (전역 시드) | 전체 읽기 | ✕ | ✕ | ✕ |
| **audit_jobs** | ❌org 없음 → email·ipAddress | 본인 email | anon(rate limit) | 시스템 | ✕ |
| **leads** | ❌CRM 내부 → 앱 노출 안 함 | 서버만 | 시스템 | 서버 | 서버 |

## 3. RLS CREATE POLICY 미러 (설계 훈련용 — 실행 안 함)

> "만약 Supabase RLS를 쓴다면" 규칙. Findable은 §2 앱레벨로 대체하지만, **같은 판단**(같은 org만 통과)을 SQL로 표현하면:

```sql
-- 전제(Supabase 가정): organization_id 판단은 Clerk JWT claim 또는 org_members 조인.
--   Findable엔 별도 org_members 없음(User.organization_id로 직접). auth.uid()=Clerk sub 가정.

ALTER TABLE brands ENABLE ROW LEVEL SECURITY;
-- Default Deny: 정책 없으면 authenticated도 0건.

-- SELECT: 내 org의 brand만 (USING = 기존 행 조회 판단)
CREATE POLICY "org_members_view_brands"
ON brands FOR SELECT TO authenticated
USING (
  organization_id = (
    SELECT organization_id FROM users WHERE id = (SELECT auth.uid())
  )
);

-- INSERT: 내 org에만 (WITH CHECK = 새로 쓰는 행 판단)
CREATE POLICY "org_members_create_brands"
ON brands FOR INSERT TO authenticated
WITH CHECK (
  organization_id = (
    SELECT organization_id FROM users WHERE id = (SELECT auth.uid())
  )
);

-- ⚠️ trackings: 직접 org 컬럼 없음 → brand 경유 (격리 우회 방지 핵심)
ALTER TABLE trackings ENABLE ROW LEVEL SECURITY;
CREATE POLICY "org_members_view_trackings"
ON trackings FOR SELECT TO authenticated
USING (
  brand_id IN (
    SELECT b.id FROM brands b
    JOIN users u ON u.organization_id = b.organization_id
    WHERE u.id = (SELECT auth.uid())
  )
);

-- audit_jobs: 비로그인(anon) 생성 허용하되 rate limit은 앱/미들웨어에서.
ALTER TABLE audit_jobs ENABLE ROW LEVEL SECURITY;
CREATE POLICY "anon_create_audit"
ON audit_jobs FOR INSERT TO anon
WITH CHECK (true);  -- ⚠️ ip_address rate limit은 정책이 아닌 앱레벨에서
```

## 4. USING vs WITH CHECK — 왜 둘 다 필요한가

| 구분 | 판단 대상 | 없으면 생기는 구멍 |
|---|---|---|
| **USING** | **기존 행**을 읽/수정/삭제할 때 "이 행 보여도 되나" | SELECT/UPDATE/DELETE에서 남의 org 행이 조회됨 |
| **WITH CHECK** | **새로/바뀐 행**이 저장될 때 "이 값으로 써도 되나" | INSERT/UPDATE로 남의 org_id를 심어 데이터 밀반입 |
| 둘 다(UPDATE) | 읽을 자격(USING) + 바꾼 결과가 유효(WITH CHECK) | 자기 행을 남의 org로 옮기는 공격 가능 |

> Findable 앱레벨 등가: **읽기 쿼리 = USING**(where 스코핑), **쓰기 = WITH CHECK**(저장 전 organizationId 강제 주입·검증).

## 5. ⚠️ Findable 고유 위험 지점

1. **trackings 직접 org 키 없음** → `trackingId`로 바로 조회 시 격리 우회. → **모든 tracking 접근은 brand.organizationId 확인 헬퍼(`scopedTracking(orgId)`) 경유 강제**(Day11). → 백로그 BL-006.
2. **JSON 필드(competitors·cited_sources·result) 권한 필터 불가** → 민감정보 넣지 말 것.
3. **audit_jobs 비로그인** → org 방어선 없음. ipAddress rate limit이 유일 방어. **실제 걸려 있나 [확인필요]** → 백로그 BL-007(Day18).
4. **relationMode="prisma"** → onDelete Cascade도 앱 처리 → 고아 레코드 위험(Day18 런북).

> 🔍 **[Day04 재검토 제안 — 미확정]**: 앱레벨 스코핑은 실수 1번=유출. **Prisma Client Extension으로 모든 쿼리에 organizationId where 자동 주입**을 Day11 검토(현재 제안만).

## 6. 계정 A/B 검증 계획 (Day11 실행)

> Findable은 org 격리라 A조직/B조직 계정으로 검증(TaskFlow의 A팀/B팀과 동형).

| 케이스 | 조작 | 기대 결과 |
|---|---|---|
| 1 | A-org 계정으로 만든 brand를 B-org 계정으로 SELECT | 빈 결과(0건) |
| 2 | B-org 계정이 A-org tracking을 trackingId로 직접 조회 | 차단(brand 경유 스코핑에서 필터) |
| 3 | B-org 계정이 brand INSERT 시 organization_id를 A-org로 위조 | 차단(WITH CHECK/앱레벨 org 강제 주입) |
| 4 | anon으로 audit 동일 IP 연속 요청 | rate limit 차단(ipAddress) |
| 5 | 서버(service) SQL로 전체 조회 | 전체 보임 — **service는 스코핑 우회, 절대 클라 노출 금지 재확인** |

## 7. 점검 결과
- [x] service_role/anon 키 실값·.env.local·실 고객 이름/이메일 미포함(더미·구조만)
- [x] 사람 데이터 테이블에 격리 컬럼 존재: organizations·users·brands(organizationId) / trackings·reports(경유·nullable) / audit_jobs·leads(org 밖, email·ip 근거 명시)
