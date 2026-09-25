import { expect, it } from "vitest";
import { detectBrandMention, estimateMentionPosition } from "./utils";

it("detects a long Korean brand even when the answer inserts spaces", () => {
  const text = "인디고 차일드는 아동복 쇼핑몰입니다.";
  expect(detectBrandMention(text, "인디고차일드")).toEqual({
    mentioned: true,
    firstIndex: 0,
  });
  expect(
    estimateMentionPosition(
      "1. 인디고 차일드 아동복\n2. 다른 브랜드",
      "인디고차일드"
    )
  ).toEqual({ position: 1, listSize: 2 });
});

it("does not apply spacing fallback to short or mixed-script names", () => {
  expect(detectBrandMention("놀 맵 추천", "놀맵").mentioned).toBe(false);
  expect(detectBrandMention("K A I S T", "KAIST").mentioned).toBe(false);
});
