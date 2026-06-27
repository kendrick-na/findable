// 로고 시안 — 옵션 B (Skill 알고리즘 직접 실행)
//
// 9개 레퍼런스(SpaceX·Antimetal·Linear·Grok·Claude·Chronicle·DUNA·Perplexity·Giga) 톤 차용
// 수학 함수로 정밀 좌표 계산 → path ≤ 8 강제
// 추상 메타포 제거, 사용자가 좋아한 톤 직접 모방
//
// 5개 시안:
//   F1 — Sparkle 12-ray (Claude 톤)
//   F2 — Circle + Slash (Linear 톤)
//   F3 — F-Dots 6점 (Antimetal 톤)
//   F4 — Asterisk 8-point (DUNA 톤)
//   F5 — Wordmark + Tiny F (SpaceX 톤)

import type { Metadata } from "next";

export const metadata: Metadata = {
  title: "Findable 로고 — 옵션 B 5안",
};

export default function LogoPreviewPage() {
  return (
    <div className="dark min-h-screen bg-zinc-950 text-zinc-100">
      <div className="mx-auto max-w-7xl px-6 py-12">
        <header className="mb-12">
          <h1 className="font-bold text-4xl text-zinc-50 tracking-tight">
            Findable 로고 — 옵션 B 5안
          </h1>
          <p className="mt-3 text-zinc-400">
            사용자가 좋아한 9개 레퍼런스(Claude·Linear·Antimetal·DUNA·SpaceX) 톤을 수학 함수로
            직접 차용. 추상 메타포 제거, path ≤ 8 강제.
          </p>
        </header>

        <div className="space-y-12">
          <Concept
            letter="F1"
            name="Sparkle 12-ray (Claude 톤)"
            metaphor="12개 방사형 ray. 끝이 가늘어지는 sparkle. AI 답변 빛처럼 퍼지는 Findable."
            reference="Claude (12 방사 ray)"
            symbol={<LogoF1 size={96} />}
            symbolWordmark={
              <div className="flex items-center gap-3">
                <LogoF1 size={36} />
                <span className="font-semibold text-2xl text-zinc-50 tracking-tight">Findable</span>
              </div>
            }
          />

          <Concept
            letter="F2"
            name="Circle + Triple Slash (Linear 톤)"
            metaphor="외곽 원 + 3개 평행 사선. AI 우주(원) 안에 4 에이전트(선)가 작동."
            reference="Linear (원 + 사선)"
            symbol={<LogoF2 size={96} />}
            symbolWordmark={
              <div className="flex items-center gap-3">
                <LogoF2 size={36} />
                <span className="font-semibold text-2xl text-zinc-50 tracking-tight">Findable</span>
              </div>
            }
          />

          <Concept
            letter="F3"
            name="F-Dots 6점 (Antimetal 톤)"
            metaphor="6개 점이 F 형태로 배치. 이름 직결성 + Antimetal 미니멀."
            reference="Antimetal (점 클러스터)"
            symbol={<LogoF3 size={96} />}
            symbolWordmark={
              <div className="flex items-center gap-3">
                <LogoF3 size={36} />
                <span className="font-semibold text-2xl text-zinc-50 tracking-tight">Findable</span>
              </div>
            }
          />

          <Concept
            letter="F4"
            name="8-point Asterisk (DUNA 톤)"
            metaphor="4개 선이 90°/45° 교차해 8각 별 형성. AI 답변 속 빛."
            reference="DUNA (✱ 8각 별)"
            symbol={<LogoF4 size={96} />}
            symbolWordmark={
              <div className="flex items-center gap-3">
                <LogoF4 size={36} />
                <span className="font-semibold text-2xl text-zinc-50 tracking-tight">Findable</span>
              </div>
            }
          />

          <Concept
            letter="F5"
            name="Wordmark + Tiny F (SpaceX 톤)"
            metaphor="심볼 없이 워드마크. F 위 작은 강조점. 가장 안전하고 글로벌."
            reference="SpaceX (워드마크 only)"
            symbol={<LogoF5 size={96} />}
            symbolWordmark={
              <div className="font-bold text-3xl text-zinc-50 tracking-[0.02em]">
                F<span className="relative">i<span className="absolute -top-1 left-1/2 h-1 w-1 -translate-x-1/2 rounded-full bg-[var(--brand-2)]" /></span>ndable
              </div>
            }
          />
        </div>
      </div>
    </div>
  );
}

