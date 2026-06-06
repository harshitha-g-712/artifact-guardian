"""
api.py  —  All REST API endpoints
"""
import io
import os
import uuid
import json
import math
from datetime import datetime, timedelta

from flask import Blueprint, request, jsonify, current_app, send_file, session
from werkzeug.utils import secure_filename

from backend.models.database import (
    get_all_artifacts, get_artifact, create_artifact, update_artifact,
    delete_artifact, update_artifact_cover, update_artifact_status,
    get_inspections, get_inspection, save_inspection,
    get_trend_data, get_monthly_stats,
    save_inspection_image, get_inspection_images,
    save_video_inspection, get_video_inspections,
    get_alerts, create_alert, mark_alert_read, mark_all_alerts_read,
    get_shipments, create_shipment,
    get_dashboard_stats, get_user_by_id,
)
from backend.utils.preprocessing import (
    full_pipeline, generate_damage_heatmap, compare_images, make_thumbnail_b64,
)
from backend.ai_engine.damage_detection import (
    predict_damage, compute_severity_index, predict_trend,
    classify_severity, build_alert_message, generate_ai_report,
    analyze_video_for_missing,
)
from backend.utils.email_service import (
    send_damage_alert, send_missing_object_alert,
)
from backend.utils.auth import login_required, require_role
from backend.utils.export_service import (
    export_inspections_excel, export_report_pdf, import_artifacts_from_csv,
)
def log_action(action: str, artifact_id=None, artifact_name=None, details=None):
    """
    Write one audit log row. Call this anywhere in api.py.
    Uses session for user info — safe to call even without a session.
    """
    from backend.models.database import get_connection
    try:
        conn = get_connection()
        cur  = conn.cursor()
        cur.execute("""
            INSERT INTO audit_logs
                (user_id, username, role, action, artifact_id, artifact_name, details, ip_address)
            VALUES (%s, %s, %s, %s, %s, %s, %s, %s)
        """, (
            session.get("user_id"),
            session.get("username", "system"),
            session.get("role_name", ""),
            action,
            artifact_id,
            artifact_name,
            details,
            request.remote_addr,
        ))
        conn.commit()
        cur.close()
        conn.close()
    except Exception as e:
        print(f"[AUDIT] Log failed: {e}")


api = Blueprint("api", __name__, url_prefix="/api")

ALLOWED_IMG = {"png", "jpg", "jpeg", "webp", "bmp", "tiff"}
ALLOWED_VID = {"mp4", "avi", "mov", "mkv", "webm"}


def _allowed(filename, allowed):
    return "." in filename and filename.rsplit(".", 1)[1].lower() in allowed


def _upload_dir():
    d = current_app.config["UPLOAD_FOLDER"]
    os.makedirs(d, exist_ok=True)
    return d


def _save_file(file, allowed):
    if not _allowed(file.filename, allowed):
        return None, None
    ext = file.filename.rsplit(".", 1)[1].lower()
    fname = f"{uuid.uuid4().hex}.{ext}"
    fpath = _upload_dir().rstrip('/\\') + '/' + fname
    data = file.read()
    with open(fpath, "wb") as f:
        f.write(data)
    return fpath, data


# ── Artifacts ─────────────────────────────────────────────────────────────────

@api.get("/artifacts")
@login_required
def list_artifacts():
    return jsonify(get_all_artifacts())


@api.get("/artifacts/<int:aid>")
@login_required
def artifact_detail(aid):
    a = get_artifact(aid)
    return jsonify(a) if a else (jsonify({"error": "Not found"}), 404)


@api.post("/artifacts")
@login_required
@require_role("Admin", "Curator")
def add_artifact():
    d = request.get_json(force=True)
    if not all(k in d for k in ("name", "category", "age", "location")):
        return jsonify({"error": "Required: name, category, age, location"}), 400
    new_id = create_artifact(
        d["name"], d["category"], int(d["age"]),
        d["location"], d.get("description", ""),
        session.get("user_id"),
    )
    log_action("Artifact Created", new_id, d["name"])
    return jsonify({"artifact_id": new_id, "status": "created"}), 201


@api.put("/artifacts/<int:aid>")
@login_required
@require_role("Admin", "Curator")
def edit_artifact(aid):
    d = request.get_json(force=True)
    update_artifact(aid, d["name"], d["category"], int(d["age"]),
                    d["location"], d.get("description", ""), d.get("status", "Good"))
    log_action("Artifact Edited", aid, d.get("name",""))
    return jsonify({"status": "updated"})


@api.delete("/artifacts/<int:aid>")
@login_required
@require_role("Admin")
def remove_artifact(aid):
    art = get_artifact(aid)
    log_action("Artifact Deleted", aid, art["name"] if art else str(aid))
    delete_artifact(aid)
    return jsonify({"status": "deleted"})


@api.post("/artifacts/<int:aid>/cover")
@login_required
@require_role("Admin", "Curator")
def upload_cover(aid):
    if "image" not in request.files:
        return jsonify({"error": "No image"}), 400
    fpath, _ = _save_file(request.files["image"], ALLOWED_IMG)
    if not fpath:
        return jsonify({"error": "Invalid image type"}), 400
    update_artifact_cover(aid, fpath)
    return jsonify({"status": "ok", "path": fpath})


# ── Inspections ───────────────────────────────────────────────────────────────

