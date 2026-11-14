import { describe, expect, it } from "vitest";

import { fmtCost, fmtEnergy, fmtPower, toKwh } from "./format.ts";

describe("fmtPower", () => {
  it.each([
    [null, "–", "W"],
    [0.01, "0", "W"],
    [4.25, "4.3", "W"],
    [57.4, "57", "W"],
    [1250, "1.25", "kW"],
    [12500, "12.5", "kW"],
  ])("%s W → %s %s", (w, num, unit) => {
    expect(fmtPower(w)).toEqual({ num, unit });
  });
});

describe("fmtEnergy", () => {
  it.each([
    [undefined, "–"],
    [0.32, "320 Wh"],
    [1.254, "1.25 kWh"],
    [42, "42.0 kWh"],
    [128.4, "128 kWh"],
  ])("%s kWh → %s", (kwh, text) => {
    expect(fmtEnergy(kwh)).toBe(text);
  });
});

describe("toKwh", () => {
  it("converts Wh and MWh, and treats a missing unit as kWh", () => {
    expect(toKwh(1500, "Wh")).toBe(1.5);
    expect(toKwh(2, "MWh")).toBe(2000);
    expect(toKwh(3, undefined)).toBe(3);
    expect(toKwh(null, "Wh")).toBeNull();
  });
});

describe("fmtCost", () => {
  it("is empty without a price", () => {
    expect(fmtCost(2, undefined, "en", "USD")).toBe("");
  });
  it("multiplies by the price per kWh", () => {
    expect(fmtCost(2, 0.13, "en-US", "USD")).toBe(" · $0.26");
  });
});
