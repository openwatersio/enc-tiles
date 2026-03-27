import {
  ExpressionFilterSpecification,
  ExpressionSpecification,
  LayerSpecification,
} from "maplibre-gl";
import { Reference } from "./parser.js";
import { colour } from "@enc-tiles/s52";
import { LineStyles } from "./SHOWLINE.js";
import { listContains, listIncludes, quaposLowQuality } from "../filters.js";
import type { LayerConfig } from "../symbolology/index.js";

const procs = {
  DEPARE03,
  DEPCNT03,
  LIGHTS06,
  OBSTRN07,
  QUAPOS01,
  RESARE04,
  RESTRN01,
  SLCONS04,
  SOUNDG03,
  TOPMAR01,
  WRECKS05,
};

export function CS(config: LayerConfig, ref: Reference) {
  if (ref.name in procs) {
    return procs[ref.name](config);
  } else {
    console.warn(`CS(${ref.name}) not implemented yet`);
  }
}

/** DEPARE03 - 13.2.1 Depth area colour fill and dredged area pattern fill */
export function DEPARE03(config: LayerConfig): Partial<LayerSpecification>[] {
  return [
    {
      type: "fill",
      paint: {
        "fill-color": [
          "let",
          "drval1",
          ["coalesce", ["get", "DRVAL1"], -1],
          [
            "let",
            "drval2",
            ["coalesce", ["get", "DRVAL2"], ["+", ["var", "drval1"], 0.01]],
            SEABED01(config),
          ],
        ],
        // TODO: shallow pattern
        // 'fill-pattern': DIAMOND1
      },
    },
  ];
}

/** DEPCNT03 - 13.2.2 Depth contours, including safety contour */
export function DEPCNT03(config: LayerConfig): Partial<LayerSpecification>[] {
  // MapLibre doesn't support data expressions in `line-dasharray`, so split into two layers with filters.
  const lowQuality = quaposLowQuality();
  const depcn = colour(config.mode, "DEPCN");
  return [
    {
      type: "line",
      filter: lowQuality,
      paint: {
        "line-dasharray": LineStyles.DASH,
        "line-width": 1,
        "line-color": depcn,
      },
    },
    {
      type: "line",
      filter: ["!", lowQuality],
      paint: {
        "line-width": 1,
        "line-color": depcn,
      },
    },
    {
      type: "symbol",
    },
    // TODO: add user pref to display contour labels
    ...SAFECON01(config),
  ];
}

/** TODO: DEPVAL02 - 13.2.3 Depth value */
/**
 * LIGHTS06 - 13.2.4 Light flares, light sectors & light coverage
 * (S-52 PresLib 4.0, section 13.2.4)
 *
 * Applies to S-57 object class LIGHTS (point only).
 * Attributes: COLOUR (list), CATLIT (list), SECTR1, SECTR2, ORIENT,
 *             VALNMR, LITCHR, LITVIS, SIGGRP, SIGPER, HEIGHT, STATUS
 *
 * This is the most complex CSP. This implementation covers:
 *   - Floodlights/spotlights (CATLIT 8,11) → LIGHTS82
 *   - Strip lights (CATLIT 9) → LIGHTS81
 *   - Directional lights (CATLIT 1,16) with ORIENT → oriented flare
 *   - Non-sector lights → flare symbol by COLOUR (LIGHTS11/12/13)
 *   - Light description text (LITDSN02): CATLIT prefix + LITCHR + SIGGRP +
 *     COLOUR + SIGPER + HEIGHT + VALNMR + STATUS suffix
 *
 * TODO: Sector light arcs and leg lines (requires rendering arcs, which
 *       MapLibre doesn't support natively — may need pipeline pre-computation)
 * TODO: Major light circles (VALNMR >= 10)
 * TODO: Co-located light detection for flare angle offset
 */
export function LIGHTS06(config: LayerConfig): Partial<LayerSpecification>[] {
  // Colour → flare symbol mapping (S-52 spec table)
  // COLOUR is a list attribute stored as a JSON string
  const flareSymbol: ExpressionSpecification = [
    "case",
    // Red or white+red → LIGHTS11 (red flare)
    ["any", listIncludes("COLOUR", "3"), listIncludes("COLOUR", "3")],
    "LIGHTS11",
    // Green or white+green → LIGHTS12 (green flare)
    listIncludes("COLOUR", "4"),
    "LIGHTS12",
    // Yellow, orange, white, blue+yellow → LIGHTS13 (yellow flare)
    [
      "any",
      listIncludes("COLOUR", "6"),
      listIncludes("COLOUR", "11"),
      listIncludes("COLOUR", "1"),
    ],
    "LIGHTS13",
    // Default → LITDEF11
    "LITDEF11",
  ];

  return [
    // --- Special light types (checked first, exit early per spec) ---

    // Floodlight (CATLIT 8) or spotlight (CATLIT 11)
    {
      type: "symbol",
      filter: [
        "all",
        ["has", "CATLIT"],
        ["any", listIncludes("CATLIT", "8"), listIncludes("CATLIT", "11")],
      ] as ExpressionFilterSpecification,
      layout: { "icon-image": "LIGHTS82", "icon-allow-overlap": true },
    },

    // Strip light (CATLIT 9)
    {
      type: "symbol",
      filter: [
        "all",
        ["has", "CATLIT"],
        listIncludes("CATLIT", "9"),
        ["!", listIncludes("CATLIT", "8")],
        ["!", listIncludes("CATLIT", "11")],
      ] as ExpressionFilterSpecification,
      layout: { "icon-image": "LIGHTS81", "icon-allow-overlap": true },
    },

    // --- Directional lights (CATLIT 1 or 16) with ORIENT ---
    {
      type: "symbol",
      filter: [
        "all",
        ["has", "CATLIT"],
        ["any", listIncludes("CATLIT", "1"), listIncludes("CATLIT", "16")],
        ["has", "ORIENT"],
        // Exclude flood/spot/strip
        ["!", listIncludes("CATLIT", "8")],
        ["!", listIncludes("CATLIT", "9")],
        ["!", listIncludes("CATLIT", "11")],
      ] as ExpressionFilterSpecification,
      layout: {
        "icon-image": flareSymbol,
        // ORIENT is from seaward, rotate flare to show direction of light
        "icon-rotate": ["+", ["get", "ORIENT"], 180],
        "icon-allow-overlap": true,
      },
    },

    // --- Non-sector, non-special lights → flare symbol ---
    // Sector lights (SECTR1 and SECTR2 present and different) are excluded
    // since we don't render arcs yet
    {
      type: "symbol",
      filter: [
        "all",
        // Exclude special types handled above
        [
          "any",
          ["!", ["has", "CATLIT"]],
          [
            "all",
            ["!", listIncludes("CATLIT", "8")],
            ["!", listIncludes("CATLIT", "9")],
            ["!", listIncludes("CATLIT", "11")],
            ["!", listIncludes("CATLIT", "1")],
            ["!", listIncludes("CATLIT", "16")],
          ],
        ],
        // Exclude sector lights (have both SECTR1 and SECTR2)
        ["any", ["!", ["has", "SECTR1"]], ["!", ["has", "SECTR2"]]],
      ] as ExpressionFilterSpecification,
      layout: {
        "icon-image": flareSymbol,
        "icon-allow-overlap": true,
      },
    },

    // --- Sector lights: just show flare for now ---
    // TODO: render sector arcs and leg lines
    {
      type: "symbol",
      filter: [
        "all",
        ["has", "SECTR1"],
        ["has", "SECTR2"],
        // Exclude special types
        [
          "any",
          ["!", ["has", "CATLIT"]],
          [
            "all",
            ["!", listIncludes("CATLIT", "8")],
            ["!", listIncludes("CATLIT", "9")],
            ["!", listIncludes("CATLIT", "11")],
            ["!", listIncludes("CATLIT", "1")],
            ["!", listIncludes("CATLIT", "16")],
          ],
        ],
      ] as ExpressionFilterSpecification,
      layout: {
        "icon-image": flareSymbol,
        "icon-allow-overlap": true,
      },
    },

    // --- Light description text (LITDSN02) ---
    ...LITDSN02(config),
  ];
}

