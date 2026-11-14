import { SmartPlugCard } from "./card.ts";
import { SmartPlugCardEditor } from "./editor.ts";
import { defineOnce, logVersion, registerCard } from "./lib/register.ts";

defineOnce("smart-plug-card", SmartPlugCard);
defineOnce("smart-plug-card-editor", SmartPlugCardEditor);

registerCard({
  type: "smart-plug-card",
  name: "Smart Plug",
  description:
    "A Shelly or Tasmota plug with its live wattage, 24-hour power graph and energy used today, yesterday and this month.",
  preview: true,
});

logVersion("SMART-PLUG-CARD", __VERSION__, "#ffb300");
