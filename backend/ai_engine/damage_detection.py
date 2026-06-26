"""
damage_detection.py  —  AI damage detection, severity scoring, trend forecasting,
                         video object detection, AI report generation.
Uses TensorFlow/MobileNetV2 when available, falls back to OpenCV heuristics.
"""
import os
import json
import numpy as np

try:
    import tensorflow as tf
    from tensorflow import keras
    TF_AVAILABLE = True
except ImportError:
    TF_AVAILABLE = False
    print("[AI] TensorFlow not installed — using heuristic fallback mode.")

MODEL_PATH = os.getenv("MODEL_PATH", "backend/ai_engine/damage_model.h5")
_model = None

# Common museum artifact parts / objects
ARTIFACT_OBJECTS = [
    "vase", "sculpture", "painting", "textile", "scroll", "helmet",
    "figurine", "amphora", "coin", "jewelry", "mosaic", "tablet",
    "relief", "bust", "torso", "plaque", "urn", "sarcophagus",
]


# ── Model ─────────────────────────────────────────────────────────────────────

def _build_model():
    base = keras.applications.MobileNetV2(
        input_shape=(224, 224, 3), include_top=False, weights="imagenet")
    base.trainable = False
    model = keras.Sequential([
        base,
        keras.layers.GlobalAveragePooling2D(),
        keras.layers.Dense(128, activation="relu"),
        keras.layers.Dropout(0.3),
        keras.layers.Dense(1, activation="sigmoid"),
    ])
    model.compile(optimizer="adam", loss="binary_crossentropy", metrics=["accuracy"])
    return model


def get_model():
    global _model
    if _model is not None:
        return _model
    if not TF_AVAILABLE:
        return None
    if os.path.exists(MODEL_PATH):
        print(f"[AI] Loading model from {MODEL_PATH}")
        _model = keras.models.load_model(MODEL_PATH)
    else:
        print("[AI] No trained weights found — using ImageNet base. Train the model for production.")
        _model = _build_model()
    return _model


# ── Damage Prediction ─────────────────────────────────────────────────────────

def predict_damage(preprocessed_image: np.ndarray) -> dict:
    """
    Run damage inference on a (224,224,3) float32 [0-1] image array.
    Returns damage_probability, damage_detected, confidence, model_used.
    """
    model = get_model()
    if model and TF_AVAILABLE:
        batch = np.expand_dims(preprocessed_image, axis=0)
        prob = float(model.predict(batch, verbose=0)[0][0])
        return {
            "damage_probability": round(prob, 4),
            "damage_detected":    prob > 0.5,
            "confidence":         round(abs(prob - 0.5) * 2, 4),
            "model_used":         "MobileNetV2-TF",
        }
    else:
        # Heuristic: high texture std → likely damaged
        std_val = float(np.std(preprocessed_image))
        mean_val = float(np.mean(preprocessed_image))
        prob = min(1.0, std_val * 3.2 + (1 - mean_val) * 0.3)
        return {
            "damage_probability": round(prob, 4),
            "damage_detected":    prob > 0.45,
            "confidence":         round(abs(prob - 0.5) * 2, 4),
            "model_used":         "heuristic-fallback",
        }


#def compute_severity_index(damage_prob: float, fading_score: float, edge_density: float) -> float:
 #   """Composite 0–10 severity index."""
  #  score = (damage_prob * 0.40 + fading_score * 0.35 + edge_density * 0.25) * 10
   # return round(min(10.0, max(0.0, score)), 2)

def compute_severity_index(damage_prob, fading_score, edge_density):
    """
    Computes a composite severity score (0 to 10) with short-circuit overrides
    so high independent threats aren't diluted by low companion features.
    """
    # 1. Calculate the base weighted score as a baseline
    base_score = (damage_prob * 0.40 + fading_score * 0.35 + edge_density * 0.25) * 10
    
    # 2. SHORT-CIRCUIT: If the AI model detects clear structural damage,
    # enforce a high minimum baseline so it can't be dragged down.
    if damage_prob >= 0.85:
        # Instantly forces the score into the CRITICAL zone (>= 8.0)
        return max(8.5, base_score)
    elif damage_prob >= 0.60:
        # Instantly forces the score into the HIGH risk zone (>= 6.0)
        return max(6.5, base_score)
        
    # 3. Handle edge cases where extreme cracking lines are present
    if edge_density > 0.06:
        return max(7.5, base_score)

    return min(10.0, max(0.0, base_score))

def classify_severity(severity_index: float) -> str:
    if severity_index >= 8:  return "CRITICAL"
    if severity_index >= 6:  return "HIGH"
    if severity_index >= 3.5: return "MEDIUM"
    return "LOW"


# ── Trend Forecasting ─────────────────────────────────────────────────────────

