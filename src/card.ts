import { entityAreaName, numericState, siblingSensors } from "@joeladam518/shared-cards/devices.ts";
import { fireMoreInfo } from "@joeladam518/shared-cards/more-info.ts";
import { areaPath, linePath, type Point, timeScale } from "@joeladam518/shared-cards/sparkline.ts";
import { fetchStats, rowTime } from "@joeladam518/shared-cards/statistics.ts";
import type {
  HomeAssistant,
  LovelaceCardConfig,
  LovelaceGridOptions,
} from "@joeladam518/shared-cards/types.ts";
import { html, LitElement, nothing, unsafeCSS } from "lit";

import { fmtCost, fmtEnergy, fmtPower, toKwh } from "./format.ts";

import cardCss from "./card.css?inline";
import baseCss from "@joeladam518/shared-cards/base.css?inline";
import switchCss from "@joeladam518/shared-cards/switch.css?inline";

export interface SmartPlugCardConfig extends LovelaceCardConfig {
  /** The plug: a switch or light. */
  entity: string;
  name?: string;
  icon?: string;
  /** Power sensor (W); found on the same device if left out. */
  power?: string;
  /** Energy sensor (kWh); found on the same device if left out. */
  energy?: string;
  /** Price per kWh; adds cost next to the energy figures. */
  price?: number | string;
}

interface EnergyTotals {
  today?: number | null;
  yesterday?: number | null;
  month?: number | null;
}

const DAY_MS = 24 * 3600 * 1000;
const REFRESH_MS = 5 * 60 * 1000;
/** Energy ticks often; refresh the totals at most this often when it does. */
const MIN_REFRESH_GAP_MS = 60 * 1000;
const SPARK_W = 200;

/** Ranks energy sensors: the lifetime total first, "today" / "this month" style meters last. */
const energyRank = (id: string): number =>
  (/total/.test(id) ? 0 : 1) + (/today|yesterday|daily|month/.test(id) ? 5 : 0);

/**
 * A Shelly or Tasmota plug (any switch/light with power monitoring): on/off, live watts,
 * a 24-hour power graph and energy used today, yesterday and this month.
 */
export class SmartPlugCard extends LitElement {
  static override properties = {
    _config: { state: true },
    _totals: { state: true },
    _spark: { state: true },
    _optimistic: { state: true },
  };

  static override styles = [unsafeCSS(baseCss), unsafeCSS(switchCss), unsafeCSS(cardCss)];

  declare _config?: SmartPlugCardConfig;
  declare _totals: EnergyTotals;
  declare _spark: Point[];
  /** The state we just asked for, shown until Home Assistant reports back. */
  declare _optimistic: "on" | "off" | null;

  private _hass?: HomeAssistant;
  private _power: string | null = null;
  private _energy: string | null = null;
  private _resolvedFor?: string;
  private _lastFetch = 0;
  private _timer?: ReturnType<typeof setInterval>;

  constructor() {
    super();
    this._totals = {};
    this._spark = [];
    this._optimistic = null;
  }

  static getStubConfig(hass: HomeAssistant): Partial<SmartPlugCardConfig> {
    const plug = Object.keys(hass?.states || {}).find((id) => {
      if (!/^(switch|light)\./.test(id)) {
        return false;
      }
      const device = hass.entities?.[id]?.device_id;
      return (
        !!device &&
        Object.values(hass.entities).some(
          (e) => e.device_id === device && hass.states[e.entity_id]?.attributes?.device_class === "power",
        )
      );
    });
    return { entity: plug || "switch.example" };
  }

  static getConfigElement(): HTMLElement {
    return document.createElement("smart-plug-card-editor");
  }

  setConfig(config: SmartPlugCardConfig): void {
    if (!config?.entity) {
      throw new Error("Set 'entity' to a switch or light");
    }
    this._config = { ...config };
    this._resolvedFor = undefined;
    this._totals = {};
    this._spark = [];
    if (this._hass) {
      this._resolve();
      void this._refresh(true);
    }
  }

  get hass(): HomeAssistant | undefined {
    return this._hass;
  }

