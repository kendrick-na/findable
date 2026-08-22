/*
 * 개인정보 처리방침 공개의무 회귀 테스트 — 2026-08-12 세션N-25.
 *
 * 🔴 **막는 사고 2가지.**
 *   ① **수탁자 목록이 낡는 것.** 법 제26조 제2항은 위탁 사실을 *"계속적으로 게재"* 하도록
 *      요구하므로 **낡은 목록 자체가 위반**이다. 새 외부 서비스를 붙이고 방침을 안 고치면
 *      그 순간 위반이 된다(업체명 누락으로 과태료가 나온 의결례가 실재한다 —
 *      의결 제2023-012-130호는 계약서가 **있었는데도** 항목 누락으로 과태료).
 *   ② **KO/EN 이 어긋나는 것.** 한쪽만 고치면 다른 언어 이용자에게는 **다른 내용을 고지**한
 *      셈이 된다. 이 파일은 KO·EN 을 한 파일에 담고 있어 한쪽만 고치기가 오히려 쉽다.
 *
 * ⚠️ **왜 "문구"가 아니라 "구조"로 판정하나**
 *   🎓 이 프로젝트가 반복해서 데인 지점 = *"가드가 버그의 호위병이 된다"*.
 *   검사장치에 완성된 문장을 하드코딩하면 ⓐ틀린 문구를 ✅통과시키거나
 *   ⓑ올바른 개정을 ❌실패시킨다(양방향으로 터진다).
 *   → 그래서 여기서는 **문장을 대조하지 않는다.** 대신 검증하는 것은
 *     "**섹션 번호가 빠짐없이 이어지는가**"(=개정하다 번호를 흘리지 않았는가),
 *     "**KO 와 EN 의 섹션 수가 같은가**"(=한쪽만 고치지 않았는가),
 *     "**실제 코드가 의존하는 수탁자가 방침에 이름으로 적혀 있는가**" 세 가지다.
 *     문안을 어떻게 다듬든 이 세 성질은 유지되어야 한다.
 *
 * ⚠️ **왜 페이지를 import 하지 않고 소스를 읽나**
 *   대상은 `apps/web` 의 서버 컴포넌트라 `@repo/seo`·`next/navigation` 스텁이 필요하다.
 *   그런데 지키려는 성질은 **정적 성질**이라 소스를 직접 읽어 단정하면
 *   모킹으로 우회되지 않고 의존성도 0이다(선례: `webhook-log-privacy.test.ts`).
 *   🔴 `apps/web` 에는 테스트 러너가 없으므로 이 파일은 `apps/app` 에서 돈다.
 *
 * @vitest-environment node
 */

import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, test } from "vitest";

const PAGE_PATH = join(
  process.cwd(),
  "../web/app/[locale]/legal/[slug]/page.tsx"
);

const source = readFileSync(PAGE_PATH, "utf8");

// biome: 정규식은 최상위 상수로 둔다(호출마다 재생성 방지 — 프로젝트 규칙).
/** `h: "3. ..."` 형태의 섹션 제목에서 앞번호만 뽑는다(KO·EN 공통 형식). */
const SECTION_NUM_RE = /h:\s*"(\d+)\.\s/g;
/** KO/EN 사전 블록의 시작 지점 — 두 블록을 갈라 세기 위한 기준점. */
const EN_BLOCK_MARKER = "const PAGES_EN";
/** 섹션 **본문**(`p:`)만 뽑는다 — 제목(`h:`)은 제외해야 가드가 뚫리지 않는다. */
const BODY_RE = /p:\s*"([^"]*)"/g;
/** 🔴 개인정보를 학습에 쓴다는 **긍정 서술** — 있으면 그 자체로 사고다. */
const AFFIRMATIVE_TRAINING_KO =
  /학습에\s*(?:이용할\s*수\s*있|이용합니다|사용할\s*수\s*있|사용합니다)/;
/** 부정 고지(KO) — 본문 안에 있어야 한다. */
const NEGATIVE_TRAINING_KO = /학습에\s*이용하지\s*않습니다/;
/**
 * 부정 고지(EN). ⚠️ 괄호 삽입구(`(email address, name, ...)`)가 사이에 들어가므로
 * "personal data" 와 "train" 이 **붙어 있다고 가정하면 안 된다**(실제로 한 번 틀렸다).
 */
const NEGATIVE_TRAINING_EN = /does not use your personal data[\s\S]*to train/i;

