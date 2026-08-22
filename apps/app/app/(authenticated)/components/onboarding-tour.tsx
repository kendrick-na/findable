"use client";

import { Button } from "@repo/design-system/components/ui/button";
import {
  Dialog,
  DialogDescription,
  DialogPortal,
  DialogPrimitive,
  DialogTitle,
} from "@repo/design-system/components/ui/dialog";
import { cn } from "@repo/design-system/lib/utils";
import { useEffect, useState } from "react";

/**
 * 대시보드 첫 진입 가이드 투어 — 2026-08-21(11번).
 *
 * ## 왜 라이브러리를 안 쓰나
 * driver.js·react-joyride·shepherd.js 조사 결과: driver.js는 오래된 미해결 접근성
 * 이슈가 있고, react-joyride는 4단계 투어엔 과한 용량(~34KB)이고, shepherd.js는
 * 상용 서비스에 AGPL 라이선스가 걸린다. → **shadcn이 이미 쓰는 Radix Dialog의
 * 포커스트랩·ESC·aria-modal을 그대로 재사용**해 직접 만드는 게 의존성 0·번들 최소.
 *
 * ## 실측 근거 (haloX f005 — 대시보드 첫 로딩 위 4단계 가이드)
 * haloX·Profound·Scrunch 3곳 공통 패턴(`docs/_경쟁사_UIUX/경쟁사별_기능_전체_및_필요판단_2026-08-21.md`
 * 19번 줄). 단 haloX는 스켈레톤(가짜 로딩 뼈대) 위에 얹지만, Findable은 **실제
 * 측정 결과가 있는 화면**에서만 뜬다(가짜 데모 데이터 반면교사 — Profound Nike
 * 데모·Scrunch 강의영상은 정직성 원칙 위반으로 기각됨, 같은 문서 63·103·142번 줄).
 *
 * ⛔ **대시보드 위 hover 툴팁은 별개 사안**(N-41, `metric-dictionary` 지표 설명)이고
 *   이미 "터치에 없다"는 이유로 `<details>`로 대체됐다 — 이 투어는 그것과 다르다.
 *   이 투어는 **탭/클릭으로만 진행**된다(hover 트리거 없음).
 *
 * ⚠️ 상태 저장은 `localStorage`뿐(👤 결정 — DB 마이그레이션 없이). 기기·브라우저를
 *   바꾸면 다시 뜰 수 있다는 트레이드오프를 그대로 받아들인다.
 */

interface TourStep {
  description: string;
  targetId: string;
  title: string;
}

const STEPS: TourStep[] = [
  {
    targetId: "tour-kpis",
    title: "AI가 우리를 얼마나 말하는지",
    description:
      "ChatGPT·Claude 같은 AI가 우리 브랜드를 언급한 비율, 순위, 감성을 여기서 한눈에 봐요.",
  },
  {
    targetId: "tour-actions",
    title: "지금 뭘 고쳐야 하는지",
    description: "측정 결과를 바탕으로 다음에 할 일을 여기서 추천해드려요.",
  },
  {
    targetId: "tour-trend",
    title: "시간에 따른 변화",
    description: "측정할 때마다 노출도가 어떻게 바뀌는지 추세로 쌓여요.",
  },
  {
    targetId: "tour-truth-mirror",
    title: "AI가 실제로 한 말",
    description: "요약이 아니라 AI 답변 원문을 그대로 확인할 수 있어요.",
  },
];

const STORAGE_KEY = "findable_dashboard_tour_seen_v1";

/** 대상 요소 자체 — 없으면(아직 렌더 전·조건부 섹션 없음) 그 단계는 건너뛴다. */
function findTarget(id: string): HTMLElement | null {
  return document.getElementById(id);
}

