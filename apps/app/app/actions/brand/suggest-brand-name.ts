"use server";

import { lookupStaticBrandName } from "@repo/ai/lib/brand-identity";

/**
 * 도메인 → 정적 사전 매칭만(원가 0 · LLM 호출 없음). 2026-08-21(10번).
 *
 * 온보딩 1단계에서 도메인을 입력하는 순간 이름 칸을 자동으로 채우기 위함
 * (Scrunch의 "Confirm your details" 패턴 — 값을 미리 채워 확인만 하게 함,
 * 경쟁사 실측 근거: `docs/_경쟁사_UIUX/Scrunch/_frames/f009.png`).
 *
 * ⚠️ 사전에 없으면 null — 그때는 사용자가 직접 입력한다(👤 결정으로 LLM
 *   자동추정은 이번 범위에 넣지 않음. 필요해지면 별도 검토).
 */
export const suggestBrandName = async (
  domain: string
): Promise<string | null> => lookupStaticBrandName(domain);
