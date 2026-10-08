/** @vitest-environment node */
import { deflateRawSync } from "node:zlib";
import { describe, expect, test, vi } from "vitest";

vi.mock("server-only", () => ({}));

const http = await import("@/lib/ax-mail/sources/http");
const nts = await import("@/lib/ax-mail/sources/nts-status");
const fsc = await import("@/lib/ax-mail/sources/fsc-corp");
const nps = await import("@/lib/ax-mail/sources/nps-workplace");
const mfds = await import("@/lib/ax-mail/sources/mfds-cosmetics");
const dart = await import("@/lib/ax-mail/sources/opendart");
const card = await import("@/lib/ax-mail/sources/company-card");

/*
 * 픽스처 = 2026-10-06 실측 응답의 **모양**만 옮긴 것(인증키·요청 URL 없음).
 * 값은 공개 공공데이터(바이오센서연구소(주) = Franz 운영 법인)에서 일부만 발췌.
 */
const BIZ = "1198672928";

const FSC_BODY = {
  response: {
    header: { resultCode: "00", resultMsg: "NORMAL SERVICE." },
    body: {
      numOfRows: 10,
      pageNo: 1,
      totalCount: 3,
      items: {
        item: [
          {
            corpNm: "바이오센서연구소",
            crno: "1101115152288",
            bzno: BIZ,
            enpRprFnm: "정석근",
            enpEstbDt: "20130605",
            enpEmpeCnt: "20",
            enpBsadr: "서울특별시 관악구 관악로 1",
            enpDtadr: "",
            enpHmpgUrl: "",
            smenpYn: "Y",
            corpRegMrktDcdNm: "",
            sicNm: "",
            enpMainBizNm: "",
            fstOpegDt: "20260130",
            lastOpegDt: "20260630",
          },
          {
            corpNm: "바이오센서연구소",
            crno: "1101115152288",
            bzno: BIZ,
            enpRprFnm: "장명훈",
            enpEstbDt: "20130605",
            enpEmpeCnt: "20",
            enpBsadr: "서울특별시 관악구 관악로 1",
            fstOpegDt: "20240603",
            lastOpegDt: "20260129",
          },
          {
            corpNm: "다른회사",
            crno: "9999999999999",
            bzno: "1234567890",
            enpRprFnm: "홍길동",
            lastOpegDt: "20260630",
          },
        ],
      },
    },
  },
};

const NPS_SEARCH = {
  response: {
    header: { resultCode: "00", resultMsg: "NORMAL_CODE" },
    body: {
      items: {
        item: [
          {
            bzowrRgstNo: "119867****",
            dataCrtYm: "202607",
            seq: 6_121_074,
            wkplJnngStcd: "1",
            wkplNm: "바이오센서연구소（주）",
            wkplRoadNmDtlAddr: "서울특별시 금천구 가산디지털2로",
          },
          {
            bzowrRgstNo: "119867****",
            dataCrtYm: "202608",
            seq: 6_713_444,
            wkplJnngStcd: "1",
            wkplNm: "바이오센서연구소（주）",
            wkplRoadNmDtlAddr: "서울특별시 금천구 가산디지털2로",
          },
          {
            bzowrRgstNo: "555555****",
            dataCrtYm: "202608",
            seq: 1,
            wkplJnngStcd: "1",
            wkplNm: "바이오센서연구소（주）",
            wkplRoadNmDtlAddr: "부산",
          },
          {
            bzowrRgstNo: "119867****",
            dataCrtYm: "202608",
            seq: 2,
            wkplJnngStcd: "1",
            wkplNm: "에스디바이오센서",
            wkplRoadNmDtlAddr: "경기",
          },
        ],
      },
      numOfRows: 100,
      pageNo: 1,
      totalCount: 4,
    },
  },
};

const NPS_DETAIL = {
  response: {
    header: { resultCode: "00", resultMsg: "NORMAL_CODE" },
    body: {
      items: {
        item: [
          {
            adptDt: "20130701",
            jnngpCnt: 24,
            scsnDt: "00010101",
            vldtVlKrnNm: "배전반 및 전기 자동제어반 제조업",
            wkplNm: "바이오센서연구소（주）",
          },
        ],
      },
      totalCount: 1,
    },
  },
};

const NPS_PERIOD = {
  response: {
    header: { resultCode: "00", resultMsg: "NORMAL_CODE" },
    body: {
      items: { item: [{ lssJnngpCnt: 4, nwAcqzrCnt: 1 }] },
      totalCount: 1,
    },
  },
};

