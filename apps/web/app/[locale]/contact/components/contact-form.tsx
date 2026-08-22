"use client";

import { Button } from "@repo/design-system/components/ui/button";
import { Input } from "@repo/design-system/components/ui/input";
import { Label } from "@repo/design-system/components/ui/label";
import { Textarea } from "@repo/design-system/components/ui/textarea";
import type { Dictionary } from "@repo/internationalization";
import { Check, MoveRight } from "lucide-react";
import { useActionState } from "react";
import { contact } from "../actions/contact";

interface ContactFormProps {
  dictionary: Dictionary;
  locale: string;
}

interface FormState {
  error?: string;
  status: "idle" | "ok";
}

const initialState: FormState = { status: "idle" };

// 로케일별 카피(중첩 삼항·복잡도 방지용 사전). 페이지 골격 카피는 dictionary, 폼 필드는 여기서.
const COPY = {
  ko: {
    received: "접수됐어요!",
    receivedDesc: "영업일 기준 1일 내에 입력하신 이메일로 답변드릴게요.",
    name: "이름",
    namePh: "홍길동",
    email: "업무용 이메일",
    message: "문의 내용",
    messagePh:
      "브랜드/도메인과 궁금한 점을 적어주세요. (요금제·측정 범위·GEO 컨설팅 등)",
    sending: "보내는 중…",
  },
  en: {
    received: "Request received!",
    receivedDesc: "We'll get back to you within 1 business day.",
    name: "Name",
    namePh: "Jane Doe",
    email: "Work email",
    message: "Message",
    messagePh: "Tell us about your brand and what you need.",
    sending: "Sending…",
  },
} as const;

/**
 * 상담 신청 폼 (2026-07-30 플로우 감사 🔴4 해소).
 * 예전엔 next-forge 구인지원 템플릿 잔재(달력·이력서 업로드)에 제출 배선이 없어
 * pricing·billing·hero·진단결과의 모든 유료 CTA가 죽은 폼에 수렴했다.
 * → 이름/이메일/문의 3필드 + 기존 서버액션 contact(Resend 발송) 연결.
 */
export const ContactForm = ({ dictionary, locale }: ContactFormProps) => {
  const t = locale === "ko" ? COPY.ko : COPY.en;

  const [state, formAction, isPending] = useActionState<FormState, FormData>(
    async (_prev, formData) => {
      const result = await contact(
        String(formData.get("name") ?? ""),
        String(formData.get("email") ?? ""),
        String(formData.get("message") ?? "")
      );
      if (result.error) {
        return { status: "idle", error: result.error };
      }
      return { status: "ok" };
    },
    initialState
  );

  return (
    <div className="w-full py-20 lg:py-40">
      <div className="container mx-auto max-w-6xl">
        <div className="grid gap-10 lg:grid-cols-2">
          <div className="flex flex-col gap-6">
            <div className="flex flex-col gap-4">
              <div className="flex flex-col gap-2">
                <h4 className="max-w-xl text-left font-regular text-3xl tracking-tighter md:text-5xl">
                  {dictionary.web.contact.meta.title}
                </h4>
                <p className="max-w-sm text-left text-lg text-muted-foreground leading-relaxed tracking-tight">
                  {dictionary.web.contact.meta.description}
                </p>
              </div>
            </div>
            {dictionary.web.contact.hero.benefits.map((benefit) => (
              <div
                className="flex flex-row items-start gap-6 text-left"
                key={benefit.title}
              >
                <Check className="mt-2 h-4 w-4 text-primary" />
                <div className="flex flex-col gap-1">
                  <p>{benefit.title}</p>
                  <p className="text-muted-foreground text-sm">
                    {benefit.description}
                  </p>
                </div>
              </div>
            ))}
          </div>

          <div className="flex items-center justify-center">
            {state.status === "ok" ? (
              <div className="flex w-full max-w-sm flex-col items-center gap-3 rounded-md border p-8 text-center">
                <Check className="h-8 w-8 text-primary" />
                <p className="font-medium">{t.received}</p>
                <p className="text-muted-foreground text-sm">
                  {t.receivedDesc}
                </p>
              </div>
            ) : (
              <form
                action={formAction}
                className="flex w-full max-w-sm flex-col gap-4 rounded-md border p-8"
              >
                <p>{dictionary.web.contact.hero.form.title}</p>
                <div className="grid w-full items-center gap-1">
                  <Label htmlFor="contact-name">{t.name}</Label>
                  <Input
                    autoComplete="name"
                    id="contact-name"
                    name="name"
                    placeholder={t.namePh}
                    required
                    type="text"
                  />
                </div>
                <div className="grid w-full items-center gap-1">
                  <Label htmlFor="contact-email">{t.email}</Label>
                  <Input
                    autoComplete="email"
                    id="contact-email"
                    name="email"
                    placeholder="name@company.com"
                    required
                    type="email"
                  />
                </div>
                <div className="grid w-full items-center gap-1">
                  <Label htmlFor="contact-message">{t.message}</Label>
                  <Textarea
                    id="contact-message"
                    name="message"
                    placeholder={t.messagePh}
                    required
                    rows={5}
                  />
                </div>

                {state.error ? (
                  <p className="text-destructive text-sm" role="alert">
                    {state.error}
                  </p>
                ) : null}

                <Button className="w-full gap-4" disabled={isPending}>
                  {isPending ? t.sending : dictionary.web.contact.hero.form.cta}{" "}
                  <MoveRight className="h-4 w-4" />
                </Button>
              </form>
            )}
          </div>
        </div>
      </div>
    </div>
  );
};