@api.get("/inspections")
@login_required
def list_inspections():
    aid = request.args.get("artifact_id", type=int)
    search = request.args.get("search", "")
    return jsonify(get_inspections(aid, search))


@api.get("/inspections/<int:iid>")
@login_required
def inspection_detail(iid):
    insp = get_inspection(iid)
    if not insp:
        return jsonify({"error": "Not found"}), 404
    insp["images"] = get_inspection_images(inspection_id=iid)
    return jsonify(insp)


@api.get("/artifacts/<int:aid>/trend")
@login_required
def trend(aid):
    rows = get_trend_data(aid)
    history = [float(r["severity_index"]) for r in rows]
    return jsonify({"history": rows, "prediction": predict_trend(history)})


@api.get("/stats/monthly")
@login_required
def monthly_stats():
    year = request.args.get("year", type=int)
    return jsonify(get_monthly_stats(year))


# ── Analyze Image ─────────────────────────────────────────────────────────────

@api.post("/analyze")
@login_required
@require_role("Admin", "Curator")
def analyze():
    if "image" not in request.files:
        return jsonify({"error": "No image file provided"}), 400
    aid = request.form.get("artifact_id", type=int)
    insp_type = request.form.get("inspection_type", "Routine")
    if not aid:
        return jsonify({"error": "artifact_id required"}), 400
    art = get_artifact(aid)
    if not art:
        return jsonify({"error": "Artifact not found"}), 404

    fpath, file_bytes = _save_file(request.files["image"], ALLOWED_IMG)
    if not fpath:
        return jsonify({"error": "Invalid image type"}), 400

    # Preprocess
    pp = full_pipeline(file_bytes)
    # AI inference
    pred = predict_damage(pp["preprocessed"])
    sev = compute_severity_index(
        pred["damage_probability"], pp["fading_score"],
        pp["crack_features"]["edge_density"]
    )
    crack = pred["damage_detected"] or pp["crack_features"]["suspected_crack"]
    notes = (f"Model:{pred['model_used']} | "
             f"DmgProb:{pred['damage_probability']:.2%} | "
             f"EdgeDensity:{pp['crack_features']['edge_density']:.4f}")
    ai_report = generate_ai_report(
        art["name"], sev, crack, pp["fading_score"],
        pred["damage_probability"], pp["crack_features"]["edge_density"], insp_type
    )

    # Save inspection
    iid = save_inspection(
        aid, session.get("user_id"), crack, pp["fading_score"],
        sev, notes, ai_report, insp_type
    )

    # ✅ Define sev_label FIRST
    status_map = {"CRITICAL": "Critical", "HIGH": "Poor", "MEDIUM": "Fair", "LOW": "Good"}
    sev_label = classify_severity(sev)
    update_artifact_status(aid, status_map[sev_label])

    # ✅ Now log_action can use sev_label
    log_action("AI Analysis Run", aid, art["name"], f"Severity:{sev:.1f} Risk:{sev_label}")

    img_type_map = {'Pre-Shipment':'Pre-Shipment','Post-Shipment':'Post-Shipment','Camera':'Camera'}
    img_type = img_type_map.get(insp_type, 'Standard')
    save_inspection_image(iid, aid, fpath, img_type)

    # Heatmap + thumbnail
    heatmap_b64 = generate_damage_heatmap(pp["original_bgr"])
    thumb_b64 = make_thumbnail_b64(pp["original_bgr"])

    # Auto-alert + email
    if sev_label in ("HIGH", "CRITICAL"):
        msg = build_alert_message(art["name"], sev, crack, pp["fading_score"])
        create_alert(aid, msg, sev_label, "Damage", session.get("user_id"))
        custodian_id = art.get("custodian_id")
        if custodian_id:
            try:
                custodian = get_user_by_id(custodian_id)
                if custodian and custodian.get("alert_email"):
                    send_damage_alert(custodian["alert_email"], art["name"], sev_label, sev, msg)
            except Exception as e:
                print(f"[EMAIL] Error sending alert: {e}")

    return jsonify({
        "inspection_id":  iid,
        "artifact_id":    aid,
        "crack_detected": crack,
        "fading_level":   pp["fading_score"],
        "severity_index": sev,
        "alert_severity": sev_label,
        "damage_notes":   notes,
        "ai_report":      ai_report,
        "ai_result":      pred,
        "heatmap_b64":    heatmap_b64,
        "thumbnail_b64":  thumb_b64,
    })


# ── Compare Images ────────────────────────────────────────────────────────────

@api.post("/compare")
@login_required
@require_role("Admin", "Curator")
def compare():
    if "before" not in request.files or "after" not in request.files:
        return jsonify({"error": "Provide 'before' and 'after' images"}), 400
    _, before_bytes = _save_file(request.files["before"], ALLOWED_IMG)
    _, after_bytes  = _save_file(request.files["after"], ALLOWED_IMG)
    if not before_bytes or not after_bytes:
        return jsonify({"error": "Invalid image types"}), 400
    result = compare_images(before_bytes, after_bytes)
    return jsonify(result)


# ── Heatmap only ──────────────────────────────────────────────────────────────

@api.post("/heatmap")
@login_required
@require_role("Admin", "Curator")
def heatmap():
    if "image" not in request.files:
        return jsonify({"error": "No image"}), 400
    _, file_bytes = _save_file(request.files["image"], ALLOWED_IMG)
    if not file_bytes:
        return jsonify({"error": "Invalid image"}), 400
    from backend.utils.preprocessing import load_bytes
    img = load_bytes(file_bytes)
    return jsonify({"heatmap_b64": generate_damage_heatmap(img)})


