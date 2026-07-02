"""
database.py  —  All MySQL database operations using mysql-connector-python
"""
import os
import json
from datetime import date, datetime
import mysql.connector
from dotenv import load_dotenv

load_dotenv()


# ── Connection ────────────────────────────────────────────────────────────────

def get_connection():
    return mysql.connector.connect(
        host=os.getenv("DB_HOST", "localhost"),
        port=int(os.getenv("DB_PORT", 3306)),
        user=os.getenv("DB_USER", "root"),
        password=os.getenv("DB_PASSWORD", ""),
        database=os.getenv("DB_NAME", "artifact_guardian1"),
        autocommit=False,
    )


def _serialize(v):
    if isinstance(v, (date, datetime)):
        return v.isoformat()
    return v


def _row(cursor, row):
    cols = [c[0] for c in cursor.description]
    return {k: _serialize(v) for k, v in zip(cols, row)}


def _all(cursor):
    return [_row(cursor, r) for r in cursor.fetchall()]


# ── Users ─────────────────────────────────────────────────────────────────────

def get_user_by_username(username):
    conn = get_connection()
    cur = conn.cursor()
    cur.execute(
        """SELECT u.*, r.role_name, r.can_upload, r.can_edit, r.can_delete, r.can_admin
           FROM users u JOIN roles r ON r.role_id = u.role_id
           WHERE u.username = %s""", (username,))
    row = cur.fetchone()
    result = _row(cur, row) if row else None
    cur.close(); conn.close()
    return result


def get_user_by_id(user_id):
    conn = get_connection()
    cur = conn.cursor()
    cur.execute(
        """SELECT u.*, r.role_name FROM users u
           JOIN roles r ON r.role_id = u.role_id WHERE u.user_id = %s""", (user_id,))
    row = cur.fetchone()
    result = _row(cur, row) if row else None
    cur.close(); conn.close()
    return result


def get_all_users():
    conn = get_connection()
    cur = conn.cursor()
    cur.execute(
        """SELECT u.user_id, u.username, u.email, u.full_name, u.is_active,
                  u.alert_email, u.last_login, r.role_name, u.role_id
           FROM users u JOIN roles r ON r.role_id = u.role_id
           ORDER BY u.created_at DESC""")
    rows = _all(cur)
    cur.close(); conn.close()
    return rows


def create_user(username, email, password_hash, full_name, role_id=3, alert_email=None):
    conn = get_connection()
    cur = conn.cursor()
    cur.execute(
        """INSERT INTO users (username, email, password_hash, full_name, role_id, alert_email)
           VALUES (%s, %s, %s, %s, %s, %s)""",
        (username, email, password_hash, full_name, role_id, alert_email or email))
    conn.commit()
    new_id = cur.lastrowid
    cur.close(); conn.close()
    return new_id


def update_last_login(user_id):
    conn = get_connection()
    cur = conn.cursor()
    cur.execute("UPDATE users SET last_login = NOW() WHERE user_id = %s", (user_id,))
    conn.commit()
    cur.close(); conn.close()


def update_user(user_id, full_name, email, alert_email, role_id, is_active=None):
    conn = get_connection()
    cur = conn.cursor()
    if is_active is not None:
        cur.execute(
            "UPDATE users SET full_name=%s, email=%s, alert_email=%s, role_id=%s, is_active=%s WHERE user_id=%s",
            (full_name, email, alert_email, role_id, is_active, user_id))
    else:
        cur.execute(
            "UPDATE users SET full_name=%s, email=%s, alert_email=%s, role_id=%s WHERE user_id=%s",
            (full_name, email, alert_email, role_id, user_id))
    conn.commit()
    cur.close(); conn.close()


def update_own_profile(user_id, full_name, email):
    """Self-service profile update — only touches name/email, never role or status."""
    conn = get_connection()
    cur = conn.cursor()
    cur.execute(
        "UPDATE users SET full_name=%s, email=%s WHERE user_id=%s",
        (full_name, email, user_id))
    conn.commit()
    cur.close(); conn.close()


def update_user_password(user_id, password_hash):
    conn = get_connection()
    cur = conn.cursor()
    cur.execute(
        "UPDATE users SET password_hash=%s WHERE user_id=%s",
        (password_hash, user_id))
    conn.commit()
    cur.close(); conn.close()


def set_user_active(user_id, is_active):
    conn = get_connection()
    cur = conn.cursor()
    cur.execute(
        "UPDATE users SET is_active=%s WHERE user_id=%s",
        (is_active, user_id))
    conn.commit()
    cur.close(); conn.close()


# ── Artifacts ─────────────────────────────────────────────────────────────────

