"use client";

import { objectParticle } from "@repo/audit/actions";
import { stripMarkdown } from "@repo/audit/strip-markdown";
import { Badge } from "@repo/design-system/components/ui/badge";
import { Button } from "@repo/design-system/components/ui/button";
import { cn } from "@repo/design-system/lib/utils";
import { ChevronDownIcon, QuoteIcon } from "lucide-react";
import { useState } from "react";
import type { TruthMirrorData } from "../../lib/truth-mirror-data";

/**
 * 「측정 원문」 — AI 가 실제로 뭐라고 했나 (2026-08-17 세션N-37 · v4 탭7).
 *
 * ⭐ **경쟁사 4곳 중 Otterly 만 유사 기능을 갖고 있다**(실측). 우리 무기다.
 *   점수·비율은 요약이고, 이 화면은 **원문**을 보여준다 — *"왜 그 점수인지"* 에 답한다.
 *
 * 🔴 **없는 구분을 지어내지 않는다**: web 판은 `isStub` 으로 *"모른다"* 와 *"측정 안 함"*
 *   을 갈랐지만 `Tracking` 에는 그 필드가 **없다**(v4 가 경고한 함정).
 *   → 여기서는 **오류(못 물어봄)** 만 따로 고지하고, 없는 축은 만들지 않는다.
 *
 * 🔴 **채널을 지목하지 않는다** — 출처 분석은 `/sources` 담당(중복·날조 방지).
 */

const ENGINE_LABELS: Record<string, string> = {
  chatgpt: "ChatGPT",
  "chatgpt-web": "ChatGPT (Web)",
  claude: "Claude",
  daum: "다음",
  gemini: "Gemini",
  hyperclova: "HyperCLOVA",
  naver: "네이버",
  "naver-briefing": "네이버 AI 브리핑",
  perplexity: "Perplexity",
};

/**
 * 🔴 **브리핑만 질의 축이 다르다**(N-45 · #4-b B-5).
 * 📕 `docs/_적용/브리핑_본류편입_기획_2026-08-17.md` §2
 *
 * 7엔진은 *추천형*("{브랜드} 추천")을 묻지만, 브리핑은 그 질의엔 **원리상 안 뜬다**.
 * 그래서 브리핑만 **정보형**(효과·후기·장단점)으로 따로 묻는다.
 *
 * ⛔ 그런데 화면이 이 사실을 말하지 않으면, 브리핑의 「우리를 안 말함」이
 *   7엔진의 그것과 **같은 뜻으로 읽힌다** — 실제로는 *"다른 질문에서 안 떴다"* 인데
 *   *"네이버가 우리를 모른다"* 로 오독된다.
 *   📕 이 저장소 최다 사고 유형(「못 잰 것/다르게 잰 것을 0 이라 부르기」).
 */
const BRIEFING_ENGINE_ID = "naver-briefing";

/**
 * 언급 배지 — **브리핑만 다른 말을 한다**.
 *
 * | 엔진 | 안 말했을 때 | 왜 |
 * |---|---|---|
 * | 7엔진 | "우리를 안 말함" | 같은 질문(추천형)을 던졌으니 비교가 성립한다 |
 * | 브리핑 | **"이 질문엔 안 떠요"** | 질문이 달라 「안 말함」과 뜻이 다르다 |
 *
 * ⛔ 브리핑에 「우리를 안 말함」을 쓰면 *"네이버가 우리를 모른다"* 로 오독된다 —
 *   실제로는 *"그 질의에 브리핑 블록 자체가 안 떴다"* 이고, 그건 **정상 동작**이다.
 */
const renderMentionBadge = (engineId: string, mentioned: boolean) => {
  if (mentioned) {
    return <Badge variant="default">우리 브랜드로 확인됨</Badge>;
  }
  if (engineId === BRIEFING_ENGINE_ID) {
    return <Badge variant="secondary">이 질문엔 안 떠요</Badge>;
  }
  return <Badge variant="secondary">우리 브랜드 확인 안 됨</Badge>;
};

/** 기본으로 펼치는 카드 수. 나머지는 접는다(밀도 축소 — web 판과 같은 판단). */
const DEFAULT_VISIBLE = 3;

const SENTIMENT_LABEL: Record<string, string> = {
  negative: "부정적으로",
  neutral: "중립적으로",
  positive: "좋게",
};

