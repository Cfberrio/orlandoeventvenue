import { describe, it, expect, vi } from "vitest";
import { render } from "@testing-library/react";
import Index from "./Index";

/* Every section is stubbed to a labelled div: this test is about the
 * background rhythm around them, not about what they render. (vi.mock is
 * hoisted, so the factory is inlined rather than shared.) */
vi.mock("@/components/home/OevNav", () => ({ default: () => <div data-stub="nav" /> }));
vi.mock("@/components/home/OevHero", () => ({ default: () => <div data-stub="hero" /> }));
vi.mock("@/components/home/PromoBand", () => ({ default: () => <div data-stub="promo" /> }));
vi.mock("@/components/home/WhyCards", () => ({ default: () => <div data-stub="why" /> }));
vi.mock("@/components/home/PricingSection", () => ({ default: () => <div data-stub="pricing" /> }));
vi.mock("@/components/home/AddonsSection", () => ({ default: () => <div data-stub="addons" /> }));
vi.mock("@/components/home/GalleryTours", () => ({ default: () => <div data-stub="gallery" /> }));
vi.mock("@/components/home/HowItWorksSection", () => ({ default: () => <div data-stub="how" /> }));
vi.mock("@/components/home/FaqSection", () => ({ default: () => <div data-stub="faq" /> }));
vi.mock("@/components/home/FinalBand", () => ({ default: () => <div data-stub="final" /> }));
vi.mock("@/components/home/OevFooter", () => ({ default: () => <div data-stub="footer" /> }));
vi.mock("@/components/home/MobileBar", () => ({ default: () => <div data-stub="mobile" /> }));
vi.mock("@/components/ContactForm", () => ({ default: () => <div data-stub="contact" /> }));
vi.mock("@/components/DiscountPopup", () => ({ default: () => <div data-stub="popup" /> }));

describe("Index background rhythm", () => {
  it("alternates the two venue photos section by section, starting where the hero leaves off", () => {
    const { container } = render(<Index />);
    const bands = Array.from(container.querySelectorAll<HTMLElement>(".photo-band"));
    const order = bands.map((b) => b.dataset.photo);
    /* The hero (photo A) is its own component; the bands below start on B. */
    expect(order).toEqual(["b", "a", "b", "a", "b", "a", "b", "a", "b"]);
    for (let i = 1; i < order.length; i++) expect(order[i]).not.toBe(order[i - 1]);
  });

  it("puts every section below the hero on a photo band", () => {
    const { container } = render(<Index />);
    const inBands = ["promo", "why", "pricing", "addons", "gallery", "how", "faq", "final", "contact"];
    for (const name of inBands) {
      const el = container.querySelector(`[data-stub="${name}"]`);
      expect(el?.closest(".photo-band"), name).not.toBeNull();
    }
    expect(container.querySelector('[data-stub="footer"]')?.closest(".photo-band")).toBeNull();
  });
});
