import { describe, expect, it } from "vitest";
import { fitSavedSignature, shouldResizeSignatureCanvas } from "./signatureCanvas";

describe("shouldResizeSignatureCanvas (UI2-1)", () => {
  it("sizes the pad on first layout", () => {
    expect(shouldResizeSignatureCanvas(null, 342)).toBe(true);
  });

  it("ignores a resize where only the height changed (Safari toolbar)", () => {
    expect(shouldResizeSignatureCanvas(342, 342)).toBe(false);
    expect(shouldResizeSignatureCanvas(342.4, 342.2)).toBe(false);
  });

  it("resizes when the width really changes (rotation)", () => {
    expect(shouldResizeSignatureCanvas(342, 650)).toBe(true);
  });

  it("never sizes to a zero width (hidden container)", () => {
    expect(shouldResizeSignatureCanvas(null, 0)).toBe(false);
    expect(shouldResizeSignatureCanvas(342, 0)).toBe(false);
  });
});

describe("fitSavedSignature (UI2-1)", () => {
  it("repaints at the original CSS size when the pad grew", () => {
    expect(fitSavedSignature(1026, 600, 3, 650, 200)).toEqual({ width: 342, height: 200 });
  });

  it("scales down, keeping proportions, when the pad shrank", () => {
    const r = fitSavedSignature(1300, 400, 2, 325, 200);
    expect(r.width).toBeCloseTo(325);
    expect(r.height).toBeCloseTo(100);
  });

  it("handles an empty image", () => {
    expect(fitSavedSignature(0, 0, 2, 300, 200)).toEqual({ width: 0, height: 0 });
  });
});
