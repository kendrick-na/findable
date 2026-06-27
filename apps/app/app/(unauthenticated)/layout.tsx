import { ModeToggle } from "@repo/design-system/components/mode-toggle";
import { SparklesIcon } from "lucide-react";
import type { ReactNode } from "react";

interface AuthLayoutProps {
  readonly children: ReactNode;
}

const AuthLayout = ({ children }: AuthLayoutProps) => (
  <div className="container relative grid h-dvh flex-col items-center justify-center lg:max-w-none lg:grid-cols-2 lg:px-0">
    <div className="relative hidden h-full flex-col bg-muted p-10 text-white lg:flex dark:border-r">
      <div className="absolute inset-0 bg-muted" />
      <div className="relative z-20 flex items-center font-medium text-lg text-primary">
        <SparklesIcon className="mr-2 h-6 w-6" />
        Findable
      </div>
      <div className="absolute top-4 right-4">
        <ModeToggle />
      </div>
      <div className="relative z-20 mt-auto text-primary">
        <blockquote className="space-y-2">
          <p className="text-lg">
            &ldquo;AI는 우리 브랜드를 추천하고 있나요?&rdquo;
          </p>
          <p className="text-sm text-primary/80">
            ChatGPT · HyperCLOVA · Perplexity · 네이버 · Claude · 다음 ·
            Gemini — 한국어·영어 7개 AI 답변에서 우리 브랜드의 위치를
            추적합니다.
          </p>
          <footer className="pt-2 text-sm">
            한국 최초 Agentic GEO Platform
          </footer>
        </blockquote>
      </div>
    </div>
    <div className="lg:p-8">
      <div className="mx-auto flex w-full max-w-[400px] flex-col justify-center space-y-6">
        {children}
      </div>
    </div>
  </div>
);

export default AuthLayout;
