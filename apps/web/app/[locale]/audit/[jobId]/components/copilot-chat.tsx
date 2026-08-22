"use client";

// GEO 코파일럿 챗 — 4 에이전트 진단 결과를 대화로 풀어주는 단일 코파일럿
//
// 4 에이전트 분석(crewStatus === "completed")이 끝난 뒤에만 노출.
// crewResult·metrics 컨텍스트는 서버가 DB에서 직접 읽으므로 (변조 방지),
// 클라이언트는 대화 히스토리(messages)만 POST한다.
//
// @ai-sdk/react(useChat) 미사용 — ai@6 v4/v5/v6 버전 혼재 회피.
// fetch + ReadableStream 순수 텍스트 스트림을 직접 읽어 토큰 단위로 렌더링.

import { Button } from "@repo/design-system/components/ui/button";
import { Loader2, MessageCircle, SendHorizonal } from "lucide-react";
import {
  type ReactNode,
  useCallback,
  useEffect,
  useRef,
  useState,
} from "react";

// ── 경량 마크다운 표시 ─────────────────────────────────────────
// 모델 답변이 마크다운(#·**·---·목록)으로 오는데 원문 기호가 말풍선에
// 그대로 보이는 문제(2026-07-30 사용자 지적)의 표시측 해소.
// 표·링크까지 다루는 풀 렌더러 의존성은 챗 말풍선엔 과투자라 도입하지 않고,
// 실제로 등장하는 패턴(헤딩·굵게·구분선)만 변환한다. 스트리밍 중에도 동작.

const HR_RE = /^\s*-{3,}\s*$/;
const HEADING_RE = /^\s*#{1,4}\s+(.*)$/;

/** `**굵게**` 인라인만 <strong>으로. 홀수 개 `**`는 마지막 조각을 평문 처리. */
function renderInline(text: string): ReactNode {
  const parts = text.split("**");
  if (parts.length < 3) {
    return text;
  }
  return parts.map((part, i) =>
    i % 2 === 1 && i < parts.length - (parts.length % 2 === 0 ? 1 : 0) ? (
      // biome-ignore lint/suspicious/noArrayIndexKey: 조각 순서가 곧 정체성(스트리밍 텍스트)
      <strong className="font-semibold text-zinc-50" key={i}>
        {part}
      </strong>
    ) : (
      part
    )
  );
}

function LineBlock({ line }: { line: string }) {
  if (HR_RE.test(line)) {
    return <hr className="my-2 border-white/10" />;
  }
  const heading = line.match(HEADING_RE);
  if (heading) {
    return (
      <p className="mt-2 font-semibold text-zinc-50">
        {renderInline(heading[1] ?? "")}
      </p>
    );
  }
  if (line.trim().length === 0) {
    return <div aria-hidden className="h-2" />;
  }
  return <p className="whitespace-pre-wrap">{renderInline(line)}</p>;
}

function MarkdownLite({ content }: { content: string }) {
  return (
    <div className="space-y-1">
      {content.split("\n").map((line, i) => (
        // biome-ignore lint/suspicious/noArrayIndexKey: 스트리밍 텍스트 — 줄 순서가 곧 정체성
        <LineBlock key={i} line={line} />
      ))}
    </div>
  );
}

function MessageBody({
  message,
}: {
  message: { content: string; role: "user" | "assistant" };
}) {
  if (!message.content) {
    return <Loader2 className="h-4 w-4 animate-spin text-[var(--brand-2)]" />;
  }
  if (message.role === "assistant") {
    return <MarkdownLite content={message.content} />;
  }
  return <span className="whitespace-pre-wrap">{message.content}</span>;
}

/** 순수 텍스트 스트림을 끝까지 읽으며 누적값을 콜백으로 전달. 최종 누적 문자열 반환. */
async function readTextStream(
  body: ReadableStream<Uint8Array>,
  onAccumulate: (acc: string) => void
): Promise<string> {
  const reader = body.getReader();
  const decoder = new TextDecoder();
  let acc = "";
  for (;;) {
    const { done, value } = await reader.read();
    if (done) {
      break;
    }
    acc += decoder.decode(value, { stream: true });
    onAccumulate(acc);
  }
  return acc;
}

