/**
 * 표본 진단 1건 — **화면 두 곳이 같은 것을 가리키게 하는 단일 출처**.
 *
 * 🔬 표본 선정 근거(DB 실측 · N-16): SK하이닉스 회차는 **엔진 29/29 전건 측정 성공**.
 * 🔒 `?shared=1`(공유뷰) — 신청자 이메일을 숨긴다(라이브 검증 완료).
 *
 * 🔴 **왜 상수로 뺐나**(N-44): 가입 직후 화면(`dashboard-empty-state-server`)과
 *   측정 대기 화면(`measuring/page`)이 **같은 표본**을 보여준다. 각자 id 를 들면
 *   한쪽만 바뀌어 **두 화면이 다른 회차를 가리키게** 된다.
 *   📕 이 저장소는 도메인 정규식이 세 번 복제돼 갈라진 사고를 이미 겪었다.
 */
const SAMPLE_AUDIT_ID = "d732a13a-9c3b-48ad-a9a0-7ea80f69e328";

/** @param webUrl `env.NEXT_PUBLIC_WEB_URL` — 서버에서만 읽어 넘긴다(뷰는 env 를 모른다). */
export const sampleReportUrl = (webUrl: string): string =>
  `${webUrl}/audit/${SAMPLE_AUDIT_ID}?shared=1`;
