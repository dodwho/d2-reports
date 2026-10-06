import { geoArea, geoEqualEarth } from "d3-geo";
import { Geometry, roundedPath, toD3Geometry } from "../geometry";

// A 10°×10° square wound anticlockwise, as GeoJSON (RFC 7946) specifies for outer rings.
const anticlockwise: Geometry = {
    type: "Polygon",
    coordinates: [
        [
            [0, 0],
            [10, 0],
            [10, 10],
            [0, 10],
            [0, 0],
        ],
    ],
};

const area = (geometry: Geometry) => geoArea(geometry as never);

describe("toD3Geometry", () => {
    it("turns an RFC 7946 polygon, which d3 reads as the rest of the globe, the right way out", () => {
        expect(area(anticlockwise)).toBeGreaterThan(2 * Math.PI);
        expect(area(toD3Geometry(anticlockwise))).toBeLessThan(0.1);
    });

    it("leaves a polygon already in d3's order unchanged", () => {
        const fixed = toD3Geometry(anticlockwise);
        expect(toD3Geometry(fixed)).toEqual(fixed);
    });

    it("fixes each part of a multipolygon independently", () => {
        const fixed = toD3Geometry(anticlockwise);
        const mixed: Geometry = {
            type: "MultiPolygon",
            coordinates: [anticlockwise.coordinates, fixed.coordinates as never],
        };
        const result = toD3Geometry(mixed);

        expect(result.type).toBe("MultiPolygon");
        (result.coordinates as never[]).forEach(polygon => {
            expect(area({ type: "Polygon", coordinates: polygon })).toBeLessThan(0.1);
        });
    });
});

describe("roundedPath", () => {
    it("draws a closed outline in whole units", () => {
        const projection = geoEqualEarth().fitSize([100, 100], toD3Geometry(anticlockwise) as never);
        const path = roundedPath(projection, toD3Geometry(anticlockwise) as never);

        expect(path.startsWith("M")).toBe(true);
        expect(path.endsWith("Z")).toBe(true);
        expect(path).not.toMatch(/\.\d/);
    });
});
