/** @vitest-environment node */
import { afterEach, describe, expect, test, vi } from "vitest";

vi.mock("server-only", () => ({}));

const csv = await import("@/lib/ax-mail/sources/csv");
const venture = await import("@/lib/ax-mail/sources/venture-list");
const inno = await import("@/lib/ax-mail/sources/innobiz-mainbiz");
const ftc = await import("@/lib/ax-mail/sources/ftc-mail-order");
const npsBulk = await import("@/lib/ax-mail/sources/nps-bulk");
const fsc = await import("@/lib/ax-mail/sources/fsc-corp");
const dart = await import("@/lib/ax-mail/sources/opendart");
const mfds = await import("@/lib/ax-mail/sources/mfds-cosmetics");

/*
 * 픽스처 = 2026-10-07 실측 파일·응답의 **모양**(헤더·빈 값 표기·껍데기)을 옮긴 것.
 * 회사명·사업자번호는 공개 공공데이터 일부 발췌, 대표자 이름은 가명으로 바꿨다. 인증키·요청 URL 없음.
 */

const VENTURE_CSV = [
  "﻿연번,업체명,대표자명(익명),벤처확인유형,지역,주소,업종분류(기보),업종명(11차),주생산품,벤처유효시작일,벤처유효종료일,벤처확인기관,신규_재확인",
  "1,주식회사 디플리,이**,혁신성장유형,서울,서울특별시 마포구,정보처리S/W,그 외 기타 정보 서비스업,소프트웨어,2023-06-07,2026-06-06,벤처기업확인기관,재확인",
  "2,㈜트루퍼스아시아,이**,벤처투자유형,서울,서울특별시 강남구,제조업,화장품 제조업,화장품 및 섬유탈취제,2024-04-30,2027-04-29,벤처기업확인기관,신규",
  '3,주식회사 지에스,최**,혁신성장유형,경기,경기도 용인시,제조업,그 외 기타 특수목적용 기계 제조업,"계량시스템 및 전자저울, 자동화장비",2023-05-31,2026-05-30,벤처기업확인기관,재확인',
  "4,,김**,연구개발유형,부산,부산광역시 해운대구,제조업,,,2023-05-31,2026-05-30,벤처기업확인기관,신규",
].join("\r\n");

const INNOBIZ_PRODUCTS_CSV = [
  "연번,지역,업체명,대표자,사업자번호,주생산품,확인서유효기간시작일,확인서유효기간종료일,홈페이지",
  '1,경기,(주) 신흥테크,"홍길동, 김철수",1378623411,윙바디 앞뒷 guard assy,2026-06-15,2029-06-14,',
  "2,경기,(주) 알파칩스,홍길동,1358158772,반도체설계,2026-01-13,2029-01-12,www.alphachips.co.kr",
  "3,경기,(주)그린팩,홍길동,1278642366,플라스틱 화장품 용기,2026-02-19,2029-02-18,",
].join("\n");

const INNOBIZ_STATUS_CSV = [
  "연번,업체명,대표자,사업자번호,관련업종,지역,확인서유효기간종료일",
  "2,(주) 알파칩스,홍길동,1358158772,전기전자,경기,2029-01-12",
].join("\n");

const MAINBIZ_CSV = [
  "번호,사업자명,사업자등록번호,대표자명,업종,지역,인증만료일",
  '1,(주)극동엠이에스,1058600333,"홍길동, 김철수",도소매업,서울,2026-08-01',
  "3,주식회사코리녹스,6038129936,홍길동,제조업,부산,2026-08-02",
].join("\n");