def get_all_artifacts():
    conn = get_connection()
    cur = conn.cursor()
    cur.execute(
        """SELECT a.*, u.full_name AS custodian_name,
                  (SELECT MAX(severity_index) FROM inspections WHERE artifact_id = a.artifact_id) AS max_severity,
                  (SELECT COUNT(*) FROM inspections WHERE artifact_id = a.artifact_id) AS inspection_count
           FROM artifacts a
           LEFT JOIN users u ON u.user_id = a.custodian_id
           ORDER BY a.created_at DESC""")
    rows = _all(cur)
    cur.close(); conn.close()
    return rows


def get_artifact(artifact_id):
    conn = get_connection()
    cur = conn.cursor()
    cur.execute(
        """SELECT a.*, u.full_name AS custodian_name
           FROM artifacts a LEFT JOIN users u ON u.user_id = a.custodian_id
           WHERE a.artifact_id = %s""", (artifact_id,))
    row = cur.fetchone()
    result = _row(cur, row) if row else None
    cur.close(); conn.close()
    return result


def create_artifact(name, category, age, location, description, custodian_id=None, cover_image=None):
    conn = get_connection()
    cur = conn.cursor()
    cur.execute(
        """INSERT INTO artifacts (name, category, age, location, description, custodian_id, cover_image)
           VALUES (%s, %s, %s, %s, %s, %s, %s)""",
        (name, category, age, location, description, custodian_id, cover_image))
    conn.commit()
    new_id = cur.lastrowid
    cur.close(); conn.close()
    return new_id


def update_artifact(artifact_id, name, category, age, location, description, status):
    conn = get_connection()
    cur = conn.cursor()
    cur.execute(
        """UPDATE artifacts SET name=%s, category=%s, age=%s, location=%s,
           description=%s, status=%s WHERE artifact_id=%s""",
        (name, category, age, location, description, status, artifact_id))
    conn.commit()
    cur.close(); conn.close()


def delete_artifact(artifact_id):
    conn = get_connection()
    cur = conn.cursor()
    cur.execute("DELETE FROM artifacts WHERE artifact_id = %s", (artifact_id,))
    conn.commit()
    cur.close(); conn.close()


def update_artifact_status(artifact_id, status):
    conn = get_connection()
    cur = conn.cursor()
    cur.execute("UPDATE artifacts SET status=%s WHERE artifact_id=%s", (status, artifact_id))
    conn.commit()
    cur.close(); conn.close()


def update_artifact_cover(artifact_id, cover_image):
    conn = get_connection()
    cur = conn.cursor()
    cur.execute("UPDATE artifacts SET cover_image=%s WHERE artifact_id=%s", (cover_image, artifact_id))
    conn.commit()
    cur.close(); conn.close()


# ── Inspections ───────────────────────────────────────────────────────────────

def get_inspections(artifact_id=None, search=None, limit=200):
    conn = get_connection()
    cur = conn.cursor()
    q = """SELECT i.*, a.name AS artifact_name, u.full_name AS inspector_name
           FROM inspections i
           JOIN artifacts a ON a.artifact_id = i.artifact_id
           LEFT JOIN users u ON u.user_id = i.inspector_id
           WHERE 1=1"""
    params = []
    if artifact_id:
        q += " AND i.artifact_id = %s"
        params.append(artifact_id)
    if search:
        q += " AND (a.name LIKE %s OR i.damage_notes LIKE %s)"
        params += [f"%{search}%", f"%{search}%"]
    q += f" ORDER BY i.inspection_date DESC LIMIT {int(limit)}"
    cur.execute(q, params)
    rows = _all(cur)
    cur.close(); conn.close()
    return rows


def get_inspection(inspection_id):
    conn = get_connection()
    cur = conn.cursor()
    cur.execute(
        """SELECT i.*, a.name AS artifact_name
           FROM inspections i JOIN artifacts a ON a.artifact_id = i.artifact_id
           WHERE i.inspection_id = %s""", (inspection_id,))
    row = cur.fetchone()
    result = _row(cur, row) if row else None
    cur.close(); conn.close()
    return result


