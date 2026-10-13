/**
 * Fixture runs of bin/extract-names against stub GDAL binaries.
 *
 * What is under test is the SWEEP: which of a cell's tables the name index
 * reads, what the single union export asks them for, and that the whole read
 * is one GeoPackage import and one GeoJSON export however many classes the
 * cell carries. A class quietly dropped here is a name nobody can ever search
 * for, and a second import per class is twenty minutes added to every national
 * build.
 *
 * The stub knobs are documented in test/fixtures/gdal-stub/ogrinfo and, for
 * the per-table column answers this script needs, in
 * test/fixtures/gdal-stub-names/ogrinfo.
 */
import { spawnSync } from "node:child_process";
import {
  chmodSync,
  copyFileSync,
  existsSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  readdirSync,
  rmSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { afterEach, beforeEach, describe, expect, test } from "vitest";

const SCRIPT = fileURLToPath(new URL("../bin/extract-names", import.meta.url));
const SHARED_STUB = fileURLToPath(
  new URL("./fixtures/gdal-stub", import.meta.url),
);
const NAMES_STUB = fileURLToPath(
  new URL("./fixtures/gdal-stub-names", import.meta.url),
);

/** A cell carrying one table of each shape the union has to handle. */
const TABLES =
  "LNDARE SEAARE LIGHTS DSID M_COVR M_QUAL SOUNDG C_AGGR $AREAS _LABELS";

/** LNDARE has both names, SEAARE only NOBJNM, LIGHTS only OBJNAM. */
const TABLE_COLUMNS =
  "LNDARE=OBJNAM NOBJNM LNAM;SEAARE=NOBJNM LNAM;LIGHTS=OBJNAM LNAM";

let work;
let stubDir;
let runs;

beforeEach(() => {
  work = mkdtempSync(join(tmpdir(), "extract-names-"));
  runs = 0;
  stubDir = join(work, "stub");
  mkdirSync(stubDir);
  // Only the two GDAL binaries. The shared fixture's `node` stub swallows its
  // argv, and the records pass IS node — stubbing it would leave every run
  // with no names.json and nothing to assert about.
  copyFileSync(join(SHARED_STUB, "ogr2ogr"), join(stubDir, "ogr2ogr"));
  copyFileSync(join(SHARED_STUB, "ogrinfo"), join(stubDir, "ogrinfo-gdal"));
  copyFileSync(join(NAMES_STUB, "ogrinfo"), join(stubDir, "ogrinfo"));
  for (const name of readdirSync(stubDir)) {
    chmodSync(join(stubDir, name), 0o755);
  }
});

afterEach(() => {
  rmSync(work, { recursive: true, force: true });
});

function run(env = {}, { cell = "US5WA22M", extraArgs = [] } = {}) {
  const input = join(work, `${cell}.000`);
  const outdir = join(work, "names");
  const sqlLog = join(work, `sql-${runs++}.log`);
  writeFileSync(input, "");

  const result = spawnSync("bash", [SCRIPT, input, outdir, ...extraArgs], {
    encoding: "utf8",
    env: {
      ...process.env,
      PATH: `${stubDir}:${process.env.PATH}`,
      STUB_SQL_LOG: sqlLog,
      STUB_TABLES: TABLES,
      STUB_TABLE_COLUMNS: TABLE_COLUMNS,
      ...env,
    },
  });

  const namesPath = join(outdir, "names.json");
  return {
    status: result.status,
    stdout: result.stdout ?? "",
    stderr: result.stderr ?? "",
    outdir,
    sql: existsSync(sqlLog) ? readFileSync(sqlLog, "utf8") : "",
    names: existsSync(namesPath)
      ? JSON.parse(readFileSync(namesPath, "utf8"))
      : undefined,
  };
}

const occurrences = (haystack, needle) => haystack.split(needle).length - 1;

describe("which classes the sweep reads", () => {
  test("every table that carries a name, and nothing else", () => {
    const { status, sql } = run();

    expect(status).toBe(0);
    expect(sql).toContain(
      "SELECT 'LNDARE' AS CLASS, OBJNAM, NOBJNM, LNAM, geom FROM \"LNDARE\"",
    );
    expect(sql).toContain(
      "SELECT 'SEAARE' AS CLASS, NULL AS OBJNAM, NOBJNM, LNAM, geom FROM \"SEAARE\"",
    );
    expect(sql).toContain(
      "SELECT 'LIGHTS' AS CLASS, OBJNAM, NULL AS NOBJNM, LNAM, geom FROM \"LIGHTS\"",
    );
    // One export, so the arms are unioned rather than run one at a time.
    expect(occurrences(sql, "UNION ALL")).toBe(2);
  });

  test("a table that lacks NOBJNM selects a NULL of the right name", () => {
    // Every arm of a UNION needs the same column list, and the reader must be
    // able to treat a class that cannot carry a national name and one that
    // simply has none identically.
    const { sql } = run();

    expect(sql).toContain("NULL AS NOBJNM");
    expect(sql).toContain("NULL AS OBJNAM");
  });

  test("the meta, collection, primitive and derived tables are excluded", () => {
    const { sql, status } = run();

    expect(status).toBe(0);
    for (const table of [
      "M_COVR",
      "M_QUAL",
      "DSID",
      "SOUNDG",
      "$AREAS",
      "_LABELS",
      "C_AGGR",
    ]) {
      expect(sql).not.toContain(table);
    }
  });

  test("a table with neither name column is skipped", () => {
    // BOYSPP carries no OBJNAM at all in this cell: nothing to index, and no
    // arm in the union asking for a column that is not there.
    const { sql, status } = run({
      STUB_TABLES: "LNDARE BOYSPP",
      STUB_TABLE_COLUMNS: "LNDARE=OBJNAM LNAM;BOYSPP=CATSPM COLOUR",
    });

    expect(status).toBe(0);
    expect(sql).toContain('FROM "LNDARE"');
    expect(sql).not.toContain('BOYSPP" WHERE');
    expect(sql).not.toContain("UNION ALL");
  });

  test("only rows with a name are asked for", () => {
    const { sql } = run();

    expect(sql).toContain(
      "(OBJNAM IS NOT NULL AND OBJNAM <> '') OR (NOBJNM IS NOT NULL AND NOBJNM <> '')",
    );
  });
});

describe("the shape of the read", () => {
  test("exactly one GeoPackage import, of the .000 itself", () => {
    const { sql, status } = run();

    expect(status).toBe(0);
    expect(occurrences(sql, "-f GPKG")).toBe(1);
    const gpkgLine = sql.split("\n").find((line) => line.includes("-f GPKG"));
    expect(gpkgLine).toContain("US5WA22M.000");
    // The same tolerant import bin/s57-to-tiles makes: one untranslatable
    // feature must not cost the cell its whole name list.
    expect(gpkgLine).toContain("-skipfailures");
  });

  test("exactly one GeoJSON export, through the SQLite dialect", () => {
    const { sql, status } = run();

    expect(status).toBe(0);
    expect(occurrences(sql, "-f GeoJSON")).toBe(1);
    expect(sql).toContain("-dialect sqlite");
    // The union spans areas, lines and points: the target layer has to accept
    // all three rather than take its type from whichever arm came first.
    expect(sql).toContain("-nlt GEOMETRY");
  });

  test("no quilt clip: no --coverage, no mask, no geometry difference", () => {
    // The index is a search facet, not navigational data. Clipping it would
    // delete names from a coarse cell that the finer cell may not carry.
    const { sql, status } = run();

    expect(status).toBe(0);
    expect(sql).not.toContain("ST_Difference");
    expect(sql).not.toContain("quilt_mask");
    expect(sql).not.toContain("QFLOOR");
  });

  test("--coverage is not an argument this script takes", () => {
    const coverage = join(work, "coverage.gpkg");
    writeFileSync(coverage, "");
    const result = run({}, { extraArgs: ["--coverage", coverage] });

    expect(result.status).toBe(1);
    expect(result.stdout).toContain("Unknown argument: --coverage");
    expect(result.names).toBeUndefined();
  });

  test("--tmpdir puts the scratch elsewhere and still cleans up", () => {
    const scratch = join(work, "scratch");
    const result = run({}, { extraArgs: ["--tmpdir", scratch] });

    expect(result.status).toBe(0);
    expect(result.names.records).toEqual([]);
    expect(readdirSync(scratch)).toEqual([]);
  });
});

describe("an UNREADABLE chart is refused, never read as nameless", () => {
  test("an ogrinfo failure on the layer listing exits 1", () => {
    const result = run({ STUB_LIST_FAILS: "1" });

    expect(result.status).toBe(1);
    expect(result.names).toBeUndefined();
    expect(result.stderr).toContain("could not read the chart");
    // GDAL's own diagnosis is passed through, not swallowed.
    expect(result.stderr).toContain("not recognized");
  });

  test("a chart with zero layers exits 1 (corrupt, not nameless)", () => {
    const result = run({ STUB_TABLES: " " });

    expect(result.status).toBe(1);
    expect(result.names).toBeUndefined();
    expect(result.stderr).toContain("no readable layers");
  });
});

describe("the dataset header", () => {
  test("cscale and intu ride onto the records", () => {
    const { names } = run({ STUB_CSCALE: "22000", STUB_INTU: "5" });

    expect(names.cell).toBe("US5WA22M");
    expect(names.cscale).toBe(22000);
    expect(names.intu).toBe(5);
  });

  test("no DSPM_CSCL falls back to the band's coarser standard rung", () => {
    const { names } = run({ STUB_CSCALE: "none", STUB_INTU: "5" });

    expect(names.cscale).toBe(22000);
  });

  test("an unknown INTU is a warning, not a refusal", () => {
    // bin/extract-analysis REFUSES this chart, because the tiler refuses it
    // and safety geometry must not disagree with the tiles. The index makes
    // the other trade: a missing usage band costs one sort key, and dropping
    // the cell's names to protect it is the worse outcome.
    const result = run({ STUB_INTU: "9" });

    expect(result.status).toBe(0);
    expect(result.stderr).toContain("unknown INTU");
    expect(result.names.intu).toBeNull();
  });

  test("a chart with no readable INTU at all still indexes", () => {
    const result = run({ STUB_INTU: "", STUB_CSCALE: "none" });

    expect(result.status).toBe(0);
    expect(result.names.intu).toBeNull();
    // Nothing to derive a compilation scale from either: 0, which is what the
    // shard's cscale field carries for "unknown".
    expect(result.names.cscale).toBe(0);
  });

  test("a chart with no DSID_DSNM is keyed by its file name", () => {
    const result = run({ STUB_DSNM: "none" }, { cell: "US3WA01M" });

    expect(result.status).toBe(0);
    expect(result.names.cell).toBe("US3WA01M");
  });
});

describe("a cell with nothing to index", () => {
  test("no named class at all exits 0 with an empty records array", () => {
    const result = run({ STUB_TABLES: "M_COVR SOUNDG" });

    expect(result.status).toBe(0);
    expect(result.names).toEqual({
      cell: "US5WA22M",
      cscale: 12000,
      intu: 5,
      records: [],
    });
    // Nothing to export, so nothing is exported.
    expect(result.sql).not.toContain("-f GeoJSON");
  });
});

describe("the log line", () => {
  test("reports the cell, the records and the classes", () => {
    const { stderr, status } = run();

    expect(status).toBe(0);
    expect(stderr).toMatch(
      /^names: US5WA22M \d+ record\(s\) from \d+ class\(es\) in \d+s\.$/m,
    );
  });

  test("the records pass reports its drop counts as JSON", () => {
    const { stderr } = run();

    const summary = stderr
      .split("\n")
      .map((line) => {
        try {
          return JSON.parse(line);
        } catch {
          return null;
        }
      })
      .find((value) => value && value.dropped);

    expect(summary).toMatchObject({
      cell: "US5WA22M",
      dropped: { empty: 0, numericOnly: 0, tooShort: 0 },
    });
  });
});