const FTC_CSV = [
  "통신판매번호,신고기관명,상호,사업자등록번호,법인여부,대표자명,전화번호,전자우편,신고일자,사업장소재지,사업장소재지(도로명),업소상태,신고기관 대표연락처,판매방식,취급품목,인터넷도메인,호스트서버소재지",
  "N/A,서울특별시 강남구,(주)이엠티투어,220-87-34425,법인,홍길동,565-0000,a@example.com,null,서울특별시 송파구 방이동 84번지,null,폐업처리,02-3423-5382,null,null,null,null",
  "2026-서울강남-05568,서울특별시 강남구,더호 특허법인,765-86-01639,법인,홍길동,010-개인정보,chs@example.com,20261006,서울특별시 강남구 도곡동 412-3,서울특별시 강남구 논현로38길 14^ 3층 (도곡동),정상영업,02-3423-5382,인터넷,기타,www.tmclick.co.kr,null",
  "2026-서울강남-05566,서울특별시 강남구,바로체인플렛폼,619-52-01118,개인,홍**,010-개인정보,2to**@naver.com,20261006,서울특별시 강남구 대치동 ***-*,서울특별시 강남구 역삼로 *** *층,정상영업,02-3423-5382,인터넷,종합몰 교육/도서/완구/오락 의류/패션/잡화/뷰티,https://sell.smartstore.naver.com/,경기도 성남시",
].join("\r\n");

const NPS_CSV = [
  "자료생성년월,사업장명,사업자등록번호,사업장가입상태코드 1 등록 2 탈퇴,우편번호,사업장지번상세주소,사업장도로명상세주소,고객법정동주소코드,고객행정동주소코드,법정동주소광역시도코드,법정동주소광역시시군구코드,법정동주소광역시시군구읍면동코드,사업장형태구분코드 1 법인 2 개인,사업장업종코드,사업장업종코드명,적용일자,재등록일자,탈퇴일자,가입자수,당월고지금액,신규취득자수,상실가입자수",
  "2026-08,우성기전(주),126811,1,12816,경기도 광주시 도척면,경기도 광주시 도척면 도척윗로,4161033025,4161033000,41,610,330,1,292201,동력식 수지 공구 제조업,1988-01-01,,,4,938400,0,0",
  "2026-08,(주)신영인사이트,201853,2,04536,서울특별시 중구 명동2가,서울특별시 중구 명동8길,1114012700,1114055000,11,140,127,1,701201,비주거용 건물 임대업,1988-01-01,,2026-07-01,0,0,0,0",
  "2026-08,(주)포유이엔지/일용/서울숲 신축공사,303813,1,,,,,,11,200,114,1,281104,육상 금속 골조 구조재 제조업,2026-04-16,,,7,3829400,0,0",
].join("\n");

afterEach(() => {
  vi.unstubAllEnvs();
  vi.unstubAllGlobals();
});

describe("CSV 공통", () => {
  test("따옴표 안 쉼표·CRLF·BOM·빈 줄", () => {
    const rows = csv.parseCsv('﻿a,b\r\n"x, y","z ""q"""\r\n\r\n1,2');
    expect(rows).toEqual([
      ["a", "b"],
      ["x, y", 'z "q"'],
      ["1", "2"],
    ]);
  });
  test("인코딩 — UTF-8 BOM / CP949 자동 판별", () => {
    const utf8 = new Uint8Array([
      0xef,
      0xbb,
      0xbf,
      ...new TextEncoder().encode("가,나"),
    ]);
    expect(csv.decodeCsvBytes(utf8)).toBe("가,나");
    // EUC-KR "가" = B0 A1
    expect(csv.decodeCsvBytes(new Uint8Array([0xb0, 0xa1, 0x2c, 0x31]))).toBe(
      "가,1"
    );
  });
  test("pick — null/N/A/- 는 빈 값", () => {
    expect(csv.pick({ a: "null", b: "x" }, "a", "b")).toBeNull();
    expect(csv.pick({ b: "x" }, "a", "b")).toBe("x");
  });
});

