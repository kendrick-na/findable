"use client";

import { safeExternalUrl } from "@/lib/ax-mail/discovery/view";

/**
 * 홈페이지·도메인·출처 페이지 링크 — 누르면 새 탭으로 바로 열린다.
 * http/https 로 정규화하고, 그 밖의 스킴(javascript: 등)·이상한 값은 링크 없이 글자만 보여 준다.
 * 표 행 클릭(카드 열기)과 겹치지 않게 클릭 전파를 막는다.
 */
export function ExternalLink({
  children,
  className = "underline-offset-2 hover:underline",
  href,
}: {
  children: React.ReactNode;
  className?: string;
  href: string | null | undefined;
}) {
  const url = safeExternalUrl(href);
  if (!url) {
    return <span>{children}</span>;
  }
  return (
    <a
      className={className}
      href={url}
      onClick={(event) => event.stopPropagation()}
      rel="noopener noreferrer"
      target="_blank"
    >
      {children}
    </a>
  );
}
