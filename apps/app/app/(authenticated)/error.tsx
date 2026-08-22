"use client";

import { Button } from "@repo/design-system/components/ui/button";
import Link from "next/link";

/**
 * (authenticated) 그룹 에러 경계 (2026-07-30 플로우 감사 🔴2 해소).
 * 예전엔 global-error("Oops, something went wrong", 영문·복귀 불가)만 있어
 * requireOrg() throw 같은 서버 에러가 막다른 길이었다. 한국어 + 복귀 경로 제공.
 * (서버 측 에러 로그는 observability가 수집 — 여기선 표면만 담당.)
 */
const AuthenticatedError = ({ reset }: { reset: () => void }) => (
  <div className="flex min-h-svh flex-col items-center justify-center gap-6 px-6 text-center">
    <div className="flex max-w-md flex-col gap-2">
      <h1 className="font-semibold text-[color:var(--findable-ink,#f7f8f8)] text-xl">
        문제가 발생했어요
      </h1>
      <p className="text-[color:var(--findable-ink-subtle,#8a8f98)] text-sm leading-relaxed">
        일시적인 오류일 수 있어요. 다시 시도하거나 대시보드로 돌아가 주세요.
        계속되면 문의로 알려주세요. 바로 확인할게요.
      </p>
    </div>
    <div className="flex gap-3">
      <Button onClick={reset} type="button" variant="outline">
        다시 시도
      </Button>
      <Button asChild className="findable-btn-primary">
        <Link href="/">대시보드로</Link>
      </Button>
    </div>
  </div>
);

export default AuthenticatedError;