describe("벤처기업명단(파일)", () => {
  const rows = venture.parseVentureListCsv(VENTURE_CSV, { asOf: "2026-05-21" });
  test("업체명 없는 행은 버리고, 대표자 이름은 담지 않는다", () => {
    expect(rows).toHaveLength(3);
    expect(JSON.stringify(rows)).not.toContain("이**");
  });
  test("벤처투자유형 → vc_invested 태그", () => {
    expect(rows[1]).toMatchObject({
      businessNumber: null,
      industryName: "화장품 제조업",
      region: "서울",
      source: "venture",
      tags: ["venture", "vc_invested"],
    });
    expect(rows[0]?.tags).toEqual(["venture"]);
  });
  test("따옴표 안 쉼표가 든 주생산품", () => {
    expect(rows[2]?.products).toBe("계량시스템 및 전자저울, 자동화장비");
    expect(rows[2]?.extra.validUntil).toBe("2026-05-30");
    expect(rows[2]?.asOf).toBe("2026-05-21");
  });
});

describe("이노비즈·메인비즈(파일)", () => {
  test("파일 종류 판별", () => {
    expect(inno.detectInnoMainbizFile(INNOBIZ_PRODUCTS_CSV)).toBe(
      "innobiz_products"
    );
    expect(inno.detectInnoMainbizFile(INNOBIZ_STATUS_CSV)).toBe(
      "innobiz_status"
    );
    expect(inno.detectInnoMainbizFile(MAINBIZ_CSV)).toBe("mainbiz_status");
    expect(inno.detectInnoMainbizFile("a,b\n1,2")).toBeNull();
    expect(inno.parseInnoMainbizCsv("a,b\n1,2")).toEqual([]);
  });
  test("생산품 목록 — 사업자번호·홈페이지", () => {
    const rows = inno.parseInnoMainbizCsv(INNOBIZ_PRODUCTS_CSV);
    expect(rows).toHaveLength(3);
    expect(rows[1]).toMatchObject({
      businessNumber: "1358158772",
      homepage: "www.alphachips.co.kr",
      products: "반도체설계",
      region: "경기",
      source: "innobiz",
      tags: ["innobiz"],
    });
    expect(rows[0]?.homepage).toBeNull();
    expect(JSON.stringify(rows)).not.toContain("홍길동");
  });
  test("메인비즈 — 업종·인증만료일", () => {
    const rows = inno.parseInnoMainbizCsv(MAINBIZ_CSV);
    expect(rows[0]).toMatchObject({
      businessNumber: "1058600333",
      industryName: "도소매업",
      region: "서울",
      source: "mainbiz",
      tags: ["mainbiz"],
    });
    expect(rows[1]?.extra.validUntil).toBe("2026-08-02");
  });
});