/**
 * LITDSN02 - 10.6.3 Light description text string
 * (S-52 PresLib 4.0, section 10.6.3)
 *
 * Builds the standard light description from S-57 attributes:
 *   LITCHR + SIGGRP + COLOUR + SIGPER + HEIGHT + VALNMR + STATUS
 *   e.g. "Fl(2) WR 10s 15m 15M"
 *
 * LITCHR and SIGPER are scalar. COLOUR, CATLIT, STATUS are list attributes
 * stored as JSON strings. SIGGRP is a string like "(2)" or "(2+1)".
 */
function LITDSN02(config: LayerConfig): Partial<LayerSpecification>[] {
  const { mode } = config;

  // LITCHR code → abbreviation (S-57 attribute enumeration)
  const litchrAbbrev: ExpressionSpecification = [
    "match",
    ["get", "LITCHR"],
    1,
    "F",
    2,
    "Fl",
    3,
    "LFl",
    4,
    "Q",
    5,
    "VQ",
    6,
    "UQ",
    7,
    "Iso",
    8,
    "Oc",
    9,
    "IQ",
    10,
    "IVQ",
    11,
    "IUQ",
    12,
    "Mo",
    13,
    "FFl",
    14,
    "Fl+LFl",
    15,
    "OcFl",
    16,
    "FLFl",
    17,
    "AlOc",
    18,
    "AlLFl",
    19,
    "AlFl",
    20,
    "Al",
    25,
    "Q+LFl",
    26,
    "VQ+LFl",
    27,
    "UQ+LFl",
    28,
    "Al",
    29,
    "AlFFl",
    "",
  ];

  // COLOUR abbreviations for lights via list membership on the JSON array
  // COLOUR is stored as e.g. '["1","3"]' for white+red
  const colourAbbrev: ExpressionSpecification = [
    "concat",
    ["case", listContains("COLOUR", "1"), "W", ""],
    ["case", listContains("COLOUR", "3"), "R", ""],
    ["case", listContains("COLOUR", "4"), "G", ""],
    ["case", listContains("COLOUR", "6"), "Y", ""],
    ["case", listContains("COLOUR", "11"), "Y", ""],
    ["case", listContains("COLOUR", "5"), "Bu", ""],
    ["case", listContains("COLOUR", "10"), "Vi", ""],
  ];

  // CATLIT prefix (directional, aeronautical, fog detector)
  const catlitPrefix: ExpressionSpecification = [
    "case",
    ["!", ["has", "CATLIT"]],
    "",
    listContains("CATLIT", "1"),
    "Dir ",
    listContains("CATLIT", "5"),
    "Aero ",
    listContains("CATLIT", "7"),
    "Fog Det Lt ",
    "",
  ];

  // STATUS suffix
  const statusSuffix: ExpressionSpecification = [
    "case",
    ["!", ["has", "STATUS"]],
    "",
    listContains("STATUS", "2"),
    "(occas)",
    listContains("STATUS", "7"),
    "(temp)",
    listContains("STATUS", "8"),
    "(priv)",
    listContains("STATUS", "11"),
    "(exting)",
    listContains("STATUS", "17"),
    "(U)",
    "",
  ];

  // Build the full description string
  const textField: ExpressionSpecification = [
    "concat",
    // CATLIT prefix (e.g. "Dir ")
    catlitPrefix,
    // Light characteristic (e.g. "Fl")
    ["case", ["has", "LITCHR"], litchrAbbrev, ""],
    // Signal group (e.g. "(2)") — SIGGRP is a string attribute
    ["case", ["has", "SIGGRP"], ["get", "SIGGRP"], ""],
    // Space + colour abbreviations
    ["case", ["has", "COLOUR"], ["concat", " ", colourAbbrev], ""],
    // Space + signal period in seconds
    [
      "case",
      ["has", "SIGPER"],
      ["concat", " ", ["number-format", ["get", "SIGPER"], {}], "s"],
      "",
    ],
    // Space + height in metres
    [
      "case",
      ["has", "HEIGHT"],
      [
        "concat",
        " ",
        ["number-format", ["get", "HEIGHT"], { "max-fraction-digits": 0 }],
        "m",
      ],
      "",
    ],
    // Space + nominal range in nautical miles
    [
      "case",
      ["has", "VALNMR"],
      [
        "concat",
        " ",
        ["number-format", ["get", "VALNMR"], { "max-fraction-digits": 0 }],
        "M",
      ],
      "",
    ],
    // STATUS suffix (e.g. "(temp)")
    statusSuffix,
  ];

  return [
    {
      type: "symbol",
      layout: {
        "text-field": textField,
        "text-font": ["Metropolis Regular"],
        "text-size": 10,
        "text-offset": [2, 0],
        "text-anchor": "left",
        "text-allow-overlap": false,
      },
      paint: {
        "text-color": colour(mode, "CHBLK"),
        "text-halo-color": colour(mode, "NODTA"),
        "text-halo-width": 1,
      },
      metadata: { "s52:display": "23" },
    },
  ];
}
/**
 * OBSTRN07 - 13.2.5 Obstructions and rocks (S-52 PresLib 4.0, section 13.2.5)
 *
 * Applies to S-57 object classes OBSTRN (obstruction) and UWTROC (underwater rock).
 * Attributes: VALSOU, CATOBS, WATLEV, EXPSOU
 * Geometry: Point, Line, Area
 *
 * Point obstructions (Continuation A):
 *   - Isolated danger → ISODGR01
 *   - UWTROC: WATLEV 3 → UWTROC03, else → UWTROC04
 *   - OBSTRN with VALSOU: shallow → DANGER01, deep → DANGER02
 *   - OBSTRN with CATOBS 6 (foul area): WATLEV 1,2 → OBSTRN11, WATLEV 4,5 → OBSTRN03, else → DANGER01
 *   - OBSTRN without VALSOU: CATOBS 6 → OBSTRN01, WATLEV 1,2 → OBSTRN11,
 *     WATLEV 4,5 → UWTROC04, else → DANGER01
 *
 * Line obstructions (Continuation B):
 *   - Isolated danger → ISODGR01 + dotted CHBLK
 *   - Shallow/no sounding → dotted CHBLK
 *   - Deep → dashed CHBLK
 *
 * Area obstructions (Continuation C):
 *   - Isolated danger → DEPVS fill + FOULAR01 pattern + dotted CHBLK + ISODGR01
 *   - With VALSOU: shallow → dotted CHBLK, deep → dashed CHGRD
 *   - CATOBS 6 → FOULAR01 pattern + dotted CHBLK
 *   - WATLEV 1,2 → CHBRN fill + solid CSTLN
 *   - WATLEV 4 → DEPIT fill + dashed CSTLN
 *   - Default → DEPVS fill + dotted CHBLK
 */
