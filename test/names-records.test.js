/**
 * Fixture runs of bin/names-records.mjs.
 *
 * The script is invoked the way bin/extract-names invokes it -- as a child
 * process over the one GeoJSON the union export wrote -- because that is the
 * whole of its contract. No GDAL: everything here is the grouping, the anchor
 * and the drop rules of plotroom docs/architecture/NAME_INDEX.md sections 2
 * and 4, which are the halves a wrong answer in makes the search box wrong
 * for.
 */
import { spawnSync } from "node:child_process";
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { afterEach, beforeEach, describe, expect, test } from "vitest";

const SCRIPT = fileURLToPath(
  new URL("../bin/names-records.mjs", import.meta.url),
);

let work;

beforeEach(() => {
  work = mkdtempSync(join(tmpdir(), "names-records-"));
});

afterEach(() => {
  rmSync(work, { recursive: true, force: true });
});

/** A square of `size` degrees with its south-west corner at (x, y). */
function square(properties, x = 0, y = 0, size = 0.1) {
  return {
    type: "Feature",
    properties,
    geometry: {
      type: "Polygon",
      coordinates: [
        [
          [x, y],
          [x + size, y],
          [x + size, y + size],
          [x, y + size],
          [x, y],
        ],
      ],
    },
  };
}

function feature(properties, geometry) {
  return { type: "Feature", properties, geometry };
}

function run(features, options = {}) {
  const input = join(work, "named.geojson");
  const output = join(work, "names.json");
  writeFileSync(input, JSON.stringify({ type: "FeatureCollection", features }));

  const args = [SCRIPT, input, output];
  for (const [name, value] of Object.entries({
    cell: "US5WA22M",
    ...options,
  })) {
    if (value !== null) args.push(`--${name}`, String(value));
  }

  const result = spawnSync(process.execPath, args, { encoding: "utf8" });
  expect(result.status, result.stderr).toBe(0);
  return {
    ...JSON.parse(readFileSync(output, "utf8")),
    summary: JSON.parse(result.stderr.trim().split("\n").pop()),
  };
}

describe("one record per name per class", () => {
  test("the fragments of one named area share a record", () => {
    // An island group is one LNDARE per island and every fragment carries the
    // same OBJNAM. Eleven records for Blake Island is the same defect as a
    // chart drawing the name eleven times.
    const { records } = run([
      square({ CLASS: "LNDARE", OBJNAM: "Blake Island" }, 0, 0, 0.1),
      square({ CLASS: "LNDARE", OBJNAM: "Blake Island" }, 0.5, 0, 0.4),
    ]);

    expect(records).toHaveLength(1);
    expect(records[0].n).toBe("Blake Island");
    // Anchored INSIDE the largest fragment, not on the average of the parts,
    // which for an island chain lands in open water.
    expect(records[0].p[0]).toBeGreaterThan(0.5);
    expect(records[0].p[0]).toBeLessThan(0.9);
    expect(records[0].p[1]).toBeGreaterThan(0);
    expect(records[0].p[1]).toBeLessThan(0.4);
    // The bbox is the union over every fragment, so the extent still covers
    // the whole feature the anchor only points into.
    expect(records[0].b).toEqual([0, 0, 0.9, 0.4]);
  });

  test("the same name in two classes stays two records", () => {
    // A landmark and its light are two different answers to one query, and
    // the national reduce (NAME_INDEX.md section 3, dedup B) keeps both.
    const { records } = run([
      square({ CLASS: "LNDMRK", OBJNAM: "Point Wilson" }),
      feature(
        { CLASS: "LIGHTS", OBJNAM: "Point Wilson" },
        { type: "Point", coordinates: [-122.7549, 48.1443] },
      ),
    ]);

    expect(records).toHaveLength(2);
    expect(records.map((record) => record.c).sort()).toEqual([
      "LIGHTS",
      "LNDMRK",
    ]);
  });

  test("an area fragment outranks a point rendering of the same feature", () => {
    const { records } = run([
      feature(
        { CLASS: "CTNARE", OBJNAM: "Rosario Strait" },
        { type: "Point", coordinates: [5, 5] },
      ),
      square({ CLASS: "CTNARE", OBJNAM: "Rosario Strait" }, 0, 0, 0.2),
    ]);

    expect(records).toHaveLength(1);
    expect(records[0].p).toEqual([0.1, 0.1]);
    // Still unioned across both, point rendering included.
    expect(records[0].b).toEqual([0, 0, 5, 5]);
  });

  test("LNAM comes off the fragment the record points at", () => {
    const { records } = run([
      square(
        { CLASS: "LNDARE", OBJNAM: "Blake Island", LNAM: "00AAAA" },
        0,
        0,
        0.1,
      ),
      square(
        { CLASS: "LNDARE", OBJNAM: "Blake Island", LNAM: "00F1A2B3C4D5" },
        0.5,
        0,
        0.4,
      ),
    ]);

    expect(records[0].l).toBe("00F1A2B3C4D5");
  });
});

