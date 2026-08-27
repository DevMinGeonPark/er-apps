"""Strip the clutter off the minimap so the borders are the only thing left to trace.

Removes the community route overlay (magenta paths and the wolf sprites strung along it)
and the area name plates. Kiosks, hyperloops and campfires stay — they are landmarks, not
clutter. Masked pixels are filled by diffusing their neighbours inward.

    python3 clean-minimap.py minimap.png minimap-clean.png
"""
import sys
import numpy as np
from PIL import Image
from scipy import ndimage as ndi

SRC = sys.argv[1] if len(sys.argv) > 1 else "minimap.png"
OUT = sys.argv[2] if len(sys.argv) > 2 else "minimap-clean.png"

rgb = np.asarray(Image.open(SRC).convert("RGB")).astype(np.float32)
H, W = rgb.shape[:2]
r, g, b = rgb[..., 0], rgb[..., 1], rgb[..., 2]
grey = rgb.mean(2)
sat = rgb.max(2) - rgb.min(2)

# The route overlay: magenta strokes, and the sprites they are drawn around.
magenta = (r > 120) & (r - g > 45) & (b - g > 10)
route = ndi.binary_dilation(
    ndi.binary_fill_holes(ndi.binary_closing(magenta, np.ones((9, 9)))) | magenta,
    np.ones((5, 5)))

# The name plates. Their positions are already known, so each one is lifted by taking the
# dark plate that contains its centre — detection by brightness alone kept missing the
# fainter ones.
PLATES = [(427, 31), (294, 53), (600, 155), (459, 175), (186, 187), (286, 245), (409, 269),
          (600, 272), (102, 273), (475, 341), (356, 342), (642, 375), (280, 392),
          (115, 416), (486, 441), (191, 507), (419, 514), (597, 563), (277, 579),
          (370, 639), (524, 643)]
dark, _ = ndi.label(ndi.binary_closing(grey < 78, np.ones((3, 5))))
plates = np.zeros((H, W), bool)
found = 0
for x, y in PLATES:
    tag = dark[y, x]
    box = (dark == tag) if tag else np.zeros((H, W), bool)
    ys, xs = np.nonzero(box)
    plate_like = (
        len(ys)
        and box.sum() < 3200                       # a plate, not a dark stretch of ground
        and ys.max() - ys.min() < 34
        and xs.max() - xs.min() < 150
    )
    if plate_like:
        y0, y1 = max(0, ys.min() - 6), min(H, ys.max() + 7)
        x0, x1 = max(0, xs.min() - 8), min(W, xs.max() + 9)
    else:                                           # fall back to a stamp over the centre
        y0, y1, x0, x1 = max(0, y - 16), min(H, y + 17), max(0, x - 48), min(W, x + 49)
    plates[y0:y1, x0:x1] = True
    found += 1

hole = route | plates
out = rgb.copy()
out[hole] = np.nan
for _ in range(160):
    known = (~np.isnan(out)).astype(np.float32)
    avg = ndi.uniform_filter(np.nan_to_num(out), size=(5, 5, 1))
    cover = ndi.uniform_filter(known, size=(5, 5, 1))
    guess = np.divide(avg, cover, out=np.zeros_like(avg), where=cover > 0)
    out = np.where(np.isnan(out) & (cover > 0), guess, out)
    if not np.isnan(out).any():
        break

Image.fromarray(np.nan_to_num(out, nan=float(np.nanmedian(rgb))).astype(np.uint8)).save(OUT)
print(f"{OUT} — removed {int(route.sum())} px of route, {found} name plates")
