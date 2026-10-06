"use client";

import { inferMarketScope } from "@repo/audit/market-scope";
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
import { toast } from "@repo/design-system/components/ui/sonner";
import { useRouter } from "next/navigation";
import { useActionState, useEffect, useMemo, useRef, useState } from "react";
import {
  assignBrandOwner,
  type BrandMeasurementOutcome,
} from "@/app/actions/brand/assign";
import { suggestBrandIdentity } from "@/app/actions/brand/suggest-brand-identity";
import { isValidDomain, normalizeDomain } from "@/lib/domain";
import type { AppDictionary } from "@/lib/i18n";
import { marketScopeReason } from "@/lib/market-scope-reason";

/** 이 폼의 문구 — 서버(`/brand`·`/welcome`)가 `app.brandForm` 사전에서 넘긴다. */
export type BrandFormLabels = AppDictionary["brandForm"];

interface FormState {
  error?: string;
  jobId?: string;
  /** 등록에 이어 자동 실행한 측정의 결말. §3-b ⑴ — 조용한 실패를 막는 자리. */
  measurement?: BrandMeasurementOutcome;
  message?: string;
  status: "idle" | "ok";
}

const initialState: FormState = { status: "idle" };

/** 업종 선택지 — DB Industry enum 과 1:1. 불확실한 업종은 추측하지 않는다. */
/**
 * 타깃 시장 선택지.
 *
 * 🔴 2026-08-21 — **언어축으로 재설계 후 복원**(2026-08-03에 비활성화했던 것).
 *   그때는 "국내 중심"을 엔진 국적으로 걸러 ChatGPT 가 빠지는 버그가 있었다.
 *   지금은 `market-scope.ts` 의 `promptLanguageRegion`(질의 언어) 으로 분해한다 —
 *   "국내 중심" = 한국어로 물었을 때 7 엔진 전부(ChatGPT 포함)의 답.
 *   라벨에 "(질문 언어 기준)"을 병기해 엔진이 아니라 언어가 기준임을 명시한다
 *   — 사용자가 "국내 엔진만 본다"로 오해하지 않게. 상세=`docs/_적용/시장축_언어재설계_2026-08-21.md`.
 */
const marketScopeOptions = (
  t: BrandFormLabels
): Array<{ value: string; label: string }> => [
  { value: "both", label: t.scopeOptionBoth },
  { value: "korea", label: t.scopeOptionKorea },
  { value: "global", label: t.scopeOptionGlobal },
];

const marketScopeLabels = (t: BrandFormLabels): Record<string, string> => ({
  korea: t.scopeKorea,
  global: t.scopeGlobal,
  both: t.scopeBoth,
});

const industryOptions = (
  t: BrandFormLabels
): Array<{ value: string; label: string }> => [
  { value: "manufacturing", label: t.industryManufacturing },
  { value: "b2b_saas", label: t.industryB2bSaas },
  { value: "beauty", label: t.industryBeauty },
  { value: "fashion", label: t.industryFashion },
  { value: "food", label: t.industryFood },
  { value: "retail", label: t.industryRetail },
  { value: "finance", label: t.industryFinance },
  { value: "healthcare", label: t.industryHealthcare },
  { value: "education", label: t.industryEducation },
  { value: "content_ip", label: t.industryContentIp },
  { value: "other", label: t.industryOther },
];

const isBrandIdentityReady = ({
  domain,
  name,
  marketScope,
  industry,
  confirmed,
  pending,
}: {
  domain: string;
  name: string;
  marketScope: string;
  industry: string;
  confirmed: boolean;
  pending: boolean;
}) =>
  isValidDomain(normalizeDomain(domain)) &&
  Boolean(name.trim() && marketScope && industry && confirmed) &&
  !pending;

const nameHelp = (name: string, nameTouched: boolean, t: BrandFormLabels) =>
  name && !nameTouched ? t.nameAutoFilled : t.nameHelp;

const submitLabel = (pending: boolean, t: BrandFormLabels) =>
  pending ? t.submitting : t.submit;

// ⚠️ 타깃 시장 선택지는 제거했다(2026-08-03). 기존 정의가 "국내 중심 = 한국 AI만"이라
// 한국인이 가장 많이 쓰는 ChatGPT 를 제외하는 잘못된 축이었다. 언어축으로 재설계 후 복원.

