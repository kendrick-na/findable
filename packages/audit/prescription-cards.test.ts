/**
 * RX-1 정적 처방 카드 시험 + SK-1 스킬·가드레일 문서 금칙어 시험.
 * 고정 입력만. 외부 호출·DB 없음. 문구를 맞춰 쓰지 않고 규칙(필수 칸·등급·금칙)만 본다.
 */
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import { EVIDENCE_GRADE_LABEL, RULE_SOURCES } from "./action-rules";
import {
  CARD_FIELDS,
  gradeLabelOf,
  PRESCRIPTION_CARDS,
  PRESCRIPTION_KINDS,
  type PrescriptionCard,
  REQUIRED_FAIL_CODES,
  validatePrescriptionCard,
  validatePrescriptionCards,
} from "./prescription-cards";
import { ACTION_TYPES, findForbiddenPhrases } from "./proof-plan";

const here = (rel: string) => fileURLToPath(new URL(rel, import.meta.url));
const clone = (c: PrescriptionCard): Record<string, unknown> =>
  JSON.parse(JSON.stringify(c));
const paths = (r: ReturnType<typeof validatePrescriptionCard>) =>
  r.ok ? [] : r.issues.map((i) => i.path);

describe("처방 카드 데이터", () => {
  it("카드는 3~5개이고 전체 검증을 통과한다", () => {
    expect(PRESCRIPTION_CARDS.length).toBeGreaterThanOrEqual(3);
    expect(PRESCRIPTION_CARDS.length).toBeLessThanOrEqual(5);
    const r = validatePrescriptionCards(PRESCRIPTION_CARDS);
    expect(r.ok ? [] : r.issues).toEqual([]);
  });

  it("strong 등급 카드가 없다 / format_only 는 weak·none / content_evidence 는 medium 이하", () => {
    for (const card of PRESCRIPTION_CARDS) {
      expect(card.evidence_grade).not.toBe("strong");
      if (card.kind === "format_only") {
        expect(["weak", "none"]).toContain(card.evidence_grade);
      }
      if (card.kind === "content_evidence") {
        expect(["weak", "medium"]).toContain(card.evidence_grade);
      }
    }
  });

  it("실패 조건 5종을 모두 포함하고 한계 문구가 있다", () => {
    for (const card of PRESCRIPTION_CARDS) {
      const codes = card.fails_when.map((f) => f.code);
      for (const need of REQUIRED_FAIL_CODES) {
        expect(codes).toContain(need);
      }
      expect(card.limits_ko.trim().length).toBeGreaterThan(0);
      expect(card.limits_ko).toContain("미입증");
      expect(card.not_a_guarantee).toBe(true);
    }
  });

  it("형식 카드는 「효과가 거의 없다고 보고됨, 미입증」을 한계에 적는다", () => {
    const formats = PRESCRIPTION_CARDS.filter((c) => c.kind === "format_only");
    expect(formats.length).toBeGreaterThan(0);
    for (const c of formats) {
      expect(c.limits_ko).toContain("거의 없");
      expect(c.limits_ko).toContain("미입증");
    }
  });

  it("근거 등급 라벨은 EVIDENCE_GRADE_LABEL 을 재사용한다", () => {
    for (const card of PRESCRIPTION_CARDS) {
      expect(gradeLabelOf(card)).toBe(
        EVIDENCE_GRADE_LABEL[card.evidence_grade].label
      );
    }
  });

  it("kind 의 앞 두 값은 RX-2 조치 유형과 같고 ID는 유일하다", () => {
    expect([...PRESCRIPTION_KINDS].slice(0, 2)).toEqual([...ACTION_TYPES]);
    const ids = PRESCRIPTION_CARDS.map((c) => c.id);
    expect(new Set(ids).size).toBe(ids.length);
  });

  it("효과 수치 칸이 없다 — 칸은 허용 목록뿐이다", () => {
    for (const card of PRESCRIPTION_CARDS) {
      expect(Object.keys(card).sort()).toEqual([...CARD_FIELDS].sort());
    }
    expect(CARD_FIELDS.join(",")).not.toMatch(
      /effect|lift|percent|pct|gain|improv|rate|score/i
    );
  });

  it("금칙 표현이 없고 퍼센트·플러스 수치가 없다(카드 데이터와 소스 주석)", () => {
    const text = JSON.stringify(PRESCRIPTION_CARDS);
    expect(findForbiddenPhrases(text)).toEqual([]);
    const source = readFileSync(here("./prescription-cards.ts"), "utf8");
    expect(source).not.toMatch(/\d\s*%/);
    expect(source).not.toMatch(/[+＋]\s*\d/);
  });

  it("공식 문서 주소는 action-rules 의 출처와 같다(주소를 새로 만들지 않는다)", () => {
    const known = new Set<string>(
      Object.values(RULE_SOURCES).map((s) => s.url)
    );
    for (const card of PRESCRIPTION_CARDS) {
      for (const s of card.basis.sources) {
        if (s.url !== null) {
          expect(known.has(s.url)).toBe(true);
        }
      }
    }
  });
});