def save_inspection(artifact_id, image_path=None, crack_detected=False, fading_level=0,
                    severity_index=0, damage_notes="", ai_report="", inspection_type='Routine',
                    inspector_id=None, inspection_date=None):
    conn = get_connection()
    cur = conn.cursor()
    if inspection_date:
        cur.execute(
            """INSERT INTO inspections
               (artifact_id, inspector_id, inspection_date, inspection_type,
                crack_detected, fading_level, severity_index, damage_notes, ai_report)
               VALUES (%s, %s, %s, %s, %s, %s, %s, %s, %s)""",
            (artifact_id, inspector_id, inspection_date, inspection_type, crack_detected,
             fading_level, severity_index, damage_notes, ai_report))
    else:
        cur.execute(
            """INSERT INTO inspections
               (artifact_id, inspector_id, inspection_date, inspection_type,
                crack_detected, fading_level, severity_index, damage_notes, ai_report)
               VALUES (%s, %s, CURDATE(), %s, %s, %s, %s, %s, %s)""",
            (artifact_id, inspector_id, inspection_type, crack_detected,
             fading_level, severity_index, damage_notes, ai_report))
    conn.commit()
    new_id = cur.lastrowid
    cur.close(); conn.close()
    return new_id

def get_trend_data(artifact_id):
    conn = get_connection()
    cur = conn.cursor()
    cur.execute(
        """SELECT inspection_date, severity_index, fading_level, crack_detected
           FROM inspections WHERE artifact_id = %s ORDER BY inspection_date""",
        (artifact_id,))
    rows = _all(cur)
    cur.close(); conn.close()
    return rows


def get_monthly_stats(year=None):
    conn = get_connection()
    cur = conn.cursor()
    y = year or datetime.now().year
    cur.execute(
        """SELECT MONTH(inspection_date) AS month, COUNT(*) AS count,
                  AVG(severity_index) AS avg_sev, SUM(crack_detected) AS cracks
           FROM inspections WHERE YEAR(inspection_date) = %s
           GROUP BY MONTH(inspection_date) ORDER BY month""", (y,))
    rows = _all(cur)
    cur.close(); conn.close()
    return rows


# ── Inspection Images ─────────────────────────────────────────────────────────

def save_inspection_image(inspection_id, artifact_id, file_path, image_type='Standard'):
    conn = get_connection()
    cur = conn.cursor()
    cur.execute(
        """INSERT INTO inspection_images (inspection_id, artifact_id, file_path, image_type)
           VALUES (%s, %s, %s, %s)""",
        (inspection_id, artifact_id, file_path, image_type))
    conn.commit()
    new_id = cur.lastrowid
    cur.close(); conn.close()
    return new_id


def get_inspection_images(inspection_id=None, artifact_id=None):
    conn = get_connection()
    cur = conn.cursor()
    q = "SELECT * FROM inspection_images WHERE 1=1"
    params = []
    if inspection_id:
        q += " AND inspection_id = %s"; params.append(inspection_id)
    if artifact_id:
        q += " AND artifact_id = %s"; params.append(artifact_id)
    q += " ORDER BY uploaded_at DESC"
    cur.execute(q, params)
    rows = _all(cur)
    cur.close(); conn.close()
    return rows


# ── Video Inspections ─────────────────────────────────────────────────────────

def save_video_inspection(artifact_id, inspector_id, video_path,
                          missing_objects, detected_objects, detection_report, frame_count=0):
    conn = get_connection()
    cur = conn.cursor()
    cur.execute(
        """INSERT INTO video_inspections
           (artifact_id, inspector_id, video_path, missing_objects, detected_objects,
            detection_report, frame_count)
           VALUES (%s, %s, %s, %s, %s, %s, %s)""",
        (artifact_id, inspector_id, video_path,
         json.dumps(missing_objects), json.dumps(detected_objects),
         detection_report, frame_count))
    conn.commit()
    new_id = cur.lastrowid
    cur.close(); conn.close()
    return new_id


def get_video_inspections(artifact_id=None):
    conn = get_connection()
    cur = conn.cursor()
    q = """SELECT v.*, a.name AS artifact_name
           FROM video_inspections v JOIN artifacts a ON a.artifact_id = v.artifact_id
           WHERE 1=1"""
    params = []
    if artifact_id:
        q += " AND v.artifact_id = %s"; params.append(artifact_id)
    q += " ORDER BY v.inspection_date DESC"
    cur.execute(q, params)
    rows = _all(cur)
    cur.close(); conn.close()
    return rows


# ── Alerts ────────────────────────────────────────────────────────────────────

def get_alerts(unread_only=False, limit=100):
    conn = get_connection()
    cur = conn.cursor()
    q = """SELECT al.*, a.name AS artifact_name
           FROM alerts al JOIN artifacts a ON a.artifact_id = al.artifact_id"""
    if unread_only:
        q += " WHERE al.is_read = FALSE"
    q += " ORDER BY al.alert_date DESC LIMIT %s"
    cur.execute(q, (limit,))
    rows = _all(cur)
    cur.close(); conn.close()
    return rows


