import { auth } from "@repo/auth/server";
import { database } from "@repo/database";
import { log } from "@repo/observability/log";
import { getAppDictionary } from "@/lib/i18n";

/**
 * 질문 변경 이력(2026-10-14 · 설계원칙 4) — 기존 추세 차트 주석(`Annotation`)에 남긴다.
 * 새 테이블·마이그레이션 없이, 차트의 그날 위치에 「질문이 바뀌었어요」가 꽂혀 기준선이 바뀐 지점이 보인다.
 *
 * - 이미 측정 이력이 있는 브랜드만 남긴다(첫 질문 세트는 기준선의 시작이지 '변경'이 아니다).
 * - best-effort: 이력 기록이 실패해도 질문 저장·수정·삭제를 막지 않는다.
 */
export type QuestionChange =
  | { count: number; kind: "added" }
  | { kind: "deleted" | "edited" | "archived" | "restored"; text: string };

const LABEL_MAX = 60;

const clip = (value: string) =>
  value.length <= LABEL_MAX ? value : `${value.slice(0, LABEL_MAX - 1)}…`;

export async function recordQuestionChange(
  brandId: string,
  change: QuestionChange
): Promise<void> {
  try {
    const hasHistory = await database.tracking.findFirst({
      where: { brandId },
      select: { id: true },
    });
    if (!hasHistory) {
      return;
    }
    const t = (await getAppDictionary()).annotations;
    const label =
      change.kind === "added"
        ? t.questionAdded.replace("{n}", String(change.count))
        : {
            archived: t.questionArchived,
            deleted: t.questionDeleted,
            edited: t.questionEdited,
            restored: t.questionRestored,
          }[change.kind].replace("{text}", change.text);
    const { userId } = await auth();
    await database.annotation.create({
      data: {
        brandId,
        occurredAt: new Date(),
        label: clip(label),
        createdBy: userId ?? null,
      },
    });
  } catch (error) {
    log.warn("brand.question_change_log.failed", {
      brandId,
      kind: change.kind,
      error: error instanceof Error ? error.message : "unknown",
    });
  }
}
