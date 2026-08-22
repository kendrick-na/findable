// 메디큐브 GEO Assurance 데모 — 정답표 (Ground Truth)
//
// ⚠️ 정직성: 아래 항목은 2026-07 웹 공개 정보(공식몰·나무위키·화해·글로우픽)에서 확인한 사실만 사용.
// 확인 불가/변동 가능 항목(현재 정확한 가격 등)은 정답표에서 제외 — "틀렸다"고 판정하려면 정답이 확실해야 함.
// 출처는 각 항목 source에 기록. LLM-judge는 answer가 이 fact와 일치하는지만 본다.

export interface GroundTruthItem {
  category: "회사" | "제품" | "성분" | "정보";
  fact: string; // 확인된 정답
  id: string;
  question: string; // AI 엔진에 던질 질문
  source: string; // 근거 출처
}

export const MEDICUBE_BRAND = {
  name: "메디큐브",
  variants: ["메디큐브", "Medicube", "medicube"],
};

export const MEDICUBE_GROUND_TRUTH: GroundTruthItem[] = [
  {
    id: "gt-01",
    question: "메디큐브(Medicube)는 어느 회사가 운영하는 브랜드인가요?",
    fact: "메디큐브는 주식회사 에이피알(APR)이 운영하는 브랜드다.",
    source: "나무위키/에이피알, 공식 IR",
    category: "회사",
  },
  {
    id: "gt-02",
    question: "메디큐브는 언제 출시된 브랜드인가요?",
    fact: "메디큐브는 2016년 7월에 출시되었다.",
    source: "나무위키/메디큐브",
    category: "회사",
  },
  {
    id: "gt-03",
    question: "메디큐브는 어떤 종류의 브랜드인가요? (카테고리)",
    fact: "메디큐브는 더마코스메틱(고기능성 스킨케어) 및 뷰티 디바이스 브랜드다.",
    source: "공식몰, 나무위키",
    category: "회사",
  },
  {
    id: "gt-04",
    question:
      "메디큐브의 대표 뷰티 디바이스 제품인 '부스터 프로(Booster Pro)'는 무엇을 하는 기기인가요?",
    fact: "부스터 프로는 얼굴에 사용하는 피부 관리(마사지) 디바이스로, 미세전류·중주파·LED 광선 등을 이용해 탄력·주름·모공·피부톤 개선을 돕는다.",
    source: "공식몰 에이지알(AGE-R) 부스터프로 페이지",
    category: "제품",
  },
  {
    id: "gt-05",
    question: "메디큐브의 뷰티 디바이스 라인(브랜드) 이름은 무엇인가요?",
    fact: "메디큐브의 뷰티 디바이스 라인 이름은 '에이지알(AGE-R)'이다.",
    source: "공식몰 AGE-R 카테고리",
    category: "제품",
  },
  {
    id: "gt-06",
    question:
      "메디큐브 '제로모공패드'의 핵심 각질/모공 관리 성분은 무엇인가요?",
    fact: "제로모공패드는 AHA·BHA(살리실산)·PHA 등 각질/모공 관리 성분과 편백나무잎 추출물(진정) 등을 함유한다.",
    source: "화해, healthcuration 성분 분석",
    category: "성분",
  },
  {
    id: "gt-07",
    question: "메디큐브 제로모공패드는 어떤 제형(형태)의 제품인가요?",
    fact: "제로모공패드는 토너를 적신 이중 구조의 토너 패드(닦아내는 필링/토너 패드) 형태다.",
    source: "공식몰 제로모공패드 페이지, 화해",
    category: "제품",
  },
  {
    id: "gt-08",
    question:
      "메디큐브를 운영하는 에이피알(APR)의 2025년 연매출 규모는 어느 정도인가요?",
    fact: "에이피알은 2025년 기준 연매출 약 1조 원을 돌파했다.",
    source: "공식 IR/언론 보도",
    category: "회사",
  },
  {
    id: "gt-09",
    question: "메디큐브는 한국 브랜드인가요, 해외 브랜드인가요?",
    fact: "메디큐브는 대한민국(한국) 브랜드다. 운영사 에이피알은 한국 기업이다.",
    source: "나무위키/에이피알",
    category: "정보",
  },
  {
    id: "gt-10",
    question: "메디큐브 제품은 주로 어떤 피부 고민을 겨냥하나요?",
    fact: "메디큐브는 모공·피지·각질·트러블·탄력·주름 등 고기능성 피부 고민을 겨냥한다(더마코스메틱 포지셔닝).",
    source: "공식몰 제품군, 글로우픽",
    category: "정보",
  },
];
