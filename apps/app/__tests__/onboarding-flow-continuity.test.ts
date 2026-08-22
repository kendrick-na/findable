/**
 * 🔴 **가입 → 온보딩 → 대시보드가 끊기지 않는지**(N-44 · 👤 *"쭈욱 잘 이어지게"*).
 *
 * 이 여정은 **파일 5개에 걸쳐** 있고, 어느 한 곳만 바뀌어도 조용히 끊긴다.
 * 실제로 N-44 에서 **1단계 직후 대기 화면으로 튕겨 2~5단계를 영영 못 보는** 끊김을
 * 코드 대조로 잡았다(폼이 목적지를 하드코딩하고 있었다).
 *
 * ```
 * 가입 → (org 0개) CreateOrgGate → /welcome → 1단계 폼 → 2~5단계 → 측정 대기 → 대시보드
 *          ①                        ②          ③           ④
 * ```
 *
 * ⚠️ 네트워크·DB 를 타지 않는다 — **소스의 계약**만 검사한다.
 *   📕 규율: 가드는 문구가 아니라 계약을 검사한다(reference_findable_traps §1).
 */

import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";

const read = (rel: string) => readFileSync(join(process.cwd(), rel), "utf8");

/**
 * 주석을 걷고 **실행되는 코드만** 남긴다.
 *
 * 🔴 이 저장소는 가드가 **자기 주석을 세어** 오판한 사고를 반복했다
 *   (N-36 줄끝주석 · N-39 JSX주석 · N-41 「N건 남음」이 제 JSDoc).
 *   N-44 에서도 그랬다: `nextHref` 를 **JSDoc 이 설명**하고 있어서, 실제 사용을 지운
 *   뮤테이션이 **통과**했다. → 블록주석·줄주석을 걷고 검사한다.
 */