# ── Video Analysis ────────────────────────────────────────────────────────────

@api.post("/video/analyze")
@login_required
@require_role("Admin", "Curator")
def video_analyze():
    if "video" not in request.files:
        return jsonify({"error": "No video file"}), 400
    aid = request.form.get("artifact_id", type=int)
    expected_raw = request.form.get("expected_objects", "")
    expected = [o.strip() for o in expected_raw.split(",") if o.strip()]
    if not aid:
        return jsonify({"error": "artifact_id required"}), 400
    art = get_artifact(aid)
    if not art:
        return jsonify({"error": "Artifact not found"}), 404

    fpath, _ = _save_file(request.files["video"], ALLOWED_VID)
    if not fpath:
        return jsonify({"error": "Invalid video type. Allowed: mp4, avi, mov, mkv, webm"}), 400

    result = analyze_video_for_missing(fpath, expected)
    missing = result["missing_objects"]
    detected = result["detected_objects"]

    report = (
        f"VIDEO INSPECTION REPORT\n"
        f"========================\n"
        f"Artifact        : {art['name']}\n"
        f"Video File      : {os.path.basename(fpath)}\n"
        f"Total Frames    : {result['frame_count']}\n"
        f"Frames Sampled  : {len(result['sampled_frames'])}\n\n"
        f"DETECTED OBJECTS: {', '.join(detected) if detected else 'None detected'}\n"
        f"MISSING OBJECTS : {', '.join(missing) if missing else 'None — all expected objects present'}\n\n"
        + ("⚠ ACTION REQUIRED: Missing objects must be located immediately." if missing else
           "✓ All expected objects accounted for.")
    )

    vid_id = save_video_inspection(
        aid, session.get("user_id"), fpath,
        missing, detected, report, result["frame_count"]
    )

    if missing:
        alert_msg = f"Video analysis detected missing objects: {', '.join(missing)}"
        create_alert(aid, alert_msg, "CRITICAL", "Missing Object", session.get("user_id"))
        custodian_id = art.get("custodian_id")
        if custodian_id:
            try:
                custodian = get_user_by_id(custodian_id)
                if custodian and custodian.get("alert_email"):
                    send_missing_object_alert(
                        custodian["alert_email"], art["name"],
                        missing, os.path.basename(fpath)
                    )
            except Exception as e:
                print(f"[EMAIL] Error: {e}")

    return jsonify({
        "video_id":        vid_id,
        "artifact_id":     aid,
        "missing_objects": missing,
        "detected_objects": detected,
        "frame_count":     result["frame_count"],
        "report":          report,
    })


@api.get("/video/inspections")
@login_required
def list_video_inspections():
    aid = request.args.get("artifact_id", type=int)
    return jsonify(get_video_inspections(aid))


# ── Alerts ────────────────────────────────────────────────────────────────────

@api.get("/alerts")
@login_required
def list_alerts():
    unread = request.args.get("unread", "false").lower() == "true"
    return jsonify(get_alerts(unread))


@api.patch("/alerts/<int:alert_id>/read")
@login_required
def read_alert(alert_id):
    mark_alert_read(alert_id)
    return jsonify({"status": "ok"})


@api.post("/alerts/read-all")
@login_required
def read_all_alerts():
    mark_all_alerts_read()
    return jsonify({"status": "ok"})


# ── Shipments ─────────────────────────────────────────────────────────────────

@api.get("/shipments")
@login_required
@require_role("Admin", "Curator")
def list_shipments():
    aid = request.args.get("artifact_id", type=int)
    return jsonify(get_shipments(aid))


@api.post("/shipments")
@login_required
@require_role("Admin")
def add_shipment():
    d = request.get_json(force=True)
    new_id = create_shipment(
        d["artifact_id"], d.get("origin"), d.get("destination"),
        d.get("shipment_date"), d.get("expected_arrival"),
        session.get("user_id"), d.get("notes", "")
    )
    return jsonify({"shipment_id": new_id, "status": "created"}), 201


# ── Dashboard ─────────────────────────────────────────────────────────────────

@api.get("/dashboard/stats")
@login_required
def dashboard_stats():
    return jsonify(get_dashboard_stats())


# ── Export ────────────────────────────────────────────────────────────────────

@api.get("/export/inspections/excel")
@login_required
@require_role("Admin")
def export_excel():
    aid = request.args.get("artifact_id", type=int)
    inspections = get_inspections(aid)
    xlsx = export_inspections_excel(inspections)
    return send_file(
        io.BytesIO(xlsx),
        mimetype="application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
        as_attachment=True,
        download_name="inspections.xlsx",
    )


@api.get("/export/artifact/<int:aid>/pdf")
@login_required
@require_role("Admin", "Curator")
def export_pdf(aid):
    art = get_artifact(aid)
    if not art:
        return jsonify({"error": "Not found"}), 404
    inspections = get_inspections(aid)
    pdf = export_report_pdf(art, inspections)
    safe_name = art["name"].replace(" ", "_").replace("/", "-")
    return send_file(
        io.BytesIO(pdf),
        mimetype="application/pdf",
        as_attachment=True,
        download_name=f"report_{safe_name}.pdf",
    )


