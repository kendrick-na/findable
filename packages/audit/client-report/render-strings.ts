// config.json 문구 속 `{{ s.ok_n }}` 같은 변수를 채운다 — build.py 의 render_strings() 포팅.
//
// 파이썬은 Jinja2 를 통째로 쓰지만, 실제 config 에 쓰이는 문법은 아주 작다:
//   `{{ s.x }}` · `{{ c.x }}` · `{{ ' 모두' if s.a == s.b else '' }}`
// 그래서 **그 부분만** 지원하는 작은 해석기를 둔다. 모르는 문법(`{% %}`·필터 `|`·함수 호출)을
// 만나면 **조용히 넘기지 않고 멈춘다** — 틀린 숫자가 고객 리포트에 찍히는 것보다 낫다.

import type { ReportStats } from "./compute";
import { pyFloatStr } from "./py-compat";

type Value = string | number | boolean | null | undefined | object;
interface Ctx {
  c: Record<string, unknown>;
  s: ReportStats;
}

/** 파이썬에서 실수(float)인 통계. 문자열로 찍을 때 `10.0` 처럼 소수점을 유지해야 한다. */
const FLOAT_STATS = new Set(["official_pct"]);

export function formatOfficialPct(s: ReportStats): string {
  // 파이썬: 인용이 있으면 round(..., 1)(실수) · 없으면 정수 0
  return s.cites_total ? pyFloatStr(s.official_pct) : String(s.official_pct);
}

type Tok =
  | { t: "str"; v: string }
  | { t: "num"; v: number }
  | { t: "name"; v: string }
  | { t: "op"; v: string };

const TOKEN_RE =
  /\s*(?:('(?:[^'\\]|\\.)*'|"(?:[^"\\]|\\.)*")|(\d+(?:\.\d+)?)|([A-Za-z_][A-Za-z0-9_]*)|(==|!=|<=|>=|[<>().]))/y;

const WHITESPACE_ONLY_RE = /^\s*$/;

function tokenize(src: string): Tok[] {
  const out: Tok[] = [];
  TOKEN_RE.lastIndex = 0;
  let pos = 0;
  while (pos < src.length) {
    if (WHITESPACE_ONLY_RE.test(src.slice(pos))) {
      break;
    }
    TOKEN_RE.lastIndex = pos;
    const m = TOKEN_RE.exec(src);
    if (!m) {
      throw new Error(`지원하지 않는 템플릿 문법: {{ ${src} }}`);
    }
    pos = TOKEN_RE.lastIndex;
    if (m[1] !== undefined) {
      out.push({ t: "str", v: m[1].slice(1, -1).replace(/\\(.)/g, "$1") });
    } else if (m[2] !== undefined) {
      out.push({ t: "num", v: Number(m[2]) });
    } else if (m[3] !== undefined) {
      out.push({ t: "name", v: m[3] });
    } else {
      out.push({ t: "op", v: m[4] });
    }
  }
  return out;
}

const truthy = (v: Value): boolean => {
  if (v === null || v === undefined || v === false || v === 0 || v === "") {
    return false;
  }
  if (Array.isArray(v)) {
    return v.length > 0;
  }
  return true;
};

class Parser {
  private i = 0;
  private readonly toks: Tok[];
  private readonly ctx: Ctx;
  /** 마지막으로 읽은 변수 경로(`s.official_pct`) — 실수 표기 판정용. */
  lastPath: string | null = null;

  constructor(toks: Tok[], ctx: Ctx) {
    this.toks = toks;
    this.ctx = ctx;
  }

  private peek(): Tok | undefined {
    return this.toks[this.i];
  }

  private isKw(v: string): boolean {
    const p = this.peek();
    return p?.t === "name" && p.v === v;
  }

  parseAll(): Value {
    const v = this.expr();
    if (this.i !== this.toks.length) {
      throw new Error("템플릿 식을 끝까지 읽지 못했습니다");
    }
    return v;
  }

  private expr(): Value {
    const body = this.or();
    if (this.isKw("if")) {
      this.i++;
      const cond = this.or();
      if (!this.isKw("else")) {
        throw new Error("`x if 조건` 뒤에 else 가 필요합니다");
      }
      this.i++;
      const alt = this.expr();
      this.lastPath = null;
      return truthy(cond) ? body : alt;
    }
    return body;
  }

  private or(): Value {
    let v = this.and();
    while (this.isKw("or")) {
      this.i++;
      const r = this.and();
      v = truthy(v) ? v : r;
      this.lastPath = null;
    }
    return v;
  }