export function OBSTRN07(config: LayerConfig): Partial<LayerSpecification>[] {
  const { mode, safetyDepth } = config;
  const isDanger = isolatedDanger(config);
  const notDanger = notIsolatedDanger(config);

  return [
    // ─── Point obstructions (Continuation A) ───

    // Isolated danger → ISODGR01
    {
      type: "symbol",
      filter: ["all", ["==", ["geometry-type"], "Point"], isDanger],
      layout: { "icon-image": "ISODGR01", "icon-allow-overlap": true },
    },

    // Not isolated danger, no VALSOU, UWTROC class
    // The lookup table separates UWTROC and OBSTRN into different source-layers,
    // so we use the source-layer name to distinguish them. UWTROC without VALSOU:
    // WATLEV 3 → UWTROC03, else → UWTROC04
    // (Features with VALSOU are handled by the VALSOU branches below)

    // Has VALSOU, not isolated danger, CATOBS 6 (foul area)
    {
      type: "symbol",
      filter: [
        "all",
        ["==", ["geometry-type"], "Point"],
        notDanger,
        ["has", "VALSOU"],
        ["==", ["get", "CATOBS"], 6],
        ["in", ["get", "WATLEV"], ["literal", [1, 2]]],
      ],
      layout: { "icon-image": "OBSTRN11", "icon-allow-overlap": true },
    },
    {
      type: "symbol",
      filter: [
        "all",
        ["==", ["geometry-type"], "Point"],
        notDanger,
        ["has", "VALSOU"],
        ["==", ["get", "CATOBS"], 6],
        ["in", ["get", "WATLEV"], ["literal", [4, 5]]],
      ],
      layout: { "icon-image": "OBSTRN03", "icon-allow-overlap": true },
    },

    // Has VALSOU, not isolated danger, not CATOBS 6, VALSOU <= safetyDepth → DANGER01
    {
      type: "symbol",
      filter: [
        "all",
        ["==", ["geometry-type"], "Point"],
        notDanger,
        ["has", "VALSOU"],
        ["!=", ["get", "CATOBS"], 6],
        ["<=", ["get", "VALSOU"], safetyDepth],
      ],
      layout: { "icon-image": "DANGER01", "icon-allow-overlap": true },
    },

    // Has VALSOU, not isolated danger, not CATOBS 6, VALSOU > safetyDepth → DANGER02
    {
      type: "symbol",
      filter: [
        "all",
        ["==", ["geometry-type"], "Point"],
        notDanger,
        ["has", "VALSOU"],
        ["!=", ["get", "CATOBS"], 6],
        [">", ["get", "VALSOU"], safetyDepth],
      ],
      layout: { "icon-image": "DANGER02", "icon-allow-overlap": true },
    },

    // Sounding text on point obstructions with VALSOU (SNDFRM04)
    SNDFRM04(config, "VALSOU", [
      "all",
      ["==", ["geometry-type"], "Point"],
      notDanger,
      ["has", "VALSOU"],
    ]),

    // No VALSOU, not isolated danger → symbol by CATOBS/WATLEV
    {
      type: "symbol",
      filter: [
        "all",
        ["==", ["geometry-type"], "Point"],
        notDanger,
        ["!", ["has", "VALSOU"]],
      ],
      layout: {
        "icon-image": [
          "case",
          // CATOBS 6 (foul area) → OBSTRN01
          ["==", ["get", "CATOBS"], 6],
          "OBSTRN01",
          // WATLEV 1,2 (dry/partly submerged) → OBSTRN11
          ["in", ["get", "WATLEV"], ["literal", [1, 2]]],
          "OBSTRN11",
          // WATLEV 4,5 (covers/uncovers, awash) → UWTROC04
          ["in", ["get", "WATLEV"], ["literal", [4, 5]]],
          "UWTROC04",
          // Default → DANGER01
          "DANGER01",
        ] as ExpressionSpecification,
        "icon-allow-overlap": true,
      },
    },

    // ─── Line obstructions (Continuation B) ───

    // Isolated danger → dotted CHBLK + ISODGR01 at midpoint
    {
      type: "line",
      filter: ["all", ["==", ["geometry-type"], "LineString"], isDanger],
      paint: {
        "line-dasharray": LineStyles.DOTT,
        "line-width": 2,
        "line-color": colour(mode, "CHBLK"),
      },
    },
    {
      type: "symbol",
      filter: ["all", ["==", ["geometry-type"], "LineString"], isDanger],
      layout: {
        "icon-image": "ISODGR01",
        "icon-allow-overlap": true,
        "symbol-placement": "line",
      },
    },

    // Not isolated danger, shallow or no sounding → dotted CHBLK
    {
      type: "line",
      filter: [
        "all",
        ["==", ["geometry-type"], "LineString"],
        notDanger,
        [
          "any",
          ["!", ["has", "VALSOU"]],
          ["<=", ["get", "VALSOU"], safetyDepth],
        ],
      ],
      paint: {
        "line-dasharray": LineStyles.DOTT,
        "line-width": 2,
        "line-color": colour(mode, "CHBLK"),
      },
    },

    // Not isolated danger, deep sounding → dashed CHBLK
    {
      type: "line",
      filter: [
        "all",
        ["==", ["geometry-type"], "LineString"],
        notDanger,
        ["has", "VALSOU"],
        [">", ["get", "VALSOU"], safetyDepth],
      ],
      paint: {
        "line-dasharray": LineStyles.DASH,
        "line-width": 2,
        "line-color": colour(mode, "CHBLK"),
      },
    },

    // ─── Area obstructions (Continuation C) ───

    // Isolated danger area: DEPVS fill + FOULAR01 pattern + dotted CHBLK + ISODGR01
    {
      type: "fill",
      filter: ["all", ["==", ["geometry-type"], "Polygon"], isDanger],
      paint: { "fill-color": colour(mode, "DEPVS") },
    },
    {
      type: "fill",
      filter: ["all", ["==", ["geometry-type"], "Polygon"], isDanger],
      paint: { "fill-pattern": "FOULAR01" },
    },
    {
      type: "line",
      filter: ["all", ["==", ["geometry-type"], "Polygon"], isDanger],
      paint: {
        "line-dasharray": LineStyles.DOTT,
        "line-width": 2,
        "line-color": colour(mode, "CHBLK"),
      },
    },
    {
      type: "symbol",
      filter: ["all", ["==", ["geometry-type"], "Polygon"], isDanger],
      layout: { "icon-image": "ISODGR01", "icon-allow-overlap": true },
    },

    // Not isolated danger, has VALSOU, shallow → dotted CHBLK outline
    {
      type: "line",
      filter: [
        "all",
        ["==", ["geometry-type"], "Polygon"],
        notDanger,
        ["has", "VALSOU"],
        ["<=", ["get", "VALSOU"], safetyDepth],
      ],
      paint: {
        "line-dasharray": LineStyles.DOTT,
        "line-width": 2,
        "line-color": colour(mode, "CHBLK"),
      },
    },

    // Not isolated danger, has VALSOU, deep → dashed CHGRD outline
    {
      type: "line",
      filter: [
        "all",
        ["==", ["geometry-type"], "Polygon"],
        notDanger,
        ["has", "VALSOU"],
        [">", ["get", "VALSOU"], safetyDepth],
      ],
      paint: {
        "line-dasharray": LineStyles.DASH,
        "line-width": 2,
        "line-color": colour(mode, "CHGRD"),
      },
    },

    // Sounding text on area obstructions with VALSOU (SNDFRM04)
    SNDFRM04(config, "VALSOU", [
      "all",
      ["==", ["geometry-type"], "Polygon"],
      notDanger,
      ["has", "VALSOU"],
    ]),

    // Not isolated danger, no VALSOU: fill + outline by CATOBS/WATLEV
    // CATOBS 6 → FOULAR01 pattern + dotted CHBLK
    {
      type: "fill",
      filter: [
        "all",
        ["==", ["geometry-type"], "Polygon"],
        notDanger,
        ["!", ["has", "VALSOU"]],
        ["==", ["get", "CATOBS"], 6],
      ],
      paint: { "fill-pattern": "FOULAR01" },
    },
    {
      type: "line",
      filter: [
        "all",
        ["==", ["geometry-type"], "Polygon"],
        notDanger,
        ["!", ["has", "VALSOU"]],
        ["==", ["get", "CATOBS"], 6],
      ],
      paint: {
        "line-dasharray": LineStyles.DOTT,
        "line-width": 2,
        "line-color": colour(mode, "CHBLK"),
      },
    },

    // WATLEV 1,2 → CHBRN fill + solid CSTLN
    {
      type: "fill",
      filter: [
        "all",
        ["==", ["geometry-type"], "Polygon"],
        notDanger,
        ["!", ["has", "VALSOU"]],
        ["!=", ["get", "CATOBS"], 6],
        ["in", ["get", "WATLEV"], ["literal", [1, 2]]],
      ],
      paint: { "fill-color": colour(mode, "CHBRN") },
    },
    {
      type: "line",
      filter: [
        "all",
        ["==", ["geometry-type"], "Polygon"],
        notDanger,
        ["!", ["has", "VALSOU"]],
        ["!=", ["get", "CATOBS"], 6],
        ["in", ["get", "WATLEV"], ["literal", [1, 2]]],
      ],
      paint: {
        "line-width": 2,
        "line-color": colour(mode, "CSTLN"),
      },
    },

    // WATLEV 4 → DEPIT fill + dashed CSTLN
    {
      type: "fill",
      filter: [
        "all",
        ["==", ["geometry-type"], "Polygon"],
        notDanger,
        ["!", ["has", "VALSOU"]],
        ["!=", ["get", "CATOBS"], 6],
        ["==", ["get", "WATLEV"], 4],
      ],
      paint: { "fill-color": colour(mode, "DEPIT") },
    },
    {
      type: "line",
      filter: [
        "all",
        ["==", ["geometry-type"], "Polygon"],
        notDanger,
        ["!", ["has", "VALSOU"]],
        ["!=", ["get", "CATOBS"], 6],
        ["==", ["get", "WATLEV"], 4],
      ],
      paint: {
        "line-dasharray": LineStyles.DASH,
        "line-width": 2,
        "line-color": colour(mode, "CSTLN"),
      },
    },

    // Default (WATLEV 3, 5, or missing) → DEPVS fill + dotted CHBLK
    {
      type: "fill",
      filter: [
        "all",
        ["==", ["geometry-type"], "Polygon"],
        notDanger,
        ["!", ["has", "VALSOU"]],
        ["!=", ["get", "CATOBS"], 6],
        ["!", ["in", ["get", "WATLEV"], ["literal", [1, 2, 4]]]],
      ],
      paint: { "fill-color": colour(mode, "DEPVS") },
    },
    {
      type: "line",
      filter: [
        "all",
        ["==", ["geometry-type"], "Polygon"],
        notDanger,
        ["!", ["has", "VALSOU"]],
        ["!=", ["get", "CATOBS"], 6],
        ["!", ["in", ["get", "WATLEV"], ["literal", [1, 2, 4]]]],
      ],
      paint: {
        "line-dasharray": LineStyles.DOTT,
        "line-width": 2,
        "line-color": colour(mode, "CHBLK"),
      },
    },
  ];
}
/**
 * QUAPOS01 - 13.2.7 Quality of position (S-52 PresLib 4.0, section 13.2.7)
 *
 * Applies to COALNE (line) and LNDARE (line, point).
 * Dispatches to QUALIN01 for lines, QUAPNT02 for points.
 */
