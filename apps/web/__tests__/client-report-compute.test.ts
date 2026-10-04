// 고객 리포트 계산 = 파이썬 build.py 와 **완전히 같은 값**인지 대조한다.
//
// 기준값(`*.python-expected.json`)은 원본 템플릿의 build.py 로 뽑았다:
//   python3 scripts/client-report/dump-python-compute.py ../Findable_GEO리포트_템플릿 knowverse
// 입력(`*.audit.min.json`)은 compute 가 읽는 필드만 남긴 축약본이고, 축약본과 원본의
// 파이썬 결과가 같다는 것을 뽑을 때 확인했다(assert).
//
// ⚠️ 이 테스트가 깨지면 TS 를 고치기 전에 **build.py 가 바뀌었는지** 먼저 본다.

import { readFileSync } from "node:fs";
import { join } from "node:path";
import {
  type ClientReportAudit,
  type ClientReportConfig,
  computeClientReport,
  currentEngineDisplayName,
  currentEngineDisplayText,
  ENGINE_NAMES,
} from "@repo/audit/client-report/compute";
import { pyRound } from "@repo/audit/client-report/py-compat";
import { renderStrings } from "@repo/audit/client-report/render-strings";
import {
  buildClientReportData,
  CLIENT_REPORT_TEMPLATE_VERSION,
  clientReportDisclosure,
  clientReportPdfFilename,
  parseClientReportData,
} from "@repo/audit/client-report/report-data";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import { ClientReport } from "../components/client-report/client-report";
import { ClientReportDisclosureNotice } from "../components/client-report/client-report-disclosure";

const FIXTURES = join(import.meta.dirname, "fixtures/client-report");
const read = <T>(name: string): T =>
  JSON.parse(readFileSync(join(FIXTURES, name), "utf8")) as T;

const currentEngineLabels = <T>(value: T): T =>
  JSON.parse(
    JSON.stringify(value).replaceAll("네이버 AI", "네이버 검색 노출")
  ) as T;

interface PythonExpected {
  compute: Record<string, unknown>;
  config: Record<string, unknown>;
}

describe.each([
  "knowverse",
  "techdd",
])("%s — 파이썬 build.py 와 대조", (slug) => {
  const config = read<ClientReportConfig>(`${slug}.config.json`);
  const audit = read<ClientReportAudit>(`${slug}.audit.min.json`);
  const expected = read<PythonExpected>(`${slug}.python-expected.json`);
  const actual = computeClientReport(config, audit);

  it("stats(s) 의 모든 키와 값이 같다", () => {
    const exp = expected.compute.s as Record<string, unknown>;
    expect(Object.keys(actual.s).sort()).toEqual(Object.keys(exp).sort());
    expect(actual.s).toEqual(exp);
  });

  it.each([
    "answers",
    "engines",
    "per_q",
    "channels",
    "top",
  ] as const)("%s 가 순서까지 같다", (key) => {
    // JSON 왕복: 파이썬 dict 의 정수 키(cells)는 JSON 에서 문자열이 된다 — 같은 조건으로 맞춘다.
    expect(JSON.parse(JSON.stringify(actual[key]))).toEqual(
      currentEngineLabels(expected.compute[key])
    );
  });

  it("config 문구 변수 치환 결과가 같다", () => {
    expect(renderStrings(config, { s: actual.s, c: config })).toEqual(
      expected.config
    );
  });

  it("동결 스냅숏이 저장 형식 검사를 통과하고 fixture 와 같다", () => {
    const data = buildClientReportData({
      config,
      audit,
      slug,
      version: 1,
      importedAt: new Date("2026-09-28T00:00:00Z"),
    });
    expect(
      parseClientReportData(JSON.parse(JSON.stringify(data)))
    ).not.toBeNull();
    const fixture = read<{ computed: unknown; config: unknown }>(
      `${slug}.report.json`
    );
    expect(JSON.parse(JSON.stringify(data.computed))).toEqual(
      currentEngineLabels(fixture.computed)
    );
    expect(data.config).toEqual(fixture.config);
  });
});

