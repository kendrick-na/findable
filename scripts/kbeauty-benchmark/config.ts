import type { EngineId } from "../../packages/ai/lib/engines";

export interface BenchmarkBrand {
  domains: string[];
  id: string;
  name: string;
  variants: string[];
}

export interface BenchmarkPrompt {
  id: string;
  intent: "category" | "comparison" | "gift" | "problem" | "product";
  text: string;
}

export const BENCHMARK_VERSION = "2026-08-22-pilot-v1";

export const DEFAULT_ENGINES: EngineId[] = ["chatgpt", "perplexity", "gemini"];

// 시장점유율 순위가 아니라, 국내외에서 유통되는 K-뷰티 브랜드를 가격대·기업·주력
// 카테고리가 겹치지 않도록 구성한 목적표본이다. 보고서에서 대표표본으로 과장하지 않는다.
export const BRANDS: BenchmarkBrand[] = [
  {
    id: "sulwhasoo",
    name: "설화수",
    variants: ["설화수", "Sulwhasoo"],
    domains: ["sulwhasoo.com"],
  },
  {
    id: "laneige",
    name: "라네즈",
    variants: ["라네즈", "Laneige"],
    domains: ["laneige.com"],
  },
  {
    id: "innisfree",
    name: "이니스프리",
    variants: ["이니스프리", "Innisfree"],
    domains: ["innisfree.com"],
  },
  {
    id: "cosrx",
    name: "코스알엑스",
    variants: ["코스알엑스", "COSRX", "Cosrx"],
    domains: ["cosrx.com"],
  },
  {
    id: "beauty-of-joseon",
    name: "조선미녀",
    variants: ["조선미녀", "Beauty of Joseon"],
    domains: ["beautyofjoseon.com"],
  },
  {
    id: "round-lab",
    name: "라운드랩",
    variants: ["라운드랩", "Round Lab", "ROUND LAB"],
    domains: ["roundlab.com"],
  },
  {
    id: "anua",
    name: "아누아",
    variants: ["아누아", "Anua"],
    domains: ["anua.kr", "anua.com"],
  },
  {
    id: "medicube",
    name: "메디큐브",
    variants: ["메디큐브", "Medicube"],
    domains: ["medicube.us", "themedicube.co.kr"],
  },
  {
    id: "torriden",
    name: "토리든",
    variants: ["토리든", "Torriden"],
    domains: ["torriden.com"],
  },
  {
    id: "dr-jart",
    name: "닥터자르트",
    variants: ["닥터자르트", "Dr. Jart", "Dr.Jart", "Dr Jart"],
    domains: ["drjart.com"],
  },
  {
    id: "aestura",
    name: "에스트라",
    variants: ["에스트라", "AESTURA", "Aestura"],
    domains: ["aestura.com"],
  },
  {
    id: "dalba",
    name: "달바",
    variants: ["달바", "d'Alba", "d’alba", "Dalba"],
    domains: ["dalba.com", "dalba.co.kr"],
  },
  {
    id: "dr-g",
    name: "닥터지",
    variants: ["닥터지", "Dr.G", "Dr. G", "Dr G"],
    domains: ["dr-g.co.kr", "dr-g.com"],
  },
  {
    id: "skin1004",
    name: "스킨1004",
    variants: ["스킨1004", "SKIN1004", "Skin1004"],
    domains: ["skin1004.com"],
  },
  {
    id: "manyo",
    name: "마녀공장",
    variants: ["마녀공장", "ma:nyo", "Manyo", "MANYO"],
    domains: ["manyo.co.kr", "manyo.us"],
  },
  {
    id: "beplain",
    name: "비플레인",
    variants: ["비플레인", "beplain", "be plain"],
    domains: ["beplain.co.kr"],
  },
  {
    id: "purito",
    name: "퓨리토",
    variants: ["퓨리토", "PURITO", "Purito"],
    domains: ["purito.com"],
  },
  {
    id: "belif",
    name: "빌리프",
    variants: ["빌리프", "belif"],
    domains: ["belifcosmetic.com"],
  },
  {
    id: "missha",
    name: "미샤",
    variants: ["미샤", "MISSHA", "Missha"],
    domains: ["missha.com", "misshaus.com"],
  },
  {
    id: "klairs",
    name: "디어, 클레어스",
    variants: [
      "디어, 클레어스",
      "디어 클레어스",
      "클레어스",
      "Dear, Klairs",
      "Dear Klairs",
      "Klairs",
    ],
    domains: ["klairscosmetics.com"],
  },
];

export const PROMPTS: BenchmarkPrompt[] = [
  {
    id: "category-kbeauty",
    intent: "category",
    text: "요즘 신뢰할 만한 한국 스킨케어 브랜드 5곳을 추천해줘. 각 브랜드를 추천하는 이유와 대표 제품도 알려줘.",
  },
  {
    id: "problem-sensitive",
    intent: "problem",
    text: "민감성 피부가 쓰기 좋은 한국 스킨케어 브랜드와 제품을 추천해줘. 자극 가능성과 선택 기준도 설명해줘.",
  },
  {
    id: "problem-barrier",
    intent: "problem",
    text: "피부 장벽이 무너졌을 때 고려할 만한 한국 스킨케어 브랜드와 보습 제품을 추천해줘.",
  },
  {
    id: "problem-acne",
    intent: "problem",
    text: "여드름성 피부를 위한 한국 스킨케어 브랜드와 제품을 추천해줘. 성분과 사용 시 주의점도 알려줘.",
  },
  {
    id: "product-sunscreen",
    intent: "product",
    text: "백탁이 적고 데일리로 쓰기 좋은 한국 선크림 5개를 브랜드와 함께 추천해줘.",
  },
  {
    id: "product-serum",
    intent: "product",
    text: "수분 부족형 피부에 잘 맞는 한국 세럼이나 앰플 5개를 브랜드와 함께 추천해줘.",
  },
  {
    id: "product-antiaging",
    intent: "product",
    text: "30대 이후 탄력과 안티에이징 관리를 위한 한국 화장품 브랜드와 대표 제품을 추천해줘.",
  },
  {
    id: "comparison-global",
    intent: "comparison",
    text: "해외에서도 평가가 좋은 K-뷰티 스킨케어 브랜드를 비교해줘. 브랜드별 강점과 잘 맞는 피부 타입을 알려줘.",
  },
  {
    id: "comparison-ingredient",
    intent: "comparison",
    text: "성분과 효능을 근거로 한국 스킨케어 브랜드를 비교한다면 어떤 브랜드를 우선 살펴봐야 해? 이유도 설명해줘.",
  },
  {
    id: "gift-premium",
    intent: "gift",
    text: "부모님께 선물하기 좋은 프리미엄 한국 스킨케어 브랜드와 세트를 추천해줘.",
  },
  {
    id: "product-cleanser",
    intent: "product",
    text: "건조하거나 민감한 피부가 아침저녁으로 쓰기 좋은 한국 클렌저 5개를 추천해줘.",
  },
  {
    id: "comparison-beginner",
    intent: "comparison",
    text: "K-뷰티 스킨케어를 처음 시작하는 사람이 루틴을 구성하기 좋은 브랜드를 비교해서 추천해줘.",
  },
];
