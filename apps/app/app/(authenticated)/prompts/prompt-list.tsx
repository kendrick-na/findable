"use client";

import { Badge } from "@repo/design-system/components/ui/badge";
import { Button } from "@repo/design-system/components/ui/button";
import { Input } from "@repo/design-system/components/ui/input";
import { toast } from "@repo/design-system/components/ui/sonner";
import { Spinner } from "@repo/design-system/components/ui/spinner";
import { CheckIcon, PencilIcon, Trash2Icon, XIcon } from "lucide-react";
import { useRouter } from "next/navigation";
import { useState } from "react";
import type { DeletePromptResult } from "@/app/actions/brand/delete-prompt";
import type { EditPromptResult } from "@/app/actions/brand/edit-prompt";

/**
 * 저장된 추적 질문 목록 + 삭제 (세션N-41).
 *
 * 🔴 **왜 확인 단계를 두는가** — `Tracking.promptId` 는 `onDelete: Cascade`
 *   (`schema.prisma:127`)라 질문을 지우면 **그 질문으로 측정한 과거 기록이 함께 사라진다**.
 *   조용히 지우면 시계열이 유실되는데 화면은 성공처럼 보인다.
 *   → 측정 기록이 있는 질문은 **몇 건이 사라지는지 숫자로 밝히고** 한 번 더 누르게 한다.
 *   ⚠️ `window.confirm` 을 쓰지 않는다 — 모바일에서 문구가 잘리고 스타일을 못 맞춘다.
 *     같은 버튼을 **두 번 누르는** 방식(2단 확인)이라 추가 의존성도 없다.
 *
 * ⚠️ 측정 0건인 질문은 잃을 게 없으므로 **바로 삭제**한다(없는 위험에 확인을 물리면
 *   경고가 소음이 되어 정작 중요한 확인도 안 읽힌다).
 *
 * 🔴 **서버액션은 주입받는다**(`onDelete` prop) — import 하면 안 된다.
 *   실측(N-41): 서버액션을 직접 import 하자 `node:fs`·`node:crypto` 등이 브라우저
 *   번들로 끌려와 **Storybook preview 빌드가 통째로 실패**했다(내 스토리만이 아니라
 *   **전체 21장**). 📕 N-37 이 같은 함정에 데였다(`TrendAnnotations`→서버액션→Prisma
 *   → 스토리 18장 전부 새하얬다) → 그때 세운 규칙이 `emptyAction`·`annotationsSlot`
 *   **주입 패턴**이다. 여기서도 같은 규칙을 따른다.
 *   ⚠️ 타입만은 `import type` 으로 가져와도 안전하다(컴파일 시 지워진다).
 */

export interface PromptListItem {
  category: string | null;
  id: string;
  language: string;
  /** 이 질문으로 측정된 Tracking 행 수 — 삭제 시 함께 사라지는 양. */
  measuredCount: number;
  text: string;
}

/**
 * 질문 유형 배지 — **DB `PromptCategory` enum 과 1:1**(schema.prisma).
 *
 * 🔴 N-42 정정: 여기 있던 키는 `brand`·`competitor`·`category` 였는데 **DB 에 그런 값이
 *   저장되는 경로가 없다**. 마법사의 힌트(`brand`/`competitor`)는 저장 직전
 *   `CATEGORY_MAP`(suggest-prompts.ts:83)이 **enum 으로 바꿔** 넣는다
 *   (`brand→recommendation` · `competitor→comparison`).
 *   → 라벨이 한 번도 안 맞아 배지에 **영어 원문이 그대로** 노출되고 있었다
 *     (`?? prompt.category` 폴백이 있어 화면은 안 깨져 **조용히** 틀렸다).
 *   📕 규율: 추측한 키로 판정하지 말 것 — 저장 경로를 전수해 실제 값을 확인했다.
 *
 * ⚠️ enum 7개를 **전부** 덮는다. 빠지면 그 값만 영어로 새어 나간다(가드가 이걸 잡는다).
 * ⚠️ 러너 폴백 질문은 `category` 가 **null** 이다(runner.ts:181 — 넣지 않는다) → 배지 없음.
 */
const CATEGORY_LABEL: Record<string, string> = {
  best_in_category: "카테고리 1위",
  alternative: "대안 찾기",
  comparison: "비교",
  recommendation: "추천",
  problem_solving: "문제 해결",
  buying_guide: "구매 가이드",
  custom: "직접 추가",
};