describe("공정위 통신판매사업자", () => {
  test("파일 — 정상영업만, null·^ 처리, 개인정보 열 미포함", () => {
    const rows = ftc.parseFtcMailOrderCsv(FTC_CSV);
    expect(rows).toHaveLength(2);
    expect(rows[0]).toMatchObject({
      address: "서울특별시 강남구 논현로38길 14, 3층 (도곡동)",
      asOf: "2026-10-06",
      businessNumber: "7658601639",
      homepage: "www.tmclick.co.kr",
      region: "서울",
      sourceRef: "2026-서울강남-05568",
      tags: ["commerce"],
    });
    expect(rows[1]?.products).toContain("의류/패션/잡화/뷰티");
    const text = JSON.stringify(rows);
    expect(text).not.toContain("@");
    expect(text).not.toContain("홍");
    expect(
      ftc.parseFtcMailOrderCsv(FTC_CSV, { activeOnly: false })
    ).toHaveLength(3);
  });
  const item = {
    bzmnNm: "(주)테스트몰",
    brno: "1234567890",
    crno: "1101110000000",
    ctpvNm: "서울특별시",
    dclrDate: "20260105",
    domnCn: "testmall.co.kr",
    lctnAddr: "서울특별시 강동구 성내동",
    operSttusCdNm: "정상영업",
    prmmiMnno: "2026-서울강동-0001",
    rprsvEmladr: "ceo@testmall.co.kr",
    rprsvNm: "홍길동",
    trtmntPrdlstNm: "건강/식품",
  };
  test("API — swagger 모양(최상위 resultCode)", () => {
    const page = ftc.parseFtcList(
      { resultCode: "00", totalCount: "1", items: { item } },
      1
    );
    expect(page?.totalCount).toBe(1);
    expect(page?.items[0]).toMatchObject({
      businessNumber: "1234567890",
      homepage: "testmall.co.kr",
      products: "건강/식품",
      region: "서울",
      sourceRef: "2026-서울강동-0001",
    });
    expect(JSON.stringify(page)).not.toContain("ceo@");
  });
  test("API — 표준 껍데기(response.header) · 오류 코드", () => {
    const page = ftc.parseFtcList(
      {
        response: {
          header: { resultCode: "00" },
          body: { totalCount: 1, items: { item: [item] } },
        },
      },
      2
    );
    expect(page?.items).toHaveLength(1);
    expect(page?.pageNo).toBe(2);
    expect(ftc.parseFtcList({ resultCode: "30" }, 1)).toBeNull();
    expect(ftc.parseFtcList("<xml/>", 1)).toBeNull();
  });
  test("시군구 파일 URL", () => {
    expect(ftc.ftcDistrictFileUrl("서울특별시", "강남구")).toContain(
      encodeURIComponent("통신판매사업자_서울특별시_강남구.csv")
    );
  });
});

describe("국민연금 — 목록 API · 월별 파일", () => {
  const LIST = {
    response: {
      header: { resultCode: "00" },
      body: {
        totalCount: 1_592_776,
        items: {
          item: [
            {
              bzowrRgstNo: "303813****",
              dataCrtYm: "202608",
              ldongAddrMgplDgCd: "11",
              seq: 7_099_068,
              wkplJnngStcd: "1",
              wkplNm: "(주)포유이엔지/일용/서울숲 신축공사",
              wkplStylDvcd: "1",
            },
            {
              bzowrRgstNo: "119867****",
              dataCrtYm: "202608",
              ldongAddrMgplDgCd: "11",
              seq: 1,
              wkplJnngStcd: "1",
              wkplNm: "바이오센서연구소(주)",
              wkplRoadNmDtlAddr: "서울특별시 금천구",
              wkplStylDvcd: "1",
            },
            {
              bzowrRgstNo: "119867****",
              dataCrtYm: "202607",
              ldongAddrMgplDgCd: "11",
              seq: 2,
              wkplJnngStcd: "2",
              wkplNm: "탈퇴사업장",
              wkplStylDvcd: "1",
            },
          ],
        },
      },
    },
  };
  test("목록 — 현장 행·탈퇴 제외, 시도코드 → 지역", () => {
    const parsed = npsBulk.parseNpsList(LIST);
    expect(parsed?.totalCount).toBe(1_592_776);
    expect(parsed?.rows).toEqual([
      expect.objectContaining({
        bizNoPrefix: "119867",
        month: "2026-08",
        name: "바이오센서연구소(주)",
        region: "서울",
        seq: "1",
        type: "corporation",
      }),
    ]);
  });
  test("상세 → 업종명·가입자수(업종코드는 KSIC 아님 → extra)", () => {
    const detail = npsBulk.parseNpsListDetail({
      response: {
        header: { resultCode: "00" },
        body: {
          items: {
            item: [
              {
                adptDt: "20130605",
                jnngpCnt: 21,
                vldtVlKrnNm: "화장품 제조업",
                wkplIntpCd: "242300",
              },
            ],
          },
        },
      },
    });
    const row = npsBulk.parseNpsList(LIST)?.rows[0];
    if (!(row && detail)) {
      throw new Error("fixture");
    }
    const c = npsBulk.npsRowToDiscovered(row, detail);
    expect(c).toMatchObject({
      employees: 21,
      industryCode: null,
      industryName: "화장품 제조업",
      sourceRef: "1",
    });
    expect(c.extra.npsIndustryCode).toBe("242300");
  });
  test("월별 파일 — 등록·비현장만, 가입자·취득·상실", () => {
    const rows = npsBulk.parseNpsMonthlyCsv(NPS_CSV);
    expect(rows).toHaveLength(1);
    expect(rows[0]).toMatchObject({
      asOf: "2026-08",
      bizNoPrefix: "126811",
      employees: 4,
      industryName: "동력식 수지 공구 제조업",
      region: "경기",
    });
    expect(rows[0]?.extra).toMatchObject({
      lost: 0,
      newlyEnrolled: 0,
      npsIndustryCode: "292201",
    });
    expect(
      npsBulk.parseNpsMonthlyCsv(NPS_CSV, { includeWithdrawn: true })
    ).toHaveLength(2);
  });
});

