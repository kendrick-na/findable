// FooterCTA — D-037 Duna 패턴: Hero(금강전도) ↔ Footer(인왕제색도) 시각 페어
// 자연 → 데이터 → 자연 샌드위치 마무리

import { Button } from "@repo/design-system/components/ui/button";
import { ArrowRight } from "lucide-react";
import Image from "next/image";
import Link from "next/link";

export const FooterCTA = () => {
  return (
    <section className="relative isolate overflow-hidden bg-[color:var(--findable-sumi-950)]">
      {/* 인왕제색도 배경 — 다크 톤 */}
      <div className="pointer-events-none absolute inset-0 opacity-50 mix-blend-soft-light">
        <Image
          src="/illustrations/jeong-seon-footer.webp"
          alt="정선 「인왕제색도」"
          fill
          sizes="100vw"
          className="object-cover"
        />
      </div>

      {/* 페이드 오버레이 */}
      <div
        aria-hidden
        className="absolute inset-0 bg-gradient-to-b from-transparent via-[color:var(--findable-sumi-950)]/40 to-[color:var(--findable-sumi-950)]"
      />

      <div className="relative mx-auto flex min-h-[80vh] max-w-5xl flex-col items-center justify-center px-6 py-32 text-center text-[color:var(--findable-mist-50)]">
        <p className="text-xs font-mono uppercase tracking-[0.18em] text-[color:var(--findable-gold-500)]/80">
          Free Audit · 3분 진단
        </p>
        <h2
          className="mt-6 font-medium text-5xl leading-[1.1] tracking-tight md:text-7xl"
          style={{
            fontFamily:
              '"Pretendard Variable", Pretendard, "Noto Serif KR", serif',
          }}
        >
          지금 우리 브랜드는
          <br />
          AI에게 어떻게 보이고 있을까요?
        </h2>
        <p className="mt-8 max-w-xl text-lg text-[color:var(--findable-mist-50)]/70">
          7개 AI 엔진에서 우리 브랜드의 위치를 측정하고,
          <br />
          한국어 가시성 모트를 검증합니다.
        </p>

        <div className="mt-12 flex flex-col items-center gap-3 sm:flex-row">
          <Button
            asChild
            size="lg"
            className="gap-2 rounded-full bg-[color:var(--findable-mist-50)] px-8 text-[color:var(--findable-sumi-950)] hover:bg-[color:var(--findable-mist-50)]/90"
          >
            <Link href="/audit">
              3분 무료 진단 시작
              <ArrowRight className="h-4 w-4" />
            </Link>
          </Button>
          <Button
            asChild
            variant="outline"
            size="lg"
            className="gap-2 rounded-full border-[color:var(--findable-mist-50)]/30 bg-transparent px-7 text-[color:var(--findable-mist-50)] backdrop-blur-md hover:bg-[color:var(--findable-mist-50)]/10"
          >
            <Link href="/contact">전문가 상담 예약</Link>
          </Button>
        </div>

        <div className="mt-20 flex items-center gap-6 text-xs text-[color:var(--findable-mist-50)]/50">
          <span>이메일만 있으면 OK</span>
          <span className="h-1 w-1 rounded-full bg-current" />
          <span>카드 등록 불필요</span>
          <span className="h-1 w-1 rounded-full bg-current" />
          <span>30초 PDF 리포트</span>
        </div>
      </div>
    </section>
  );
};