export function QUAPOS01(config: LayerConfig): Partial<LayerSpecification>[] {
  return [
    // Line objects → QUALIN01
    ...QUALIN01(config),
    // Point objects → QUAPNT02 (show LOWACC01 if low accuracy)
    ...QUAPNT02(config),
  ];
}

/**
 * QUALIN01 - 13.2.8 Quality of line positions (S-52 PresLib 4.0, section 13.2.8)
 *
 * Sub-procedure called by QUAPOS01. For line objects, if QUAPOS indicates
 * low accuracy (not 1, 10, or 11), symbolize with LC(LOWACC21).
 * Otherwise use default line style from the lookup table.
 *
 * For COALNE: default is LS(SOLD,1,CSTLN).
 * For LNDARE: default is LS(SOLD,1,CSTLN).
 */
export function QUALIN01(config: LayerConfig): Partial<LayerSpecification>[] {
  const { mode } = config;
  const lowQuality = quaposLowQuality();

  return [
    // Low accuracy line segments → LOWACC21 pattern
    {
      type: "line",
      filter: ["all", ["==", ["geometry-type"], "LineString"], lowQuality],
      layout: {
        // TODO: LC(LOWACC21) complex line pattern — using dashed approximation
      },
      paint: {
        "line-dasharray": LineStyles.DASH,
        "line-width": 1,
        "line-color": colour(mode, "CHMGF"),
      },
    },
    // Accurate line segments → solid CSTLN
    {
      type: "line",
      filter: [
        "all",
        ["==", ["geometry-type"], "LineString"],
        ["!", lowQuality],
      ],
      paint: {
        "line-width": 1,
        "line-color": colour(mode, "CSTLN"),
      },
    },
  ];
}

/**
 * QUAPNT02 - 13.2.9 Quality of point/area positions (S-52 PresLib 4.0, section 13.2.9)
 *
 * Sub-procedure called by QUAPOS01, SLCONS04, OBSTRN07, WRECKS05.
 * Shows LOWACC01 symbol at point/area features with low positional accuracy.
 */
export function QUAPNT02(_config: LayerConfig): Partial<LayerSpecification>[] {
  return [
    {
      type: "symbol",
      filter: [
        "all",
        [
          "any",
          ["==", ["geometry-type"], "Point"],
          ["==", ["geometry-type"], "Polygon"],
        ],
        quaposLowQuality(),
      ] as ExpressionFilterSpecification,
      layout: {
        "icon-image": "LOWACC01",
        "icon-allow-overlap": true,
      },
    },
  ];
}
// RESTRN value groups used by RESARE04, RESTRN01, and RESCSP02
const RESTRN_ENTRY = ["7", "8", "14"];
const RESTRN_ANCHOR = ["1", "2"];
const RESTRN_FISHING = ["3", "4", "5", "6", "24"];
const RESTRN_OWN_SHIP = ["13", "16", "17", "23", "25", "26", "27"];
const RESTRN_OTHER = [
  "9",
  "10",
  "11",
  "12",
  "15",
  "18",
  "19",
  "20",
  "21",
  "22",
];

// CATREA value groups (military/safety vs nature/ecological)
const CATREA_MILITARY = [
  "1",
  "8",
  "9",
  "12",
  "14",
  "18",
  "19",
  "21",
  "24",
  "25",
  "26",
];
const CATREA_NATURE = ["4", "5", "6", "7", "10", "20", "22", "23"];

/**
 * Select the restriction symbol based on RESTRN priority cascade.
 * Each continuation checks if additional restriction types exist alongside
 * the primary type, upgrading the symbol suffix (51 → 61 → 71).
 *
 * Suffix meanings:
 *   51 = only this restriction type
 *   61 = this type + other navigational restrictions
 *   71 = this type + environmental/nature restrictions
 */
function restrictionSymbol(
  prefix: string,
  additionalRestrn: string[],
  config: LayerConfig,
): Partial<LayerSpecification>[] {
  const { mode } = config;

  return [
    // Symbol in center of area
    {
      type: "symbol",
      layout: {
        "icon-image": [
          "case",
          // Has additional navigational restrictions → 61
          listIncludes("RESTRN", ...additionalRestrn),
          `${prefix}61`,
          // Has CATREA military/safety values → 61
          [
            "all",
            ["has", "CATREA"],
            listIncludes("CATREA", ...CATREA_MILITARY),
          ],
          `${prefix}61`,
          // Has other RESTRN values (9-22) → 71
          listIncludes("RESTRN", ...RESTRN_OTHER),
          `${prefix}71`,
          // Has CATREA nature values → 71
          ["all", ["has", "CATREA"], listIncludes("CATREA", ...CATREA_NATURE)],
          `${prefix}71`,
          // Default → 51
          `${prefix}51`,
        ] as ExpressionSpecification,
        "icon-allow-overlap": true,
      },
    },

    // Boundary: plain boundaries use LS(DASH,2,CHMGD)
    // TODO: symbolized boundaries should use LC pattern (e.g., LC(ENTRES51))
    {
      type: "line",
      paint: {
        "line-dasharray": LineStyles.DASH,
        "line-width": 2,
        "line-color": colour(mode, "CHMGD"),
      },
    },
  ];
}