/**
 * 브랜드 소유 지정 폼 — org 멤버 self.
 * useActionState 로 서버 액션을 감싸 인라인 에러/성공을 표시한다.
 * (admin 게이트 아님: 페이지에서 requireOrg 만 통과하면 렌더된다.)
 */
/**
 * @param nextHref 등록·측정 시작 성공 후 갈 곳. 기본값은 측정 대기 화면.
 *
 * 🔴 **왜 주입인가**(N-44): 이 폼은 `/brand`(브랜드 관리)와 `/welcome`(첫 여정) **둘 다**
 *   쓴다. 폼이 목적지를 고정하면 온보딩이 1단계에서 대기 화면으로 튕겨
 *   **2~5단계를 영영 못 본다**(실측으로 잡은 흐름 끊김).
 *   ⚠️ 폼을 복제해서 해결하지 않는다 — 복제하면 두 화면의 검증·측정 로직이 갈린다.
 */
interface AssignBrandFormProps {
  /** 무료 진단에서 이어온 도메인. 사용자가 다시 입력하지 않게 한다. */
  initialDomain?: string;
  /** 온보딩에서도 측정에 쓰이는 세 값은 먼저 확인한다. */
  mode?: "management" | "onboarding";
  nextHref?: string;
  t: BrandFormLabels;
}