describe("the representative point", () => {
  test("a line anchors on the midpoint of its longest part", () => {
    const { records } = run([
      feature(
        { CLASS: "DEPCNT", OBJNAM: "Swinomish Channel" },
        {
          type: "MultiLineString",
          coordinates: [
            [
              [0, 0],
              [0, 0.2],
            ],
            [
              [1, 0],
              [1, 1],
              [1, 2],
            ],
          ],
        },
      ),
    ]);

    expect(records[0].p).toEqual([1, 1]);
    expect(records[0].b).toEqual([0, 0, 1, 2]);
  });

  test("a MultiPoint anchors on its first point", () => {
    const { records } = run([
      feature(
        { CLASS: "MORFAC", OBJNAM: "Shilshole Bay Marina" },
        {
          type: "MultiPoint",
          coordinates: [
            [-122.4062, 47.6805],
            [-122.4051, 47.6812],
          ],
        },
      ),
    ]);

    expect(records[0].p).toEqual([-122.4062, 47.6805]);
  });

  test("a point group carries no bbox", () => {
    // Its bbox is its own point: bytes in every shard that say nothing `p`
    // does not already say.
    const { records } = run([
      feature(
        { CLASS: "LIGHTS", OBJNAM: "Point Wilson Light" },
        { type: "Point", coordinates: [-122.7549, 48.1443] },
      ),
    ]);

    expect(records[0]).not.toHaveProperty("b");
  });
});

describe("rounding", () => {
  test("the point keeps five decimals", () => {
    const { records } = run([
      feature(
        { CLASS: "LIGHTS", OBJNAM: "Point Wilson Light" },
        { type: "Point", coordinates: [-122.3608499, 47.6021349] },
      ),
    ]);

    expect(records[0].p).toEqual([-122.36085, 47.60213]);
  });

  test("the bbox keeps four", () => {
    const { records } = run([
      feature(
        { CLASS: "SEAARE", OBJNAM: "Elliott Bay" },
        {
          type: "Polygon",
          coordinates: [
            [
              [-122.401249, 47.580349],
              [-122.318449, 47.580349],
              [-122.318449, 47.629149],
              [-122.401249, 47.629149],
              [-122.401249, 47.580349],
            ],
          ],
        },
      ),
    ]);

    expect(records[0].b).toEqual([-122.4012, 47.5803, -122.3184, 47.6291]);
    expect(records[0].p[0]).toBeCloseTo(-122.35985, 5);
    expect(records[0].p[1]).toBeCloseTo(47.60475, 5);
    for (const value of records[0].p) {
      const decimals = String(value).split(".")[1] ?? "";
      expect(decimals.length).toBeLessThanOrEqual(5);
    }
  });
});

describe("the two names", () => {
  test("NOBJNM stands in when OBJNAM is empty, and does not repeat itself", () => {
    const { records } = run([
      square({ CLASS: "SEAARE", OBJNAM: "", NOBJNM: "Bahia de Ponce" }),
    ]);

    expect(records[0].n).toBe("Bahia de Ponce");
    expect(records[0]).not.toHaveProperty("nn");
  });

  test("a NOBJNM that differs from the name rides along", () => {
    const { records, summary } = run([
      square({
        CLASS: "SEAARE",
        OBJNAM: "Ponce Harbor",
        NOBJNM: "Puerto de Ponce",
      }),
    ]);

    expect(records[0].n).toBe("Ponce Harbor");
    expect(records[0].nn).toBe("Puerto de Ponce");
    expect(summary.nobjnm).toBe(1);
  });
});

describe("the drop rules", () => {
  test("NAME_INDEX.md section 5: 3, #4 and X go, 2A stays", () => {
    const { records, summary } = run([
      square({ CLASS: "BOYLAT", OBJNAM: "3" }),
      square({ CLASS: "BOYLAT", OBJNAM: "#4" }),
      square({ CLASS: "BOYLAT", OBJNAM: "X" }),
      square({ CLASS: "BOYLAT", OBJNAM: "2A" }),
      square({ CLASS: "BOYLAT", OBJNAM: "" }),
      square({ CLASS: "BOYLAT", OBJNAM: "   " }),
    ]);

    expect(records.map((record) => record.n)).toEqual(["2A"]);
    expect(summary.dropped).toEqual({
      // "" and "   " are both no name at all.
      empty: 2,
      // "3" and "#4" normalize to a form with no letter in it.
      numericOnly: 2,
      // "X" normalizes to one character.
      tooShort: 1,
      noGeometry: 0,
    });
  });

  test("an accented name is kept, and emitted as charted", () => {
    // The normalization exists to make the drop decision, not to rewrite the
    // name: the browser shows what the chart shows.
    const { records } = run([
      square({ CLASS: "SEAARE", OBJNAM: "Cañón de Bahía" }),
    ]);

    expect(records[0].n).toBe("Cañón de Bahía");
  });

  test("a feature with no geometry cannot be placed", () => {
    const { records, summary } = run([
      feature({ CLASS: "SEAARE", OBJNAM: "Saratoga Passage" }, null),
    ]);

    expect(records).toEqual([]);
    expect(summary.dropped.noGeometry).toBe(1);
  });
});

describe("the header the reduce reads", () => {
  test("cell, cscale and intu are carried through", () => {
    const result = run([square({ CLASS: "LNDARE", OBJNAM: "Blake Island" })], {
      cscale: 22000,
      intu: 5,
    });

    expect(result.cell).toBe("US5WA22M");
    expect(result.cscale).toBe(22000);
    expect(result.intu).toBe(5);
  });

  test("an unknown band is null and an unknown scale is 0", () => {
    const result = run([square({ CLASS: "LNDARE", OBJNAM: "Blake Island" })], {
      cscale: "",
      intu: "",
    });

    expect(result.intu).toBeNull();
    expect(result.cscale).toBe(0);
  });

  test("a cell with nothing to say writes an empty records array", () => {
    const result = run([]);

    expect(result.records).toEqual([]);
    expect(result.summary).toMatchObject({ features: 0, records: 0 });
  });
});