const MFDS_BODY = {
  header: { resultCode: "00", resultMsg: "NORMAL SERVICE." },
  body: {
    pageNo: 1,
    totalCount: 2,
    numOfRows: 5,
    items: [
      {
        INDUTY: "화장품책임판매",
        ENTP_SEQ: "20160800",
        ENTP_NAME: "바이오센서연구소(주)",
        ENTP_PERMIT_DATE: "20160330",
        FACTORY_ADDR: "서울특별시 관악구",
        BIZRNO: BIZ,
      },
      {
        INDUTY: "화장품제조",
        ENTP_SEQ: "2023016100",
        ENTP_NAME: "바이오센서연구소(주)",
        ENTP_PERMIT_DATE: "20231113",
        FACTORY_ADDR: "경기도 시흥시",
        BIZRNO: BIZ,
      },
    ],
  },
};

const NTS_BODY = {
  request_cnt: 1,
  match_cnt: 1,
  status_code: "OK",
  data: [
    {
      b_no: BIZ,
      b_stt: "계속사업자",
      b_stt_cd: "01",
      tax_type: "부가가치세 일반과세자",
      tax_type_cd: "01",
      end_dt: "",
      utcc_yn: "N",
    },
  ],
};

const DART_COMPANY = {
  status: "000",
  message: "정상",
  corp_code: "00126380",
  corp_name: "삼성전자(주)",
  stock_code: "005930",
  ceo_nm: "전영현, 노태문",
  corp_cls: "Y",
  jurir_no: "1301110006246",
  bizr_no: "1248100998",
  adres: "경기도 수원시 영통구  삼성로 129 (매탄동)",
  hm_url: "www.samsung.com/sec",
  est_dt: "19690113",
};

const DART_FN = {
  status: "000",
  message: "정상",
  list: [
    {
      bsns_year: "2025",
      fs_div: "CFS",
      sj_div: "BS",
      account_nm: "자산총계",
      thstrm_amount: "566,942,110,000,000",
      rcept_no: "20260310002820",
      currency: "KRW",
    },
    {
      bsns_year: "2025",
      fs_div: "OFS",
      sj_div: "IS",
      account_nm: "매출액",
      thstrm_amount: "238,043,009,000,000",
      rcept_no: "20260310002820",
      currency: "KRW",
    },
    {
      bsns_year: "2025",
      fs_div: "CFS",
      sj_div: "IS",
      account_nm: "매출액",
      thstrm_amount: "333,605,938,000,000",
      rcept_no: "20260310002820",
      currency: "KRW",
    },
  ],
};

describe("공통 파서", () => {
  test("사업자번호·회사명·날짜 정규화", () => {
    expect(http.normalizeBizNo("119-86-72928")).toBe(BIZ);
    expect(http.normalizeBizNo("119-86")).toBeNull();
    expect(http.normalizeCorpName("바이오센서연구소（주）")).toBe(
      http.normalizeCorpName("(주) 바이오센서연구소")
    );
    expect(http.ymd("20130605")).toBe("2013-06-05");
    expect(http.ymd("00010101")).toBeNull();
    expect(http.num("1,234")).toBe(1234);
  });

  test("data.go.kr 껍데기 2종 + 단건 객체", () => {
    expect(http.dataGoKrItems(FSC_BODY).items).toHaveLength(3);
    expect(http.dataGoKrItems(MFDS_BODY).items).toHaveLength(2);
    const single = {
      response: {
        header: { resultCode: "00" },
        body: { items: { item: { a: 1 } } },
      },
    };
    expect(http.dataGoKrItems(single).items).toEqual([{ a: 1 }]);
    expect(http.dataGoKrItems("<xml/>").items).toEqual([]);
  });
});