  private and(): Value {
    let v = this.not();
    while (this.isKw("and")) {
      this.i++;
      const r = this.not();
      v = truthy(v) ? r : v;
      this.lastPath = null;
    }
    return v;
  }

  private not(): Value {
    if (this.isKw("not")) {
      this.i++;
      const v = !truthy(this.not());
      this.lastPath = null;
      return v;
    }
    return this.cmp();
  }

  private cmp(): Value {
    const a = this.primary();
    const p = this.peek();
    if (p?.t === "op" && ["==", "!=", "<", ">", "<=", ">="].includes(p.v)) {
      this.i++;
      const b = this.primary();
      this.lastPath = null;
      switch (p.v) {
        case "==":
          return a === b;
        case "!=":
          return a !== b;
        case "<":
          return (a as number) < (b as number);
        case ">":
          return (a as number) > (b as number);
        case "<=":
          return (a as number) <= (b as number);
        default:
          return (a as number) >= (b as number);
      }
    }
    return a;
  }

  // biome-ignore lint/complexity/noExcessiveCognitiveComplexity: 식 종류(문자열·숫자·괄호·변수 경로)별 분기 — 나누면 문법 전체가 한눈에 안 보인다
  private primary(): Value {
    const tok = this.toks[this.i++];
    if (!tok) {
      throw new Error("템플릿 식이 비었습니다");
    }
    if (tok.t === "str" || tok.t === "num") {
      this.lastPath = null;
      return tok.v;
    }
    if (tok.t === "op" && tok.v === "(") {
      const v = this.expr();
      const close = this.toks[this.i++];
      if (!(close?.t === "op" && close.v === ")")) {
        throw new Error("괄호가 닫히지 않았습니다");
      }
      return v;
    }
    if (tok.t === "name" && (tok.v === "s" || tok.v === "c")) {
      let cur: Value = tok.v === "s" ? this.ctx.s : this.ctx.c;
      const path = [tok.v];
      while (this.peek()?.t === "op" && this.peek()?.v === ".") {
        this.i++;
        const key = this.toks[this.i++];
        if (key?.t !== "name") {
          throw new Error("`.` 뒤에 이름이 필요합니다");
        }
        path.push(key.v);
        if (
          cur === null ||
          typeof cur !== "object" ||
          !Object.hasOwn(cur, key.v)
        ) {
          // Jinja 는 없는 속성을 빈 문자열로 찍는다 — 조용히 빈칸이 되면 안 되므로 멈춘다.
          throw new Error(`템플릿 변수 ${path.join(".")} 가 없습니다`);
        }
        cur = (cur as Record<string, Value>)[key.v];
      }
      this.lastPath = path.join(".");
      return cur;
    }
    throw new Error(`지원하지 않는 템플릿 문법: ${tok.v}`);
  }
}

function toPyStr(v: Value, path: string | null, ctx: Ctx): string {
  if (typeof v === "number") {
    if (path === "s.official_pct") {
      return formatOfficialPct(ctx.s);
    }
    if (path?.startsWith("s.") && FLOAT_STATS.has(path.slice(2))) {
      return pyFloatStr(v);
    }
    return String(v);
  }
  if (typeof v === "boolean") {
    return v ? "True" : "False";
  }
  if (v === null || v === undefined) {
    return "None";
  }
  if (typeof v === "string") {
    return v;
  }
  throw new Error("목록·객체는 문구에 직접 넣을 수 없습니다");
}

export function renderTemplateString(src: string, ctx: Ctx): string {
  if (src.includes("{%")) {
    throw new Error("config 문구에 {% %} 블록은 지원하지 않습니다");
  }
  if (!src.includes("{{")) {
    return src;
  }
  return src.replace(/\{\{([\s\S]*?)\}\}/g, (_m, body: string) => {
    if (body.includes("|")) {
      throw new Error(`config 문구에 필터(|)는 지원하지 않습니다: {{${body}}}`);
    }
    const parser = new Parser(tokenize(body), ctx);
    const v = parser.parseAll();
    return toPyStr(v, parser.lastPath, ctx);
  });
}

/** build.py render_strings() — 문자열·목록·객체를 재귀로 돈다. */
export function renderStrings<T>(obj: T, ctx: Ctx): T {
  if (typeof obj === "string") {
    return renderTemplateString(obj, ctx) as T;
  }
  if (Array.isArray(obj)) {
    return obj.map((x) => renderStrings(x, ctx)) as T;
  }
  if (obj !== null && typeof obj === "object") {
    return Object.fromEntries(
      Object.entries(obj).map(([k, v]) => [k, renderStrings(v, ctx)])
    ) as T;
  }
  return obj;
}
