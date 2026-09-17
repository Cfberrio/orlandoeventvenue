import { describe, it, expect } from "vitest";
import { render } from "@testing-library/react";
import PhotoBand, { PhotoBackdrop, PHOTO_SRC } from "./PhotoBand";

describe("PhotoBackdrop", () => {
  it("paints the requested venue photo and hides it from assistive tech", () => {
    const { container } = render(<PhotoBackdrop photo="a" />);
    const bg = container.querySelector<HTMLElement>(".photo-band-bg");
    expect(bg).not.toBeNull();
    expect(bg!.style.backgroundImage).toContain(PHOTO_SRC.a);
    expect(bg!.getAttribute("aria-hidden")).toBe("true");
    expect(container.querySelector(".photo-band-veil")).not.toBeNull();
  });

  it("only ever ships two photographs", () => {
    expect(Object.keys(PHOTO_SRC).sort()).toEqual(["a", "b"]);
    expect(PHOTO_SRC.a).not.toBe(PHOTO_SRC.b);
  });

  it("tags the variant so the veil can differ per placement", () => {
    const { container } = render(<PhotoBackdrop photo="b" variant="page" />);
    const root = container.querySelector(".photo-backdrop");
    expect(root?.className).toContain("photo-backdrop-page");
    expect(root?.getAttribute("data-photo")).toBe("b");
  });
});

describe("PhotoBand", () => {
  it("wraps children over the photo and exposes which photo it carries", () => {
    const { container, getByText } = render(
      <PhotoBand photo="b" className="extra">
        <p>copy</p>
      </PhotoBand>,
    );
    const band = container.querySelector(".photo-band");
    expect(band?.getAttribute("data-photo")).toBe("b");
    expect(band?.className).toContain("extra");
    expect(getByText("copy")).toBeInTheDocument();
  });
});
