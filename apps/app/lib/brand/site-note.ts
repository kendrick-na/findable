/** "한 줄 소개" 입력(2026-10-14) — 화면과 서버액션이 같은 상한·정리 규칙을 쓴다(client 컴포넌트에서 상수를 import 하지 않기 위해 분리). */
export const SITE_NOTE_MAX = 300;

// biome-ignore lint/suspicious/noControlCharactersInRegex: 제어 문자 제거가 목적이다.
const CONTROL_RE = /[\u0000-\u001f\u007f]/g;
const SPACE_RE = /\s+/g;

/** 앞뒤 공백·제어 문자를 정리하고 300자로 자른다. */
export const cleanSiteNote = (value: string | undefined): string =>
  (value ?? "")
    .replace(CONTROL_RE, " ")
    .replace(SPACE_RE, " ")
    .trim()
    .slice(0, SITE_NOTE_MAX);
