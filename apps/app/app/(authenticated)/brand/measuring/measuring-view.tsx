"use client";

import { useRouter } from "next/navigation";
import { useEffect, useRef, useState } from "react";

/**
 * 측정 대기 화면 — 재설계안 v2 §4-c.
 *
 * Profound 실측(영상 OCR)에서 가져온 것: **한 화면에 한 가지 · 압도적 여백 · 중앙 정렬**.
 *   대표님이 "토스 같다"고 한 이유가 이것이다.
 *
 * 🔴 **가져오지 않은 것 = 침묵.** Profound 는 2분 20초 동안 아무 진행 표시가 없다
 *   (닐슨 10 "시스템 상태 가시성" 위반 — 멈춘 건지 도는 건지 알 수 없다).
 *
 * 🔴🔴 **그렇다고 "3/7곳" 같은 단계 표시를 만들지 않는다 — 만들 수 없다.**
 *   실측(2026-08-14): `AuditJob` 에 엔진별 진행 필드가 **없고**, 러너는 status 를
 *   `processing` 으로 **딱 한 번** 쓴다(runner.ts:224). 폴링이 돌려주는 값도
 *   queued/processing/completed/failed 넷뿐이다(tracking-status.ts).
 *   → 엔진 진행률을 그리면 **화면이 지어낸 숫자**가 된다. 설계안 §4-c 가 스스로 정한
 *     조건("실시간이 아니면 소요 시간 안내만 · 가짜 진행률은 만들지 않는다")을 따른다.
 *
 * 그래서 정직하게 말할 수 있는 것만 말한다:
 *   ① 지금 무엇을 하는 중인지(측정 중) ② 보통 얼마나 걸리는지 ③ 끝나면 어떻게 되는지.
 */

// StartTrackingButton 과 **같은 값**을 쓴다. 갈라지면 두 화면이 서로 다른 시점에
//   "아직 진행 중"이라고 말하게 된다.
const POLL_INTERVAL_MS = 8000;
const POLL_TIMEOUT_MS = 4 * 60 * 1000;

/**
 * 대기 중 순환 무드 카피 — 감성적 카피 방향(2026-08-21 결정, Otterly 실측 참조).
 *
 * 🔴 엔진명·수치("ChatGPT 확인 중", "3/7곳 완료")는 넣지 않는다 — 위 주석의 이유 그대로,
 *   `AuditJob` 에 엔진별 진행 필드가 없어 지어낸 숫자가 된다.
 * ✅ 대신 백엔드가 **실제로 하는 일**(runner.ts)을 문구로 옮긴다 — 지어낸 무드가 아니라
 *   "AI 여러 곳에 묻고 · 답변에서 언급 찾고 · 경쟁사도 같이 본다"는 실제 동작 그대로.
 */
const MOOD_PHRASES = [
  "AI 여러 곳에 당신의 브랜드를 묻고 있어요",
  "답변 속에서 브랜드 언급을 찾고 있어요",
  "경쟁사도 함께 살펴보고 있어요",
  "찾은 내용을 리포트로 정리하고 있어요",
  "곧 결과를 보여드릴게요",
];
const MOOD_ROTATE_MS = 4000;

type ViewState = "measuring" | "slow" | "failed";

