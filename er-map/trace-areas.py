"""Trace the real area boundaries off the in-game minimap.

Writes three things from one picture:
  lumia-areas.json / .js  the 21 areas as real polygons, with their real neighbours
                          and the kiosk markers
  minimap-masked.png      the same picture cut to the island, ready to sit under them

A watershed over the border strokes does the tracing. Seeds come from the diamond lattice
in data.js, which is a good enough guide to *where* the areas are; names do not, because
that lattice had several eastern cells one area off and quietly renamed half the map.
Names are taken instead from the name plates the map itself draws — each plate is matched
to the basin it falls in, and the offshore plates of the outer ring to what is left.

The label positions below are pixel coordinates in `minimap.png`. Swap the picture and
they have to be re-read.

Needs scikit-image:
    python3 trace-areas.py minimap.png
"""
import json, subprocess, sys
import numpy as np
from PIL import Image, ImageDraw, ImageFilter
from scipy import ndimage as ndi
from skimage.measure import approximate_polygon, find_contours
from skimage.morphology import disk, opening, skeletonize, white_tophat
from skimage.segmentation import watershed

SRC = sys.argv[1] if len(sys.argv) > 1 else "minimap.png"
OUT = "lumia-areas.json"

UNIT = 0.05          # degrees per lattice step of the synthetic equator patch
R, OX, OY = 60.75, 370, 331   # lattice -> pixel, fitted to the borders the map draws
MIN_BORDER_PX = 15   # shorter contacts are corner touches, not shared borders
SIMPLIFY_PX = 2.0

# Centre of each area's name plate. Plates for the outer ring sit offshore; those get
# walked inland before they are used as seeds.
LABELS = {
    "골목길": (427, 31), "주유소": (294, 53), "절": (600, 155), "경찰서": (459, 175),
    "양궁장": (186, 187), "학교": (286, 245), "소방서": (409, 269), "개울": (600, 272),
    "호텔": (102, 273), "연못": (475, 341), "연구소": (356, 342), "병원": (642, 375),
    "숲": (280, 392), "모래사장": (115, 416), "묘지": (486, 441), "고급 주택가": (191, 507),
    "성당": (419, 514), "공장": (597, 563), "창고": (277, 579), "항구": (370, 639),
    "바지선": (524, 643),
}

areas = json.loads(subprocess.run(
    ["node", "-e", "console.log(JSON.stringify(require('./data.js').ER_AREAS))"],
    capture_output=True, text=True, check=True).stdout)
by_name = {a["name"]: a for a in areas}
assert set(by_name) == set(LABELS), "data.js and the label table disagree on the area list"

raw = np.asarray(Image.open(SRC).convert("RGB")).astype(np.float32)
H, W = raw.shape[:2]


def scrub_overlay(pix):
    """Paint out the community route overlay — the magenta paths and the wolf sprites
    strung along them. They are somebody's routing advice, not part of the map. Masked
    pixels are diffused in from their neighbours; this is only a backdrop, so a soft
    smear where a sprite used to be is fine."""
    r, g, b = pix[..., 0], pix[..., 1], pix[..., 2]
    magenta = (r > 120) & (r - g > 45) & (b - g > 10)
    blob = ndi.binary_fill_holes(ndi.binary_closing(magenta, np.ones((9, 9))))
    hole = ndi.binary_dilation(blob | magenta, np.ones((5, 5)))

    out = pix.copy()
    out[hole] = np.nan
    for _ in range(90):
        known = (~np.isnan(out)).astype(np.float32)
        avg = ndi.uniform_filter(np.nan_to_num(out), size=(5, 5, 1))
        cover = ndi.uniform_filter(known, size=(5, 5, 1))
        guess = np.divide(avg, cover, out=np.zeros_like(avg), where=cover > 0)
        out = np.where(np.isnan(out) & (cover > 0), guess, out)
        if not np.isnan(out).any():
            break
    print(f"  scrubbed {int(hole.sum())} px of route overlay")
    return np.nan_to_num(out, nan=float(np.nanmedian(pix)))


# Scrub first: the overlay has to go before the borders are looked for. Blanking the
# coloured pixels instead would punch a zero-cost channel through every border a route
# crosses, and the watershed then leaks a tendril through it.
rgb = scrub_overlay(raw)

