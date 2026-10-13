#!/usr/bin/env node

// The records half of bin/extract-names: one GeoJSON of a cell's NAMED
// features in, one <outdir>/names.json out.
//
// Usage:
//   bin/names-records.mjs <named.geojson> <names.json> --cell US5WA22M \
//     [--cscale 22000] [--intu 5]
//
// The contract is plotroom docs/architecture/NAME_INDEX.md section 2, which is
// binding on both sides: the chart pipeline reduces these per-cell files into
// the national shards and the browser reads the shards. The shape written here
// is
//
//   { "cell": "US5WA22M", "cscale": 22000, "intu": 5, "records": [ ... ] }
//
// and one record is
//
//   { "n": name, "nn": NOBJNM, "c": class, "l": LNAM, "p": [lon, lat],
//     "b": [west, south, east, north] }
//
// with "nn" only when NOBJNM differs from the name, "l" only when the driver
// gave one, and "b" only for a group with an area or a line in it. "p" is
// rounded to five decimals (about a metre) and "b" to four (about ten), which
// is all a search facet needs and is what keeps the national shards small.
//
// GROUPING
//
// An S-57 cell splits a named feature across as many polygons as its topology
// needs -- an island group is one LNDARE per island, a bay is several SEAARE
// parts -- and every fragment carries the same OBJNAM. bin/generate-labels
// answers that for the two label classes by grouping the fragments and
// emitting one anchor per group; the name index applies the same rule to EVERY
// named class, because a search result list that repeats "Blake Island" eleven
// times is the same defect as a chart that draws the name eleven times.
//
// The group key is (CLASS, displayed name) within the cell. CLASS is in the
// key on purpose: a landmark and its light are two different answers to the
// same query, and the national reduce (NAME_INDEX.md section 3, dedup B) keeps
// both.
//
// The group is anchored on its LARGEST fragment and its bbox is the union over
// all of them, so the point is guaranteed to sit inside real charted geometry
// while the extent still covers the whole feature.
//
// WHAT IS DROPPED
//
// Three cases, each counted into the stderr summary: an empty name, a name
// whose normalized form carries no letter at all ("3", "#4"), and a name whose
// normalized form is a single character ("X"). "2A" is kept -- it has a letter
// and two characters. The normalization is NAME_INDEX.md section 4 rules 1-5
// and is used HERE ONLY to make that decision: the emitted name is the charted
// one, and the reduce normalizes again for its own shard keys.

import { writeFileSync } from "fs";

import { anchorOf, featureArea } from "./quilt-anchors.mjs";
import { readFeatures } from "./quilt-geojson.mjs";

// ---- arguments -------------------------------------------------------------

const VALUE_OPTIONS = new Set(["--cell", "--cscale", "--intu"]);

const args = process.argv.slice(2);
const positional = [];
const options = { cell: "", cscale: "", intu: "" };

for (let i = 0; i < args.length; i++) {
  const arg = args[i];
  if (VALUE_OPTIONS.has(arg) && i + 1 < args.length) {
    options[arg.slice(2)] = args[++i];
  } else positional.push(arg);
}

const [inputPath, outputPath] = positional;
if (!inputPath || !outputPath || !options.cell) {
  console.error(
    "Usage: names-records.mjs <named.geojson> <names.json> --cell <CELL> [--cscale S] [--intu N]",
  );
  process.exit(1);
}

/** An integer out of a CLI value, or null when there is none. */
function integerOrNull(raw) {
  if (raw === undefined || raw === null || String(raw).trim() === "")
    return null;
  const value = Number(raw);
  if (!Number.isFinite(value)) return null;
  return Math.trunc(value);
}

// cscale 0 rather than null when it is unknown: NAME_INDEX.md section 2 spells
// the shard's compilation scale "0 when unknown" and the reduce reads this
// field straight into it. intu keeps null, because an unknown usage band is
// something the reduce is allowed to see and the extractor only warns about.
const cscale = integerOrNull(options.cscale) ?? 0;
const intu = integerOrNull(options.intu);

// ---- name normalization (NAME_INDEX.md section 4, rules 1-5) ----------------

