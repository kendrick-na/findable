/**
 * 세부 분야(sub-industry) — 순수 함수만. Industry enum(11종)은 그대로 두고, 그 아래·옆을 태그로 더 나눈다.
 *
 * 왜(2026-10-07 대표 요청): 11종만으로는 「핀테크·모빌리티·프롭테크」처럼 영업 대상을 고르는 단위가 없고,
 *   부동산·운송·숙박처럼 other 로 떨어지는 회사가 많았다.
 *
 * 분류 이름 참고(2026-10-07 공식 페이지 직접 확인, 분류 이름만 — 회사 데이터는 수집하지 않음):
 *   - 넥스트유니콘 https://www.nextunicorn.kr/finder 「테마」 목록 [확인사실]
 *     (핀테크·프롭테크·모빌리티·에듀테크·푸드테크·농업테크·펫테크·HR테크·애드테크·트래블테크·
 *      디지털헬스케어·바이오테크·게임·이차전지·탄소중립·웨이스트테크·SaaS·생성 AI 등)
 *   - 혁신의숲: 분류 목록이 로그인·스크립트 화면이라 열람 불가 [확인필요]
 *   - THE VC: 서버가 403(봇 차단) — 우회하지 않음 [확인필요]
 *
 * 로봇 분야는 KSIC 코드로는 가르지 않는다(기계 제조 전체가 로봇이 아니다) — 낱말로만.
 * 규칙은 **[AI가설]** 이다(KSIC 코드 접두사·업종명·취급품목 낱말 → 분야). 원천 업종이 실제 사업과 다를 수 있어
 *   화면에 근거(ksic / name / products)를 같이 보여 준다. 저장은 Company.tags 의 `sub:<id>` 태그 +
 *   CompanyFact field "subIndustry"(근거 포함) — 스키마·migration 변경 없음.
 */

export const SUB_INDUSTRIES = [
  "ai_data",
  "saas",
  "fintech",
  "commerce_platform",
  "mobility",
  "logistics",
  "proptech",
  "edtech",
  "foodtech",
  "agritech",
  "biohealth",
  "game",
  "media_content",
  "travel_leisure",
  "energy_climate",
  "semiconductor",
  "robotics",
  "pet",
  "hr",
  "adtech",
  "environment",
] as const;

export type SubIndustryId = (typeof SUB_INDUSTRIES)[number];
export type SubIndustryBasis = "ksic" | "name" | "products";

export const SUB_TAG_PREFIX = "sub:";

export function subTag(id: SubIndustryId): string {
  return `${SUB_TAG_PREFIX}${id}`;
}

/** KSIC 접두사 → 세부 분야. 긴 접두사부터 본다(하나의 코드가 여러 분야에 걸릴 수 있다). */
const KSIC_SUB_RULES: [prefix: string, sub: SubIndustryId][] = [
  ["01", "agritech"], // 농업
  ["02", "agritech"], // 임업
  ["03", "agritech"], // 어업
  ["10", "foodtech"], // 식료품 제조
  ["11", "foodtech"], // 음료 제조
  ["56", "foodtech"], // 음식점·주점
  ["21", "biohealth"], // 의약품 제조
  ["271", "biohealth"], // 의료용 기기 제조
  ["86", "biohealth"], // 보건업
  ["261", "semiconductor"], // 반도체 제조
  ["262", "semiconductor"], // 전자부품 제조
  ["30", "mobility"], // 자동차·트레일러 제조
  ["45", "mobility"], // 자동차·부품 판매
  ["49", "mobility"], // 육상 운송
  ["493", "logistics"], // 도로 화물 운송(49 아래, 긴 접두사)
  ["52", "logistics"], // 창고·운송 관련 서비스
  ["35", "energy_climate"], // 전기·가스·증기
  ["37", "environment"], // 하수·폐수
  ["38", "environment"], // 폐기물 수집·처리, 원료 재생
  ["39", "environment"], // 환경 정화·복원
  ["41", "proptech"], // 종합 건설
  ["42", "proptech"], // 전문직별 공사
  ["68", "proptech"], // 부동산
  ["4791", "commerce_platform"], // 무점포 소매(통신판매)
  ["5821", "game"], // 게임 소프트웨어
  ["5822", "saas"], // 응용 소프트웨어
  ["62", "saas"], // 프로그래밍·시스템 통합
  ["631", "ai_data"], // 자료 처리·호스팅·포털
  ["59", "media_content"], // 영상·오디오
  ["60", "media_content"], // 방송
  ["64", "fintech"], // 금융업
  ["65", "fintech"], // 보험·연금
  ["66", "fintech"], // 금융 서비스 관련
  ["713", "adtech"], // 광고업
  ["751", "hr"], // 인력 공급·고용 알선
  ["752", "travel_leisure"], // 여행사
  ["55", "travel_leisure"], // 숙박
  ["91", "travel_leisure"], // 스포츠·오락
  ["85", "edtech"], // 교육 서비스
];

const KSIC_SUB_SORTED = [...KSIC_SUB_RULES].sort(
  (a, b) => b[0].length - a[0].length
);

