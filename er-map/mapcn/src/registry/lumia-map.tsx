"use client";

import { useCallback, useEffect, useMemo, type ComponentProps } from "react";
import { LngLatBounds } from "maplibre-gl";

import { Map, MapGeoJSON, MapMarker, MarkerContent, useMap } from "@/components/ui/map";

import areasData from "./lumia-areas.json";

/**
 * Lumia Island (Eternal Return) areas for mapcn.
 *
 * The island is not a real place, so the 21 areas live on a synthetic patch of the
 * equator where a degree of longitude and a degree of latitude are the same length.
 * Geometry is traced off the in-game minimap itself, so the borders are the ones the
 * game draws rather than a tidy grid. Each feature carries its own neighbour list, so
 * the layer needs no separate graph file.
 */

/** Longitude/latitude box the island occupies, ready for `fitBounds`. */
export const LUMIA_BOUNDS: [[number, number], [number, number]] = [
  [-0.23992, -0.31564],
  [0.22016, 0.26955],
];

/**
 * Where the corners of the in-game minimap land in this coordinate space, as
 * [top-left, top-right, bottom-right, bottom-left]. Fitted by matching the lattice
 * against the boundary lines actually drawn on the minimap, so a picture dropped in
 * through `basemap` sits under its own areas. Assumes `minimap-masked.png` as written
 * by `trace-areas.py`, which cuts the picture to the island it traced.
 */
export const LUMIA_IMAGE_COORDINATES: [
  [number, number], [number, number], [number, number], [number, number],
] = [
  [-0.26749, 0.27243],
  [0.24774, 0.27243],
  [0.24774, -0.32016],
  [-0.26749, -0.32016],
];

/** Seconds to cross one area border at base movement speed. Measure and override. */
export const DEFAULT_HOP_SECONDS = 7;

export type LumiaArea = {
  /** Stable English key, e.g. "Barge". Also the GeoJSON feature id. */
  key: string;
  /** Korean name shown on the map, e.g. "바지선". */
  name: string;
  /** Area id used by the dak.gg data API. */
  areaId: number;
  /** How many lattice cells seeded this area (1 or 2). */
  cells: number;
  /** Keys of the areas sharing a border with this one. */
  neighbours: string[];
  /** Label anchor as [longitude, latitude]. */
  center: [number, number];
};

type AreaFeature = { properties: LumiaArea };
type AreaCollection = {
  features: AreaFeature[];
  kiosks: { at: [number, number]; area: string | null }[];
};

const AREAS = areasData as unknown as AreaCollection;

/**
 * Areas someone could have reached by now, given where they were last seen.
 * A restricted zone is neither a destination nor a corridor, so banning one walls
 * off everything behind it. Returns key -> earliest arrival in seconds.
 */
export function reachableAreas(
  features: AreaFeature[],
  from: string,
  budgetSeconds: number,
  hopSeconds: number,
  restricted: ReadonlySet<string>,
): globalThis.Map<string, number> {
  const dist = new globalThis.Map<string, number>();
  if (!from || restricted.has(from)) return dist;

  const links = new globalThis.Map(
    features.map((f) => [f.properties.key, f.properties.neighbours]),
  );
  if (!links.has(from)) return dist;

  dist.set(from, 0);
  const queue: [number, string][] = [[0, from]];
  while (queue.length) {
    queue.sort((a, b) => a[0] - b[0]);
    const [d, cur] = queue.shift()!;
    if (d > (dist.get(cur) ?? Infinity)) continue;
    for (const next of links.get(cur) ?? []) {
      if (restricted.has(next)) continue;
      const nd = d + hopSeconds;
      if (nd <= budgetSeconds && nd < (dist.get(next) ?? Infinity)) {
        dist.set(next, nd);
        queue.push([nd, next]);
      }
    }
  }
  return dist;
}

/** Blend a hex colour toward the land tone; `weight` 0–1. */
function blend(hex: string, weight: number, base: string) {
  const parse = (h: string) => [1, 3, 5].map((i) => parseInt(h.slice(i, i + 2), 16));
  const [r1, g1, b1] = parse(hex);
  const [r2, g2, b2] = parse(base);
  const mix = (a: number, b: number) => Math.round(a * weight + b * (1 - weight));
  return `rgb(${mix(r1, r2)}, ${mix(g1, g2)}, ${mix(b1, b2)})`;
}

/**
 * Paints what sits under the island instead of leaving the map transparent. A flat slab
 * of colour reads as a hole in the page, so a seamless tile is used when one is supplied
 * and the colour is only the fallback while it loads.
 */
