import { describe, it, expect } from "vitest";
import { render, screen } from "@testing-library/react";
import { useMarketingMotion, usePromoBandMotion, MM } from "./marketingMotion";

function Page() {
  const scope = useMarketingMotion<HTMLDivElement>();
  return (
    <div ref={scope}>
      <p data-rv>reveal</p>
      <div data-rv-group>
        <span>a</span>
        <span>b</span>
      </div>
      <span data-count="90">90</span>
    </div>
  );
}

function Band() {
  const scope = usePromoBandMotion<HTMLDivElement>();
  return (
    <div ref={scope}>
      <ul className="p-check">
        <li>
          <span className="tick" /> item
        </li>
      </ul>
      <span className="seal">$0</span>
    </div>
  );
}

describe("marketingMotion", () => {
  it("exposes matchMedia conditions", () => {
    expect(MM.noPref).toContain("prefers-reduced-motion: no-preference");
  });

  it("useMarketingMotion renders without crashing and keeps content visible when no media matches", () => {
    render(<Page />);
    // setup.ts mocks matchMedia matches:false → ningún contexto corre → contenido intacto
    expect(screen.getByText("reveal")).toBeVisible();
    expect(screen.getByText("90")).toBeVisible();
  });

  it("usePromoBandMotion renders without crashing", () => {
    render(<Band />);
    expect(screen.getByText("item")).toBeVisible();
  });
});
