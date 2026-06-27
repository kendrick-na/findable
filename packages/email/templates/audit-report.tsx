// Findable 무료 진단 풀 리포트 이메일 — research 13 HubSpot 모델
//
// 사용자가 결과 페이지 하단 "📩 풀 리포트 받기" 클릭 → 이 이메일 발송
// 본문: GEO 점수 + 4 단계 라벨 + Top 3 액션 + PDF 다운로드 링크

import {
  Body,
  Button,
  Container,
  Head,
  Hr,
  Html,
  Preview,
  Section,
  Tailwind,
  Text,
} from "@react-email/components";
import type * as React from "react";

interface AuditReportEmailProps {
  readonly brandName: string;
  readonly domain: string;
  readonly geoScore: number; // 0~100
  readonly tierLabel: string; // "리더" / "경쟁 가능" / "막 시작" / "AI에서 안 보임"
  readonly enginesMentioned: number; // 4
  readonly enginesTotal: number; // 7
  readonly resultUrl: string; // https://findable.co.kr/ko/audit/[jobId]
  readonly pdfUrl?: string;
  readonly topActions?: Array<{ rank: number; title: string; timeframe: string }>;
}

export const AuditReportEmail = ({
  brandName,
  domain,
  geoScore,
  tierLabel,
  enginesMentioned,
  enginesTotal,
  resultUrl,
  pdfUrl,
  topActions = [],
}: AuditReportEmailProps): React.JSX.Element => {
  const tierColor =
    geoScore >= 76
      ? "#10b981"
      : geoScore >= 51
        ? "#3b82f6"
        : geoScore >= 26
          ? "#f59e0b"
          : "#ef4444";
  const previewText = `${brandName} GEO 점수 ${geoScore}/100 — ${tierLabel}`;

  return (
    <Tailwind>
      <Html>
        <Head />
        <Preview>{previewText}</Preview>
        <Body className="bg-zinc-50 font-sans">
          <Container className="mx-auto py-12">
            <Section className="rounded-md bg-zinc-100 p-px">
              <Section className="rounded-[5px] bg-white p-8">
                {/* 헤더 */}
                <Text className="m-0 font-mono text-xs text-zinc-500 uppercase tracking-widest">
                  Findable · GEO 점수 측정 결과
                </Text>
                <Text className="mt-2 mb-1 font-bold text-2xl text-zinc-950">
                  {brandName}
                </Text>
                <Text className="m-0 text-sm text-zinc-500">{domain}</Text>

                <Hr className="my-6 border-zinc-200" />

                {/* 큰 점수 */}
                <Section className="text-center">
                  <Text
                    className="m-0 font-bold text-7xl"
                    style={{ color: tierColor }}
                  >
                    {String(geoScore)}
                  </Text>
                  <Text className="m-0 text-sm text-zinc-500">/ 100</Text>
                  <Text
                    className="mt-3 font-semibold text-lg"
                    style={{ color: tierColor }}
                  >
                    {tierLabel}
                  </Text>
                </Section>

                <Hr className="my-6 border-zinc-200" />

                {/* 핵심 결과 */}
                <Text className="m-0 mb-2 font-semibold text-base text-zinc-900">
                  📊 핵심 결과
                </Text>
                <Text className="m-0 mb-1 text-sm text-zinc-700">
                  • AI 엔진 {enginesTotal}개 중 {enginesMentioned}개에서 우리 브랜드가 등장했습니다.
                </Text>
                <Text className="m-0 mb-4 text-sm text-zinc-700">
                  • GEO 점수 {geoScore}점 — {tierLabel}
                </Text>

                {/* Top 3 액션 */}
                {topActions.length > 0 && (
                  <>
                    <Text className="mt-6 mb-3 font-semibold text-base text-zinc-900">
                      🎯 오늘 할 일 (4 에이전트가 도출)
                    </Text>
                    {topActions.slice(0, 3).map((action) => (
                      <Section
                        key={action.rank}
                        className="mb-3 rounded-md border border-zinc-200 bg-zinc-50 p-4"
                      >
                        <Text className="m-0 mb-1 font-mono text-xs text-zinc-500">
                          #{String(action.rank).padStart(2, "0")} ·{" "}
                          {action.timeframe}
                        </Text>
                        <Text className="m-0 font-medium text-sm text-zinc-900">
                          {action.title}
                        </Text>
                      </Section>
                    ))}
                  </>
                )}

                <Hr className="my-6 border-zinc-200" />

                {/* CTA 버튼 */}
                <Section className="text-center">
                  <Button
                    href={resultUrl}
                    className="rounded-md bg-zinc-900 px-6 py-3 font-medium text-white text-sm"
                  >
                    전체 결과 보기 →
                  </Button>
                  {pdfUrl && (
                    <Text className="mt-3 text-xs text-zinc-500">
                      또는{" "}
                      <a href={pdfUrl} className="text-zinc-900 underline">
                        PDF 다운로드
                      </a>
                    </Text>
                  )}
                </Section>

                <Hr className="my-6 border-zinc-200" />

                {/* 푸터 */}
                <Text className="m-0 text-xs text-zinc-400">
                  Findable — 한국 최초 Agentic GEO Platform.
                </Text>
                <Text className="m-0 mt-1 text-xs text-zinc-400">
                  ChatGPT · Claude · Perplexity · Gemini · HyperCLOVA · 네이버 ·
                  카카오 7개 AI 답변에서 우리 브랜드 가시성을 측정·최적화합니다.
                </Text>
              </Section>
            </Section>
          </Container>
        </Body>
      </Html>
    </Tailwind>
  );
};

AuditReportEmail.PreviewProps = {
  brandName: "메디큐브",
  domain: "medicube.co.kr",
  geoScore: 88,
  tierLabel: "리더",
  enginesMentioned: 4,
  enginesTotal: 7,
  resultUrl: "https://findable.co.kr/ko/audit/sample",
  pdfUrl: "https://findable.co.kr/api/audit/sample/pdf",
  topActions: [
    {
      rank: 1,
      title: "위키피디아 한국어 페이지에 메디큐브 항목 추가",
      timeframe: "이번 주",
    },
    {
      rank: 2,
      title: "/pricing 페이지를 AI 답변형으로 리라이트",
      timeframe: "2주 내",
    },
    {
      rank: 3,
      title: "네이버 블로그 5개에 메디큐브 사용 후기 게재 의뢰",
      timeframe: "1개월",
    },
  ],
};

export default AuditReportEmail;
