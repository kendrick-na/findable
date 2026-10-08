import type { AppLocale } from "./i18n";

/**
 * 공개 리포트(`apps/web` `/[locale]/audit/[jobId]`) 주소 — 고객 화면 링크의 **단일 출처**.
 *
 * 🔴 왜(2026-10-06): 대시보드·브랜드·기록 화면이 각자 `${webUrl}/ko/audit/${id}` 를 박아
 *   영어 사용자도 한국어 리포트로 보냈다.
 * 📐 웹은 기본 로케일(en)에 접두사를 붙이지 않는다(`urlMappingStrategy: "rewriteDefault"`).
 *   → ko 는 `/ko/audit/…`(기존과 동일), en 은 `/audit/…`.
 * ⚠️ 운영자 화면(admin)은 한국어 고정이라 이 함수를 쓰지 않는다.
 */
export const publicReportUrl = (
  webUrl: string,
  jobId: string,
  locale: AppLocale
): string => `${webUrl}${locale === "ko" ? "/ko" : ""}/audit/${jobId}`;
