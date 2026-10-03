interface ClientReportDisclosureNoticeProps {
  readonly legacySyntheticEngineIds: readonly string[];
  readonly print: boolean;
  readonly retiredEngineIds: readonly string[];
}

export function ClientReportDisclosureNotice({
  legacySyntheticEngineIds,
  print,
  retiredEngineIds,
}: ClientReportDisclosureNoticeProps) {
  return (
    <aside
      data-report-disclosure={print ? "print" : "screen"}
      style={{
        margin: "0 auto 16px",
        maxWidth: 794,
        border: "1px solid #d6d3d1",
        borderRadius: 8,
        background: "#fafaf9",
        color: "#57534e",
        padding: "12px 14px",
        fontSize: 13,
        lineHeight: 1.6,
      }}
    >
      <strong style={{ color: "#292524" }}>발행본 안내</strong>
      <div>
        이 리포트는 발행 시점에 저장된 동결 스냅숏입니다. 현재 측정값이나 현재 엔진
        상태를 보증하지 않습니다.
      </div>
      {retiredEngineIds.length > 0 ? (
        <div>
          일부 과거 엔진 결과가 포함되어 있으며, 현재 측정 근거로 해석하지 마세요.
        </div>
      ) : null}
      {legacySyntheticEngineIds.includes("naver") ? (
        <div>
          과거 네이버 합성 측정은 네이버 AI의 직접 답변이 아니라, 당시 검색 결과를
          Findable이 요약한 값입니다.
        </div>
      ) : null}
    </aside>
  );
}