# Borders are thin light strokes — brighter than the ground immediately around them.
grey = rgb.mean(2)
ridge = np.clip(grey - ndi.uniform_filter(grey, 21), 0, None)
ridge = ndi.maximum_filter(ridge, 3)     # bridge the gaps where a border fades out


def border_network(grey):
    """The drawn borders, as a one-pixel-wide network.

    A soft ridge alone lets a basin drift across a faint border. The borders themselves are
    long straight strokes running along the map's two diagonals (with short axis-aligned
    jogs), so a directional opening keeps them and throws away buildings, roads and icons,
    which are blobs. What survives is skeletonised and its spurs cut off, leaving only
    line work that a basin must not cross.
    """
    def line(length, angle):
        se = np.zeros((length, length), bool)
        c = length // 2
        a = np.deg2rad(angle)
        for t in np.linspace(-c, c, length * 4):
            x, y = int(round(c + t * np.cos(a))), int(round(c - t * np.sin(a)))
            if 0 <= x < length and 0 <= y < length:
                se[y, x] = True
        return se

    lit = white_tophat(grey, disk(4)) > 18
    lines = np.zeros_like(lit)
    for angle in (45, 135):
        lines |= opening(lit, line(21, angle))
    for angle in (0, 90):
        lines |= opening(lit, line(11, angle))

    skel = skeletonize(ndi.binary_closing(lines, disk(3)))

    # cut spurs: a branch that dead-ends after a few pixels is clutter, not a border
    for _ in range(10):
        neighbours = ndi.convolve(skel.astype(np.uint8), np.ones((3, 3), np.uint8),
                                  mode="constant") - skel
        tips = skel & (neighbours <= 1)
        if not tips.any():
            break
        skel &= ~tips
    return skel


barrier = border_network(grey)
print(f"  border network: {int(barrier.sum())} px")

DIAGS = [(1, 1), (1, -1), (-1, 1), (-1, -1)]
cell_of = {(x, y): a["key"] for a in areas for x, y in a["cells"]}


def lattice_ring(area):
    """Outer edges of an area's cells, chained into one closed loop."""
    edges = [((x + dx, y), (x, y + dy)) for x, y in area["cells"] for dx, dy in DIAGS
             if cell_of.get((x + dx, y + dy)) != area["key"]]
    links = {}
    for a, b in edges:
        links.setdefault(a, []).append(b)
        links.setdefault(b, []).append(a)
    start = edges[0][0]
    ring, prev, cur = [start], None, start
    while True:
        nxt = next((p for p in links[cur] if p != prev), None)
        if nxt is None or nxt == start:
            return ring
        ring.append(nxt)
        prev, cur = cur, nxt


# A detected border is a wall, not a suggestion.
walled = ridge + barrier * 400.0


def flood(markers):
    m = markers.copy()
    m[0, :] = m[-1, :] = m[:, 0] = m[:, -1] = 1      # everything offshore
    return watershed(walled, m)


# Pass 1 — lattice seeds. Their placement is only good enough to find the shoreline, which
# is all this pass is for; the interior borders it draws are not trusted.
rough = np.zeros((H, W), np.int32)
for i, area in enumerate(areas, start=2):
    ring = [(x * R + OX, y * R + OY) for x, y in lattice_ring(area)]
    cx = sum(p[0] for p in ring) / len(ring)
    cy = sum(p[1] for p in ring) / len(ring)
    seed = Image.new("I", (W, H), 0)
    ImageDraw.Draw(seed).polygon(
        [(cx + (x - cx) * 0.45, cy + (y - cy) * 0.45) for x, y in ring], fill=i)
    rough[np.asarray(seed) == i] = i
shore = ndi.binary_fill_holes(flood(rough) > 1)

# Pass 2 — one seed per name plate. A plate on land seeds where it stands; the outer
# ring's plates sit offshore and are walked in until they are clear of the shoreline.
inland = ndi.binary_erosion(shore, np.ones((3, 3)), iterations=12)
# An offshore plate belongs to the area it is drawn beside, so it enters the island at the
# nearest point of the shore — walking toward the middle of the map would cut across a
# neighbour instead.
_, nearest_inland = ndi.distance_transform_edt(~inland, return_indices=True)

