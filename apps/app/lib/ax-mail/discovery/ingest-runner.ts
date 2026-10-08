import "server-only";

import { listFscCorps } from "../sources/fsc-corp";
import { listFtcMailOrderSellers } from "../sources/ftc-mail-order";
import {
  fetchMfdsCosmetics,
  mfdsToDiscovered,
} from "../sources/mfds-cosmetics";
import { listNpsWorkplaces } from "../sources/nps-bulk";
import {
  dartToDiscovered,
  fetchDartCompanyByCode,
  listDartCorps,
} from "../sources/opendart";
import { isMissingTableError } from "./guard";
import {
  type CompanyStore,
  type IngestResult,
  ingestCompanies,
} from "./ingest";
import type { DiscoveredCompany } from "./types";

/**
 * 관리자 「데이터 불러오기」 — API 원천마다 **작은 1페이지**만 받아 적재한다(수동 버튼, 크론 아님).
 *
 * 파일 원천(벤처기업명단·이노비즈·메인비즈·국민연금 월별 CSV·통신판매 주간 CSV)은 여기서 받지 않는다 —
 * 공공데이터포털에서 내려받는 수동 단계가 그대로다.
 * 키가 없거나 원천이 응답하지 않으면 그 원천만 unavailable — 다른 원천은 계속한다.
 */

export const API_SOURCES = [
  "fsc",
  "nps",
  "mfds",
  "ftc_mail_order",
  "opendart",
] as const;

export type ApiSource = (typeof API_SOURCES)[number];

export type SourceFetcher = () => Promise<DiscoveredCompany[] | null>;

export interface IngestSourceResult {
  fetched: number;
  result: IngestResult | null;
  source: ApiSource;
  status: "ok" | "unavailable" | "error";
}

/** 한 번 누를 때 원천별로 받는 행 수 — 국민연금은 행마다 상세 1회가 더 들어 작게 둔다. */
export const PAGE_ROWS = 50;
const NPS_ROWS = 20;
const DART_LISTED_ROWS = 10;
/** 국민연금 목록은 지역 코드가 필수 — 서울(11)부터. */
const NPS_SIDO = "11";

export function defaultFetchers(pageNo = 1): Record<ApiSource, SourceFetcher> {
  return {
    fsc: async () =>
      (await listFscCorps({ numOfRows: PAGE_ROWS, pageNo }))?.items ?? null,
    nps: async () =>
      (
        await listNpsWorkplaces({
          numOfRows: NPS_ROWS,
          pageNo,
          sidoCode: NPS_SIDO,
          withDetail: true,
        })
      )?.items ?? null,
    mfds: async () => {
      const page = await fetchMfdsCosmetics({ numOfRows: PAGE_ROWS, pageNo });
      return page ? page.items.map(mfdsToDiscovered) : null;
    },
    ftc_mail_order: async () =>
      (await listFtcMailOrderSellers({ numOfRows: PAGE_ROWS, pageNo }))
        ?.items ?? null,
    opendart: async () => {
      const listed = await listDartCorps({ listedOnly: true });
      if (!listed) {
        return null;
      }
      const start = (pageNo - 1) * DART_LISTED_ROWS;
      const slice = listed.slice(start, start + DART_LISTED_ROWS);
      const out: DiscoveredCompany[] = [];
      for (const corp of slice) {
        out.push(
          dartToDiscovered(corp, await fetchDartCompanyByCode(corp.corpCode))
        );
      }
      return out;
    },
  };
}

export async function runDiscoveryIngest(
  store: CompanyStore,
  fetchers: Record<ApiSource, SourceFetcher>,
  options: { fetchedAt?: Date; sources?: readonly ApiSource[] } = {}
): Promise<IngestSourceResult[]> {
  const results: IngestSourceResult[] = [];
  for (const source of options.sources ?? API_SOURCES) {
    try {
      const items = await fetchers[source]();
      if (!items) {
        results.push({
          fetched: 0,
          result: null,
          source,
          status: "unavailable",
        });
        continue;
      }
      const result = await ingestCompanies(store, items, {
        fetchedAt: options.fetchedAt,
      });
      results.push({ fetched: items.length, result, source, status: "ok" });
    } catch (error) {
      // 테이블 없음은 원천 문제가 아니다 — 화면이 「DB 준비 전」으로 바꾸도록 그대로 던진다.
      if (isMissingTableError(error)) {
        throw error;
      }
      results.push({ fetched: 0, result: null, source, status: "error" });
    }
  }
  return results;
}
