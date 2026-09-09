# Virtual Tour — Photo Specifications (dev reference)

> ClickUp doc (team-facing, Spanish): https://app.clickup.com/9017418223/docs/8cqnrff-22497
> Viewer code: `src/pages/VirtualTour.tsx`

## How the viewer consumes photos

Custom Three.js viewer. Each photo is bent onto the **inside of a cylinder** (not a 360 sphere). Visible arc depends on the image aspect ratio:

```
arc° = clamp(66, 104, 68 × (width / height))
panel height = R × arc / aspect   →  vertical range shrinks as aspect grows past 1.53
```

- Aspect ≥ **1.53:1** hits the max 104° arc; beyond that extra width only *reduces* visible height.
- Sweet spot: **3:2 to 16:9** (≈1.5–1.8). Square images (current state) render a narrow 68° arc.
- Pan clamp: ±60% of half-arc; tilt ±45%; zoom FOV 42–84 (default 62).
- A 32×16 blurred copy of the photo is stretched over a surrounding sphere as ambient fill.

## Capture specs (what to ask the photo team for)

| Param | Spec |
|---|---|
| Type | Wide horizontal rectilinear panorama (no fisheye) |
| Aspect | 1.5:1–1.8:1, 3:2 ideal |
| Capture resolution | ≥4000 px wide, ideal 6000–8000 |
| Delivery | Original JPEG max quality / HEIC / RAW via Drive (never WhatsApp) |
| Camera | Room center, ~1.5 m height, level horizon, all venue lights on, HDR, no people, tidy rooms |
| Phone pano mode | Sweep only ~100–120°, not full 360 (else ultra-thin strip) |
| 360 camera option | Full equirect 2:1 (Theta X 11008×5504 / Insta360 X4 ~11904×5952); crop center band ~29% W × ~34% H for current viewer; enables future full-sphere upgrade |

## Publishing pipeline

1. Crop to 3:2, resize to **≤4096 px wide** (safe WebGL texture limit on mobile — ~99% device support; 8192 fails/degrades on many phones).
2. Export JPEG ~85%, sRGB, target 300–600 KB (all 8 scenes load eagerly on tour open).
3. Drop into `src/assets/tour/` — filenames map to scenes in the `SCENES` array (`VirtualTour.tsx:19-28`): entrance, lobby, lounge, main-hall, flex-room, kitchen, storage, restroom.
4. Titles/descriptions/order live in `SCENES`. New room = 1 file + 1 array entry.

## Current asset state (2026-07-22)

- `entrance.jpg` 2400×1600 (3:2 → 102° arc, best-looking scene).
- Other 7 are 2048×2048 square → only 68° arc. Replacing with 3:2 panoramas widens the view ~50% with zero code changes.

## Scene-name verification (2026-07-22)

All 8 photos verified against their scene titles — all match (exterior / lobby / marble entrance / stage / flex room / kitchen / storage racks / restroom). The "Prep Kitchen over Event Space photo" seen in Luis's review video is the walk-transition crossfade (title updates when the animation completes), not a data bug.
