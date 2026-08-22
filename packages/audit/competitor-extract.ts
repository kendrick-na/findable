/**
 * 경쟁사 SoV 추출 — 추가 AI 호출 0, 이미 저장된 AI 답변 원문(excerpt) 재파싱.
 *
 * 배경: audit runner가 이미 "경쟁사 순위 알려줘"류 카테고리 프롬프트를 던지고
 * (runner.ts generateAuditPrompts), 그 답변 원문이 engineResponses[].excerpt(1500자)에
 * 저장됨. 여기서 번호목록을 파싱해 "어떤 브랜드가 몇 번 언급됐나 + 평균 순위"를 집계하면
 * 경쟁 지형이 나온다. 지불의사 시뮬 4/5가 "경쟁사 실명 벤치마크"를 2순위 킬러로 지목.
 *
 * ⚠️ 정확도 한계(UI에 표기): LLM이 나열한 "주관적 인기 목록" 기반이라 절대 순위가 아니라
 * "AI 답변에서의 등장 빈도·상대 위치". 경쟁사 실측(옵션 B)은 유료 기능으로 승격 예정.
 *
 * ⚠️ 알려진 한계(백로그): 한/영 병기 브랜드("조선미녀"↔"Beauty of Joseon")를 별도 집계 →
 * SoV 분산. 완전 해결엔 브랜드 별칭 사전 필요(entityVariants 활용). 현재는 내 브랜드만
 * brandVariants로 병합. disclaimer로 "추정·상대 빈도"임을 명시해 오해 방지.
 */

import { detectBrandMention } from "@repo/ai/lib/engines/utils";

// utils.ts estimateMentionPosition 과 동일한 번호목록 정규식(재사용). "1. X" "1) **X**" 등.
const NUMBERED_LINE =
  /(?:^|\n)\s*(?:\*{0,2})\s*(\d{1,2})[.)]\s*(?:\*{0,2})\s*([^\n]+)/g;

