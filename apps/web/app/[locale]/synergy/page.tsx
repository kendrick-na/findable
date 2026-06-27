// Findable × Naver Synergy Page (D-049, 2026-05-07)
//
// 목적:
//   D2SF 신청 시 인용할 단일 시너지 페이지.
//   합격팀 5개 패턴 (A 비닷두 / B 무빈 / C 포자랩스 / D Hello Max / E 클로바 스튜디오) 모두 매핑.
//   네이버 4대 니즈 (① 점유율 방어 / ② 광고주 lock-in / ③ B2B 확장 / ④ 글로벌 진출) 모두 커버.
//
// 시너지 보강 방안 8개 통합:
//   E (AI 브리핑 측정) · A (Naver vs AI Gap) — 메인 메시지, 라이브 코드 구현됨
//   J (K-GEO-Bench 공동 발표) · I (Acqui-hire SDK) — 합격팀 패턴 미러
//   D (클로바 스튜디오 마켓플레이스) · B (GEO 데이터셋 export) — B2B 확장
//   F (글로벌 SaaS 진출) · H (CES 2027 출전) — D2SF KPI 정렬
//
// 디자인 톤: hero.tsx + live-counter.tsx + case/a-brand 동일 (--findable-* 변수)

import { ArrowRight, CheckCircle2, ExternalLink } from "lucide-react";
import type { Metadata } from "next";
import Link from "next/link";

export const metadata: Metadata = {
  title: "Findable × NAVER Synergy — 8 Pillar Roadmap",
  description:
    "Findable이 네이버 4대 니즈와 D2SF 합격팀 5개 패턴에 어떻게 매칭되는지 — 8개 시너지 시나리오.",
};

interface Synergy {
  id: string;
  tier: "live" | "incubation" | "future";
  status: string;
  pattern: string;
  needs: string;
  title: string;
  body: string;
  evidence?: string;
  evidenceHref?: string;
}

const SYNERGIES: Synergy[] = [
  {
    id: "E",
    tier: "live",
    status: "라이브 (D-047)",
    pattern: "D 패턴 — Hello Max 미러",
    needs: "네이버 ① 검색 점유율 방어",
    title: "AI 브리핑 측정 모듈",
    body: "네이버 AI 브리핑은 2025.12 검색의 20%를 차지하고 2026 내 40%까지 확대됩니다. 광고주가 AI 브리핑에서 어떻게 인용되는지 추적할 수 있는 도구는 한국에 0건입니다. Findable은 8번째 엔진으로 Naver AI 브리핑을 직접 통합한 첫 번째 도구입니다.",
    evidence: "베타 라이브 — 8 엔진 측정 동작",
    evidenceHref: "/ko/audit",
  },
  {
    id: "A",
    tier: "live",
    status: "라이브 (D-048)",
    pattern: "D 패턴 — Hello Max 미러",
    needs: "네이버 ② 광고주 lock-in",
    title: "Naver vs Global AI 가시성 갭 리포트",
    body: '"네이버 검색 1위인데 ChatGPT에서는 안 보임" — 광고주가 두 채널 격차를 한눈에 보고 액션을 받는 카드. Hello Max(네이버 검색 광고 AI 에이전트)와 같은 카테고리에서 AI 시대 가시성에 특화한 도구입니다.',
    evidence: "메디큐브 jobId 측정 결과 — 라이브 검증",
    evidenceHref: "/ko/audit/57fbfad0-2ba1-47b8-b2d9-fa6e5f4e36b7",
  },
  {
    id: "J",
    tier: "incubation",
    status: "인큐베이팅 6개월",
    pattern: "B 패턴 — 무빈 1784 데이터셋 미러",
    needs: "네이버 ③ R&D 협업",
    title: "K-GEO-Bench 공동 발표",
    body: "Princeton GEO-Bench (KDD'24, 영문 10K)의 한국어 버전 K-GEO-Bench를 인큐베이팅 6개월 동안 네이버와 공동 발표합니다. 메디큐브 베타 6개월 운영 데이터 + Findable 8 엔진 측정 결과 = 한국어 LLM 학습 풀이 영문 대비 50배 좁은 환경에서 클로바X 학습용 희소 데이터 자산입니다. 무빈이 1784 인프라로 모션 데이터셋 구축한 패턴을 GEO에 적용합니다.",
  },
  {
    id: "I",
    tier: "future",
    status: "Long-term Acqui-hire",
    pattern: "A 패턴 — 비닷두 네이버웹툰 인수 미러",
    needs: "네이버 ② 광고센터 흡수",
    title: "광고센터 임베드 SDK",
    body: "Findable의 측정·분석 엔진은 네이버 검색 광고센터·GFA·쇼핑 사업부가 광고주 분석 도구로 직접 흡수 가능한 SDK 형태로 설계되었습니다. v1.5 (2026.Q4)부터 SDK 모듈 분리, 인수 시 광고주 풀 6,500사+@에 즉시 통합 가능합니다.",
  },
  {
    id: "D",
    tier: "incubation",
    status: "v1.5 (2026.Q4)",
    pattern: "E 패턴 — 클로바 스튜디오 2,000사 미러",
    needs: "네이버 ③ B2B 확장",
    title: "클로바 스튜디오 마켓플레이스 입점",
    body: "v1.5에서 네이버 클라우드 마켓플레이스 + 클로바 스튜디오 입점. Findable이 측정한 GEO 갭 → 클로바 스튜디오로 콘텐츠 자동 생성 → 클라이언트 사이트 발행 워크플로. 클로바 스튜디오 2,000개 기업 풀에서 GEO 측정 인프라로 포지션.",
  },
  {
    id: "B",
    tier: "incubation",
    status: "인큐베이팅 3개월",
    pattern: "B 패턴 — 무빈 데이터셋 보강",
    needs: "네이버 ③ R&D",
    title: "한국어 GEO 데이터셋 Open Export",
    body: "메디큐브 jobId 결과를 JSON-L 형식으로 다운로드 가능. 'Open Dataset for Korean GEO Research' 라이선스 명시. AI Hub·모두의 말뭉치 같은 공공 한국어 NLP 자산 생태계에 GEO 카테고리 기여.",
  },
  {
    id: "F",
    tier: "future",
    status: "v2.0 (2027.Q2)",
    pattern: "양상환 KPI — 포트폴리오 80% 글로벌",
    needs: "네이버 ④ 글로벌 진출",
    title: "글로벌 SaaS 진출 (US·일본·동남아)",
    body: "v2.0 영문 도메인 리브랜딩. K-뷰티 글로벌 D2C ICP 300사 → 일본 SMB 700만 → 동남아 SMB 7,000만 시장 순차 확장. D2SF 미국 실리콘밸리 거점 (2024.10 설립) 활용 시나리오.",
  },
  {
    id: "H",
    tier: "future",
    status: "CES 2027",
    pattern: "D2SF 운영 KPI",
    needs: "네이버 ④ 글로벌 가시성",
    title: "CES 2027 한국관 출전",
    body: "v1.5 (2026.Q4) 시점에 CES 2027 출전 목표. D2SF의 CES 2026 8팀 + 혁신상 4팀 트랙레코드에 합류. 한국 GEO 카테고리 첫 글로벌 데뷔.",
  },
];