  set hass(hass: HomeAssistant) {
    const prev = this._hass;
    this._hass = hass;
    if (!this._config) {
      return;
    }
    this._resolve();
    const ids = [this._config.entity, this._power, this._energy];
    if (!prev || ids.some((id) => id && prev.states[id] !== hass.states[id])) {
      this.requestUpdate();
    }
    if (!prev) {
      void this._refresh(true);
    } else if (this._energy && prev.states[this._energy] !== hass.states[this._energy]) {
      void this._refresh(false);
    }
  }

  override connectedCallback(): void {
    super.connectedCallback();
    this._timer = setInterval(() => void this._refresh(true), REFRESH_MS);
    if (this._hass) {
      void this._refresh(true);
    }
  }

  override disconnectedCallback(): void {
    super.disconnectedCallback();
    clearInterval(this._timer);
  }

  getCardSize(): number {
    return 3;
  }

  getGridOptions(): LovelaceGridOptions {
    return { columns: 12, rows: 3, min_columns: 6, min_rows: 3 };
  }

  /* ------------------------------------------------------------ data */

  /** Finds the power and energy sensors on the plug's device, unless the config names them. */
  private _resolve(): void {
    const h = this._hass;
    const c = this._config;
    if (!h || !c || this._resolvedFor === c.entity) {
      return;
    }
    const sensors = siblingSensors(h, c.entity);
    const attr = (id: string, key: string) => h.states[id]?.attributes?.[key];
    this._power = c.power || sensors.find((id) => attr(id, "device_class") === "power") || null;
    this._energy =
      c.energy ||
      sensors
        .filter(
          (id) =>
            attr(id, "device_class") === "energy" &&
            ["total", "total_increasing"].includes(String(attr(id, "state_class"))),
        )
        .toSorted((a, b) => energyRank(a) - energyRank(b))[0] ||
      null;
    this._resolvedFor = c.entity;
  }

  private async _refresh(force: boolean): Promise<void> {
    const h = this._hass;
    if (!h || !this._config || !this.isConnected) {
      return;
    }
    const now = Date.now();
    if (!force && now - this._lastFetch < MIN_REFRESH_GAP_MS) {
      return;
    }
    this._lastFetch = now;
    this._resolve();
    const jobs: Promise<void>[] = [];
    const energy = this._energy;
    const power = this._power;

    if (energy) {
      const unit = h.states[energy]?.attributes?.unit_of_measurement as string | undefined;
      // Long-term statistics give the right totals for meters that count up forever (Shelly)
      // and for ones that reset (Tasmota).
      const change = (calendar: { period: "day" | "month"; offset?: number }) =>
        h
          .callWS<{ change?: number | null }>({
            type: "recorder/statistic_during_period",
            statistic_id: energy,
            types: ["change"],
            calendar,
          })
          .then((r) => {
            const v = toKwh(r?.change, unit);
            return v == null ? null : Math.max(0, v);
          })
          .catch(() => null);
      jobs.push(
        Promise.all([
          change({ period: "day" }),
          change({ period: "day", offset: -1 }),
          change({ period: "month" }),
        ]).then(([today, yesterday, month]) => {
          this._totals = { today, yesterday, month };
        }),
      );
    }

    if (power) {
      jobs.push(
        fetchStats(h, [power], ["mean", "max"])
          .then((r) => {
            this._spark = (r?.[power] || []).map((row) => ({ t: rowTime(row), v: row.max ?? row.mean ?? 0 }));
          })
          .catch(() => {
            this._spark = [];
          }),
      );
    }
    await Promise.all(jobs);
  }

  /* --------------------------------------------------------- actions */

  private _toggle(e: Event): void {
    e.stopPropagation();
    const h = this._hass;
    const st = this._config && h?.states[this._config.entity];
    if (!h || !st || st.state === "unavailable") {
      return;
    }
    this._optimistic = st.state === "on" ? "off" : "on";
    void h.callService("homeassistant", "toggle", { entity_id: st.entity_id }).finally(() =>
      setTimeout(() => {
        this._optimistic = null;
      }, 1500),
    );
  }

  private _onKey(e: KeyboardEvent): void {
    if (e.key === "Enter") {
      (e.currentTarget as HTMLElement).click();
    }
  }

  /* ---------------------------------------------------------- render */

  private _renderIcon(): unknown {
    const h = this._hass!;
    const c = this._config!;
    if (c.icon) {
      return html`<ha-icon .icon=${c.icon}></ha-icon>`;
    }
    const st = h.states[c.entity];
    const stateObj = st && this._optimistic ? { ...st, state: this._optimistic } : st;
    // Home Assistant's own icon for this entity, which follows on/off.
    return html`<ha-state-icon .hass=${h} .stateObj=${stateObj}></ha-state-icon>`;
  }

