/* Scene list for the /tour walkthrough and the homepage gallery.
 *
 * Every entry points at a REAL photograph of the venue. `src` is the image the
 * WebGL viewer bends onto its cylinder (2048px wide is plenty at any viewport);
 * `full` is the 2x copy used for the gallery lightbox and large screens.
 *
 * The August 2026 renovation covered the entrance, the welcome wall and the
 * event space. Exterior / prep kitchen / storage / restrooms were NOT part of
 * it, so those keep their existing photography.
 */
import entrance from "@/assets/tour/entrance.jpg";
import kitchen from "@/assets/tour/kitchen.jpg";
import storage from "@/assets/tour/storage.jpg";
import restroom from "@/assets/tour/restroom.jpg";

import welcomeDetail from "@/assets/venue/welcome-detail-portrait.webp";
import welcomeDetail2x from "@/assets/venue/welcome-detail-portrait-2x.webp";
import mainEntrance from "@/assets/venue/main-entrance-2048.webp";
import mainEntrance2x from "@/assets/venue/main-entrance-4096.webp";
import eventStage01 from "@/assets/venue/event-stage-01-2048.webp";
import eventStage01_2x from "@/assets/venue/event-stage-01-4096.webp";
/* Same wide shots the homepage hero and "included" band use (Sept 2026). */
import heroStageScreen from "@/assets/venue/hero-stage-screen-2048.webp";
import heroStageScreen2x from "@/assets/venue/hero-stage-screen-4096.webp";
import includedStageBrick from "@/assets/venue/included-stage-brick-2048.webp";
import includedStageBrick2x from "@/assets/venue/included-stage-brick-4096.webp";
import eventAcoustic01 from "@/assets/venue/event-acoustic-01-2048.webp";
import eventAcoustic01_2x from "@/assets/venue/event-acoustic-01-4096.webp";
import eventBackWall from "@/assets/venue/event-back-wall-2048.webp";
import eventBackWall2x from "@/assets/venue/event-back-wall-4096.webp";

export interface TourScene {
  id: string;
  /** Venue location. Several viewpoints can share one room. */
  room: string;
  /** Viewpoint inside the room; omitted when the room has a single view. */
  view?: string;
  desc: string;
  src: string;
  /** 2x copy of the same photograph, same aspect ratio. */
  full: string;
  /** Vertical photograph — never crop or stretch it into 3:2. */
  portrait?: boolean;
}

/* Ordered as a sales walkthrough, not as a floor plan: the renovated event
 * space leads because that is what a host is deciding on, then the arrival
 * areas, then the support rooms that were not part of the renovation. */
export const TOUR_SCENES: TourScene[] = [
  {
    id: "full-room",
    room: "Event Space",
    view: "Full Room",
    desc: "The whole room in one look: stage, full-wall display and open floor for up to 90 guests.",
    src: heroStageScreen,
    full: heroStageScreen2x,
  },
  {
    id: "stage-view",
    room: "Event Space",
    view: "Stage & Display",
    desc: "Raised stage with the full-wall display behind it: presentations, ceremonies, DJs.",
    src: eventStage01,
    full: eventStage01_2x,
  },
  {
    id: "open-floor",
    room: "Event Space",
    view: "Open Floor",
    desc: "Open floor from the stage: seat it theater-style, set banquet rounds or clear it for a dance floor.",
    src: includedStageBrick,
    full: includedStageBrick2x,
  },
  {
    id: "acoustic-wall",
    room: "Event Space",
    view: "Acoustic Wall",
    desc: "Acoustic panelling and warm wall lighting along the room: clean sound, no echo.",
    src: eventAcoustic01,
    full: eventAcoustic01_2x,
  },
  {
    id: "from-the-stage",
    room: "Event Space",
    view: "From the Stage",
    desc: "What your speaker sees: the room from the stage, doors through to the rest of the venue.",
    src: eventBackWall,
    full: eventBackWall2x,
  },
  {
    id: "entrance",
    room: "Main Entrance",
    desc: "Marble accents and a smart TV display greet your guests on the way in.",
    src: mainEntrance,
    full: mainEntrance2x,
  },
  {
    id: "welcome",
    room: "Welcome Area",
    desc: "The renovated welcome wall: backlit sign on warm wood slats, a natural photo spot.",
    src: welcomeDetail,
    full: welcomeDetail2x,
    portrait: true,
  },
  {
    id: "kitchen",
    room: "Prep Kitchen",
    desc: "Full prep kitchen for catering and bar service.",
    src: kitchen,
    full: kitchen,
  },
  {
    id: "storage",
    room: "Storage Area",
    desc: "Tables and chairs on hand: setup and teardown made easy.",
    src: storage,
    full: storage,
  },
  {
    id: "restroom",
    room: "Restroom Facilities",
    desc: "Clean, modern restrooms for your guests.",
    src: restroom,
    full: restroom,
  },
  {
    id: "exterior",
    room: "Venue Exterior",
    desc: "Easy access and parking right outside the door.",
    src: entrance,
    full: entrance,
  },
];

/** "Event Space · Stage View" — what the tour prints under the photo. */
export const sceneLabel = (s: TourScene) => (s.view ? `${s.room} · ${s.view}` : s.room);
