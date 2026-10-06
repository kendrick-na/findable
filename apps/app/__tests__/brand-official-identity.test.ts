import { describe, expect, it } from "vitest";
import {
  normalizeBusinessNumber,
  normalizeLegalName,
} from "@/lib/brand/official-identity";

describe("고객 입력 공식 회사 정보 정규화 (2026-10-06)", () => {
  it("사업자등록번호는 숫자 10자리를 000-00-00000 으로 맞춘다", () => {
    expect(normalizeBusinessNumber("1234567890")).toEqual({
      ok: true,
      value: "123-45-67890",
    });
    expect(normalizeBusinessNumber(" 123-45-67890 ")).toEqual({
      ok: true,
      value: "123-45-67890",
    });
  });

  it("자릿수가 틀리면 거부한다", () => {
    expect(normalizeBusinessNumber("123-45-6789")).toEqual({
      ok: false,
      error: "business_number_format",
    });
    expect(normalizeBusinessNumber("abc")).toEqual({
      ok: false,
      error: "business_number_format",
    });
  });

  it("빈 값은 지우기(null)로 받는다", () => {
    expect(normalizeBusinessNumber("  ")).toEqual({ ok: true, value: null });
    expect(normalizeLegalName("")).toEqual({ ok: true, value: null });
  });

  it("상호는 앞뒤 공백을 지우고 2~60자만 받는다", () => {
    expect(normalizeLegalName("  비바리퍼블리카  ")).toEqual({
      ok: true,
      value: "비바리퍼블리카",
    });
    expect(normalizeLegalName("가")).toEqual({
      ok: false,
      error: "legal_name_length",
    });
    expect(normalizeLegalName("가".repeat(61))).toEqual({
      ok: false,
      error: "legal_name_length",
    });
  });
});