export const TruthMirrorSection = ({
  brandName,
  data,
}: {
  brandName: string;
  data: TruthMirrorData;
}) => {
  const [expanded, setExpanded] = useState(false);
  const { engines, erroredCount, knownCount, measuredCount } = data;
  const visible = expanded ? engines : engines.slice(0, DEFAULT_VISIBLE);
  const hidden = engines.length - visible.length;

  return (
    <section className="findable-card p-5">
      <div className="flex items-center gap-1.5 text-[color:var(--findable-primary,#ff7a4d)] text-xs">
        <QuoteIcon aria-hidden className="size-3.5" />
        측정 원문 · AI별 대표 답변
      </div>

      <h2 className="mt-2 font-semibold text-[color:var(--findable-ink,#f7f8f8)] text-lg">
        {knownCount === 0 ? (
          <>
            측정한 AI {measuredCount}곳 중 등록한 {brandName}
            {objectParticle(brandName)} 확인한 곳은 없습니다
          </>
        ) : (
          <>
            측정한 AI {measuredCount}곳 중 {knownCount}곳이 등록한 {brandName}
            {objectParticle(brandName)} 실제 브랜드로 확인했습니다
          </>
        )}
      </h2>
      <p className="mt-1 text-[color:var(--findable-ink-subtle,#8a8f98)] text-sm">
        공개 리포트의 ‘진실의 거울’ 요약을 뒷받침하는 <strong>대표 원문</strong>이에요.
        질문별 전체 원문과 날짜별 변화는 ‘추적 질문’에서 관리합니다. 브랜드명·별칭·공식
        도메인 또는 공식 출처로 검산되는 답변만 확인으로 집계합니다.
      </p>

      {/* 🔴 오류는 "모른다"가 아니다 — 분모에서 뺐다는 사실을 밝힌다. */}
      {erroredCount > 0 ? (
        <p className="mt-2 text-[color:var(--findable-ink-tertiary,#7e8289)] text-xs">
          {erroredCount}곳은 답을 못 받아 위 숫자에서 뺐어요(모른다는 뜻이
          아니에요).
        </p>
      ) : null}

      <ul className="mt-4 flex flex-col gap-3">
        {visible.map((engine) => (
          <li
            className={cn(
              "rounded-lg border p-4",
              engine.brandMentioned
                ? "border-[color:var(--findable-primary,#ff7a4d)]/30"
                : "border-[color:var(--findable-hairline,#23252a)]"
            )}
            key={engine.engineId}
          >
            <div className="flex flex-wrap items-center gap-2">
              <span className="font-medium text-[color:var(--findable-ink,#f7f8f8)] text-sm">
                {ENGINE_LABELS[engine.engineId] ?? engine.engineId}
              </span>
              {renderMentionBadge(engine.engineId, engine.brandMentioned)}
              {engine.mentionPosition ? (
                <span className="text-[color:var(--findable-ink-tertiary,#7e8289)] text-xs">
                  {engine.mentionPosition}번째
                </span>
              ) : null}
              {/* 감성은 **말한 경우에만** 뜻이 있다 — 안 말했는데 "중립적"은 거짓이다. */}
              {engine.brandMentioned && engine.sentiment ? (
                <span className="text-[color:var(--findable-ink-tertiary,#7e8289)] text-xs">
                  {SENTIMENT_LABEL[engine.sentiment]} 말함
                </span>
              ) : null}
            </div>

            {engine.engineId === BRIEFING_ENGINE_ID ? (
              // 🔴 질의 축이 다름을 **그 자리에서** 밝힌다(기획서 §5-c).
              <p className="mt-1.5 text-[color:var(--findable-ink-tertiary,#7e8289)] text-xs leading-relaxed">
                이 줄만 「효과·후기·장단점」으로 물었어요 — 네이버 AI 브리핑이
                뜨는 질문 유형이라서요. 위 답변들과 <b>질문이 달라</b> 나란히
                비교하진 마세요.
              </p>
            ) : null}

            {engine.excerpt ? (
              // 🔴🔴 **마크다운을 벗겨서 보여준다** (N-46 · 👤 라이브 지적).
              //   AI 는 마크다운으로 답한다. 그대로 그리면 `**`·`###`·`---` 가 **글자로**
              //   보인다 — 라이브 실측에서 `### Why I'd recommend…` · `**SK-II**` 가 그대로
              //   떴다. 하필 *"점수가 아니라 **실제 답변**"* 이라며 신뢰를 내세우는 자리다.
              //   ⭐ `stripMarkdown` 은 **이미 있었고 테스트도 있었는데 아무도 안 쓰고 있었다**
              //     (`strip-markdown.ts` 를 부르는 프로덕션 코드가 0곳이었다).
              //   ⚠️ 렌더가 아니라 **제거**를 택한 이유: 원문은 외부 AI 가 만든 문자열이라
              //     HTML 로 그리면 XSS 경계를 새로 져야 한다. 여기 목적은 *"뭐라고 했나"* 를
              //     읽는 것이지 서식 재현이 아니다.
              <div className="mt-2 text-[color:var(--findable-ink-subtle,#8a8f98)] text-sm leading-relaxed">
                <p className="whitespace-pre-wrap break-words">
                  {stripMarkdown(engine.excerpt)}
                </p>
              </div>
            ) : (
              // 원문이 없으면 **지어내지 않는다** — 없다고 말한다.
              <p className="mt-2 text-[color:var(--findable-ink-tertiary,#7e8289)] text-sm">
                답변 원문이 저장되지 않았어요.
              </p>
            )}
          </li>
        ))}
      </ul>

      {hidden > 0 ? (
        <Button
          className="mt-3 w-full"
          onClick={() => setExpanded(true)}
          size="sm"
          variant="outline"
        >
          <ChevronDownIcon aria-hidden className="size-4" />
          나머지 {hidden}곳 더 보기
        </Button>
      ) : null}
    </section>
  );
};