describe("국세청 상태조회", () => {
  test("계속사업자 + 과세유형", () => {
    expect(nts.parseNtsStatus(NTS_BODY, BIZ)).toEqual({
      bizNo: BIZ,
      closedOn: null,
      state: "active",
      stateLabel: "계속사업자",
      taxType: "부가가치세 일반과세자",
      taxTypeCode: "01",
    });
  });
  test("폐업 / 오류 응답", () => {
    const closed = {
      ...NTS_BODY,
      data: [
        {
          ...NTS_BODY.data[0],
          b_stt_cd: "03",
          b_stt: "폐업자",
          end_dt: "20250101",
        },
      ],
    };
    expect(nts.parseNtsStatus(closed, BIZ)?.state).toBe("closed");
    expect(nts.parseNtsStatus(closed, BIZ)?.closedOn).toBe("2025-01-01");
    expect(
      nts.parseNtsStatus({ code: -5, msg: "API 서버 오류" }, BIZ)
    ).toBeNull();
  });
  test("키 없으면 호출하지 않고 null", async () => {
    vi.stubEnv("DATA_GO_KR_SERVICE_KEY", "");
    const spy = vi.spyOn(globalThis, "fetch");
    expect(await nts.fetchNtsStatus(BIZ)).toBeNull();
    expect(spy).not.toHaveBeenCalled();
    spy.mockRestore();
    vi.unstubAllEnvs();
  });
  test("503 이어도 throw 하지 않는다", async () => {
    vi.stubEnv("DATA_GO_KR_SERVICE_KEY", "test-key");
    const spy = vi
      .spyOn(globalThis, "fetch")
      .mockResolvedValue(new Response("{}", { status: 503 }));
    const warn = vi.spyOn(console, "warn").mockImplementation(() => undefined);
    expect(await nts.fetchNtsStatus(BIZ)).toBeNull();
    // 로그에는 상태 코드만 — 키가 섞이면 안 된다
    expect(JSON.stringify(warn.mock.calls)).not.toContain("test-key");
    spy.mockRestore();
    warn.mockRestore();
    vi.unstubAllEnvs();
  });
});

describe("금융위 기업기본정보", () => {
  test("같은 법인 여러 행 → 최신 행, 사업자번호로 필터", () => {
    const rows = fsc.parseFscOutline(FSC_BODY, BIZ);
    expect(rows).toHaveLength(1);
    expect(rows[0]).toMatchObject({
      asOf: "2026-06-30",
      bizNo: BIZ,
      employeeCount: 20,
      foundedOn: "2013-06-05",
      homepage: null,
      isSme: true,
      representative: "정석근",
    });
    expect(fsc.parseFscOutline(FSC_BODY)).toHaveLength(2);
  });
});

describe("국민연금 사업장", () => {
  test("이름 정규화 완전일치 + 사업자번호 앞 6자리, 최신 달 먼저", () => {
    const rows = nps.parseNpsSearch(NPS_SEARCH, {
      businessNumber: BIZ,
      name: "바이오센서연구소(주)",
    });
    expect(rows.map((r) => r.month)).toEqual(["202608", "202607"]);
    expect(rows.every((r) => r.bizNoPrefix === "119867")).toBe(true);
  });
  test("상세·기간 파서", () => {
    expect(nps.parseNpsDetail(NPS_DETAIL)).toEqual({
      industry: "배전반 및 전기 자동제어반 제조업",
      members: 24,
      registeredOn: "2013-07-01",
    });
    expect(nps.parseNpsPeriod(NPS_PERIOD)).toEqual({
      lost: 4,
      newlyEnrolled: 1,
    });
  });
  test("성장 신호 ±10%", () => {
    const m = (month: string, members: number | null) => ({
      lost: null,
      members,
      month,
      newlyEnrolled: null,
    });
    expect(nps.growthSignal([m("202608", 24), m("202603", 30)])).toEqual({
      delta: -6,
      signal: "shrinking",
    });
    expect(nps.growthSignal([m("202608", 33), m("202603", 30)])).toEqual({
      delta: 3,
      signal: "growing",
    });
    expect(nps.growthSignal([m("202608", 31), m("202603", 30)]).signal).toBe(
      "flat"
    );
    expect(nps.growthSignal([m("202608", 31)]).signal).toBe("unknown");
  });
  test("fetch 흐름: 검색 → 달별 상세·기간", async () => {
    vi.stubEnv("DATA_GO_KR_SERVICE_KEY", "test-key");
    const spy = vi.spyOn(globalThis, "fetch").mockImplementation((input) => {
      const url = String(input);
      let body: unknown = NPS_PERIOD;
      if (url.includes("getBassInfoSearchV2")) {
        body = NPS_SEARCH;
      } else if (url.includes("getDetailInfoSearchV2")) {
        body = NPS_DETAIL;
      }
      return Promise.resolve(Response.json(body));
    });
    const result = await nps.fetchNpsWorkplace({
      businessNumber: BIZ,
      name: "바이오센서연구소(주)",
    });
    expect(result?.months).toHaveLength(2);
    expect(result?.months[0]).toEqual({
      lost: 4,
      members: 24,
      month: "202608",
      newlyEnrolled: 1,
    });
    expect(result?.workplacesInLatestMonth).toBe(1);
    expect(result?.growth.signal).toBe("flat");
    spy.mockRestore();
    vi.unstubAllEnvs();
  });
});