/**
 * 🔴 **실제로 개인정보를 받는 수탁자만** 여기 적는다.
 *   근거 = 프로덕션 env 실측 + 코드상 데이터 흐름 실측(세션N-25).
 *   ⛔ 코드에 키만 있고 프로덕션에 없는 것(Stripe·BetterStack·Sentry 등)은
 *      **적으면 오히려 거짓 기재**가 되므로 넣지 않는다.
 *   ⛔ AWS 는 SDK·의존성이 0건이고 `AWS_LAMBDA_FUNCTION_NAME` 은 서버리스 런타임
 *      **감지 플래그**일 뿐이다 — 인계문서에 적혀 있었으나 실측으로 기각했다.
 */
const REQUIRED_PROCESSORS = [
  "Vercel", // 호스팅·배포
  "Neon", // DB (가입자 정보 저장 실체)
  "Clerk", // 인증 (이메일·이름 보유)
  "PortOne", // 결제
  "Resend", // 메일 발송 (수신자 이메일)
  "PostHog", // 이용 분석 (identify 로 이메일·이름·전화번호 전송)
];

const koBlock = source.slice(0, source.indexOf(EN_BLOCK_MARKER));
const enBlock = source.slice(source.indexOf(EN_BLOCK_MARKER));

const numbersIn = (block: string): number[] =>
  [...block.matchAll(SECTION_NUM_RE)].map((m) => Number(m[1]));

describe("개인정보 처리방침 — 공개의무 구조 가드", () => {
  test("KO 섹션 번호가 1부터 빠짐없이 이어진다", () => {
    // privacy 다음에 terms(제N조)가 오지만 terms 는 `h: "제1조..."` 라 이 정규식에 안 걸린다.
    const nums = numbersIn(koBlock);

    // 🔴 0건이면 정규식이 헛돈 것 — 그걸 "통과"로 읽으면 가드가 무력해진다.
    expect(nums.length).toBeGreaterThan(0);
    expect(nums).toEqual(Array.from({ length: nums.length }, (_, i) => i + 1));
  });

  test("EN 섹션 번호가 1부터 빠짐없이 이어진다", () => {
    const nums = numbersIn(enBlock);

    expect(nums.length).toBeGreaterThan(0);
    expect(nums).toEqual(Array.from({ length: nums.length }, (_, i) => i + 1));
  });

  test("KO 와 EN 의 섹션 수가 같다 — 한쪽만 개정하면 실패한다", () => {
    expect(numbersIn(enBlock).length).toBe(numbersIn(koBlock).length);
  });

  test.each(
    REQUIRED_PROCESSORS
  )("수탁자 '%s' 가 KO·EN 양쪽에 이름으로 공개돼 있다", (processor) => {
    // 제26조 제2항: "업무 내용"과 "수탁자"를 **둘 다** 적어야 한다.
    // 업체명이 사라지면(예: "외부 위탁 처리 중" 으로 뭉뚱그리면) 여기서 걸린다.
    expect(koBlock).toContain(processor);
    expect(enBlock).toContain(processor);
  });

  test("개인정보를 AI 학습에 쓴다는 **긍정 서술**이 없다 — 뒤집히면 실패한다", () => {
    // 🔴 이 테스트는 **뮤테이션으로 한 번 뚫렸다**(세션N-25). 처음에는
    //    `/학습에\s*이용하지\s*않습니다/` 의 **존재**만 봤는데, 같은 문구가
    //    **섹션 제목에도** 있어서(제목 "3. AI 모델 학습에 이용하지 않습니다")
    //    본문을 *"이용할 수 있습니다"* 로 뒤집어도 제목이 정규식을 만족시켜 **통과**했다.
    //    🎓 교훈 그대로다 — **존재 검사만 하는 가드는 호위병이 된다.**
    //    → 그래서 "부정 고지가 있는가"가 아니라 **"긍정 서술이 없는가"** 로 판정한다.
    //      (부정문은 문안을 다듬을 수 있지만, 긍정 서술은 어떻게 쓰든 사고다.)
    expect(koBlock).not.toMatch(AFFIRMATIVE_TRAINING_KO);

    // 부정 고지 자체도 여전히 있어야 한다(제목이 아니라 **본문 `p:` 안**에서 찾는다).
    const koBodies = [...koBlock.matchAll(BODY_RE)].map((m) => m[1]);
    expect(koBodies.some((b) => NEGATIVE_TRAINING_KO.test(b))).toBe(true);

    const enBodies = [...enBlock.matchAll(BODY_RE)].map((m) => m[1]);
    expect(enBodies.some((b) => NEGATIVE_TRAINING_EN.test(b))).toBe(true);
  });
});