/**
 * 묶음 표시 순서 — **GEO 중요도 순**이다(가나다순·enum 선언순이 아니다).
 *
 * 근거: 카테고리 1위·대안·비교 질문은 **경쟁 구도에서 우리가 불리는지**를 재고,
 *   추천·구매 가이드는 **브랜드 자체 노출**을 잰다. 앞의 셋이 GEO 에서 먼저 봐야 할 것이라
 *   위로 올린다(경쟁사 Overview 가 순위표를 위에 두는 것과 같은 이유).
 * ⚠️ 여기 없는 값은 뒤에 붙는다 — enum 이 늘어도 화면이 그 질문을 **잃지 않는다**.
 */
const TOPIC_ORDER = [
  "best_in_category",
  "comparison",
  "alternative",
  "recommendation",
  "buying_guide",
  "problem_solving",
  "custom",
];

/** 유형 없는(과거·러너 폴백) 질문이 모이는 칸. 마지막에 둔다. */
const UNTAGGED = "__untagged__";

/**
 * 질문을 유형별로 묶는다.
 *
 * 🔴 **묶음이 1칸이면 묶지 않는다**(호출부에서 판단) — 아코디언 한 칸은 장식이다.
 *   N-41 이 탭 6등분을 기각한 것과 같은 판단(쪼개서 빈 칸이 생기면 안 된다).
 */
function groupByTopic(prompts: PromptListItem[]): Array<{
  items: PromptListItem[];
  key: string;
}> {
  const buckets = new Map<string, PromptListItem[]>();
  for (const prompt of prompts) {
    const key = prompt.category ?? UNTAGGED;
    const bucket = buckets.get(key);
    if (bucket) {
      bucket.push(prompt);
    } else {
      buckets.set(key, [prompt]);
    }
  }
  return [...buckets.entries()]
    .map(([key, items]) => ({ key, items }))
    .sort((a, b) => {
      // 순서표에 없으면 뒤로(음수 방지 위해 큰 수로 치환).
      const ai = TOPIC_ORDER.indexOf(a.key);
      const bi = TOPIC_ORDER.indexOf(b.key);
      return (ai === -1 ? 99 : ai) - (bi === -1 ? 99 : bi);
    });
}

