export interface PowerText {
  num: string;
  unit: string;
}

/** Watts as a short number + unit: "0.4 W", "57 W", "1.25 kW". */
export function fmtPower(w: number | null | undefined): PowerText {
  if (w == null || Number.isNaN(w)) {
    return { num: "–", unit: "W" };
  }
  const a = Math.abs(w);
  if (a < 0.05) {
    return { num: "0", unit: "W" };
  }
  if (a >= 1000) {
    return { num: (w / 1000).toFixed(a >= 10000 ? 1 : 2), unit: "kW" };
  }
  return { num: a < 10 ? w.toFixed(1) : Math.round(w).toString(), unit: "W" };
}

/** Energy in kWh as "320 Wh", "1.25 kWh", "42.0 kWh", "128 kWh". */
export function fmtEnergy(kwh: number | null | undefined): string {
  if (kwh == null || Number.isNaN(kwh)) {
    return "–";
  }
  const a = Math.abs(kwh);
  if (a < 1) {
    return `${Math.round(kwh * 1000)} Wh`;
  }
  return `${kwh.toFixed(a >= 100 ? 0 : a >= 10 ? 1 : 2)} kWh`;
}

/** Converts an energy value in Wh / kWh / MWh to kWh. */
export function toKwh(value: number | null | undefined, unit: string | undefined): number | null {
  if (value == null) {
    return null;
  }
  const u = (unit || "kWh").toLowerCase();
  if (u === "wh") {
    return value / 1000;
  }
  if (u === "mwh") {
    return value * 1000;
  }
  return value;
}

/** "· $1.23" for an energy amount at `price` per kWh, or "" when there's no price. */
export function fmtCost(
  kwh: number | null | undefined,
  price: number | string | undefined,
  language: string | undefined,
  currency: string | undefined,
): string {
  if (price == null || price === "" || kwh == null) {
    return "";
  }
  try {
    const money = new Intl.NumberFormat(language, { style: "currency", currency: currency || "USD" });
    return ` · ${money.format(kwh * Number(price))}`;
  } catch {
    return "";
  }
}
