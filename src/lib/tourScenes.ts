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
import eventStage02 from "@/assets/venue/event-stage-02-2048.webp";
import eventStage02_2x from "@/assets/venue/event-stage-02-4096.webp";
import eventAcoustic01 from "@/assets/venue/event-acoustic-01-2048.webp";
import eventAcoustic01_2x from "@/assets/venue/event-acoustic-01-4096.webp";
import eventAcoustic02 from "@/assets/venue/event-acoustic-02-2048.webp";
import eventAcoustic02_2x from "@/assets/venue/event-acoustic-02-4096.webp";
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

/* Ordered as a walkthrough: arrive, come in, then around the event space and
 * on to the support areas. */
export const TOUR_SCENES: TourScene[] = [
  {
    id: "exterior",
    room: "Venue Exterior",
    desc: "Your guests arrive here: easy access and parking right outside.",
    src: entrance,
    full: entrance,
  },
  {
    id: "welcome",
    room: "Welcome Area",
    desc: "The renovated welcome wall: backlit sign on warm wood slats.",
    src: welcomeDetail,
    full: welcomeDetail2x,
    portrait: true,
  },
  {
    id: "entrance",
    room: "Main Entrance",
    desc: "Marble accents and a smart TV display greet you on the way in.",
    src: mainEntrance,
    full: mainEntrance2x,
  },
  {
    id: "stage-view",
    room: "Event Space",
    view: "Stage View",
    desc: "The new stage and the full-wall display, ready for your program.",
    src: eventStage01,
    full: eventStage01_2x,
  },
  {
    id: "stage-alt",
    room: "Event Space",
    view: "Alternate Stage View",
    desc: "The same stage from the floor, with the control desk behind you.",
    src: eventStage02,
    full: eventStage02_2x,
  },
  {
    id: "acoustic-wall",
    room: "Event Space",
    view: "Acoustic Wall",
    desc: "Acoustic panelling and wall lighting down the length of the room.",
    src: eventAcoustic01,
    full: eventAcoustic01_2x,
  },
  {
    id: "side-wall",
    room: "Event Space",
    view: "Side View",
    desc: "The side wall and the doors through to the rest of the venue.",
    src: eventAcoustic02,
    full: eventAcoustic02_2x,
  },
  {
    id: "open-floor",
    room: "Event Space",
    view: "Open Floor",
    desc: "Open floor looking back from the stage: lay it out however you need.",
    src: eventBackWall,
    full: eventBackWall2x,
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
];

/** "Event Space · Stage View" — what the tour prints under the photo. */
export const sceneLabel = (s: TourScene) => (s.view ? `${s.room} · ${s.view}` : s.room);
