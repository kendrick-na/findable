import { AuthProvider } from "@repo/auth/provider";
import type { ThemeProviderProps } from "next-themes";
import { Toaster } from "./components/ui/sonner";
import { TooltipProvider } from "./components/ui/tooltip";
import { ThemeProvider } from "./providers/theme";

type DesignSystemProviderProperties = ThemeProviderProps & {
  privacyUrl?: string;
  termsUrl?: string;
  helpUrl?: string;
  /** 로그인 위젯(Clerk) 언어. 없으면 한국어. */
  authLocale?: "ko" | "en";
};

export const DesignSystemProvider = ({
  children,
  authLocale,
  privacyUrl,
  termsUrl,
  helpUrl,
  ...properties
}: DesignSystemProviderProperties) => (
  <ThemeProvider {...properties}>
    <AuthProvider
      helpUrl={helpUrl}
      locale={authLocale}
      privacyUrl={privacyUrl}
      termsUrl={termsUrl}
    >
      <TooltipProvider>{children}</TooltipProvider>
      <Toaster />
    </AuthProvider>
  </ThemeProvider>
);