/** 업종명·취급품목 낱말 → 세부 분야(여러 개 가능). */
const NAME_SUB_RULES: [RegExp, SubIndustryId][] = [
  [
    /인공지능|머신러닝|딥러닝|빅데이터|데이터\s*(?:분석|처리|베이스)|\bAI\b/i,
    "ai_data",
  ],
  [/소프트웨어|S\/W|SaaS|클라우드|시스템\s*통합|프로그래밍|솔루션/i, "saas"],
  [
    /핀테크|전자\s*금융|결제|송금|금융|보험|증권|자산운용|투자자문|대부/,
    "fintech",
  ],
  [
    /전자상거래|통신\s*판매|쇼핑몰|온라인\s*(?:쇼핑|판매|마켓)|오픈\s*마켓|무점포|커머스|마켓\s*플레이스/,
    "commerce_platform",
  ],
  [
    /자동차|운송|택시|버스|전기차|자율주행|모빌리티|렌터카|렌트카|이륜차|퀵서비스/,
    "mobility",
  ],
  [/물류|택배|배송|창고|화물|콜드체인|포워딩|운송\s*주선|보관/, "logistics"],
  [
    /부동산|건물\s*임대|주거용|분양|건설|건축|공사업|인테리어|토목|주택/,
    "proptech",
  ],
  [/교육|학원|교습|강의|훈련|어학|코딩|에듀/, "edtech"],
  [
    /식품|식료|음료|음식|외식|급식|제과|제빵|커피|주류|밀키트|배달\s*음식/,
    "foodtech",
  ],
  [
    /농업|농산|축산|수산|양식|원예|스마트\s*팜|임업|어업|종자|비료|재배|작물|양돈|양계|낙농/,
    "agritech",
  ],
  [
    /의약|제약|바이오|의료|병원|의원|진단|헬스케어|건강기능식품|치과|한의/,
    "biohealth",
  ],
  [/게임/, "game"],
  [
    /영상|방송|출판|음악|음반|공연|엔터|애니메이션|웹툰|콘텐츠|컨텐츠|캐릭터|영화/,
    "media_content",
  ],
  [
    /여행|관광|숙박|호텔|펜션|레저|캠핑|골프|스포츠|체육|체력\s*단련|피트니스|오락|테마파크/,
    "travel_leisure",
  ],
  [
    /태양광|태양력|에너지|전력|전기\s*판매|발전업|발전소|탄소|수소|이차전지|축전지|배터리|풍력|연료전지/,
    "energy_climate",
  ],
  [/반도체|전자\s*부품|디스플레이|인쇄회로|PCB/i, "semiconductor"],
  [/로봇|자동화|드론|무인/, "robotics"],
  [/반려|애완|펫|동물\s*병원|수의/, "pet"],
  [/인력\s*(?:공급|파견)|채용|헤드헌팅|고용\s*알선|HR/, "hr"],
  [/광고|(?<!텔레)마케팅|홍보|애드테크/, "adtech"],
  [
    /폐기물|재활용|재생\s*원료|환경\s*(?:정화|복원|컨설팅)|업사이클|하수|폐수/,
    "environment",
  ],
];

const NON_DIGIT_RE = /\D/g;

export interface SubIndustryVerdict {
  basis: SubIndustryBasis;
  id: SubIndustryId;
}

function fromKsic(code: string | null | undefined): SubIndustryId[] {
  const digits = (code ?? "").replaceAll(NON_DIGIT_RE, "");
  if (digits.length < 2) {
    return [];
  }
  // 가장 긴 접두사 하나만 — 「49 육상 운송」과 「492 화물」이 같이 붙지 않게.
  const hit = KSIC_SUB_SORTED.find(([prefix]) => digits.startsWith(prefix));
  return hit ? [hit[1]] : [];
}

function fromText(text: string | null | undefined): SubIndustryId[] {
  const t = (text ?? "").trim();
  if (!t) {
    return [];
  }
  return NAME_SUB_RULES.filter(([re]) => re.test(t)).map(([, id]) => id);
}

/**
 * KSIC 코드 → 업종명 → 취급품목 순서로 모두 본다. 같은 분야는 더 강한 근거(앞쪽) 하나만 남긴다.
 * 결과는 SUB_INDUSTRIES 순서로 정렬(멱등 비교가 쉽게).
 */
export function classifySubIndustries(input: {
  industryCode?: string | null;
  industryName?: string | null;
  products?: string | null;
}): SubIndustryVerdict[] {
  const found = new Map<SubIndustryId, SubIndustryBasis>();
  const add = (ids: SubIndustryId[], basis: SubIndustryBasis) => {
    for (const id of ids) {
      if (!found.has(id)) {
        found.set(id, basis);
      }
    }
  };
  add(fromKsic(input.industryCode), "ksic");
  add(fromText(input.industryName), "name");
  add(fromText(input.products), "products");
  return SUB_INDUSTRIES.filter((id) => found.has(id)).map((id) => ({
    basis: found.get(id) as SubIndustryBasis,
    id,
  }));
}

/** 태그 목록에서 세부 분야만 꺼낸다. */
export function subIndustriesFromTags(
  tags: readonly string[]
): SubIndustryId[] {
  const set = new Set(tags);
  return SUB_INDUSTRIES.filter((id) => set.has(subTag(id)));
}
