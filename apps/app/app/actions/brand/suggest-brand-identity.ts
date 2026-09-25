"use server";

import { lookupStaticBrandName } from "@repo/ai/lib/brand-identity";
import { resolveIndustryProfile } from "@repo/ai/lib/industry-profile";

export interface SuggestedBrandIdentity {
  industry: string | null;
  name: string | null;
}

/** 확실한 정적 사전 항목만 제안한다. 모르는 사이트의 업종은 사용자 선택으로 남긴다. */
export const suggestBrandIdentity = async (
  domain: string
): Promise<SuggestedBrandIdentity> => {
  const name = lookupStaticBrandName(domain);
  if (!name) {
    return { name: null, industry: null };
  }

  try {
    const profile = await resolveIndustryProfile(domain, undefined, name);
    return {
      name,
      industry:
        profile.confidence === "dictionary" && profile.industry !== "other"
          ? profile.industry
          : null,
    };
  } catch {
    return { name, industry: null };
  }
};