def create_alert(artifact_id, message, severity='MEDIUM', alert_type='Damage', inspector_id=None):
    conn = get_connection()
    cur = conn.cursor()
    cur.execute(
        """INSERT INTO alerts (artifact_id, alert_message, severity, alert_type, inspector_id)
           VALUES (%s, %s, %s, %s, %s)""",
        (artifact_id, message, severity, alert_type, inspector_id))
    conn.commit()
    cur.close(); conn.close()


def mark_alert_read(alert_id):
    conn = get_connection()
    cur = conn.cursor()
    cur.execute("UPDATE alerts SET is_read = TRUE WHERE alert_id = %s", (alert_id,))
    conn.commit()
    cur.close(); conn.close()


def mark_all_alerts_read():
    conn = get_connection()
    cur = conn.cursor()
    cur.execute("UPDATE alerts SET is_read = TRUE WHERE is_read = FALSE")
    conn.commit()
    cur.close(); conn.close()


# ── Shipments ─────────────────────────────────────────────────────────────────

def get_shipments(artifact_id=None):
    conn = get_connection()
    cur = conn.cursor()
    q = """SELECT s.*, a.name AS artifact_name
           FROM shipments s JOIN artifacts a ON a.artifact_id = s.artifact_id
           WHERE 1=1"""
    params = []
    if artifact_id:
        q += " AND s.artifact_id = %s"; params.append(artifact_id)
    q += " ORDER BY s.created_at DESC"
    cur.execute(q, params)
    rows = _all(cur)
    cur.close(); conn.close()
    return rows


def create_shipment(artifact_id, origin, destination, shipment_date,
                    expected_arrival, responsible_user_id, notes):
    conn = get_connection()
    cur = conn.cursor()
    cur.execute(
        """INSERT INTO shipments
           (artifact_id, origin, destination, shipment_date, expected_arrival,
            responsible_user_id, notes)
           VALUES (%s, %s, %s, %s, %s, %s, %s)""",
        (artifact_id, origin, destination, shipment_date,
         expected_arrival, responsible_user_id, notes))
    conn.commit()
    new_id = cur.lastrowid
    cur.close(); conn.close()
    return new_id


def update_shipment(shipment_id, status, notes=None, condition_on_arrival=None):
    conn = get_connection()
    cur = conn.cursor()
    if condition_on_arrival is not None:
        cur.execute(
            """UPDATE shipments SET status=%s, notes=%s, condition_on_arrival=%s
               WHERE shipment_id=%s""",
            (status, notes, condition_on_arrival, shipment_id))
    else:
        cur.execute(
            "UPDATE shipments SET status=%s, notes=%s WHERE shipment_id=%s",
            (status, notes, shipment_id))
    conn.commit()
    cur.close(); conn.close()


# ── Dashboard Stats ────────────────────────────────────────────────────────────

def get_dashboard_stats():
    conn = get_connection()
    cur = conn.cursor()

    cur.execute("SELECT COUNT(*) FROM artifacts")
    total_artifacts = cur.fetchone()[0]

    cur.execute("SELECT COUNT(*) FROM inspections")
    total_inspections = cur.fetchone()[0]

    cur.execute("SELECT COUNT(*) FROM alerts WHERE is_read = FALSE")
    unread_alerts = cur.fetchone()[0]

    cur.execute("SELECT COALESCE(AVG(severity_index), 0) FROM inspections")
    avg_severity = round(float(cur.fetchone()[0]), 2)

    cur.execute(
        """SELECT a.name, MAX(i.severity_index) AS max_sev
           FROM inspections i JOIN artifacts a ON a.artifact_id = i.artifact_id
           GROUP BY a.artifact_id ORDER BY max_sev DESC LIMIT 6""")
    top_damaged = [{"name": r[0], "severity": float(r[1])} for r in cur.fetchall()]

    cur.execute(
        """SELECT MONTH(inspection_date) AS m, COUNT(*) AS c
           FROM inspections WHERE YEAR(inspection_date) = YEAR(NOW())
           GROUP BY MONTH(inspection_date) ORDER BY m""")
    monthly = {r[0]: r[1] for r in cur.fetchall()}

    cur.execute("SELECT status, COUNT(*) FROM artifacts GROUP BY status")
    status_dist = {r[0]: r[1] for r in cur.fetchall()}

    cur.close(); conn.close()
    return {
        "total_artifacts": total_artifacts,
        "total_inspections": total_inspections,
        "unread_alerts": unread_alerts,
        "avg_severity": avg_severity,
        "top_damaged": top_damaged,
        "monthly_inspections": monthly,
        "status_distribution": status_dist,
    }
