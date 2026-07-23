import { useRef, useState, useEffect } from "react";
import { Link, useNavigate } from "react-router-dom";
import gsap from "gsap";
import { useGSAP } from "@gsap/react";
import { Observer } from "gsap/Observer";
import * as THREE from "three";
import { X, ChevronLeft, ChevronRight, Move } from "lucide-react";
import entrance from "@/assets/tour/entrance.jpg";
import lobby from "@/assets/tour/lobby.jpg";
import lounge from "@/assets/tour/lounge.jpg";
import mainHall from "@/assets/tour/main-hall.jpg";
import flexRoom from "@/assets/tour/flex-room.jpg";
import kitchen from "@/assets/tour/kitchen.jpg";
import storage from "@/assets/tour/storage.jpg";
import restroom from "@/assets/tour/restroom.jpg";

gsap.registerPlugin(useGSAP, Observer);

const SCENES = [
  { src: entrance, title: "Venue Exterior", desc: "Your guests arrive here: easy access and parking right outside." },
  { src: lobby, title: "Welcome Area", desc: "A warm first impression with our signature wood-slat wall." },
  { src: lounge, title: "Main Entrance", desc: "Marble accents and smart TV displays greet you on the way in." },
  { src: mainHall, title: "Presentation Setup", desc: "Stage, dual projection screens and flexible seating for your event." },
  { src: flexRoom, title: "Event Space", desc: "An open flex room that adapts to your layout." },
  { src: kitchen, title: "Prep Kitchen", desc: "Full prep kitchen for catering and bar service." },
  { src: storage, title: "Storage Area", desc: "Tables and chairs on hand: setup and teardown made easy." },
  { src: restroom, title: "Restroom Facilities", desc: "Clean, modern restrooms for your guests." },
];

// Panorama geometry: the photo is bent onto the inside of a cylinder around the camera
const R = 10;
const FOV_DEF = 62;
const FOV_MIN = 42;
const FOV_MAX = 84;

interface Room {
  group: THREE.Group;
  panelMat: THREE.MeshBasicMaterial;
  envMat: THREE.MeshBasicMaterial;
  hHalf: number; // half horizontal arc of the photo (rad)
  vHalf: number; // half vertical angle of the photo (rad)
}

