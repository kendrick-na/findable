import { createRequire } from "node:module";
import { dirname, join } from "node:path";
import type { StorybookConfig } from "@storybook/nextjs";

const require = createRequire(import.meta.url);

/** 모노레포에서 애드온 절대경로를 잡는다(apps/storybook 과 같은 방식). */
const getAbsolutePath = (value: string) =>
  dirname(require.resolve(join(value, "package.json")));

/*
 * 🔴 왜 `apps/storybook` 이 아니라 여기(`apps/app`)에 두는가 — 2026-08-16.
 *
 * `apps/storybook` 은 **디자인 시스템 부품**(@repo/design-system) 전용이다.
 * 거기서 대시보드를 읽게 하려면 두 가지가 따라온다:
 *   ① `@/*` 별칭 배선 — 대시보드 컴포넌트 24개 중 **7개가 `@/` 를 쓴다**
 *   ② `apps/storybook` → `apps/app` 워크스페이스 의존 추가
 * 그러면 `@/` 가 **어느 앱 루트인지 모호**해지고 앱 두 개가 교차 결합된다.
 *
 * 여기서 돌리면 `tsconfig.json` 의 `@/* → ./*` 가 **그대로 맞는다**(배선 0).
 * 역할도 갈린다: apps/storybook = UI 부품 / apps/app = 제품 화면.
 */
const config: StorybookConfig = {
  // ⚠️ `app/` 하나만 본다 — `apps/app` 에 최상위 `components/` 는 **없다**
  //   (컴포넌트는 `app/(authenticated)/components/` 안에 있다).
  //   없는 경로를 글롭에 넣으면 webpack 이 `Can't resolve './components'` 로 죽는다.
  stories: ["../app/**/*.stories.@(js|jsx|mjs|ts|tsx)"],
  framework: {
    name: getAbsolutePath("@storybook/nextjs"),
    options: {},
  },
  // ⚠️ `staticDirs` 없음 — `apps/app` 에는 `public/` 이 없다(있다고 쓰면 빌드가 죽는다).

  /*
   * 🔴 **왜 env 를 여기서 채우는가** (N-43 · 2026-08-19).
   *
   * `@/env`(`@repo/env` → `createEnv`)는 **모듈 로드 시점에 환경변수를 검증하고
   * 없으면 throw** 한다. 그래서 `env` 를 import 하는 컴포넌트의 스토리는
   * `❌ Invalid environment variables` 로 **파일 전체가 로드조차 안 되고**,
   * 화면이 **빈 채로 스크린샷만 찍힌다**(빈 화면 가드가 8건 전부 잡았다).
   *
   * ⚠️ 이걸 찾는 데 두 번 헛짚었다 — `async`·`server-only` 를 의심해 뷰를 분리했는데
   *   원인은 **`env`** 였다. **콘솔 에러를 읽고서야** 알았다.
   *   📕 규율: 추측으로 고치지 말고 **실제 에러를 본다**.
   *
   * 🔒 여기 값은 **공개용 더미**다(`NEXT_PUBLIC_*` = 브라우저에 나가는 값).
   *   ⛔ 비밀키를 절대 넣지 않는다 — Storybook 정적 산출물은 공개 배포된다.
   * 🔴 `NEXT_PUBLIC_APP_URL` 은 `env.ts:39` 의 assertion 때문에 **`https://app.` 으로
   *   시작해야** 한다(프로덕션 오배포 방지 가드).
   */
  env: (existing) => ({
    ...existing,
    NEXT_PUBLIC_APP_URL:
      existing.NEXT_PUBLIC_APP_URL ?? "https://app.findable.co.kr",
    NEXT_PUBLIC_WEB_URL:
      existing.NEXT_PUBLIC_WEB_URL ?? "https://findable.co.kr",
  }),
};

export default config;
