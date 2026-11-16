import type { HomeAssistant } from "@joeladam518/shared-cards/types.ts";
import { html, LitElement, nothing } from "lit";

import type { SmartPlugCardConfig } from "./card.ts";

const SCHEMA = [
  { name: "entity", required: true, selector: { entity: { domain: ["switch", "light", "input_boolean"] } } },
  { name: "name", selector: { text: {} } },
  { name: "icon", selector: { icon: {} } },
  { name: "power", selector: { entity: { domain: "sensor", device_class: "power" } } },
  { name: "energy", selector: { entity: { domain: "sensor", device_class: "energy" } } },
  { name: "price", selector: { number: { min: 0, max: 5, step: 0.001, mode: "box" } } },
] as const;

const LABELS: Record<string, string> = {
  entity: "Plug (switch or light)",
  name: "Name (optional)",
  icon: "Icon (optional)",
  power: "Power sensor (found automatically)",
  energy: "Energy sensor (found automatically)",
  price: "Price per kWh (optional)",
};

/** The visual editor shown in the dashboard's card settings. */
export class SmartPlugCardEditor extends LitElement {
  static override properties = {
    hass: { attribute: false },
    _config: { state: true },
  };

  declare hass?: HomeAssistant;
  declare _config?: SmartPlugCardConfig;

  setConfig(config: SmartPlugCardConfig): void {
    this._config = { ...config };
  }

  private _label = (s: { name: string }): string => LABELS[s.name] || s.name;

  private _changed(e: CustomEvent<{ value: SmartPlugCardConfig }>): void {
    this._config = e.detail.value;
    this.dispatchEvent(
      new CustomEvent("config-changed", { detail: { config: this._config }, bubbles: true, composed: true }),
    );
  }

  override render(): unknown {
    if (!this.hass || !this._config) {
      return nothing;
    }
    return html`
      <ha-form
        .hass=${this.hass}
        .data=${this._config}
        .schema=${SCHEMA}
        .computeLabel=${this._label}
        @value-changed=${this._changed}
      ></ha-form>
    `;
  }
}