function Backdrop({ color, texture }: { color: string; texture?: string }) {
  const { map, isLoaded } = useMap();

  useEffect(() => {
    if (!isLoaded || !map || !map.getLayer("background")) return;
    map.setPaintProperty("background", "background-color", color);
    if (!texture) return;

    let dropped = false;
    const name = "lumia-backdrop";
    map.loadImage(texture)
      .then(({ data }) => {
        if (dropped || !map.getLayer("background")) return;
        if (!map.hasImage(name)) map.addImage(name, data);
        map.setPaintProperty("background", "background-pattern", name);
      })
      .catch(() => {
        // no texture, the flat colour already applied stands in
      });

    return () => {
      dropped = true;
      try {
        if (map.getLayer("background")) {
          map.setPaintProperty("background", "background-pattern", undefined);
        }
        if (map.hasImage(name)) map.removeImage(name);
      } catch {
        // style may be mid-reload
      }
    };
  }, [isLoaded, map, color, texture]);

  return null;
}

/**
 * Drops the minimap picture under the areas. Rendered after `<MapGeoJSON>` so the
 * region layers already exist and `beforeId` can slide the picture beneath them.
 */
function IslandImage({ url, opacity, beforeId }:
  { url: string; opacity: number; beforeId: string }) {
  const { map, isLoaded } = useMap();

  useEffect(() => {
    if (!isLoaded || !map) return;
    const id = "lumia-minimap";

    map.addSource(id, { type: "image", url, coordinates: LUMIA_IMAGE_COORDINATES });
    map.addLayer(
      { id, type: "raster", source: id,
        paint: { "raster-opacity": opacity, "raster-fade-duration": 0 } },
      map.getLayer(beforeId) ? beforeId : undefined,
    );

    return () => {
      try {
        if (map.getLayer(id)) map.removeLayer(id);
        if (map.getSource(id)) map.removeSource(id);
      } catch {
        // style may be mid-reload
      }
    };
  }, [isLoaded, map, url, opacity, beforeId]);

  return null;
}

export type LumiaAreaLayerProps = {
  /** Where the target was last seen, as an area key. */
  sighting?: string;
  /** Seconds since that sighting. Drives how far the reachable set spreads. */
  elapsedSeconds?: number;
  /** Movement speed multiplier — boots, traits, a hyperloop-heavy route. */
  speedMultiplier?: number;
  /** Areas announced as restricted. Unreachable and impassable. */
  restricted?: readonly string[];
  /** Seconds per border crossing at 1.0× speed. */
  hopSeconds?: number;
  /** Fired when an area is clicked. */
  onAreaClick?: (area: LumiaArea) => void;
  /** Fired when the hovered area changes; `null` when the cursor leaves the island. */
  onAreaHover?: (area: LumiaArea | null) => void;
  /**
   * What the per-area markers say. `"name"` draws the Korean name with the arrival
   * time beside it; `"eta"` drops the name, which is what you want over a `basemap`
   * that already has names printed on it. Defaults to `"eta"` when a basemap is set.
   */
  labelMode?: "name" | "eta" | "none";
  /** Base fill for an area with nothing to say about it. */
  landColor?: string;
  /** Fill for the sighting itself. */
  accentColor?: string;
  /** Fill for reachable areas — stronger the sooner they can be reached. */
  reachColor?: string;
  /** Fill for restricted areas. */
  restrictedColor?: string;
  /** Zoom the map to the island once it loads. */
  fitOnLoad?: boolean;
  /**
   * URL of the in-game minimap to show under the areas. Supply your own copy — the
   * picture is not shipped with this component. Aligned via `LUMIA_IMAGE_COORDINATES`.
   */
  basemap?: string;
  /** How strongly the minimap reads through. */
  basemapOpacity?: number;
  /** Fill opacity for the areas. Drops automatically when a `basemap` is shown. */
  fillOpacity?: number;
  /** Mark the 11 credit kiosks. */
  showKiosks?: boolean;
  /** Paint open water under the island instead of leaving the map transparent. */
  showWater?: boolean;
  /** Colour under the island — also the fallback while `backdropTexture` loads. */
  oceanColor?: string;
  /** URL of a seamless tile to lay under the island, so the ground is not a flat slab. */
  backdropTexture?: string;
};

/**
 * Renders the 21 Lumia Island areas on any mapcn `<Map>`, and tints them by where
 * the target could be. Drop it inside `<LumiaMap>` or a `<Map blank>` of your own.
 */
