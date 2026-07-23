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
import { useCallback, useEffect, useRef, useState } from "react";

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

        const reader = res.body.getReader();
        const decoder = new TextDecoder();
        let acc = "";
        // 순수 텍스트 스트림 — 청크를 그대로 이어붙여 assistant 턴을 갱신
        for (;;) {
          const { done, value } = await reader.read();
          if (done) {
            break;
          }
          acc += decoder.decode(value, { stream: true });
          setMessages((prev) =>
            prev.map((m) => (m.id === assistantId ? { ...m, content: acc } : m))
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
    [jobId, messages, streaming]
  );

  const suggestions = isKo ? SUGGESTIONS_KO : SUGGESTIONS_EN;

  return (
    <div className="group relative overflow-hidden rounded-2xl border border-white/10 bg-zinc-900/60 backdrop-blur-sm">
      {/* 헤더 */}
      <div className="flex items-center gap-2 border-white/10 border-b px-5 py-4">
        <div className="flex h-8 w-8 items-center justify-center rounded-lg bg-grad-brand text-white">
          <MessageCircle className="h-4 w-4" />
        </div>
        <div>
          <div className="font-mono text-[10px] text-[var(--brand-2)] uppercase tracking-[0.18em]">
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
            <p className="text-sm text-zinc-500 leading-relaxed">
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
                {m.content ? (
                  <span className="whitespace-pre-wrap">{m.content}</span>
                ) : (
                  <Loader2 className="h-4 w-4 animate-spin text-[var(--brand-2)]" />
                )}
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
          className="flex-1 rounded-md border border-white/10 bg-zinc-900 px-3 py-2 text-sm text-zinc-100 placeholder:text-zinc-500 focus:border-[var(--brand-2)] focus:outline-none disabled:opacity-50"
          disabled={streaming}
          onChange={(e) => setInput(e.target.value)}
          placeholder={isKo ? "질문을 입력하세요…" : "Type your question…"}
          value={input}
        />
        <Button
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
