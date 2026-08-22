import { env } from "@/env";
import { listAllPublishedContentForDiscovery } from "@/lib/content";

/**
 * `/llms.txt` — AI 엔진에게 이 사이트를 설명하는 표준 파일(llmstxt.org).
 *
 * 🔴🔴 **왜 만들었나**(2026-08-17 세션N-39): 이 주소가 **HTTP 500** 이었다.
 *   라우트가 아예 없어서 `[locale]` 캐치올이 `"llms.txt"` 를 **로케일 코드로** 읽고
 *   렌더에 실패했다(없는 경로 `/nonexistent` 는 307 인데 여기만 500 → 캐치올 버그가 아니다).
 *   🔴 **GEO(AI 답변 최적화)를 파는 회사가 정작 AI 엔진용 표준 파일에서 에러를 띄우고 있었다.**
 *   경쟁사·심사관이 30초면 확인하는 자리다.
 *
 * 📐 형식(llmstxt.org 공식 확인 2026-08-17):
 *   ① H1(사이트명) — **유일한 필수 항목** ② 요약 blockquote
 *   ③ 자유 서술(제목 없이) ④ H2 섹션 + `[이름](URL): 설명` 목록
 *   ⚠️ 「Optional」 섹션은 컨텍스트가 부족한 에이전트가 **건너뛰어도 되는** 것만 넣는다.
 *
 * ⚠️ **여기에 미출시 기능을 쓰지 말 것.** 이 파일은 AI 가 그대로 인용한다 —
 *   랜딩에서 「준비 중」으로 고친 발행 기능(Cafe24·네이버·WordPress)을
 *   여기에 현재형으로 적으면 **AI 답변을 통해 날조가 퍼진다.**
 *   📕 [[feedback_no_fabricated_facts]]
 *
 * ⚠️ 한국어로 쓴다 — 대상 독자(한국 브랜드 담당자)와 실제 콘텐츠 언어가 한국어다.
 *
 * 🔴 **2026-08-19(N-47) 두 줄을 뺐다 — 다시 넣지 말 것.**
 *   ① `[무료 진단](/ko/audit)` — 👤 결정 A(2026-08-19)로 **동선에서 접은 기능**이다.
 *      페이지는 남기지만(배포된 결과 링크 보호) **광고하지 않는다.** 랜딩 CTA 3곳은
 *      N-44 에 고쳤는데 이 파일과 블로그가 남아 **AI 에게는 계속 현재형으로 알리고** 있었다.
 *   ② `[블로그](/ko/blog)` — `.mdx` 가 **0건**이다. 「곧 만나요」 한 장뿐인 페이지를
 *      AI 에게 리소스로 소개하면 **없는 콘텐츠를 있다고 말하는 것**이 된다.
 *      ⭐ 글이 1건이라도 발행되면 **그때 되살린다**(그게 이 줄의 해제 조건이다).
 *   📕 위 *"미출시 기능을 쓰지 말 것"* 규칙의 실제 위반 사례였다 — 규칙은 있었는데
 *      **지키는지 보는 가드가 없었다**(N-47 에 `llms-txt-honesty.test.ts` 신설).
 */

const protocol = process.env.NODE_ENV === "production" ? "https" : "http";
const origin = `${protocol}://${env.VERCEL_PROJECT_PRODUCTION_URL ?? "www.findable.co.kr"}`;

// 실제로 200 을 주는 페이지만 싣는다(현재 EN 은 전량 `/ko` 로 리다이렉트된다).
const baseBody = `# Findable

> 한국어 브랜드가 ChatGPT·Perplexity·Gemini·네이버 등 AI 답변에 얼마나, 어떻게 인용되는지 측정하고 개선하는 GEO(생성형엔진최적화) 도구입니다. 도메인만 입력하면 7개 AI 엔진을 병렬 호출해 3분 안에 결과를 제공합니다.

Findable은 검색 순위(SEO)가 아니라 **AI 답변에서의 인용/등장(GEO·AEO)** 을 다룹니다.
한국어 기업 정보는 대형 언어모델 학습 비중이 매우 낮아, 글로벌 GEO 도구가 놓치는
한국어 표기 변형(영문 약칭·영문 정식명·한글명)을 자동으로 묶어 추적하는 것이 차별점입니다.

측정 대상 엔진은 글로벌 4곳(ChatGPT·Claude·Perplexity·Gemini)과
한국 3곳(HyperCLOVA·네이버·다음)입니다. 점유율은 Princeton GEO-Bench 산식을 따릅니다.

운영: 인디고차일드(대표 나현덕) · 사업자등록번호 534-15-01132

## 주요 페이지

- [홈](${origin}/ko): 제품 개요와 4단계(측정·분석·추천·발행) 설명
- [요금제](${origin}/ko/pricing): Free Audit · Starter · Growth · Scale · Enterprise
- [문의](${origin}/ko/contact)

## 공개 데이터·리서치

- [K-GEO Bench v0.1](${origin}/ko/research/k-geo-bench-v0_1): 한국어 GEO 벤치마크 공개 데이터셋(CC BY 4.0)
- [K-뷰티 GEO 리포트 2026 Q2](${origin}/ko/report/k-beauty-geo-2026q2): 실측 기반 산업 리포트
- [사례](${origin}/ko/case/a-brand)

## Optional

- [개인정보처리방침](${origin}/ko/legal/privacy)
- [이용약관](${origin}/ko/legal/terms)
`;

const safeLabel = (value: string) => value.replace(/[[\]\r\n]/g, " ").trim();

export async function GET(): Promise<Response> {
  let published = "";
  try {
    const posts = (await listAllPublishedContentForDiscovery()).filter(
      (post) => post.locale === "ko"
    );
    if (posts.length > 0) {
      published = `\n## 발행 인사이트\n\n- [전체 인사이트](${origin}/ko/insights): Findable과 고객사 퍼블리셔의 검증 콘텐츠\n${posts
        .slice(0, 50)
        .map(
          (post) =>
            `- [${safeLabel(post.title)}](${origin}/ko/p/${post.publisher.slug}/${post.slug}): ${safeLabel(post.publisher.name)} 발행${post.excerpt ? ` — ${safeLabel(post.excerpt).slice(0, 140)}` : ""}`
        )
        .join("\n")}\n`;
    }
  } catch {
    // 공개 콘텐츠 조회 실패가 사이트 설명 전체의 500으로 번지지 않게 정적 본문으로 폴백.
  }
  const body = `${baseBody}${published}`;
  return new Response(body, {
    headers: {
      "Content-Type": "text/plain; charset=utf-8",
      // 자주 바뀌지 않는 정적 문서 — CDN 에 하루 캐시, 갱신은 백그라운드로.
      "Cache-Control":
        "public, max-age=0, s-maxage=86400, stale-while-revalidate=604800",
    },
  });
}