describe("pyRound = 파이썬 round (은행가 반올림)", () => {
  // 판정이 갈리는 값만 골랐다 — Math.round 로 되돌리면 앞의 4개가 깨진다.
  it.each([
    [2.5, 0, 2],
    [0.5, 0, 0],
    [-2.5, 0, -2],
    [22.5, 0, 22],
    [3.5, 0, 4],
    [0.125, 2, 0.12],
    [2.675, 2, 2.67],
    [0.25, 1, 0.2],
    [0.35, 1, 0.3],
    [34.782_608_695_652_17, 1, 34.8],
    [(100 * 5) / 22, 0, 23],
  ])("round(%s, %s) = %s", (x, nd, want) => {
    expect(pyRound(x, nd)).toBe(want);
  });
});

describe("문구 템플릿은 모르는 문법에서 멈춘다", () => {
  const s = read<{ computed: { s: never } }>("knowverse.report.json").computed
    .s;
  it.each([
    "{{ s.ok_n|int }}",
    "{% if x %}",
    "{{ s.nope }}",
    "{{ foo() }}",
  ])("%s", (src) => {
    expect(() => renderStrings(src, { s, c: {} })).toThrow();
  });
});

it("PDF 파일명 규칙: 회사명_AI검색진단_v버전_날짜.pdf", () => {
  const data = parseClientReportData(read("knowverse.report.json"));
  expect(data).not.toBeNull();
  if (data) {
    expect(clientReportPdfFilename({ ...data, version: 3 })).toBe(
      "노우버스_AI검색진단_v3_20260928.pdf"
    );
  }
});

