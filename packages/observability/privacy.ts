import type {
  Breadcrumb,
  ErrorEvent,
  EventHint,
  init,
  Log,
} from "@sentry/nextjs";
import { redactUrl } from "./url-privacy";

/** Sentry 가 이름 붙여 내보내지 않는 트랜잭션 이벤트 타입을 init 옵션에서 꺼낸다. */
type TransactionEvent = Parameters<
  NonNullable<NonNullable<Parameters<typeof init>[0]>["beforeSendTransaction"]>
>[0];

/** 문장 안에 섞인 주소 조각(/r/토큰, /audit/id, ?쿼리)을 치환한다. */
const TEXT_REPORT_PATH = /(\/r\/)[A-Za-z0-9_-]{8,}/g;
const TEXT_AUDIT_PATH = /(\/audit\/)(?!\[jobId\])[A-Za-z0-9_-]{8,}/g;
const TEXT_TOKEN_QUERY = /([?&](?:token|t|jobId|id)=)[^\s&#"']+/gi;

const redactUrlsInText = (text: string): string =>
  text
    .replace(TEXT_REPORT_PATH, "$1[token]")
    .replace(TEXT_AUDIT_PATH, "$1[jobId]")
    .replace(TEXT_TOKEN_QUERY, "$1[Filtered]");

const SENSITIVE_HEADERS = new Set([
  "authorization",
  "cookie",
  "proxy-authorization",
  "set-cookie",
  "x-api-key",
  "x-clerk-auth-message",
  "x-clerk-auth-reason",
]);

const EXPECTED_ACCESS_DENIALS = [
  "FORBIDDEN: admin only",
  "FORBIDDEN: organization required",
  "Current user is not a member of the organization",
];

const isBrowserInjectedScriptNoise = (event: ErrorEvent, message: string) =>
  message.includes(
    "Cannot read properties of undefined (reading 'sendMessage')"
  ) &&
  event.exception?.values?.some((value) =>
    value.stacktrace?.frames?.some((frame) =>
      frame.filename?.startsWith("app:///injectedScript.bundle")
    )
  );

/**
 * Keep operational evidence while removing credentials and customer payloads.
 * Expected access denials remain searchable but do not page the operator as
 * high-priority application failures.
 */
export const sanitizeSentryEvent = (
  event: ErrorEvent,
  hint: EventHint
): ErrorEvent | null => {
  const headers = event.request?.headers;
  if (headers) {
    for (const key of Object.keys(headers)) {
      if (SENSITIVE_HEADERS.has(key.toLowerCase())) {
        headers[key] = "[Filtered]";
      }
    }
  }

  if (event.request) {
    event.request.cookies = undefined;
    event.request.data = undefined;
  }

  redactEventUrls(event);

  if (event.user) {
    event.user = event.user.id ? { id: event.user.id } : undefined;
  }

  const message =
    event.message ??
    event.exception?.values?.map((value) => value.value ?? "").join(" ") ??
    (hint?.originalException instanceof Error
      ? hint.originalException.message
      : "");

  // Browser automation/instrumentation can inject this bundle into the page.
  // It is not part of the deployed app and otherwise creates a misleading
  // production login issue with zero affected users.
  if (isBrowserInjectedScriptNoise(event, message)) {
    return null;
  }

  if (EXPECTED_ACCESS_DENIALS.some((expected) => message.includes(expected))) {
    event.level = "info";
    event.tags = { ...event.tags, expected_access_denial: "true" };
  }

  return event;
};

const URL_FIELD = /(^|[^a-z])(url|referrer|referer|to|from)$/i;
const REFERRER_HEADER = /^(referer|referrer|origin)$/i;

const redactRecordUrls = (record: Record<string, unknown> | undefined) => {
  if (!record) {
    return;
  }
  for (const key of Object.keys(record)) {
    const value = record[key];
    if (typeof value === "string" && URL_FIELD.test(key)) {
      record[key] = redactUrl(value);
    }
  }
};

const redactRequestUrls = (request: ErrorEvent["request"]) => {
  if (!request) {
    return;
  }
  if (request.url) {
    request.url = redactUrl(request.url);
  }
  request.query_string = undefined;
  const headers = request.headers;
  if (headers) {
    for (const key of Object.keys(headers)) {
      if (REFERRER_HEADER.test(key)) {
        headers[key] = redactUrl(headers[key] ?? "");
      }
    }
  }
};

const redactBreadcrumbUrls = (crumb: Breadcrumb) => {
  redactRecordUrls(crumb.data);
  if (crumb.message) {
    crumb.message = redactUrlsInText(crumb.message);
  }
};

const redactSpanUrls = (spans: TransactionEvent["spans"]) => {
  for (const span of spans ?? []) {
    if (span.description) {
      span.description = redactUrlsInText(span.description);
    }
    redactRecordUrls(span.data as Record<string, unknown> | undefined);
  }
};

/** Sentry 이벤트 전체(오류·트랜잭션 공통)에서 주소의 비밀 값을 지운다. */
const redactEventUrls = <T extends ErrorEvent | TransactionEvent>(
  event: T
): T => {
  redactRequestUrls(event.request);
  if (event.transaction) {
    event.transaction = redactUrl(event.transaction);
  }
  for (const crumb of event.breadcrumbs ?? []) {
    redactBreadcrumbUrls(crumb);
  }
  const tags = event.tags as Record<string, unknown> | undefined;
  if (tags && typeof tags.url === "string") {
    tags.url = redactUrl(tags.url);
  }
  redactSpanUrls((event as TransactionEvent).spans);
  redactRecordUrls(
    event.contexts?.trace?.data as Record<string, unknown> | undefined
  );
  return event;
};

/** 트랜잭션(성능 기록)용: URL의 토큰 경로·쿼리를 지운다. */
export const sanitizeSentryTransaction = (
  event: TransactionEvent
): TransactionEvent => redactEventUrls(event);

/** 이동 기록(breadcrumb)용: 주소를 담은 필드를 치환한다. */
export const sanitizeSentryBreadcrumb = (crumb: Breadcrumb): Breadcrumb => {
  redactBreadcrumbUrls(crumb);
  return crumb;
};

/** 로그 연동(enableLogs)용: 메시지·속성 안의 주소를 치환한다. */
export const sanitizeSentryLog = (log: Log): Log => {
  log.message = redactUrlsInText(String(log.message));
  const attributes = log.attributes as Record<string, unknown> | undefined;
  if (attributes) {
    for (const key of Object.keys(attributes)) {
      const value = attributes[key];
      if (typeof value === "string") {
        attributes[key] = redactUrlsInText(value);
      }
    }
  }
  return log;
};

/**
 * 성능 추적 표본 비율. 기본 0.1(10%) — 모든 요청 주소를 보내지 않는다.
 * 환경변수 값이 0~1 숫자가 아니면 기본값을 쓴다.
 */
export const parseTracesSampleRate = (
  raw: string | undefined,
  fallback = 0.1
): number => {
  if (raw === undefined || raw.trim() === "") {
    return fallback;
  }
  const value = Number(raw);
  return Number.isFinite(value) && value >= 0 && value <= 1 ? value : fallback;
};
