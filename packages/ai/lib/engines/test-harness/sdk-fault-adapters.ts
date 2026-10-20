// U5 2단계 — 「실제 어댑터의 실패 표현」을 따르는 모의 어댑터.
//
// fault-engine 의 기본 모양(오류를 errorMessage 응답으로만 돌려줌)은 재시도 판단에 쓰이는
// **힌트(Retry-After·재시도 가능 여부)** 가 없어, 실제 어댑터가 하는 일을 시험할 수 없다.
// 실제 어댑터(global-adapters.ts)는 공급자 오류를 잡아
//   `noteRetryHint(오류 응답, classifyRetryable(오류))`  로 돌려주고,
// 빈 응답은 STABILITY_EMPTY_AS_ERROR_ENABLED 가 켜졌을 때 오류 응답(재시도 가능)으로 바꾼다.
// 이 파일은 그 두 가지를 **같은 함수(classifyRetryable·noteRetryHint)** 로 흉내 낸다.
//   - 흉내 내는 부분은 아래 두 분기뿐이다(어댑터의 catch · 빈 응답 분기). 재시도·브레이커·집계는 진짜 코드다.
//   - 어댑터 자체(빈 응답 분기·maxRetries 옵션)는 stability-adapters.test.ts 가 진짜 어댑터로 따로 시험한다.

import { isStabilityFlagOn } from "../../stability-flags";
import { classifyRetryable, noteRetryHint } from "../cell-retry";
import { isAbortError } from "../provider-error";
import type { EngineAdapter } from "../types";
import {
  errorResponse,
  type FaultHarness,
  InjectedHttpError,
} from "./fault-engine";

/** 하네스(오류를 throw 하는 방식으로 만들어야 한다)를 실제 어댑터처럼 동작하는 어댑터로 감싼다. */
export const sdkLikeAdapter =
  (harness: FaultHarness): EngineAdapter =>
  async (query) => {
    try {
      const response = await harness.adapter(query);
      if (
        isStabilityFlagOn("STABILITY_EMPTY_AS_ERROR_ENABLED") &&
        !response.errorMessage &&
        response.rawResponse.trim().length === 0
      ) {
        return noteRetryHint(
          errorResponse(
            query.engineId,
            `Engine ${query.engineId} returned an empty answer`
          ),
          { retryable: true }
        );
      }
      return response;
    } catch (error) {
      if (!(error instanceof InjectedHttpError) || isAbortError(error)) {
        throw error;
      }
      // 공급자 SDK 오류와 같은 필드 이름(statusCode·responseHeaders)으로 힌트를 읽는다.
      const hint = classifyRetryable({
        message: error.message,
        responseHeaders: error.headers,
        statusCode: error.status,
      });
      return noteRetryHint(errorResponse(query.engineId, error.message), hint);
    }
  };

/** `vi.mock("../global-adapters", ...)` 용. */
export const sdkLikeGlobalAdaptersMock = (harness: FaultHarness) => {
  const adapter = sdkLikeAdapter(harness);
  return {
    chatgptAdapter: adapter,
    claudeAdapter: adapter,
    geminiAdapter: adapter,
    perplexityAdapter: adapter,
  };
};
