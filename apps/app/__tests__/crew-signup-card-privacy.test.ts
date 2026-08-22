/*
 * 결과 페이지 가입 카드 — 공유링크 이메일 노출 방지 가드. 2026-08-12 세션N-25.
 *
 * 🔴 **막는 사고**: 진단 결과 페이지는 **비로그인 접근 가능**하다. 여기에 신청자
 *   이메일(마스킹)을 띄우면, 카카오톡 등으로 링크를 공유했을 때 **받은 제3자가
 *   남의 이메일 일부를 본다**. 세션N-7 이 이미 이 사고를 겪고 `?shared=1` 표식으로
 *   가렸다(경쟁사 Profound·AthenaHQ 공유링크는 신청자 PII 를 담지 않는다).
 *
 * ⚠️ 세션N-25 가 **새 카드**(`CrewSignUpCard`)를 추가하면서 같은 위험이 재발할 수 있다 —
 *   기존 `UpsellCard` 만 가리고 새 카드가 안 가리면 **새 구멍**이 된다.
 *   이 테스트는 **두 카드가 같은 판정을 쓰는지**를 소스로 확인한다.
 *
 * ⚠️ **왜 렌더 테스트가 아니라 정적 검사인가**: 이 파일은 4,000줄 클라이언트 컴포넌트라
 *   렌더하려면 `SpotlightCard`·`Button`·아이콘·`useEffect` 환경을 다 세워야 하고,
 *   그렇게 해도 검증하려는 성질은 *"공유뷰에서 이메일을 넘기지 않는다"* 는 **정적 성질**이다.
 *   → 소스를 직접 읽어 단정하면 모킹으로 우회되지 않는다(선례: `webhook-log-privacy`).
 *
 * @vitest-environment node
 */

import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, test } from "vitest";

const SOURCE = readFileSync(
  join(
    process.cwd(),
    "../web/app/[locale]/audit/[jobId]/components/audit-result.tsx"
  ),
  "utf8"
);

/** 주석을 걷어낸 실행 코드만 — 주석의 단어를 근거로 삼으면 가드가 헛돈다. */
const CODE_ONLY = SOURCE.replace(/\/\*[\s\S]*?\*\//g, "")
  .split("\n")
  .filter((l) => !l.trim().startsWith("//"))
  .join("\n");

// biome: 정규식은 최상위 상수로(프로젝트 규칙).
/** 공유뷰면 이메일을 null 로 떨어뜨리는 형태. `X = isSharedView ? null : ...` */
const SHARED_NULL_GUARD = /isSharedView\s*\?\s*null\s*:/g;
/** `?shared=1` 판정 자체. */
const SHARED_PARAM_CHECK = /get\("shared"\)\s*===\s*"1"/g;
/** 🔴 마스킹 이메일을 JSX 로 **직접** 출력하는 형태 — 공유뷰에서도 보이므로 금지. */
const RAW_EMAIL_IN_JSX = /\{emailMasked\}/;
/** 공유 판정 초기값이 숨김(true)인지. */
const SAFE_DEFAULT_HIDDEN = /useState\(true\)/;

describe("공유링크에서 신청자 이메일이 노출되지 않는다", () => {
  test("`isSharedView ? null :` 가드가 **2곳 이상** 있다 — 카드마다 필요하다", () => {
    const hits = CODE_ONLY.match(SHARED_NULL_GUARD) ?? [];
    // UpsellCard(기존) + CrewSignUpCard(세션N-25). 새 카드가 이메일을 쓰면서
    // 이 가드를 빠뜨리면 개수가 줄어 실패한다.
    expect(hits.length).toBeGreaterThanOrEqual(2);
  });

  test("`?shared=1` 판정이 가드마다 함께 있다", () => {
    const checks = CODE_ONLY.match(SHARED_PARAM_CHECK) ?? [];
    expect(checks.length).toBeGreaterThanOrEqual(2);
  });

  test("🔴 CrewSignUpCard 가 `emailMasked` 를 **그대로** 렌더하지 않는다", () => {
    // 🔴 이 단정은 한 번 오탐을 냈다: 고정 길이(3000자)로 잘랐더니 창이 다음 컴포넌트
    //    (`CrewTriggerCard`)까지 넘어가, **정상적인 prop 전달**
    //    (`<CrewSignUpCard emailMasked={emailMasked} .../>`)을 위반으로 잡았다.
    //    → **함수 경계까지만** 자른다. 다음 최상위 `function ` 선언이 끝이다.
    const start = CODE_ONLY.indexOf("function CrewSignUpCard");
    expect(start).toBeGreaterThan(-1);
    const after = CODE_ONLY.indexOf("\nfunction ", start + 1);
    const body = CODE_ONLY.slice(start, after === -1 ? undefined : after);

    // 공유 판정을 거친 `ownerEmail` 만 JSX 에 들어가야 한다.
    expect(body).toContain("ownerEmail");
    // `{emailMasked}` 를 JSX 로 직접 출력하면 공유뷰에서도 보인다 → 금지.
    expect(body).not.toMatch(RAW_EMAIL_IN_JSX);
  });

  test("초기값이 숨김(true)이다 — 판별 전 한 프레임 노출을 막는다", () => {
    // `useState(true)` 로 시작해야 안전하다. false 로 바뀌면 첫 프레임에 노출된다.
    expect(CODE_ONLY).toMatch(SAFE_DEFAULT_HIDDEN);
  });
});