const PATTERN_COVERAGE = [
  { pattern: "A — 비닷두 (자회사 인수)", covered: "I" },
  { pattern: "B — 무빈 (R&D 인프라·데이터셋)", covered: "J + B" },
  { pattern: "C — 포자랩스 (콘텐츠 공급)", covered: "광고주 교육 콘텐츠 (인큐베이팅)" },
  { pattern: "D — Hello Max (광고주 가치)", covered: "E + A" },
  { pattern: "E — 클로바 스튜디오 (B2B SaaS)", covered: "D" },
];

const NAVER_NEEDS = [
  { id: "①", title: "AI 검색 점유율 방어", note: "AI 브리핑 20% → 40% 확대", covered: "E" },
  { id: "②", title: "광고주 lock-in", note: "Hello Max 출시 (지브라브라더스)", covered: "A + I" },
  { id: "③", title: "하이퍼클로바X B2B 확장", note: "클로바 스튜디오 2,000사", covered: "J + D + B" },
  { id: "④", title: "글로벌 SaaS 진출", note: "포트폴리오 80% 글로벌", covered: "F + H" },
];

function tierBadge(tier: Synergy["tier"]) {
  if (tier === "live") {
    return (
      <span className="inline-flex items-center gap-1 rounded-full bg-emerald-500/10 px-2.5 py-0.5 font-medium text-[10px] text-emerald-400 uppercase tracking-[0.12em]">
        <CheckCircle2 className="h-3 w-3" />
        Live
      </span>
    );
  }
  if (tier === "incubation") {
    return (
      <span className="inline-flex items-center gap-1 rounded-full bg-amber-500/10 px-2.5 py-0.5 font-medium text-[10px] text-amber-400 uppercase tracking-[0.12em]">
        Incubation
      </span>
    );
  }
  return (
    <span className="inline-flex items-center gap-1 rounded-full bg-zinc-500/10 px-2.5 py-0.5 font-medium text-[10px] text-zinc-400 uppercase tracking-[0.12em]">
      Future
    </span>
  );
}

