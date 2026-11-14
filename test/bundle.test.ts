import { describe, expect, it } from "vitest";

import hacs from "../hacs.json";

// Runs against the built file (npm run build first), the same file Home Assistant loads.
describe("dist bundle", () => {
  it("is the file the Marketplace installs", () => {
    expect(hacs.filename).toBe("smart-plug-card.js");
  });

  it("defines the card and its editor", async () => {
    // @ts-expect-error -- the built file has no type declarations
    await import("../dist/smart-plug-card.js");
    expect(customElements.get("smart-plug-card")).toBeDefined();
    expect(customElements.get("smart-plug-card-editor")).toBeDefined();
    expect(window.customCards?.map((c) => c.type)).toContain("smart-plug-card");
  });
});