/**
 * RESARE04 - 13.2.9 Restricted areas (S-52 PresLib 4.0, section 13.2.9)
 *
 * Applies to S-57 object class RESARE only.
 * Attributes: RESTRN (list), CATREA (list)
 *
 * Priority cascade:
 *   1. Entry restricted/prohibited (RESTRN 7, 8, 14) → ENTRES symbol
 *   2. Anchoring restricted/prohibited (RESTRN 1, 2) → ACHRES symbol
 *   3. Fishing restricted/prohibited (RESTRN 3, 4, 5, 6, 24) → FSHRES symbol
 *   4. Own ship restrictions (RESTRN 13, 16, 17, 23, 25, 26, 27) → CTYARE symbol
 *   5. Other restrictions (RESTRN 9-22) → INFARE51
 *   6. No RESTRN → symbol by CATREA or RSRDEF51
 */
export function RESARE04(config: LayerConfig): Partial<LayerSpecification>[] {
  const { mode } = config;

  // The spec uses a priority cascade: first matching group wins.
  // Each group produces a symbol layer + boundary layer.
  // We implement this as multiple layers with mutually exclusive filters.

  const hasRestrn: ExpressionFilterSpecification = ["has", "RESTRN"];
  const hasEntry = listIncludes("RESTRN", ...RESTRN_ENTRY);
  const hasAnchor = listIncludes("RESTRN", ...RESTRN_ANCHOR);
  const hasFishing = listIncludes("RESTRN", ...RESTRN_FISHING);
  const hasOwnShip = listIncludes("RESTRN", ...RESTRN_OWN_SHIP);
  const hasOther = listIncludes("RESTRN", ...RESTRN_OTHER);

  // Remaining RESTRN values for each level's "additional" check
  const entryAdditional = [
    ...RESTRN_ANCHOR,
    ...RESTRN_FISHING,
    ...RESTRN_OWN_SHIP,
  ];
  const anchorAdditional = [...RESTRN_FISHING, ...RESTRN_OWN_SHIP];
  const fishingAdditional = [...RESTRN_OWN_SHIP];

  const filterA: ExpressionFilterSpecification = ["all", hasRestrn, hasEntry];
  const filterB: ExpressionFilterSpecification = [
    "all",
    hasRestrn,
    ["!", hasEntry],
    hasAnchor,
  ];
  const filterC: ExpressionFilterSpecification = [
    "all",
    hasRestrn,
    ["!", hasEntry],
    ["!", hasAnchor],
    hasFishing,
  ];
  const filterD: ExpressionFilterSpecification = [
    "all",
    hasRestrn,
    ["!", hasEntry],
    ["!", hasAnchor],
    ["!", hasFishing],
    hasOwnShip,
  ];
  const filterOther: ExpressionFilterSpecification = [
    "all",
    hasRestrn,
    ["!", hasEntry],
    ["!", hasAnchor],
    ["!", hasFishing],
    ["!", hasOwnShip],
    hasOther,
  ];
  const filterNoRestrn: ExpressionFilterSpecification = ["!", hasRestrn];

  return [
    // --- Continuation A: Entry restricted/prohibited ---
    ...restrictionSymbol("ENTRES", entryAdditional, config).map((l) => ({
      ...l,
      filter: filterA,
    })),

    // --- Continuation B: Anchoring restricted/prohibited ---
    ...restrictionSymbol("ACHRES", anchorAdditional, config).map((l) => ({
      ...l,
      filter: filterB,
    })),

    // --- Continuation C: Fishing restricted/prohibited ---
    ...restrictionSymbol("FSHRES", fishingAdditional, config).map((l) => ({
      ...l,
      filter: filterC,
    })),

    // --- Continuation D: Own ship restrictions ---
    ...restrictionSymbol("CTYARE", [], config).map((l) => ({
      ...l,
      filter: filterD,
    })),

    // --- RESTRN other (9-22) without any higher-priority restriction ---
    {
      type: "symbol",
      filter: filterOther,
      layout: { "icon-image": "INFARE51", "icon-allow-overlap": true },
    },
    {
      type: "line",
      filter: filterOther,
      paint: {
        "line-dasharray": LineStyles.DASH,
        "line-width": 2,
        "line-color": colour(mode, "CHMGD"),
      },
    },

    // --- Continuation E: No RESTRN → symbol by CATREA ---
    {
      type: "symbol",
      filter: filterNoRestrn,
      layout: {
        "icon-image": [
          "case",
          [
            "all",
            ["has", "CATREA"],
            listIncludes("CATREA", ...CATREA_MILITARY),
          ],
          "CTYARE51",
          ["all", ["has", "CATREA"], listIncludes("CATREA", ...CATREA_NATURE)],
          "INFARE51",
          "RSRDEF51",
        ] as ExpressionSpecification,
        "icon-allow-overlap": true,
      },
    },
    {
      type: "line",
      filter: filterNoRestrn,
      paint: {
        "line-dasharray": LineStyles.DASH,
        "line-width": 2,
        "line-color": colour(mode, "CHMGD"),
      },
    },
  ];
}

/**
 * RESTRN01 - 13.2.10 Entry procedure for restrictions
 * (S-52 PresLib 4.0, section 13.2.10)
 *
 * Called for many object classes (ACHARE, CBLARE, DRGARE, FAIRWY, etc.)
 * when they carry the RESTRN attribute. Delegates to RESCSP02.
 */
export function RESTRN01(config: LayerConfig): Partial<LayerSpecification>[] {
  return RESCSP02(config);
}

/**
 * RESCSP02 - 13.2.11 Restriction sub-procedure
 * (S-52 PresLib 4.0, section 13.2.11)
 *
 * Same priority cascade as RESARE04 but without CATREA checks,
 * since these object classes don't have CATREA.
 */
export function RESCSP02(config: LayerConfig): Partial<LayerSpecification>[] {
  const { mode } = config;

  const hasRestrn: ExpressionFilterSpecification = ["has", "RESTRN"];
  const hasEntry = listIncludes("RESTRN", ...RESTRN_ENTRY);
  const hasAnchor = listIncludes("RESTRN", ...RESTRN_ANCHOR);
  const hasFishing = listIncludes("RESTRN", ...RESTRN_FISHING);
  const hasOwnShip = listIncludes("RESTRN", ...RESTRN_OWN_SHIP);

  const fEntry: ExpressionFilterSpecification = ["all", hasRestrn, hasEntry];
  const fAnchor: ExpressionFilterSpecification = [
    "all",
    hasRestrn,
    ["!", hasEntry],
    hasAnchor,
  ];
  const fFishing: ExpressionFilterSpecification = [
    "all",
    hasRestrn,
    ["!", hasEntry],
    ["!", hasAnchor],
    hasFishing,
  ];
  const fOwnShip: ExpressionFilterSpecification = [
    "all",
    hasRestrn,
    ["!", hasEntry],
    ["!", hasAnchor],
    ["!", hasFishing],
    hasOwnShip,
  ];
  const fOther: ExpressionFilterSpecification = [
    "all",
    hasRestrn,
    ["!", hasEntry],
    ["!", hasAnchor],
    ["!", hasFishing],
    ["!", hasOwnShip],
  ];

  return [
    {
      type: "symbol",
      filter: fEntry,
      layout: { "icon-image": "ENTRES51", "icon-allow-overlap": true },
    },
    {
      type: "symbol",
      filter: fAnchor,
      layout: { "icon-image": "ACHRES51", "icon-allow-overlap": true },
    },
    {
      type: "symbol",
      filter: fFishing,
      layout: { "icon-image": "FSHRES51", "icon-allow-overlap": true },
    },
    {
      type: "symbol",
      filter: fOwnShip,
      layout: { "icon-image": "CTYARE51", "icon-allow-overlap": true },
    },
    {
      type: "symbol",
      filter: fOther,
      layout: { "icon-image": "INFARE51", "icon-allow-overlap": true },
    },
    {
      type: "line",
      filter: hasRestrn,
      paint: {
        "line-dasharray": LineStyles.DASH,
        "line-width": 2,
        "line-color": colour(mode, "CHMGD"),
      },
    },
  ];
}

