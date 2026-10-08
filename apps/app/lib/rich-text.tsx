import { Fragment, type ReactNode } from "react";

const TOKEN = /(\{[a-zA-Z]+\})/g;
const TOKEN_NAME = /^\{([a-zA-Z]+)\}$/;

/**
 * 사전 문장 속 `{name}` 자리에 **요소**(굵은 글씨·링크 등)를 끼워 넣는다(2026-10-06).
 *
 * 왜: 「브랜드는 답변에 <strong>42%</strong> 등장했습니다」 같은 문장을 사전으로 옮길 때
 *   앞·뒤 조각으로 쪼개면 영어 어순을 못 맞춘다. 문장 하나 + 자리표시자로 두면
 *   언어마다 자리를 자유롭게 옮길 수 있다.
 * ⚠️ 값이 없는 자리표시자는 그대로 남긴다 — 빠진 값을 조용히 지우면 문장이 거짓말이 된다.
 */
export function fillRich(
  template: string,
  values: Record<string, ReactNode>
): ReactNode {
  // 같은 조각이 두 번 나와도 키가 겹치지 않게 「내용#몇 번째」로 만든다.
  const seen = new Map<string, number>();
  return template.split(TOKEN).map((part) => {
    const name = TOKEN_NAME.exec(part)?.[1];
    const content = name !== undefined && name in values ? values[name] : part;
    const nth = (seen.get(part) ?? 0) + 1;
    seen.set(part, nth);
    return <Fragment key={`${part}#${nth}`}>{content}</Fragment>;
  });
}
