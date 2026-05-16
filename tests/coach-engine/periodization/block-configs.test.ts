// Sprint v1.4: BLOCK_CONFIGS strengthRpeCap regression.
//
// Block 3-4 use maintenance mode (reduced volume). Lowering rpeCap from
// 8 to 7 simultaneously is a double stimulus loss — Bickel 2011 + Currier
// 2023 show maintenance needs INTENSITY, not just less volume. Sprint v1.4
// raised B3/B4 rpeCap back to 8.

import { describe, it, expect } from "vitest";
import { BLOCK_CONFIGS } from "@/lib/coach-engine/periodization";

describe("BLOCK_CONFIGS strengthRpeCap (Sprint v1.4)", () => {
  it("Block 1: linear_progression → rpeCap 8", () => {
    expect(BLOCK_CONFIGS[1].strengthRpeCap).toBe(8);
    expect(BLOCK_CONFIGS[1].strengthMode).toBe("linear_progression");
  });

  it("Block 2: linear_progression → rpeCap 8", () => {
    expect(BLOCK_CONFIGS[2].strengthRpeCap).toBe(8);
    expect(BLOCK_CONFIGS[2].strengthMode).toBe("linear_progression");
  });

  it("Block 3: maintenance → rpeCap 8 (Sprint v1.4: was 7)", () => {
    expect(BLOCK_CONFIGS[3].strengthRpeCap).toBe(8);
    expect(BLOCK_CONFIGS[3].strengthMode).toBe("maintenance");
  });

  it("Block 4: maintenance → rpeCap 8 (Sprint v1.4: was 7)", () => {
    expect(BLOCK_CONFIGS[4].strengthRpeCap).toBe(8);
    expect(BLOCK_CONFIGS[4].strengthMode).toBe("maintenance");
  });

  it("Block 5: minimal → rpeCap 7 (taper-appropriate)", () => {
    expect(BLOCK_CONFIGS[5].strengthRpeCap).toBe(7);
    expect(BLOCK_CONFIGS[5].strengthMode).toBe("minimal");
  });
});