# ── Import ────────────────────────────────────────────────────────────────────

@api.post("/import/artifacts/csv")
@login_required
@require_role("Admin")
def import_csv():
    import requests as _requests

    if "file" not in request.files:
        return jsonify({"error": "No file provided"}), 400
    raw = request.files["file"].read()
    try:
        artifacts = import_artifacts_from_csv(raw)
    except Exception as e:
        return jsonify({"error": f"CSV parse error: {e}"}), 400

    created = []
    cover_errors = []
    upload_dir = _upload_dir()

    for a in artifacts:
        new_id = create_artifact(
            a["name"], a["category"], a["age"],
            a["location"], a["description"],
            session.get("user_id"),
        )
        created.append(new_id)

        image_url = a.get("image_url", "").strip()
        if not image_url:
            continue

        # Derive extension from URL; default to jpg
        url_path = image_url.split("?")[0]
        ext = url_path.rsplit(".", 1)[-1].lower()
        if ext not in ALLOWED_IMG:
            ext = "jpg"

        fname = f"{uuid.uuid4().hex}.{ext}"
        fpath = os.path.join(upload_dir, fname)

        try:
            headers = {"User-Agent": "Mozilla/5.0 (compatible; ArtifactGuardian/1.0)"}
            resp = _requests.get(image_url, timeout=15, headers=headers)
            resp.raise_for_status()
            with open(fpath, "wb") as f:
                f.write(resp.content)
            #update_artifact_cover(new_id, fpath)
            # Store relative path only (e.g., "uploads/abc123.jpg")
            relative_path = "uploads/" + fname  # Always forward slash, even on Windows
            update_artifact_cover(new_id, relative_path)  # ✅ CORRECT
            log_action("Cover Image Downloaded", new_id, a["name"], image_url)
        except Exception as e:
            cover_errors.append({"artifact_id": new_id, "name": a["name"], "error": str(e)})

    return jsonify({
        "imported": len(created),
        "ids": created,
        "cover_errors": cover_errors,
    })


# ── Gallery ───────────────────────────────────────────────────────────────────

@api.get("/artifacts/<int:aid>/gallery")
@login_required
def gallery(aid):
    images = get_inspection_images(artifact_id=aid)
    # Also include cover image if it exists
    artifact = get_artifact(aid)
    if artifact and artifact.get('cover_image'):
        cover = {
            'file_path': artifact['cover_image'].replace('\\', '/').replace('\\', '/'),
            'image_type': 'Cover',
            'uploaded_at': artifact.get('created_at', ''),
        }
        images = [cover] + images
    # Normalize all paths to forward slashes
    for img in images:
        if img.get('file_path'):
            img['file_path'] = img['file_path'].replace('\\', '/').replace('\\', '/')
    return jsonify(images)


# ── Users (admin) ─────────────────────────────────────────────────────────────

@api.get("/users")
@login_required
@require_role("Admin")
def list_users():
    from backend.models.database import get_all_users
    return jsonify(get_all_users())

# ════════════════════════════════════════════════════════════
# FEATURE 1: ARTIFACT DNA FINGERPRINTING
# ════════════════════════════════════════════════════════════

