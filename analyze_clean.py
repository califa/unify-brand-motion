"""Analyze clean reference frames to extract exact scale/rotation per frame."""
from PIL import Image
import numpy as np
import math

frames_dir = "reference-clean"

def analyze_square(mask, canvas_size=1080):
    """Find corners of a square from its stroke pixels."""
    if not mask.any():
        return None
    
    # Get all dark pixel coordinates
    ys, xs = np.where(mask)
    if len(xs) < 10:
        return None
    
    # Bounding box
    x_min, x_max = xs.min(), xs.max()
    y_min, y_max = ys.min(), ys.max()
    cx = (x_min + x_max) / 2
    cy = (y_min + y_max) / 2
    
    # Diagonal of bounding box = estimate of shape extent
    diag = math.sqrt((x_max - x_min)**2 + (y_max - y_min)**2)
    
    # Estimate size: for a square at rotation r, bbox diagonal = side * sqrt(2) * max(|cos r| + |sin r|)
    # For simplicity, use the average of width and height as proxy
    bbox_w = x_max - x_min
    bbox_h = y_max - y_min
    
    return {
        "center": (round(cx, 1), round(cy, 1)),
        "bbox_w": int(bbox_w),
        "bbox_h": int(bbox_h),
        "n_pixels": int(len(xs)),
        "diag": round(diag, 1),
    }

print("Frame | Inner pixels | Inner bbox | Outer pixels | Outer bbox")
print("-" * 75)

for i in range(1, 121):
    path = f"{frames_dir}/frame_{i:03d}.png"
    img = np.array(Image.open(path).convert("L"))
    
    # Tight threshold for crisp strokes (no blur, no effect)
    mask = img < 200
    
    if not mask.any():
        if i <= 25 or i % 10 == 0:
            print(f"  {i:3d}  | (empty)")
        continue
    
    ys, xs = np.where(mask)
    n = len(xs)
    x_min, x_max = int(xs.min()), int(xs.max())
    y_min, y_max = int(ys.min()), int(ys.max())
    cx = (x_min + x_max) / 2
    cy = (y_min + y_max) / 2
    bbox_w = x_max - x_min
    bbox_h = y_max - y_min
    
    # Try to separate inner and outer square by clustering
    # The inner square pixels are closer to center
    if i >= 35:  # both squares visible
        # Compute distance from center for each pixel
        center_x, center_y = 540, 540
        dists = np.sqrt((xs - center_x)**2 + (ys - center_y)**2)
        median_dist = np.median(dists)
        
        inner_mask_idx = dists < median_dist
        outer_mask_idx = dists >= median_dist
        
        inner_n = inner_mask_idx.sum()
        outer_n = outer_mask_idx.sum()
        
        if inner_n > 20 and outer_n > 20:
            inner_xs = xs[inner_mask_idx]
            inner_ys = ys[inner_mask_idx]
            outer_xs = xs[outer_mask_idx]
            outer_ys = ys[outer_mask_idx]
            
            inner_bbox = f"{inner_xs.max()-inner_xs.min()}x{inner_ys.max()-inner_ys.min()}"
            outer_bbox = f"{outer_xs.max()-outer_xs.min()}x{outer_ys.max()-outer_ys.min()}"
            
            print(f"  {i:3d}  | {inner_n:6d} px  {inner_bbox:>10s} | {outer_n:6d} px  {outer_bbox:>10s}")
            continue
    
    print(f"  {i:3d}  | {n:6d} px  {bbox_w}x{bbox_h}  center=({cx:.0f},{cy:.0f})")