# A seed pressed against a border loses the basin to whichever neighbour is better placed,
# so each one is walked uphill on distance-from-any-border until it sits in open ground.
# Borders are barriers, so the climb cannot leave the area it started in.
openness = ndi.distance_transform_edt(ridge < 12)


def settle(x, y, steps=30):
    for _ in range(steps):
        window = openness[max(0, y - 1):y + 2, max(0, x - 1):x + 2]
        dy, dx = np.unravel_index(np.argmax(window), window.shape)
        ny, nx = y + dy - (1 if y else 0), x + dx - (1 if x else 0)
        if (nx, ny) == (x, y):
            break
        x, y = nx, ny
    return x, y


def seed_point(name):
    x, y = LABELS[name]
    if not inland[y, x]:
        x, y = int(nearest_inland[1][y, x]), int(nearest_inland[0][y, x])
    return settle(x, y)


# Pass 2 — one seed per area, placed by its own name plate. Each seed is grown until it
# nearly touches its nearest neighbour, so no area is left with a seed too small to hold
# its ground against a better-placed one.
plates = sorted(LABELS)
points = {name: seed_point(name) for name in plates}

markers = np.zeros((H, W), np.int32)
for i, name in enumerate(plates, start=2):
    sx, sy = points[name]
    gap = min(((sx - ox) ** 2 + (sy - oy) ** 2) ** 0.5
              for other, (ox, oy) in points.items() if other != name)
    r = max(10, min(34, gap * 0.42))
    seed = Image.new("I", (W, H), 0)
    ImageDraw.Draw(seed).ellipse([sx - r, sy - r, sx + r, sy + r], fill=i)
    markers[(np.asarray(seed) == i) & shore] = i

labels = flood(markers)
# Coastal water next to a basin gets claimed by it, which drags a polygon out to sea.
# Pass 1 already found the shoreline, so everything beyond it goes back to being offshore.
labels = np.where(shore, labels, 1)

order = plates
for i, name in enumerate(order, start=2):
    lx, ly = LABELS[name]
    if not inland[ly, lx]:
        continue          # an outer-ring plate is drawn offshore; nothing to check there
    owner = int(labels[ly, lx])
    if owner != i:
        raise SystemExit(f"{name}'s plate landed in {order[owner - 2]} — seeds are off")

# Real adjacency: two areas are neighbours when they share a run of border pixels.
contact = {}
for dy, dx in ((0, 1), (1, 0)):
    a, b = labels[:H - dy, :W - dx], labels[dy:, dx:]
    touching = (a != b) & (a > 1) & (b > 1)
    for p, q in zip(a[touching], b[touching]):
        contact[(min(p, q), max(p, q))] = contact.get((min(p, q), max(p, q)), 0) + 1

neighbours = {name: [] for name in order}
for (p, q), n in sorted(contact.items()):
    if n < MIN_BORDER_PX:
        print(f"  dropped {order[p-2]}–{order[q-2]}: {n}px contact")
        continue
    neighbours[order[p - 2]].append(order[q - 2])
    neighbours[order[q - 2]].append(order[p - 2])

to_lonlat = lambda x, y: [round((x - OX) / R * UNIT, 5), round(-(y - OY) / R * UNIT, 5)]

# Kiosks are the little yellow "C" hexagons. The glyph splits each one into pieces, so
# the pieces are merged before they are counted.
hsv = np.asarray(Image.fromarray(raw.astype(np.uint8), "RGB").convert("HSV")).astype(np.float32)
hue, sat, val = hsv[..., 0] * 360 / 255, hsv[..., 1] / 255, hsv[..., 2] / 255
gold = (hue > 40) & (hue < 75) & (sat > 0.55) & (val > 0.6)
blobs, _ = ndi.label(ndi.binary_closing(ndi.binary_dilation(gold, np.ones((5, 5))), np.ones((7, 7))))
kiosks = []
for bid in [i for i, n in enumerate(np.bincount(blobs.ravel())) if i and n >= 150]:
    ky, kx = ndi.center_of_mass(gold, blobs, bid)
    owner = labels[int(round(ky)), int(round(kx))]
    kiosks.append({"at": to_lonlat(kx, ky),
                   "area": by_name[order[owner - 2]]["key"] if owner > 1 else None})
print(f"  {len(kiosks)} kiosks")