// ──────────────────────────────────────────────────────────────────
// 공통 — Concept Card with 5 environments
// ──────────────────────────────────────────────────────────────────

function Concept({
  letter,
  name,
  metaphor,
  reference,
  symbol,
  symbolWordmark,
}: {
  letter: string;
  name: string;
  metaphor: string;
  reference: string;
  symbol: React.ReactNode;
  symbolWordmark: React.ReactNode;
}) {
  return (
    <section className="rounded-2xl border border-white/10 bg-zinc-900/60 p-8">
      <div className="mb-3 flex items-baseline gap-3">
        <span className="font-mono text-xs uppercase tracking-[0.2em] text-[var(--brand-2)]">
          {letter}
        </span>
        <h2 className="font-bold text-2xl text-zinc-50">{name}</h2>
      </div>
      <p className="mb-2 text-sm text-zinc-300 leading-relaxed">{metaphor}</p>
      <p className="mb-6 font-mono text-[10px] uppercase tracking-[0.18em] text-zinc-500">
        🔍 차용 톤: {reference}
      </p>

      <div className="grid gap-4 lg:grid-cols-5">
        {/* 헤더 40px */}
        <div className="rounded-xl border border-white/10 bg-zinc-950/50 p-5">
          <div className="mb-3 font-mono text-[10px] uppercase tracking-[0.18em] text-zinc-500">
            헤더 40px
          </div>
          <div className="flex h-16 items-center">{symbolWordmark}</div>
        </div>

        {/* 96px */}
        <div className="rounded-xl border border-white/10 bg-zinc-950/50 p-5">
          <div className="mb-3 font-mono text-[10px] uppercase tracking-[0.18em] text-zinc-500">
            심볼 96px
          </div>
          <div className="flex h-24 items-center justify-center">
            <div className="h-24 w-24">{symbol}</div>
          </div>
        </div>

        {/* favicon 32 */}
        <div className="rounded-xl border border-white/10 bg-zinc-950/50 p-5">
          <div className="mb-3 font-mono text-[10px] uppercase tracking-[0.18em] text-zinc-500">
            Favicon 32px
          </div>
          <div className="flex h-24 items-center justify-center">
            <div className="h-8 w-8">{symbol}</div>
          </div>
        </div>

        {/* favicon 16 (stress test) */}
        <div className="rounded-xl border border-white/10 bg-zinc-950/50 p-5">
          <div className="mb-3 font-mono text-[10px] uppercase tracking-[0.18em] text-zinc-500">
            16px stress
          </div>
          <div className="flex h-24 items-center justify-center">
            <div className="h-4 w-4">{symbol}</div>
          </div>
        </div>

        {/* 라이트 모드 */}
        <div className="rounded-xl border border-zinc-300 bg-white p-5">
          <div className="mb-3 font-mono text-[10px] uppercase tracking-[0.18em] text-zinc-500">
            라이트
          </div>
          <div className="flex h-24 items-center justify-center gap-3">
            <div className="h-4 w-4">{symbol}</div>
            <div className="h-8 w-8">{symbol}</div>
            <div className="h-12 w-12">{symbol}</div>
          </div>
        </div>
      </div>
    </section>
  );
}

// ──────────────────────────────────────────────────────────────────
// F1 — Sparkle 12-ray (Claude 톤 차용)
// 12개 방사형 ray, 끝이 가늘어지는 진짜 sparkle
// ──────────────────────────────────────────────────────────────────

function LogoF1({ size = 96 }: { size?: number }) {
  // 수학 함수로 12개 ray 좌표 계산 (각 30°)
  // 안쪽 두 점은 가까이 + 바깥 끝 한 점 = triangle path
  const cx = 50;
  const cy = 50;
  const inner = 7;
  const outer = 44;
  const halfWidth = 0.18; // ray 폭 (rad)

  const rays = Array.from({ length: 12 }, (_, i) => {
    const angle = (i * 30 * Math.PI) / 180;
    const x1 = cx + Math.cos(angle - halfWidth) * inner;
    const y1 = cy + Math.sin(angle - halfWidth) * inner;
    const x2 = cx + Math.cos(angle + halfWidth) * inner;
    const y2 = cy + Math.sin(angle + halfWidth) * inner;
    const x3 = cx + Math.cos(angle) * outer;
    const y3 = cy + Math.sin(angle) * outer;
    return `M ${x1.toFixed(2)} ${y1.toFixed(2)} L ${x3.toFixed(2)} ${y3.toFixed(2)} L ${x2.toFixed(2)} ${y2.toFixed(2)} Z`;
  });

  return (
    <svg viewBox="0 0 100 100" width={size} height={size} fill="currentColor" xmlns="http://www.w3.org/2000/svg">
      <path d={rays.join(" ")} />
    </svg>
  );
}

