import { describe, expect, it } from "vitest";
import { processLocks } from "../../src/application/processLocks.js";

describe("processLocks", () => {
  it("is one registry, so every caller sees a reservation this process holds as alive", async () => {
    const first = processLocks();
    const second = processLocks();
    expect(second).toBe(first);
    const release = await first.hold("act_live");
    expect(await second.ownerGone("act_live")).toBe(false);
    release();
    expect(await second.ownerGone("act_live")).toBe(true);
  });

  it("treats the reservation being made right now as alive, and one from an earlier run as gone", async () => {
    const locks = processLocks();
    const release = await locks.hold("act_now");
    expect(await locks.ownerGone("act_now")).toBe(false);
    expect(await locks.ownerGone("act_from_before")).toBe(true);
    release();
  });
});
