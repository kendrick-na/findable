import { buildSsrSummary } from "@repo/audit/ssr-summary";
import type { AuditJob } from "@repo/database";

/**
 * 진단 결과 **요약부 서버 렌더** (S5 · 2026-08-11 세션N-19).
 *
 * ## 🔴 왜 만들었나 — 아이러니를 없앤다
 * 우리는 *"AI 답변에 인용되게 해주는 서비스"* 를 파는데, **우리 결과 페이지 자체가
 * AI 크롤러에게는 빈 페이지**였다. 🔬 라이브 실측(2026-08-11, 정적 HTML 29,134 bytes):
 * `SK하이닉스` **0회** · `처방` **0회** · `HyperCLOVA` **0회** · `등장률` **0회**.
 * 원인 = `audit-result.tsx` 가 `"use client"` 로 브라우저에서 `fetch` 해 그린다.
 *
 * 📕 근거: Vercel×MERJ 실측(GPTBot 5.69억 요청) — **GPTBot·ClaudeBot·PerplexityBot 는
 * JS 를 실행하지 않는다.** 즉 공유 링크를 영업에 쓰는데 AI 는 그 내용을 못 읽었다.
 *
 * ## ⚠️ 설계 원칙 — 전면 재작성 금지
 * 기획서 §6-1 처방이 **"요약부만 서버 컴포넌트로"** 다. `audit-result.tsx` 는 3,926줄이고
 * 폴링·상태·인터랙션이 얽혀 있어 서버로 옮기면 회귀 위험이 이득보다 크다.
 * → **이 컴포넌트는 요약부만 별도로 서버에서 렌더**하고, 아래는 기존 클라이언트가 그대로 그린다.
 *   같은 사실을 두 번 그리는 셈이지만 **읽는 대상이 다르다**(크롤러 ↔ 사람).
 *
 * ## 🔒 개인정보 — 이메일·이름을 **절대** 렌더하지 않는다
 * 이 페이지는 `?shared=1` 링크로 공유되고, 그 뷰는 신청자 이메일을 숨기는 것이 이미
 * 검증된 규칙이다. 그런데 **서버 렌더는 쿼리스트링과 무관하게 항상 나간다**
 * (기존 판정은 `window.location.search` 를 읽는 클라이언트 코드다 — 서버에선 못 쓴다).
 * → 그래서 이 컴포넌트는 **애초에 이메일을 인자로 받지 않는다**(구조적으로 유출 불가).
 *
 * ## 🔴 숫자를 새로 계산하지 않는다
 * 화면에 이미 있는 값만 **그대로** 옮긴다. 여기서 새 산식을 만들면 클라이언트 화면과
 * 숫자가 갈리고, 그건 이 프로젝트가 S0 에서 고친 "숫자가 서로를 반박하는" 결함의 재발이다.
 * ⚠️ 필드명은 **라이브 API 응답으로 실측**했다(추정 아님):
 *   `result.brandName` · `result.metrics.sov` · `result.metrics.enginesCovered`(중복 포함
 *   응답 목록 — 엔진 수는 `new Set()` 으로 고유화) · `result.metrics.enginesWithMention` ·
 *   `result.geoActions[].title`. `geoScore`·`recognitionRate` 는 **이 회차에 없다**(null).
 */

interface Props {
  job: Pick<AuditJob, "domain" | "result" | "status">;
  locale: string;
}

export const AuditSummarySsr = ({ job, locale }: Props) => {
  // 🔒 판정·계산은 전부 `@repo/audit/ssr-summary` 가 한다(테스트로 고정된 단일 진실).
  //   이 컴포넌트는 **그린다**. 여기서 숫자를 만지면 테스트 밖으로 새어나간다.
  const summary = buildSsrSummary({
    domain: job.domain,
    result: job.result,
    status: job.status,
  });
  if (!summary) {
    return null;
  }

  const isKo = locale.startsWith("ko");
  const {
    actionTitles: actions,
    brand,
    engineMentioned,
    engineTotal,
    sov,
  } = summary;

  return (
    <details
      aria-label={isKo ? "진단 결과 요약" : "Audit result summary"}
      // 🔴 `sr-only`(숨김)를 쓰지 않는다. 구글 공식: *"Don't mark up content that is
      //   not visible to readers"* — 크롤러에게만 보이는 텍스트는 정책 위반 위험이다.
      //
      // 🐛 그런데 스크린샷 눈확인에서 **새 문제**를 봤다: 요약이 아래 상세와 내용이
      //   그대로 겹쳐 **사람은 같은 걸 두 번 읽는다**. S3'에서 "첫 화면 정리"를 한
      //   직후에 내가 첫 화면에 중복 블록을 얹은 셈이었다.
      // → 답 = **`<details>` 로 접는다**(같은 저장소가 진실거울·처방에서 이미 쓴 방식):
      //   · 크롤러는 접힌 내용도 **HTML 에 있으므로 읽는다**(숨김 처리가 아니다)
      //   · `Ctrl+F`·스크린리더도 접힌 내용을 찾는다
      //   · 사람은 중복을 강제로 읽지 않고, 원하면 한 번 눌러 본다
      //   ⚠️ 기본을 열린 상태(`open`)로 두면 중복 문제가 그대로 남는다 → 닫아 둔다.
      className="mb-6 rounded-xl border border-zinc-800 bg-zinc-900/40 p-4"
    >
      {/* ⚠️ `h1` 이 아니라 `h2` 다 — 클라이언트 뷰(`audit-result.tsx:1405`)에 이미
          `h1` 이 있어서 여기에 또 쓰면 **한 페이지에 h1 두 개**가 된다(SEO·a11y 결함).
          🔬 실측으로 확인하고 내렸다(추정 아님). */}
      <summary className="cursor-pointer text-sm text-zinc-400 hover:text-zinc-200">
        {isKo ? "이 진단 결과 요약 보기" : "View audit summary"}
      </summary>
      <h2 className="mt-3 font-semibold text-lg text-zinc-100">
        {isKo
          ? `${brand} — AI 답변 가시성 진단 결과`
          : `${brand} — AI visibility audit result`}
      </h2>
      <p className="mt-2 text-sm text-zinc-300">
        {isKo
          ? `${brand}(${job.domain})을 ChatGPT·Claude·Perplexity·Gemini·HyperCLOVA X·네이버·다음 등 AI ${engineTotal}곳에서 측정했어요.`
          : `We measured ${brand} (${job.domain}) across ${engineTotal} AI engines including ChatGPT, Claude, Perplexity, Gemini, HyperCLOVA X, Naver and Daum.`}
      </p>
      <ul className="mt-3 flex flex-wrap gap-x-6 gap-y-1 text-sm text-zinc-400">
        {sov !== null && (
          <li>
            {isKo ? "등장률" : "Share of voice"}{" "}
            <span className="font-semibold text-zinc-100 tabular-nums">
              {sov}%
            </span>
          </li>
        )}
        <li>
          {isKo ? "우리를 아는 AI" : "Engines that know us"}{" "}
          <span className="font-semibold text-zinc-100 tabular-nums">
            {engineMentioned}/{engineTotal}
          </span>
        </li>
      </ul>
      {actions.length > 0 && (
        <div className="mt-4">
          <h3 className="font-medium text-sm text-zinc-200">
            {isKo
              ? `지금 할 일 ${actions.length}가지`
              : `${actions.length} recommended actions`}
          </h3>
          <ol className="mt-2 flex flex-col gap-1 text-sm text-zinc-400">
            {actions.map((title) => (
              <li key={title}>{title}</li>
            ))}
          </ol>
        </div>
      )}
    </details>
  );
};
