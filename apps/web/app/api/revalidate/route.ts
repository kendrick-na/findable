import { denyIfNotCron } from "@repo/security/cron";
import { revalidatePath } from "next/cache";
import { submitToIndexNow } from "@/lib/indexnow";

/**
 * `/api/revalidate` — **앱(대시보드)에서 웹의 캐시를 무효화하는 유일한 경로.**
 *
 * 🔴🔴 **왜 필요한가**(2026-09-02): `apps/app` 의 발행 액션이
 *   `revalidatePath("/ko/p/...")` 를 호출하고 있었는데, `apps/app` 과 `apps/web` 은
 *   **서로 다른 Vercel 배포**다(프로젝트 `findable-app` · `findable`).
 *   Next 의 `revalidatePath` 는 **자기 배포의 캐시만** 건드리므로 그 호출은 **무효**였다.
 *   = 고객사가 대시보드에서 글을 고쳐 재발행해도 공개 페이지는 ISR 주기(1시간)까지
 *     옛 내용을 보여줬다. 화면에는 "발행됨" 이라고 떠 있으니 아무도 원인을 모른다.
 *   📕 [[feedback_screen_shows_intent_db_shows_fact]] 와 같은 계열의 함정이다.
 *
 * 🔒 인증은 cron 과 **같은 가드**(`CRON_SECRET`)를 쓴다. 시크릿이 없으면 **닫는다**.
 *   ⚠️ `CRON_SECRET` 은 **두 Vercel 프로젝트에 같은 값**으로 있어야 한다(env parity).
 *     앱에 없으면 앱 쪽 호출이 조용히 건너뛰어지고, 웹은 401 로 막는다 —
 *     어느 쪽도 발행 자체를 실패시키지 않는다.
 *
 * 📥 body: `{ "paths": ["/ko/insights", "/ko/p/foo/bar"] }`
 *   경로만 받는다(태그·전체 무효화는 받지 않는다 — 남이 우리 캐시를 통째로 비우게 할 이유가 없다).
 */

const MAX_PATHS = 20;
const ALLOWED_PATH_RE = /^\/(?:ko|en)?\/?[\w\-/.%가-힣]*$/u;

export async function POST(request: Request): Promise<Response> {
  const denied = denyIfNotCron(request);
  if (denied) {
    return denied;
  }

  let paths: unknown;
  try {
    const body = (await request.json()) as { paths?: unknown };
    paths = body.paths;
  } catch {
    return Response.json({ error: "invalid_json" }, { status: 400 });
  }

  if (!Array.isArray(paths) || paths.length === 0) {
    return Response.json({ error: "paths_required" }, { status: 400 });
  }

  const safePaths = paths
    .filter((path): path is string => typeof path === "string")
    .map((path) => path.trim())
    .filter(
      (path) =>
        path.startsWith("/") &&
        !path.includes("..") &&
        ALLOWED_PATH_RE.test(path)
    )
    .slice(0, MAX_PATHS);

  if (safePaths.length === 0) {
    return Response.json({ error: "no_valid_paths" }, { status: 400 });
  }

  for (const path of safePaths) {
    revalidatePath(path);
  }

  // 캐시를 비운 뒤 **검색엔진에 통지**한다(네이버 등 IndexNow 참여 엔진. 구글은 미지원).
  // 대시보드에서 즉시 발행한 경우가 이 경로를 탄다.
  const submitted = await submitToIndexNow(safePaths);

  return Response.json({
    revalidated: safePaths,
    indexNowSubmitted: submitted,
  });
}
