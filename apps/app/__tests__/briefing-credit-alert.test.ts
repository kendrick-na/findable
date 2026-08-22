/**
 * 🔴 **크레딧이 마르기 전에 👤 가 알 수 있는가**(N-45 · 남은일 #4-b B-6).
 *
 * 배경: Firecrawl 크레딧은 **다 마른 뒤에야** 402 로 알 수 있다. 화면은(N-45)
 * *"이번엔 측정하지 못했어요"* 라고 정직하게 말하지만 **👤 에게 알리지는 않는다**
 * → 어느 날 갑자기 브리핑이 멈춘다.
 *
 * 실측(2026-08-19 · 잔량 **1,429**): cron 상한(`MAX_TRIGGERS_PER_RUN=5`) 덕에
 * 하루 최대 15콜 → **최악 95일**. 고객이 늘어도 이 상한 때문에 **속도가 안 빨라진다**.
 * 그래도 3개월 뒤엔 마르므로 **매일 도는 다이제스트가 미리 알린다**.
 *
 * ⚠️ 가드 규율: 존재 검사 금지 · **계약**을 검사한다.
 */

import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";

const ROOT = join(process.cwd(), "../..");

/** 주석을 걷고 실행 코드만 남긴다(📕 가드가 자기 주석을 세는 사고 5회). */
const stripComments = (src: string) =>
  src
    .replaceAll(/\/\*[\s\S]*?\*\//g, "")
    .split("\n")
    .map((line) => {
      const i = line.indexOf("//");
      return i >= 0 ? line.slice(0, i) : line;
    })
    .join("\n");

const DIGEST = stripComments(
  readFileSync(
    join(ROOT, "apps/web/app/api/cron/daily-ops-digest/route.ts"),
    "utf8"
  )
);
const CRON = stripComments(
  readFileSync(
    join(ROOT, "apps/web/app/api/cron/auto-refresh-tracking/route.ts"),
    "utf8"
  )
);

describe("B-6 크레딧 경보 — 마르기 전에 안다", () => {
  it("🔴 다이제스트가 브리핑 실패를 **사유별로** 센다", () => {
    // 「미노출」과 섞으면 경보가 무의미해진다 — 미노출은 정상 결과다.
    expect(DIGEST).toContain("BRIEFING_FAIL_PREFIX.credits");
    expect(DIGEST).toContain("BRIEFING_FAIL_PREFIX.auth");
    expect(DIGEST).toContain("BRIEFING_FAIL_PREFIX.rateLimit");
  });

  it("🔴 👤 조치가 필요한 실패는 **error 레벨**로 올린다 (info 에 묻히면 못 본다)", () => {
    // credits·auth 만 조치 대상이다. rateLimit 은 저절로 풀리므로 깨우지 않는다.
    const at = DIGEST.indexOf("needsAction");
    expect(at, "조치 필요 판정이 없다").toBeGreaterThan(-1);
    const block = DIGEST.slice(at, at + 600);
    expect(block).toMatch(/log\.error\(/);
    expect(block).toContain("credits");
    expect(block).toContain("auth");
    // ⛔ rateLimit 을 조치 대상에 넣으면 일시 장애마다 운영자를 깨운다.
    expect(block).not.toContain("rateLimit");
  });

  it("🔴 경보에 **무엇을 해야 하는지**가 함께 실린다", () => {
    // 이벤트 이름만 있고 조치가 없으면 로그를 봐도 뭘 할지 모른다.
    // ⚠️ `toContain("hint")` 로 검사하면 **`_hint` 로 이름만 바꿔도 통과**한다
    //   (첫 작성에서 실제로 새어나갔다) → 객체 키로 정확히 겨눈다.
    // ⚠️ `briefing_blocked` 부터 자르면 **따옴표가 하나 열린 채**로 시작해 문자열
    //   추출이 엉뚱하게 짝을 맞춘다(첫 작성에서 실제로 그랬다) → `log.error(` 부터 자른다.
    const at = DIGEST.indexOf(
      'log.error("cron.daily-ops-digest.briefing_blocked"'
    );
    expect(at, "briefing_blocked 경보가 없다").toBeGreaterThan(-1);
    const block = DIGEST.slice(at, DIGEST.indexOf("});", at));
    expect(block).toMatch(/(^|[\s{,])hint:/);
    // 조치 문구가 **실제 안내**여야 한다 — `hint: ""` 는 없는 것과 같다.
    //   ⚠️ `hint:[\s\S]{10,}` 로 재면 **뒤따르는 코드까지 세어** 빈 값도 통과한다
    //     (첫 작성에서 실제로 그랬다). → `hint:` 뒤의 **문자열 리터럴**을 직접 본다.
    const hints = [...block.matchAll(/"([^"]{5,})"/g)].map((m) => m[1]);
    expect(
      hints.some((h) => /충전|재설정|필요/.test(h)),
      `조치 안내가 비었다: ${JSON.stringify(hints)}`
    ).toBe(true);
  });

  it("⛔ 다이제스트는 여전히 **읽기 전용**이다 (이 cron 의 성격)", () => {
    // 집계 cron 이 write 를 시작하면 멱등성이 깨진다.
    for (const write of [".create(", ".update(", ".delete(", ".upsert("]) {
      expect(DIGEST, `다이제스트가 ${write} 를 한다`).not.toContain(write);
    }
  });

  it("⛔ cron 소비 상한이 **살아 있다** (없으면 크레딧 계산이 무너진다)", () => {
    // 🔴 잔량 계산(최악 95일)의 전제다. 이 상한이 사라지면 고객 수만큼 소비가 늘어
    //   며칠 만에 마를 수 있다.
    expect(CRON).toMatch(/MAX_TRIGGERS_PER_RUN\s*=\s*\d+/);
    const m = CRON.match(/MAX_TRIGGERS_PER_RUN\s*=\s*(\d+)/);
    const limit = Number(m?.[1] ?? 0);
    expect(limit).toBeGreaterThan(0);
    // 상한이 크게 늘면 소비 예측이 달라진다 — 늘릴 땐 크레딧을 다시 계산해야 한다.
    expect(
      limit,
      "상한을 올렸다면 Firecrawl 잔량 소진 예상을 다시 계산할 것"
    ).toBeLessThanOrEqual(10);
  });
});
