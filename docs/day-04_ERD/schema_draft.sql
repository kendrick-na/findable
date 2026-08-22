-- ============================================================
-- A-04-O1 — Findable schema_draft.sql (설계 초안, 실행 순서)
-- Day04 · 2026-07-08 · Track A
-- ============================================================
-- ⚠️ 이 SQL은 "설계 사고 훈련용"입니다. 운영 DB에 직접 실행하지 않습니다.
--    Findable 실제 스키마 = packages/database/prisma/schema.prisma (Prisma가 생성/마이그레이션 관리).
--    Findable 인증 = Clerk (Supabase auth.users 아님) → owner_id/user_id 는 Clerk user_id(TEXT).
--    relationMode="prisma" → DB-level RLS 미사용. 격리는 앱레벨 organization_id 스코핑(rls_policy_draft.md).
--    아래는 실제 9모델을 SQL로 옮겨 "구조를 읽고 검토"하기 위한 초안.
-- 실행 순서: FK 의존성 순(부모 → 자식). Engine은 시드.
-- ============================================================

-- ── 0. 공통: updated_at 자동 갱신 (Prisma는 @updatedAt으로 처리하나, 설계상 표기) ──
CREATE OR REPLACE FUNCTION set_updated_at()
RETURNS TRIGGER AS $$
BEGIN NEW.updated_at = NOW(); RETURN NEW; END;
$$ LANGUAGE plpgsql;

-- ── 1. organizations (테넌트 경계 = Clerk org) ──
CREATE TABLE organizations (
  id                   UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  name                 TEXT NOT NULL,
  owner_id             TEXT NOT NULL,          -- Clerk user_id (auth.users 아님)
  plan                 TEXT NOT NULL DEFAULT 'free'
                       CHECK (plan IN ('free','starter','growth','scale','enterprise')),
  billing_status       TEXT NOT NULL DEFAULT 'trialing'
                       CHECK (billing_status IN ('active','trialing','past_due','canceled','expired')),
  billing_provider     TEXT CHECK (billing_provider IN ('toss','paypal','wire')),
  billing_customer_id  TEXT,                   -- Toss billingKey / PayPal payerId
  plan_expires_at      TIMESTAMPTZ,
  trial_ends_at        TIMESTAMPTZ,
  created_at           TIMESTAMPTZ DEFAULT NOW(),
  updated_at           TIMESTAMPTZ DEFAULT NOW()
);
CREATE INDEX idx_org_owner ON organizations(owner_id);
CREATE TRIGGER trg_org_updated BEFORE UPDATE ON organizations
  FOR EACH ROW EXECUTE FUNCTION set_updated_at();

-- ── 2. users (Clerk 연동, org 없이도 존재 가능) ──
CREATE TABLE users (
  id               TEXT PRIMARY KEY,           -- Clerk user_id
  email            TEXT UNIQUE NOT NULL,
  name             TEXT,
  organization_id  UUID REFERENCES organizations(id),  -- nullable: 가입 직후
  created_at       TIMESTAMPTZ DEFAULT NOW()
);
CREATE INDEX idx_user_org ON users(organization_id);

-- ── 3. brands (★ 격리 기준 organization_id) ──
CREATE TABLE brands (
  id               UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id  UUID NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,  -- ★ RLS/스코핑 기준
  name             TEXT NOT NULL,
  domain           TEXT NOT NULL,
  industry         TEXT CHECK (industry IN
                   ('beauty','fashion','food','b2b_saas','content_ip','retail',
                    'finance','healthcare','education','other')),
  language         TEXT NOT NULL DEFAULT 'both' CHECK (language IN ('ko','en','both')),
  competitors      JSONB DEFAULT '[]',         -- [{name, domain}] — ⚠️정규 테이블 아님
  entity_variants  JSONB DEFAULT '[]',         -- ["아모레","Amorepacific",...] 한국어 그라운딩
  created_at       TIMESTAMPTZ DEFAULT NOW(),
  updated_at       TIMESTAMPTZ DEFAULT NOW()
);
CREATE INDEX idx_brand_org ON brands(organization_id);
CREATE INDEX idx_brand_domain ON brands(domain);
CREATE TRIGGER trg_brand_updated BEFORE UPDATE ON brands
  FOR EACH ROW EXECUTE FUNCTION set_updated_at();

-- ── 4. prompts (브랜드별 추적 프롬프트) ──
CREATE TABLE prompts (
  id                 UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  brand_id           UUID NOT NULL REFERENCES brands(id) ON DELETE CASCADE,
  text               TEXT NOT NULL,
  language           TEXT NOT NULL CHECK (language IN ('ko','en')),
  category           TEXT CHECK (category IN
                     ('best_in_category','alternative','comparison','recommendation',
                      'problem_solving','buying_guide','custom')),
  is_auto_generated  BOOLEAN DEFAULT FALSE,
  created_at         TIMESTAMPTZ DEFAULT NOW()
);
CREATE INDEX idx_prompt_brand ON prompts(brand_id);

