import {
  ExpressionFilterSpecification,
  ExpressionSpecification,
  LayerSpecification,
} from "maplibre-gl";
import { Reference } from "./parser.js";
import { colour } from "@enc-tiles/s52";
import { LineStyles } from "./SHOWLINE.js";
import { quaposLowQuality } from "../filters.js";
import type { LayerConfig } from "../symbolology/index.js";

const procs = { DEPARE03, DEPCNT03, RESTRN01, SOUNDG03, WRECKS05 };

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
/** TODO: LIGHTS06 - 13.2.4 Light flares, light sectors & light coverage */
/** TODO: LITDSN02 - 10.6.3 Light description text string */
/** TODO: OBSTRN07 - 13.2.5 Obstructions and rocks */
/** TODO: QUAPOS01 - 13.2.6 Quality(accuracy) of position */
/** TODO: QUALIN01 - 13.2.7 Quality of position of line objects */
/** TODO: QUAPNT02 - 13.2.8 Quality of position of point and area objects */
/** TODO: RESARE04 - 13.2.9 Restricted areas - object class RESARE  */

/** RESTRN01 - 13.2.10 Entry procedure for restrictions */
export function RESTRN01(_config: LayerConfig): Partial<LayerSpecification>[] {
  return [
    // {
    //   filter: ['has', 'RESTRN'],
    // }
  ];
}

/** TODO: RESCSP02 - 13.2.11 Restrictions – attribute RESTRN */

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

/** SLCONS04 - 13.2.13 Shoreline constructions, including accuracy of position */

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

/** SNDFRM04 - 13.2.15 Symbolizing soundings, including safety depth */

/**
 * SOUNDG03 - 13.2.16 Entry procedure for symbolizing soundings
 *
 * S-57 SOUNDG features are MultiPoint, but the tile pipeline splits them into
 * individual points with a DEPTH attribute (SPLIT_MULTIPOINT=ON, ADD_SOUNDG_DEPTH=ON).
 *
 * The S-52 spec composites individual digit symbols (SOUNDG10, SOUNDG25, etc.) to render
 * depth values. MapLibre can't composite multiple symbols per feature, so we render
 * soundings as formatted text instead, matching the visual intent:
 *   - Depths < 10: show one decimal (e.g. "3.5")
 *   - Depths 10–30: show one decimal if non-zero (e.g. "15.2"), else integer ("15")
 *   - Depths > 30: integer only ("45")
 *   - Negative depths (drying heights): prefixed with minus
 *   - Colour: SNDG2 (shallow/black) when depth <= safetyDepth, SNDG1 (deep/grey) otherwise
 */
export function SOUNDG03(config: LayerConfig): Partial<LayerSpecification>[] {
  const { mode, safetyDepth } = config;
  const depth: ExpressionSpecification = ["get", "DEPTH"];
  const absDepth: ExpressionSpecification = ["abs", depth];

  // S-52 formatting rules for sounding values
  const textField: ExpressionSpecification = [
    "case",
    // Depths < 10: always show one decimal
    ["<", absDepth, 10],
    [
      "number-format",
      depth,
      { "min-fraction-digits": 1, "max-fraction-digits": 1 },
    ],
    // Depths 10–30: show one decimal if fractional part is non-zero
    ["all", ["<=", absDepth, 30], ["!=", ["%", absDepth, 1], 0]],
    [
      "number-format",
      depth,
      { "min-fraction-digits": 1, "max-fraction-digits": 1 },
    ],
    // Otherwise: integer only
    [
      "number-format",
      depth,
      { "min-fraction-digits": 0, "max-fraction-digits": 0 },
    ],
  ];

  // Colour by depth relative to safety depth
  const textColor: ExpressionSpecification = [
    "case",
    ["<=", depth, safetyDepth],
    colour(mode, "SNDG2"),
    colour(mode, "SNDG1"),
  ];

  return [
    {
      type: "symbol",
      filter: ["has", "DEPTH"],
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
    },
  ];
}
/** SYMINS02 - 13.2.17 Symbolizing encoded objects specified by IMO */
/** TOPMAR01 - 13.2.18 Topmarks */

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
