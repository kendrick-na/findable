/**
 * @vitest-environment jsdom
 *
 * 🔴 **왜 이 테스트가 있나** (세션N-47 · 2026-08-19)
 *
 * 운영 콘솔 「가입 조직」 표에서 **오른쪽정렬 「측정」 칸과 왼쪽정렬 「가입」 칸이 맞닿아**
 * 숫자가 한 덩어리로 읽혔다. 라이브 스크린샷 실물:
 *
 * ```
 *   측정   가입              화면에 보인 것
 *     0    2026. 8. 19.  →  「02026. 8. 19.」   ← 연도가 02026 인 줄 알게 된다
 *    42    2026. 8. 10.  →  「422026. 8. 10.」
 *   340    2026. 7. 30.  →  「3402026. 7. 30.」
 * ```
 *
 * ⚠️ **두 값 다 맞았다.** 틀린 건 **붙어 있는 것**이다 — 그래서 값 검사로는 절대 안 잡힌다.
 *
 * 🔴 **자동 점검을 전부 통과했다**: `verify-app.py` 의 텍스트 추출은 셀 경계에서
 *   공백을 넣어 주므로 *"0 2026. 8. 19."* 로 읽혀 **정상으로 보였다.**
 *   📕 *"스토리 목업은 깨끗해서 실데이터 버그를 못 잡는다"* 의 변주 —
 *   이번엔 **추출기가 원본에 없는 공백을 만들어** 사람 눈에만 보이는 결함이 됐다.
 *   ⭐ 잡은 것은 **스크린샷 눈확인**이다.
 *
 * 원인: 셀이 전부 `py-*` 뿐이라 **가로 padding 이 0**. 인접 칸 사이에 여백이 없었다.
 * 고침: 표에 `border-separate border-spacing-x-4` — **표 차원에서 한 번에** 보장한다.
 *
 * ⚠️ **왜 셀마다 `px-*` 를 주지 않았나**: 칸이 새로 생길 때마다 또 빠뜨린다.
 *   실제로 이 표는 칸이 7개인데 **7개 전부** 가로 여백이 없었다(한 곳을 놓친 게 아니라
 *   애초에 규칙이 없었다). 규칙은 컨테이너에 두어야 새 칸이 자동으로 상속받는다.
 *
 * 🔴 **가드가 문구를 하드코딩하지 않는다** — 📕 *"가드가 버그의 호위병이 된다"*.
 *   「측정」·「가입」이라는 **글자**를 검사하면 라벨을 바꿀 때 같이 깨진다.
 *   대신 **구조 계약**을 본다: 인접한 두 칸이 시각적으로 분리되는가.
 */

import { readFileSync } from "node:fs";
import { join } from "node:path";
import { cleanup, render } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";

// 🔴 `OrgTable` 은 `useRouter()` 를 부른다 — jsdom 엔 app router 가 없어
//   *"invariant expected app router to be mounted"* 로 렌더가 통째로 죽는다(실측).
//   이 표는 **갱신 후 새로고침** 용도로만 라우터를 쓰므로 빈 스텁으로 충분하다.
//   ⚠️ import 보다 먼저 걸려야 한다(vitest 가 hoist 해 준다).
vi.mock("next/navigation", () => ({
  useRouter: () => ({ refresh: vi.fn(), push: vi.fn() }),
}));

import { OrgTable } from "../app/(authenticated)/admin/orgs/org-table";

afterEach(cleanup);

const TABLE_SOURCE = readFileSync(
  join(process.cwd(), "app/(authenticated)/admin/orgs/org-table.tsx"),
  "utf8"
);

/**
 * 라이브에서 실제로 붙어 보였던 조합을 그대로 재현한다.
 * `trackingCount` 가 0·42·340 세 자릿수 모두인 이유: 자릿수가 달라도 같은 결함이 난다
 * (0 → 「02026」 · 340 → 「3402026」). 한 값만 넣으면 우연히 통과할 수 있다.
 */
const ORGS = [
  {
    autoRefreshHours: null,
    brandCount: 0,
    createdAt: new Date("2026-08-19T00:00:00.000Z"),
    id: "org_a",
    memberCount: 1,
    name: "Naver",
    plan: "free" as const,
    planExpiresAt: null,
    trackingCount: 0,
  },
  {
    autoRefreshHours: null,
    brandCount: 1,
    createdAt: new Date("2026-08-10T00:00:00.000Z"),
    id: "org_b",
    memberCount: 1,
    name: "My Organization",
    plan: "free" as const,
    planExpiresAt: null,
    trackingCount: 42,
  },
  {
    autoRefreshHours: 24,
    brandCount: 7,
    createdAt: new Date("2026-07-30T00:00:00.000Z"),
    id: "org_c",
    memberCount: 1,
    name: "Indigochild's Organization",
    plan: "growth" as const,
    planExpiresAt: null,
    trackingCount: 340,
  },
];

describe("운영 콘솔 「가입 조직」 표 — 인접 칸이 붙지 않는다", () => {
  it("표가 칸 사이 가로 여백을 **컨테이너 차원에서** 보장한다", () => {
    const { container } = render(<OrgTable invites={[]} orgs={ORGS} />);
    const table = container.querySelector("table");
    expect(table).not.toBeNull();

    const cls = table?.className ?? "";
    // `border-separate` 없이는 `border-spacing-*` 이 **무시된다**(CSS 규격).
    // 둘을 함께 요구해야 「썼는데 안 먹는」 상태를 잡는다.
    expect(cls).toContain("border-separate");
    expect(cls).toMatch(/border-spacing-x-[1-9]/);
  });

  it("행 높이는 건드리지 않는다 — 세로 간격은 0 이어야 한다", () => {
    // ⚠️ `border-separate` 를 켜면 세로에도 기본 간격이 생겨 행이 벌어지고
    //   행 구분선(`border-t`)이 끊겨 보인다. 가로만 벌리는 게 의도다.
    const { container } = render(<OrgTable invites={[]} orgs={ORGS} />);
    expect(container.querySelector("table")?.className ?? "").toContain(
      "border-spacing-y-0"
    );
  });

  it("측정 수와 가입일이 **서로 다른 칸**에 있다(한 칸에 합치면 또 붙는다)", () => {
    const { container } = render(<OrgTable invites={[]} orgs={ORGS} />);
    const row = container.querySelectorAll("tbody tr")[0];
    const cells = Array.from(row?.querySelectorAll("td") ?? []).map(
      (td) => td.textContent?.trim() ?? ""
    );
    // 어느 한 칸도 「숫자 + 연도」를 **동시에** 담고 있으면 안 된다.
    // 이것이 이 버그의 본질이다(값이 아니라 **배치**).
    const merged = cells.filter((t) =>
      /^\d+20\d{2}/.test(t.replace(/\s/g, ""))
    );
    expect(merged).toEqual([]);
  });

  it("🔴 뮤테이션: 가로 여백을 없애면 반드시 실패한다", () => {
    // 가드가 실제로 무는지 확인한다 — 📕 *"가드는 뮤테이션으로 무는지 확인"*.
    // 소스에서 여백 클래스를 지운 문자열이 위 계약을 통과하면 가드가 헐렁한 것이다.
    const mutated = TABLE_SOURCE.replace(/border-spacing-x-\d+/, "");
    expect(/border-spacing-x-[1-9]/.test(mutated)).toBe(false);
    // 원본은 당연히 통과해야 한다(가드가 항상 실패하는 것도 무의미하다).
    expect(/border-spacing-x-[1-9]/.test(TABLE_SOURCE)).toBe(true);
  });
});
