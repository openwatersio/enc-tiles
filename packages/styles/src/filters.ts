import { ExpressionFilterSpecification } from "maplibre-gl";

/**
 * Helper for constructing `all` expressions.
 * @see https://maplibre.org/maplibre-style-spec/expressions/#all
 */
export function all(
  ...filters: ExpressionFilterSpecification[]
): ExpressionFilterSpecification {
  // Remove undefined/null
  filters = filters.filter(Boolean);

  if (filters.length === 0) return true;
  if (filters.length === 1 && filters[0]) return filters[0];
  return ["all", ...filters];
}

// Earth's circumference in meters
const C = 2 * Math.PI * 6378137;

export function scaleFilter({
  tilesize = 512,
} = {}): ExpressionFilterSpecification {
  const K = Math.round(C / (tilesize * 0.00028)); // Scale denominator constant

  return [
    "all",
    [
      "any",
      ["!", ["has", "SCAMIN"]],
      [">=", ["zoom"], ["log2", ["/", K, ["get", "SCAMIN"]]]],
    ],
    [
      "any",
      ["!", ["has", "SCAMAX"]],
      ["<=", ["zoom"], ["log2", ["/", K, ["get", "SCAMAX"]]]],
    ],
  ];
}

/**
 * Convert a comma-separated attribute value from the S-52 lookup table (e.g. "3,4,3")
 * to the JSON array string stored in tiles (e.g. '["3","4","3"]').
 *
 * S-57 list-type attributes (COLOUR, RESTRN, CATLIT, etc.) are stored in vector tiles
 * as JSON array strings because the MVT protobuf format only supports scalar values.
 * The tile generation pipeline (ogr2ogr → GeoJSON → tippecanoe) serializes native JSON
 * arrays to these strings automatically.
 */
export function attvToJsonString(attv: string): string {
  const values = attv.split(",");
  return JSON.stringify(values);
}

/**
 * S-57 attributes defined as list types (StringList) in the S-57 Object Catalogue.
 * These are stored as JSON array strings in tiles regardless of how many values
 * they contain (e.g. COLOUR with a single value "3" becomes '["3"]' in the tile).
 */
const LIST_ATTRS = new Set([
  "CATBRG",
  "CATHAF",
  "CATDPG",
  "CATLIT",
  "CATLMK",
  "CATLND",
  "CATOFP",
  "CATPIP",
  "CATREA",
  "CATSPM",
  "CATVEG",
  "COLOUR",
  "COLPAT",
  "FUNCTN",
  "LITVIS",
  "NATCON",
  "NATQUA",
  "NATSUR",
  "PRODCT",
  "QUASOU",
  "RESTRN",
  "STATUS",
  "TECSOU",
]);

export function attributeFilters(
  conditions: { attl: string; attv?: string }[],
): ExpressionFilterSpecification[] {
  if (conditions.length === 0) return [];
  const filters: ExpressionFilterSpecification[] = conditions.map((c) => {
    if (c.attv === "?") {
      return ["!", ["has", c.attl]];
    } else if (c.attv) {
      // List-type attributes are stored as JSON array strings in tiles.
      // Convert lookup values to match the JSON encoding.
      const value =
        LIST_ATTRS.has(c.attl) || c.attv.includes(",")
          ? attvToJsonString(c.attv)
          : c.attv;
      return ["==", ["get", c.attl], value];
    } else {
      return ["has", c.attl];
    }
  });

  return filters;
}

/**
 * Test whether a list-type attribute contains any of the given values.
 *
 * In tiles, list attributes are stored as JSON array strings (e.g. '["7","8","14"]').
 * This uses MapLibre's `in` expression for substring matching, leveraging the JSON
 * quotes as natural delimiters to prevent false positives (e.g. searching for `"7"`
 * won't match `"17"`).
 *
 * @example
 *   // Does 'RESTRN' include 7, 8, or 14?
 *   listIncludes("RESTRN", "7", "8", "14")
 *   // → ["any", ["in", "\"7\"", ["get", "RESTRN"]], ["in", "\"8\"", ...], ...]
 */
export function listIncludes(
  attr: string,
  ...values: string[]
): ExpressionFilterSpecification {
  const conditions = values.map(
    (v) =>
      [
        "in",
        `"${v}"`,
        ["get", attr],
      ] as unknown as ExpressionFilterSpecification,
  );
  if (conditions.length === 1) return conditions[0]!;
  return ["any", ...conditions];
}

/**
 * Test whether a list-type attribute does NOT contain any of the given values.
 */
export function listExcludes(
  attr: string,
  ...values: string[]
): ExpressionFilterSpecification {
  return ["!", listIncludes(attr, ...values)];
}

/**
 * Filter for low quality position (QUAPOS).
 *
 * QUAPOS values 1 (surveyed), 10 (precise), 11 (calculated) indicate good quality.
 * Any other QUAPOS value indicates low quality. Features without QUAPOS are assumed accurate.
 */
export function quaposLowQuality(): ExpressionFilterSpecification {
  return [
    "all",
    ["has", "QUAPOS"],
    ["!", ["in", ["to-number", ["get", "QUAPOS"]], ["literal", [1, 10, 11]]]],
  ];
}