export const MeasuringView = ({
  jobId,
  domain,
  pollStatus,
  sampleUrl,
}: {
  jobId: string;
  /** 무엇을 측정 중인지. 지금 화면에서 유일하게 개인화된 정보다. */
  domain: string | null;
  /**
   * 진행 상태 폴링 — **주입받는다**(N-44).
   *
   * 🔴 `@/app/actions/...` 를 여기서 import 하면 `server-only` 가 브라우저 번들에
   *   딸려와 **스토리가 통째로 죽는다**(실측: *"This module cannot be imported from a
   *   Client Component"*). 📕N-37·N-41 주입 패턴 — 서버 의존은 껍데기가 먹는다.
   */
  pollStatus: (jobId: string) => Promise<string>;
  /**
   * 실제 진단 1건(표본) 링크 — **지금 기다리는 그것이 어떻게 생겼는지**.
   *
   * 🔬 프로파운드 실물 문법(f048 실측): 좌측 = 지금 할 일 하나 / 우측 = **그 일의 설명**.
   *   그쪽은 온보딩 첫 화면 우측에 `프롬프트 실행 중…` 스피너와 결과 꺾은선을 두고
   *   *"당신이 기다릴 것이 이렇게 생겼다"* 를 보여준다.
   *   → 여기에 넣는 것도 **대기의 설명**이라 같은 문법이다(무관한 작업이 아니다).
   *
   * ⛔ 초대코드·요금제는 넣지 않는다 — 기다림과 무관한 별개 작업이고,
   *   초대코드 입력은 이미 `/billing` 상단에 있다(같은 걸 두 곳에 두지 않는다).
   *   ⚠️ 가격 숫자는 이 화면에 **0곳**이다(카카오페이 심사 동결).
   *
   * ⚠️ 서버 의존(`env`)은 페이지가 먹고 값만 내려온다 — 📕N-37·N-41 주입 패턴.
   */
  sampleUrl: string;
}) => {
  const router = useRouter();
  const [view, setView] = useState<ViewState>("measuring");
  const [moodIndex, setMoodIndex] = useState(0);
  const [moodVisible, setMoodVisible] = useState(true);
  const timerRef = useRef<ReturnType<typeof setInterval> | null>(null);

  // 순환 무드 카피 — measuring 상태에서만 돈다. 폴링 타이머와는 독립적.
  useEffect(() => {
    if (view !== "measuring") {
      return;
    }
    const rotate = setInterval(() => {
      setMoodVisible(false);
      setTimeout(() => {
        setMoodIndex((i) => (i + 1) % MOOD_PHRASES.length);
        setMoodVisible(true);
      }, 300);
    }, MOOD_ROTATE_MS);
    return () => clearInterval(rotate);
  }, [view]);

  useEffect(() => {
    const startedAt = Date.now();
    const stop = () => {
      if (timerRef.current) {
        clearInterval(timerRef.current);
        timerRef.current = null;
      }
    };

    timerRef.current = setInterval(async () => {
      // 4분이 넘으면 폴링을 멈춘다. 🔴 "실패"라 부르지 않는다 — 백그라운드 실행이라
      //   대개 **계속 돌고 있다**. 없는 실패를 알리면 사용자가 원가를 또 쓰게 만든다.
      if (Date.now() - startedAt > POLL_TIMEOUT_MS) {
        stop();
        setView("slow");
        return;
      }
      try {
        const status = await pollStatus(jobId);
        if (status === "completed") {
          stop();
          // 결과가 있는 곳으로. replace = 뒤로가기로 대기 화면에 돌아오지 않게 한다.
          router.replace("/");
        } else if (status === "failed") {
          stop();
          setView("failed");
        }
        // queued/processing/not_found → 다음 폴링까지 대기.
        //   ⚠️ not_found 로 즉시 실패 처리하지 않는다: 방금 만든 job 이 복제 지연으로
        //   잠깐 안 잡힐 수 있고, 그때 "실패"라 말하면 거짓이 된다.
      } catch {
        // 일시적 네트워크 오류는 다음 폴링에서 재시도.
      }
    }, POLL_INTERVAL_MS);

    return stop;
  }, [jobId, router, pollStatus]);

  return (
    // 중앙 정렬 + 압도적 여백(Profound). 화면 전체를 쓰되 내용은 가운데 한 덩어리.
    <div className="flex min-h-[70vh] flex-col items-center justify-center gap-6 px-6 text-center">
      {view === "measuring" && (
        <>
          {/* 진행 "률"이 아니라 **살아있다는 신호**. 숫자를 지어내지 않으면서
              멈춘 게 아님을 보여주는 유일하게 정직한 표현이다. */}
          <div aria-hidden="true" className="flex items-center gap-1.5">
            {[0, 1, 2].map((i) => (
              <span
                className="size-2 animate-pulse rounded-full bg-[color:var(--findable-primary,#ff7a4d)]"
                key={i}
                style={{ animationDelay: `${i * 0.25}s` }}
              />
            ))}
          </div>

          <div className="flex flex-col gap-2">
            <h1
              aria-live="polite"
              className="font-semibold text-2xl text-[color:var(--findable-ink,#f7f8f8)]"
            >
              AI 7곳에 물어보고 있어요
            </h1>
            {domain ? (
              <p className="text-[color:var(--findable-ink-subtle,#8a8f98)]">
                {domain}
              </p>
            ) : null}
          </div>

          {/* 순환 무드 카피 — aria-hidden: 진행 상태가 아니라 분위기이므로
              스크린리더가 매번 새로 읽지 않게 한다(제목의 aria-live 만으로 충분). */}
          <p
            aria-hidden="true"
            className={`text-[color:var(--findable-ink-subtle,#8a8f98)] text-sm transition-opacity duration-300 ${
              moodVisible ? "opacity-100" : "opacity-0"
            }`}
          >
            {MOOD_PHRASES[moodIndex]}
          </p>

          <div className="flex flex-col gap-1">
            <p className="text-[color:var(--findable-ink-tertiary,#7e8289)] text-sm">
              보통 1~3분 걸려요. 끝나면 자동으로 결과 화면으로 넘어가요.
            </p>
            {/* 기다림을 강제하지 않는다 — 러너는 서버 백그라운드에서 돈다. */}
            <p className="text-[color:var(--findable-ink-tertiary,#7e8289)] text-sm">
              이 화면을 닫아도 측정은 계속돼요.
            </p>
          </div>
        </>
      )}

      {view === "slow" && (
        <div className="flex flex-col gap-3">
          <h1 className="font-semibold text-2xl text-[color:var(--findable-ink,#f7f8f8)]">
            측정이 조금 오래 걸리고 있어요
          </h1>
          <p className="text-[color:var(--findable-ink-subtle,#8a8f98)]">
            멈춘 건 아니에요. 결과가 나오면 대시보드에 반영돼요.
          </p>
        </div>
      )}

      {view === "failed" && (
        <div className="flex flex-col gap-3">
          <h1 className="font-semibold text-2xl text-[color:var(--findable-ink,#f7f8f8)]">
            측정에 실패했어요
          </h1>
          <p className="text-[color:var(--findable-ink-subtle,#8a8f98)]">
            브랜드는 등록됐어요. 측정만 다시 시작하면 돼요.
          </p>
        </div>
      )}

      {/* 기다리는 동안 **지금 기다리는 것**이 어떻게 생겼는지 보여준다(위 sampleUrl 주석).
          ⚠️ 측정 중일 때만 — 실패·지연 화면에서는 다른 말을 할 때다. */}
      {view === "measuring" && (
        <a
          className="text-[color:var(--findable-primary,#ff7a4d)] text-sm underline-offset-4 hover:underline"
          href={sampleUrl}
          rel="noopener noreferrer"
          target="_blank"
        >
          결과가 이렇게 나와요 — 실제 진단 보기
        </a>
      )}

      {/* 나가는 문은 항상 열어둔다(닐슨 3 "사용자 통제"). 상태와 무관하게 같은 자리. */}
      <div className="flex flex-wrap items-center justify-center gap-2">
        <a
          className="findable-btn-secondary inline-flex items-center rounded-md border border-[color:var(--findable-hairline,#23252a)] px-4 py-2 font-medium text-sm"
          href="/"
        >
          대시보드로 가기
        </a>
        {view !== "measuring" && (
          <a
            className="inline-flex items-center rounded-md px-4 py-2 font-medium text-[color:var(--findable-ink-subtle,#8a8f98)] text-sm"
            href="/brand"
          >
            브랜드 목록
          </a>
        )}
      </div>
    </div>
  );
};
