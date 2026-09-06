/*
 * 🔴 **등록하고 측정 시작: 안 돌았으면 안 돌았다고 말한다** — 2026-08-14 (재설계안 v2 §3-b ⑴).
 *
 * ## 막는 사고 (교차검증에서 나온 것)
 * 브랜드 등록이 측정까지 자동으로 시작하게 바뀌었다. 그런데 `assignBrandOwner` 의
 * 반환이 예전처럼 `{ok:true} | {error}` 였다면 **측정 결말을 담을 자리가 없다**:
 *   · 무료 플랜은 같은 도메인을 **24시간에 1회**만 측정할 수 있다
 *   · 한도에 걸리면 측정은 **안 도는데** 화면은 `ok:true` 만 보고 *"등록했어요"* 를 띄운다
 *   → 고객은 **오지 않을 결과를 기다린다**. 조용한 실패다.
 *
 * ⭐ 이 저장소가 반복해서 고쳐온 결함과 **같은 종류**다:
 *   *"무료"라 해놓고 403* · *"이메일로 보내드려요"인데 발송 꺼짐*(N-19) ·
 *   *"곧 메일로 보내드려요"인데 발송 실패*(N-26)
 *   → **제품이 지키지 못할 약속을 화면이 하지 않는다.**
 *
 * ⚠️ 문구가 아니라 **계약**을 검사한다(문구는 계속 다듬을 것이다).
 *   지켜야 하는 계약 = ①서버가 측정 결말을 **반환에 싣는다** ②화면이 그 결말로 **분기한다**
 *   ③측정 로직을 **복제하지 않는다**(한도가 두 곳에서 각자 관리되면 안 된다).
 *
 * @vitest-environment node
 */

import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, test } from "vitest";

const ASSIGN_ACTION = join(
  import.meta.dirname,
  "../app/actions/brand/assign.ts"
);
const ASSIGN_FORM = join(
  import.meta.dirname,
  "../app/(authenticated)/features/brand/assign-brand-form.tsx"
);

/*
 * 주석·import 를 걷어낸 실제 코드 — **주석 문구가 검사를 통과시키지 않도록**.
 *
 * 🔴 정규식으로 블록주석을 지우지 않는다: 게으른 수량자가 앞쪽 주석 시작과 한참 뒤의
 *   주석 끝을 짝지어 **코드 대부분을 삼킨 사고**가 있었다(N-26, 40,570자).
 *   → `lead-email-honesty.test.ts` 와 **같은 줄 단위 상태 기계**를 쓴다.
 */
const stripToCode = (raw: string): string => {
  const out: string[] = [];
  let inBlock = false;
  for (const line of raw.split("\n")) {
    const t = line.trimStart();
    if (inBlock) {
      if (t.includes("*/")) {
        inBlock = false;
      }
      continue;
    }
    if (t.startsWith("//") || t.startsWith("import")) {
      continue;
    }
    if (t.startsWith("/*") || t.startsWith("{/*")) {
      if (!t.includes("*/")) {
        inBlock = true;
      }
      continue;
    }
    out.push(line);
  }
  return out.join("\n");
};

const actionCode = stripToCode(readFileSync(ASSIGN_ACTION, "utf8"));
const formCode = stripToCode(readFileSync(ASSIGN_FORM, "utf8"));

// biome: 정규식은 최상위 상수로.
/** 세 결말이 **타입에 자리를 갖는다**. 자리가 없으면 조용한 실패가 되살아난다. */
const OUTCOME_TYPE =
  /BrandMeasurementOutcome\s*=\s*"started"\s*\|\s*"rate_limited"\s*\|\s*"failed"/;
