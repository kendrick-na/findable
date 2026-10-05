"use client";

import { Button } from "@repo/design-system/components/ui/button";
import enDict from "@repo/internationalization/dictionaries/en.json";
import koDict from "@repo/internationalization/dictionaries/ko.json";
import Link from "next/link";
import { useEffect, useState } from "react";

/**
 * (authenticated) 그룹 에러 경계 (2026-07-30 플로우 감사 🔴2 해소).
 * 예전엔 global-error("Oops, something went wrong", 영문·복귀 불가)만 있어
 * requireOrg() throw 같은 서버 에러가 막다른 길이었다. 한국어 + 복귀 경로 제공.
 * (서버 측 에러 로그는 observability가 수집 — 여기선 표면만 담당.)
 *
 * 🔴 2026-10-06 — 에러 경계는 클라이언트 전용이라 `getAppDictionary`(server-only)를 못 부르고
 *   props 도 못 받는다. → 루트 레이아웃이 심은 `<html lang>` 을 읽어 사전을 고른다.
 *   첫 렌더는 한국어(기본 로케일)라 서버·클라이언트 렌더가 어긋나지 않는다.
 */
const AuthenticatedError = ({ reset }: { reset: () => void }) => {
  const [lang, setLang] = useState("ko");
  useEffect(() => {
    setLang(document.documentElement.lang);
  }, []);
  const t = (lang === "en" ? enDict : koDict).app.errorBoundary;

  return (
    <div className="flex min-h-svh flex-col items-center justify-center gap-6 px-6 text-center">
      <div className="flex max-w-md flex-col gap-2">
        <h1 className="font-semibold text-[color:var(--findable-ink,#f7f8f8)] text-xl">
          {t.title}
        </h1>
        <p className="text-[color:var(--findable-ink-subtle,#8a8f98)] text-sm leading-relaxed">
          {t.body}
        </p>
      </div>
      <div className="flex gap-3">
        <Button onClick={reset} type="button" variant="outline">
          {t.retry}
        </Button>
        <Button asChild className="findable-btn-primary">
          <Link href="/">{t.toDashboard}</Link>
        </Button>
      </div>
    </div>
  );
};

export default AuthenticatedError;