/** SAFCON01 - 13.2.12 Contour labels, including safety contour */
export function SAFECON01(config: LayerConfig): Partial<LayerSpecification>[] {
  return [
    {
      type: "symbol",
      filter: [
        "all",
        ["has", "VALDCO"],
        [">", ["get", "VALDCO"], 0],
        ["<", ["get", "VALDCO"], 99999],
      ],
      layout: {
        "symbol-placement": "line",
        "text-size": 12,
        "text-field": [
          "case",
          ["<", ["get", "VALDCO"], 31],
          [
            "number-format",
            ["get", "VALDCO"],
            { "min-fraction-digits": 0, "max-fraction-digits": 0 },
          ],
          ["number-format", ["floor", ["get", "VALDCO"]], {}],
        ],
        "text-font": ["Metropolis Regular"],
      },
      paint: {
        "text-halo-color": colour(config.mode, "NODTA"),
        "text-halo-width": 1,
        "text-color": colour(config.mode, "CHBLK"),
      },
    },
  ];
}

/**
 * SLCONS04 - 13.2.13 Shoreline constructions (S-52 PresLib 4.0, section 13.2.13)
 *
 * Applies to S-57 object class SLCONS (point, line, area).
 * Attributes: QUAPOS, CONDTN, CATSLC, WATLEV
 *
 * Points: show LOWACC01 if low accuracy (via QUAPNT02).
 * Lines/Areas: low accuracy segments → LC(LOWACC21),
 *   otherwise line style by CONDTN/CATSLC/WATLEV lookup table.
 */
export function SLCONS04(config: LayerConfig): Partial<LayerSpecification>[] {
  const { mode } = config;
  const lowQuality = quaposLowQuality();

  return [
    // Point: QUAPNT02 low accuracy symbol
    ...QUAPNT02(config),

    // Line/Area: low accuracy segments → dashed CHMGF (approximation of LC(LOWACC21))
    {
      type: "line",
      filter: ["all", ["!=", ["geometry-type"], "Point"], lowQuality],
      paint: {
        "line-dasharray": LineStyles.DASH,
        "line-width": 1,
        "line-color": colour(mode, "CHMGF"),
      },
    },

    // Line/Area: accurate segments — style by CONDTN/CATSLC/WATLEV
    // CONDTN 1 or 2 (under construction, ruined) → dashed
    {
      type: "line",
      filter: [
        "all",
        ["!=", ["geometry-type"], "Point"],
        ["!", lowQuality],
        ["has", "CONDTN"],
        ["in", ["get", "CONDTN"], ["literal", [1, 2]]],
      ],
      paint: {
        "line-dasharray": LineStyles.DASH,
        "line-width": 1,
        "line-color": colour(mode, "CSTLN"),
      },
    },

    // CATSLC 6, 15, or 16 (wharf, pier, promenade pier) → thick solid
    {
      type: "line",
      filter: [
        "all",
        ["!=", ["geometry-type"], "Point"],
        ["!", lowQuality],
        [
          "any",
          ["!", ["has", "CONDTN"]],
          ["!", ["in", ["get", "CONDTN"], ["literal", [1, 2]]]],
        ],
        ["has", "CATSLC"],
        ["in", ["get", "CATSLC"], ["literal", [6, 15, 16]]],
      ],
      paint: {
        "line-width": 4,
        "line-color": colour(mode, "CSTLN"),
      },
    },

    // WATLEV 3 or 4 (always under water, covers/uncovers) → dashed
    {
      type: "line",
      filter: [
        "all",
        ["!=", ["geometry-type"], "Point"],
        ["!", lowQuality],
        [
          "any",
          ["!", ["has", "CONDTN"]],
          ["!", ["in", ["get", "CONDTN"], ["literal", [1, 2]]]],
        ],
        [
          "any",
          ["!", ["has", "CATSLC"]],
          ["!", ["in", ["get", "CATSLC"], ["literal", [6, 15, 16]]]],
        ],
        ["has", "WATLEV"],
        ["in", ["get", "WATLEV"], ["literal", [3, 4]]],
      ],
      paint: {
        "line-dasharray": LineStyles.DASH,
        "line-width": 2,
        "line-color": colour(mode, "CSTLN"),
      },
    },

    // Default → solid CSTLN
    {
      type: "line",
      filter: [
        "all",
        ["!=", ["geometry-type"], "Point"],
        ["!", lowQuality],
        [
          "any",
          ["!", ["has", "CONDTN"]],
          ["!", ["in", ["get", "CONDTN"], ["literal", [1, 2]]]],
        ],
        [
          "any",
          ["!", ["has", "CATSLC"]],
          ["!", ["in", ["get", "CATSLC"], ["literal", [6, 15, 16]]]],
        ],
        [
          "any",
          ["!", ["has", "WATLEV"]],
          ["!", ["in", ["get", "WATLEV"], ["literal", [3, 4]]]],
        ],
      ],
      paint: {
        "line-width": 2,
        "line-color": colour(mode, "CSTLN"),
      },
    },
  ];
}

/** SEABED01 - 13.2.14 Colour fill for depth areas */
export function SEABED01(config: LayerConfig): ExpressionSpecification {
  const { mode, shallowDepth, safetyDepth, deepDepth } = config;
  return [
    "case",
    [
      "all",
      [">=", ["var", "drval1"], deepDepth],
      [">", ["var", "drval2"], deepDepth],
    ],
    colour(mode, "DEPDW"),
    [
      "all",
      [">=", ["var", "drval1"], safetyDepth],
      [">", ["var", "drval2"], safetyDepth],
    ],
    colour(mode, "DEPMD"),
    [
      "all",
      [">=", ["var", "drval1"], shallowDepth],
      [">", ["var", "drval2"], shallowDepth],
    ],
    colour(mode, "DEPMS"),
    ["all", [">=", ["var", "drval1"], 0], [">", ["var", "drval2"], 0]],
    colour(mode, "DEPVS"),
    colour(mode, "DEPIT"),
  ];
}

/**
 * SNDFRM04 - 13.2.15 Symbolizing soundings, including safety depth
 * (S-52 PresLib 4.0, section 13.2.15)
 *
 * Formats a depth value as text for display. Called by SOUNDG03, WRECKS05,
 * and OBSTRN07 when features have a sounding value (DEPTH or VALSOU).
 *
 * The S-52 spec composites individual digit symbols (SOUNDG10, SOUNDG25, etc.).
 * MapLibre can't composite multiple symbols per feature, so we render as
 * formatted text instead, matching the visual intent:
 *   - Depths < 10: show one decimal (e.g. "3.5")
 *   - Depths 10–30: show one decimal if non-zero (e.g. "15.2"), else integer ("15")
 *   - Depths > 30: integer only ("45")
 *   - Colour: SNDG2 (shallow/black) when depth <= safetyDepth, SNDG1 (deep/grey) otherwise
 *
 * @param depthAttr - The attribute name containing the depth value ("DEPTH" or "VALSOU")
 * @param filter - Optional additional filter to apply to the layer
 */