/** 성공 반환이 결말을 **싣는다**(`{ok:true}` 단독 반환 금지). */
const OK_CARRIES_OUTCOME =
  /ok:\s*true,\s*\.\.\.\(await startMeasurementAfterAssign/g;
/** 한도 차단(`rate_limited`)을 **실패와 구분**해 옮긴다. */
const MAPS_RATE_LIMITED = /code\s*===\s*"rate_limited"\s*\?\s*"rate_limited"/;
/** 측정은 기존 액션에 **위임**한다(정책 복제 금지). */
const DELEGATES_TO_TRACKING = /await startOrgTracking\(/;
/** 가입 때 기술 진단 scheduler 를 실제로 호출한다. */
const DELEGATES_TO_SITE_READINESS = /scheduleSiteReadinessRun\(/;
/** 온보딩 출처를 실행 이력에 보존한다. */
const ONBOARDING_TRIGGER = /trigger:\s*input\.source\s*\?\?\s*"brand_create"/;
/** 🔴 복제 금지: 24시간 한도를 이 파일에서 **다시 계산**하면 두 경로가 갈린다. */
const DUPLICATED_POLICY =
  /24\s*\*\s*60\s*\*\s*60\s*\*\s*1000|auditJob\.findFirst/;

/** 화면이 결말로 **분기**한다(계측에만 쓰지 않는다). */
const FORM_BRANCHES_STARTED = /state\.measurement\s*===\s*"started"/;
const FORM_BRANCHES_RATE_LIMITED = /state\.measurement\s*===\s*"rate_limited"/;
/**
 * 시작됐을 때만 대기 화면으로 보낸다.
 *
 * ⚠️ **N-44 갱신**: 이 폼은 이제 `/brand` 와 `/welcome`(온보딩) **둘 다** 쓴다.
 *   목적지를 주입받되(`nextHref`) **기본값은 여전히 대기 화면**이다 —
 *   즉 이 가드가 지키려던 계약(*"시작됐으면 대기 화면으로"*)은 그대로다.
 *   온보딩이 목적지를 넘기면 그쪽으로 가고, 안 넘기면 기존 동작이다.
 *   🔴 폴백에서 `/brand/measuring` 이 사라지면 = 기존 경로가 끊긴 것 → 여전히 문다.
 */
const ROUTES_TO_WAITING =
  /router\.push\(\s*(?:nextHref\s*\?\?\s*)?`\/brand\/measuring\?job=/;
/**
 * 🔴 되살아나면 안 되는 것: **결말과 무관하게 성공 문구 하나만 띄우는 것.**
 *   예전 문구가 정확히 이랬다 — *"브랜드를 등록했어요. 이제 측정 시작을 눌러…"*
 *   자동 측정이 붙은 지금 이 문장은 **두 번 거짓**이다(측정은 이미 시작됐고,
 *   한도에 걸렸다면 시작조차 안 됐다).
 */
const OLD_UNCONDITIONAL_SUCCESS = /이제 측정 시작을 눌러/;

describe("브랜드 등록 → 자동 측정: 결말을 숨기지 않는다", () => {
  test("🔴 서버가 세 결말(started·rate_limited·failed)을 반환 타입에 싣는다", () => {
    expect(OUTCOME_TYPE.test(actionCode)).toBe(true);
    // 성공 반환 2곳(기존 브랜드 소유지정 · 신규 생성) **모두** 결말을 싣는다.
    //   한쪽만 실으면 그 경로에서만 조용한 실패가 남는다.
    expect(actionCode.match(OK_CARRIES_OUTCOME)?.length).toBe(2);
  });

  test("🔴 한도 차단을 실패와 구분한다 (이미 결과가 있다는 뜻이므로)", () => {
    expect(MAPS_RATE_LIMITED.test(actionCode)).toBe(true);
  });

  test("🔴 측정 정책을 복제하지 않고 startOrgTracking 에 위임한다", () => {
    expect(DELEGATES_TO_TRACKING.test(actionCode)).toBe(true);
    // 24시간 한도·job 조회가 여기 다시 나타나면 두 경로가 서로 다른 한도를 적용한다.
    expect(DUPLICATED_POLICY.test(actionCode)).toBe(false);
  });

  test("🔴 브랜드 등록은 SEO·GEO 사이트 준비도 진단도 예약한다", () => {
    expect(DELEGATES_TO_SITE_READINESS.test(actionCode)).toBe(true);
    expect(ONBOARDING_TRIGGER.test(actionCode)).toBe(true);
  });

  test("🔴 화면이 결말로 분기한다 (성공 문구 하나로 뭉개지 않는다)", () => {
    expect(FORM_BRANCHES_STARTED.test(formCode)).toBe(true);
    expect(FORM_BRANCHES_RATE_LIMITED.test(formCode)).toBe(true);
    expect(ROUTES_TO_WAITING.test(formCode)).toBe(true);
  });

  test("🔴 예전의 무조건 성공 문구가 되살아나지 않는다", () => {
    expect(OLD_UNCONDITIONAL_SUCCESS.test(formCode)).toBe(false);
  });
});

/*
 * 🔴 브랜드 이름이 **필수 입력**으로 바뀌었다(2026-08-21 10번 · 👤 결정).
 *
 * ## 왜 뒤집었나
 * 이름을 비우면 도메인이 그대로 이름이 됐고, 그 값이 **첫 측정 프롬프트에
 * 영구 반영**됐다(`resolveRunPrompts` → `persistFallbackPrompts`). 실측(N-49):
 * 실제 라이브 브랜드가 `sulwhasoo.com`(도메인 그대로)이라 본류 프롬프트 4개가
 * *"sulwhasoo.com 추천해줘"* 로 저장·재사용되고 있었다 — 사람은 그렇게 검색하지
 * 않으므로 측정 품질이 떨어진다.
 *
 * 경쟁사 실측(Profound f005 "회사 이름을 입력하세요" 필수 · Scrunch f009
 * "Confirm your details"로 값을 미리 채워 확인)도 **빈칸에서 타이핑 유도**는
 * 안 한다 — 그래서 여기서도 정적 사전 자동 채움(`suggestBrandName`)을 붙이되
 * 필수는 유지한다.
 *
 * ⚠️ `/brand`(기존 브랜드 관리)와 `/welcome`(온보딩)이 **같은 폼**을 쓴다 — 둘 다
 *   필수로 간다(👤 결정). 갈라서 적용하면 두 경로의 프롬프트 품질이 갈린다.
 */
const REJECTS_EMPTY_NAME = /브랜드 이름\(또는 회사명\)을 입력해 주세요/;
const NAME_NO_LONGER_FALLS_BACK_TO_DOMAIN =
  /input\.name\?\.trim\(\)\s*\|\|\s*domain/;
const FORM_NAME_REQUIRED =
  /id="brand-name"[\s\S]{0,300}?required|required[\s\S]{0,300}?id="brand-name"/;

describe("브랜드 이름은 필수 입력이다", () => {
  test("🔴 이름이 비면 서버가 거부한다", () => {
    expect(REJECTS_EMPTY_NAME.test(actionCode)).toBe(true);
  });

  test("이름이 비어도 도메인으로 조용히 대체하지 않는다 (예전 폴백 제거)", () => {
    expect(NAME_NO_LONGER_FALLS_BACK_TO_DOMAIN.test(actionCode)).toBe(false);
  });

  test("폼의 이름 칸이 required 다", () => {
    expect(FORM_NAME_REQUIRED.test(formCode)).toBe(true);
  });
});
