import { describe, expect, test } from "vitest";

import { readinessUrlMatchesBrand } from "@/lib/site-readiness/brand-domain";

describe("readinessUrlMatchesBrand", () => {
  test("accepts the registered host regardless of www and protocol", () => {
    expect(
      readinessUrlMatchesBrand("http://www.example.com/about", "example.com")
    ).toBe(true);
  });

  test("rejects another customer's URL", () => {
    expect(
      readinessUrlMatchesBrand("https://other.example/", "example.com")
    ).toBe(false);
  });
});