const APOSTROPHES = /['’`]/g;

/**
 * The normalized form of a name, used here ONLY to decide whether the name is
 * worth indexing. The same five steps in the same order as the pipeline and
 * the browser, because all three have to agree about what "has no letter"
 * means.
 */
function normalizeName(raw) {
  return String(raw)
    .normalize("NFKD")
    .replace(/\p{Mn}/gu, "")
    .replace(APOSTROPHES, "")
    .toLowerCase()
    .replace(/[^a-z0-9]/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

// ---- geometry --------------------------------------------------------------

const RANK_POINT = 0;
const RANK_LINE = 1;
const RANK_AREA = 2;

/** The parts of a line geometry, each an array of positions. */
function lineParts(geometry) {
  if (!geometry) return [];
  if (geometry.type === "LineString") return [geometry.coordinates];
  if (geometry.type === "MultiLineString") return geometry.coordinates;
  return [];
}

/**
 * Vertex-path length of one part, longitude scaled by cos(latitude) so parts
 * rank the same way at every latitude -- the same correction featureArea
 * applies to rings.
 */
function pathLength(part) {
  let total = 0;
  for (let i = 1; i < part.length; i++) {
    const [x0, y0] = part[i - 1];
    const [x1, y1] = part[i];
    const scale = Math.max(Math.cos((((y0 + y1) / 2) * Math.PI) / 180), 0.01);
    total += Math.hypot((x1 - x0) * scale, y1 - y0);
  }
  return total;
}

/** The point half the vertex path along one part. Always ON the part. */
function lineMidpoint(part) {
  if (part.length === 0) return undefined;
  const half = pathLength(part) / 2;
  if (!(half > 0)) return part[0];
  let walked = 0;
  for (let i = 1; i < part.length; i++) {
    const from = part[i - 1];
    const to = part[i];
    const segment = pathLength([from, to]);
    if (walked + segment >= half) {
      const t = segment === 0 ? 0 : (half - walked) / segment;
      return [from[0] + (to[0] - from[0]) * t, from[1] + (to[1] - from[1]) * t];
    }
    walked += segment;
  }
  return part[part.length - 1];
}

/**
 * The representative point of one feature, NAME_INDEX.md section 2: "the point
 * itself, the point-on-surface of the largest polygon part, or the midpoint of
 * the longest line part".
 *
 * Areas and single points are anchorOf's job and are left to it. The two cases
 * spelled out here are the line families, which the anchor generators never
 * needed (they label areas), and MultiPoint, whose FIRST point is the rule --
 * written out rather than inherited so all three of the index's anchor rules
 * read in one place.
 */
function anchorFor(geometry) {
  const parts = lineParts(geometry);
  if (parts.length > 0) {
    let best = parts[0];
    let bestLength = -1;
    for (const part of parts) {
      const length = pathLength(part);
      if (length > bestLength) {
        bestLength = length;
        best = part;
      }
    }
    return lineMidpoint(best);
  }
  if (geometry?.type === "MultiPoint") return geometry.coordinates[0];
  return anchorOf({ geometry });
}

/**
 * How big a fragment is, for picking the one the group is anchored on.
 *
 * Ranked before it is measured: an area beats a line beats a point whatever
 * the numbers say, so a class charted as both an area and its point rendering
 * in one cell anchors on the area. Within a rank the measure is the area in
 * square degrees or the vertex-path length in degrees.
 */
function sizeOf(geometry) {
  const type = geometry?.type;
  if (type === "Polygon" || type === "MultiPolygon")
    return { rank: RANK_AREA, size: featureArea(geometry) };
  const parts = lineParts(geometry);
  if (parts.length > 0) {
    let total = 0;
    for (const part of parts) total += pathLength(part);
    return { rank: RANK_LINE, size: total };
  }
  return { rank: RANK_POINT, size: 0 };
}

/** Every position of a geometry, whatever its nesting. */
function positions(geometry) {
  const depth = {
    Point: 0,
    MultiPoint: 1,
    LineString: 1,
    MultiLineString: 2,
    Polygon: 2,
    MultiPolygon: 3,
  }[geometry?.type];
  if (depth === undefined) return [];
  let level = [geometry.coordinates];
  for (let i = 0; i < depth; i++) level = level.flat();
  return level;
}

/** The bbox grown to cover one more geometry. */
function growBox(box, geometry) {
  let grown = box;
  for (const position of positions(geometry)) {
    const [x, y] = position ?? [];
    if (!Number.isFinite(x) || !Number.isFinite(y)) continue;
    if (!grown) grown = [x, y, x, y];
    else {
      if (x < grown[0]) grown[0] = x;
      if (y < grown[1]) grown[1] = y;
      if (x > grown[2]) grown[2] = x;
      if (y > grown[3]) grown[3] = y;
    }
  }
  return grown;
}

// ---- rounding --------------------------------------------------------------

/** Five decimals on the point (about a metre), four on the bbox (about ten). */
const POINT_DECIMALS = 5;
const BBOX_DECIMALS = 4;

const roundTo = (value, decimals) => Number(value.toFixed(decimals));

// ---- the pass --------------------------------------------------------------

/** A trimmed string out of whatever the GeoJSON writer produced. */
function text(value) {
  if (value === null || value === undefined) return "";
  return String(value).trim();
}

const groups = new Map();
const dropped = { empty: 0, numericOnly: 0, tooShort: 0, noGeometry: 0 };
let featureCount = 0;

for (const feature of readFeatures(inputPath)) {
  featureCount++;
  const properties = feature.properties ?? {};
  const className = text(properties.CLASS);
  const objnam = text(properties.OBJNAM);
  const nobjnm = text(properties.NOBJNM);

  // NAME_INDEX.md section 2: OBJNAM as charted, NOBJNM when OBJNAM is empty.
  const name = objnam || nobjnm;
  if (!name) {
    dropped.empty++;
    continue;
  }
  const normalized = normalizeName(name);
  if (!/[a-z]/.test(normalized)) {
    dropped.numericOnly++;
    continue;
  }
  if (normalized.length === 1) {
    dropped.tooShort++;
    continue;
  }

  const id = `${className} ${name}`;
  let group = groups.get(id);
  if (!group) {
    group = {
      name,
      className,
      nobjnm: "",
      lnam: "",
      box: null,
      extended: false,
      best: { rank: -1, size: -1, anchor: undefined },
    };
    groups.set(id, group);
  }

  const { rank, size } = sizeOf(feature.geometry);
  group.box = growBox(group.box, feature.geometry);
  if (rank !== RANK_POINT) group.extended = true;

  if (
    rank > group.best.rank ||
    (rank === group.best.rank && size > group.best.size)
  ) {
    const anchor = anchorFor(feature.geometry);
    if (anchor) {
      group.best = { rank, size, anchor };
      // Read off the anchoring fragment, the way bin/generate-labels keeps the
      // largest member's CLASS: LNAM identifies ONE feature, and the one the
      // record points at is the one it should name.
      group.lnam = text(properties.LNAM);
      group.nobjnm = nobjnm && nobjnm !== name ? nobjnm : "";
    }
  }
}

const records = [];
const classes = new Set();
let withNobjnm = 0;

for (const group of groups.values()) {
  if (!group.best.anchor) {
    dropped.noGeometry++;
    continue;
  }
  const record = { n: group.name };
  if (group.nobjnm) {
    record.nn = group.nobjnm;
    withNobjnm++;
  }
  record.c = group.className;
  if (group.lnam) record.l = group.lnam;
  record.p = [
    roundTo(group.best.anchor[0], POINT_DECIMALS),
    roundTo(group.best.anchor[1], POINT_DECIMALS),
  ];
  // Areas and lines only: a point's bbox is its own point, which costs bytes
  // in every shard and tells the reader nothing that is not already in `p`.
  if (group.extended && group.box) {
    record.b = group.box.map((value) => roundTo(value, BBOX_DECIMALS));
  }
  records.push(record);
  classes.add(group.className);
}

try {
  writeFileSync(
    outputPath,
    JSON.stringify({ cell: options.cell, cscale, intu, records }),
  );
} catch (error) {
  console.error(
    `names-records: could not write ${outputPath}: ${error.message}`,
  );
  process.exit(1);
}

// The summary bin/extract-names logs and the pipeline folds into the build's
// own counts. One line of JSON on stderr, never stdout: stdout stays free for
// a future caller that wants the records on a pipe.
console.error(
  JSON.stringify({
    cell: options.cell,
    features: featureCount,
    classes: classes.size,
    records: records.length,
    nobjnm: withNobjnm,
    dropped,
  }),
);