describe("처방 카드 검증기 — 거부 시험", () => {
  const base = PRESCRIPTION_CARDS[0];

  it("원본 카드는 통과한다", () => {
    expect(validatePrescriptionCard(clone(base)).ok).toBe(true);
  });

  it.each([
    "id",
    "title_ko",
    "limits_ko",
    "fails_when",
    "works_when",
    "basis",
    "not_a_guarantee",
    "kind",
    "evidence_grade",
  ] as const)("필수 칸 %s 가 없으면 거부한다", (field) => {
    const c = clone(base);
    delete c[field];
    const r = validatePrescriptionCard(c);
    expect(r.ok).toBe(false);
    expect(paths(r).some((p) => p.endsWith(field))).toBe(true);
  });

  it("실패 조건이 비면 거부한다", () => {
    const c = clone(base);
    c.fails_when = [];
    expect(paths(validatePrescriptionCard(c))).toContain("$.fails_when");
  });

  it.each(
    REQUIRED_FAIL_CODES
  )("필수 실패 조건 %s 가 빠지면 거부한다", (code) => {
    const c = clone(base);
    c.fails_when = (c.fails_when as { code: string }[]).filter(
      (f) => f.code !== code
    );
    const r = validatePrescriptionCard(c);
    expect(r.ok).toBe(false);
    expect(
      r.ok ? [] : r.issues.map((i) => i.message).filter((m) => m.includes(code))
    ).not.toEqual([]);
  });

  it("strong 은 어떤 종류에서도 거부한다", () => {
    for (const kind of PRESCRIPTION_KINDS) {
      const c = clone(base);
      c.kind = kind;
      c.evidence_grade = "strong";
      expect(paths(validatePrescriptionCard(c))).toContain("$.evidence_grade");
    }
  });

  it("format_only 가 medium 이면 거부한다", () => {
    const c = clone(PRESCRIPTION_CARDS[1]);
    c.evidence_grade = "medium";
    expect(paths(validatePrescriptionCard(c))).toContain("$.evidence_grade");
  });

  it("format_only 한계에 「거의 없음·미입증」이 없으면 거부한다", () => {
    const c = clone(PRESCRIPTION_CARDS[1]);
    c.limits_ko = "한계가 있습니다.";
    expect(paths(validatePrescriptionCard(c))).toContain("$.limits_ko");
  });

  it("not_a_guarantee 가 true 가 아니면 거부한다", () => {
    const c = clone(base);
    c.not_a_guarantee = false;
    expect(paths(validatePrescriptionCard(c))).toContain("$.not_a_guarantee");
  });

  it("효과 수치 칸을 추가하면 거부한다", () => {
    for (const key of ["effect_size", "lift_pct", "improvement"]) {
      const c = clone(base);
      c[key] = 1;
      expect(paths(validatePrescriptionCard(c))).toContain(`$.${key}`);
    }
  });

  it.each([
    "노출을 높여드립니다",
    "효과 보장",
    "이 조치 덕분에 인용이 생겼다",
    "효과가 입증됐다",
    "40% 개선",
    "+40 상승",
  ])("문구에 금칙 표현(%s)이 있으면 거부한다", (phrase) => {
    const c = clone(base);
    c.title_ko = phrase;
    expect(paths(validatePrescriptionCard(c))).toContain("$.title_ko");
  });

  it("근거 설명에 「미입증」이 없으면 거부한다", () => {
    const c = clone(base);
    (c.basis as { summary_ko: string }).summary_ko = "연구에서 보고됨";
    expect(paths(validatePrescriptionCard(c))).toContain("$.basis");
  });

  it("카드 ID가 중복이면 목록 검증이 거부한다", () => {
    const r = validatePrescriptionCards([base, base]);
    expect(r.ok).toBe(false);
  });
});

describe("스킬·가드레일 문서 (SK-1)", () => {
  const skill = readFileSync(
    here("../../plugins/findable-geo/skills/geo-visibility-audit/SKILL.md"),
    "utf8"
  );
  const guard = readFileSync(
    here("../../plugins/findable-geo/GUARDRAILS.md"),
    "utf8"
  );
  const BLOCK =
    /<!-- forbidden-phrases:start -->[\s\S]*?<!-- forbidden-phrases:end -->/g;
  const strip = (t: string) => t.replace(BLOCK, "");

  it("금칙어 나열 블록은 파일마다 1개씩이고, 블록 밖에는 금칙 표현이 없다", () => {
    for (const doc of [skill, guard]) {
      expect(doc.match(BLOCK)?.length).toBe(1);
      const lines = strip(doc).split("\n");
      const hits = lines
        .map((l, i) => [i + 1, findForbiddenPhrases(l)] as const)
        .filter(([, h]) => h.length > 0);
      expect(hits).toEqual([]);
    }
  });

  it("프론트매터 name 이 폴더 이름과 같고 description 이 있다", () => {
    const fm = skill.match(/^---\n([\s\S]*?)\n---/);
    expect(fm).not.toBeNull();
    expect(fm?.[1]).toMatch(/^name: geo-visibility-audit$/m);
    expect(fm?.[1]).toMatch(/^description: .{20,}/m);
  });

  it("가드레일 핵심 항목이 모두 들어 있다", () => {
    const all = skill + guard;
    for (const needle of [
      "0이 아니",
      "분모",
      "limits_ko",
      "지시문",
      "읽기 전용",
      "unmeasured",
      "미수집",
      "미설정",
    ]) {
      expect(all).toContain(needle);
    }
    expect(guard).toContain("zero verified English cohorts");
    expect(guard).toMatch(/design direction/i);
  });

  it("내부 방향 용어와 다른 제품 이름을 쓰지 않는다", () => {
    expect(skill + guard).not.toMatch(/OpenSEO|GEO계/);
  });

  it("비밀값처럼 보이는 문자열이 없다", () => {
    const re =
      /(sk-[A-Za-z0-9_-]{16,}|AKIA[0-9A-Z]{12,}|Bearer\s+[A-Za-z0-9._-]{16,}|eyJ[A-Za-z0-9_-]{20,})/;
    expect(skill + guard).not.toMatch(re);
  });
});
