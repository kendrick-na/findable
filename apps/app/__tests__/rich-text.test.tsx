import { render } from "@testing-library/react";
import { describe, expect, it } from "vitest";
import { fillRich } from "@/lib/rich-text";

describe("fillRich", () => {
  it("자리표시자에 요소를 끼우고 나머지 글자는 그대로 둔다", () => {
    const { container } = render(
      <p>{fillRich("A {x} B {x} C", { x: <strong>7%</strong> })}</p>
    );
    expect(container.textContent).toBe("A 7% B 7% C");
    expect(container.querySelectorAll("strong")).toHaveLength(2);
  });

  it("값이 없는 자리표시자는 지우지 않는다(조용히 문장이 바뀌지 않게)", () => {
    const { container } = render(<p>{fillRich("A {missing}", {})}</p>);
    expect(container.textContent).toBe("A {missing}");
  });
});
