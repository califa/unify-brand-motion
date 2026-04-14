"""Analyze no-effect reference frames to extract exact scale/rotation per frame."""
import os
from PIL import Image
import numpy as np
import json

frames_dir = "reference-noeffect"
results = {}

for i in range(1, 121):
    path = os.path.join(frames_dir, f"frame_{i:03d}.png")
    img = np.array(Image.open(path).convert("L"))  # grayscale
    
    # Background is ~255 (off-white), strokes are dark
    # Find non-background pixels (threshold at 240)
    mask = img < 240
    
    if not mask.any():
        results[i] = {"visible": False}
        continue
    
    # Get bounding box of all visible content
    rows = np.any(mask, axis=1)
    cols = np.any(mask, axis=0)
    rmin, rmax = np.where(rows)[0][[0, -1]]
    cmin, cmax = np.where(cols)[0][[0, -1]]
    
    # Center of bounding box
    cy = (rmin + rmax) / 2
    cx = (cmin + cmax) / 2
    
    # Bounding box size
    w = cmax - cmin
    h = rmax - rmin
    
    results[i] = {
        "visible": True,
        "bbox": [int(cmin), int(rmin), int(cmax), int(rmax)],
        "bbox_size": [int(w), int(h)],
        "center": [round(cx, 1), round(cy, 1)],
    }

# Print key frames
for f in [15, 18, 20, 22, 25, 28, 30, 32, 35, 38, 40, 45, 50, 55, 60, 120]:
    r = results.get(f, {})
    if r.get("visible"):
        print(f"Frame {f:3d}: bbox_size={r['bbox_size']} center={r['center']}")
    else:
        print(f"Frame {f:3d}: not visible")

