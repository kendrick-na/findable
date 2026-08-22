"use server";

import { auth } from "@repo/auth/server";
import { database } from "@repo/database";
import { log } from "@repo/observability/log";
import { revalidatePath } from "next/cache";
import { scopedBrandById } from "@/lib/db/scoped";

/**
 * 추세 차트 수동 주석 — 생성/삭제 (감사 D2, 2026-08-07 세션N-8).
 *
 * 왜 수동인가(자동 핀이 아니라): 리서치 원본 `02_SEO_SaaS_대시보드_패턴.md:48-53` 의
 * Sistrix 자동 핀은 **가시성 ≥15.5%p 변동** 시 꽂힌다. 그런데 우리 실측 델타는
 * `[0, 0, 0, 0, +97]` 이고 +97 은 측정 실패→복구 아티팩트다 — 임계값을 뭘로 잡아도
 * 핀이 "측정 실패 지점"에만 꽂힌다(이벤트가 아니라 오류 표시).
 * 반면 같은 리서치가 GSC 수동 주석을 *"무료인데 명료함의 기준점"* 으로 꼽았고,
 * Sistrix 자신도 초록 핀(사용자 주석)을 함께 준다.
 * **변화의 원인(보도자료·콘텐츠 발행·경쟁사 캠페인)은 고객만 안다** — 시스템이 추측할 수
 * 없는 정보라 수동이 먼저다. 자동 핀은 재측정이 쌓여 분포가 생긴 뒤에 판단한다.
 *
 * 🔴 org 격리: `Annotation` 은 org 컬럼이 없다(brand 경유). 모든 write 앞에
 * `scopedBrandById()` 로 **그 브랜드가 내 org 소속인지** 먼저 확인한다 —
 * 없으면 남의 브랜드 id 를 폼에 넣어 주석을 심을 수 있다.
 */

const LABEL_MAX = 60;

export type AnnotationResult = { ok: true } | { ok: false; error: string };

export async function createAnnotation(
  brandId: string,
  occurredAt: string,
  label: string
): Promise<AnnotationResult> {
  const { userId } = await auth();
  if (!userId) {
    return { ok: false, error: "로그인이 필요해요." };
  }

  const trimmed = label.trim();
  if (!trimmed) {
    return { ok: false, error: "무슨 일이 있었는지 적어주세요." };
  }
  if (trimmed.length > LABEL_MAX) {
    return { ok: false, error: `${LABEL_MAX}자 이내로 적어주세요.` };
  }

  const when = new Date(occurredAt);
  if (Number.isNaN(when.getTime())) {
    return { ok: false, error: "날짜를 다시 확인해주세요." };
  }

  // 🔴 소유 검증 — 이게 없으면 남의 브랜드에 주석을 심을 수 있다.
  const brand = await scopedBrandById(brandId);
  if (!brand) {
    return { ok: false, error: "브랜드를 찾을 수 없어요." };
  }

  await database.annotation.create({
    data: { brandId, occurredAt: when, label: trimmed, createdBy: userId },
  });
  log.info("annotation.created", { brandId, userId });

  revalidatePath("/");
  return { ok: true };
}

export async function deleteAnnotation(id: string): Promise<AnnotationResult> {
  const { userId } = await auth();
  if (!userId) {
    return { ok: false, error: "로그인이 필요해요." };
  }

  // 삭제도 org 검증이 필요하다 — id 만으로 지우면 남의 주석을 지울 수 있다.
  //   Annotation 은 org 컬럼이 없으므로 brand 경유로 확인한다.
  const target = await database.annotation.findUnique({
    where: { id },
    select: { brandId: true },
  });
  if (!target) {
    return { ok: false, error: "이미 지워진 메모예요." };
  }
  const brand = await scopedBrandById(target.brandId);
  if (!brand) {
    return { ok: false, error: "권한이 없어요." };
  }

  await database.annotation.delete({ where: { id } });
  log.info("annotation.deleted", { id, userId });

  revalidatePath("/");
  return { ok: true };
}
