import { test, describe, expect } from "vitest";
import {
  attributeFilters,
  attvToJsonString,
  listIncludes,
  listExcludes,
} from "../src/filters.js";

describe("attributeFilters", () => {
  test("presence of attributes", () => {
    const attc = [
      {
        attl: "CAT_TS3",
        attv: "",
      },
      {
        attl: "ORIENT",
        attv: "",
      },
    ];

    expect(attributeFilters(attc)).toEqual([
      ["has", "CAT_TS3"],
      ["has", "ORIENT"],
    ]);
  });

  test("exclusion of attributes", () => {
    const attc = [
      {
        attl: "DRVAL1",
        attv: "?",
      },
      {
        attl: "DRVAL2",
        attv: "?",
      },
    ];

    expect(attributeFilters(attc)).toEqual([
      ["!", ["has", "DRVAL1"]],
      ["!", ["has", "DRVAL2"]],
    ]);
  });

  test("scalar attribute values match directly", () => {
    const attc = [{ attl: "BCNSHP", attv: "1" }];

    expect(attributeFilters(attc)).toEqual([["==", ["get", "BCNSHP"], "1"]]);
  });

  test("multi-value list attributes are converted to JSON array strings", () => {
    const attc = [
      { attl: "COLOUR", attv: "3,4,3" },
      { attl: "BCNSHP", attv: "2" },
    ];

    expect(attributeFilters(attc)).toEqual([
      ["==", ["get", "COLOUR"], '["3","4","3"]'],
      ["==", ["get", "BCNSHP"], "2"],
    ]);
  });

  test("single-value list attributes are also converted to JSON array strings", () => {
    const attc = [
      { attl: "COLOUR", attv: "3" },
      { attl: "CATREA", attv: "27" },
    ];

    expect(attributeFilters(attc)).toEqual([
      ["==", ["get", "COLOUR"], '["3"]'],
      ["==", ["get", "CATREA"], '["27"]'],
    ]);
  });
});

describe("attvToJsonString", () => {
  test("converts comma-separated values to JSON array string", () => {
    expect(attvToJsonString("3,4,3")).toBe('["3","4","3"]');
    expect(attvToJsonString("4,3,4")).toBe('["4","3","4"]');
  });

  test("converts single value to single-element JSON array", () => {
    expect(attvToJsonString("3")).toBe('["3"]');
  });
});

describe("listIncludes", () => {
  test("single value membership test", () => {
    expect(listIncludes("RESTRN", "7")).toEqual([
      "in",
      '"7"',
      ["get", "RESTRN"],
    ]);
  });

  test("multiple value membership test (any of)", () => {
    expect(listIncludes("RESTRN", "7", "8", "14")).toEqual([
      "any",
      ["in", '"7"', ["get", "RESTRN"]],
      ["in", '"8"', ["get", "RESTRN"]],
      ["in", '"14"', ["get", "RESTRN"]],
    ]);
  });
});

describe("listExcludes", () => {
  test("negates membership test", () => {
    expect(listExcludes("CATLIT", "5", "6")).toEqual([
      "!",
      [
        "any",
        ["in", '"5"', ["get", "CATLIT"]],
        ["in", '"6"', ["get", "CATLIT"]],
      ],
    ]);
  });
});
