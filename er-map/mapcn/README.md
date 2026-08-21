# lumia-map

[mapcn](https://mapcn.dev) layer for **Eternal Return**'s Lumia Island — 21 areas
(바지선 included), hover and select, restricted zones, and an estimate of where a
target could be by now.

```tsx
import { LumiaMap, LumiaAreaLayer } from "@/components/ui/lumia-map";

<LumiaMap theme="dark" className="h-dvh w-dvw">
  <LumiaAreaLayer
    sighting="Pond"          // where they were last seen
    elapsedSeconds={28}      // how long ago
    speedMultiplier={1}      // boots, traits, hyperloops
    restricted={["Alley", "Temple"]}
    basemap="/lumia-minimap.png"
    onAreaClick={(area) => setSighting(area.key)}
  />
</LumiaMap>
```

Out of the box the layer also draws the **11 credit kiosks** (`showKiosks`) and paints
**open water with shallows stepping out from the coast** (`showWater`, `oceanColor`,
`shelfColor`), so the island reads as an island instead of a shape on a flat colour.
Kiosk positions come from the same trace — the gold hexagons are found by hue on the
minimap, so they move when the map does.

## Putting the real minimap underneath

```tsx
<LumiaAreaLayer sighting="Pond" elapsedSeconds={28} basemap="/lumia-minimap.png" />
```

`LUMIA_IMAGE_COORDINATES` pins the picture to the same coordinate space as the areas —
fitted by matching the lattice against the boundary lines actually drawn on the minimap,
not by eye. `../trace-areas.py` also writes `minimap-masked.png`: the same picture alpha-masked down
to the island it traced (otherwise a grey vignetted rectangle sits under everything) plus
the corner coordinates for the crop it produced.

With a basemap the markers drop the area names — the picture already has them — and show
only arrival times. Override with `labelMode="name" | "eta" | "none"`.

The picture is not shipped with this component; supply your own copy.

The island is fictional, so its 21 areas sit on a synthetic patch of the equator where a
degree of longitude and a degree of latitude are the same length — shapes stay undistorted
and `<Map blank>` keeps any street basemap out of the way.

Geometry is **traced off the minimap**, not approximated: `../trace-areas.py` seeds one
marker per area from the diamond lattice in `data.js`, then runs a watershed over the
border strokes the game actually draws, so every polygon lands on the real border and the
coastline keeps its ragged edge. Neighbours come from the same pass — two areas are
neighbours when they share a run of at least 15 border pixels, which is why there are 42
borders and not the lattice's tidy 34. Every feature carries its own neighbour list, so
the layer needs no separate graph file.

`hopSeconds` (default 7) is how long one border crossing takes at base movement speed.
Measure it in game and override — it is the one number the reachability estimate rests on.

## Demo

The demo board is **the map and nothing else** — a voice agent drives it, so there are no
on-screen controls. Everything it needs hangs off `window.lumia`:

```js
lumia.sight("Barge")        // move the last sighting
lumia.elapse(28)            // seconds since
lumia.speedTo(1.3)          // movement speed multiplier
lumia.restrict("Harbor")    // announce a restricted zone
lumia.allow("Harbor")
lumia.state                 // { sighting, elapsed, speed, restricted }
lumia.areas / lumia.kiosks  // the 21 areas and 11 kiosks
```

URL params seed the initial state: `?from=Pond&t=28&ban=Alley,Temple&speed=1.2`, and
`?plain` drops the minimap picture for the flat-colour version.

```sh
cd demo && npm install && npm run build && npm run preview   # http://localhost:4173
node check-ui.mjs                                            # drives the bridge, asserts it took
```

## Two known traps, already handled here

- GeoJSON features must **not** carry a string `id`. MapLibre drops the whole source and
  the map renders empty with no error. `promoteId: "key"` gives features a stable id from
  their properties instead.
- Label markers need `pointer-events: none`, or they swallow clicks meant for the area
  underneath.