  private _sparkPaths(watts: number | null): { line: string; area: string } {
    const pts = [...this._spark];
    if (watts != null) {
      pts.push({ t: Date.now(), v: watts });
    }
    if (pts.length < 2) {
      return { line: "M0,38L200,38", area: "" };
    }
    const now = Date.now();
    const x = timeScale(now - DAY_MS, now, SPARK_W);
    const max = Math.max(5, ...pts.map((p) => p.v));
    const y = (v: number) => 38 - (Math.max(0, v) / max) * 34;
    const line = linePath(pts, x, y);
    return { line, area: areaPath(line, pts, x, 40) };
  }

  override render(): unknown {
    const h = this._hass;
    const c = this._config;
    if (!h || !c) {
      return nothing;
    }
    const st = h.states[c.entity];
    const state = this._optimistic || st?.state;
    const on = state === "on";
    const unavailable = !st || state === "unavailable" || state === "unknown";

    const name = c.name || st?.attributes?.friendly_name || c.entity;
    const sub = st
      ? [entityAreaName(h, c.entity), unavailable ? "Unavailable" : on ? "On" : "Off"]
          .filter(Boolean)
          .join(" · ")
      : "Entity not found";

    const watts = numericState(h, this._power);
    const p = fmtPower(watts);
    const spark = this._sparkPaths(watts);

    const t = this._totals;
    const cost = (kwh: number | null | undefined) =>
      fmtCost(kwh, c.price, h.locale?.language, h.config?.currency);

    return html`
      <ha-card class=${unavailable ? "unavailable" : on ? "on" : "off"}>
        <div class="top">
          <button class="icon-btn" aria-label="Toggle" @click=${this._toggle}>${this._renderIcon()}</button>
          <div
            class="info"
            role="button"
            tabindex="0"
            @click=${() => fireMoreInfo(this, c.entity)}
            @keydown=${this._onKey}
          >
            <div class="name">${name}</div>
            <div class="sub">${sub}</div>
          </div>
          <button
            class="switch ${on ? "on" : ""}"
            role="switch"
            aria-label="Toggle"
            aria-checked=${String(on)}
            ?disabled=${unavailable}
            @click=${this._toggle}
          >
            <span></span>
          </button>
        </div>

        <div
          class="mid ${watts != null && watts >= 1 ? "drawing" : ""}"
          role="button"
          tabindex="0"
          title="Power history"
          @click=${() => fireMoreInfo(this, this._power || c.entity)}
          @keydown=${this._onKey}
        >
          <div class="power">
            <span class="num">${this._power ? p.num : ""}</span>
            <span class="unit">${this._power ? p.unit : "No power sensor"}</span>
          </div>
          <svg class="spark" viewBox="0 0 200 40" preserveAspectRatio="none" aria-hidden="true">
            <defs>
              <linearGradient id="g" x1="0" y1="0" x2="0" y2="1">
                <stop offset="0" stop-color="currentColor" stop-opacity=".35" />
                <stop offset="1" stop-color="currentColor" stop-opacity="0" />
              </linearGradient>
            </defs>
            <path fill="url(#g)" d=${spark.area}></path>
            <path
              fill="none"
              stroke="currentColor"
              stroke-width="1.5"
              vector-effect="non-scaling-stroke"
              d=${spark.line}
            ></path>
          </svg>
        </div>

        <div
          class="stats"
          role="button"
          tabindex="0"
          title="Energy history"
          ?hidden=${!this._energy}
          @click=${() => fireMoreInfo(this, this._energy || c.entity)}
          @keydown=${this._onKey}
        >
          <div>
            <span class="lbl">Today</span><span class="v">${fmtEnergy(t.today)}${cost(t.today)}</span>
          </div>
          <div>
            <span class="lbl">Yesterday</span
            ><span class="v">${fmtEnergy(t.yesterday)}${cost(t.yesterday)}</span>
          </div>
          <div>
            <span class="lbl">This month</span><span class="v">${fmtEnergy(t.month)}${cost(t.month)}</span>
          </div>
        </div>
      </ha-card>
    `;
  }
}