export function SNDFRM04(
  config: LayerConfig,
  depthAttr: string = "DEPTH",
  filter?: ExpressionFilterSpecification,
): Partial<LayerSpecification> {
  const { mode, safetyDepth } = config;
  const depth: ExpressionSpecification = ["get", depthAttr];
  const absDepth: ExpressionSpecification = ["abs", depth];

  const textField: ExpressionSpecification = [
    "case",
    ["<", absDepth, 10],
    [
      "number-format",
      depth,
      { "min-fraction-digits": 1, "max-fraction-digits": 1 },
    ],
    ["all", ["<=", absDepth, 30], ["!=", ["%", absDepth, 1], 0]],
    [
      "number-format",
      depth,
      { "min-fraction-digits": 1, "max-fraction-digits": 1 },
    ],
    [
      "number-format",
      depth,
      { "min-fraction-digits": 0, "max-fraction-digits": 0 },
    ],
  ];

  const textColor: ExpressionSpecification = [
    "case",
    ["<=", depth, safetyDepth],
    colour(mode, "SNDG2"),
    colour(mode, "SNDG1"),
  ];

  return {
    type: "symbol",
    ...(filter ? { filter } : {}),
    layout: {
      "text-field": textField,
      "text-font": ["Metropolis Regular"],
      "text-size": 11,
      "text-allow-overlap": false,
      "symbol-placement": "point",
    },
    paint: {
      "text-color": textColor,
      "text-halo-color": colour(mode, "NODTA"),
      "text-halo-width": 1,
    },
  };
}

/**
 * SOUNDG03 - 13.2.16 Entry procedure for symbolizing soundings
 *
 * S-57 SOUNDG features are MultiPoint, but the tile pipeline splits them into
 * individual points with a DEPTH attribute (SPLIT_MULTIPOINT=ON, ADD_SOUNDG_DEPTH=ON).
 * Delegates to SNDFRM04 for depth value formatting.
 */
export function SOUNDG03(config: LayerConfig): Partial<LayerSpecification>[] {
  return [SNDFRM04(config, "DEPTH", ["has", "DEPTH"])];
}
/** SYMINS02 - 13.2.17 Symbolizing encoded objects specified by IMO */
// TOPSHP → symbol name lookup tables (S-52 PresLib 4.0, section 13.2.18)
// Floating platforms: buoys, light floats, light vessels
// Rigid platforms: beacons, daymarks, landmarks, etc.
// Exported for future use when pipeline adds _FLOATING attribute
export const TOPSHP_FLOATING: Record<number, string> = {
  1: "TOPMAR02",
  2: "TOPMAR04",
  3: "TOPMAR10",
  4: "TOPMAR12",
  5: "TOPMAR13",
  6: "TOPMAR14",
  7: "TOPMAR65",
  8: "TOPMAR17",
  9: "TOPMAR16",
  10: "TOPMAR08",
  11: "TOPMAR07",
  12: "TOPMAR14",
  13: "TOPMAR05",
  14: "TOPMAR06",
  15: "TMARDEF2",
  16: "TMARDEF2",
  17: "TMARDEF2",
  18: "TOPMAR10",
  19: "TOPMAR13",
  20: "TOPMAR14",
  21: "TOPMAR13",
  22: "TOPMAR14",
  23: "TOPMAR14",
  24: "TOPMAR02",
  25: "TOPMAR04",
  26: "TOPMAR10",
  27: "TOPMAR17",
  28: "TOPMAR18",
  29: "TOPMAR02",
  30: "TOPMAR17",
  31: "TOPMAR14",
  32: "TOPMAR10",
  33: "TMARDEF2",
};

const TOPSHP_RIGID: Record<number, string> = {
  1: "TOPMAR22",
  2: "TOPMAR24",
  3: "TOPMAR30",
  4: "TOPMAR32",
  5: "TOPMAR33",
  6: "TOPMAR34",
  7: "TOPMAR85",
  8: "TOPMAR86",
  9: "TOPMAR36",
  10: "TOPMAR28",
  11: "TOPMAR27",
  12: "TOPMAR14",
  13: "TOPMAR25",
  14: "TOPMAR26",
  15: "TOPMAR88",
  16: "TOPMAR87",
  17: "TMARDEF1",
  18: "TOPMAR30",
  19: "TOPMAR33",
  20: "TOPMAR34",
  21: "TOPMAR33",
  22: "TOPMAR34",
  23: "TOPMAR34",
  24: "TOPMAR22",
  25: "TOPMAR24",
  26: "TOPMAR30",
  27: "TOPMAR86",
  28: "TOPMAR89",
  29: "TOPMAR22",
  30: "TOPMAR86",
  31: "TOPMAR14",
  32: "TOPMAR30",
  33: "TMARDEF1",
};

/**
 * Build a MapLibre match expression for TOPSHP → symbol name.
 */
function topshpMatch(table: Record<number, string>, fallback: string) {
  const cases: (number | string)[] = [];
  for (const [topshp, symbol] of Object.entries(table)) {
    cases.push(Number(topshp), symbol);
  }
  return ["match", ["get", "TOPSHP"], ...cases, fallback];
}

/**
 * TOPMAR01 - 13.2.18 Topmarks (S-52 PresLib 4.0, section 13.2.18)
 *
 * Applies to S-57 object class TOPMAR (point only).
 * Attribute: TOPSHP (topmark/daymark shape)
 *
 * The symbol depends on TOPSHP and whether the topmark sits on a floating
 * platform (buoy, light float) or rigid platform (beacon, daymark).
 *
 * FIXME: Determining floating vs rigid requires a spatial co-location query
 * (is there a BOY*, LITFLT, or LITVES at the same position?). MapLibre can't
 * do this at render time. Currently defaults to rigid symbols. The s57 pipeline
 * should pre-compute a _FLOATING attribute for TOPMAR features.
 */
export function TOPMAR01(_config: LayerConfig): Partial<LayerSpecification>[] {
  // FIXME: When the pipeline adds _FLOATING, split into two layers:
  //   filter: ["==", ["get", "_FLOATING"], true]  → topshpMatch(TOPSHP_FLOATING, "TMARDEF2")
  //   filter: ["!=", ["get", "_FLOATING"], true]  → topshpMatch(TOPSHP_RIGID, "TMARDEF1")
  return [
    // No TOPSHP → question mark
    {
      type: "symbol",
      filter: ["!", ["has", "TOPSHP"]],
      layout: { "icon-image": "QUESMRK1", "icon-allow-overlap": true },
    },
    // Has TOPSHP → rigid platform symbol (default until _FLOATING is available)
    {
      type: "symbol",
      filter: ["has", "TOPSHP"],
      layout: {
        "icon-image": topshpMatch(
          TOPSHP_RIGID,
          "TMARDEF1",
        ) as ExpressionSpecification,
        "icon-allow-overlap": true,
      },
    },
  ];
}

/**
 * UDWHAZ05 - 13.2.20 Isolated dangers in general that endanger own ship
 * (S-52 PresLib 4.0, section 13.2.20)
 *
 * Not called directly from lookup tables -- used as a helper by WRECKS05 and OBSTRN07.
 *
 * FIXME: The full S-52 procedure spatially queries underlying DEPARE/DRGARE areas
 * to determine if a hazard lies within safe water (DRVAL1 >= safety contour).
 * This spatial check is not possible at MapLibre render time, so we conservatively
 * show ISODGR01 for all features with VALSOU <= safetyContour. The s57 pipeline
 * should pre-compute this and add it as a feature attribute.
 *
 * Skipped for WATLEV 1 (partly submerged) or 2 (always dry) per spec, as these
 * are above-water dangers that don't get the isolated danger symbol.
 */
export function UDWHAZ05(
  config: LayerConfig,
): Partial<LayerSpecification> | undefined {
  return {
    type: "symbol",
    filter: isolatedDanger(config),
    layout: {
      "icon-image": "ISODGR01",
      "icon-allow-overlap": true,
    },
  };
}

/**
 * Filter for features that are isolated dangers per UDWHAZ05:
 *   - VALSOU exists and <= safetyContour
 *   - WATLEV is NOT 1 (partly submerged) or 2 (always dry), i.e. feature is underwater
 */
