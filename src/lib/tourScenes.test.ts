import { describe, it, expect } from "vitest";
import { TOUR_SCENES, sceneLabel } from "./tourScenes";

const LEGACY_ROOMS = ["Prep Kitchen", "Storage Area", "Restroom Facilities", "Venue Exterior"];

describe("TOUR_SCENES", () => {
  it("opens with the renovated event space, not the exterior", () => {
    expect(TOUR_SCENES[0].room).toBe("Event Space");
    expect(TOUR_SCENES[0].id).toBe("full-room");
  });

  it("keeps every event-space view ahead of entrance and welcome", () => {
    const lastEventIdx = TOUR_SCENES.map((s) => s.room).lastIndexOf("Event Space");
    const firstNonEventIdx = TOUR_SCENES.findIndex((s) => s.room !== "Event Space");
    expect(lastEventIdx).toBeLessThan(firstNonEventIdx);
  });

  it("pushes the un-renovated rooms to the end of the walkthrough", () => {
    const tail = TOUR_SCENES.slice(-LEGACY_ROOMS.length).map((s) => s.room);
    expect(tail).toEqual(LEGACY_ROOMS);
    const legacyOnlyAtEnd = TOUR_SCENES.slice(0, -LEGACY_ROOMS.length).every(
      (s) => !LEGACY_ROOMS.includes(s.room),
    );
    expect(legacyOnlyAtEnd).toBe(true);
  });

  it("has unique ids and unique photographs", () => {
    const ids = TOUR_SCENES.map((s) => s.id);
    expect(new Set(ids).size).toBe(ids.length);
    const srcs = TOUR_SCENES.map((s) => s.src);
    expect(new Set(srcs).size).toBe(srcs.length);
  });

  it("ships a 2x copy for every renovated photograph", () => {
    for (const s of TOUR_SCENES.filter((x) => !LEGACY_ROOMS.includes(x.room))) {
      expect(s.full, s.id).not.toBe(s.src);
    }
  });

  it("labels room and view", () => {
    expect(sceneLabel({ room: "Event Space", view: "Full Room" } as never)).toBe(
      "Event Space · Full Room",
    );
    expect(sceneLabel({ room: "Prep Kitchen" } as never)).toBe("Prep Kitchen");
  });
});