export default function SynergyPage() {
  return (
    <div className="min-h-screen bg-[var(--findable-canvas)] text-[var(--findable-ink)]">
      {/* Hero */}
      <section className="relative w-full overflow-hidden border-[var(--findable-hairline)] border-b">
        <div className="mx-auto max-w-5xl px-6 pt-24 pb-16 md:pt-32 md:pb-20">
          <div className="mb-6 flex items-center gap-3">
            <span
              className="inline-flex items-center gap-2 rounded-full border border-[var(--findable-hairline)] bg-[var(--findable-surface-1)] px-3 py-1 text-[11px] uppercase tracking-[0.18em] text-[var(--findable-ink-tertiary)]"
              style={{ fontFamily: "var(--findable-font-sans)" }}
            >
              D2SF Synergy Roadmap
            </span>
            <span
              className="text-[12px] text-[var(--findable-ink-muted)]"
              style={{ fontFamily: "var(--findable-font-sans)" }}
            >
              Findable × NAVER · 8 Pillars
            </span>
          </div>
          <h1
            className="mb-6 font-medium text-[40px] leading-[1.1] tracking-tight md:text-[56px]"
            style={{ fontFamily: "var(--findable-font-display)" }}
          >
            Findable이 네이버와
            <br />
            <span className="text-[var(--findable-primary)]">
              어떻게 같이 클 것인가
            </span>
          </h1>
          <p
            className="max-w-2xl text-[18px] text-[var(--findable-ink-muted)] leading-[1.6]"
            style={{ fontFamily: "var(--findable-font-sans)" }}
          >
            합격팀 5개 패턴 (비닷두·무빈·포자랩스·Hello Max·클로바 스튜디오) +
            네이버 본사 4대 니즈 (점유율·광고·B2B·글로벌)에 매핑된 8개 시너지
            시나리오. 2개는 라이브, 3개는 인큐베이팅 6개월, 3개는 v1.5+ 로드맵.
          </p>
        </div>
      </section>

      {/* 합격팀 5 패턴 커버리지 */}
      <section className="border-[var(--findable-hairline)] border-b">
        <div className="mx-auto max-w-5xl px-6 py-12">
          <span
            className="mb-2 inline-block text-[11px] uppercase tracking-[0.18em] text-[var(--findable-ink-tertiary)]"
            style={{ fontFamily: "var(--findable-font-sans)" }}
          >
            1.0 · D2SF 합격팀 5 패턴 커버리지
          </span>
          <h2
            className="mb-8 font-medium text-[24px] leading-tight tracking-tight md:text-[32px]"
            style={{ fontFamily: "var(--findable-font-display)" }}
          >
            8개 직접 투자 사례, 5개 시너지 패턴.
            <br />
            Findable은 5개 모두 매칭됩니다.
          </h2>
          <div className="grid gap-3">
            {PATTERN_COVERAGE.map((p) => (
              <div
                key={p.pattern}
                className="flex items-center justify-between gap-4 rounded-lg border border-[var(--findable-hairline)] bg-[var(--findable-surface-1)] px-5 py-4"
              >
                <span
                  className="font-medium text-[14px]"
                  style={{ fontFamily: "var(--findable-font-sans)" }}
                >
                  {p.pattern}
                </span>
                <span
                  className="rounded-full bg-[var(--findable-primary)]/10 px-3 py-1 font-mono text-[12px] text-[var(--findable-primary)]"
                >
                  Findable {p.covered}
                </span>
              </div>
            ))}
          </div>
        </div>
      </section>

      {/* 네이버 4대 니즈 매핑 */}
      <section className="border-[var(--findable-hairline)] border-b">
        <div className="mx-auto max-w-5xl px-6 py-12">
          <span
            className="mb-2 inline-block text-[11px] uppercase tracking-[0.18em] text-[var(--findable-ink-tertiary)]"
            style={{ fontFamily: "var(--findable-font-sans)" }}
          >
            2.0 · NAVER 4 Strategic Needs (2026)
          </span>
          <h2
            className="mb-8 font-medium text-[24px] leading-tight tracking-tight md:text-[32px]"
            style={{ fontFamily: "var(--findable-font-display)" }}
          >
            네이버 4대 니즈 모두 커버.
          </h2>
          <div className="grid gap-3 md:grid-cols-2">
            {NAVER_NEEDS.map((n) => (
              <article
                key={n.id}
                className="rounded-lg border border-[var(--findable-hairline)] bg-[var(--findable-surface-1)] p-5"
              >
                <div className="mb-3 flex items-center gap-2">
                  <span
                    className="font-mono text-[16px] text-[var(--findable-primary)]"
                    style={{ fontFamily: "var(--findable-font-display)" }}
                  >
                    {n.id}
                  </span>
                  <span
                    className="font-medium text-[15px]"
                    style={{ fontFamily: "var(--findable-font-sans)" }}
                  >
                    {n.title}
                  </span>
                </div>
                <p
                  className="mb-3 text-[13px] text-[var(--findable-ink-muted)] leading-relaxed"
                  style={{ fontFamily: "var(--findable-font-sans)" }}
                >
                  {n.note}
                </p>
                <span
                  className="inline-block rounded-full bg-emerald-500/10 px-2.5 py-0.5 font-mono text-[11px] text-emerald-600"
                >
                  → Findable {n.covered}
                </span>
              </article>
            ))}
          </div>
        </div>
      </section>

      {/* 8 시너지 시나리오 */}
      <section className="border-[var(--findable-hairline)] border-b">
        <div className="mx-auto max-w-5xl px-6 py-12">
          <span
            className="mb-2 inline-block text-[11px] uppercase tracking-[0.18em] text-[var(--findable-ink-tertiary)]"
            style={{ fontFamily: "var(--findable-font-sans)" }}
          >
            3.0 · 8 Synergy Pillars
          </span>
          <h2
            className="mb-8 font-medium text-[24px] leading-tight tracking-tight md:text-[32px]"
            style={{ fontFamily: "var(--findable-font-display)" }}
          >
            라이브 2개 · 인큐베이팅 3개 · 미래 3개.
          </h2>
          <div className="space-y-4">
            {SYNERGIES.map((s) => (
              <article
                key={s.id}
                className="rounded-lg border border-[var(--findable-hairline)] bg-[var(--findable-surface-1)] p-6"
              >
                <div className="mb-3 flex flex-wrap items-center gap-2">
                  <span
                    className="rounded-full bg-[var(--findable-primary)]/10 px-2.5 py-0.5 font-mono text-[11px] text-[var(--findable-primary)] uppercase tracking-[0.12em]"
                  >
                    Pillar {s.id}
                  </span>
                  {tierBadge(s.tier)}
                  <span
                    className="text-[11px] text-[var(--findable-ink-tertiary)]"
                    style={{ fontFamily: "var(--findable-font-mono)" }}
                  >
                    {s.status}
                  </span>
                </div>
                <h3
                  className="mb-2 font-medium text-[20px] leading-snug tracking-tight md:text-[22px]"
                  style={{ fontFamily: "var(--findable-font-sans)" }}
                >
                  {s.title}
                </h3>
                <div
                  className="mb-3 flex flex-wrap gap-3 text-[12px] text-[var(--findable-ink-tertiary)]"
                  style={{ fontFamily: "var(--findable-font-mono)" }}
                >
                  <span>{s.pattern}</span>
                  <span>·</span>
                  <span>{s.needs}</span>
                </div>
                <p
                  className="text-[14px] text-[var(--findable-ink-muted)] leading-relaxed"
                  style={{ fontFamily: "var(--findable-font-sans)" }}
                >
                  {s.body}
                </p>
                {s.evidence && s.evidenceHref && (
                  <Link
                    href={s.evidenceHref}
                    className="mt-4 inline-flex items-center gap-1.5 rounded-md border border-[var(--findable-hairline)] bg-[var(--findable-canvas)] px-3 py-1.5 font-medium text-[12px] text-[var(--findable-primary)] transition hover:border-[var(--findable-primary)]/40"
                    style={{ fontFamily: "var(--findable-font-sans)" }}
                  >
                    {s.evidence}
                    <ExternalLink className="h-3 w-3" />
                  </Link>
                )}
              </article>
            ))}
          </div>
        </div>
      </section>

      {/* CTA */}
      <section>
        <div className="mx-auto max-w-5xl px-6 py-20">
          <div className="flex flex-col items-center gap-6 text-center">
            <h2
              className="max-w-2xl font-medium text-[28px] leading-tight tracking-tight md:text-[40px]"
              style={{ fontFamily: "var(--findable-font-display)" }}
            >
              네이버 D2SF에 Findable이 합류한다면.
            </h2>
            <p
              className="max-w-xl text-[15px] text-[var(--findable-ink-muted)] leading-relaxed"
              style={{ fontFamily: "var(--findable-font-sans)" }}
            >
              한국 광고주의 AI 시대 가시성 인프라 구축. 네이버 검색 매출 방어와
              하이퍼클로바X B2B 확장에 직접 기여.
            </p>
            <Link
              href="/ko/audit"
              className="inline-flex items-center gap-1.5 rounded-md bg-[var(--findable-primary)] px-5 py-2.5 font-medium text-[14px] text-white transition hover:bg-[var(--findable-primary-hover)]"
              style={{ fontFamily: "var(--findable-font-sans)" }}
            >
              라이브 Audit 검증
              <ArrowRight className="h-3.5 w-3.5" />
            </Link>
          </div>
        </div>
      </section>
    </div>
  );
}
