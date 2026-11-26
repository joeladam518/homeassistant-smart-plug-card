import {
  areaPath,
  baseCss,
  type CardProps,
  createCardElement,
  entityAreaName,
  fetchStats,
  fireMoreInfo,
  haProps,
  type HomeAssistant,
  linePath,
  type LovelaceCardConfig,
  numericState,
  type Point,
  rowTime,
  siblingSensors,
  switchCss,
  timeScale,
  useInterval,
} from "@joeladam518/homeassistant-ui-shared";
import type { FunctionComponent as FC } from "preact";
import { useEffect, useRef, useState } from "preact/hooks";

import { fmtCost, fmtEnergy, fmtPower, toKwh } from "./format.ts";

import cardCss from "./card.css?inline";

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

interface Sensors {
  power: string | null;
  energy: string | null;
}

const DAY_MS = 24 * 3600 * 1000;
const REFRESH_MS = 5 * 60 * 1000;
/** Energy ticks often; refresh the totals at most this often when it does. */
const MIN_REFRESH_GAP_MS = 60 * 1000;
const SPARK_W = 200;

/** Ranks energy sensors: the lifetime total first, "today" / "this month" style meters last. */
const energyRank = (id: string): number =>
  (/total/.test(id) ? 0 : 1) + (/today|yesterday|daily|month/.test(id) ? 5 : 0);

/** Looked up once per config: scanning every entity on each `hass` update would be wasteful. */
const sensorCache = new WeakMap<SmartPlugCardConfig, Sensors>();

/** The power and energy sensors: from the config, or found on the plug's device. */
function sensorsFor(c: SmartPlugCardConfig, hass: HomeAssistant): Sensors {
  let found = sensorCache.get(c);
  if (!found) {
    const sensors = siblingSensors(hass, c.entity);
    const attr = (id: string, key: string) => hass.states[id]?.attributes?.[key];
    found = {
      power: c.power || sensors.find((id) => attr(id, "device_class") === "power") || null,
      energy:
        c.energy ||
        sensors
          .filter(
            (id) =>
              attr(id, "device_class") === "energy" &&
              ["total", "total_increasing"].includes(String(attr(id, "state_class"))),
          )
          .toSorted((a, b) => energyRank(a) - energyRank(b))[0] ||
        null,
    };
    sensorCache.set(c, found);
  }
  return found;
}

