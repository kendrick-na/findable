import type { Preview } from "@storybook/react";
import "../app/styles.css";

/*
 * 🔴 다크 고정 — 제품과 같은 조건으로 본다.
 *   `app/layout.tsx:44` 가 `forcedTheme="dark"` 다. Storybook 을 밝게 두면
 *   **실제로는 못 보는 화면**을 검수하게 된다.
 *   (라이트 대비 1.06:1 결함을 세션N-9 에서 겪고 다크 고정으로 해결한 이력이 있다 —
 *    그 결정을 여기서 되돌리지 않는다.)
 */
const preview: Preview = {
  parameters: {
    backgrounds: { disable: true },
    controls: { matchers: { color: /(background|color)$/i, date: /Date$/i } },
  },
  decorators: [
    (Story) => {
      if (typeof document !== "undefined") {
        document.documentElement.classList.add("dark");
        document.documentElement.style.colorScheme = "dark";
      }
      return Story();
    },
  ],
};

export default preview;