export const PromptList = ({
  prompts,
  onDelete,
  onEdit,
}: {
  /**
   * 삭제 실행자. 서버 컴포넌트가 `deletePromptAction` 을 넘긴다.
   * 없으면 삭제 버튼을 렌더하지 않는다 — 눌러도 아무 일 없는 버튼을 두지 않는다
   * (스토리·읽기전용 맥락에서 「가짜 컨트롤」이 생기는 것을 막는다).
   */
  onDelete?: (input: { promptId: string }) => Promise<DeletePromptResult>;
  /**
   * 수정 실행자(RICE#8). 없으면 편집 버튼을 렌더하지 않는다(위와 같은 이유).
   * `promptId` 는 그대로 두고 텍스트만 바꾼다 — 삭제와 달리 시계열이 보존된다.
   */
  onEdit?: (input: {
    promptId: string;
    text: string;
  }) => Promise<EditPromptResult>;
  prompts: PromptListItem[];
}) => {
  const router = useRouter();
  // 삭제 진행 중인 id. 낙관적 제거를 하지 않는다 — 실패 시 되돌리면
  //   "사라졌다 나타나는" 화면이 되고, 서버가 진실을 갖는 편이 정직하다.
  const [deleting, setDeleting] = useState<string | null>(null);
  // 확인 대기 중인 id(측정 기록이 있는 질문만).
  const [confirming, setConfirming] = useState<string | null>(null);
  // 편집 중인 id + 그 입력값. 낙관적 반영 없이 저장 성공 후 router.refresh() 로 갱신한다.
  const [editingId, setEditingId] = useState<string | null>(null);
  const [editingText, setEditingText] = useState("");
  const [saving, setSaving] = useState(false);

  const remove = async (prompt: PromptListItem) => {
    if (!onDelete) {
      return;
    }
    setDeleting(prompt.id);
    setConfirming(null);
    try {
      const result = await onDelete({ promptId: prompt.id });
      if ("error" in result) {
        toast.error(result.error);
        return;
      }
      toast.success(
        result.deletedTrackings > 0
          ? `질문을 지웠어요. 이 질문의 측정 기록 ${result.deletedTrackings}건도 함께 삭제됐어요.`
          : "질문을 지웠어요."
      );
      router.refresh();
    } catch {
      toast.error("삭제하지 못했어요. 잠시 후 다시 시도해 주세요.");
    } finally {
      setDeleting(null);
    }
  };

  const startEdit = (prompt: PromptListItem) => {
    setEditingId(prompt.id);
    setEditingText(prompt.text);
  };

  const cancelEdit = () => {
    setEditingId(null);
    setEditingText("");
  };

  const saveEdit = async (promptId: string) => {
    if (!onEdit) {
      return;
    }
    setSaving(true);
    try {
      const result = await onEdit({ promptId, text: editingText });
      if ("error" in result) {
        toast.error(result.error);
        return;
      }
      toast.success("질문을 고쳤어요. 이전 측정 기록은 그대로 남아요.");
      setEditingId(null);
      setEditingText("");
      router.refresh();
    } catch {
      toast.error("수정하지 못했어요. 잠시 후 다시 시도해 주세요.");
    } finally {
      setSaving(false);
    }
  };

  if (prompts.length === 0) {
    // 🔴 `keep-all` — 없으면 한국어가 어절 중간에서 끊긴다(모바일 실측: `골라보세/요`).
    return (
      <p
        className="rounded-lg border border-[color:var(--findable-hairline,#23252a)] border-dashed px-4 py-6 text-center text-[color:var(--findable-ink-subtle,#8a8f98)] text-sm"
        style={{ wordBreak: "keep-all" }}
      >
        아직 고른 질문이 없어요. 아래에서 제안을 받아 골라보세요.
      </p>
    );
  }

  // 🔴 **1칸이면 묶지 않는다.** 아코디언 한 칸은 장식이고, 무료 플랜은 질문이 5개라
  //   묶으면 `추천(3)`·`비교(2)` 처럼 접었다 펼 이유가 없는 칸이 된다.
  //   (N-41 이 탭 6등분을 기각한 것과 같은 판단 — 쪼개서 빈 칸을 만들지 않는다.)
  const groups = groupByTopic(prompts);

  const renderEditRow = (prompt: PromptListItem) => (
    <li
      className="flex items-start justify-between gap-3 rounded-lg border border-[color:var(--findable-primary,#ff7a4d)]/40 bg-[color:var(--findable-surface-1,#0f1011)] px-4 py-3"
      key={prompt.id}
    >
      <div className="flex min-w-0 flex-1 flex-col gap-1.5">
        <Input
          autoFocus
          disabled={saving}
          maxLength={200}
          onChange={(e) => setEditingText(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === "Enter") {
              saveEdit(prompt.id).catch(() => {
                // saveEdit 가 자체적으로 토스트를 띄운다.
              });
            } else if (e.key === "Escape") {
              cancelEdit();
            }
          }}
          value={editingText}
        />
        {/* 시계열이 보존된다는 사실을 편집 중에도 보여준다 — 고치는 이유가
            "오타 고치려다 기록 잃기 싫어서"인 경우가 많다. */}
        <span className="text-[10px] text-[color:var(--findable-ink-tertiary,#7e8289)]">
          {prompt.measuredCount > 0
            ? `저장하면 텍스트만 바뀌고, 측정 기록 ${prompt.measuredCount}건은 그대로 남아요.`
            : "저장하면 텍스트가 바뀌어요."}
        </span>
      </div>
      <div className="flex shrink-0 gap-1">
        <Button
          aria-label="수정 저장"
          disabled={saving || editingText.trim().length < 3}
          onClick={() => {
            saveEdit(prompt.id).catch(() => {
              // saveEdit 가 자체적으로 토스트를 띄운다.
            });
          }}
          size="sm"
          type="button"
          variant="ghost"
        >
          {saving ? (
            <Spinner className="size-3" />
          ) : (
            <CheckIcon aria-hidden="true" className="size-3.5" />
          )}
        </Button>
        <Button
          aria-label="수정 취소"
          disabled={saving}
          onClick={cancelEdit}
          size="sm"
          type="button"
          variant="ghost"
        >
          <XIcon aria-hidden="true" className="size-3.5" />
        </Button>
      </div>
    </li>
  );

  const renderRow = (prompt: PromptListItem) => {
    const isConfirming = confirming === prompt.id;
    const isDeleting = deleting === prompt.id;

    if (editingId === prompt.id) {
      return renderEditRow(prompt);
    }

    return (
      <li
        className="flex items-start justify-between gap-3 rounded-lg border border-[color:var(--findable-hairline,#23252a)] bg-[color:var(--findable-surface-1,#0f1011)] px-4 py-3"
        key={prompt.id}
      >
        <div className="flex min-w-0 flex-col gap-1.5">
          <span className="text-[color:var(--findable-ink,#f7f8f8)] text-sm">
            {prompt.text}
          </span>
          <span className="flex flex-wrap items-center gap-1.5">
            {prompt.category ? (
              <Badge
                className="border-transparent bg-[color:var(--findable-surface-2,#17181a)] text-[10px] text-[color:var(--findable-ink-subtle,#8a8f98)]"
                variant="outline"
              >
                {CATEGORY_LABEL[prompt.category] ?? prompt.category}
              </Badge>
            ) : null}
            <span className="text-[10px] text-[color:var(--findable-ink-tertiary,#7e8289)] uppercase">
              {prompt.language}
            </span>
            {/* 측정 횟수는 **분모를 밝히는 자리**다 — 이 질문이 실제로 쓰였는지
                    고객이 알 수 있어야 지울지 판단할 수 있다. */}
            <span className="text-[10px] text-[color:var(--findable-ink-tertiary,#7e8289)] tabular-nums">
              {prompt.measuredCount > 0
                ? `측정 ${prompt.measuredCount}건`
                : "아직 측정 전"}
            </span>
          </span>
          {/* 확인 문구는 **버튼 옆이 아니라 항목 안**에 — 무엇이 사라지는지
                  그 질문 바로 아래에서 읽혀야 한다. */}
          {isConfirming ? (
            <span className="text-[color:var(--findable-primary,#ff7a4d)] text-xs">
              이 질문의 측정 기록 {prompt.measuredCount}건도 함께 사라져요. 한
              번 더 누르면 삭제됩니다.
            </span>
          ) : null}
        </div>

        <div className="flex shrink-0 gap-1">
          {onEdit ? (
            <Button
              aria-label={`${prompt.text} 수정`}
              disabled={isDeleting}
              onClick={() => startEdit(prompt)}
              size="sm"
              type="button"
              variant="ghost"
            >
              <PencilIcon aria-hidden="true" className="size-3.5" />
            </Button>
          ) : null}
          {onDelete ? (
            <Button
              aria-label={`${prompt.text} 삭제`}
              disabled={isDeleting}
              onClick={() => {
                // 측정 기록이 없으면 잃을 게 없다 → 바로 삭제.
                if (prompt.measuredCount === 0 || isConfirming) {
                  remove(prompt).catch(() => {
                    // remove 가 자체적으로 토스트를 띄운다 — 여기선 삼키기만 한다.
                  });
                  return;
                }
                setConfirming(prompt.id);
              }}
              size="sm"
              type="button"
              variant="ghost"
            >
              {isDeleting ? (
                <Spinner className="size-3" />
              ) : (
                <>
                  <Trash2Icon aria-hidden="true" className="size-3.5" />
                  {isConfirming ? (
                    <span className="ml-1 text-xs">삭제 확인</span>
                  ) : null}
                </>
              )}
            </Button>
          ) : null}
        </div>
      </li>
    );
  };

  /*
   * 🔴 **묶어서 얻는 게 없으면 묶지 않는다.**
   *   판정 기준은 **묶음 개수가 아니라 「2칸 이상인 묶음이 있는가」** 다.
   *   > 사고(N-43 스크린샷): 조건이 `groups.length <= 1` 이었다 — **묶음 개수**를 셌다.
   *   > 질문 5개가 유형이 다 달라 **1칸짜리 묶음 5개**가 그려졌다(제목 5줄이 늘기만 함).
   *   > 검증 스토리(`한유형뿐_묶지않음`)는 *한 유형만 있는* 경우만 봐서 이 구멍을 놓쳤다.
   *   묶어서 얻는 게 있으려면 **둘 다** 필요하다:
   *     ① 묶음이 2개 이상 — 1개면 제목 한 줄이 전부를 덮어 비교가 안 된다(기존 조건)
   *     ② 2칸 이상인 묶음이 하나라도 있음 — 전부 1칸이면 제목만 늘어난다(N-43 이 놓친 것)
   *   ⚠️ ①을 빼면 `추천 2` 한 칸만 있는 화면에 장식 제목이 생긴다(원래 가드가 막던 경우다).
   */
  const hasCluster =
    groups.length > 1 && groups.some((group) => group.items.length > 1);

  if (!hasCluster) {
    return <ul className="flex flex-col gap-1.5">{prompts.map(renderRow)}</ul>;
  }

  return (
    <div className="flex flex-col gap-4">
      {groups.map((group) => (
        <section className="flex flex-col gap-1.5" key={group.key}>
          {/* 묶음 제목에 **개수를 함께** 적는다 — 어느 유형에 질문이 몰려 있는지가
              한눈에 보여야 "무엇을 더 넣을지" 판단할 수 있다(모집단 명시 규율). */}
          <h3 className="flex items-baseline gap-1.5 px-1 font-medium text-[color:var(--findable-ink-subtle,#8a8f98)] text-xs">
            {group.key === UNTAGGED
              ? "유형 없음"
              : (CATEGORY_LABEL[group.key] ?? group.key)}
            <span className="text-[color:var(--findable-ink-tertiary,#7e8289)] tabular-nums">
              {group.items.length}
            </span>
          </h3>
          <ul className="flex flex-col gap-1.5">
            {group.items.map(renderRow)}
          </ul>
        </section>
      ))}
    </div>
  );
};
