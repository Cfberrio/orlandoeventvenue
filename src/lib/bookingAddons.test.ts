import { describe, it, expect } from "vitest";
import { getVisibleAddons } from "./bookingAddons";

const empty = {
  tablecloths: false,
  tablecloth_quantity: 0,
  setup_breakdown: false,
  package: "none",
  package_start_time: null,
  package_end_time: null,
  bar_package: "",
  bar_package_label: null,
  addons_detail: [],
};

describe("getVisibleAddons", () => {
  it("returns [] when the client ordered nothing", () => {
    expect(getVisibleAddons(empty)).toEqual([]);
  });

  it("lists tablecloths with quantity when present", () => {
    const items = getVisibleAddons({ ...empty, tablecloths: true, tablecloth_quantity: 10 });
    expect(items).toEqual([{ key: "tablecloths", label: "Manteles", detail: "10" }]);
  });

  it("lists setup & breakdown when true", () => {
    const items = getVisibleAddons({ ...empty, setup_breakdown: true });
    expect(items).toEqual([{ key: "setup_breakdown", label: "Montaje y desmontaje" }]);
  });

  it("lists the AV package with its hours when set", () => {
    const items = getVisibleAddons({
      ...empty,
      package: "gold",
      package_start_time: "14:00:00",
      package_end_time: "18:00:00",
    });
    expect(items).toEqual([{ key: "package", label: "Paquete AV", detail: "gold (14:00 - 18:00)" }]);
  });

  it("lists the bar package using its label when present", () => {
    const items = getVisibleAddons({ ...empty, bar_package: "premium", bar_package_label: "Premium Bar" });
    expect(items).toEqual([{ key: "bar_package", label: "Bar", detail: "Premium Bar" }]);
  });

  it("includes addons_detail extras not already covered, without amounts", () => {
    const items = getVisibleAddons({
      ...empty,
      addons_detail: [
        { type: "tablecloth", quantity: 10, amount: 50 }, // covered -> skipped
        { type: "photobooth", quantity: 1, amount: 200 }, // extra -> included, no amount
      ],
    });
    expect(items).toEqual([{ key: "addon-photobooth", label: "photobooth", detail: "1" }]);
  });

  it("never exposes a price field", () => {
    const items = getVisibleAddons({ ...empty, tablecloths: true, tablecloth_quantity: 3 });
    expect(JSON.stringify(items)).not.toMatch(/amount|price|\$/i);
  });
});