export const OnboardingTour = () => {
  const [open, setOpen] = useState(false);
  const [stepIndex, setStepIndex] = useState(0);
  const [rect, setRect] = useState<DOMRect | null>(null);

  useEffect(() => {
    // 이미 본 사람에겐 아예 안 띄운다(localStorage 미접근 환경 — 프라이빗 창 등 —
    // 이면 try/catch로 안전하게 "안 본 것"으로 취급).
    try {
      if (localStorage.getItem(STORAGE_KEY)) {
        return;
      }
    } catch {
      // 접근 불가 시 그냥 진행 — 매번 뜨는 것이 최악이 아니라, 여기서 죽는 것이 최악.
    }
    setOpen(true);
  }, []);

  useEffect(() => {
    if (!open) {
      return;
    }
    // 현재 단계의 대상이 화면에 없으면(조건부 섹션 미렌더) 다음 단계로 자동 스킵.
    const target = STEPS[stepIndex];
    if (!target) {
      setOpen(false);
      return;
    }
    const el = findTarget(target.targetId);
    if (!el) {
      if (stepIndex < STEPS.length - 1) {
        setStepIndex((i) => i + 1);
      } else {
        setOpen(false);
      }
      return;
    }
    el.scrollIntoView({ block: "center" });
    setRect(el.getBoundingClientRect());
  }, [open, stepIndex]);

  const finish = () => {
    setOpen(false);
    try {
      localStorage.setItem(STORAGE_KEY, "1");
    } catch {
      // 저장 실패해도 이번 세션은 이미 닫혔다 — 다음에 다시 뜰 뿐, 기능은 안 죽는다.
    }
  };

  if (!(open && rect)) {
    return null;
  }

  const step = STEPS[stepIndex];
  if (!step) {
    return null;
  }
  const isLast = stepIndex === STEPS.length - 1;

  /**
   * 카드 위치 — 대상 아래 공간과 위 공간을 실측해 **더 넓은 쪽**에 붙인다.
   * 🔴 좁은 화면(모바일 390px)에서 첫 카드처럼 위·아래 둘 다 좁을 수 있다
   *   (Storybook 스크린샷으로 실제로 잡음 — 예전 계산은 "아래가 부족하면 무조건
   *   위로"였는데, 위도 부족하면 카드가 스포트라이트를 가려버렸다).
   *   → 공간이 더 넓은 쪽을 골라 겹침을 최소화한다.
   */
  const CARD_HEIGHT_ESTIMATE = 180;
  const spaceBelow = window.innerHeight - rect.bottom;
  const spaceAbove = rect.top;
  const cardTop =
    spaceBelow >= CARD_HEIGHT_ESTIMATE || spaceBelow >= spaceAbove
      ? rect.bottom + 12
      : Math.max(rect.top - CARD_HEIGHT_ESTIMATE - 12, 16);

  return (
    <Dialog onOpenChange={(next: boolean) => !next && finish()} open={open}>
      <DialogPortal>
        {/* 스포트라이트 — 대상 사각형만 빼고 어둡게(4분할 오버레이, clip-path 대신
            브라우저 호환성이 넓은 방식). 클릭은 막지 않는다 — 카드 밖을 눌러도
            투어만 넘어가도록 오버레이는 pointer-events-none(포커스는 Dialog가 잡는다). */}
        <div
          aria-hidden="true"
          className="pointer-events-none fixed inset-0 z-50"
        >
          <div
            className="absolute inset-x-0 top-0 bg-black/60"
            style={{ height: Math.max(rect.top - 8, 0) }}
          />
          <div
            className="absolute inset-x-0 bottom-0 bg-black/60"
            style={{ top: rect.bottom + 8 }}
          />
          <div
            className="absolute bg-black/60"
            style={{
              top: rect.top - 8,
              height: rect.height + 16,
              left: 0,
              width: Math.max(rect.left - 8, 0),
            }}
          />
          <div
            className="absolute bg-black/60"
            style={{
              top: rect.top - 8,
              height: rect.height + 16,
              left: rect.right + 8,
              right: 0,
            }}
          />
          <div
            className="absolute rounded-lg ring-2 ring-[color:var(--findable-primary,#ff7a4d)]"
            style={{
              top: rect.top - 8,
              left: rect.left - 8,
              width: rect.width + 16,
              height: rect.height + 16,
            }}
          />
        </div>

        <DialogPrimitive.Content
          aria-describedby={`tour-desc-${step.targetId}`}
          className={cn(
            "fixed z-50 flex w-[min(320px,calc(100vw-32px))] flex-col gap-3 rounded-lg border border-[color:var(--findable-hairline,#23252a)] bg-[color:var(--findable-surface,#101113)] p-4 shadow-lg [word-break:keep-all]"
          )}
          onOpenAutoFocus={(e: Event) => e.preventDefault()}
          style={{
            top: cardTop,
            left: Math.min(Math.max(rect.left, 16), window.innerWidth - 336),
          }}
        >
          <span className="text-[color:var(--findable-ink-tertiary,#7e8289)] text-xs">
            {stepIndex + 1}단계 / {STEPS.length}단계
          </span>
          <DialogTitle className="font-semibold text-[color:var(--findable-ink,#f7f8f8)] text-sm">
            {step.title}
          </DialogTitle>
          <DialogDescription
            className="text-[color:var(--findable-ink-subtle,#8a8f98)] text-sm leading-relaxed"
            id={`tour-desc-${step.targetId}`}
          >
            {step.description}
          </DialogDescription>
          <div className="flex items-center justify-between gap-2 pt-1">
            <button
              className="text-[color:var(--findable-ink-tertiary,#7e8289)] text-xs"
              onClick={finish}
              type="button"
            >
              건너뛰기
            </button>
            <Button
              onClick={() => {
                if (isLast) {
                  finish();
                } else {
                  setStepIndex((i) => i + 1);
                }
              }}
              size="sm"
            >
              {isLast ? "완료" : "다음"}
            </Button>
          </div>
        </DialogPrimitive.Content>
      </DialogPortal>
    </Dialog>
  );
};
