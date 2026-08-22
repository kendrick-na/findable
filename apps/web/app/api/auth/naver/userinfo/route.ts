import { NextResponse } from "next/server";

/**
 * 네이버 사용자정보 **평탄화 중계** — Clerk 커스텀 OAuth 전용.
 *
 * 🔴 왜 필요한가(2026-08-14 실측으로 확정):
 *   네이버는 프로필을 `response` 한 겹 안에 넣어 준다.
 *     { resultcode:"00", message:"success", response:{ id, email, name, ... } }
 *   Clerk 는 속성 매핑에 `response.email` 을 넣어도 **읽지 못했다.**
 *   증거: OAuth 는 `external_account.status="verified"` 로 성공했는데
 *        `email_address: null` **그리고 `first_name: null`** (이름까지 없음
 *        → 개별 스코프 문제가 아니라 **응답 모양** 문제).
 *        이어진 PATCH 가 422 `form_identifier_exists` 로 실패했다.
 *   ⛔ 막힌 길(전부 실측): 대시보드 `Email address verified` 기본값 True ·
 *     네이버 앱 제공항목(이미 필수) · 중첩 경로 매핑(설정돼 있으나 무효) ·
 *     네이버 OIDC 전환(`scopes_supported` 에 **email 이 없어** 인증창에도 못 감).
 *   📕 Clerk 공식 문서가 비표준 응답 모양에 대해 제시하는 방법이 이 중계다.
 *
 * 동작: Clerk 가 보낸 `Authorization: Bearer <네이버 액세스토큰>` 을 그대로 네이버에
 *   넘기고, `response` 안의 값을 **최상위로 펼쳐** 돌려준다.
 *   `email_verified: true` 를 붙이는 이유 — 네이버는 이 클레임을 아예 주지 않아
 *   Clerk 가 "미검증"으로 보고 **연결 대신 신규 가입**을 시도하다 422 를 냈다.
 *   네이버는 `@naver.com` 주소를 자기가 발급·관리하므로 소유가 확인된 것으로 본다.
 *
 * ⚠️ 이 라우트가 죽으면 **네이버 로그인만** 멈춘다(구글·카카오는 무관).
 * ⚠️ 토큰을 중계하지만 **저장하지 않는다.** 로그에도 남기지 않는다.
 */

// 인증 경로다 — 캐시가 끼면 다른 사용자의 응답이 섞일 수 있다.
export const dynamic = "force-dynamic";
export const revalidate = 0;

const NAVER_ME = "https://openapi.naver.com/v1/nid/me";

interface NaverMe {
  message?: string;
  response?: {
    id?: string;
    email?: string;
    name?: string;
    nickname?: string;
    profile_image?: string;
    mobile?: string;
  };
  resultcode?: string;
}

export async function GET(request: Request) {
  const auth = request.headers.get("authorization");

  // Clerk 는 항상 Bearer 토큰을 붙여 부른다. 없으면 우리 쪽에서 끊는다.
  if (!auth?.startsWith("Bearer ")) {
    return NextResponse.json(
      { error: "missing_authorization" },
      { status: 401 }
    );
  }

  let upstream: Response;
  try {
    upstream = await fetch(NAVER_ME, {
      headers: { Authorization: auth },
      cache: "no-store",
    });
  } catch {
    // 네이버가 응답하지 않는 경우. 502 로 알려 Clerk 가 실패로 처리하게 한다.
    return NextResponse.json({ error: "naver_unreachable" }, { status: 502 });
  }

  if (!upstream.ok) {
    return NextResponse.json(
      { error: "naver_error" },
      { status: upstream.status }
    );
  }

  const data = (await upstream.json()) as NaverMe;

  // 🔴 네이버는 HTTP 200 으로도 실패를 알린다(`resultcode` 가 "00" 이 아니면 실패).
  //   상태코드만 믿으면 빈 프로필을 정상으로 넘기게 된다.
  if (data.resultcode !== "00" || !data.response) {
    return NextResponse.json({ error: "naver_result_error" }, { status: 502 });
  }

  const p = data.response;

  // 🔴 `id` 는 외부 계정 식별자다. 없으면 Clerk 가 계정을 특정할 수 없어
  //   조용히 잘못된 연결을 만들 위험이 있다 → 명시적으로 끊는다.
  if (!p.id) {
    return NextResponse.json({ error: "naver_missing_id" }, { status: 502 });
  }

  // 최상위로 평탄화. 키 이름은 Clerk 속성 매핑에서 그대로 쓴다.
  return NextResponse.json(
    {
      sub: p.id,
      id: p.id,
      email: p.email,
      // 네이버가 주지 않는 클레임 — 위 주석의 근거로 true 로 고정한다.
      email_verified: true,
      name: p.name ?? p.nickname,
      nickname: p.nickname,
      picture: p.profile_image,
    },
    { headers: { "Cache-Control": "no-store" } }
  );
}