describe("고객 리포트 공개 고지", () => {
  it("기존 동결 fixture를 현재 측정값으로 과장하지 않고 과거 엔진을 표시한다", () => {
    const data = parseClientReportData(read("knowverse.report.json"));
    expect(data).not.toBeNull();
    if (!data) {
      return;
    }

    expect(clientReportDisclosure(data)).toEqual({
      isFrozenSnapshot: true,
      retiredEngineIds: ["hyperclova"],
      legacySyntheticEngineIds: ["naver"],
      narrativeAttested: false,
      pdfDownloadAttested: false,
      publicationReviewRequired: true,
      measurementMix: {
        directAiAnswers: 16,
        retiredAnswers: 2,
        legacySyntheticAnswers: 2,
        searchExposureAnswers: 2,
      },
    });
  });

  it("현재 엔진·현재 템플릿이어도 별도 신뢰 검수 없이는 서술을 열지 않는다", () => {
    const data = parseClientReportData(read("knowverse.report.json"));
    expect(data).not.toBeNull();
    if (!data) {
      return;
    }

    const currentOnly = {
      ...data,
      templateVersion: CLIENT_REPORT_TEMPLATE_VERSION,
      config: { ...data.config, measured_at: "2026.09.29" },
      computed: {
        ...data.computed,
        answers: data.computed.answers.filter(
          (answer) => answer.engine !== "hyperclova"
        ),
        engines: data.computed.engines.filter(
          (engine) => engine.id !== "hyperclova"
        ),
      },
    };
    const currentNaver = currentOnly.computed.engines.find(
      (engine) => engine.id === "naver"
    );
    if (currentNaver) {
      currentNaver.name = "네이버 검색 노출";
    }

    expect(clientReportDisclosure(currentOnly)).toEqual({
      isFrozenSnapshot: true,
      retiredEngineIds: [],
      legacySyntheticEngineIds: [],
      narrativeAttested: false,
      pdfDownloadAttested: false,
      publicationReviewRequired: true,
      measurementMix: {
        directAiAnswers: 16,
        retiredAnswers: 0,
        legacySyntheticAnswers: 0,
        searchExposureAnswers: 4,
      },
    });

    const postCutoverStoredOldLabel = {
      ...currentOnly,
      computed: {
        ...currentOnly.computed,
        engines: currentOnly.computed.engines.map((engine) =>
          engine.id === "naver" ? { ...engine, name: "네이버 AI" } : engine
        ),
      },
    };
    expect(
      clientReportDisclosure(postCutoverStoredOldLabel).legacySyntheticEngineIds
    ).toEqual([]);
  });

  it("Naver 측정일 형식을 해석하지 못하면 과거 합성을 현재 검색 노출로 간주하지 않는다", () => {
    const data = parseClientReportData(read("knowverse.report.json"));
    expect(data).not.toBeNull();
    if (!data) {
      return;
    }

    const unknownDate = {
      ...data,
      templateVersion: CLIENT_REPORT_TEMPLATE_VERSION,
      config: { ...data.config, measured_at: "2026/09/30" },
      computed: {
        ...data.computed,
        answers: data.computed.answers.filter(
          (answer) => answer.engine !== "hyperclova"
        ),
        engines: data.computed.engines.filter(
          (engine) => engine.id !== "hyperclova"
        ),
      },
    };

    expect(clientReportDisclosure(unknownDate)).toMatchObject({
      legacySyntheticEngineIds: ["naver"],
      narrativeAttested: false,
      publicationReviewRequired: true,
    });
  });

  it("템플릿 버전 문자열을 고쳐도 스냅숏은 스스로 격리를 풀 수 없다", () => {
    const data = parseClientReportData(read("techdd.report.json"));
    expect(data).not.toBeNull();
    if (!data) {
      return;
    }

    const currentEnginesOnly = {
      ...data,
      config: { ...data.config, measured_at: "2026.10.04" },
      computed: {
        ...data.computed,
        answers: data.computed.answers.filter(
          (answer) => !["hyperclova", "naver"].includes(answer.engine)
        ),
        engines: data.computed.engines.filter(
          (engine) => !["hyperclova", "naver"].includes(engine.id)
        ),
      },
    };

    expect(clientReportDisclosure(currentEnginesOnly)).toMatchObject({
      narrativeAttested: false,
      publicationReviewRequired: true,
    });
    expect(
      clientReportDisclosure({
        ...currentEnginesOnly,
        templateVersion: CLIENT_REPORT_TEMPLATE_VERSION,
      })
    ).toMatchObject({
      narrativeAttested: false,
      publicationReviewRequired: true,
    });
  });

  it("옛 운영자 config를 오늘 다시 import해도 검수 전 서술은 격리한다", () => {
    const config = read<ClientReportConfig>("knowverse.config.json");
    const audit = read<ClientReportAudit>("knowverse.audit.min.json");
    const rebuilt = buildClientReportData({
      config,
      audit,
      slug: "knowverse-reimported",
      version: 2,
      importedAt: new Date("2026-10-04T12:00:00Z"),
    });
    const currentRowsOnly = {
      ...rebuilt,
      config: { ...rebuilt.config, measured_at: "2026.10.04" },
      computed: {
        ...rebuilt.computed,
        answers: rebuilt.computed.answers.filter(
          (answer) => !["hyperclova", "naver"].includes(answer.engine)
        ),
        engines: rebuilt.computed.engines.filter(
          (engine) => !["hyperclova", "naver"].includes(engine.id)
        ),
      },
    };

    const disclosure = clientReportDisclosure(currentRowsOnly);
    expect(rebuilt.templateVersion).toBe(CLIENT_REPORT_TEMPLATE_VERSION);
    expect(disclosure).toMatchObject({
      narrativeAttested: false,
      publicationReviewRequired: true,
    });
    const html = renderToStaticMarkup(
      createElement(ClientReport, {
        data: currentRowsOnly,
        narrativeAttested: disclosure.narrativeAttested,
        webUrl: null,
      })
    );
    expect(html).not.toContain("AI가 공식 사이트에 도달하지 못하면");
    expect(html).toContain("발행 당시 해석과 개선 제안은");
  });

  it("Naver는 현재 생성본에서 AI 답변으로 과장하지 않는다", () => {
    expect(ENGINE_NAMES.naver).toBe("네이버 검색 노출");
    expect(
      currentEngineDisplayText("네이버 AI 브리핑 · 네이버 AI · 다음 검색", [
        "naver",
      ])
    ).toBe("네이버 AI 브리핑 · 네이버 Cue 재현 (Findable 합성) · 다음 검색");
    expect(currentEngineDisplayText("네이버 AI 브리핑 · 네이버 AI", [])).toBe(
      "네이버 AI 브리핑 · 네이버 AI"
    );
    expect(currentEngineDisplayName("naver", "네이버 AI", ["naver"])).toBe(
      "네이버 Cue 재현 (Findable 합성)"
    );
    expect(currentEngineDisplayName("naver", "네이버 AI", [])).toBe(
      "네이버 검색 노출"
    );
  });

  it("동일한 고지가 screen과 print 렌더 모두에 포함된다", () => {
    const screen = renderToStaticMarkup(
      createElement(ClientReportDisclosureNotice, {
        legacySyntheticEngineIds: ["naver"],
        measurementMix: {
          directAiAnswers: 16,
          retiredAnswers: 2,
          legacySyntheticAnswers: 2,
          searchExposureAnswers: 2,
        },
        print: false,
        retiredEngineIds: ["hyperclova"],
      })
    );
    const print = renderToStaticMarkup(
      createElement(ClientReportDisclosureNotice, {
        legacySyntheticEngineIds: ["naver"],
        measurementMix: {
          directAiAnswers: 16,
          retiredAnswers: 2,
          legacySyntheticAnswers: 2,
          searchExposureAnswers: 2,
        },
        print: true,
        retiredEngineIds: ["hyperclova"],
      })
    );

    expect(screen).toContain(
      "현재 측정값이나 현재 엔진 상태를 보증하지 않습니다"
    );
    expect(screen).toContain("과거 네이버 합성 측정");
    expect(screen).toContain("직접 AI 답변 16건");
    expect(screen).toContain('data-report-disclosure="screen"');
    expect(print).toContain(
      "현재 측정값이나 현재 엔진 상태를 보증하지 않습니다"
    );
    expect(print).toContain("과거 네이버 합성 측정");
    expect(print).toContain("직접 AI 답변 16건");
    expect(print).toContain('data-report-disclosure="print"');
  });

  it("공유된 Report 본문도 legacy Naver를 재현 방식으로 표시한다", () => {
    const data = parseClientReportData(read("knowverse.report.json"));
    expect(data).not.toBeNull();
    if (!data) {
      return;
    }

    const html = renderToStaticMarkup(
      createElement(ClientReport, {
        data,
        legacySyntheticEngineIds: ["naver"],
        webUrl: null,
      })
    );
    expect(html).toContain("네이버 Cue 재현 (Findable 합성)");
    expect(html).not.toContain("AI 답변 22개");
    expect(html).toContain("전체 측정 22건");
  });

  it("저장된 H.p4의 구형 AI 답변 headline도 화면에서 과장하지 않는다", () => {
    const data = parseClientReportData(read("knowverse.report.json"));
    expect(data).not.toBeNull();
    if (!data) {
      return;
    }

    const withOldHeadline = {
      ...data,
      config: {
        ...data.config,
        headlines: { p4: "AI 답변 22개 중 14개만 정확했습니다" },
      },
    };
    const html = renderToStaticMarkup(
      createElement(ClientReport, {
        data: withOldHeadline,
        legacySyntheticEngineIds: ["naver"],
        webUrl: null,
      })
    );
    expect(html).not.toContain("AI 답변 22개 중 14개");
    expect(html).toContain("전체 측정 22건 중 5건");
  });

  it("저장된 표지 subtitle의 AI 엔진/답변 과장도 화면에서 혼합 채널로 교정한다", () => {
    const data = parseClientReportData(read("knowverse.report.json"));
    expect(data).not.toBeNull();
    if (!data) {
      return;
    }

    const withOldSubtitle = {
      ...data,
      config: {
        ...data.config,
        cover_sub:
          "ChatGPT·Claude·Gemini 등 AI 7개 엔진, 22개 답변으로 분석한<br/>노우버스 AI 검색 진단 리포트",
      },
    };
    const html = renderToStaticMarkup(
      createElement(ClientReport, {
        data: withOldSubtitle,
        legacySyntheticEngineIds: ["naver"],
        webUrl: null,
      })
    );
    expect(html).not.toContain("AI 7개 엔진, 22개 답변");
    expect(html).toContain(
      "ChatGPT·Claude·Gemini와 검색을 포함한 7개 측정 채널, 전체 측정 22건"
    );
  });
});
