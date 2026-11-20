// Signature pad sizing (UI2-1).
//
// Assigning canvas.width clears the canvas. iPhone Safari fires a window
// `resize` when its toolbar collapses on scroll (only the height changes),
// so resizing on every event wiped a guest's signature.

/** Resize only on first layout or when the CSS width really changed. */
export function shouldResizeSignatureCanvas(prevWidth: number | null, nextWidth: number): boolean {
  if (!(nextWidth > 0)) return false;
  if (prevWidth === null) return true;
  return Math.round(prevWidth) !== Math.round(nextWidth);
}

/**
 * CSS size to repaint a saved signature image at: its original size, scaled
 * down only if the pad got smaller, never stretched.
 */
export function fitSavedSignature(
  imgWidthPx: number,
  imgHeightPx: number,
  dpr: number,
  padWidth: number,
  padHeight: number,
): { width: number; height: number } {
  const ratio = dpr > 0 ? dpr : 1;
  const w = imgWidthPx / ratio;
  const h = imgHeightPx / ratio;
  if (!(w > 0) || !(h > 0)) return { width: 0, height: 0 };
  const scale = Math.min(1, padWidth / w, padHeight / h);
  return { width: w * scale, height: h * scale };
}
