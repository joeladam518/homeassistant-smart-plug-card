import { createEditorElement, type EditorProps, haProps } from "@joeladam518/shared-cards/card-element.tsx";
import type { FunctionComponent as FC } from "preact";

import type { SmartPlugCardConfig } from "./card.tsx";

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

const computeLabel = (s: { name: string }): string => LABELS[s.name] || s.name;

/** The visual editor shown in the dashboard's card settings. */
export const SmartPlugCardEditor: FC<EditorProps<SmartPlugCardConfig>> = ({ config, hass, onChange }) => (
  <ha-form
    ref={haProps({ hass, data: config, schema: SCHEMA, computeLabel })}
    onvalue-changed={(e: CustomEvent<{ value: SmartPlugCardConfig }>) => onChange(e.detail.value)}
  />
);

export const SmartPlugCardEditorElement = createEditorElement(SmartPlugCardEditor);