describe("식약처 화장품업", () => {
  test("책임판매·제조 구분", () => {
    const page = mfds.parseMfdsList(MFDS_BODY);
    expect(page?.totalCount).toBe(2);
    expect(page?.items.map((i) => i.kind)).toEqual([
      mfds.MFDS_RESPONSIBLE_SELLER,
      mfds.MFDS_MANUFACTURER,
    ]);
    expect(page?.items[0]).toMatchObject({
      bizNo: BIZ,
      permittedOn: "2016-03-30",
    });
  });
});

describe("OpenDART", () => {
  test("ZIP 해제(node:zlib) + 고유번호 XML", () => {
    const xml = Buffer.from(
      `<?xml version="1.0" encoding="UTF-8"?><result><list><corp_code>00126380</corp_code><corp_name>삼성전자</corp_name><stock_code>005930</stock_code></list><list><corp_code>00854997</corp_code><corp_name>에스디바이오센서</corp_name><stock_code> </stock_code></list><list><corp_code>00000001</corp_code><corp_name>A&amp;B</corp_name><stock_code> </stock_code></list></result>`,
      "utf8"
    );
    const zip = makeZip("CORPCODE.xml", xml);
    const out = dart.unzipFirstEntry(zip);
    expect(out?.toString("utf8")).toBe(xml.toString("utf8"));
    const list = dart.parseCorpCodeXml(xml.toString("utf8"));
    expect(list).toHaveLength(3);
    expect(list[2]?.corpName).toBe("A&B");
    const index = dart.buildCorpCodeIndex(list);
    // 부분일치 금지 — "바이오센서"로 에스디바이오센서가 걸리면 안 된다
    expect(dart.lookupCorpCodes(index, "바이오센서연구소(주)")).toEqual([]);
    expect(dart.lookupCorpCodes(index, "삼성전자(주)")[0]?.corpCode).toBe(
      "00126380"
    );
  });
  test("기업개황", () => {
    expect(dart.parseDartCompany(DART_COMPANY)).toMatchObject({
      bizNo: "1248100998",
      ceo: "전영현, 노태문",
      corpClass: "Y",
      foundedOn: "1969-01-13",
    });
    expect(
      dart.parseDartCompany({
        status: "013",
        message: "조회된 데이타가 없습니다.",
      })
    ).toBeNull();
  });
  test("매출 — 연결 우선, 사업연도·접수번호 동반", () => {
    expect(dart.parseDartRevenue(DART_FN)).toEqual({
      amount: 333_605_938_000_000,
      currency: "KRW",
      fiscalYear: "2025",
      fsDiv: "CFS",
      receiptNo: "20260310002820",
    });
    const noRevenue = {
      ...DART_FN,
      list: DART_FN.list.filter((r) => r.sj_div === "BS"),
    };
    expect(dart.parseDartRevenue(noRevenue)).toBeNull();
  });
});