export function LumiaAreaLayer({
  sighting,
  elapsedSeconds = 0,
  speedMultiplier = 1,
  restricted,
  hopSeconds = DEFAULT_HOP_SECONDS,
  onAreaClick,
  onAreaHover,
  landColor = "#1a2338",
  accentColor = "#4c8dff",
  reachColor = "#2fbe8f",
  restrictedColor = "#e0525e",
  fitOnLoad = true,
  basemap,
  labelMode = basemap ? "eta" : "name",
  basemapOpacity = 1,
  fillOpacity = basemap ? 0 : 0.92,
  showKiosks = true,
  showWater = true,
  oceanColor = "#040d15",
  backdropTexture,
}: LumiaAreaLayerProps) {
  const { map, isLoaded } = useMap();

  useEffect(() => {
    if (!fitOnLoad || !isLoaded || !map) return;
    map.fitBounds(new LngLatBounds(LUMIA_BOUNDS[0], LUMIA_BOUNDS[1]), {
      padding: 40,
      duration: 0,
    });
  }, [fitOnLoad, isLoaded, map]);

  const shut = useMemo(() => new Set(restricted ?? []), [restricted]);
  const reach = useMemo(
    () =>
      sighting
        ? reachableAreas(
            AREAS.features,
            sighting,
            elapsedSeconds,
            hopSeconds / speedMultiplier,
            shut,
          )
        : new globalThis.Map<string, number>(),
    [sighting, elapsedSeconds, hopSeconds, speedMultiplier, shut],
  );

  // One `match` expression over the feature key beats 21 layers.
  const fillPaint = useMemo(() => {
    const stops: (string | number)[] = [];
    for (const feature of AREAS.features) {
      const key = feature.properties.key;
      const arrival = reach.get(key);
      let color = landColor;
      if (shut.has(key)) color = blend(restrictedColor, 0.42, landColor);
      else if (key === sighting) color = blend(accentColor, 0.62, landColor);
      else if (arrival !== undefined) {
        const freshness = 1 - arrival / Math.max(elapsedSeconds, hopSeconds);
        color = blend(reachColor, 0.2 + 0.44 * Math.max(0, freshness), landColor);
      }
      stops.push(key, color);
    }
    return {
      "fill-color": ["match", ["get", "key"], ...stops, landColor],
      "fill-opacity": fillOpacity,
    } as never;
  }, [reach, shut, sighting, elapsedSeconds, hopSeconds, landColor, accentColor,
      reachColor, restrictedColor, fillOpacity]);

  // mapcn hands over a single `feature`, not a list — reading `features[0]` silently
  // yields undefined and the layer looks dead.
  const handleClick = useCallback(
    (e: { feature: { properties: LumiaArea } }) => onAreaClick?.(e.feature.properties),
    [onAreaClick],
  );

  const handleHover = useCallback(
    (e: { feature: { properties: LumiaArea } } | null) =>
      onAreaHover?.(e?.feature.properties ?? null),
    [onAreaHover],
  );

  return (
    <>
      {showWater && <Backdrop color={oceanColor} texture={backdropTexture} />}
      <MapGeoJSON
        id="lumia-areas"
        data={areasData as never}
        promoteId="key"
        interactive
        fillPaint={fillPaint}
        fillHoverPaint={{ "fill-opacity": Math.min(1, fillOpacity + 0.22) } as never}
        linePaint={{ "line-color": "#8fa39c", "line-width": 2, "line-opacity": 1 } as never}
        onClick={handleClick}
        onHover={handleHover}
      />
      {basemap && (
        <IslandImage url={basemap} opacity={basemapOpacity} beforeId="geojson-fill-lumia-areas" />
      )}
      {labelMode !== "none" &&
        AREAS.features.map((feature) => (
          <MapMarker
            key={feature.properties.key}
            // labels must not swallow clicks meant for the area underneath them
            className="pointer-events-none"
            longitude={feature.properties.center[0]}
            latitude={feature.properties.center[1]}
          >
            <MarkerContent>
              <span
                className="pointer-events-none select-none whitespace-nowrap text-[13px]
                           font-medium text-slate-100"
                style={{ textShadow: "0 0 4px #080c15, 0 0 4px #080c15" }}
              >
                {labelMode === "name" ? feature.properties.name : null}
                {reach.get(feature.properties.key) ? (
                  <em className="ml-1 not-italic text-[11px] tabular-nums text-[#28c0cb]">
                    {Math.round(reach.get(feature.properties.key)!)}초
                  </em>
                ) : null}
              </span>
            </MarkerContent>
          </MapMarker>
        ))}
      {showKiosks &&
        AREAS.kiosks.map((kiosk, i) => (
          <MapMarker key={`kiosk-${i}`} className="pointer-events-none"
            longitude={kiosk.at[0]} latitude={kiosk.at[1]}>
            <MarkerContent>
              <span
                title="크레딧 키오스크"
                className="block h-[13px] w-[13px] bg-[#efc102] shadow-[0_0_6px_rgba(0,0,0,.9)]"
                style={{ clipPath:
                  "polygon(50% 0%, 93% 25%, 93% 75%, 50% 100%, 7% 75%, 7% 25%)" }}
              />
            </MarkerContent>
          </MapMarker>
        ))}
    </>
  );
}

/** A mapcn `<Map>` already framed on Lumia Island, with no street basemap under it. */
export function LumiaMap({ children, ...props }: ComponentProps<typeof Map>) {
  return (
    <Map blank {...props}>
      {children}
    </Map>
  );
}

/** Every area, in map order — handy for building lists and pickers. */
export const LUMIA_AREAS: LumiaArea[] = AREAS.features.map((f) => f.properties);

/** The 11 credit kiosks, as [longitude, latitude] plus the area each one stands in. */
export const LUMIA_KIOSKS = AREAS.kiosks;
