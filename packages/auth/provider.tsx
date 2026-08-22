"use client";

import { koKR } from "@clerk/localizations";
import { ClerkProvider } from "@clerk/nextjs";
import { dark } from "@clerk/themes";
import type { Theme } from "@clerk/types";
import { useTheme } from "next-themes";
import type { ComponentProps } from "react";

/**
 * 한국어 UI + 소셜 버튼 문구.
 *
 * 🔴 `socialButtonsBlockButtonManyInView` 를 덮어쓰는 이유(실측):
 *   Clerk 는 제공사가 **3개 이상이면** 짧은 라벨(`ManyInView` = "Google")을 쓰고,
 *   `socialButtonsBlockButton`("~로 계속하기")은 **쓰지 않는다**.
 *   우리는 구글·카카오·네이버 3개라 이걸 안 덮어쓰면 버튼에 제공사 이름만 나온다.
 *   (`useEnabledThirdPartyProviders` 의 `SOCIAL_BUTTON_PRE_TEXT_THRESHOLD = 1` 분기)
 */
const localization = {
  ...koKR,
  socialButtonsBlockButtonManyInView: "{{provider|titleize}}로 시작하기",
  // 🔴 N-42 눈확인: 가입 화면이 전부 한글인데 비밀번호 칸만 `Create a password` 로
  //   **영어가 남아 있었다**(`koKR` 가 이 키를 안 덮는다).
  //   화면에서 한 칸만 언어가 다르면 "번역이 덜 된 서비스"로 읽힌다.
  // ⚠️ **가입과 로그인은 키가 다르다** — 처음에 `__password`(로그인용)로 덮었더니
  //   화면이 그대로였다. 가입은 `__signUpPassword` 다(Clerk `en-US.ts` 원본 확인).
  //   📕 규율: 키 이름을 추측하지 말고 원본에서 확인할 것.
  formFieldInputPlaceholder__signUpPassword: "비밀번호를 만들어 주세요",
  formFieldInputPlaceholder__password: "비밀번호를 입력하세요",
};

type AuthProviderProperties = ComponentProps<typeof ClerkProvider> & {
  privacyUrl?: string;
  termsUrl?: string;
  helpUrl?: string;
};

export const AuthProvider = ({
  privacyUrl,
  termsUrl,
  helpUrl,
  ...properties
}: AuthProviderProperties) => {
  const { resolvedTheme } = useTheme();
  const isDark = resolvedTheme === "dark";
  const baseTheme = isDark ? dark : undefined;

  const variables: Theme["variables"] = {
    fontFamily: "var(--font-sans)",
    fontFamilyButtons: "var(--font-sans)",
    fontWeight: {
      bold: "var(--font-weight-bold)",
      normal: "var(--font-weight-normal)",
      medium: "var(--font-weight-medium)",
    },
  };

  const elements: Theme["elements"] = {
    dividerLine: "bg-border",
    // 🔴 `socialButtonsIconButton` 은 **아이콘 전용 변형**에만 쓰인다.
    //   blockButton 으로 바꿨으므로 아래 block* 키를 쓴다(옛 키는 무해하나 무효).
    //
    // ⚠️ blockButton 만으로는 부족했다(실측·눈확인): Clerk 가 버튼 3개를 **한 줄에 나란히**
    //   배치해 폭이 부족하고 문구가 `Googl…` `Kakao…` 로 **잘렸다**.
    //   → 컨테이너를 세로 1열로 강제해야 "가로 전체폭 + 로고 + 문구"(국내 관행)가 된다.
    //   Layout 옵션에는 열 수를 정하는 키가 없다(`socialButtonsVariant`·`Placement` 뿐).
    //   🔴 Tailwind 클래스로는 **못 이긴다**(실측): 클래스는 DOM 에 붙지만 Clerk 내부
    //     `cl-internal-*` 이 `grid-template-columns: 102px 102px 102px` 로 3열을 잡아
    //     우선순위에서 이긴다. → Clerk 가 공식 지원하는 **객체(CSS-in-JS) 형식**으로 준다.
    socialButtons: { gridTemplateColumns: "1fr", gap: "0.5rem" },
    socialButtonsBlockButton: "bg-card w-full justify-center",
    socialButtonsBlockButtonText: "font-medium",
    navbarButton: "text-foreground",
    organizationSwitcherTrigger__open: "bg-background",
    organizationPreviewMainIdentifier: "text-foreground",
    organizationSwitcherTriggerIcon: "text-muted-foreground",
    organizationPreview__organizationSwitcherTrigger: "gap-2",
    organizationPreviewAvatarContainer: "shrink-0",
  };

  const layout: Theme["layout"] = {
    privacyPageUrl: privacyUrl,
    termsPageUrl: termsUrl,
    helpPageUrl: helpUrl,
    // 국내 관행 = 로고 + 문구가 든 가로 전체폭 버튼.
    // 🔴 Clerk 기본값 `auto` 는 제공사가 **3개 이상이면 아이콘 정사각형**을 쓴다(우리가 3개)
    //   → 명시하지 않으면 글자 없는 버튼이 된다(실측: 구글·카카오·네이버 아이콘만 나왔다).
    socialButtonsVariant: "blockButton",
  };

  return (
    <ClerkProvider
      {...properties}
      appearance={
        {
          layout,
          // 🔴 런타임(Core 3)은 이 키를 **`options`** 에서 읽는다. 타입 패키지
          //   (`@clerk/types` → `@clerk/shared@3.47.5`)는 아직 `layout` 만 알아서
          //   `options` 를 쓰면 tsc 에러가 난다 → **타입만 우회하고 런타임 이름으로 보낸다.**
          //   ⚠️ Clerk 는 모르는 appearance 키를 **조용히 무시**한다(에러·경고 없음).
          //     실측 근거: `layout` 만 준 배포(`vsn4a2g1i`)에서 localization 은 먹었는데
          //     소셜 버튼은 아이콘 그대로였다 → 즉 이 키는 `layout` 에서 안 읽힌다.
          //   🔬 둘 다 보내는 이유: 버전이 올라 `layout` 을 다시 읽어도 깨지지 않게 한다.
          options: layout,
          baseTheme,
          // baseTheme 도 신 이름이 `theme` 다(같은 이유로 병기).
          theme: baseTheme,
          elements,
          variables,
        } as ComponentProps<typeof ClerkProvider>["appearance"]
      }
      localization={localization}
    />
  );
};