// ──────────────────────────────────────────────────────────────────
// F2 — Circle + Triple Slash (Linear 톤 차용)
// 외곽 원 + 3개 평행 사선 (-30°)
// ──────────────────────────────────────────────────────────────────

function LogoF2({ size = 96 }: { size?: number }) {
  // 사선 각도 -30° = 우상향
  // 원 내부에서 -25 ~ +25 길이
  // 3개 사선 평행, 수직 간격 12
  return (
    <svg viewBox="0 0 100 100" width={size} height={size} fill="none" xmlns="http://www.w3.org/2000/svg">
      {/* 외곽 원 */}
      <circle cx="50" cy="50" r="44" stroke="currentColor" strokeWidth="4" fill="none" />
      {/* 3개 평행 사선 */}
      <g stroke="currentColor" strokeWidth="4" strokeLinecap="round">
        <line x1="28" y1="62" x2="72" y2="38" />
        <line x1="32" y1="50" x2="68" y2="30" />
        <line x1="36" y1="38" x2="64" y2="22" />
      </g>
    </svg>
  );
}

// ──────────────────────────────────────────────────────────────────
// F3 — F-Dots 6점 (Antimetal 톤 차용)
// 6개 점이 F 형태로 배치
// ──────────────────────────────────────────────────────────────────

function LogoF3({ size = 96 }: { size?: number }) {
  // F 형태:
  // 위 가로: (28,22) (50,22)
  // 세로 중간: (28,38)
  // 중간 가로: (28,52) (44,52)
  // 세로 끝: (28,78)
  return (
    <svg viewBox="0 0 100 100" width={size} height={size} fill="currentColor" xmlns="http://www.w3.org/2000/svg">
      <circle cx="28" cy="22" r="6" />
      <circle cx="54" cy="22" r="6" />
      <circle cx="28" cy="38" r="5" />
      <circle cx="28" cy="54" r="6" />
      <circle cx="48" cy="54" r="6" />
      <circle cx="28" cy="78" r="6" />
    </svg>
  );
}

// ──────────────────────────────────────────────────────────────────
// F4 — 8-point Asterisk (DUNA 톤 차용)
// 4개 선이 0°/45°/90°/135°로 교차
// ──────────────────────────────────────────────────────────────────

function LogoF4({ size = 96 }: { size?: number }) {
  return (
    <svg viewBox="0 0 100 100" width={size} height={size} fill="none" xmlns="http://www.w3.org/2000/svg">
      <g stroke="currentColor" strokeWidth="6" strokeLinecap="round">
        {/* 가로 */}
        <line x1="14" y1="50" x2="86" y2="50" />
        {/* 세로 */}
        <line x1="50" y1="14" x2="50" y2="86" />
        {/* 우상향 대각 */}
        <line x1="24.5" y1="75.5" x2="75.5" y2="24.5" />
        {/* 좌상향 대각 */}
        <line x1="24.5" y1="24.5" x2="75.5" y2="75.5" />
      </g>
    </svg>
  );
}

// ──────────────────────────────────────────────────────────────────
// F5 — Tiny F (SpaceX 톤 — 워드마크 위주, 심볼은 단순 F)
// favicon용으로만 사용. 헤더에서는 워드마크 only.
// ──────────────────────────────────────────────────────────────────

function LogoF5({ size = 96 }: { size?: number }) {
  // Anthropic 톤 — 24×24 viewBox, 두꺼운 F 한 글자
  return (
    <svg viewBox="0 0 24 24" width={size} height={size} fill="currentColor" xmlns="http://www.w3.org/2000/svg">
      {/* F: 세로획 + 위 가로획 + 중간 가로획 */}
      <path d="M5 3h14v3.5H8.5v4H17V14H8.5v7H5z" />
    </svg>
  );
}
