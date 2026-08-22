"use client";

import { Badge } from "@repo/design-system/components/ui/badge";
import type { OrgDetail } from "@/app/actions/admin/orgs";

/**
 * 조직 상세 — **「누가 무엇을 넣었나」** (N-46 · 👤 *"CMS 로서도 기능하도록"*).
 *
 * 🔴 **왜 만들었나**: 운영 콘솔이 조직명·플랜·**개수**만 보여줬다.
 *   *"브랜드 7"* 은 보이는데 **어떤 브랜드인지**, *"가입 3"* 인데 **누가 가입했는지**
 *   앱에서 볼 방법이 0곳이었다 → 운영자가 매번 DB 를 직접 열어야 했다.
 *
 * ⚠️ **없는 걸 지어내지 않는다** — 고객이 안 넣은 값은 *"비어 있음"* 이라고 **말한다**.
 *   특히 `경쟁사 없음` 은 운영상 의미가 있다: 등록 경쟁사가 없으면 측정마다
 *   **AI 가 경쟁사를 새로 추측**한다(`runner.ts`) → 회차마다 결과가 흔들린다.
 *   `marketScope` null 도 마찬가지로 *"자동 추정"* 이라는 **뜻이 있는 상태**다.
 */

const fmt = (d: Date) => new Date(d).toLocaleDateString("ko-KR");

/** 값이 없을 때 회색으로 "왜 비었는지"를 말한다. */
const Empty = ({ children }: { children: string }) => (
  <span className="text-[color:var(--findable-ink-tertiary,#7e8289)]">
    {children}
  </span>
);

export const OrgDetailPanel = ({ detail }: { detail: OrgDetail }) => (
  <div className="flex flex-col gap-5 border-[color:var(--findable-hairline,#23252a)] border-t bg-[color:var(--findable-surface-sunken,#0f1012)] px-4 py-4">
    {/* ── 가입자 ── */}
    <section className="flex flex-col gap-2">
      <h4 className="font-medium text-[color:var(--findable-ink,#f7f8f8)] text-sm">
        가입자 {detail.members.length}
      </h4>
      {detail.members.length === 0 ? (
        <p className="text-sm">
          <Empty>아직 가입자가 없어요.</Empty>
        </p>
      ) : (
        <ul className="flex flex-col gap-1">
          {detail.members.map((m) => (
            <li
              className="flex flex-wrap items-baseline gap-x-3 text-sm"
              key={m.id}
            >
              <span className="text-[color:var(--findable-ink,#f7f8f8)]">
                {m.email}
              </span>
              {m.name ? (
                <span className="text-[color:var(--findable-ink-subtle,#8a8f98)]">
                  {m.name}
                </span>
              ) : null}
              <span className="text-[color:var(--findable-ink-tertiary,#7e8289)] text-xs">
                {fmt(m.createdAt)} 가입
              </span>
            </li>
          ))}
        </ul>
      )}
    </section>

    {/* ── 등록 브랜드 ── */}
    <section className="flex flex-col gap-2">
      <h4 className="font-medium text-[color:var(--findable-ink,#f7f8f8)] text-sm">
        등록 브랜드 {detail.brands.length}
      </h4>
      {detail.brands.length === 0 ? (
        <p className="text-sm">
          <Empty>
            브랜드를 아직 등록하지 않았어요 — 측정을 시작할 수 없는 상태예요.
          </Empty>
        </p>
      ) : (
        <ul className="flex flex-col gap-3">
          {detail.brands.map((b) => (
            <li
              className="flex flex-col gap-1.5 rounded-md border border-[color:var(--findable-hairline,#23252a)] p-3"
              key={b.id}
            >
              <div className="flex flex-wrap items-center gap-2">
                <span className="font-medium text-[color:var(--findable-ink,#f7f8f8)]">
                  {b.name}
                </span>
                <span className="text-[color:var(--findable-ink-subtle,#8a8f98)] text-sm">
                  {b.domain}
                </span>
                <Badge variant="outline">측정 {b.trackingCount}회</Badge>
              </div>

              <dl className="grid grid-cols-1 gap-x-6 gap-y-1 text-sm sm:grid-cols-2">
                <div className="flex gap-2">
                  <dt className="text-[color:var(--findable-ink-subtle,#8a8f98)]">
                    업종
                  </dt>
                  <dd>{b.industry ?? <Empty>자동 감지</Empty>}</dd>
                </div>
                <div className="flex gap-2">
                  <dt className="text-[color:var(--findable-ink-subtle,#8a8f98)]">
                    타깃 시장
                  </dt>
                  {/* null 은 "안 넣음"이 아니라 **자동 추정**이라는 뜻이다(설계). */}
                  <dd>{b.marketScope ?? <Empty>자동 추정</Empty>}</dd>
                </div>
                <div className="flex gap-2">
                  <dt className="shrink-0 text-[color:var(--findable-ink-subtle,#8a8f98)]">
                    다른 이름
                  </dt>
                  <dd>
                    {b.entityVariants.length > 0 ? (
                      b.entityVariants.join(" · ")
                    ) : (
                      <Empty>없음</Empty>
                    )}
                  </dd>
                </div>
                <div className="flex gap-2">
                  <dt className="shrink-0 text-[color:var(--findable-ink-subtle,#8a8f98)]">
                    경쟁사
                  </dt>
                  <dd>
                    {b.competitors.length > 0 ? (
                      b.competitors.join(" · ")
                    ) : (
                      // 🔴 운영상 의미가 있는 빈 값 — 등록 경쟁사가 없으면
                      //   측정마다 AI 가 새로 추측해서 회차마다 결과가 흔들린다.
                      <Empty>없음 — 측정마다 AI가 새로 추측해요</Empty>
                    )}
                  </dd>
                </div>
              </dl>

              <div className="flex flex-col gap-1">
                <span className="text-[color:var(--findable-ink-subtle,#8a8f98)] text-sm">
                  추적 질문 {b.prompts.length}
                </span>
                {b.prompts.length === 0 ? (
                  <p className="text-sm">
                    <Empty>
                      질문이 없어요 — 무엇을 물어볼지가 결과를 정해요.
                    </Empty>
                  </p>
                ) : (
                  <ul className="flex flex-col gap-0.5">
                    {b.prompts.map((text) => (
                      <li
                        className="text-[color:var(--findable-ink-subtle,#8a8f98)] text-sm"
                        key={text}
                      >
                        · {text}
                      </li>
                    ))}
                  </ul>
                )}
              </div>
            </li>
          ))}
        </ul>
      )}
    </section>
  </div>
);