const VirtualTour = () => {
  const navigate = useNavigate();
  const rootRef = useRef<HTMLDivElement>(null);
  const mountRef = useRef<HTMLDivElement>(null);

  const [index, setIndex] = useState(0);
  const [ready, setReady] = useState(false);
  const [hintVisible, setHintVisible] = useState(true);

  // Mirrors of react state readable from three/gsap callbacks without stale closures
  const stateRef = useRef({ index: 0, animating: false });
  // Camera look state: t* are targets, plain values are the smoothed currents
  const look = useRef({
    yaw: 0, pitch: 0, fov: FOV_DEF,
    tYaw: 0, tPitch: 0, tFov: FOV_DEF,
    lastInteract: 0,
  });
  const api = useRef<{ goTo: (next: number, dir: 1 | -1) => void } | null>(null);

  const reduceMotion =
    typeof window !== "undefined" &&
    window.matchMedia("(prefers-reduced-motion: reduce)").matches;

  useEffect(() => {
    rootRef.current?.focus();
  }, []);

  useGSAP(
    () => {
      const mount = mountRef.current;
      if (!mount) return;
      const L = look.current;

      const renderer = new THREE.WebGLRenderer({ antialias: true });
      renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
      renderer.setSize(mount.clientWidth, mount.clientHeight);
      renderer.outputColorSpace = THREE.SRGBColorSpace;
      mount.appendChild(renderer.domElement);

      const scene = new THREE.Scene();
      scene.background = new THREE.Color(0x000000);
      const camera = new THREE.PerspectiveCamera(
        FOV_DEF,
        mount.clientWidth / mount.clientHeight,
        0.1,
        200
      );
      camera.rotation.order = "YXZ";

      const rooms: Room[] = [];
      const manager = new THREE.LoadingManager(() => {
        rooms.forEach((r, i) => (r.group.visible = i === stateRef.current.index));
        setReady(true);
      });
      const loader = new THREE.TextureLoader(manager);

      SCENES.forEach((s, i) => {
        loader.load(s.src, (tex) => {
          tex.colorSpace = THREE.SRGBColorSpace;
          // Seen from inside the cylinder the image is mirrored — flip it back
          tex.wrapS = THREE.RepeatWrapping;
          tex.repeat.x = -1;
          tex.offset.x = 1;

          const img = tex.image as HTMLImageElement;
          const aspect = img.width / img.height;
          const arc = THREE.MathUtils.degToRad(gsap.utils.clamp(66, 104, 68 * aspect));
          const height = (R * arc) / aspect;

          const panelMat = new THREE.MeshBasicMaterial({
            map: tex,
            side: THREE.BackSide,
            transparent: true,
            depthWrite: false,
          });
          const panel = new THREE.Mesh(
            // theta: 0 rad is +z and the camera looks down -z, so center the arc at PI
            new THREE.CylinderGeometry(R, R, height, 96, 1, true, Math.PI - arc / 2, arc),
            panelMat
          );

          // Blurred surround: a tiny copy of the photo stretched over a big sphere
          const c = document.createElement("canvas");
          c.width = 32;
          c.height = 16;
          c.getContext("2d")!.drawImage(img, 0, 0, 32, 16);
          const envTex = new THREE.CanvasTexture(c);
          envTex.colorSpace = THREE.SRGBColorSpace;
          envTex.wrapS = THREE.RepeatWrapping;
          envTex.repeat.x = -1;
          envTex.offset.x = 1;
          const envMat = new THREE.MeshBasicMaterial({
            map: envTex,
            side: THREE.BackSide,
            transparent: true,
            depthWrite: false,
            color: 0x777777,
          });
          const env = new THREE.Mesh(new THREE.SphereGeometry(60, 32, 16), envMat);
          // Draw order instead of depth: env behind its room's panel
          env.renderOrder = 0;
          panel.renderOrder = 1;

          const group = new THREE.Group();
          group.add(env);
          group.add(panel);
          group.visible = false;
          scene.add(group);

          rooms[i] = { group, panelMat, envMat, hHalf: arc / 2, vHalf: Math.atan(height / 2 / R) };
        });
      });

      const clampLook = () => {
        const r = rooms[stateRef.current.index];
        if (!r) return;
        L.tYaw = gsap.utils.clamp(-r.hHalf * 0.6, r.hHalf * 0.6, L.tYaw);
        L.tPitch = gsap.utils.clamp(-r.vHalf * 0.45, r.vHalf * 0.45, L.tPitch);
      };

      // Render loop: ease the camera toward its targets + idle sway
      const tick = () => {
        const now = performance.now();
        const idle = now - L.lastInteract;
        let drift = 0;
        if (!reduceMotion && idle > 3500 && !stateRef.current.animating) {
          drift = Math.sin(now * 0.00025) * 0.025 * Math.min(1, (idle - 3500) / 3000);
        }
        L.yaw += (L.tYaw + drift - L.yaw) * 0.07;
        L.pitch += (L.tPitch - L.pitch) * 0.07;
        L.fov += (L.tFov - L.fov) * 0.09;
        camera.rotation.y = L.yaw;
        camera.rotation.x = L.pitch;
        camera.fov = L.fov;
        camera.updateProjectionMatrix();
        renderer.render(scene, camera);
      };
      gsap.ticker.add(tick);

      // Street-view grab: drag right → look left, with fling inertia on release
      const observer = Observer.create({
        target: mount,
        type: "touch,pointer",
        onPress: () => {
          L.lastInteract = performance.now();
          setHintVisible(false);
        },
        onDrag: (self) => {
          if (stateRef.current.animating) return;
          const k = THREE.MathUtils.degToRad(camera.fov) / mount.clientHeight;
          L.tYaw += self.deltaX * k;
          L.tPitch += self.deltaY * k;
          clampLook();
          L.lastInteract = performance.now();
        },
        onRelease: (self) => {
          if (stateRef.current.animating) return;
          const k = THREE.MathUtils.degToRad(camera.fov) / mount.clientHeight;
          L.tYaw += self.velocityX * k * 0.12;
          L.tPitch += self.velocityY * k * 0.12;
          clampLook();
          L.lastInteract = performance.now();
        },
      });

      const onResize = () => {
        const w = mount.clientWidth;
        const h = mount.clientHeight;
        renderer.setSize(w, h);
        camera.aspect = w / h;
        camera.updateProjectionMatrix();
      };
      window.addEventListener("resize", onResize);

      // Walk to another room: dolly toward the wall, pass "through" it, glide into the next
      api.current = {
        goTo: (next, dir) => {
          const S = stateRef.current;
          if (S.animating || next === S.index || !rooms[next] || !rooms[S.index]) return;
          S.animating = true;
          setHintVisible(false);
          const cur = rooms[S.index];
          const nxt = rooms[next];
          L.tYaw = 0;
          L.tPitch = 0;
          L.tFov = FOV_DEF;

          nxt.panelMat.opacity = 0;
          nxt.envMat.opacity = 0;
          // Incoming room always draws on top of the fading one
          nxt.group.children.forEach((m, ci) => (m.renderOrder = 10 + ci));
          cur.group.children.forEach((m, ci) => (m.renderOrder = ci));
          nxt.group.visible = true;

          const done = () => {
            cur.group.visible = false;
            cur.panelMat.opacity = 1;
            cur.envMat.opacity = 1;
            camera.position.z = 0;
            S.index = next;
            S.animating = false;
            setIndex(next);
          };

          if (reduceMotion) {
            gsap.timeline({ onComplete: done })
              .to([cur.panelMat, cur.envMat], { opacity: 0, duration: 0.35 })
              .to([nxt.panelMat, nxt.envMat], { opacity: 1, duration: 0.35 });
            return;
          }

          const dur = 1.05;
          gsap.timeline({ onComplete: done })
            .to(camera.position, {
              z: dir === 1 ? -R * 0.45 : R * 0.35,
              duration: dur,
              ease: "power2.in",
            })
            .to([cur.panelMat, cur.envMat], { opacity: 0, duration: dur * 0.5, ease: "power1.in" }, dur * 0.4)
            .add(() => {
              camera.position.z = dir === 1 ? R * 0.22 : -R * 0.16;
            }, dur * 0.92)
            .to(camera.position, { z: 0, duration: 0.9, ease: "power3.out" }, dur * 0.92)
            .to([nxt.panelMat, nxt.envMat], { opacity: 1, duration: 0.7, ease: "power1.out" }, dur * 0.85);
        },
      };

      return () => {
        window.removeEventListener("resize", onResize);
        gsap.ticker.remove(tick);
        observer.kill();
        scene.traverse((obj) => {
          if (obj instanceof THREE.Mesh) {
            obj.geometry.dispose();
            const mat = obj.material as THREE.MeshBasicMaterial;
            mat.map?.dispose();
            mat.dispose();
          }
        });
        renderer.dispose();
        mount.removeChild(renderer.domElement);
        api.current = null;
      };
    },
    { scope: rootRef }
  );

  const goTo = (next: number, dir: 1 | -1) => api.current?.goTo(next, dir);
  const step = (dir: 1 | -1) => {
    const cur = stateRef.current.index;
    goTo((cur + dir + SCENES.length) % SCENES.length, dir);
  };

  const onWheel = (e: React.WheelEvent) => {
    const L = look.current;
    L.tFov = gsap.utils.clamp(FOV_MIN, FOV_MAX, L.tFov + (e.deltaY > 0 ? 4 : -4));
    L.lastInteract = performance.now();
    setHintVisible(false);
  };

  const onKeyDown = (e: React.KeyboardEvent) => {
    if (e.key === "ArrowRight") step(1);
    if (e.key === "ArrowLeft") step(-1);
    if (e.key === "Escape") navigate("/#gallery");
  };

  return (
    <div
      ref={rootRef}
      tabIndex={0}
      onKeyDown={onKeyDown}
      onWheel={onWheel}
      onDoubleClick={() => step(1)}
      className="fixed inset-0 overflow-hidden bg-black outline-none select-none touch-none cursor-grab active:cursor-grabbing"
      role="application"
      aria-label="OEV 3D virtual tour. Drag to look around, scroll to zoom, arrow keys or double-click to move between rooms."
    >
      {/* WebGL canvas */}
      <div ref={mountRef} className="absolute inset-0" />

      {/* Vignette for depth */}
      <div className="pointer-events-none absolute inset-0 bg-[radial-gradient(ellipse_at_center,transparent_60%,rgba(0,0,0,0.45)_100%)]" />
      <div className="pointer-events-none absolute inset-x-0 top-0 h-28 bg-gradient-to-b from-black/70 to-transparent" />
      <div className="pointer-events-none absolute inset-x-0 bottom-0 h-40 bg-gradient-to-t from-black/80 to-transparent" />

      {/* Loader */}
      {!ready && (
        <div className="absolute inset-0 z-30 flex items-center justify-center bg-black">
          <p className="animate-pulse text-sm tracking-[0.3em] text-white/70 uppercase">
            Loading tour…
          </p>
        </div>
      )}

      {/* Top bar */}
      <div className="absolute inset-x-0 top-0 z-20 flex items-center justify-between p-4 sm:p-6">
        <p className="text-xs font-semibold tracking-[0.25em] text-white/80 uppercase">
          OEV · Virtual Tour
        </p>
        <Link
          to="/#gallery"
          aria-label="Exit tour"
          className="rounded-full bg-white/10 p-2 text-white backdrop-blur transition hover:bg-white/25"
        >
          <X className="h-5 w-5" />
        </Link>
      </div>

      {/* Drag hint */}
      {hintVisible && ready && (
        <div className="pointer-events-none absolute inset-0 z-10 flex items-center justify-center">
          <div className="flex items-center gap-2 rounded-full bg-black/50 px-4 py-2 text-sm text-white/90 backdrop-blur">
            <Move className="h-4 w-4" /> Drag to look · scroll to zoom · double-click to walk
          </div>
        </div>
      )}

      {/* Bottom UI */}
      <div className="absolute inset-x-0 bottom-0 z-20 flex flex-col items-center gap-4 p-4 sm:p-6">
        <div className="max-w-xl text-center">
          <h1 className="text-xl font-bold text-white sm:text-2xl">{SCENES[index].title}</h1>
          <p className="mt-1 hidden text-sm text-white/70 sm:block">{SCENES[index].desc}</p>
        </div>

        <div className="flex items-center gap-3">
          <button
            onClick={() => step(-1)}
            aria-label="Previous room"
            className="rounded-full bg-white/10 p-3 text-white backdrop-blur transition hover:bg-white/25"
          >
            <ChevronLeft className="h-5 w-5" />
          </button>

          <div className="flex items-center gap-2 rounded-full bg-black/40 px-4 py-2 backdrop-blur">
            {SCENES.map((s, i) => (
              <button
                key={s.title}
                onClick={() => goTo(i, i > stateRef.current.index ? 1 : -1)}
                aria-label={`Go to ${s.title}`}
                aria-current={i === index}
                className={`h-2 rounded-full transition-all duration-300 ${
                  i === index ? "w-6 bg-white" : "w-2 bg-white/40 hover:bg-white/70"
                }`}
              />
            ))}
          </div>

          <button
            onClick={() => step(1)}
            aria-label="Next room"
            className="rounded-full bg-primary p-3 text-primary-foreground shadow-lg transition hover:brightness-110"
          >
            <ChevronRight className="h-5 w-5" />
          </button>
        </div>

        <p className="text-[11px] text-white/50">
          {index + 1} / {SCENES.length} · drag to look · scroll to zoom · arrows to move
        </p>
      </div>
    </div>
  );
};

export default VirtualTour;
