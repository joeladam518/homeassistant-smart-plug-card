import { act, flush, stubHaElements } from "@joeladam518/shared-cards/testing.ts";
import type { HomeAssistant } from "@joeladam518/shared-cards/types.ts";
import { beforeAll, describe, expect, it, vi } from "vitest";

import type { SmartPlugCardElement as SmartPlugCard } from "./card.tsx";

beforeAll(async () => {
  stubHaElements();
  await import("./index.ts");
});

const entity = (entity_id: string, state: string, attributes: Record<string, unknown> = {}) => ({
  entity_id,
  state,
  attributes,
  context: { id: "", parent_id: null, user_id: null },
  last_changed: "",
  last_updated: "",
});

function fakeHass(plugState = "on", watts = "57.4"): HomeAssistant {
  return {
    states: {
      "switch.lamp": entity("switch.lamp", plugState, { friendly_name: "Desk Lamp" }),
      "sensor.lamp_power": entity("sensor.lamp_power", watts, {
        device_class: "power",
        unit_of_measurement: "W",
      }),
      "sensor.lamp_energy_total": entity("sensor.lamp_energy_total", "12.3", {
        device_class: "energy",
        state_class: "total_increasing",
        unit_of_measurement: "kWh",
      }),
      "sensor.lamp_energy_today": entity("sensor.lamp_energy_today", "0.4", {
        device_class: "energy",
        state_class: "total_increasing",
        unit_of_measurement: "kWh",
      }),
    },
    entities: {
      "switch.lamp": { entity_id: "switch.lamp", device_id: "dev1" },
      "sensor.lamp_power": { entity_id: "sensor.lamp_power", device_id: "dev1" },
      "sensor.lamp_energy_total": { entity_id: "sensor.lamp_energy_total", device_id: "dev1" },
      "sensor.lamp_energy_today": { entity_id: "sensor.lamp_energy_today", device_id: "dev1" },
    },
    devices: { dev1: { id: "dev1", area_id: "office" } },
    areas: { office: { area_id: "office", name: "Office" } },
    config: { currency: "USD" } as HomeAssistant["config"],
    locale: { language: "en-US" },
    connection: {} as HomeAssistant["connection"],
    callService: vi.fn(() => Promise.resolve()),
    callWS: vi.fn((msg: { type: string; calendar?: { period: string; offset?: number } }) => {
      if (msg.type === "recorder/statistic_during_period") {
        const c = msg.calendar;
        return Promise.resolve({ change: c?.period === "month" ? 8.5 : c?.offset === -1 ? 0.75 : 0.32 });
      }
      return Promise.resolve({ "sensor.lamp_power": [{ start: Date.now() - 3600_000, mean: 40, max: 60 }] });
    }) as HomeAssistant["callWS"],
  };
}

async function mount(config: Record<string, unknown>, hass = fakeHass()): Promise<SmartPlugCard> {
  const card = document.createElement("smart-plug-card") as SmartPlugCard;
  await act(() => {
    card.setConfig({ type: "custom:smart-plug-card", entity: "switch.lamp", ...config });
    card.hass = hass;
    document.body.append(card);
  });
  // Wait for the energy totals (fetched over the fake websocket) to render.
  await vi.waitFor(() => expect(card.shadowRoot?.querySelector(".v")?.textContent).toMatch(/\d/));
  await flush();
  return card;
}

const text = (card: SmartPlugCard, sel: string) => card.shadowRoot!.querySelector(sel)!.textContent!.trim();

describe("smart-plug-card", () => {
  it("is listed in the card picker", () => {
    expect(window.customCards?.some((c) => c.type === "smart-plug-card")).toBe(true);
    expect(customElements.get("smart-plug-card-editor")).toBeDefined();
  });

  it("shows the name, area, state, live watts and energy totals", async () => {
    const card = await mount({ price: 0.13 });
    expect(text(card, ".name")).toBe("Desk Lamp");
    expect(text(card, ".sub")).toBe("Office · On");
    expect(text(card, ".num")).toBe("57");
    expect(text(card, ".unit")).toBe("W");
    const totals = [...card.shadowRoot!.querySelectorAll(".v")].map((e) => e.textContent);
    expect(totals).toEqual(["320 Wh · $0.04", "750 Wh · $0.10", "8.50 kWh · $1.11"]);
    expect(card.shadowRoot!.querySelector("ha-card")!.className).toBe("on");
  });

  it("finds the lifetime energy sensor, not the daily one", async () => {
    const hass = fakeHass();
    await mount({}, hass);
    expect(hass.callWS).toHaveBeenCalledWith(
      expect.objectContaining({
        type: "recorder/statistic_during_period",
        statistic_id: "sensor.lamp_energy_total",
      }),
    );
  });

  it("toggles the plug and shows the new state straight away", async () => {
    const hass = fakeHass("off");
    const card = await mount({}, hass);
    card.shadowRoot!.querySelector<HTMLButtonElement>(".switch")!.click();
    await flush();
    expect(hass.callService).toHaveBeenCalledWith("homeassistant", "toggle", { entity_id: "switch.lamp" });
    expect(card.shadowRoot!.querySelector(".switch")!.classList.contains("on")).toBe(true);
  });

  it("opens more-info for the power sensor from the wattage", async () => {
    const card = await mount({});
    const opened = vi.fn();
    card.addEventListener("hass-more-info", (e) => opened((e as CustomEvent).detail.entityId));
    card.shadowRoot!.querySelector<HTMLElement>(".mid")!.click();
    expect(opened).toHaveBeenCalledWith("sensor.lamp_power");
  });

  it("says when the entity doesn't exist", async () => {
    const card = document.createElement("smart-plug-card") as SmartPlugCard;
    await act(() => {
      card.setConfig({ type: "custom:smart-plug-card", entity: "switch.missing" });
      card.hass = fakeHass();
      document.body.append(card);
    });
    await flush();
    expect(text(card, ".sub")).toBe("Entity not found");
    expect(card.shadowRoot!.querySelector("ha-card")!.className).toBe("unavailable");
  });

  it("needs an entity", () => {
    const card = document.createElement("smart-plug-card") as SmartPlugCard;
    expect(() => card.setConfig({ type: "custom:smart-plug-card" } as never)).toThrow(/entity/);
  });
});
