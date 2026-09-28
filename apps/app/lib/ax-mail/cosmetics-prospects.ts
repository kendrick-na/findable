/**
 * 2026-09-25 공식 사이트에서 확인한 화장품 영업 후보.
 * 연락처는 개인 주소를 추정하지 않고 브랜드가 공개한 조직용 창구만 담는다.
 * 아래의 opportunity는 Findable 제안 가설이며 실제 AI 노출 진단 결과가 아니다.
 */
export interface CosmeticsProspect {
  brand: string;
  company: string;
  contactEmail: string;
  contactRole: string;
  contactSource: string;
  fact: string;
  factSource: string;
  id: string;
  market: "domestic" | "global";
  opportunity: string;
  parentGroup?: string;
  question: string;
  website: string;
}

export const COSMETICS_PROSPECTS: readonly CosmeticsProspect[] = [
  {
    id: "torriden",
    brand: "토리든",
    company: "(주)토리든",
    contactEmail: "mkt@torriden.com",
    contactRole: "공식 국내마케팅 문의",
    contactSource: "https://www.torriden.com/",
    website: "https://www.torriden.com/",
    fact: "다이브인 저분자 히알루론산 세럼을 공식몰 대표 라인으로 소개합니다.",
    factSource: "https://www.torriden.com/goods/goods_list.php?cateCd=002",
    opportunity:
      "성분·수분 고민 질문에서 공식 제품 설명이 AI 답변의 출처로 잡히는지 확인할 가치가 있습니다.",
    question: "수분 부족 피부에 맞는 한국 히알루론산 세럼은?",
    market: "domestic",
  },
  {
    id: "isntree",
    brand: "이즈앤트리",
    company: "(주)이즈앤트리",
    contactEmail: "global_marketing@isntree.com",
    contactRole: "공식 해외마케팅 제안·제휴",
    contactSource: "https://isntree.com/",
    website: "https://isntree.com/",
    fact: "공식몰에서 히아루론산 워터리 선 젤을 판매하고 해외마케팅 제안 창구를 별도로 안내합니다.",
    factSource:
      "https://isntree.com/product/%ED%9E%88%EC%95%84%EB%A3%A8%EB%A1%A0%EC%82%B0-%EC%9B%8C%ED%84%B0%EB%A6%AC-%EC%84%A0-%EC%A0%A4-50ml/145/category/103/display/1/",
    opportunity:
      "해외 소비자의 보습·선케어 비교 질문에서 한국어/영어 공식 정보가 어떻게 인용되는지 살펴볼 수 있습니다.",
    question: "hydrating Korean sunscreen for dry skin",
    market: "global",
  },
  {
    id: "numbuzin",
    brand: "넘버즈인",
    company: "비나우(Benow)",
    contactEmail: "marketing@benow.co.kr",
    contactRole: "공식 Marketing & PR 문의",
    contactSource: "https://us.numbuzin.com/pages/help-faqs",
    website: "https://us.numbuzin.com/",
    fact: "미국 공식몰이 피부 고민별 번호 체계를 운영하고 No.5+ 글루타치온 비타민 세럼을 소개합니다.",
    factSource: "https://us.numbuzin.com/",
    opportunity:
      "번호별 피부 고민 체계가 AI의 추천·비교 답변에서 정확히 연결되는지 측정하기 좋습니다.",
    question: "K-beauty serum for dark spots and hyperpigmentation",
    market: "global",
  },
  {
    id: "purito",
    brand: "퓨리토 서울",
    company: "하이네이처(주)",
    contactEmail: "partnerships@purito.co.kr",
    contactRole: "공식 협업·파트너십 문의",
    contactSource: "https://purito.com/ko/help/contact-us/",
    website: "https://purito.com/",
    fact: "공식 사이트에서 밤부 판테놀 크림 등 피부 장벽 중심 제품을 소개합니다.",
    factSource: "https://purito.com/",
    opportunity:
      "민감 피부·장벽 케어 관련 질문에 공식 제품 정보가 어떻게 설명·인용되는지 확인할 수 있습니다.",
    question: "sensitive skin barrier Korean moisturizer",
    market: "global",
  },
  {
    id: "abib",
    brand: "아비브",
    company: "(주)포컴퍼니",
    contactEmail: "abib@fourco.co.kr",
    contactRole: "공식 대표 이메일 — 마케팅 담당자 확인 필요",
    contactSource: "https://abib.co.kr/shopinfo/contact.html",
    website: "https://abib.co.kr/",
    fact: "공식 사이트가 어성초 카밍 토너·패드·세럼 라인을 소개합니다.",
    factSource: "https://abib.co.kr/product/heartleaf.html",
    opportunity:
      "어성초·진정 케어 질문에서 제품군별 공식 설명이 일관되게 연결되는지 볼 수 있습니다.",
    question: "어성초 성분 진정 토너와 패드 차이는?",
    market: "domestic",
  },
  {
    id: "roundlab",
    brand: "라운드랩",
    company: "서린컴퍼니(주)",
    parentGroup: "구다이글로벌 계열 — 조선미녀·스킨1004와 계열 중복 접촉 주의",
    contactEmail: "sales@roundlab.co.kr",
    contactRole: "공식 영업·제안 문의",
    contactSource: "https://www.roundlab.co.kr/shopinfo/company.html",
    website: "https://www.roundlab.co.kr/",
    fact: "공식몰이 1025 독도 토너와 자작나무 수분 선크림을 주요 제품으로 소개합니다.",
    factSource: "https://www.roundlab.co.kr/",
    opportunity:
      "지역 원료와 선케어 관련 국내·해외 질문에서 브랜드 공식 출처 노출을 함께 비교할 수 있습니다.",
    question: "Korean birch sunscreen for daily use",
    market: "global",
  },
] as const;

export const COSMETICS_OWNERSHIP_SOURCE =
  "https://www.goodai-global.com/ko/company/history";

export function prospectDraft(prospect: CosmeticsProspect): {
  recipient: string;
  subject: string;
  body: string;
} {
  return {
    recipient: prospect.contactEmail,
    subject: `[파인더블] ${prospect.brand} AI 검색 노출 샘플 진단 제안`,
    body: `안녕하세요, ${prospect.brand} 담당자님.\n\n파인더블을 만드는 팀입니다. 공식 사이트에서 ${prospect.fact}\n\n저희는 ChatGPT 등 AI 검색에서 “${prospect.question}” 같은 질문에 브랜드가 어떻게 언급되고 어떤 공식 페이지가 인용되는지 측정합니다. ${prospect.opportunity}\n\n아직 ${prospect.brand}의 실제 노출을 진단한 것은 아니므로, 현재 성과나 문제를 단정하지 않습니다. 관심 있으시면 측정할 질문과 결과 예시를 먼저 간단히 공유드리고 싶습니다. 관련 마케팅·디지털 담당자께 전달해 주실 수 있을까요?\n\n감사합니다.\n파인더블 팀`,
  };
}