describe("금융위·DART·식약처 → 발굴 회사", () => {
  test("금융위 — 해외 펀드(crno 0, 사업자번호 없음) 제외, 상장 태그", () => {
    expect(
      fsc.fscToDiscovered({
        address: null,
        asOf: null,
        bizNo: null,
        corpRegNo: "0000000000000",
        employeeCount: 0,
        foundedOn: null,
        homepage: null,
        industry: null,
        isSme: null,
        listedMarket: "기타",
        mainBusiness: null,
        name: "SAMPO FUND",
        representative: "X",
      })
    ).toBeNull();
    const c = fsc.fscToDiscovered({
      address: "서울특별시 관악구 관악로 1",
      asOf: "2026-06-30",
      bizNo: "1198672928",
      corpRegNo: "1101115152288",
      employeeCount: 20,
      foundedOn: "2013-06-05",
      homepage: null,
      industry: null,
      isSme: true,
      listedMarket: "코스닥",
      mainBusiness: "화장품",
      name: "바이오센서연구소",
      representative: "홍길동",
    });
    expect(c).toMatchObject({
      businessNumber: "1198672928",
      employees: 20,
      industryName: "화장품",
      region: "서울",
      tags: ["listed"],
    });
    expect(JSON.stringify(c)).not.toContain("홍길동");
  });
  test("DART — 개황 있으면 KSIC 코드·상장 태그", () => {
    const c = dart.dartToDiscovered(
      { corpCode: "00126380", corpName: "삼성전자", stockCode: "005930" },
      {
        address: "경기도 수원시 영통구",
        bizNo: "1248100998",
        ceo: "X",
        corpClass: "Y",
        corpCode: "00126380",
        corpRegNo: "1301110006246",
        foundedOn: "1969-01-13",
        homepage: "www.samsung.com/sec",
        industryCode: "264",
        name: "삼성전자(주)",
        stockCode: "005930",
      }
    );
    expect(c).toMatchObject({
      businessNumber: "1248100998",
      dartCorpCode: "00126380",
      industryCode: "264",
      region: "경기",
      tags: ["listed"],
    });
    expect(
      dart.dartToDiscovered({
        corpCode: "1",
        corpName: "비상장",
        stockCode: null,
      }).tags
    ).toEqual([]);
    expect(
      dart.parseDartCompany({
        status: "000",
        corp_code: "00126380",
        corp_name: "삼성전자(주)",
        induty_code: "264",
      })?.industryCode
    ).toBe("264");
  });
  test("식약처 — 책임판매 원문 업종", () => {
    const c = mfds.mfdsToDiscovered({
      bizNo: "1198672928",
      entpSeq: "123",
      kind: "화장품책임판매",
      name: "바이오센서연구소(주)",
      permittedOn: "2014-01-01",
      region: "서울특별시 관악구",
    });
    expect(c).toMatchObject({
      industryName: "화장품책임판매",
      region: "서울",
      sourceRef: "123",
      tags: ["mfds_cosmetics"],
    });
  });
});

