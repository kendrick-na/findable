"use server";

import { database } from "@repo/database";
import { log } from "@repo/observability/log";
import { revalidatePath } from "next/cache";
import { scopedBrandById } from "@/lib/db/scoped";

/**
 * 브랜드 프로필(별칭·경쟁사) 저장 — 온보딩 `/welcome` 2·4단계가 쓴다.
 *
 * 🔴 **왜 이 액션이 생겼나**(N-44 실측): `Brand.entityVariants` 와 `Brand.competitors` 는
 *   스키마에 있는데 **쓰는 코드가 0곳**이었다. 특히 경쟁사는 AI 가 이미 뽑아서
 *   `prompt-wizard.tsx` 가 **배지로 보여주고 그대로 버리고** 있었다.
 *   → 👤 2026-08-19 승인 ⓐ: 저장하고 **읽는 코드까지** 만든다.
 *
 * 🔴🔴 **두 필드를 한 액션에 둔 이유** — 같은 모델의 같은 성격(표기 사전)이고,
 *   나누면 두 경로가 서로 다른 정규화·상한을 갖게 된다. 이 저장소는 도메인 정규식이
 *   **세 번 복제**돼 갈라진 사고를 이미 겪었다(`assign.ts` 주석).
 *   ⚠️ 그래서 정규화(`cleanList`)는 **여기 하나**만 둔다.
 *
 * 🔒 org 스코프: `scopedBrandById` 로 **현재 org 소속 brand 인지 먼저 검증**한다.
 *   남의 org brand id 를 폼으로 찔러도 통과하지 않는다(`assign.ts` 3-A 와 같은 불변식).
 *
 * ⚠️ 빈 배열은 **유효한 값**이다(= "별칭 없음"). 건너뛰기가 그 경로를 쓴다.
 *   `undefined`(= 안 보냄)와 구분해서, 보낸 필드만 덮어쓴다.
 */

/** 한 브랜드가 가질 수 있는 최대 항목 수. 무한 입력으로 Json 컬럼이 붓는 것을 막는다. */
const MAX_ITEMS = 20;
/** 항목 하나의 최대 길이. 브랜드명·별칭은 짧다 — 문장이 들어오면 입력 실수다. */
const MAX_LEN = 60;

/** DB `MarketScope` enum. 유효값이 아니면 저장하지 않는다(= 자동 추정 유지). */
const MARKET_SCOPE_VALUES = ["korea", "global", "both"] as const;
type MarketScopeValue = (typeof MARKET_SCOPE_VALUES)[number];

const toMarketScope = (value?: string): MarketScopeValue | null => {
  const v = value?.trim().toLowerCase();
  return v && (MARKET_SCOPE_VALUES as readonly string[]).includes(v)
    ? (v as MarketScopeValue)
    : null;
};

export interface UpdateBrandProfileInput {
  brandId: string;
  /** 사용자가 확정한 경쟁사명. 안 보내면 무변경. */
  competitors?: string[];
  /** 내 브랜드 표기 변형. 예: ["아모레", "Amorepacific"]. 안 보내면 무변경. */
  entityVariants?: string[];
  /**
   * 👤 고객이 확정한 타깃 시장. 안 보내면 무변경(= 자동 추정 유지).
   *
   * 🔴🔴 **이 값은 측정 엔진을 줄이지 않는다**(N-44 · 👤 *"챗지피티 빼면 안되지"*).
   *   실측: 엔진 선택(`runner.ts` `enginesForLang`)은 **프롬프트 언어만** 본다.
   *   `marketScope` 는 ① 처방 채널 문구(`communityChannelHint`) ② 결과 저장에만 쓰인다.
   *   시장 분해(`buildRegionBreakdown`)도 **응답에서 직접** 권역을 나눈다 — 이 값과 무관.
   *   ⚠️ 그래서 「국내 중심」을 골라도 ChatGPT·클로드·퍼플렉시티가 분모에서 빠지지 않는다.
   *   그 불변식은 `brand-assign-detected-scope.test.ts` 의 「엔진 분모 불변」이 문다.
   */
  marketScope?: string;
}

export type UpdateBrandProfileResult = { ok: true } | { error: string };

/**
 * 목록 정규화 — 공백 제거 · 빈값 제거 · 길이 제한 · **중복 제거**(대소문자·공백 무시).
 *
 * ⚠️ 중복 제거를 여기서 하는 이유: 같은 별칭이 두 번 들어가면 집계에서 같은 브랜드를
 *   두 번 세게 된다(`competitor-extract` 는 키로 합치지만, 화면은 두 줄로 보인다).
 */
const cleanList = (values: string[]): string[] => {
  const seen = new Set<string>();
  const out: string[] = [];
  for (const raw of values) {
    const v = raw.trim().slice(0, MAX_LEN);
    if (!v) {
      continue;
    }
    // 표시값은 원문 그대로 두되, 중복 판정만 정규화된 키로 한다.
    const key = v.toLowerCase().replaceAll(/\s+/g, "");
    if (seen.has(key)) {
      continue;
    }
    seen.add(key);
    out.push(v);
    if (out.length >= MAX_ITEMS) {
      break;
    }
  }
  return out;
};

export const updateBrandProfile = async (
  input: UpdateBrandProfileInput
): Promise<UpdateBrandProfileResult> => {
  // 🔒 현재 org 소속인지 먼저 본다. 아니면 존재 여부를 흘리지 않는 동일 메시지.
  const owned = await scopedBrandById(input.brandId).catch(() => null);
  if (!owned) {
    return { error: "해당 브랜드에 접근할 수 없습니다." };
  }

  // 보낸 필드만 덮어쓴다 — 2단계만 하고 4단계를 건너뛴 사용자의 값을 지우지 않는다.
  const data: {
    competitors?: string[];
    entityVariants?: string[];
    marketScope?: MarketScopeValue;
  } = {};
  if (input.entityVariants) {
    data.entityVariants = cleanList(input.entityVariants);
  }
  if (input.competitors) {
    data.competitors = cleanList(input.competitors);
  }
  // 유효 enum 일 때만 저장한다 — 아니면 건드리지 않아 자동 추정이 그대로 산다.
  const scope = toMarketScope(input.marketScope);
  if (scope) {
    data.marketScope = scope;
  }
  if (Object.keys(data).length === 0) {
    // 보낼 게 없으면 DB 를 건드리지 않는다(건너뛰기 = 성공).
    return { ok: true };
  }

  try {
    await database.brand.update({ where: { id: owned.id }, data });
    revalidatePath("/brand");
    revalidatePath("/");
    return { ok: true };
  } catch (error) {
    log.error(
      `[brand/update-profile] failed for brand ${owned.id}: ${
        error instanceof Error ? error.message : "unknown"
      }`
    );
    return { error: "저장 중 문제가 발생했습니다." };
  }
};
