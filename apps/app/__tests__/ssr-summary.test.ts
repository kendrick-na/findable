import { buildSsrSummary } from "@repo/audit/ssr-summary";
import { describe, expect, test } from "vitest";

/**
 * 진단결과 SSR 요약 회귀 테스트 (S5 · 2026-08-11 세션N-19).
 *
 * 🔴 **이 테스트가 지키는 것 3가지** (전부 사고로 이어질 수 있는 규칙):
 *  1. **잰 것만 말한다** — 측정 엔진 0개면 요약을 만들지 않는다. 0을 점수처럼 내보내면
 *     "못 잼"을 "0점"이라 부르는 기존 결함(`measurement-coverage` 가 막은 것)의 재발.
 *  2. **엔진 수는 고유화** — `enginesCovered` 는 **응답 목록**이라 같은 엔진이 여러 번
 *     들어 있다(실측 29개 응답 = 고유 8엔진). 길이를 그대로 쓰면 "AI 29곳" 이라는 거짓말.
 *  3. **없는 값을 0으로 만들지 않는다** — `sov` 가 없으면 `null` 그대로.
 *
 * ⚠️ 여기 쓰는 표본은 **라이브 API 실측 응답**(SK하이닉스 회차)의 구조를 따른다.
 *   `apps/web` 에는 테스트 러너가 없어 순수 함수만 `@repo/audit` 로 빼서 여기서 검증한다.
 */

/** 실측 구조 축약본 — 엔진 7종이 4회 반복(=28) + naver-briefing 1 = 응답 29개, 고유 8. */
const ENGINES = [
  "chatgpt",
  "claude",
  "perplexity",
  "gemini",
  "hyperclova",
  "naver",
  "daum",
];
const COVERED = [
  ...ENGINES,
  ...ENGINES,
  ...ENGINES,
  ...ENGINES,
  "naver-briefing",
];

const completedJob = {
  domain: "www.skhynix.com",
  status: "completed",
  result: {
    brandName: "SK하이닉스",
    metrics: {
      sov: 79,
      enginesCovered: COVERED,
      enginesWithMention: [...ENGINES, ...ENGINES, "naver-briefing"],
    },
    geoActions: [
      {
        kind: "content_fix",
        title: "인용되는 페이지에 '근거 문장'을 추가하세요",
      },
      { kind: "prompt_gap", title: "질문 전용 섹션을 만드세요" },
    ],
  },
};

describe("buildSsrSummary", () => {
  test("완료 회차의 요약을 만든다 — 저장값을 그대로 옮긴다", () => {
    const s = buildSsrSummary(completedJob);
    expect(s).not.toBeNull();
    expect(s?.brand).toBe("SK하이닉스");
    expect(s?.sov).toBe(79);
    expect(s?.actionTitles).toHaveLength(2);
  });

  test("🔴 엔진 수는 고유화한다 — 응답 29개가 'AI 29곳'이 되면 거짓말이다", () => {
    const s = buildSsrSummary(completedJob);
    // 응답 목록 길이는 29지만 고유 엔진은 8개(7종 + naver-briefing).
    expect(COVERED).toHaveLength(29);
    expect(s?.engineTotal).toBe(8);
    expect(s?.engineMentioned).toBe(8);
  });

  test("🔴 측정 엔진 0개면 요약을 만들지 않는다 (잰 것만 말한다)", () => {
    const dead = {
      ...completedJob,
      result: {
        ...completedJob.result,
        metrics: { sov: 0, enginesCovered: [] },
      },
    };
    expect(buildSsrSummary(dead)).toBeNull();
  });

  test("완료 전에는 요약이 없다 (폴링 중 화면은 클라이언트가 그린다)", () => {
    expect(
      buildSsrSummary({ ...completedJob, status: "processing" })
    ).toBeNull();
    expect(buildSsrSummary({ ...completedJob, status: "failed" })).toBeNull();
  });

  test("🔴 sov 가 없으면 null — 0으로 대체하지 않는다", () => {
    const noSov = {
      ...completedJob,
      result: {
        ...completedJob.result,
        metrics: { enginesCovered: COVERED, enginesWithMention: [] },
      },
    };
    const s = buildSsrSummary(noSov);
    expect(s?.sov).toBeNull();
    expect(s?.engineMentioned).toBe(0);
  });

  test("brandName 이 없으면 도메인으로 대체한다", () => {
    const noBrand = {
      ...completedJob,
      result: { ...completedJob.result, brandName: "   " },
    };
    expect(buildSsrSummary(noBrand)?.brand).toBe("www.skhynix.com");
  });

  test("result 가 없거나 형태가 아니면 null", () => {
    expect(buildSsrSummary({ ...completedJob, result: null })).toBeNull();
    expect(buildSsrSummary({ ...completedJob, result: "문자열" })).toBeNull();
  });

  test("처방 제목이 빈 값이면 걸러진다 (빈 줄을 렌더하지 않는다)", () => {
    const messy = {
      ...completedJob,
      result: {
        ...completedJob.result,
        geoActions: [
          { title: "  " },
          { title: null },
          {},
          { title: "실제 처방" },
        ],
      },
    };
    expect(buildSsrSummary(messy)?.actionTitles).toEqual(["실제 처방"]);
  });

  test("🐛 '할 일'이 아닌 항목은 요약에서 뺀다 (avoid·rank_strategy)", () => {
    // 스크린샷 눈확인에서 잡은 결함: "지금 할 일" 제목 아래에
    //   *"이건 하지 마세요"*(kind=avoid) · *"이미 1순위 — 방어가 낫습니다"*(rank_strategy)
    //   가 섞여 있었다. 둘은 **행동 지시가 아니라 판단·경고**다.
    //   ⚠️ 정보를 지운 게 아니다 — 아래 상세 화면에는 그대로 다 보인다.
    const mixed = {
      ...completedJob,
      result: {
        ...completedJob.result,
        geoActions: [
          { kind: "content_fix", title: "할 일 A" },
          { kind: "avoid", title: "이건 하지 마세요 — 역효과입니다" },
          { kind: "rank_strategy", title: "이미 1순위 — 방어가 낫습니다" },
          { kind: "prompt_gap", title: "할 일 B" },
        ],
      },
    };
    expect(buildSsrSummary(mixed)?.actionTitles).toEqual([
      "할 일 A",
      "할 일 B",
    ]);
  });

  test("🔒 반환값에 이메일이 들어갈 자리가 없다 (구조적 유출 차단)", () => {
    const s = buildSsrSummary(completedJob);
    const keys = Object.keys(s ?? {});
    expect(keys).not.toContain("email");
    expect(keys).not.toContain("emailMasked");
    // 값 전체를 문자열로 만들어도 @ 가 없어야 한다(도메인엔 @ 가 없다).
    expect(JSON.stringify(s)).not.toContain("@");
  });
});