def predict_trend(severity_history: list) -> dict:
    """Linear regression forecast for next 3 periods."""
    n = len(severity_history)
    if n < 2:
        val = severity_history[0] if severity_history else 0
        return {"slope": 0.0, "forecast": [val, val, val], "trend_label": "Insufficient data"}
    x = np.arange(n, dtype=float)
    y = np.array(severity_history, dtype=float)
    slope, intercept = np.polyfit(x, y, 1)
    forecast = [round(float(np.clip(slope * (n + i - 1) + intercept, 0, 10)), 2) for i in range(1, 4)]
    label = "Deteriorating" if slope > 0.3 else ("Improving" if slope < -0.3 else "Stable")
    return {"slope": round(float(slope), 4), "forecast": forecast, "trend_label": label}


# ── AI Report ─────────────────────────────────────────────────────────────────

def generate_ai_report(artifact_name, severity_index, crack_detected,
                       fading_level, damage_prob, edge_density, inspection_type):
    sev_label = classify_severity(severity_index)
    recs = []
    if crack_detected:
        recs += ["Apply consolidant to prevent crack propagation.",
                 "Restrict all handling and transportation until treated."]
    if fading_level > 0.5:
        recs += ["Install UV-filtering glass or acrylic shield.",
                 "Reduce ambient light exposure to below 50 lux."]
    if severity_index > 6:
        recs += ["Prioritise for immediate conservation treatment.",
                 "Document all damage zones with high-resolution photography."]
    if not recs:
        recs += ["Continue standard monitoring schedule.",
                 "Maintain controlled environment: RH 45–55%, temp 18–21°C."]

    rec_text = "\n".join(f"  • {r}" for r in recs)
    return f"""ARTIFACT INSPECTION REPORT
============================
Artifact        : {artifact_name}
Inspection Type : {inspection_type}
Risk Level      : {sev_label}
Report Date     : {__import__('datetime').datetime.now().strftime('%Y-%m-%d %H:%M')}

DAMAGE METRICS
--------------
  Severity Index      : {severity_index:.1f} / 10.0
  Damage Probability  : {damage_prob:.1%}
  Fading Level        : {fading_level:.1%}
  Edge / Crack Density: {edge_density:.4f}
  Cracks Detected     : {'YES' if crack_detected else 'NO'}

ASSESSMENT
----------
  This artifact presents a {sev_label.lower()} deterioration risk.
  {"Immediate conservation action is STRONGLY recommended." if severity_index >= 6
   else "Routine monitoring is sufficient at this stage."}

RECOMMENDATIONS
---------------
{rec_text}

━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
Generated by Artifact Guardian AI Engine
Model: {'MobileNetV2-TensorFlow' if TF_AVAILABLE else 'OpenCV Heuristic'}
"""


def build_alert_message(artifact_name, severity_index, crack_detected, fading_level):
    parts = [f"Artifact '{artifact_name}' — severity index {severity_index}/10."]
    if crack_detected:
        parts.append("Structural cracks detected.")
    if fading_level > 0.6:
        parts.append(f"High fading level ({fading_level:.0%}).")
    if severity_index >= 8:
        parts.append("IMMEDIATE conservation intervention required.")
    elif severity_index >= 6:
        parts.append("Schedule urgent treatment.")
    return " ".join(parts)


# ── Video Object Detection ────────────────────────────────────────────────────

