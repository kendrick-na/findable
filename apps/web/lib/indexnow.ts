import "server-only";

import { log } from "@repo/observability/log";
import { SITE_ORIGIN } from "@/lib/public-url";

/**
 * IndexNow 색인 통지 — **발행·수정한 URL 을 검색엔진에 즉시 알린다.**
 *
 * 🔴 **왜 필요한가**(2026-09-02): 발행 파이프라인에 색인 통지가 **없었다.**
 *   사이트맵은 "여기 있다"는 수동 신호일 뿐이고(존 뮬러: *"사이트맵은 명령이 아니라 신호"*),
 *   신생 도메인(등록 2026-04-16)은 크롤러가 자주 오지 않는다. 새 글이 며칠 방치될 수 있다.
 *   고객사 블로그를 파는 제품에서 "발행했는데 검색에 없다"는 가장 아픈 구멍이다.
 *
 * 📐 규격(공식 문서 확인 2026-09-02 · indexnow.org/documentation):
 *   `POST /indexnow` · `Content-Type: application/json; charset=utf-8` ·
 *   body `{ host, key, keyLocation, urlList }` · **1회 최대 10,000 URL**.
 *   전역 엔드포인트로 보내면 *"submitted URLs will be automatically shared with all other
 *   participating search engines"* — 참여 엔진 목록에 **네이버**가 있고
 *   개별 엔드포인트는 `https://searchadvisor.naver.com/indexnow?url=…&key=…` 다(공식 FAQ).
 *
 * ⚠️ **구글은 IndexNow 를 지원하지 않는다**(2021-10 테스트 후 미지원, 1차 리서치 §1-8).
 *   구글 쪽 신선도 수단은 사이트맵 `lastmod` 정확도와 내부 링크뿐이다.
 *
 * ⚠️ **커스텀 도메인 글은 여기서 통지하지 않는다.** 정본이 고객 호스트면 그 호스트의
 *   키로 제출해야 한다(우리 키로는 남의 호스트 URL 을 제출할 수 없다 — 프로토콜 규칙).
 */

/**
 * IndexNow 키. **프로토콜상 공개 값**이다 — 검색엔진이 `https://{host}/{key}.txt` 를
 * 직접 읽어 소유를 확인하므로 숨길 수 없고 숨길 이유도 없다(시크릿이 아니다).
 *
 * 🔴 **`apps/web/public/{이 값}.txt` 파일과 반드시 같아야 한다.** 키를 갈면 **둘을 함께** 간다.
 *   `INDEXNOW_KEY` 로 덮어쓸 수 있다(키 교체 중 배포 순서를 맞출 때 사용).
 */
const INDEXNOW_KEY =
  process.env.INDEXNOW_KEY ?? "7810a16b-73bb-46f8-95db-6358d794700b";

/** 전역 엔드포인트 — 참여 엔진 전체(네이버 포함)로 전파된다. */
const INDEXNOW_ENDPOINT = "https://api.indexnow.org/indexnow";

/** 한 번에 보낼 상한. 공식 상한은 10,000 이지만 발행 1건이 만드는 URL 은 몇 개뿐이다. */
const MAX_URLS = 50;

/**
 * 경로 목록을 우리 도메인 절대 URL 로 바꿔 통지한다.
 * 실패해도 **발행을 막지 않는다**(색인 통지는 보조 수단이다).
 */
export async function submitToIndexNow(paths: string[]): Promise<number> {
  // 로컬·프리뷰에서 실제 검색엔진을 부르지 않는다(존재하지 않는 URL 을 신고하게 된다).
  if (
    process.env.NODE_ENV !== "production" ||
    process.env.VERCEL_ENV === "preview"
  ) {
    return 0;
  }

  const origin = new URL(SITE_ORIGIN);
  const urlList = [
    ...new Set(
      paths
        .filter((path) => path.startsWith("/"))
        .map((path) => `${origin.origin}${path}`)
    ),
  ].slice(0, MAX_URLS);

  if (urlList.length === 0) {
    return 0;
  }

  try {
    const response = await fetch(INDEXNOW_ENDPOINT, {
      method: "POST",
      headers: { "content-type": "application/json; charset=utf-8" },
      body: JSON.stringify({
        host: origin.host,
        key: INDEXNOW_KEY,
        keyLocation: `${origin.origin}/${INDEXNOW_KEY}.txt`,
        urlList,
      }),
      cache: "no-store",
    });
    if (!response.ok) {
      // 422 = 키 파일과 키가 불일치, 403 = 키 검증 실패(공식 상태코드 표).
      log.warn("indexnow rejected", {
        status: response.status,
        hint:
          response.status === 403 || response.status === 422
            ? `키 파일 /${INDEXNOW_KEY}.txt 이 서비스되는지, 값이 같은지 확인`
            : undefined,
        count: urlList.length,
      });
      return 0;
    }
    return urlList.length;
  } catch (error) {
    log.warn("indexnow submit failed", {
      error: error instanceof Error ? error.message : String(error),
      count: urlList.length,
    });
    return 0;
  }
}
