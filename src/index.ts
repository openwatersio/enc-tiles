import "@maplibre/maplibre-gl-inspect/dist/maplibre-gl-inspect.css";
import "maplibre-gl/dist/maplibre-gl.css";
import {
  addProtocol,
  Map,
  NavigationControl,
  FullscreenControl,
  Popup,
} from "maplibre-gl";
import MaplibreInspect from "@maplibre/maplibre-gl-inspect";
import { Protocol, PMTiles } from "pmtiles";
import createStyle, {
  BoundaryType,
  SymbolType,
  type DisplayCategory,
  type TextGroup,
} from "@enc-tiles/styles";
import type { Mode } from "@enc-tiles/s52";

const tileset = import.meta.env.VITE_TILESET;
const tilesUrl =
  import.meta.env.VITE_TILES_URL ?? window.location.origin + "/tiles/";

// add the PMTiles plugin to the maplibre-gl global.
const protocol = new Protocol({ metadata: true });
addProtocol("pmtiles", protocol.tile);
const url = new URL(tileset, tilesUrl).toString();
const pmtiles = new PMTiles(url);
protocol.add(pmtiles);

// Fetch the header so we can get the center lon, lat of the map.
const header = await pmtiles.getHeader();

// --- State ---
let currentMode: Mode = "DAY";
let currentBoundaries: BoundaryType = BoundaryType.PLAIN;
let currentSymbols: SymbolType = SymbolType.PAPER;
let shallowContour = 2.0;
let safetyContour = 30.0;
let deepContour = 30.0;
let safetyDepth = 30.0;
const displayCategories = new Set<DisplayCategory>(["DISPLAYBASE", "STANDARD"]);
const textGroups = new Set<TextGroup>(["important", "other"]);

function getStyle() {
  return createStyle({
    mode: currentMode,
    boundaries: currentBoundaries,
    symbols: currentSymbols,
    shallowContour,
    safetyContour,
    deepContour,
    safetyDepth,
    displayCategories,
    textGroups,
    sprite: `${window.location.origin}/sprites`,
    source: {
      type: "vector",
      url: `pmtiles://${url}`,
    },
  });
}

const map = new Map({
  container: "map",
  hash: true,
  zoom: header.maxZoom,
  center: [header.centerLon, header.centerLat],
  style: getStyle(),
});

map.addControl(new NavigationControl({ showZoom: true, showCompass: false }));
map.addControl(new FullscreenControl());
map.addControl(new MaplibreInspect({ popup: new Popup({}) }));

// --- Control panel ---
const panel = document.createElement("div");
panel.style.cssText =
  "position:absolute;top:10px;left:10px;z-index:1;background:rgba(255,255,255,0.92);border-radius:6px;padding:8px 10px;font-family:system-ui;font-size:13px;display:flex;flex-direction:column;gap:6px;box-shadow:0 1px 4px rgba(0,0,0,0.15);";

function addButtonGroup(
  label: string,
  options: { text: string; active: () => boolean; onClick: () => void }[],
) {
  const row = document.createElement("div");
  row.style.cssText = "display:flex;align-items:center;gap:4px;";
  const lbl = document.createElement("span");
  lbl.textContent = label;
  lbl.style.cssText = "width:75px;font-weight:500;";
  row.appendChild(lbl);

  const buttons: HTMLButtonElement[] = [];
  for (const opt of options) {
    const btn = document.createElement("button");
    btn.textContent = opt.text;
    btn.style.cssText =
      "padding:2px 8px;border:1px solid #ccc;border-radius:3px;cursor:pointer;font-size:12px;";
    btn.addEventListener("click", () => {
      opt.onClick();
      updateButtons();
    });
    buttons.push(btn);
    row.appendChild(btn);
  }

  function updateButtons() {
    for (let i = 0; i < options.length; i++) {
      const active = options[i]!.active();
      buttons[i]!.style.background = active ? "#0066cc" : "#fff";
      buttons[i]!.style.color = active ? "#fff" : "#333";
    }
  }
  updateButtons();
  panel.appendChild(row);
}