def analyze_video_for_missing(video_path: str, expected_objects: list) -> dict:
    """
    Detect missing objects using YOLOv8 (if installed) or pixel-diff fallback.
    YOLOv8 actually identifies objects by name — vase, cat, person, bottle etc.
    Pixel-diff fallback estimates how many objects disappeared from scene change.
    """
    import cv2

    # ── Try YOLOv8 first ────────────────────────────────────────────
    try:
        from ultralytics import YOLO
        model = YOLO("yolov8n.pt")   # downloads ~6MB on first run
        YOLO_AVAILABLE = True
    except ImportError:
        YOLO_AVAILABLE = False

    cap = cv2.VideoCapture(video_path)
    if not cap.isOpened():
        return {"missing_objects": expected_objects, "detected_objects": [],
                "frame_count": 0, "sampled_frames": []}

    total_frames = int(cap.get(cv2.CAP_PROP_FRAME_COUNT)) or 9999
    frame_count  = 0
    sampled_frames = []
    early_frames = []
    late_frames  = []
    early_detected_names = set()
    late_detected_names  = set()

    while True:
        ret, frame = cap.read()
        if not ret: break
        frame_count += 1
        if frame_count % 8 == 0:
            small = cv2.resize(frame, (640, 480))
            pct   = frame_count / max(total_frames, 1)
            is_early = pct <= 0.20
            is_late  = pct >= 0.80
            if is_early: early_frames.append(small)
            if is_late:  late_frames.append(small)

            # YOLO detection on sampled frames
            if YOLO_AVAILABLE and (is_early or is_late):
                results = model(small, verbose=False)[0]
                names_detected = set()
                for box in results.boxes:
                    cls_id = int(box.cls[0])
                    name   = model.names[cls_id].lower()
                    conf   = float(box.conf[0])
                    if conf > 0.3:
                        names_detected.add(name)
                if is_early: early_detected_names.update(names_detected)
                if is_late:  late_detected_names.update(names_detected)

            sampled_frames.append({"frame": frame_count})
    cap.release()

    # ── YOLO-based missing detection ─────────────────────────────────
    if YOLO_AVAILABLE and early_detected_names:
        # Objects seen early but NOT seen late = missing
        yolo_missing = early_detected_names - late_detected_names

        # Match against user-provided expected objects
        missing_objects  = []
        detected_objects = []
        for obj in expected_objects:
            obj_lower = obj.lower().strip()
            # Check if any YOLO class matches the user label
            matched_early = any(obj_lower in n or n in obj_lower for n in early_detected_names)
            matched_late  = any(obj_lower in n or n in obj_lower for n in late_detected_names)
            if matched_early and not matched_late:
                missing_objects.append(obj)
            else:
                detected_objects.append(obj)

        # Also add any YOLO-detected missing objects not in user list
        for name in yolo_missing:
            if name not in [m.lower() for m in missing_objects]:
                missing_objects.append(f"{name} (auto-detected)")

        return {
            "missing_objects":    missing_objects,
            "detected_objects":   detected_objects,
            "frame_count":        frame_count,
            "sampled_frames":     sampled_frames[:20],
            "early_object_count": len(early_detected_names),
            "late_object_count":  len(late_detected_names),
            "change_score_pct":   round(len(yolo_missing)/max(len(early_detected_names),1)*100, 1),
            "mean_pixel_diff":    0,
            "detection_method":   "YOLOv8",
            "yolo_early":         list(early_detected_names),
            "yolo_late":          list(late_detected_names),
        }

    # ── Pixel-diff fallback (no YOLO) ───────────────────────────────
    if not early_frames or not late_frames:
        return {
            "missing_objects":  expected_objects if expected_objects else [],
            "detected_objects": [],
            "frame_count":      frame_count,
            "sampled_frames":   sampled_frames,
            "note": "Video too short for phase comparison"
        }

    early_avg = np.mean(np.array(early_frames, dtype=np.float32), axis=0).astype(np.uint8)
    late_avg  = np.mean(np.array(late_frames,  dtype=np.float32), axis=0).astype(np.uint8)
    diff      = cv2.absdiff(early_avg, late_avg)
    gray_diff = cv2.cvtColor(diff, cv2.COLOR_BGR2GRAY)
    sig_pixels   = int(np.sum(gray_diff > 25))
    sig_pct      = sig_pixels / gray_diff.size * 100
    mean_diff    = float(np.mean(gray_diff))
    max_diff     = float(np.max(gray_diff))

    def count_objects(frames):
        counts = []
        for f in frames:
            gray = cv2.cvtColor(f, cv2.COLOR_BGR2GRAY)
            _, thresh = cv2.threshold(gray, 40, 255, cv2.THRESH_BINARY)
            blur  = cv2.GaussianBlur(gray, (7,7), 0)
            adapt = cv2.adaptiveThreshold(blur, 255,
                cv2.ADAPTIVE_THRESH_GAUSSIAN_C, cv2.THRESH_BINARY_INV, 15, 3)
            combined = cv2.bitwise_or(thresh, adapt)
            kernel   = np.ones((9,9), np.uint8)
            closed   = cv2.morphologyEx(combined, cv2.MORPH_CLOSE, kernel)
            cnts, _  = cv2.findContours(closed, cv2.RETR_EXTERNAL, cv2.CHAIN_APPROX_SIMPLE)
            counts.append(len([c for c in cnts if cv2.contourArea(c) > 800]))
        return float(np.mean(counts)) if counts else 0.0

    early_count = count_objects(early_frames)
    late_count  = count_objects(late_frames)
    object_loss = max(0.0, early_count - late_count)

    missing_objects  = []
    detected_objects = list(expected_objects)
    if expected_objects:
        n_missing = 0
        if object_loss >= 1:
            n_missing = min(round(object_loss), len(expected_objects))
        elif sig_pct > 15:
            n_missing = min(round(sig_pct / 8), len(expected_objects))
        elif sig_pct > 8:
            n_missing = max(1, min(round(sig_pct / 10), len(expected_objects)))
        elif sig_pct > 3:
            n_missing = 1
        elif sig_pct > 1 and max_diff > 80:
            n_missing = 1
        n_missing = min(n_missing, len(expected_objects))
        if n_missing > 0:
            missing_objects  = expected_objects[-n_missing:]
            detected_objects = expected_objects[:-n_missing]
    else:
        if object_loss >= 0.8 or sig_pct > 4.5:
            lost_count = max(1, round(object_loss)) if object_loss >= 0.8 else 1
            missing_objects = ["Artifact Item (auto-detected)"] * lost_count

    return {
        "missing_objects":    missing_objects,
        "detected_objects":   detected_objects,
        "frame_count":        frame_count,
        "sampled_frames":     sampled_frames[:20],
        "early_object_count": round(early_count, 1),
        "late_object_count":  round(late_count, 1),
        "change_score_pct":   round(sig_pct, 2),
        "mean_pixel_diff":    round(mean_diff, 2),
        "detection_method":   "pixel-diff",
    }