def generate_artifact_fingerprint(image_bytes: bytes) -> dict:
    """
    Extract multi-vector biometric fingerprint from artifact image.
    Requires: pip install imagehash scikit-image scipy opencv-python-headless
    """
    import cv2
    import numpy as np
    from PIL import Image
    import io

    # ── Load image ──────────────────────────────────────────
    arr = np.frombuffer(image_bytes, np.uint8)
    img_bgr = cv2.imdecode(arr, cv2.IMREAD_COLOR)
    if img_bgr is None:
        raise ValueError("Cannot decode image")
    img_bgr = cv2.resize(img_bgr, (256, 256))
    img_gray = cv2.cvtColor(img_bgr, cv2.COLOR_BGR2GRAY)
    img_pil  = Image.fromarray(cv2.cvtColor(img_bgr, cv2.COLOR_BGR2RGB))

    # 1. Perceptual hash + difference hash
    try:
        import imagehash
        phash = str(imagehash.phash(img_pil))
        dhash = str(imagehash.dhash(img_pil))
    except ImportError:
        # Fallback: simple hash from pixel means
        phash = hex(int(np.mean(img_gray) * 1000))[2:]
        dhash = hex(int(np.std(img_gray)  * 1000))[2:]

    # 2. Local Binary Pattern histogram (texture)
    try:
        from skimage.feature import local_binary_pattern
        lbp = local_binary_pattern(img_gray, P=8, R=1, method='uniform')
        lbp_hist, _ = np.histogram(lbp.ravel(), bins=10, range=(0, 10), density=True)
        lbp_hist = lbp_hist.tolist()
    except ImportError:
        # Fallback: gradient histogram
        grad = cv2.Sobel(img_gray, cv2.CV_64F, 1, 0)
        lbp_hist, _ = np.histogram(grad, bins=10, density=True)
        lbp_hist = lbp_hist.tolist()

    # 3. 9-zone color distribution (3x3 grid of BGR means)
    h, w = img_bgr.shape[:2]
    zone_colors = []
    for r in range(3):
        for c in range(3):
            zone = img_bgr[r*h//3:(r+1)*h//3, c*w//3:(c+1)*w//3]
            zone_colors.append(np.mean(zone, axis=(0,1)).tolist())

    # 4. GLCM texture properties
    try:
        from skimage.feature import graycomatrix, graycoprops
        glcm = graycomatrix(img_gray, [1], [0, np.pi/4, np.pi/2], levels=256, symmetric=True, normed=True)
        contrast    = float(np.mean(graycoprops(glcm, 'contrast')))
        homogeneity = float(np.mean(graycoprops(glcm, 'homogeneity')))
        energy      = float(np.mean(graycoprops(glcm, 'energy')))
    except Exception:
        contrast    = float(np.std(img_gray))
        homogeneity = float(1.0 / (1.0 + np.var(img_gray) / 1000.0))
        energy      = float(np.mean(img_gray) / 255.0)

    # 5. Edge/crack pattern histogram
    edges = cv2.Canny(img_gray, 50, 150)
    edge_hist, _ = np.histogram(edges, bins=8, range=(0, 256), density=True)
    edge_hist = edge_hist.tolist()

    # 6. ORB keypoint descriptor mean
    try:
        orb = cv2.ORB_create(nfeatures=200)
        kp, des = orb.detectAndCompute(img_gray, None)
        orb_mean = np.mean(des, axis=0).tolist() if des is not None and len(des) > 0 else [0.0]*32
    except Exception:
        orb_mean = [0.0] * 32

    return {
        "phash":        phash,
        "dhash":        dhash,
        "lbp_hist":     lbp_hist,
        "zone_colors":  zone_colors,
        "glcm": {
            "contrast":    contrast,
            "homogeneity": homogeneity,
            "energy":      energy,
        },
        "edge_hist":    edge_hist,
        "orb_mean":     orb_mean[:32],
    }


def compare_fingerprints(fp1: dict, fp2: dict) -> dict:
    """
    Compare two fingerprints. Returns similarity scores and status.
    """
    import numpy as np

    def hash_sim(h1, h2):
        """Hamming distance between hex hashes → similarity %"""
        try:
            b1 = bin(int(h1, 16))[2:].zfill(64)
            b2 = bin(int(h2, 16))[2:].zfill(64)
            same = sum(c1 == c2 for c1, c2 in zip(b1, b2))
            return same / len(b1) * 100
        except Exception:
            return 50.0

    def vec_sim(v1, v2):
        """Cosine similarity → 0-100"""
        a, b = np.array(v1, dtype=float), np.array(v2, dtype=float)
        n = min(len(a), len(b))
        if n == 0: return 50.0
        a, b = a[:n], b[:n]
        denom = np.linalg.norm(a) * np.linalg.norm(b)
        if denom == 0: return 50.0
        return float(np.dot(a, b) / denom * 100)

    def color_sim(z1, z2):
        """Mean absolute difference across 9 zones → similarity"""
        diffs = []
        for c1, c2 in zip(z1, z2):
            diffs.append(np.mean(np.abs(np.array(c1) - np.array(c2))))
        mean_diff = np.mean(diffs)
        return max(0.0, 100.0 - mean_diff / 255.0 * 100.0)

    def glcm_sim(g1, g2):
        v1 = [g1.get('contrast',0), g1.get('homogeneity',0), g1.get('energy',0)]
        v2 = [g2.get('contrast',0), g2.get('homogeneity',0), g2.get('energy',0)]
        return vec_sim(v1, v2)

    p_sim = (hash_sim(fp1.get('phash','0'), fp2.get('phash','0')) +
             hash_sim(fp1.get('dhash','0'), fp2.get('dhash','0'))) / 2
    t_sim = vec_sim(fp1.get('lbp_hist',[]), fp2.get('lbp_hist',[]))
    c_sim = color_sim(fp1.get('zone_colors',[]), fp2.get('zone_colors',[]))
    s_sim = glcm_sim(fp1.get('glcm',{}), fp2.get('glcm',{}))
    k_sim = vec_sim(fp1.get('edge_hist',[]), fp2.get('edge_hist',[]))

    overall = (p_sim * 0.30 + t_sim * 0.25 + c_sim * 0.20 + s_sim * 0.15 + k_sim * 0.10)

    if overall >= 92:
        status = "AUTHENTIC"
    elif overall >= 75:
        status = "SUSPICIOUS"
    else:
        status = "ALERT"

    return {
        "hash_similarity":          round(p_sim, 2),
        "texture_similarity":       round(t_sim, 2),
        "color_similarity":         round(c_sim, 2),
        "surface_similarity":       round(s_sim, 2),
        "crack_pattern_similarity": round(k_sim, 2),
        "overall_score":            round(overall, 2),
        "status":                   status,
        "authentic":                status == "AUTHENTIC",
    }


def _fp_save(artifact_id, fingerprint_data, image_path, user_id, is_master, conn):
    cur = conn.cursor()
    cur.execute("""INSERT INTO artifact_fingerprints
        (artifact_id, fingerprint_data, image_path, enrolled_by, is_master)
        VALUES (%s, %s, %s, %s, %s)""",
        (artifact_id, json.dumps(fingerprint_data), image_path, user_id, is_master))
    conn.commit()
    fid = cur.lastrowid
    cur.close()
    return fid


def _fp_get_master(artifact_id, conn):
    cur = conn.cursor()
    cur.execute("""SELECT fingerprint_data FROM artifact_fingerprints
        WHERE artifact_id=%s AND is_master=TRUE ORDER BY enrolled_at DESC LIMIT 1""",
        (artifact_id,))
    row = cur.fetchone()
    cur.close()
    if not row: return None
    return json.loads(row[0]) if isinstance(row[0], str) else row[0]


# ── FINGERPRINT API ROUTES ───────────────────────────────────────────────────
# Add these to backend/routes/api.py inside the Blueprint

@api.post("/artifacts/<int:aid>/fingerprint/enroll")
@login_required
@require_role("Admin", "Curator")
def fingerprint_enroll(aid):
    from backend.models.database import get_connection, get_artifact
    art = get_artifact(aid)
    if not art: return jsonify({"error": "Artifact not found"}), 404
    if "image" not in request.files:
        return jsonify({"error": "No image provided"}), 400

    file_bytes = request.files["image"].read()
    try:
        fp = generate_artifact_fingerprint(file_bytes)
    except Exception as e:
        return jsonify({"error": f"Fingerprint generation failed: {e}"}), 500

    # Save image
    upload_dir = current_app.config["UPLOAD_FOLDER"]
    os.makedirs(upload_dir, exist_ok=True)
    fname = f"fp_{uuid.uuid4().hex}.jpg"
    fpath = os.path.join(upload_dir, fname)
    with open(fpath, "wb") as f: f.write(file_bytes)

    conn = get_connection()
    try:
        # Demote old master
        cur = conn.cursor()
        cur.execute("UPDATE artifact_fingerprints SET is_master=FALSE WHERE artifact_id=%s", (aid,))
        conn.commit()
        cur.close()
        fid = _fp_save(aid, fp, fpath, session.get("user_id"), True, conn)
    finally:
        conn.close()
    log_action("Fingerprint Enrolled", aid, art["name"])  # ✅ ADD HERE

    return jsonify({"message": "Fingerprint enrolled successfully", "fingerprint_id": fid}), 200


@api.post("/artifacts/<int:aid>/fingerprint/verify")
@login_required
@require_role("Admin", "Curator")
def fingerprint_verify(aid):
    from backend.models.database import get_connection, get_artifact, create_alert
    art = get_artifact(aid)
    if not art: return jsonify({"error": "Artifact not found"}), 404
    if "image" not in request.files:
        return jsonify({"error": "No image provided"}), 400

    file_bytes = request.files["image"].read()
    conn = get_connection()
    try:
        master = _fp_get_master(aid, conn)
        if not master:
            return jsonify({"error": "No master fingerprint enrolled for this artifact. Enroll first."}), 404

        try:
            fp_new = generate_artifact_fingerprint(file_bytes)
        except Exception as e:
            return jsonify({"error": f"Fingerprint generation failed: {e}"}), 500

        result = compare_fingerprints(master, fp_new)

        # Save verification record
        cur = conn.cursor()
        cur.execute("""INSERT INTO fingerprint_verifications
            (artifact_id, overall_score, status, score_breakdown, verified_by)
            VALUES (%s, %s, %s, %s, %s)""",
            (aid, result["overall_score"], result["status"],
             json.dumps(result), session.get("user_id")))
        conn.commit()
        cur.close()
        log_action("Fingerprint Verified", aid, art["name"],  # ✅ ADD HERE
                   f"Score:{result['overall_score']:.1f}% Status:{result['status']}")



        # Auto-alert if not authentic
        if result["status"] != "AUTHENTIC":
            severity = "CRITICAL" if result["status"] == "ALERT" else "HIGH"
            msg = (f"Fingerprint verification FAILED for '{art['name']}'. "
                   f"Overall match: {result['overall_score']:.1f}%. "
                   f"Status: {result['status']}. Possible tampering, forgery or substitution.")
            create_alert(aid, msg, severity, "Fingerprint", session.get("user_id"))

    finally:
        conn.close()

    result["artifact_name"] = art["name"]
    return jsonify(result), 200


@api.get("/artifacts/<int:aid>/fingerprint/history")
@login_required
def fingerprint_history(aid):
    from backend.models.database import get_connection
    conn = get_connection()
    cur = conn.cursor()
    cur.execute("""SELECT verification_id, verified_at, overall_score, status, score_breakdown
        FROM fingerprint_verifications WHERE artifact_id=%s
        ORDER BY verified_at DESC LIMIT 10""", (aid,))
    rows = []
    for r in cur.fetchall():
        rows.append({
            "verification_id": r[0],
            "verified_at":     r[1].isoformat() if r[1] else None,
            "overall_score":   r[2],
            "status":          r[3],
            "scores":          json.loads(r[4]) if r[4] else {},
        })
    cur.close(); conn.close()
    return jsonify(rows), 200


# ════════════════════════════════════════════════════════════
# FEATURE 2: TEMPORAL DETERIORATION PREDICTION ENGINE
# ════════════════════════════════════════════════════════════

def predict_deterioration(artifact_id: int, conn) -> dict:
    """
    Predict future deterioration using polynomial/linear regression.
    """
    import numpy as np
    from datetime import date as date_type

    cur = conn.cursor()
    cur.execute("""SELECT inspection_date, severity_index, fading_level, crack_detected
        FROM inspections WHERE artifact_id=%s ORDER BY inspection_date ASC""", (artifact_id,))
    rows = cur.fetchall()
    cur.close()

    if len(rows) < 2:
        return {
            "status":       "insufficient_data",
            "count":        len(rows),
            "needed":       2 - len(rows),
            "message":      f"Need at least 2 inspections. Currently have {len(rows)}.",
        }

    # Convert dates → days since first inspection
    def to_date(v):
        if isinstance(v, date_type): return v
        if isinstance(v, datetime):  return v.date()
        return datetime.strptime(str(v), "%Y-%m-%d").date()

    dates     = [to_date(r[0]) for r in rows]
    severities= [float(r[1]) for r in rows]
    fadings   = [float(r[2]) for r in rows]
    cracks    = [bool(r[3]) for r in rows]

    day0  = dates[0]
    x_days= np.array([(d - day0).days for d in dates], dtype=float)
    y_sev = np.array(severities, dtype=float)
    y_fad = np.array(fadings,    dtype=float)

    today_days = (datetime.now().date() - day0).days

    # Severity regression
    degree = 2 if len(rows) >= 4 else 1
    try:
        sev_coeffs = np.polyfit(x_days, y_sev, degree)
        sev_poly   = np.poly1d(sev_coeffs)
        # R-squared
        y_pred_hist = sev_poly(x_days)
        ss_res = np.sum((y_sev - y_pred_hist)**2)
        ss_tot = np.sum((y_sev - np.mean(y_sev))**2)
        r2 = max(0.0, 1 - ss_res/ss_tot) if ss_tot > 0 else 0.0
    except Exception:
        sev_coeffs = np.polyfit(x_days, y_sev, 1)
        sev_poly   = np.poly1d(sev_coeffs)
        r2         = 0.5

    # Fading regression (linear)
    try:
        fad_coeffs  = np.polyfit(x_days, y_fad, 1)
        fad_poly    = np.poly1d(fad_coeffs)
        fad_monthly = float(fad_poly(today_days + 30) - fad_poly(today_days))
    except Exception:
        fad_monthly = 0.0

    def predict_sev(offset_days):
        v = float(sev_poly(today_days + offset_days))
        return round(min(10.0, max(0.0, v)), 2)

    now_sev = predict_sev(0)
    sev_30  = predict_sev(30)
    sev_60  = predict_sev(60)
    sev_90  = predict_sev(90)
    sev_180 = predict_sev(180)
    fad_90  = float(min(1.0, max(0.0, fad_poly(today_days + 90))))

    # Days to critical (severity ≥ 8)
    days_to_critical = None
    critical_date    = None
    for d in range(1, 731):
        if predict_sev(d) >= 8.0:
            days_to_critical = d
            critical_date    = (datetime.now().date() + timedelta(days=d)).isoformat()
            break

    # Days to high (severity ≥ 6) = safe display limit
    safe_display_days = None
    for d in range(1, 731):
        if predict_sev(d) >= 6.0:
            safe_display_days = d
            break

    # Crack probability
    total_rate  = sum(cracks) / len(cracks)
    recent      = cracks[-3:] if len(cracks) >= 3 else cracks
    recent_rate = sum(recent) / len(recent)
    crack_prob  = round((0.40 * total_rate + 0.60 * recent_rate) * 100, 1)

    # Forecast label
    if now_sev >= 8:
        label = "CRITICAL_NOW"
    elif days_to_critical and days_to_critical <= 30:
        label = "CRITICAL_SOON"
    elif days_to_critical and days_to_critical <= 90:
        label = "HIGH_RISK"
    elif days_to_critical and days_to_critical <= 180:
        label = "MEDIUM_RISK"
    else:
        label = "LOW_RISK"

    # Next inspection recommendation
    if label in ("CRITICAL_NOW", "CRITICAL_SOON"):
        next_insp = (datetime.now().date() + timedelta(days=7)).isoformat()
    elif label == "HIGH_RISK":
        next_insp = (datetime.now().date() + timedelta(days=30)).isoformat()
    elif label == "MEDIUM_RISK":
        next_insp = (datetime.now().date() + timedelta(days=60)).isoformat()
    else:
        next_insp = (datetime.now().date() + timedelta(days=90)).isoformat()

    return {
        "status":               "ok",
        "artifact_id":          artifact_id,
        "inspection_count":     len(rows),
        "regression_degree":    degree,
        "confidence_pct":       round(r2 * 100, 1),
        "current_severity":     now_sev,
        "forecast": {
            "now":   now_sev,
            "d30":   sev_30,
            "d60":   sev_60,
            "d90":   sev_90,
            "d180":  sev_180,
        },
        "fading_at_90d":        round(fad_90 * 100, 1),
        "fading_monthly_rate":  round(fad_monthly * 100, 2),
        "crack_probability_pct":crack_prob,
        "days_to_critical":     days_to_critical,
        "critical_date":        critical_date,
        "safe_display_days":    safe_display_days,
        "forecast_label":       label,
        "next_inspection_date": next_insp,
    }


# ── PREDICTION API ROUTE ─────────────────────────────────────────────────────
@api.get("/artifacts/<int:aid>/predict")
@login_required
def predict_artifact(aid):
    from backend.models.database import get_connection, get_artifact
    art = get_artifact(aid)
    if not art: return jsonify({"error": "Artifact not found"}), 404
    conn = get_connection()
    try:
        result = predict_deterioration(aid, conn)
    except Exception as e:
        return jsonify({"error": str(e)}), 500
    finally:
        conn.close()
    return jsonify(result), 200


@api.get("/audit-logs")
@login_required
@require_role("Admin")
def audit_logs():
    from backend.models.database import get_connection
    page     = request.args.get("page",    1,    type=int)
    per_page = request.args.get("per",     50,   type=int)
    search   = request.args.get("search",  "")
    user_f   = request.args.get("user",    "")
    action_f = request.args.get("action",  "")
    offset   = (page - 1) * per_page

    conn = get_connection()
    cur  = conn.cursor()

    where  = []
    params = []
    if search:
        where.append("(username LIKE %s OR action LIKE %s OR artifact_name LIKE %s)")
        params += [f"%{search}%", f"%{search}%", f"%{search}%"]
    if user_f:
        where.append("username = %s"); params.append(user_f)
    if action_f:
        where.append("action LIKE %s"); params.append(f"%{action_f}%")

    where_sql = ("WHERE " + " AND ".join(where)) if where else ""

    cur.execute(f"SELECT COUNT(*) FROM audit_logs {where_sql}", params)
    total = cur.fetchone()[0]

    cur.execute(f"""
        SELECT log_id, username, role, action, artifact_name,
               details, ip_address, created_at
        FROM audit_logs {where_sql}
        ORDER BY created_at DESC
        LIMIT %s OFFSET %s
    """, params + [per_page, offset])

    cols = [c[0] for c in cur.description]
    rows = []
    for r in cur.fetchall():
        row = dict(zip(cols, r))
        if hasattr(row["created_at"], "isoformat"):
            row["created_at"] = row["created_at"].isoformat()
        rows.append(row)

    # Distinct usernames for filter dropdown
    cur.execute("SELECT DISTINCT username FROM audit_logs ORDER BY username")
    users = [r[0] for r in cur.fetchall()]

    cur.close(); conn.close()
    return jsonify({
        "logs":  rows,
        "total": total,
        "page":  page,
        "pages": math.ceil(total / per_page),
        "users": users,
    })


@api.delete("/audit-logs")
@login_required
@require_role("Admin")
def clear_audit_logs():
    from backend.models.database import get_connection
    days = request.args.get("days", 90, type=int)
    conn = get_connection()
    cur  = conn.cursor()
    cur.execute(
        "DELETE FROM audit_logs WHERE created_at < NOW() - INTERVAL %s DAY", (days,))
    deleted = cur.rowcount
    conn.commit(); cur.close(); conn.close()
    log_action(f"Audit Logs Cleared (>{days} days)", details=f"{deleted} rows deleted")
    return jsonify({"deleted": deleted})


@api.get("/risk-heatmap")
@login_required
def risk_heatmap_data():
    """Aggregate artifact risk by storage location for the heatmap dashboard."""
    from backend.models.database import get_connection
    import re
    from collections import defaultdict

    conn = get_connection()
    cur  = conn.cursor()
    cur.execute("""
        SELECT
            a.artifact_id,
            a.name,
            a.category,
            a.location,
            a.status,
            COALESCE(MAX(i.severity_index), 0) AS max_severity,
            COUNT(i.inspection_id)             AS inspection_count,
            MAX(i.inspection_date)             AS last_inspection
        FROM artifacts a
        LEFT JOIN inspections i ON i.artifact_id = a.artifact_id
        GROUP BY a.artifact_id
        ORDER BY max_severity DESC
    """)
    cols      = [c[0] for c in cur.description]
    artifacts = [dict(zip(cols, r)) for r in cur.fetchall()]
    cur.close(); conn.close()

    # Group by location prefix (before ' - ' or ',')
    rooms = defaultdict(lambda: {
        "artifacts":[], "total":0, "high_risk":0,
        "avg_severity":0.0, "max_severity":0.0,
    })

    for a in artifacts:
        loc      = (a.get("location") or "Unknown").strip()
        room_key = re.split(r"\s*[-,]\s*", loc)[0].strip()[:40] or "Unknown"
        entry = {
            "artifact_id":    a["artifact_id"],
            "name":           a["name"],
            "category":       a["category"],
            "status":         a["status"],
            "max_severity":   float(a["max_severity"]),
            "last_inspection":str(a["last_inspection"])[:10] if a["last_inspection"] else None,
        }
        rooms[room_key]["artifacts"].append(entry)
        rooms[room_key]["total"] += 1
        sev = float(a["max_severity"])
        if sev >= 6.0:
            rooms[room_key]["high_risk"] += 1
        rooms[room_key]["max_severity"] = max(rooms[room_key]["max_severity"], sev)

    result = []
    for room_name, data in rooms.items():
        sevs = [x["max_severity"] for x in data["artifacts"]]
        avg  = sum(sevs) / len(sevs) if sevs else 0.0
        data["avg_severity"] = round(avg, 2)
        data["room_name"]    = room_name
        if avg >= 7 or data["max_severity"] >= 8:
            data["risk_level"] = "CRITICAL"
        elif avg >= 5 or data["max_severity"] >= 6:
            data["risk_level"] = "HIGH"
        elif avg >= 3:
            data["risk_level"] = "MEDIUM"
        else:
            data["risk_level"] = "LOW"
        result.append(data)

    result.sort(key=lambda x: x["avg_severity"], reverse=True)

    return jsonify({
        "rooms":            result,
        "total_artifacts":  len(artifacts),
        "total_rooms":      len(result),
        "critical_rooms":   sum(1 for r in result if r["risk_level"] == "CRITICAL"),
        "high_risk_rooms":  sum(1 for r in result if r["risk_level"] == "HIGH"),
    })