-- ── 5. engines (전역 시드 7개, 격리 불필요·읽기전용) ──
CREATE TABLE engines (
  id        TEXT PRIMARY KEY,   -- chatgpt·claude·perplexity·gemini·hyperclova·naver·daum
  name      TEXT NOT NULL,
  provider  TEXT NOT NULL CHECK (provider IN ('openai','anthropic','perplexity','google','naver','kakao')),
  language  TEXT NOT NULL CHECK (language IN ('ko','en','both')),
  is_active BOOLEAN DEFAULT TRUE,
  ordering  INT DEFAULT 0
);
-- seed 예시(한국어 3 + 글로벌 4):
-- INSERT INTO engines VALUES
--  ('chatgpt','ChatGPT','openai','both',true,1),
--  ('perplexity','Perplexity','perplexity','both',true,2),
--  ('gemini','Gemini','google','both',true,3),
--  ('claude','Claude','anthropic','both',true,4),
--  ('hyperclova','HyperCLOVA X','naver','ko',true,5),
--  ('naver','Naver','naver','ko',true,6),
--  ('daum','Daum','kakao','ko',true,7);

-- ── 6. trackings (SoV 원자 레코드 = Brand × Prompt × Engine) ──
--     ⚠️ 직접 organization_id 없음 → 격리는 brand 조인 경유(rls §위험1)
CREATE TABLE trackings (
  id               UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  brand_id         UUID NOT NULL REFERENCES brands(id) ON DELETE CASCADE,
  prompt_id        UUID NOT NULL REFERENCES prompts(id) ON DELETE CASCADE,
  engine_id        TEXT NOT NULL REFERENCES engines(id),
  raw_response     TEXT,
  brand_mentioned  BOOLEAN DEFAULT FALSE,
  mention_position INT,
  sentiment        TEXT CHECK (sentiment IN ('positive','neutral','negative')),
  cited_sources    JSONB DEFAULT '[]',          -- [{url, domain, title?}]
  share_of_voice   REAL,                        -- 0.0 ~ 1.0 (핵심 지표)
  error_message    TEXT,
  tracked_at       TIMESTAMPTZ DEFAULT NOW()
);
CREATE INDEX idx_track_brand ON trackings(brand_id);
CREATE INDEX idx_track_prompt ON trackings(prompt_id);
CREATE INDEX idx_track_engine ON trackings(engine_id);
CREATE INDEX idx_track_brand_time ON trackings(brand_id, tracked_at);

-- ── 7. reports (audit·weekly·monthly·custom, brand_id·org_id 둘다 nullable) ──
CREATE TABLE reports (
  id               UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  brand_id         UUID REFERENCES brands(id) ON DELETE CASCADE,
  organization_id  UUID REFERENCES organizations(id) ON DELETE CASCADE,
  type             TEXT NOT NULL CHECK (type IN ('free_audit','weekly','monthly','custom')),
  pdf_url          TEXT,
  data             JSONB,                       -- SoV·시계열·경쟁사 비교
  generated_at     TIMESTAMPTZ DEFAULT NOW()
);
CREATE INDEX idx_report_brand ON reports(brand_id);
CREATE INDEX idx_report_org ON reports(organization_id);

-- ── 8. audit_jobs (비로그인 PLG 진입점 · org 밖) ──
CREATE TABLE audit_jobs (
  id                 UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  email              TEXT NOT NULL,
  domain             TEXT NOT NULL,
  industry           TEXT,
  language           TEXT DEFAULT 'both',
  status             TEXT NOT NULL DEFAULT 'queued'
                     CHECK (status IN ('queued','processing','completed','failed')),
  pdf_url            TEXT,
  result             JSONB,                     -- 휴리스틱 빠른 SoV
  crew_status        TEXT DEFAULT 'not_requested'
                     CHECK (crew_status IN ('not_requested','queued','processing','completed','failed')),
  crew_result        JSONB,                     -- 4에이전트 강화분석
  crew_started_at    TIMESTAMPTZ,
  crew_completed_at  TIMESTAMPTZ,
  error_message      TEXT,
  ip_address         TEXT,                      -- ⚠️ rate limit(어뷰즈 방지) 유일 방어선
  created_at         TIMESTAMPTZ DEFAULT NOW(),
  completed_at       TIMESTAMPTZ
);
CREATE INDEX idx_audit_email ON audit_jobs(email);
CREATE INDEX idx_audit_status ON audit_jobs(status);
CREATE INDEX idx_audit_created ON audit_jobs(created_at);

-- ── 9. leads (CRM 진입 · org 밖 · 앱 사용자 노출 안 함) ──
CREATE TABLE leads (
  id         UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  email      TEXT NOT NULL,
  domain     TEXT,
  source     TEXT NOT NULL CHECK (source IN
             ('free_audit','contact_form','newsletter','referral','other')),
  metadata   JSONB,
  created_at TIMESTAMPTZ DEFAULT NOW()
);
CREATE INDEX idx_lead_email ON leads(email);

-- ============================================================
-- 대안 검토(백로그 BL-009): competitors JSON → 정규 테이블
--   경쟁사 SoV를 브랜드처럼 시계열 추적하려면 아래 필요(Should 승격 시).
-- CREATE TABLE competitors (
--   id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
--   brand_id UUID NOT NULL REFERENCES brands(id) ON DELETE CASCADE,
--   name TEXT NOT NULL, domain TEXT,
--   created_at TIMESTAMPTZ DEFAULT NOW()
-- );  -- 그러면 trackings에 competitor_id 추가 검토
-- ============================================================
