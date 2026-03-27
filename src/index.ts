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
import createStyle from "@enc-tiles/styles";
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

const modes: Mode[] = ["DAY", "DUSK", "NIGHT"];

function getStyle(mode: Mode) {
  return createStyle({
    mode,
    sprite: `${window.location.origin}/sprites`,
    source: {
      type: "vector",
      url: `pmtiles://${url}`,
    },
  });
}

const map = new Map({
  container: "map",
  hash: true, // Enable hash routing
  zoom: header.maxZoom,
  center: [header.centerLon, header.centerLat],
  style: getStyle("DAY"),
});

map.addControl(new NavigationControl({ showZoom: true, showCompass: false }));
map.addControl(new FullscreenControl());
map.addControl(new MaplibreInspect({ popup: new Popup({}) }));

// Theme toggle
const toggle = document.createElement("div");
toggle.style.cssText =
  "position:absolute;top:10px;left:10px;z-index:1;display:flex;gap:4px;";
modes.forEach((mode) => {
  const btn = document.createElement("button");
  btn.textContent = mode;
  btn.style.cssText =
    "padding:4px 10px;border:1px solid #ccc;border-radius:4px;cursor:pointer;font-size:13px;background:#fff;";
  btn.addEventListener("click", () => {
    map.setStyle(getStyle(mode));
  });
  toggle.appendChild(btn);
});
document.body.appendChild(toggle);
