export default function ClientReportNotFound() {
  return (
    <main
      style={{
        fontFamily:
          '"Pretendard Variable", Pretendard, -apple-system, sans-serif',
        maxWidth: 480,
        margin: "20vh auto",
        padding: "0 16px",
        color: "#17130F",
      }}
    >
      <h1 style={{ fontSize: 22, fontWeight: 800 }}>
        리포트를 찾을 수 없습니다
      </h1>
      <p style={{ marginTop: 12, color: "#6B635D", lineHeight: 1.6 }}>
        링크가 만료되었거나 주소가 정확하지 않습니다. 리포트를 보내드린
        담당자에게 새 링크를 요청해 주세요.
      </p>
    </main>
  );
}
