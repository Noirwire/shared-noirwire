import { describe, expect, it } from "vitest";
import { chartPaths } from "./chartPath.js";

describe("chartPaths", () => {
  it("draws nothing for fewer than two points", () => {
    expect(chartPaths([], 100, 50, 0)).toBeNull();
    expect(chartPaths([7], 100, 50, 0)).toBeNull();
  });

  it("spreads points across the width and puts the highest value at the top", () => {
    expect(chartPaths([0, 10, 5], 100, 50, 0)?.line).toBe("M0.00 50.00 L50.00 0.00 L100.00 25.00");
  });

  it("keeps the line inside the padding", () => {
    expect(chartPaths([1, 2], 100, 50, 10)?.line).toBe("M10.00 40.00 L90.00 10.00");
  });

  it("closes the area down to the baseline under the line", () => {
    expect(chartPaths([1, 2], 100, 50, 10)?.area).toBe("M10.00 40.00 L90.00 10.00 L90 50 L10 50 Z");
  });

  it("draws a flat series as a level line rather than dividing by zero", () => {
    expect(chartPaths([3, 3, 3], 100, 50, 0)?.line).toBe("M0.00 50.00 L50.00 50.00 L100.00 50.00");
  });

  it("scales negative values the same way", () => {
    expect(chartPaths([-10, 0], 10, 10, 0)?.line).toBe("M0.00 10.00 L10.00 0.00");
  });
});