const stripComments = (src: string) =>
  src
    .replaceAll(/\/\*[\s\S]*?\*\//g, "")
    .split("\n")
    .map((line) => {
      const i = line.indexOf("//");
      return i >= 0 ? line.slice(0, i) : line;
    })
    .join("\n");

const GATE = stripComments(
  read("app/(authenticated)/components/create-org-gate.tsx")
);
const WELCOME = stripComments(read("app/(authenticated)/welcome/page.tsx"));
const FORM = stripComments(
  read("app/(authenticated)/features/brand/assign-brand-form.tsx")
);
const FLOW = stripComments(
  read("app/(authenticated)/welcome/welcome-flow.tsx")
);
const BRAND = stripComments(read("app/(authenticated)/brand/page.tsx"));
const GATE_FN = stripComments(read("lib/onboarding.ts"));
const EDITOR = stripComments(
  read("app/(authenticated)/features/brand/brand-profile-editor.tsx")
);

describe("온보딩 여정 연결 — 한 곳이라도 끊기면 문다", () => {
  it("① 조직 생성 직후 `/welcome` 으로 간다 (대시보드로 떨구지 않는다)", () => {
    // 예전 값 `"/"` 로 되돌리면 = 텅 빈 대시보드에 떨어뜨리는 옛 문제로 회귀.
    expect(GATE).toContain('afterCreateOrganizationUrl="/welcome"');
  });

  it("② `/welcome` 은 **이미 쓰는 사람**을 되돌린다 (기존 고객이 갇히지 않는다)", () => {
    // 전자상거래법 「반복간섭」 + 기존 고객 UX. 판정은 단일 헬퍼로만.
    // ⚠️ N-44: 기준이 `Brand` 면 1단계가 Brand 를 만드는 순간 2~5단계가 막힌다
    //   → `Tracking`(정식 측정)으로 판정한다. 헬퍼 이름도 그에 맞게 바뀌었다.
    expect(WELCOME).toContain("hasCompletedSetup");
    expect(WELCOME).toContain('redirect("/")');
  });

  it("③ 1단계 폼은 **목적지를 주입받는다** (온보딩이 중간에 튕기지 않는다)", () => {
    // 🔴 이게 없으면 등록 직후 `/brand/measuring` 로 튕겨 2~5단계를 못 본다.
    //   ⚠️ 이름만 찾으면 **JSDoc 이 통과시킨다**(N-44 뮤테이션에서 실제로 새어나갔다)
    //     → `router.push` 가 그 값을 **실제로 쓰는지** 본다.
    expect(FORM).toMatch(/router\.push\(\s*nextHref/);
    // 그리고 `/welcome` 이 실제로 그 값을 넘겨야 한다.
    expect(WELCOME).toContain('nextHref="/welcome"');
  });

  it("③-b 폼을 복제하지 않고 **재사용**한다 (두 화면이 갈리지 않는다)", () => {
    // `/welcome` 이 자체 도메인 폼을 만들면 검증·측정 로직이 두 벌이 된다.
    expect(WELCOME).toContain("AssignBrandForm");
  });

  it("④ 마지막 단계는 저장하고 대시보드로 보낸다 (막다른 길이 없다)", () => {
    expect(FLOW).toContain("onSave");
    expect(FLOW).toContain('router.push("/")');
  });

  it("⛔ 저장 실패가 사용자를 가두지 않는다 (측정은 이미 돌고 있다)", () => {
    // 실패해도 `router.push` 가 `if` 밖에 있어야 한다 — 안에 있으면 갇힌다.
    const finish = FLOW.slice(FLOW.indexOf("const finish"));
    const body = finish.slice(0, finish.indexOf("};"));
    const errIdx = body.indexOf("toast.error");
    const pushIdx = body.indexOf('router.push("/")');
    expect(errIdx).toBeGreaterThan(-1);
    expect(pushIdx).toBeGreaterThan(errIdx);
  });

  it("⛔ 모든 중간 단계는 건너뛸 수 있다 (관문을 만들지 않는다)", () => {
    // 완성 기준(§7-C-7): 건너뛸 수 있는 단계 = 중간 전부.
    const skips = FLOW.match(/skip=\{\{/g) ?? [];
    expect(skips.length).toBeGreaterThanOrEqual(3);
  });

  it("🔴 마지막 단계가 **측정 결말로 분기**한다 (성공 문구 하나로 뭉개지 않는다)", () => {
    // 📕 N-44 교차검증에서 잡은 거짓말: 한도 초과·실패인데도 "측정은 이미 시작됐어요".
    for (const outcome of ["started", "rate_limited", "failed"]) {
      expect(FLOW).toContain(outcome);
    }
    // 🔴 **제목과 설명 둘 다** 분기해야 한다. 하나만 검사하면 나머지 하나를
    //   하드코딩으로 되돌려도 통과한다(N-44 뮤테이션에서 실제로 새어나갔다).
    //   ⚠️ i18n 이관 후 문구는 사전에서 오고, 여기선 **결말→사전키** 매핑을 검사한다.
    expect(FLOW).toMatch(
      /description=\{t\[FINISH_KEYS\[measurement\]\.description\]/
    );
    expect(FLOW).toMatch(/title=\{t\[FINISH_KEYS\[measurement\]\.title\]/);
  });

  it("🔴 1단계 폼이 온보딩에 **결말을 실어 보낸다** (토스트는 전환에 안 남는다)", () => {
    expect(FORM).toMatch(/measurement=\$\{state\.measurement\}/);
  });

  it("🔴 온보딩을 **건너뛴 사람도 나중에 넣을 수 있다** (1-c · 유일한 경로)", () => {
    // `/welcome` 2·4단계는 건너뛸 수 있고, 무료진단 후 가입자는 온보딩 자체를 건너뛴다.
    //   이 화면이 없으면 별칭·경쟁사를 **영영 못 넣는다** = ⓐ 기능이 반쪽이 된다.
    expect(BRAND).toContain("BrandProfileEditorServer");
    // 브랜드마다 자기 값을 받아야 한다(하나로 뭉뚱그리면 다른 브랜드 값을 덮어쓴다).
    expect(BRAND).toMatch(/brandId=\{brand\.id\}/);
    expect(BRAND).toMatch(/competitors=\{brand\.competitors\}/);
    expect(BRAND).toMatch(/entityVariants=\{brand\.entityVariants\}/);
  });

  it("⛔ 저장 경로를 **복제하지 않는다** (온보딩과 같은 서버액션)", () => {
    // 두 벌이 되면 정규화·상한이 갈린다(📕도메인 정규식 3중 복제 사고).
    expect(EDITOR).toContain("onSave");
    expect(EDITOR).not.toContain("database.brand.update");
  });

  it("⛔ 게이트는 **`Brand` 존재로 판정하지 않는다** (그러면 2~5단계가 막힌다)", () => {
    // 🔴 N-44 에서 실제로 이렇게 짰다가 되돌렸다: 1단계 폼이 Brand 를 만드는 순간
    //   게이트가 참이 되어 **온보딩이 1단계에서 끝난다**.
    expect(GATE_FN).toContain("database.tracking.findFirst");
    expect(GATE_FN).not.toContain("database.brand.findFirst");
  });

  it("⛔ 무료 진단(`AuditJob`)만으로 온보딩을 막지 않는다", () => {
    // 🔴 무료 진단은 `Brand` 를 만들지 않는다(`assign.ts:15` 실측) → 막으면 그 사람은
    //   `/welcome` 도 막히고 `/brand` 에 카드도 없어 **어디서도 설정할 수 없다**.
    expect(GATE_FN).not.toContain("auditJob");
  });

  it("🔴 4단계 설명은 **제안 유무를 따라간다** (누를 게 없는데 「눌러서」라 하지 않는다)", () => {
    // 🔴 N-45 실측 버그: 제안 칩은 `suggestedCompetitors.length > 0` 로 숨기면서
    //   설명은 「AI가 제안한 …맞는 것만 **눌러서** 담아주세요」로 고정이었다.
    //   AI 가 경쟁사를 못 뽑으면 **누를 칩이 하나도 없는 화면**에서 누르라고 한다.
    //   (📕 같은 유형 = N-43 「측정 34회」인데 카드는 「측정하면…」 — 한 화면 자기모순)
    //
    // ⚠️ 문구를 하드코딩해 검사하지 않는다 — 그러면 가드가 **버그의 호위병**이 된다
    //   (📕reference_findable_traps: 기대값에 문구를 박으면 틀린 문구도 「통과」시킨다).
    //   대신 **「설명이 같은 조건을 보는가」라는 계약**을 검사한다.
    const step4 = FLOW.slice(FLOW.indexOf("step === 4"));
    const desc = step4.slice(
      step4.indexOf("description="),
      step4.indexOf("primary=")
    );

    // 설명이 제안 개수를 실제로 본다 = 칩과 같은 조건에서 갈린다.
    expect(desc).toMatch(/suggestedCompetitors\.length\s*>\s*0/);
    // 두 갈래가 **서로 다른 사전 키**여야 한다(같은 키면 갈라도 문구가 같다).
    expect(desc).toContain("t.competitorLede");
    expect(desc).toContain("t.competitorLedeEmpty");
  });

  it("🔴 빈 상태 문구가 **두 언어 모두** 있고, 「눌러서」를 말하지 않는다", () => {
    // 사전에 키만 만들고 값을 안 채우면 화면이 `undefined` 로 빈다.
    for (const locale of ["ko", "en"] as const) {
      const dict = JSON.parse(
        readFileSync(
          join(
            process.cwd(),
            `../../packages/internationalization/dictionaries/${locale}.json`
          ),
          "utf8"
        )
      );
      const empty = dict.app.onboarding.competitorLedeEmpty;
      expect(typeof empty).toBe("string");
      expect(empty.length).toBeGreaterThan(0);
      // 제안이 0개인 화면에서 「누르라」고 하면 이 버그로 되돌아간 것이다.
      expect(empty).not.toMatch(/눌러|tap|click/i);
    }
  });
});
