import { defineOnce, logVersion, registerCard } from "homeassistant-ui-shared";

import { SmartPlugCardElement } from "./card.tsx";
import { SmartPlugCardEditorElement } from "./editor.tsx";

defineOnce("smart-plug-card", SmartPlugCardElement);
defineOnce("smart-plug-card-editor", SmartPlugCardEditorElement);

registerCard({
  type: "smart-plug-card",
  name: "Smart Plug",
  description:
    "A Shelly or Tasmota plug with its live wattage, 24-hour power graph and energy used today, yesterday and this month.",
  preview: true,
});

logVersion("SMART-PLUG-CARD", __VERSION__, "#ffb300");