island = ndi.binary_fill_holes(labels > 1)

# The picture doubles as the basemap, so cut it to the island the watershed found.
grown = ndi.binary_dilation(island, ndi.generate_binary_structure(2, 2), iterations=26)
soft = np.asarray(Image.fromarray((grown * 255).astype(np.uint8))
                  .filter(ImageFilter.GaussianBlur(9))).astype(np.float32) / 255

# The render carries a pale glow just off the coast. Kept as-is it reads as fog sitting on
# the water, so everything outside the coastline is sunk toward the sea colour — dark
# enough to disappear, light enough that the map's own outside labels still read.
inland = np.asarray(Image.fromarray((island * 255).astype(np.uint8))
                    .filter(ImageFilter.GaussianBlur(2))).astype(np.float32) / 255
# Grade the terrain darker and punchier so the board matches the look it is styled after:
# the raw render is washed out next to the near-black backdrop it now sits on.
TARGET_MEAN, TARGET_SPREAD = 63.6, 34.0
lit = island & (rgb.mean(2) > 45)
mean = rgb[lit].mean(0)
spread = rgb[lit].std(0).mean()
graded = np.clip((rgb - mean) * (TARGET_SPREAD / spread) + TARGET_MEAN, 0, 255)
print(f"  graded terrain {rgb[lit].mean():.0f} -> {graded[lit].mean():.0f}")

sea = np.array([4, 13, 21], np.float32)   # the backdrop colour
offshore = graded * 0.22 + sea * 0.78
blend = graded * inland[..., None] + offshore * (1 - inland[..., None])
shot = Image.fromarray(np.dstack([blend, (soft ** 1.6) * 255]).astype(np.uint8), "RGBA")
ys, xs = np.nonzero(grown)
box = (max(0, xs.min() - 8), max(0, ys.min() - 8), min(W, xs.max() + 8), min(H, ys.max() + 8))
shot.crop(box).save("minimap-masked.png")
print("minimap-masked.png — crop %s, corners %s" % (
    box, [to_lonlat(box[0], box[1]), to_lonlat(box[2], box[1]),
          to_lonlat(box[2], box[3]), to_lonlat(box[0], box[3])]))

features = []
for i, name in enumerate(order, start=2):
    mask = np.pad(labels == i, 1)
    contour = max(find_contours(mask.astype(float), 0.5), key=len)
    ring = [to_lonlat(c - 1, r - 1) for r, c in approximate_polygon(contour, SIMPLIFY_PX)]
    if ring[0] != ring[-1]:
        ring.append(ring[0])

    # label anchor: the point furthest from any border, so it never lands on an edge
    far = ndi.distance_transform_edt(labels == i)
    ay, ax = np.unravel_index(np.argmax(far), far.shape)

    area = by_name[name]
    features.append({
        "type": "Feature",
        "properties": {
            "key": area["key"], "name": name, "areaId": area["id"],
            "neighbours": sorted(by_name[n]["key"] for n in neighbours[name]),
            "center": to_lonlat(ax, ay),
        },
        "geometry": {"type": "Polygon", "coordinates": [ring]},
    })
    print(f"  {name:<10} {len(ring):>4} pts  {len(neighbours[name])} neighbours")

lons = [c[0] for f in features for c in f["geometry"]["coordinates"][0]]
lats = [c[1] for f in features for c in f["geometry"]["coordinates"][0]]
collection = {"type": "FeatureCollection",
              "bbox": [min(lons), min(lats), max(lons), max(lats)],
              "kiosks": kiosks,
              "features": features}
json.dump(collection, open(OUT, "w"), ensure_ascii=False, indent=1)

# same data as a plain script, so a page opened straight off disk can use it too
with open("lumia-areas.js", "w") as fh:
    fh.write("// Generated by trace-areas.py — do not edit by hand.\n")
    fh.write("var LUMIA = " + json.dumps(collection, ensure_ascii=False, indent=1) + ";\n")
    fh.write('if (typeof module !== "undefined") module.exports = { LUMIA };\n')

print(f"{OUT} — {len(features)} areas, "
      f"{sum(len(v) for v in neighbours.values()) // 2} borders, bbox "
      f"{min(lons):.3f} {min(lats):.3f} {max(lons):.3f} {max(lats):.3f}")
