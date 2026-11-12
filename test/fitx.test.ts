import { describe, expect, it } from "vitest";
import { parseProfile, parseWorkloadResponse } from "../src/fitx";

const entry = {
  name: "Berlin-East Side Mall",
  alias: "berlin-east-side-mall",
  branchId: 82,
  status: 2,
  hideWorkload: null,
  location: { lat: 52.5064596, lon: 13.4460136 },
  workload: { term: "full", percentage: 111, source: "capacity" },
};

describe("parseWorkloadResponse", () => {
  it("unwraps the JSON-string-in-array shape", () => {
    const { studio, workload } = parseWorkloadResponse([JSON.stringify(entry)]);
    expect(studio).toEqual({
      branchId: 82,
      name: "Berlin-East Side Mall",
      alias: "berlin-east-side-mall",
      lat: 52.5064596,
      lon: 13.4460136,
    });
    expect(workload).toEqual({ percentage: 111, term: "full", source: "capacity", hidden: false, status: 2 });
  });

  it("keeps the studio when the workload is missing or hidden", () => {
    const { workload } = parseWorkloadResponse([JSON.stringify({ ...entry, workload: null, hideWorkload: true })]);
    expect(workload).toEqual({ percentage: null, term: null, source: null, hidden: true, status: 2 });
  });

  it("rejects responses without a studio", () => {
    expect(() => parseWorkloadResponse([])).toThrow();
    expect(() => parseWorkloadResponse(["{}"])).toThrow(/branchId/);
  });
});

describe("parseProfile", () => {
  const grid = Array.from({ length: 7 }, (_, d) => Array.from({ length: 24 }, (_, h) => d * 100 + h));

  it("reads the 7x24 grid from the page", () => {
    const html = `<div data-controller="studio" data-visitordata="${JSON.stringify(grid)}"></div>`;
    expect(parseProfile(html)).toEqual(grid);
  });

  it("rejects a missing or malformed grid", () => {
    expect(() => parseProfile("<div></div>")).toThrow(/not found/);
    expect(() => parseProfile(`<div data-visitordata="[[1,2]]"></div>`)).toThrow(/7x24/);
  });
});