// "브랜드 - 설명", "브랜드(설명)" 등에서 설명 앞 브랜드만 자르는 구분자.
const NAME_SEPARATOR_RE = /[-–—:(]/;
// 공백 분할(문장형 항목 판별용).
const WHITESPACE_RE = /\s+/;

// 결함감사(2026-07-30) §4: LLM 번호목록이 브랜드가 아니라 "용도/분류" 분기인 경우
// ("1. 엔비디아 주식 추천 / 2. 그래픽카드 추천")가 많아, 분류 문구가 경쟁 브랜드
// 순위표에 유입됐다("그래픽카드 추천 4%, 3위"). 브랜드명일 수 없는 패턴을 걸러낸다.
const NON_BRAND_KO_RE =
  /(추천|순위|비교|방법|가이드|종류|목록|정리|팁|기준|장점|단점|관점|용도|시리즈|제품군|라인업|주의사항|체크리스트)$|(하기|해줘|합니다|하세요|입니다|해야|할 때|하는 법|인 경우)$|^(기타|참고|결론|요약|주의|먼저|우선)/;
const NON_BRAND_EN_RE =
  /\b(recommendations?|tips?|guides?|comparison|options?|methods?|steps?|categories|series|lineup|use cases?)$/i;

// 백로그 4(2026-07-31) 실측 보강: 위 두 정규식은 **접미사**만 본다. org 실데이터(nike.com)에서
// "최고의 쿠셔닝과 일상적인 편안함"·"착용 목적" 같은 **서술구**가 경쟁 브랜드로 유입됐다.
// 브랜드명은 조사(~의/~과/~를…)나 형용사 어미(~한/~운/~좋은)를 품지 않는다는 점을 이용한다.
//   · 관형/서술 어미로 끝나는 어절이 있는가("최고의", "일상적인", "편안함")
//   · 한국어 조사로 이어붙인 구인가("A와 B", "A를 위한")
// ⚠️ 실제 브랜드에 오탐이 나지 않도록 **2어절 이상**일 때만 적용한다(단어 하나면 브랜드로 신뢰).
const KO_DESCRIPTIVE_RE =
  /(?:^|\s)\S*(?:의|과|와|을|를|이나|에서|보다|위한|따른|대한|같은|좋은|많은|적인|스러운|하는|되는|있는|없는|한|함|성|감)(?:\s|$)/;

// 조사 없이 명사만 이어붙인 분류 항목("착용 목적", "가격대 선택")은 위 서술 규칙에 안 걸린다.
// 브랜드명일 수 없는 분류 명사로 끝나면 차단.
const KO_CATEGORY_NOUN_RE =
  // 전수감사 2026-08-02 §B 실측 보강: "메모리 반도체 시장 점유율"이 경쟁사로 유입
  // → 시장지표 명사(점유율·매출·순위표류) 추가. "~점유율"로 끝나는 브랜드는 없다.
  /(목적|용도별|가격대|예산|사이즈|성능|기능|특징|스타일|디자인|착화감|내구성|가성비|선택|고려사항|우선순위|점유율|매출액?|영업이익|시가총액|생산량|출하량)$/;

function looksLikeBrandName(name: string): boolean {
  if (NON_BRAND_KO_RE.test(name) || NON_BRAND_EN_RE.test(name)) {
    return false;
  }
  // 2어절 이상 + 서술/조사 패턴 = 브랜드가 아니라 설명 문구.
  if (
    name.split(WHITESPACE_RE).length >= 2 &&
    (KO_DESCRIPTIVE_RE.test(name) || KO_CATEGORY_NOUN_RE.test(name))
  ) {
    return false;
  }
  return true;
}

// 목록 항목 텍스트에서 브랜드명만 정제(마크다운·괄호설명·URL 제거).
function cleanBrandName(raw: string): string {
  return raw
    .replace(/\*+/g, "") // 마크다운 강조
    .replace(/\[[^\]]*\]\([^)]*\)/g, "") // 마크다운 링크
    .replace(/https?:\/\/\S+/g, "") // URL
    .split(NAME_SEPARATOR_RE)[0] // "브랜드 - 설명", "브랜드(설명)" → 브랜드만
    .replace(/["'`]/g, "")
    .trim();
}

export interface CompetitorRank {
  // 평균 순위(낮을수록 상위). 등장한 목록들의 순위 평균.
  averageRank: number;
  // 이 브랜드가 번호목록에 등장한 횟수(여러 엔진·프롬프트 합산).
  mentions: number;
  name: string;
  // 등장 빈도 기반 상대 점유율(0~100). 내 브랜드 포함 전체 대비.
  shareOfVoice: number;
}

export interface CompetitorLandscape {
  // 내 브랜드가 답변 어디든(번호목록 밖 포함) 언급됐는지.
  // P0-d(2026-07-27): GEO SoV(전체텍스트 언급률)와 동일 잣대(detectBrandMention)로 판정.
  // 이전엔 "번호목록에 등장했나"만 봐서, 경쟁사 나열 답변의 목록엔 경쟁사만 있고
  // 브랜드는 서두 문장에 있는 경우 brandFound=false → "SoV 79%인데 미발견" 모순.
  brandFound: boolean;
  // 내 브랜드가 경쟁사 순위표(번호목록)에 실제로 등장했는지. 순위 컨텍스트용 신호로 분리.
  brandInRanking: boolean;
  /**
   * 분포에 **변별력이 있는지**. false면 화면에 그리지 말 것(2026-08-06 세션N-7).
   *
   * 왜 필요한가(라이브 실측 5건): 상위 6개가 사실상 동률로 나오는 경우가 절반이었다.
   *   · Haegyung: **2·2·2·2·2·2** (전원 1회 언급 + `사람 이름/닉네임` 유입)
   *   · 5throck: 3·3·3·2·2·2 (Zara·Urban Outfitters 등 무관 브랜드)
   *   · 클로드: 8·8·8·8·5·5
   *   반면 **잘 되는 케이스는 실제로 유용**했다 —
   *   SK하이닉스 14·12·10·7·5·5(마이크론·삼성전자·인텔) · 나이키 12·10·10·7·5·5(아디다스·뉴발란스).
   *   → 섹션을 없애는 게 답이 아니라 **무의미한 분포만 걸러내는 것**이 답이다.
   *
   * 기준 = 1위와 6위의 격차가 `MIN_SPREAD_POINTS`(%p) 이상.
   *   ⚠️ "고유 SoV 값 개수"로 판정하는 대안을 함께 검증했으나 **경계 사례에서 틀렸다**:
   *   `4·3·3·3·2·2`(변별력 없음)를 고유값 3개라는 이유로 통과시킨다. 격차 기준은 정확히 걸러냈고
   *   "명확한 1위+꼬리"(30·6·5·5·5·5)·"2강 구도"는 둘 다 정상 통과시켰다.
   */
  discriminative: boolean;
  // 내 브랜드 포함 전체 순위(SoV desc). UI는 여기서 내 브랜드를 하이라이트.
  ranking: CompetitorRank[];
  // 파싱에 쓴 목록 항목 총수(신뢰도 표기용). 적으면 신뢰도 낮음.
  sampleSize: number;
}

/**
 * 1위-최하위 SoV 격차 최소치(%p). 이 미만이면 순위표가 "누가 앞선다"를 말하지 못한다.
 * 라이브 5건 + 합성 경계 5건으로 캘리브레이션(실측: 유용 케이스 7~9%p / 무의미 0~3%p).
 */
const MIN_SPREAD_POINTS = 5;
/** 격차 판정에 쓰는 상위 N개(화면 표시 개수와 같아야 판정과 화면이 일치한다). */
const SPREAD_WINDOW = 6;

/** 순위 분포에 변별력이 있는지. 항목 2개 미만이면 애초에 순위가 아니다. */
function isDiscriminative(ranking: CompetitorRank[]): boolean {
  const top = ranking.slice(0, SPREAD_WINDOW);
  if (top.length < 2) {
    return false;
  }
  const firstRow = top.at(0);
  const lastRow = top.at(-1);
  if (!(firstRow && lastRow)) {
    return false;
  }
  const spread =
    Math.round(firstRow.shareOfVoice) - Math.round(lastRow.shareOfVoice);
  return spread >= MIN_SPREAD_POINTS;
}

// 한/영 표기 병합 사전 (전수감사 2026-08-02 §B-9).
//   실측 결함: SK하이닉스 진단에서 "삼성전자 7%"와 "Samsung Electronics 5%",
//   "마이크론 5%"와 "Micron Technology 5%"가 **별도 경쟁사**로 등재됐다
//   (ko·en 프롬프트를 둘 다 돌리므로 구조적으로 발생).
//   원칙: **정확 일치만**. 퍼지 매칭은 서로 다른 브랜드를 합치는 더 나쁜 오류를 만든다.
//   일반해(임의 브랜드 한↔영)는 사전 없이는 불가 → LLM 패스는 백로그. 여기는
//   경쟁 목록에 자주 등장하는 대형 브랜드만 명시한다. 값 = 병합 대표 키.
const BRAND_KEY_ALIASES: Record<string, string> = {
  // 반도체·전자
  삼성전자: "samsung",
  삼성: "samsung",
  samsungelectronics: "samsung",
  마이크론: "micron",
  microntechnology: "micron",
  // 한글 음차 풀네임도 실측서 별도 등재됨("마이크론 테크놀로지" — SK하이닉스 job)
  마이크론테크놀로지: "micron",
  인텔: "intel",
  엔비디아: "nvidia",
  에스케이하이닉스: "skhynix",
  sk하이닉스: "skhynix",
  키옥시아: "kioxia",
  웨스턴디지털: "westerndigital",
  티에스엠씨: "tsmc",
  엘지전자: "lg",
  lg전자: "lg",
  lgelectronics: "lg",
  소니: "sony",
  델: "dell",
  레노버: "lenovo",
  샤오미: "xiaomi",
  화웨이: "huawei",
  // 빅테크
  애플: "apple",
  구글: "google",
  아마존: "amazon",
  마이크로소프트: "microsoft",
  테슬라: "tesla",
  메타: "meta",
  // 자동차
  현대자동차: "hyundai",
  현대차: "hyundai",
  hyundaimotor: "hyundai",
  기아: "kia",
  기아자동차: "kia",
  kiamotors: "kia",
  도요타: "toyota",
  토요타: "toyota",
  // 스포츠·소비재 (실측정 다수 업종)
  나이키: "nike",
  아디다스: "adidas",
  뉴발란스: "newbalance",
  아식스: "asics",
  푸마: "puma",
  호카: "hoka",
  리복: "reebok",
  언더아머: "underarmour",
  // 한국 플랫폼
  네이버: "naver",
  카카오: "kakao",
  쿠팡: "coupang",
  아모레퍼시픽: "amorepacific",
};

const HANGUL_RE = /[가-힣]/;

// 같은 브랜드의 표기 흔들림 병합용 키(소문자·공백제거 → 한/영 사전 병합).
function normalizeKey(name: string, extraAliases?: Map<string, string>): string {
  const base = name.toLowerCase().replace(/\s+/g, "");
  // 🔴 사용자가 등록한 경쟁사가 **먼저**다(N-44). 내장 사전은 대형 브랜드만 담은
  //   일반값이고, 고객이 직접 적어준 값이 그 업종의 진실에 더 가깝다.
  return extraAliases?.get(base) ?? BRAND_KEY_ALIASES[base] ?? base;
}

/**
 * 👤 고객이 등록한 경쟁사(`Brand.competitors`) → 표기 병합 사전.
 *
 * 🔴 **왜 화이트리스트가 아닌가**(N-44 판정): 등록한 경쟁사만 남기고 나머지를 버리면
 *   `shareOfVoice` 의 **분모가 바뀌어 점유율이 부풀려진다**. 게다가 「내가 몰랐던
 *   경쟁사」가 사라져 이 화면의 존재 이유(경쟁 지형 발견)가 없어진다.
 *   → 그래서 **거르지 않고 합치기만** 한다. 집계 대상은 그대로 전부다.
 *
 * ⚠️ 이 파일 헤더가 이미 요구하던 것이다: *"한/영 병기 브랜드를 별도 집계 → SoV 분산.
 *   완전 해결엔 브랜드 별칭 사전 필요"*. 내 브랜드는 `brandVariants` 로 이미 병합되는데
 *   **경쟁사만 그 혜택을 못 받고 있었다.** 같은 처리를 경쟁사에도 준다.
 *
 * 형식: `"삼성전자"` 또는 `{ name, aliases }`. 문자열만 오면 병합할 짝이 없으므로
 *   **표시명 고정**(대표 키)만 담당한다.
 */
export interface KnownCompetitor {
  aliases?: string[];
  name: string;
}

/**
 * `Brand.competitors`(Json 컬럼) 를 안전하게 읽는다.
 *
 * 🔴 **여기 한 벌만 둔다**(N-45 · 남은일 #9). 예전엔 앱 대시보드에만 파서가 있어서,
 *   공개 리포트가 같은 값을 쓰려면 **복제**해야 했다. 두 벌이 되면 규칙이 갈리고
 *   (📕 도메인 정규식 3중 복제 사고) 두 화면이 서로 다른 숫자를 보인다 — 그게
 *   애초에 #9 를 만든 원인이다.
 *
 * 스키마 주석은 `[{ name, domain }]` 이지만 **문자열도 들어온다**(`["올리브영"]`).
 * Json 컬럼이라 DB 가 막아주지 않으므로 **둘 다 받는다** — 안 좁히면 화면이
 * `[object Object]` 를 그린다.
 * ⚠️ 이름이 없는 항목은 버린다(사전에 넣어도 합칠 짝이 없다).
 */
export function parseKnownCompetitors(value: unknown): KnownCompetitor[] {
  if (!Array.isArray(value)) {
    return [];
  }
  const out: KnownCompetitor[] = [];
  for (const item of value) {
    if (typeof item === "string" && item.length > 0) {
      out.push({ name: item });
      continue;
    }
    if (item && typeof item === "object" && "name" in item) {
      const name = (item as { name?: unknown }).name;
      if (typeof name === "string" && name.length > 0) {
        const rawAliases = (item as { aliases?: unknown }).aliases;
        const aliases = Array.isArray(rawAliases)
          ? rawAliases.filter(
              (a): a is string => typeof a === "string" && a.length > 0
            )
          : [];
        out.push(aliases.length > 0 ? { aliases, name } : { name });
      }
    }
  }
  return out;
}

export function buildCompetitorAliases(
  competitors: Array<KnownCompetitor | string>
): Map<string, string> {
  const map = new Map<string, string>();
  for (const c of competitors) {
    const entry = typeof c === "string" ? { name: c } : c;
    const canonical = entry.name?.trim();
    if (!canonical) {
      continue;
    }
    const key = canonical.toLowerCase().replace(/\s+/g, "");
    // 대표 이름 자신도 키로 넣는다 — 내장 사전이 이 브랜드를 다른 키로 접는 것을 막는다.
    map.set(key, key);
    for (const alias of entry.aliases ?? []) {
      const aliasKey = alias.trim().toLowerCase().replace(/\s+/g, "");
      if (aliasKey) {
        map.set(aliasKey, key);
      }
    }
  }
  return map;
}

/**
 * 여러 AI 답변 excerpt에서 경쟁 지형 추출.
 * @param excerpts engineResponses[].excerpt 배열(카테고리형 답변 원문 포함)
 * @param brandName 내 브랜드명(하이라이트·brandFound 판정용)
 * @param brandVariants 내 브랜드 표기 변형(Korean Entity Grounding)
 * @param knownCompetitors 👤 고객이 등록한 경쟁사(`Brand.competitors`). **거르지 않는다** —
 *   표기 병합에만 쓴다(화이트리스트로 쓰면 SoV 분모가 바뀐다 · N-44 판정).
 */
export function extractCompetitorLandscape(
  excerpts: string[],
  brandName: string,
  brandVariants: string[] = [],
  knownCompetitors: Array<KnownCompetitor | string> = []
): CompetitorLandscape {
  // 고객 등록 경쟁사의 표기 사전. 비어 있으면 기존 동작과 **완전히 같다**(무해한 기본값).
  const aliases = buildCompetitorAliases(knownCompetitors);
  const key0 = (name: string) => normalizeKey(name, aliases);
  // 브랜드 → {mentions, rankSum}
  const tally = new Map<
    string,
    { display: string; mentions: number; rankSum: number }
  >();
  let sampleSize = 0;

  /**
   * 내 브랜드의 표기 변형들 → **하나의 대표 키**로 접는다(N-45 수정).
   *
   * 🔴 예전엔 변형마다 **다른 키**가 만들어졌다(`라운드랩` · `roundlab`). 그래서
   *   한/영이 섞여 나오면 **집계가 갈린 채** 표시명만 `brandName` 으로 바뀌어,
   *   화면에 **같은 이름이 두 줄** 나왔다(합쳐진 것도 아니고 구분되지도 않는 최악).
   *   경쟁사는 `buildCompetitorAliases` 로 이미 접히는데 **내 브랜드만** 안 접혔다.
   *
   * ⚠️ 대표 키는 `brandName` 기준으로 고정한다 — 어느 변형이 먼저 나오든 같은 칸에 쌓인다.
   */
  const myCanonicalKey = key0(brandName);
  const myKeys = new Set(
    [brandName, ...brandVariants].filter(Boolean).map((s) => key0(s))
  );

  for (const excerpt of excerpts) {
    if (!excerpt) {
      continue;
    }
    for (const m of excerpt.matchAll(NUMBERED_LINE)) {
      const rank = Number.parseInt(m[1], 10);
      const name = cleanBrandName(m[2]);
      // 너무 짧거나(1글자) 문장형(공백 4개 이상 = 설명문)인 항목은 브랜드명 아님 → 스킵.
      if (name.length < 2 || name.split(WHITESPACE_RE).length > 4) {
        continue;
      }
      // 용도/분류/문장형 항목("그래픽카드 추천" 등)은 브랜드가 아님 → 스킵.
      if (!looksLikeBrandName(name)) {
        continue;
      }
      sampleSize += 1;
      // "엔비디아 주식"·"NVIDIA GPU"처럼 내 브랜드로 시작하는 항목은 내 브랜드로 병합
      // (별도 경쟁사로 분열 방지 — 결함감사 §4 후속).
      const rawKey = key0(name);
      // 내 브랜드(변형 포함)로 시작하면 **대표 키 하나**에 쌓는다.
      //   `startsWith` 인 이유: "엔비디아 주식"·"NVIDIA GPU" 처럼 꼬리가 붙어도
      //   별도 경쟁사로 분열되면 안 된다(결함감사 §4 후속).
      const isMine = [...myKeys].some((k) => rawKey.startsWith(k));
      const key = isMine ? myCanonicalKey : rawKey;
      const entry = tally.get(key) ?? {
        display: name,
        mentions: 0,
        rankSum: 0,
      };
      entry.mentions += 1;
      entry.rankSum += rank;
      // 한/영 병합 시 표시명은 한글 표기 우선(주 사용자 = 한국어 UI).
      // "Samsung Electronics"가 먼저 잡혔어도 "삼성전자"가 나타나면 교체.
      if (HANGUL_RE.test(name) && !HANGUL_RE.test(entry.display)) {
        entry.display = name;
      }
      tally.set(key, entry);
    }
  }

  const totalMentions = [...tally.values()].reduce(
    (sum, e) => sum + e.mentions,
    0
  );

  const ranking: CompetitorRank[] = [...tally.entries()]
    .map(([key, e]) => ({
      // 대표 키로 쌓인 것 = 내 브랜드. (`myKeys.has(key)` 와 동치지만 — 대표 키는
      //   늘 myKeys 의 원소다 — **어느 칸에 쌓았는지**를 묻는 쪽이 의도가 분명하다.)
      name: key === myCanonicalKey ? brandName : e.display,
      mentions: e.mentions,
      averageRank: Math.round((e.rankSum / e.mentions) * 10) / 10,
      shareOfVoice:
        totalMentions > 0 ? Math.round((e.mentions / totalMentions) * 100) : 0,
    }))
    .sort(
      (a, b) => b.shareOfVoice - a.shareOfVoice || a.averageRank - b.averageRank
    );

  // 순위표(번호목록) 실등장 여부 — 순위 컨텍스트 신호.
  const brandInRanking = ranking.some(
    (r) => key0(r.name) === key0(brandName)
  );

  // P0-d: brandFound는 GEO SoV와 동일 잣대(전체 excerpt 언급)로 판정. 번호목록 밖이어도
  // 언급됐으면 true → "SoV 높은데 미발견" 모순 제거. 순위표 등장은 brandInRanking으로 분리.
  const brandFound =
    brandInRanking ||
    excerpts.some(
      (excerpt) =>
        !!excerpt &&
        detectBrandMention(excerpt, brandName, brandVariants).mentioned
    );

  return {
    ranking,
    brandFound,
    brandInRanking,
    sampleSize,
    discriminative: isDiscriminative(ranking),
  };
}

// 내 브랜드인지 판정(UI 하이라이트). 컴포넌트에서 재사용.
export function isMyBrand(
  rankName: string,
  brandName: string,
  brandVariants: string[] = []
): boolean {
  const target = normalizeKey(rankName);
  return [brandName, ...brandVariants].some((v) => normalizeKey(v) === target);
}