function sparkPaths(spark: Point[], watts: number | null): { line: string; area: string } {
  const pts = [...spark];
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

const onKey = (e: KeyboardEvent): void => {
  if (e.key === "Enter") {
    (e.currentTarget as HTMLElement).click();
  }
};

/**
 * A Shelly or Tasmota plug (any switch/light with power monitoring): on/off, live watts,
 * a 24-hour power graph and energy used today, yesterday and this month.
 */
export const SmartPlugCard: FC<CardProps<SmartPlugCardConfig>> = ({ config: c, hass, host }) => {
  const [totals, setTotals] = useState<EnergyTotals>({});
  const [spark, setSpark] = useState<Point[]>([]);
  /** The state we just asked for, shown until Home Assistant reports back. */
  const [optimistic, setOptimistic] = useState<"on" | "off" | null>(null);
  const { power, energy } = sensorsFor(c, hass);

  // The fetches always use the latest hass.
  const hassRef = useRef(hass);
  hassRef.current = hass;
  const lastFetch = useRef(0);

  const refresh = async (force: boolean): Promise<void> => {
    const h = hassRef.current;
    const now = Date.now();
    if (!force && now - lastFetch.current < MIN_REFRESH_GAP_MS) {
      return;
    }
    lastFetch.current = now;
    const jobs: Promise<void>[] = [];

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
        ]).then(([today, yesterday, month]) => setTotals({ today, yesterday, month })),
      );
    }

    if (power) {
      jobs.push(
        fetchStats(h, [power], ["mean", "max"])
          .then((r) =>
            setSpark((r?.[power] || []).map((row) => ({ t: rowTime(row), v: row.max ?? row.mean ?? 0 }))),
          )
          .catch(() => setSpark([])),
      );
    }
    await Promise.all(jobs);
  };

  // A new config starts over.
  useEffect(() => {
    setTotals({});
    setSpark([]);
    void refresh(true);
  }, [c]);

  // Energy ticks: refresh the totals, at most once a minute.
  const energyState = energy ? hass.states[energy] : undefined;
  useEffect(() => {
    void refresh(false);
  }, [energyState]);

  useInterval(() => void refresh(true), REFRESH_MS);

  /* --------------------------------------------------------- actions */

  const toggle = (e: Event): void => {
    e.stopPropagation();
    const st = hass.states[c.entity];
    if (!st || st.state === "unavailable") {
      return;
    }
    setOptimistic(st.state === "on" ? "off" : "on");
    void hass
      .callService("homeassistant", "toggle", { entity_id: st.entity_id })
      .finally(() => setTimeout(() => setOptimistic(null), 1500));
  };

  /* ---------------------------------------------------------- render */

  const st = hass.states[c.entity];
  const state = optimistic || st?.state;
  const on = state === "on";
  const unavailable = !st || state === "unavailable" || state === "unknown";

  const name = c.name || (st?.attributes?.friendly_name as string | undefined) || c.entity;
  const sub = st
    ? [entityAreaName(hass, c.entity), unavailable ? "Unavailable" : on ? "On" : "Off"]
        .filter(Boolean)
        .join(" · ")
    : "Entity not found";

  const watts = numericState(hass, power);
  const p = fmtPower(watts);
  const paths = sparkPaths(spark, watts);
  const cost = (kwh: number | null | undefined) =>
    fmtCost(kwh, c.price, hass.locale?.language, hass.config?.currency);
  const stateObj = st && optimistic ? { ...st, state: optimistic } : st;

  return (
    <ha-card class={unavailable ? "unavailable" : on ? "on" : "off"}>
      <div class="top">
        <button class="icon-btn" aria-label="Toggle" onClick={toggle}>
          {c.icon ? (
            <ha-icon icon={c.icon} />
          ) : (
            // Home Assistant's own icon for this entity, which follows on/off.
            <ha-state-icon ref={haProps({ hass, stateObj })} />
          )}
        </button>
        <div
          class="info"
          role="button"
          tabIndex={0}
          onClick={() => fireMoreInfo(host, c.entity)}
          onKeyDown={onKey}
        >
          <div class="name">{name}</div>
          <div class="sub">{sub}</div>
        </div>
        <button
          class={`switch ${on ? "on" : ""}`}
          role="switch"
          aria-label="Toggle"
          aria-checked={on}
          disabled={unavailable}
          onClick={toggle}
        >
          <span />
        </button>
      </div>

      <div
        class={`mid ${watts != null && watts >= 1 ? "drawing" : ""}`}
        role="button"
        tabIndex={0}
        title="Power history"
        onClick={() => fireMoreInfo(host, power || c.entity)}
        onKeyDown={onKey}
      >
        <div class="power">
          <span class="num">{power ? p.num : ""}</span>
          <span class="unit">{power ? p.unit : "No power sensor"}</span>
        </div>
        <svg class="spark" viewBox="0 0 200 40" preserveAspectRatio="none" aria-hidden="true">
          <defs>
            <linearGradient id="g" x1="0" y1="0" x2="0" y2="1">
              <stop offset="0" stop-color="currentColor" stop-opacity=".35" />
              <stop offset="1" stop-color="currentColor" stop-opacity="0" />
            </linearGradient>
          </defs>
          <path fill="url(#g)" d={paths.area} />
          <path
            fill="none"
            stroke="currentColor"
            stroke-width="1.5"
            vector-effect="non-scaling-stroke"
            d={paths.line}
          />
        </svg>
      </div>

      <div
        class="stats"
        role="button"
        tabIndex={0}
        title="Energy history"
        hidden={!energy}
        onClick={() => fireMoreInfo(host, energy || c.entity)}
        onKeyDown={onKey}
      >
        <div>
          <span class="lbl">Today</span>
          <span class="v">
            {fmtEnergy(totals.today)}
            {cost(totals.today)}
          </span>
        </div>
        <div>
          <span class="lbl">Yesterday</span>
          <span class="v">
            {fmtEnergy(totals.yesterday)}
            {cost(totals.yesterday)}
          </span>
        </div>
        <div>
          <span class="lbl">This month</span>
          <span class="v">
            {fmtEnergy(totals.month)}
            {cost(totals.month)}
          </span>
        </div>
      </div>
    </ha-card>
  );
};

export const SmartPlugCardElement = createCardElement(SmartPlugCard, {
  styles: [baseCss, switchCss, cardCss],
  config: (config: SmartPlugCardConfig): SmartPlugCardConfig => {
    if (!config?.entity) {
      throw new Error("Set 'entity' to a switch or light");
    }
    return config;
  },
  watch: (c, hass) => {
    const { power, energy } = sensorsFor(c, hass);
    return [c.entity, power, energy];
  },
  cardSize: 3,
  gridOptions: { columns: 12, rows: 3, min_columns: 6, min_rows: 3 },
  editor: "smart-plug-card-editor",
  stubConfig: (hass) => {
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
  },
});

export type SmartPlugCardElement = InstanceType<typeof SmartPlugCardElement>;