interface Props {
  isKo: boolean;
  jobId: string;
}

interface ChatMessage {
  content: string;
  id: number;
  role: "user" | "assistant";
}

const SUGGESTIONS_KO = [
  "그래서 제일 먼저 뭘 고쳐야 하나요?",
  "네이버에서 안 뜨는 이유가 뭔가요?",
  "경쟁사 대비 어디가 약한가요?",
];
const SUGGESTIONS_EN = [
  "What should I fix first?",
  "Why aren't we showing up on Naver?",
  "Where are we weakest vs competitors?",
];
/* 아이콘만 있는 전송 버튼의 접근성 이름 (스크린리더가 "버튼"으로만 읽던 것) */
const SEND_LABELS_KO = { busy: "답변 생성 중", idle: "질문 보내기" };
const SEND_LABELS_EN = { busy: "Generating answer", idle: "Send question" };

export function CopilotChat({ jobId, isKo }: Props) {
  const [messages, setMessages] = useState<ChatMessage[]>([]);
  const [input, setInput] = useState("");
  const [streaming, setStreaming] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const scrollRef = useRef<HTMLDivElement>(null);

  // 새 메시지·토큰 도착 시 하단으로 스크롤 (내용 길이 변화에 반응)
  const totalChars = messages.reduce((n, m) => n + m.content.length, 0);
  // biome-ignore lint/correctness/useExhaustiveDependencies: totalChars가 내용 변화 트리거
  useEffect(() => {
    scrollRef.current?.scrollTo({
      top: scrollRef.current.scrollHeight,
      behavior: "smooth",
    });
  }, [totalChars]);

  const send = useCallback(
    async (text: string) => {
      const trimmed = text.trim();
      if (!trimmed || streaming) {
        return;
      }

      setError(null);
      setInput("");
      const baseId = messages.length;
      // user 턴 + 빈 assistant 턴(스트리밍 채울 자리)을 함께 추가
      const history: ChatMessage[] = [
        ...messages,
        { id: baseId, role: "user", content: trimmed },
      ];
      const assistantId = baseId + 1;
      setMessages([
        ...history,
        { id: assistantId, role: "assistant", content: "" },
      ]);
      setStreaming(true);

      try {
        const res = await fetch(`/api/audit/${jobId}/chat`, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          // 서버는 role/content만 받는다 (id는 클라이언트 렌더용)
          body: JSON.stringify({
            messages: history.map((m) => ({
              role: m.role,
              content: m.content,
            })),
          }),
        });

        if (!(res.ok && res.body)) {
          const data = (await res.json().catch(() => ({}))) as {
            error?: string;
          };
          throw new Error(data.error ?? `HTTP ${res.status}`);
        }

        // 순수 텍스트 스트림 — 청크를 그대로 이어붙여 assistant 턴을 갱신
        const acc = await readTextStream(res.body, (partial) => {
          setMessages((prev) =>
            prev.map((m) =>
              m.id === assistantId ? { ...m, content: partial } : m
            )
          );
        });
        // 200인데 토큰이 0개(모델 호출이 비동기로 실패해 빈 스트림만 닫힌 경우,
        // 결함감사 §21) — 빈 말풍선을 남기지 말고 에러로 처리한다.
        if (acc.trim().length === 0) {
          throw new Error(
            isKo
              ? "응답을 받지 못했습니다. 잠시 후 다시 시도해 주세요."
              : "No response received. Please try again."
          );
        }
      } catch (err) {
        const msg = err instanceof Error ? err.message : String(err);
        setError(msg);
        // 실패한 빈 assistant 턴 제거
        setMessages((prev) => {
          const next = [...prev];
          const last = next.at(-1);
          if (last?.role === "assistant" && !last.content) {
            next.pop();
          }
          return next;
        });
      } finally {
        setStreaming(false);
      }
    },
    [jobId, messages, streaming, isKo]
  );

  const suggestions = isKo ? SUGGESTIONS_KO : SUGGESTIONS_EN;
  const sendLabels = isKo ? SEND_LABELS_KO : SEND_LABELS_EN;

  return (
    <div className="group relative overflow-hidden rounded-2xl border border-white/10 bg-zinc-900/60 backdrop-blur-sm">
      {/* 헤더 */}
      <div className="flex items-center gap-2 border-white/10 border-b px-5 py-4">
        <div className="flex h-8 w-8 items-center justify-center rounded-lg bg-grad-brand text-white">
          <MessageCircle className="h-4 w-4" />
        </div>
        <div>
          <div className="font-medium text-[var(--brand-2)] text-xs">
            {isKo ? "GEO 코파일럿" : "GEO Copilot"}
          </div>
          <div className="text-sm text-zinc-300">
            {isKo
              ? "진단 결과를 놓고 무엇이든 물어보세요"
              : "Ask anything about your diagnosis"}
          </div>
        </div>
      </div>

      {/* 대화 영역 */}
      <div
        className="max-h-[420px] space-y-4 overflow-y-auto px-5 py-5"
        ref={scrollRef}
      >
        {messages.length === 0 ? (
          <div className="space-y-3">
            <p className="text-sm text-zinc-400 leading-relaxed">
              {isKo
                ? "4 에이전트 진단 결과를 바탕으로 답합니다. 예를 들어:"
                : "Answers grounded in your 4-agent diagnosis. For example:"}
            </p>
            <div className="flex flex-wrap gap-2">
              {suggestions.map((s) => (
                <button
                  className="rounded-full border border-white/10 bg-white/5 px-3 py-1.5 text-xs text-zinc-300 transition-colors hover:border-[var(--brand-2)] hover:text-zinc-100"
                  key={s}
                  onClick={() => send(s)}
                  type="button"
                >
                  {s}
                </button>
              ))}
            </div>
          </div>
        ) : (
          messages.map((m) => (
            <div
              className={
                m.role === "user" ? "flex justify-end" : "flex justify-start"
              }
              key={m.id}
            >
              <div
                className={
                  m.role === "user"
                    ? "max-w-[85%] rounded-2xl rounded-br-sm bg-[var(--brand-1)]/15 px-4 py-2.5 text-sm text-zinc-100"
                    : "max-w-[90%] rounded-2xl rounded-bl-sm bg-zinc-800/60 px-4 py-2.5 text-sm text-zinc-200 leading-relaxed"
                }
              >
                <MessageBody message={m} />
              </div>
            </div>
          ))
        )}
      </div>

      {error && <p className="px-5 pb-2 text-red-400 text-sm">⚠ {error}</p>}

      {/* 입력 */}
      <form
        className="flex items-center gap-2 border-white/10 border-t px-4 py-3"
        onSubmit={(e) => {
          e.preventDefault();
          send(input);
        }}
      >
        <input
          className="flex-1 rounded-md border border-white/10 bg-zinc-900 px-3 py-2 text-sm text-zinc-100 placeholder:text-zinc-400 focus:border-[var(--brand-2)] focus:outline-none disabled:opacity-50"
          disabled={streaming}
          onChange={(e) => setInput(e.target.value)}
          placeholder={isKo ? "질문을 입력하세요…" : "Type your question…"}
          value={input}
        />
        <Button
          aria-label={streaming ? sendLabels.busy : sendLabels.idle}
          className="gap-1.5"
          disabled={streaming || !input.trim()}
          size="sm"
          type="submit"
        >
          {streaming ? (
            <Loader2 className="h-4 w-4 animate-spin" />
          ) : (
            <SendHorizonal className="h-4 w-4" />
          )}
        </Button>
      </form>
    </div>
  );
}