describe("네트워크 함수 — 키 없으면 null, HTTP 오류에도 throw 없음", () => {
  test("키 없음 → null(호출 안 함)", async () => {
    vi.stubEnv("DATA_GO_KR_SERVICE_KEY", "");
    vi.stubEnv("OPENDART_API_KEY", "");
    const fetchSpy = vi.fn();
    vi.stubGlobal("fetch", fetchSpy);
    expect(await ftc.listFtcMailOrderSellers()).toBeNull();
    expect(await ftc.fetchFtcMailOrderDetail("1234567890")).toBeNull();
    expect(await npsBulk.listNpsWorkplaces({ sidoCode: "11" })).toBeNull();
    expect(await fsc.listFscCorps()).toBeNull();
    expect(await dart.fetchDartCompanyByCode("00126380")).toBeNull();
    expect(await dart.listDartCorps()).toBeNull();
    expect(fetchSpy).not.toHaveBeenCalled();
  });
  test("403(활용신청 안 됨)·500·네트워크 오류 → null", async () => {
    vi.stubEnv("DATA_GO_KR_SERVICE_KEY", "test-key");
    vi.stubGlobal(
      "fetch",
      vi.fn(async () => new Response("forbidden", { status: 403 }))
    );
    expect(
      await ftc.listFtcMailOrderSellers({ province: "서울특별시" })
    ).toBeNull();
    vi.stubGlobal(
      "fetch",
      vi.fn(async () => new Response("x", { status: 500 }))
    );
    expect(await fsc.listFscCorps()).toBeNull();
    vi.stubGlobal(
      "fetch",
      vi.fn(() => Promise.reject(new TypeError("network")))
    );
    expect(
      await npsBulk.listNpsWorkplaces({ sidoCode: "11", withDetail: true })
    ).toBeNull();
  });
  test("국민연금 목록 + 상세 — 같은 사업장 여러 달은 최신 1개, 상세 실패해도 행은 남음", async () => {
    vi.stubEnv("DATA_GO_KR_SERVICE_KEY", "test-key");
    const list = {
      response: {
        header: { resultCode: "00" },
        body: {
          totalCount: 3,
          items: {
            item: [
              {
                bzowrRgstNo: "119867****",
                dataCrtYm: "202607",
                ldongAddrMgplDgCd: "11",
                seq: 10,
                wkplJnngStcd: "1",
                wkplNm: "A사",
              },
              {
                bzowrRgstNo: "119867****",
                dataCrtYm: "202608",
                ldongAddrMgplDgCd: "11",
                seq: 11,
                wkplJnngStcd: "1",
                wkplNm: "A사",
              },
              {
                bzowrRgstNo: "220000****",
                dataCrtYm: "202608",
                ldongAddrMgplDgCd: "41",
                seq: 12,
                wkplJnngStcd: "1",
                wkplNm: "B사",
              },
            ],
          },
        },
      },
    };
    const detail = {
      response: {
        header: { resultCode: "00" },
        body: {
          items: {
            item: {
              jnngpCnt: 30,
              vldtVlKrnNm: "응용 소프트웨어 개발 및 공급업",
              wkplIntpCd: "722000",
            },
          },
        },
      },
    };
    vi.stubGlobal(
      "fetch",
      vi.fn((url: string) => {
        if (url.includes("getBassInfoSearchV2")) {
          return Promise.resolve(Response.json(list));
        }
        return Promise.resolve(
          url.includes("seq=11")
            ? Response.json(detail)
            : new Response("x", { status: 500 })
        );
      })
    );
    const page = await npsBulk.listNpsWorkplaces({
      sidoCode: "11",
      withDetail: true,
    });
    expect(
      page?.items.map((c) => [c.name, c.sourceRef, c.employees, c.region])
    ).toEqual([
      ["A사", "11", 30, "서울"],
      ["B사", "12", null, "경기"],
    ]);
  });
});