describe("회사 카드 병합", () => {
  const AT = "2026-10-06T03:00:00.000Z";
  const fscRows = fsc.parseFscOutline(FSC_BODY, BIZ);
  const npsResult = {
    address: "서울특별시 금천구 가산디지털2로",
    growth: { delta: -6, signal: "shrinking" as const },
    industry: "배전반 및 전기 자동제어반 제조업",
    months: [{ lost: 4, members: 24, month: "202608", newlyEnrolled: 1 }],
    name: "바이오센서연구소（주）",
    registeredOn: "2013-07-01",
    workplacesInLatestMonth: 1,
  };

  test("사업자번호 일치 → exact, 칸마다 출처, 매출 없음은 null", () => {
    const result = card.mergeCompanyCard(
      {
        businessNumber: "119-86-72928",
        domain: "https://www.franzskincare.com/",
        name: "바이오센서연구소(주)",
      },
      {
        fsc: fscRows,
        mfds: mfds.parseMfdsList(MFDS_BODY),
        nps: npsResult,
        nts: null,
        opendart: { ambiguous: false, company: null, revenue: null },
      },
      AT
    );
    expect(result.match.confidence).toBe("exact");
    expect(result.query.domain).toBe("franzskincare.com");
    expect(result.legalName).toEqual({
      asOf: "2026-06-30",
      fetchedAt: AT,
      source: "fsc",
      value: "바이오센서연구소",
    });
    expect(result.representative?.value).toBe("정석근");
    expect(result.employeeCount?.value).toBe(20);
    expect(result.homepage).toMatchObject({
      source: "input",
      value: "franzskincare.com",
    });
    expect(result.industry?.source).toBe("nps");
    expect(result.pension?.asOf).toBe("2026-08");
    expect(result.cosmeticsLicenses?.value).toHaveLength(2);
    // 매출은 DART 에만 의존 — 없으면 비운다(추정 금지)
    expect(result.revenue).toBeNull();
    expect(result.businessStatus).toBeNull();
    expect(result.sources).toEqual({
      fsc: "ok",
      mfds: "ok",
      nps: "ok",
      nts: "unavailable",
      opendart: "no_match",
    });
  });

  test("DART 가 있으면 DART 우선 + 매출에 연도·출처", () => {
    const company = dart.parseDartCompany(DART_COMPANY);
    const revenue = dart.parseDartRevenue(DART_FN);
    const result = card.mergeCompanyCard(
      { businessNumber: "124-81-00998", name: "삼성전자" },
      { opendart: { ambiguous: false, company, revenue } },
      AT
    );
    expect(result.match.confidence).toBe("exact");
    expect(result.legalName?.source).toBe("opendart");
    expect(result.revenue).toEqual({
      asOf: "2025",
      fetchedAt: AT,
      source: "opendart",
      value: {
        amount: 333_605_938_000_000,
        currency: "KRW",
        fiscalYear: "2025",
        fsDiv: "CFS",
        receiptNo: "20260310002820",
      },
    });
    expect(result.sources.fsc).toBe("skipped");
  });

  test("사업자번호 없이 이름만 → name_only, 후보 여럿이면 ambiguous 로 비운다", () => {
    const onlyName = card.mergeCompanyCard(
      { name: "바이오센서연구소" },
      { fsc: fscRows },
      AT
    );
    expect(onlyName.match.confidence).toBe("name_only");

    const ambiguous = card.mergeCompanyCard(
      { name: "바이오센서연구소" },
      { fsc: fsc.parseFscOutline(FSC_BODY) },
      AT
    );
    expect(ambiguous.sources.fsc).toBe("ambiguous");
    expect(ambiguous.legalName).toBeNull();
    expect(ambiguous.match.confidence).toBe("none");
  });

  test("모든 소스 사용 불가 → 빈 카드(throw 없음)", () => {
    const empty = card.mergeCompanyCard(
      { name: "없는회사" },
      { fsc: null, nps: null, opendart: null },
      AT
    );
    expect(empty.match.confidence).toBe("none");
    expect(empty.legalName).toBeNull();
    expect(empty.sources.opendart).toBe("unavailable");
  });
});

/** 테스트용 최소 ZIP(파일 1개, deflate) — 로컬 헤더 크기 0(data descriptor 흉내)로 중앙 디렉터리 경로 검증 */
function makeZip(name: string, data: Buffer): Buffer {
  const nameBuf = Buffer.from(name, "utf8");
  const compressed = deflateRawSync(data);
  const local = Buffer.alloc(30);
  local.writeUInt32LE(0x04_03_4b_50, 0);
  local.writeUInt16LE(20, 4);
  local.writeUInt16LE(8, 8);
  local.writeUInt16LE(nameBuf.length, 26);
  const cen = Buffer.alloc(46);
  cen.writeUInt32LE(0x02_01_4b_50, 0);
  cen.writeUInt16LE(8, 10);
  cen.writeUInt32LE(compressed.length, 20);
  cen.writeUInt32LE(data.length, 24);
  cen.writeUInt16LE(nameBuf.length, 28);
  cen.writeUInt32LE(0, 42);
  const cenOffset = local.length + nameBuf.length + compressed.length;
  const eocd = Buffer.alloc(22);
  eocd.writeUInt32LE(0x06_05_4b_50, 0);
  eocd.writeUInt16LE(1, 8);
  eocd.writeUInt16LE(1, 10);
  eocd.writeUInt32LE(cen.length + nameBuf.length, 12);
  eocd.writeUInt32LE(cenOffset, 16);
  return Buffer.concat([local, nameBuf, compressed, cen, nameBuf, eocd]);
}
