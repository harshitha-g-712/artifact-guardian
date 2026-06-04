"""
preprocessing.py  —  OpenCV image preprocessing, heatmap, comparison
"""
import base64
import cv2
import numpy as np

TARGET_SIZE = (224, 224)


def load_bytes(file_bytes: bytes) -> np.ndarray:
    arr = np.frombuffer(file_bytes, np.uint8)
    img = cv2.imdecode(arr, cv2.IMREAD_COLOR)
    if img is None:
        raise ValueError("Cannot decode image — unsupported or corrupted file.")
    return img


def enhance_contrast(img: np.ndarray) -> np.ndarray:
    lab = cv2.cvtColor(img, cv2.COLOR_BGR2LAB)
    l, a, b = cv2.split(lab)
    clahe = cv2.createCLAHE(clipLimit=2.0, tileGridSize=(8, 8))
    return cv2.cvtColor(cv2.merge([clahe.apply(l), a, b]), cv2.COLOR_LAB2BGR)


def compute_fading_score(img: np.ndarray) -> float:
    hsv = cv2.cvtColor(img, cv2.COLOR_BGR2HSV)
    mean_sat = float(np.mean(hsv[:, :, 1])) / 255.0
    return round(1.0 - mean_sat, 4)


def compute_crack_features(img: np.ndarray) -> dict:
    gray = cv2.cvtColor(img, cv2.COLOR_BGR2GRAY)
    blurred = cv2.GaussianBlur(gray, (5, 5), 0)
    edges = cv2.Canny(blurred, 50, 150)
    density = float(np.sum(edges > 0)) / edges.size
    return {"edge_density": round(density, 4), "suspected_crack": density > 0.08}


def generate_damage_heatmap(img: np.ndarray) -> str:
    """Return base64 JPEG of heatmap overlay."""
    gray = cv2.cvtColor(img, cv2.COLOR_BGR2GRAY)
    diff = cv2.absdiff(gray, cv2.GaussianBlur(gray, (21, 21), 0))
    norm = cv2.normalize(diff, None, 0, 255, cv2.NORM_MINMAX).astype(np.uint8)
    heatmap = cv2.applyColorMap(norm, cv2.COLORMAP_JET)
    overlay = cv2.addWeighted(img, 0.6, heatmap, 0.4, 0)
    _, buf = cv2.imencode('.jpg', overlay, [int(cv2.IMWRITE_JPEG_QUALITY), 85])
    return base64.b64encode(buf).decode('utf-8')


def compare_images(bytes_before: bytes, bytes_after: bytes) -> dict:
    """
    Compute pixel-diff between two images.
    Returns metrics + a clearly visible difference heatmap (never black).
    """
    img_b = load_bytes(bytes_before)
    img_a = load_bytes(bytes_after)

    # Use a larger display size so the diff map is clearly visible
    DISPLAY_SIZE = (600, 600)
    b = cv2.resize(img_b, DISPLAY_SIZE)
    a = cv2.resize(img_a, DISPLAY_SIZE)

    # Raw pixel difference
    diff = cv2.absdiff(b, a)
    gray_diff = cv2.cvtColor(diff, cv2.COLOR_BGR2GRAY)

    # ── Key fix: AMPLIFY the difference so it is always visible ──
    # Even if images are almost identical, amplify x10 then normalize
    amplified = cv2.multiply(gray_diff, np.array([10.0]))          # ×10 boost
    amplified = np.clip(amplified, 0, 255).astype(np.uint8)

    # Normalize to full 0-255 range so darkest diff still shows colour
    normalized = cv2.normalize(amplified, None, 0, 255, cv2.NORM_MINMAX).astype(np.uint8)

    # Apply a vivid colormap (JET: blue=no change → red=big change)
    colored = cv2.applyColorMap(normalized, cv2.COLORMAP_JET)

    # Blend diff map with the "after" image so context is visible
    overlay = cv2.addWeighted(a, 0.45, colored, 0.55, 0)

    # Draw a colour legend bar at the bottom
    legend_h = 28
    legend = np.zeros((legend_h, DISPLAY_SIZE[0], 3), dtype=np.uint8)
    for x in range(DISPLAY_SIZE[0]):
        val = int(x / DISPLAY_SIZE[0] * 255)
        colour = cv2.applyColorMap(np.array([[val]], dtype=np.uint8), cv2.COLORMAP_JET)[0][0]
        legend[:, x] = colour
    cv2.putText(legend, 'No Change', (4, 19), cv2.FONT_HERSHEY_SIMPLEX, 0.45, (255,255,255), 1)
    cv2.putText(legend, 'High Change', (DISPLAY_SIZE[0]-95, 19), cv2.FONT_HERSHEY_SIMPLEX, 0.45, (255,255,255), 1)
    final = np.vstack([overlay, legend])

    _, buf = cv2.imencode('.jpg', final, [int(cv2.IMWRITE_JPEG_QUALITY), 92])
    diff_b64 = base64.b64encode(buf).decode('utf-8')

    # Metrics
    raw_mean = float(np.mean(gray_diff))
    pct_change = round(raw_mean / 255.0 * 100 * 3, 2)   # ×3 scale for readability
    pct_change = min(pct_change, 100.0)

    fade_b = compute_fading_score(img_b)
    fade_a = compute_fading_score(img_a)

    return {
        "pct_change":    pct_change,
        "diff_image_b64": diff_b64,
        "fading_before": fade_b,
        "fading_after":  fade_a,
        "fading_delta":  round(fade_a - fade_b, 4),
        "raw_diff_mean": round(raw_mean, 2),
    }


def make_thumbnail_b64(img: np.ndarray, size=(300, 300)) -> str:
    t = cv2.resize(img, size)
    _, buf = cv2.imencode('.jpg', t, [int(cv2.IMWRITE_JPEG_QUALITY), 80])
    return base64.b64encode(buf).decode('utf-8')


def full_pipeline(file_bytes: bytes) -> dict:
    original = load_bytes(file_bytes)
    enhanced = enhance_contrast(original)
    resized = cv2.resize(enhanced, TARGET_SIZE, interpolation=cv2.INTER_AREA)
    normalised = resized.astype(np.float32) / 255.0
    return {
        "preprocessed": normalised,
        "fading_score": compute_fading_score(original),
        "crack_features": compute_crack_features(original),
        "original_bgr": original,
    }