export function isolatedDanger(
  config: LayerConfig,
): ExpressionFilterSpecification {
  return [
    "all",
    ["has", "VALSOU"],
    ["<=", ["get", "VALSOU"], config.safetyDepth],
    // WATLEV 1 (partly submerged) and 2 (always dry) are above-water dangers
    // that don't get the isolated danger symbol
    [
      "any",
      ["!", ["has", "WATLEV"]],
      ["!", ["in", ["get", "WATLEV"], ["literal", [1, 2]]]],
    ],
  ];
}

/**
 * Filter expression for features that are NOT isolated dangers.
 * Used by WRECKS05/OBSTRN07 to avoid double-symbolizing hazards
 * that are already shown with the ISODGR01 symbol.
 */
export function notIsolatedDanger(
  config: LayerConfig,
): ExpressionFilterSpecification {
  return ["!", isolatedDanger(config)];
}

/**
 * WRECKS05 - 13.2.21 Wrecks (S-52 PresLib 4.0, section 13.2.21)
 *
 * Applies to S-57 object class WRECKS (point and area).
 * Attributes: VALSOU, CATWRK, WATLEV, EXPSOU
 *
 * Point wrecks:
 *   - Isolated danger (VALSOU <= safetyContour, underwater) → ISODGR01
 *   - VALSOU <= safetyDepth → DANGER01 (shallow hazard)
 *   - VALSOU > safetyDepth → DANGER02 (deep hazard)
 *   - No VALSOU → symbol based on CATWRK/WATLEV from lookup table
 *
 * Area wrecks:
 *   - Fill: CHBRN (WATLEV 1,2), DEPIT (WATLEV 4), DEPVS (default/3/5)
 *   - Line: dotted CHBLK if danger or shallow, dashed CHBLK if deep, else by WATLEV
 */
export function WRECKS05(config: LayerConfig): Partial<LayerSpecification>[] {
  const { mode, safetyDepth } = config;
  const isDanger = isolatedDanger(config);
  const notDanger = notIsolatedDanger(config);

  return [
    // --- Point wrecks ---

    // Isolated danger: ISODGR01 (from UDWHAZ05)
    {
      type: "symbol",
      filter: ["all", ["==", ["geometry-type"], "Point"], isDanger],
      layout: {
        "icon-image": "ISODGR01",
        "icon-allow-overlap": true,
      },
    },

    // Has sounding, shallow (not isolated danger) → DANGER01
    {
      type: "symbol",
      filter: [
        "all",
        ["==", ["geometry-type"], "Point"],
        notDanger,
        ["has", "VALSOU"],
        ["<=", ["get", "VALSOU"], safetyDepth],
      ],
      layout: {
        "icon-image": "DANGER01",
        "icon-allow-overlap": true,
      },
    },

    // Has sounding, deep (not isolated danger) → DANGER02
    {
      type: "symbol",
      filter: [
        "all",
        ["==", ["geometry-type"], "Point"],
        notDanger,
        ["has", "VALSOU"],
        [">", ["get", "VALSOU"], safetyDepth],
      ],
      layout: {
        "icon-image": "DANGER02",
        "icon-allow-overlap": true,
      },
    },

    // Sounding text on top of DANGER symbols (SNDFRM04)
    SNDFRM04(config, "VALSOU", [
      "all",
      ["==", ["geometry-type"], "Point"],
      notDanger,
      ["has", "VALSOU"],
    ]),

    // No sounding → symbol by CATWRK/WATLEV (S-52 Continuation A lookup table)
    {
      type: "symbol",
      filter: [
        "all",
        ["==", ["geometry-type"], "Point"],
        ["!", ["has", "VALSOU"]],
      ],
      layout: {
        "icon-image": [
          "case",
          // WATLEV 1 (partly submerged) or 2 (always dry) → visible wreck
          ["in", ["get", "WATLEV"], ["literal", [1, 2]]],
          "WRECKS01",
          // WATLEV 4 (covers/uncovers) → drying wreck
          ["==", ["get", "WATLEV"], 4],
          "WRECKS01",
          // CATWRK 1 (non-dangerous) + WATLEV 3 (always underwater)
          ["all", ["==", ["get", "CATWRK"], 1], ["==", ["get", "WATLEV"], 3]],
          "WRECKS04",
          // CATWRK 2 (dangerous) + WATLEV 3
          ["all", ["==", ["get", "CATWRK"], 2], ["==", ["get", "WATLEV"], 3]],
          "WRECKS05",
          // CATWRK 4 or 5 (showing mast/funnel)
          ["in", ["get", "CATWRK"], ["literal", [4, 5]]],
          "WRECKS01",
          // Default
          "WRECKS05",
        ] as ExpressionSpecification,
        "icon-allow-overlap": true,
      },
    },

    // --- Area wrecks ---

    // Area fill based on WATLEV
    {
      type: "fill",
      filter: ["==", ["geometry-type"], "Polygon"],
      paint: {
        "fill-color": [
          "case",
          // WATLEV 1,2 → land/brown
          ["in", ["get", "WATLEV"], ["literal", [1, 2]]],
          colour(mode, "CHBRN"),
          // WATLEV 4 → intertidal
          ["==", ["get", "WATLEV"], 4],
          colour(mode, "DEPIT"),
          // Default (3, 5, or missing) → very shallow
          colour(mode, "DEPVS"),
        ] as ExpressionSpecification,
      },
    },

    // Area outline: dotted for dangers/shallow, dashed for deep, default by WATLEV
    {
      type: "line",
      filter: [
        "all",
        ["==", ["geometry-type"], "Polygon"],
        [
          "any",
          isDanger,
          ["all", ["has", "VALSOU"], ["<=", ["get", "VALSOU"], safetyDepth]],
        ],
      ],
      paint: {
        "line-dasharray": LineStyles.DOTT,
        "line-width": 2,
        "line-color": colour(mode, "CHBLK"),
      },
    },
    {
      type: "line",
      filter: [
        "all",
        ["==", ["geometry-type"], "Polygon"],
        notDanger,
        ["has", "VALSOU"],
        [">", ["get", "VALSOU"], safetyDepth],
      ],
      paint: {
        "line-dasharray": LineStyles.DASH,
        "line-width": 2,
        "line-color": colour(mode, "CHBLK"),
      },
    },
    // No VALSOU, WATLEV 1,2 → solid line
    {
      type: "line",
      filter: [
        "all",
        ["==", ["geometry-type"], "Polygon"],
        ["!", ["has", "VALSOU"]],
        ["in", ["get", "WATLEV"], ["literal", [1, 2]]],
      ],
      paint: {
        "line-width": 2,
        "line-color": colour(mode, "CSTLN"),
      },
    },
    // No VALSOU, WATLEV 4 → dashed line
    {
      type: "line",
      filter: [
        "all",
        ["==", ["geometry-type"], "Polygon"],
        ["!", ["has", "VALSOU"]],
        ["==", ["get", "WATLEV"], 4],
      ],
      paint: {
        "line-dasharray": LineStyles.DASH,
        "line-width": 2,
        "line-color": colour(mode, "CSTLN"),
      },
    },
    // No VALSOU, other WATLEV → dotted line
    {
      type: "line",
      filter: [
        "all",
        ["==", ["geometry-type"], "Polygon"],
        ["!", ["has", "VALSOU"]],
        ["!", ["in", ["get", "WATLEV"], ["literal", [1, 2, 4]]]],
      ],
      paint: {
        "line-dasharray": LineStyles.DOTT,
        "line-width": 2,
        "line-color": colour(mode, "CSTLN"),
      },
    },

    // Sounding text on area wrecks with VALSOU (SNDFRM04)
    SNDFRM04(config, "VALSOU", [
      "all",
      ["==", ["geometry-type"], "Polygon"],
      notDanger,
      ["has", "VALSOU"],
    ]),

    // Area wreck isolated danger symbol at center
    {
      type: "symbol",
      filter: ["all", ["==", ["geometry-type"], "Polygon"], isDanger],
      layout: {
        "icon-image": "ISODGR01",
        "icon-allow-overlap": true,
      },
    },
  ];
}