function addCheckbox(
  label: string,
  checked: () => boolean,
  onChange: (v: boolean) => void,
) {
  const row = document.createElement("label");
  row.style.cssText = "display:flex;align-items:center;gap:4px;cursor:pointer;";
  const cb = document.createElement("input");
  cb.type = "checkbox";
  cb.checked = checked();
  cb.addEventListener("change", () => onChange(cb.checked));
  row.appendChild(cb);
  row.appendChild(document.createTextNode(label));
  panel.appendChild(row);
}

function addNumberInput(
  label: string,
  value: () => number,
  onChange: (v: number) => void,
) {
  const row = document.createElement("div");
  row.style.cssText = "display:flex;align-items:center;gap:4px;";
  const lbl = document.createElement("span");
  lbl.textContent = label;
  lbl.style.cssText = "width:75px;font-weight:500;";
  const input = document.createElement("input");
  input.type = "number";
  input.value = String(value());
  input.step = "1";
  input.min = "0";
  input.style.cssText =
    "width:60px;padding:2px 4px;border:1px solid #ccc;border-radius:3px;font-size:12px;";
  const unit = document.createElement("span");
  unit.textContent = "m";
  unit.style.cssText = "font-size:11px;color:#666;";
  input.addEventListener("change", () => {
    const v = parseFloat(input.value);
    if (!isNaN(v) && v >= 0) onChange(v);
  });
  row.appendChild(lbl);
  row.appendChild(input);
  row.appendChild(unit);
  panel.appendChild(row);
}

function applyStyle() {
  map.setStyle(getStyle());
}

// Theme
addButtonGroup(
  "Theme",
  (["DAY", "DUSK", "NIGHT"] as Mode[]).map((mode) => ({
    text: mode,
    active: () => currentMode === mode,
    onClick: () => {
      currentMode = mode;
      applyStyle();
    },
  })),
);

// Symbols
addButtonGroup("Symbols", [
  {
    text: "Paper",
    active: () => currentSymbols === SymbolType.PAPER,
    onClick: () => {
      currentSymbols = SymbolType.PAPER;
      applyStyle();
    },
  },
  {
    text: "Simplified",
    active: () => currentSymbols === SymbolType.SIMPLIFIED,
    onClick: () => {
      currentSymbols = SymbolType.SIMPLIFIED;
      applyStyle();
    },
  },
]);

// Boundaries
addButtonGroup("Bounds", [
  {
    text: "Plain",
    active: () => currentBoundaries === BoundaryType.PLAIN,
    onClick: () => {
      currentBoundaries = BoundaryType.PLAIN;
      applyStyle();
    },
  },
  {
    text: "Symbolized",
    active: () => currentBoundaries === BoundaryType.SYMBOLIZED,
    onClick: () => {
      currentBoundaries = BoundaryType.SYMBOLIZED;
      applyStyle();
    },
  },
]);

// Display categories
function toggleCategory(cat: DisplayCategory, on: boolean) {
  if (on) displayCategories.add(cat);
  else displayCategories.delete(cat);
  applyStyle();
}

addCheckbox(
  "Display Base",
  () => displayCategories.has("DISPLAYBASE"),
  (v) => toggleCategory("DISPLAYBASE", v),
);
addCheckbox(
  "Standard",
  () => displayCategories.has("STANDARD"),
  (v) => toggleCategory("STANDARD", v),
);
addCheckbox(
  "Other",
  () => displayCategories.has("OTHER"),
  (v) => toggleCategory("OTHER", v),
);

// Text groups
addCheckbox(
  "Important Text",
  () => textGroups.has("important"),
  (v) => {
    if (v) textGroups.add("important");
    else textGroups.delete("important");
    applyStyle();
  },
);
addCheckbox(
  "Other Text",
  () => textGroups.has("other"),
  (v) => {
    if (v) textGroups.add("other");
    else textGroups.delete("other");
    applyStyle();
  },
);

// Depth settings
addNumberInput(
  "Shallow Contour",
  () => shallowContour,
  (v) => {
    shallowContour = v;
    applyStyle();
  },
);
addNumberInput(
  "Safety Contour",
  () => safetyContour,
  (v) => {
    safetyContour = v;
    applyStyle();
  },
);
addNumberInput(
  "Deep Contour",
  () => deepContour,
  (v) => {
    deepContour = v;
    applyStyle();
  },
);
addNumberInput(
  "Safety Depth",
  () => safetyDepth,
  (v) => {
    safetyDepth = v;
    applyStyle();
  },
);

document.body.appendChild(panel);
