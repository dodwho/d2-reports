import { GeoGeometryObjects, GeoPermissibleObjects, GeoProjection, geoArea, geoPath } from "d3-geo";

type Position = number[];
type Ring = Position[];

export type Geometry = { type: "Polygon"; coordinates: Ring[] } | { type: "MultiPolygon"; coordinates: Ring[][] };

/**
 * Puts polygon rings in the winding order d3 expects.
 *
 * GeoJSON (RFC 7946) winds outer rings anticlockwise; d3 works on the sphere and reads that as
 * "everything except this country", filling the whole globe. A polygon whose area comes out larger
 * than a hemisphere has been read inside out, and reversing its rings puts it right. Shapes already
 * in d3's order are left alone, so the source's convention does not need to be known.
 */
export function toD3Geometry(geometry: Geometry): Geometry {
    return geometry.type === "Polygon"
        ? { type: "Polygon", coordinates: fixPolygon(geometry.coordinates) }
        : { type: "MultiPolygon", coordinates: geometry.coordinates.map(fixPolygon) };
}

function fixPolygon(rings: Ring[]): Ring[] {
    const area = geoArea({ type: "Polygon", coordinates: rings } as GeoGeometryObjects);
    return area > 2 * Math.PI ? rings.map(ring => [...ring].reverse()) : rings;
}

/**
 * An SVG path string rounded to whole screen units, dropping points that round onto the previous
 * one. At map scale that removes most of the vertices in detailed coastlines, which keeps the page
 * light, with no difference anyone can see.
 */
export function roundedPath(projection: GeoProjection, object: GeoPermissibleObjects): string {
    const parts: string[] = [];
    let last = "";

    const context = {
        moveTo(x: number, y: number) {
            last = `${Math.round(x)},${Math.round(y)}`;
            parts.push(`M${last}`);
        },
        lineTo(x: number, y: number) {
            const point = `${Math.round(x)},${Math.round(y)}`;
            if (point !== last) parts.push(`L${point}`);
            last = point;
        },
        closePath() {
            parts.push("Z");
        },
        arc() {
            // Only used for point geometries, which country shapes never are.
        },
    };

    geoPath(projection, context as unknown as CanvasRenderingContext2D)(object);
    return parts.join("");
}
