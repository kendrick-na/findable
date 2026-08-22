"use client";

import {
  classifySubmit,
  shouldOfferContact,
  trackAuditSubmitted,
} from "@repo/analytics/funnel";
import { Button } from "@repo/design-system/components/ui/button";
import { Input } from "@repo/design-system/components/ui/input";
import { Label } from "@repo/design-system/components/ui/label";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@repo/design-system/components/ui/select";
import type { Dictionary } from "@repo/internationalization";
import { Loader2, MoveRight } from "lucide-react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { type FormEvent, useState } from "react";

interface AuditFormProps {
  dictionary: Dictionary;
  locale: string;
}

type Language = "ko" | "en" | "both";

/*
 * 서버가 준 에러 문구를 고른다. 없으면 로케일 기본 문구로 떨어진다.
 * ⚠️ 컴포넌트 밖으로 뺀 이유 = biome 중첩 삼항 금지 + 핸들러 인지복잡도 상한.
 */
function resolveErrorMessage(
  serverError: string | undefined,
  isKo: boolean
): string {
  if (serverError) {
    return serverError;
  }
  if (isKo) {
    return "요청 실패";
  }
  return "Request failed";
}

export function AuditForm({ locale }: AuditFormProps) {
  const router = useRouter();
  const isKo = locale.startsWith("ko");

  const [email, setEmail] = useState("");
  const [domain, setDomain] = useState("");
  const [brandName, setBrandName] = useState("");
  const [language, setLanguage] = useState<Language>("both");
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [existingJobHref, setExistingJobHref] = useState<string | null>(null);
  // 429(예산 소진·IP 상한)일 때만 켠다 — 서버 문구가 "문의해 주세요"라고 말하므로
  // 클릭할 데를 실제로 준다. 판정은 `shouldOfferContact` 가 구조로 한다.
  const [showContact, setShowContact] = useState(false);

  async function handleSubmit(e: FormEvent) {
    e.preventDefault();
    setError(null);
    setExistingJobHref(null);
    setShowContact(false);
    setLoading(true);

    try {
      const response = await fetch("/api/audit", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          email,
          domain,
          language,
          brandName: brandName || undefined,
        }),
      });

      const data = (await response.json()) as
        | { jobId: string; status: string; pollUrl: string; cached?: boolean }
        | {
            error: string;
            existingJobId?: string;
            budgetExhausted?: boolean;
            ipQuotaExceeded?: boolean;
          };

      // 🔴 세션N-25 계측 — 제출이 서버에서 **어떻게 판정됐는지**까지 남긴다.
      //   지금까지는 거절된 사람이 몇 명인지 아무도 몰랐다. 특히 `ip_capped` 는
      //   대행사·에이전시(=지불의사 높은 ICP)가 3번째 도메인에서 막히는 지점이다.
      //   ⚠️ 문구가 아니라 **구조화된 플래그**로 분류한다(서버 문구를 다듬으면
      //      문자열 파싱은 조용히 깨진다).
      // ⭐ 판정을 **한 번만** 낸다 — 계측과 화면이 같은 값을 보게 해서
      //   "이벤트에는 ip_capped 인데 화면에는 문의 링크가 없다" 같은 어긋남을 막는다.
      const outcome = classifySubmit(response.status, data);
      trackAuditSubmitted({ domain, outcome });

      if (!response.ok) {
        setShowContact(shouldOfferContact(outcome));
        if ("existingJobId" in data && data.existingJobId) {
          // 같은 이메일+도메인 24h 내 재요청 — 무음 리다이렉트 대신
          // 안내 + 기존 결과 링크를 노출해 사용자가 인지하고 이동하게 한다.
          setError(
            isKo
              ? "이미 24시간 내 이 도메인을 측정하셨습니다. 아래에서 기존 결과를 확인하세요."
              : "You already audited this domain within 24 hours. View your existing result below."
          );
          setExistingJobHref(`/${locale}/audit/${data.existingJobId}`);
          setLoading(false);
          return;
        }
        setError(
          resolveErrorMessage("error" in data ? data.error : undefined, isKo)
        );
        setLoading(false);
        return;
      }

      if ("jobId" in data) {
        router.push(`/${locale}/audit/${data.jobId}`);
      }
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
      setLoading(false);
    }
  }

  return (
    <form className="flex flex-col gap-5" onSubmit={handleSubmit}>
      <div className="grid gap-4 md:grid-cols-2">
        <div className="flex flex-col gap-2">
          <Label htmlFor="audit-email">{isKo ? "이메일" : "Email"}</Label>
          <Input
            disabled={loading}
            id="audit-email"
            onChange={(e) => setEmail(e.target.value)}
            placeholder={isKo ? "you@brand.com" : "you@brand.com"}
            required
            type="email"
            value={email}
          />
        </div>
        <div className="flex flex-col gap-2">
          <Label htmlFor="audit-domain">{isKo ? "도메인" : "Domain"}</Label>
          <Input
            disabled={loading}
            id="audit-domain"
            onChange={(e) => setDomain(e.target.value)}
            placeholder="medicube.co.kr"
            required
            type="text"
            value={domain}
          />
        </div>
      </div>

      <div className="grid gap-4 md:grid-cols-2">
        <div className="flex flex-col gap-2">
          <Label htmlFor="audit-brand">
            {isKo ? "브랜드명 (선택)" : "Brand name (optional)"}
          </Label>
          <Input
            disabled={loading}
            id="audit-brand"
            onChange={(e) => setBrandName(e.target.value)}
            placeholder={
              isKo ? "비워두면 도메인에서 추출" : "Auto-detected from domain"
            }
            type="text"
            value={brandName}
          />
        </div>
        <div className="flex flex-col gap-2">
          <Label htmlFor="audit-language">
            {isKo ? "측정 언어" : "Languages"}
          </Label>
          <Select
            disabled={loading}
            onValueChange={(v) => setLanguage(v as Language)}
            value={language}
          >
            {/* w-full + 줄바꿈 허용 — design-system 기본값이 `w-fit whitespace-nowrap` 이라
                200% 확대(195px)에서 297px 로 삐져나가 가로 스크롤이 생겼다(WCAG 1.4.10). */}
            <SelectTrigger
              className="w-full [&>span]:whitespace-normal"
              id="audit-language"
            >
              <SelectValue />
            </SelectTrigger>
            {/* 🔴 S7-a(2026-08-11) — **선택지에 엔진 수를 박는다.**
                실측: 러너는 한국어 질문에 7 엔진, 영어 질문에 **글로벌 4 엔진만** 쓴다
                (`packages/audit/runner.ts` 의 `DEFAULT_7` / `GLOBAL_4` — 한국 검색엔진에
                영어 질의는 무의미해서 naver·daum·hyperclova 를 뺀다. 타당한 설계다).
                🔴 문제는 **랜딩·요금제가 전부 "7개 AI"라고 파는데** 「영어만」을 고른 고객은
                **4개로 측정된다**는 것이었다 — 약속과 실제가 갈리는 자리(원인②).
                → 숫자를 **고르는 순간** 정직하게 보여준다. 결과 화면은 이미 실측값을 쓴다. */}
            <SelectContent>
              <SelectItem value="both">
                {isKo
                  ? "한국어 + 영어 (권장) · AI 7곳"
                  : "Korean + English (recommended) · 7 AI engines"}
              </SelectItem>
              <SelectItem value="ko">
                {isKo ? "한국어만 · AI 7곳" : "Korean only · 7 AI engines"}
              </SelectItem>
              <SelectItem value="en">
                {isKo ? "영어만 · AI 4곳" : "English only · 4 AI engines"}
              </SelectItem>
            </SelectContent>
          </Select>
          {language === "en" && (
            <p className="text-[color:var(--findable-ink-subtle,#8a8f98)] text-xs">
              {isKo
                ? "영어 질문은 글로벌 AI 4곳(ChatGPT·Claude·Perplexity·Gemini)에서만 측정해요. 네이버·다음·HyperCLOVA는 한국어 질문에서 답해요."
                : "English questions are measured across 4 global engines (ChatGPT, Claude, Perplexity, Gemini). Naver, Daum, and HyperCLOVA answer Korean questions."}
            </p>
          )}
        </div>
      </div>

      {error && (
        <div className="flex flex-col gap-3 rounded-md border border-red-200 bg-red-50 px-4 py-3 text-red-800 text-sm">
          <span>{error}</span>
          {existingJobHref && (
            <Button asChild className="w-fit gap-2" size="sm" variant="outline">
              <Link href={existingJobHref}>
                {isKo ? "기존 결과 보기" : "View existing result"}
                <MoveRight className="h-4 w-4" />
              </Link>
            </Button>
          )}
          {/* 🔴 서버 429 문구가 "문의해 주세요"라고 말하는데 클릭할 데가 없었다.
              대행사·에이전시가 3번째 도메인에서 막히는 자리 = 고의도 리드 이탈 지점. */}
          {showContact && (
            <Button asChild className="w-fit gap-2" size="sm" variant="outline">
              <Link href={`/${locale}/contact`}>
                {isKo ? "문의하기" : "Contact us"}
                <MoveRight className="h-4 w-4" />
              </Link>
            </Button>
          )}
        </div>
      )}

      <Button className="gap-2" disabled={loading} size="lg" type="submit">
        {loading ? (
          <>
            <Loader2 className="h-4 w-4 animate-spin" />
            {isKo ? "진단 시작 중…" : "Starting audit…"}
          </>
        ) : (
          <>
            {isKo ? "무료 진단 시작 (3분)" : "Start free audit (3 min)"}
            <MoveRight className="h-4 w-4" />
          </>
        )}
      </Button>
    </form>
  );
}
