/**
 * 재측정 알림 발송 판정 회귀 테스트 (투두 #68, 2026-08-08 세션N-11).
 *
 * 여기서 지키는 것 = **"조용한 주에는 메일이 안 나간다"**. 이게 깨지면 알림이
 * 스팸으로 학습되어, 정작 중요한 변화도 열리지 않는다(유료 축 = 시간·비교·알림).
 *
 * ⚠️ app 에 두는 이유: 이 저장소에서 vitest 가 설정된 곳이 `apps/app` 뿐이다
 *   (`packages/audit` 엔 vitest 미설치 — 새 의존성 추가는 별건).
 *
 * @vitest-environment node
 */

import {
  DIGEST_MIN_DELTA_POINTS,
  selectDigestEntries,
} from "@repo/audit/digest-filter";
import { describe, expect, it } from "vitest";

describe("selectDigestEntries", () => {
  it("임계값 이상 변화만 고른다", () => {
    const entries = selectDigestEntries([
      { brandName: "설화수", deltaPoints: 7, score: 68 },
      { brandName: "메디큐브", deltaPoints: 1, score: 51 }, // 잡음 — 제외
    ]);
    expect(entries).toEqual([
      { brandName: "설화수", deltaPoints: 7, score: 68 },
    ]);
  });

  it("🔴 변화가 없으면 빈 배열 = 발송하지 않는다", () => {
    expect(
      selectDigestEntries([
        { brandName: "A", deltaPoints: 0, score: 60 },
        { brandName: "B", deltaPoints: 2, score: 55 },
        { brandName: "C", deltaPoints: -2, score: 40 },
      ])
    ).toEqual([]);
  });

  it("하락도 알린다 (부호가 아니라 크기로 판정)", () => {
    const entries = selectDigestEntries([
      { brandName: "A", deltaPoints: -9, score: 41 },
    ]);
    expect(entries).toHaveLength(1);
    expect(entries[0]?.deltaPoints).toBe(-9);
  });

  it("첫 측정(비교 대상 없음)은 알림 대상이 아니다", () => {
    expect(
      selectDigestEntries([{ brandName: "A", deltaPoints: null, score: 60 }])
    ).toEqual([]);
  });

  it("점수 계산이 실패한 회차는 제외한다 (지어내지 않는다)", () => {
    expect(
      selectDigestEntries([{ brandName: "A", deltaPoints: 10, score: null }])
    ).toEqual([]);
  });

  it("변화가 큰 순으로 정렬한다 — 하락이 더 커도 앞에 온다", () => {
    const entries = selectDigestEntries([
      { brandName: "작은상승", deltaPoints: 4, score: 60 },
      { brandName: "큰하락", deltaPoints: -12, score: 30 },
      { brandName: "중간상승", deltaPoints: 8, score: 70 },
    ]);
    expect(entries.map((e) => e.brandName)).toEqual([
      "큰하락",
      "중간상승",
      "작은상승",
    ]);
  });

  it("임계값 경계 — 딱 임계값이면 보낸다", () => {
    expect(
      selectDigestEntries([
        { brandName: "A", deltaPoints: DIGEST_MIN_DELTA_POINTS, score: 60 },
      ])
    ).toHaveLength(1);
    expect(
      selectDigestEntries([
        { brandName: "A", deltaPoints: DIGEST_MIN_DELTA_POINTS - 1, score: 60 },
      ])
    ).toHaveLength(0);
  });

  it("임계값은 주입할 수 있다 (측정 누적 후 재조정 대비)", () => {
    const candidates = [{ brandName: "A", deltaPoints: 5, score: 60 }];
    expect(selectDigestEntries(candidates, 10)).toHaveLength(0);
    expect(selectDigestEntries(candidates, 5)).toHaveLength(1);
  });

  it("빈 입력은 빈 출력", () => {
    expect(selectDigestEntries([])).toEqual([]);
  });
});
