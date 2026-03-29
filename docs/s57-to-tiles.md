# S-57 to Vector Tiles: Attribute Encoding

The MVT (Mapbox Vector Tile) format only supports scalar property values — string,
number, and bool. There is no array type. S-57 defines many **list-type attributes**
(StringList) that hold multiple values per feature:

| Attribute | Description       | Example                           |
| --------- | ----------------- | --------------------------------- |
| COLOUR    | Colour(s)         | `["3","4","3"]` (red, green, red) |
| RESTRN    | Restriction(s)    | `["7","8"]`                       |
| CATLIT    | Category of light | `["4","13"]`                      |
| STATUS    | Status            | `["1","2"]`                       |
| COLPAT    | Colour pattern    | `["1"]`                           |
| NATSUR    | Nature of surface | `["9","11"]`                      |

These must be serialized to strings for MVT tiles. This document describes the
encoding that the S-52 styles in this project expect, and how to produce it.

## Required Encoding

List-type attributes must be stored as **compact JSON array strings** — no whitespace:

```
COLOUR = '["3"]'           -- single value
COLOUR = '["3","4","3"]'   -- multiple values (order preserved)
RESTRN = '["7","8","14"]'  -- multiple values
```

Scalar attributes are stored as-is:

```
BCNSHP = "1"
VALDCO = 10.0
OBJNAM = "Foo Rock"
```

Each S-57 object class becomes a vector tile layer with the same name:
`LIGHTS`, `BCNLAT`, `DEPARE`, `SOUNDG`, etc.

## How to Produce This Encoding

The recommended pipeline is **S-57 → GeoJSON → tippecanoe**. The GeoJSON
intermediate step is what produces the correct compact encoding.

### S-57 → GeoJSON → tippecanoe (recommended)

```sh
# Convert one layer to GeoJSON (arrays become native JSON arrays)
ogr2ogr -f GeoJSON BOYLAT.geojson input.000 BOYLAT

# Convert to tiles (tippecanoe serializes arrays as compact JSON strings)
tippecanoe -o output.pmtiles BOYLAT.geojson
```

The full chain:

```
S-57: COLOUR = [3, 4, 3]  (StringList)
  ↓ ogr2ogr → GeoJSON
GeoJSON: "COLOUR": ["3", "4", "3"]  (native JSON array)
  ↓ tippecanoe
MVT tile: COLOUR = '["3","4","3"]'  (string, compact)
```

### S-57 → GeoPackage → GeoJSON → tippecanoe

If you need an intermediate database (e.g., for spatial queries or merging
multiple charts), GeoPackage works. GDAL automatically converts StringList
to `String(JSON)` when writing to GeoPackage:

```sh
# S-57 → GeoPackage (do NOT use -mapFieldType StringList=String)
ogr2ogr -f GPKG chart.gpkg input.000

# GeoPackage → GeoJSON (restores native arrays)
ogr2ogr -f GeoJSON BOYLAT.geojson chart.gpkg BOYLAT

# GeoJSON → tiles
tippecanoe -o output.pmtiles BOYLAT.geojson
```

If you need to be explicit about the conversion, use
`-mapFieldType StringList=String(JSON),IntegerList=String(JSON)`.

### What does NOT work

**`-mapFieldType StringList=String`** (without `(JSON)`) produces OGR's internal
count-prefixed format:

```
COLOUR = "(3:3,4,3)"   -- unusable
```

**Direct `ogr2ogr -f PMTiles`** (S-57 straight to vector tiles) produces JSON
arrays with whitespace:

```
COLOUR = '[ "3", "4", "3" ]'   -- spaces break exact matching
```

The S-52 styles use exact string matching and expect the compact format `'["3","4","3"]'`.

## Style Matching

The S-52 styles use two patterns to match list-type attribute values:

### Exact Ordered Match (Lookup Tables)

The S-52 lookup table encodes list values as comma-separated strings (e.g., `"3,4,3"`).
The style generator converts these to JSON array strings for exact matching:

```
Lookup ATTC: COLOUR = "3,4,3"
  ↓ converted to
Filter: ["==", ["get", "COLOUR"], '["3","4","3"]']
```

This preserves the S-52 requirement that "the match to the object must be exact, in
order as well as content" (S-52 10.3.3.1).

### Membership Test (CSPs)

Conditional Symbology Procedures frequently test whether a list attribute contains
specific values. For example, RESARE04 asks "Does RESTRN include 7 or 8 or 14?"

The JSON string encoding makes this safe using MapLibre's `in` (substring) expression.
The surrounding quotes act as natural delimiters, preventing false matches:

```js
// Does RESTRN include "7"?
["in", '"7"', ["get", "RESTRN"]];

// On '["7","8","14"]' → searches for '"7"' → true (correct)
// On '["17"]'         → searches for '"7"' in '["17"]' → false (correct, no false positive)
```

The `listIncludes` helper generates these expressions:

```js
// Does RESTRN include 7 or 8 or 14?
listIncludes("RESTRN", "7", "8", "14");
// → ["any",
//     ["in", '"7"', ["get", "RESTRN"]],
//     ["in", '"8"', ["get", "RESTRN"]],
//     ["in", '"14"', ["get", "RESTRN"]]]
```

## Excluded Fields

The following S-57 internal fields are excluded from tiles as they are not useful
for rendering:

- `LNAM_REFS`, `FFPT_RIND`, `LNAM` — Internal cross-references and identifiers
- `PRIM`, `GRUP`, `OBJL` — Primitive type, group, object label (redundant with layer name)
- `RVER`, `AGEN`, `FIDN`, `FIDS` — Record version, agency, feature IDs
- `RECDAT`, `RECIND`, `SORDAT`, `SORIND` — Record/source dates and indicators
