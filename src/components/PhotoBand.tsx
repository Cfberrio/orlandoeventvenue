import { useRef, type ReactNode } from "react";
import { gsap, useGSAP } from "@/lib/gsap";
import { MM } from "@/lib/marketingMotion";
import "./PhotoBand.css";
/* The whole site alternates between exactly two photographs of the renovated
 * event space. Two files means the browser downloads them once and every band
 * after that is a cache hit, however many sections sit on a photo.
 *   a — wide from the entrance: stage, wall display, the full floor
 *   b — the stage/brick side of the same room, looking back
 * Both are washed with a white veil so ink text keeps its contrast. */
import photoA from "@/assets/venue/hero-stage-screen-2048.webp";
import photoB from "@/assets/venue/included-stage-brick-2048.webp";

export type Photo = "a" | "b";
export const PHOTO_SRC: Record<Photo, string> = { a: photoA, b: photoB };

/* hero — light radial pool under the copy, fades to white only at the bottom
 * band — white at both ends so the photo swells in and out between sections
 * page — fixed behind a whole guest page (Book, Schedule Tour…), heavier veil */
export type BackdropVariant = "hero" | "band" | "page";

interface BackdropProps {
  photo: Photo;
  variant?: BackdropVariant;
  /** CSS background-position override, e.g. "center 85%". */
  position?: string;
}

/* Photo + veil, absolutely positioned. Parent must be `position: relative`
 * (the `.photo-band` wrapper below does that) or use variant="page". The veil
 * is a sibling of the photo, not a child: the photo drifts on scroll and the
 * veil must stay put or its white edges would slide off the section. */
export function PhotoBackdrop({ photo, variant = "band", position }: BackdropProps) {
  const scope = useRef<HTMLDivElement>(null);

  useGSAP(
    () => {
      const root = scope.current;
      if (!root || variant === "page") return;
      const bg = root.querySelector<HTMLElement>(".photo-band-bg");
      if (!bg) return;
      const mm = gsap.matchMedia();
      /* Slow parallax: the photo is taller than the band (CSS) and slides a
       * few percent as the band crosses the viewport, so consecutive sections
       * read as separate rooms drifting at different depths. Reduced-motion
       * users get a still photo. */
      mm.add(MM.noPref, () => {
        gsap.fromTo(
          bg,
          { yPercent: -5 },
          {
            yPercent: 5,
            ease: "none",
            scrollTrigger: {
              trigger: root.parentElement ?? root,
              start: "top bottom",
              end: "bottom top",
              scrub: 0.6,
            },
          },
        );
      });
    },
    { scope, dependencies: [variant] },
  );

  return (
    <div
      ref={scope}
      className={`photo-backdrop photo-backdrop-${variant}`}
      data-photo={photo}
      aria-hidden="true"
    >
      <div
        className="photo-band-bg"
        aria-hidden="true"
        style={{
          backgroundImage: `url(${PHOTO_SRC[photo]})`,
          ...(position ? { backgroundPosition: position } : null),
        }}
      />
      <div className="photo-band-veil" />
    </div>
  );
}

interface BandProps extends BackdropProps {
  className?: string;
  children: ReactNode;
}

/* One or more sections sitting on a photo. */
export default function PhotoBand({ photo, position, className, children }: BandProps) {
  return (
    <div className={["photo-band", className].filter(Boolean).join(" ")} data-photo={photo}>
      <PhotoBackdrop photo={photo} variant="band" position={position} />
      {children}
    </div>
  );
}
