"use client";

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
import { useRouter } from "next/navigation";
import { useState, type FormEvent } from "react";

interface AuditFormProps {
  dictionary: Dictionary;
  locale: string;
}

type Language = "ko" | "en" | "both";

export function AuditForm({ locale }: AuditFormProps) {
  const router = useRouter();
  const isKo = locale.startsWith("ko");

  const [email, setEmail] = useState("");
  const [domain, setDomain] = useState("");
  const [brandName, setBrandName] = useState("");
  const [language, setLanguage] = useState<Language>("both");
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function handleSubmit(e: FormEvent) {
    e.preventDefault();
    setError(null);
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
        | { jobId: string; status: string; pollUrl: string }
        | { error: string; existingJobId?: string };

      if (!response.ok) {
        if ("existingJobId" in data && data.existingJobId) {
          router.push(`/${locale}/audit/${data.existingJobId}`);
          return;
        }
        setError("error" in data ? data.error : (isKo ? "요청 실패" : "Request failed"));
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
    <form onSubmit={handleSubmit} className="flex flex-col gap-5">
      <div className="grid gap-4 md:grid-cols-2">
        <div className="flex flex-col gap-2">
          <Label htmlFor="audit-email">{isKo ? "이메일" : "Email"}</Label>
          <Input
            id="audit-email"
            type="email"
            required
            value={email}
            onChange={(e) => setEmail(e.target.value)}
            placeholder={isKo ? "you@brand.com" : "you@brand.com"}
            disabled={loading}
          />
        </div>
        <div className="flex flex-col gap-2">
          <Label htmlFor="audit-domain">{isKo ? "도메인" : "Domain"}</Label>
          <Input
            id="audit-domain"
            type="text"
            required
            value={domain}
            onChange={(e) => setDomain(e.target.value)}
            placeholder="medicube.co.kr"
            disabled={loading}
          />
        </div>
      </div>

      <div className="grid gap-4 md:grid-cols-2">
        <div className="flex flex-col gap-2">
          <Label htmlFor="audit-brand">
            {isKo ? "브랜드명 (선택)" : "Brand name (optional)"}
          </Label>
          <Input
            id="audit-brand"
            type="text"
            value={brandName}
            onChange={(e) => setBrandName(e.target.value)}
            placeholder={isKo ? "비워두면 도메인에서 추출" : "Auto-detected from domain"}
            disabled={loading}
          />
        </div>
        <div className="flex flex-col gap-2">
          <Label htmlFor="audit-language">{isKo ? "측정 언어" : "Languages"}</Label>
          <Select
            value={language}
            onValueChange={(v) => setLanguage(v as Language)}
            disabled={loading}
          >
            <SelectTrigger id="audit-language">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="both">
                {isKo ? "한국어 + 영어 (권장)" : "Korean + English (recommended)"}
              </SelectItem>
              <SelectItem value="ko">{isKo ? "한국어만" : "Korean only"}</SelectItem>
              <SelectItem value="en">{isKo ? "영어만" : "English only"}</SelectItem>
            </SelectContent>
          </Select>
        </div>
      </div>

      {error && (
        <div className="rounded-md border border-red-200 bg-red-50 px-4 py-3 text-red-800 text-sm">
          {error}
        </div>
      )}

      <Button type="submit" size="lg" disabled={loading} className="gap-2">
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