export const AssignBrandForm = ({
  initialDomain = "",
  mode = "management",
  nextHref,
  t,
}: AssignBrandFormProps) => {
  const isOnboarding = mode === "onboarding";
  // Radix Select 는 네이티브 form 에 값을 싣지 않으므로 상태로 들고 액션에 직접 넘긴다
  // (audit-form.tsx 의 측정 언어 Select 와 동일 패턴).
  const [industry, setIndustry] = useState("");
  // 감지 패널(아래)이 도메인에 반응해야 해서 상태로 든다. `name="domain"` 은 그대로 두어
  //   서버 액션이 읽는 경로(FormData)는 바꾸지 않는다 — 제출 경로 무변경.
  const [domain, setDomain] = useState(initialDomain);
  const domainRef = useRef(initialDomain);
  // 🔴 2026-08-21(10번) — 이름 칸도 상태로 든다(이전엔 비제어 input, 필수화하며
  //   자동 채움이 필요해져 제어로 전환). `name="name"` 은 그대로라 제출 경로 무변경.
  const [name, setName] = useState("");
  // 사용자가 이름 칸을 직접 건드렸으면 자동 채움이 그 값을 덮지 않는다.
  const [nameTouched, setNameTouched] = useState(false);
  const nameTouchedRef = useRef(false);
  const industryTouchedRef = useRef(false);
  const [identityConfirmed, setIdentityConfirmed] = useState(false);
  const [suggestionDomain, setSuggestionDomain] = useState(
    initialDomain.trim()
  );
  // 첫 화면은 도메인 하나로 시작하고, 입력을 마치면 이름 확인을 점진적으로 연다.
  const [showIdentity, setShowIdentity] = useState(
    !isOnboarding || Boolean(initialDomain)
  );
  const handleDomainBlur = () => {
    const trimmed = domain.trim();
    setShowIdentity(Boolean(trimmed));
    setSuggestionDomain(trimmed);
  };
  useEffect(() => {
    if (!suggestionDomain) {
      return;
    }
    let cancelled = false;
    suggestBrandIdentity(suggestionDomain)
      .then((suggested) => {
        if (cancelled || domainRef.current.trim() !== suggestionDomain) {
          return;
        }
        if (!nameTouchedRef.current && suggested.name) {
          setName(suggested.name);
        }
        if (!industryTouchedRef.current && suggested.industry) {
          setIndustry(suggested.industry);
        }
      })
      .catch(() => {
        // 제안 실패는 사용자 수동 입력으로 복구한다. 등록·측정은 차단하지 않는다.
      });
    return () => {
      cancelled = true;
    };
  }, [suggestionDomain]);
  // 제안값은 화면에 미리 보여주되 확인 없이는 제출하지 않는다.
  const [marketScopeOverride, setMarketScopeOverride] = useState<string | null>(
    null
  );
  const router = useRouter();

  /**
   * 🔴 측정 **전에** 자동 추정을 보여주는 자리 (세션N-42 · Profound `f049` 대응).
   *
   * 실측 근거(`docs/_경쟁사_UIUX/Profound/_ocr_full.txt` f049): 도메인 하나만 받고
   *   `South Korea` · `Korean (ko)` 를 **감지해서 보여준다**. 묻지 않는다.
   *   → 우리도 입력칸을 늘리지 않고(원가방어 원칙과 동일) 감지값만 드러낸다.
   *
   * ⭐ 우리가 Profound 보다 나은 지점 = **근거 문장**(`reason`)이다.
   *   f049 는 값 두 줄뿐이라 "왜 그렇게 잡혔는지" 를 고객이 알 수 없다.
   *   `inferMarketScope` 는 `reason`·`confidence` 를 **이미 반환하는데 렌더가 0곳이었다**
   *   (계산하고 그대로 버리고 있었다 — 주석은 "UI 가 확인을 띄운다"고 적혀 있다).
   *
   * ⚠️ 원가 0원: 규칙 기반(TLD·업종·언어)이라 네트워크·LLM 호출이 없다. 타이핑마다 돌아도 된다.
   * ⚠️ `industry` 는 `"auto"` 를 **넘기지 않는다** — 유효 enum 이 아니라서
   *   `DOMESTIC_LEANING_INDUSTRIES` 대조가 항상 빗나가고, 실제 저장값(null)과도 어긋난다.
   */
  const detected = useMemo(() => {
    const trimmed = domain.trim();
    if (!trimmed) {
      return null;
    }
    return inferMarketScope({
      domain: trimmed,
      industry: industry || null,
    });
  }, [domain, industry]);
  const selectedMarketScope = marketScopeOverride ?? detected?.scope ?? "";

  const [state, formAction, isPending] = useActionState<FormState, FormData>(
    async (_prev, formData) => {
      const result = await assignBrandOwner({
        // 🔴 2026-08-21(10번) — 필수. 서버도 비면 거부한다(assign.ts 참조).
        name: String(formData.get("name") ?? ""),
        domain: String(formData.get("domain") ?? ""),
        industry,
        marketScope: selectedMarketScope,
        source: isOnboarding ? "onboarding" : "brand_create",
      });
      if ("error" in result) {
        return { status: "idle", error: result.error };
      }
      return {
        status: "ok",
        measurement: result.measurement,
        jobId: result.jobId,
        message: result.message,
      };
    },
    initialState
  );
  const canSubmit = isBrandIdentityReady({
    domain,
    name,
    marketScope: selectedMarketScope,
    industry,
    confirmed: identityConfirmed,
    pending: isPending,
  });

  // 🔴 §3-b ⑴ — 측정 결말을 **화면에 그대로 전달**한다.
  //   예전엔 결말과 무관하게 "등록했어요. 이제 측정 시작을 눌러…" 하나만 띄웠다.
  //   자동 측정을 붙인 지금 그 문구는 거짓이고, 한도에 걸린 경우엔 **측정이 안 됐는데도
  //   성공처럼 보이는 조용한 실패**가 된다. 결말마다 다른 말을 한다.
  useEffect(() => {
    if (state.status !== "ok") {
      return;
    }
    if (state.measurement === "started") {
      toast.success(t.toastStarted);
      // 대기 화면으로. jobId 를 넘겨 그 화면이 진행 상태를 폴링한다.
      // 온보딩이면 다음 단계로, 아니면 기존대로 측정 대기 화면으로.
      router.push(nextHref ?? `/brand/measuring?job=${state.jobId ?? ""}`);
      return;
    }
    // 🔴 **결말을 온보딩까지 들고 간다**(N-44 교차검증에서 잡은 거짓말).
    //   `rate_limited`·`failed` 는 여기서 `router.refresh()` 만 했는데, 온보딩(`nextHref`)
    //   에서는 그 refresh 로 **브랜드가 생긴 화면**이 다시 그려져 2단계로 넘어가고,
    //   마지막 단계가 *"측정은 이미 시작됐어요"* 라고 **거짓말**을 했다.
    //   ⚠️ 토스트는 화면 전환에 살아남지 않는다 → **쿼리로 실어** 다음 화면이 읽게 한다.
    //   📕 이 저장소가 이미 고쳤던 「조용한 실패」와 같은 형태다(§3-b ⑴).
    if (nextHref) {
      const sep = nextHref.includes("?") ? "&" : "?";
      router.push(`${nextHref}${sep}measurement=${state.measurement}`);
      return;
    }
    if (state.measurement === "rate_limited") {
      // 이미 결과가 있다는 뜻이다 — 등록은 됐으니 어디서 보는지 알린다.
      toast.info(state.message ?? t.toastRateLimited, {
        action: { label: t.viewDashboard, onClick: () => router.push("/") },
      });
      router.refresh();
      return;
    }
    // failed — 브랜드는 저장됐다. 측정만 다시 시도하면 된다(아래 목록의 측정 버튼).
    toast.error(state.message ?? t.toastFailed, {
      description: t.toastFailedHint,
    });
    router.refresh();
  }, [
    state.status,
    state.measurement,
    state.jobId,
    state.message,
    router,
    nextHref,
    t,
  ]);

  return (
    <form
      action={formAction}
      className="findable-card flex flex-col gap-4 p-6"
      onSubmit={(event) => {
        if (!canSubmit) {
          event.preventDefault();
        }
      }}
    >
      {/* 🔴 순서를 바꿨다(2026-08-14 §3-a) — **필수 입력이 맨 위**에 온다.
          도메인 하나만 채우면 등록·측정이 끝나는데 선택 입력이 위에 있으면
          "둘 다 채워야 하나" 로 읽힌다. */}
      <div className="flex flex-col gap-2">
        <Label htmlFor="brand-domain">{t.domainLabel}</Label>
        <Input
          autoComplete="url"
          id="brand-domain"
          name="domain"
          onBlur={handleDomainBlur}
          onChange={(e) => {
            domainRef.current = e.target.value;
            setDomain(e.target.value);
            setSuggestionDomain("");
            setIdentityConfirmed(false);
            setMarketScopeOverride(null);
            if (!nameTouchedRef.current) {
              setName("");
            }
            if (!industryTouchedRef.current) {
              setIndustry("");
            }
          }}
          onKeyDown={(e) => {
            if (isOnboarding && e.key === "Enter" && !showIdentity) {
              e.preventDefault();
              setShowIdentity(Boolean(domain.trim()));
              e.currentTarget.blur();
            }
          }}
          placeholder={t.domainPlaceholder}
          required
          value={domain}
        />
        {initialDomain ? (
          <p className="text-muted-foreground text-xs">{t.domainFromAudit}</p>
        ) : null}
      </div>
      {detected ? (
        <div
          aria-live="polite"
          className="flex flex-col gap-1 rounded-md border border-[color:var(--findable-border,#2a2d31)] bg-[color:var(--findable-surface-2,rgba(255,255,255,0.03))] p-3"
        >
          <p className="font-medium text-sm">
            {t.detectedTitle}
            {detected.confidence === "low" ? (
              // 확신이 낮을 때만 확인을 **강하게** 요청한다(`market-scope.ts` 의 설계 의도:
              //   "low 면 UI 가 「맞나요?」 확인을 더 강하게 띄운다"). high 면 조용히 넘어간다.
              <span className="ml-1 font-normal text-[color:var(--signal-warn,#e0a458)]">
                {t.detectedLowConfidence}
              </span>
            ) : null}
          </p>
          <p className="text-sm">
            {t.targetMarket}{" "}
            <strong>
              {marketScopeLabels(t)[marketScopeOverride ?? detected.scope]}
            </strong>
          </p>
          {/* 🔴 Profound f049 에 **없는 것** = 근거. 값만 던지면 고객은 무엇을 고쳐야
              할지 모른다. 이 문장은 `inferMarketScope` 가 이미 만들어 반환한다.
              직접 골랐으면 근거 대신 "직접 선택했다"고 말한다 — 감지 근거는 선택을
              덮어쓴 뒤엔 더 이상 사실이 아니다. */}
          <p className="text-muted-foreground text-xs">
            {marketScopeOverride
              ? t.chosenManually
              : marketScopeReason(detected.reasonCode, t)}
          </p>
        </div>
      ) : null}
      {showIdentity ? (
        <div className="flex flex-col gap-2">
          <Label htmlFor="brand-market-scope">{t.targetMarket}</Label>
          <Select
            onValueChange={(value) => {
              setMarketScopeOverride(value);
              setIdentityConfirmed(false);
            }}
            value={selectedMarketScope || undefined}
          >
            <SelectTrigger className="w-full" id="brand-market-scope">
              <SelectValue placeholder={t.scopePlaceholder} />
            </SelectTrigger>
            <SelectContent>
              {marketScopeOptions(t).map((opt) => (
                <SelectItem key={opt.value} value={opt.value}>
                  {opt.label}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
          <p className="text-muted-foreground text-xs">{t.scopeHelp}</p>
        </div>
      ) : null}
      {showIdentity ? (
        <div className="flex flex-col gap-2">
          {/* 🔴 2026-08-21(10번) — **선택 → 필수**로 전환(👤 결정). 이름이 비면 도메인
            문자열이 그대로 측정 프롬프트에 박힌다(`sulwhasoo.com 추천해줘`) — 실측으로
            확인된 측정 품질 저하(N-49). "브랜드 이름"이라는 말이 좁게 읽혀 스킵되기
            쉬웠으므로, 별도 브랜드명이 없는 회사도 자연스럽게 채우도록 질문·placeholder를
            "우리를 부르는 이름"으로 넓힌다(HIG "offer choices/examples instead of
            blind text entry" — 질문 자체를 없애는 대신 답하기 쉽게 만드는 쪽). */}
          <Label htmlFor="brand-name">{t.nameLabel}</Label>
          <Input
            autoComplete="off"
            id="brand-name"
            name="name"
            onChange={(e) => {
              setNameTouched(true);
              nameTouchedRef.current = true;
              setName(e.target.value);
              setIdentityConfirmed(false);
            }}
            placeholder={t.namePlaceholder}
            required
            value={name}
          />
          <p className="text-muted-foreground text-xs">
            {nameHelp(name, nameTouched, t)}
          </p>
        </div>
      ) : null}
      {showIdentity ? (
        <div className="flex flex-col gap-2">
          <Label htmlFor="brand-industry">{t.industryLabel}</Label>
          {/* 🔴 S7-c(2026-08-11) — `SelectTrigger` 기본값이 **`w-fit`**(design-system)이라
            위의 브랜드 이름·도메인 입력칸(전폭)과 폭이 어긋났다. 같은 폼의 같은 등급
            입력인데 생김새가 달라 "덜 중요한 칸"으로 읽힌다(NN/g 4 일관성).
            → 전폭으로 맞춘다. */}
          <Select
            onValueChange={(value) => {
              industryTouchedRef.current = true;
              setIndustry(value);
              setIdentityConfirmed(false);
            }}
            value={industry || undefined}
          >
            <SelectTrigger className="w-full" id="brand-industry">
              <SelectValue placeholder={t.industryPlaceholder} />
            </SelectTrigger>
            <SelectContent>
              {industryOptions(t).map((opt) => (
                <SelectItem key={opt.value} value={opt.value}>
                  {opt.label}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
          {/* 🔴 S4(2026-08-11) — 예전 문구 「업종에 따라 **개선 처방의 채널**이
            달라집니다」. '처방'·'채널' 둘 다 내부 용어이고, 이 화면에서는 처방을
            아직 본 적이 없어 **참조할 대상조차 없다**. 게다가 이 문장만 '~합니다'체라
            화면의 나머지(해요체)와 말투가 어긋났다(진단 §원인④ · NN/g 2·4). */}
          <p className="text-muted-foreground text-xs">{t.industryHelp}</p>
        </div>
      ) : null}
      {showIdentity ? (
        <label className="flex items-start gap-3 rounded-md border border-[color:var(--findable-border,#2a2d31)] p-3 text-sm">
          <input
            checked={identityConfirmed}
            className="mt-0.5 size-4 accent-[color:var(--findable-accent,#79d0b5)]"
            onChange={(event) => setIdentityConfirmed(event.target.checked)}
            type="checkbox"
          />
          <span>{t.confirm}</span>
        </label>
      ) : null}
      {state.error ? (
        <p
          // `--findable-danger` 는 **존재하지 않는 토큰**이었다(globals.css 실측·2026-08-07).
          //   CSS 폴백(#f87171)으로 연명해 화면은 멀쩡해 보이던 조용한 결함. 실존 토큰으로 교체.
          className="text-[color:var(--signal-bad,#f87171)] text-sm"
          role="alert"
        >
          {state.error}
        </p>
      ) : null}

      {showIdentity ? (
        <div className="flex justify-end">
          <Button
            className="findable-btn-primary"
            disabled={!canSubmit}
            type="submit"
          >
            {submitLabel(isPending, t)}
          </Button>
        </div>
      ) : null}
    </form>
  );
};
