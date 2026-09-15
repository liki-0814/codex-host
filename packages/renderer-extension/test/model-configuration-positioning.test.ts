import { describe, expect, it } from "vitest";
import { rendererModelPickerBottomAlignedMenuPlacement } from "../src/renderer-model-picker-positioning.js";
describe("native model parameter submenu placement", () => {
  it("shares the main menu bottom while allowing its own content height", () => {
    const placement = rendererModelPickerBottomAlignedMenuPlacement(
      { left: 400, right: 660, top: 400, bottom: 600 },
      { width: 1200, height: 800 },
    );
    expect(placement.left).toBeGreaterThan(660);
    expect(placement.bottom).toBe(200);
    expect(placement.top).toBeUndefined();
    expect(placement.maxHeight).toBe(360);
  });
  it("falls back left on a narrow right edge without losing bottom alignment", () => {
    const placement = rendererModelPickerBottomAlignedMenuPlacement(
      { left: 600, right: 860, top: 200, bottom: 400 },
      { width: 900, height: 600 },
    );
    expect(placement.left).toBeLessThan(600);
    expect(placement.bottom).toBe(200);
  });
});
