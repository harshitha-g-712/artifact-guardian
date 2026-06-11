"""
auth_routes.py  —  Login / logout / register / user management
"""
from flask import Blueprint, request, jsonify, session
from backend.models.database import (
    get_user_by_username, create_user, get_all_users,
    update_last_login, update_user, update_user_password, set_user_active,
)
from backend.utils.auth import hash_password, verify_password, login_required, role_required

auth_bp = Blueprint("auth", __name__, url_prefix="/api/auth")


# ── Paste this helper at the top of auth_routes.py ──────────────────────────
def log_action(action: str, artifact_id=None, artifact_name=None, details=None):
    """Duplicated from api.py so auth_routes.py can log without circular imports."""
    from backend.models.database import get_connection
    from flask import request as _req
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
            _req.remote_addr,
        ))
        conn.commit()
        cur.close()
        conn.close()
    except Exception as e:
        print(f"[AUDIT] Log failed: {e}")


@auth_bp.post("/login")
def login():
    data     = request.get_json(force=True)
    username = data.get("username", "").strip()
    password = data.get("password", "")
    if not username or not password:
        return jsonify({"error": "Username and password required"}), 400

    user = get_user_by_username(username)
    if not user:
        return jsonify({"error": "Invalid credentials"}), 401
    if not verify_password(password, user["password_hash"]):
        return jsonify({"error": "Invalid credentials"}), 401
    if not user.get("is_active"):
        return jsonify({"error": "Account disabled — contact administrator"}), 403

    session.permanent  = True
    session["user_id"]   = user["user_id"]
    session["username"]  = user["username"]
    session["role_name"] = user["role_name"]
    session["full_name"] = user.get("full_name", "")
    session["can_admin"] = user.get("can_admin", False)
    session["can_delete"]= user.get("can_delete", False)

    update_last_login(user["user_id"])

    # ✅ Correct — log after session is set so session["username"] is available
    log_action("User Login", details=f"Role:{user['role_name']}")

    return jsonify({
        "status": "ok",
        "user": {
            "user_id":   user["user_id"],
            "username":  user["username"],
            "full_name": user.get("full_name", ""),
            "role":      user["role_name"],
            "can_admin": user.get("can_admin", False),
            "can_delete":user.get("can_delete", False),
            "can_edit":  user.get("can_edit", False),
        }
    })


@auth_bp.post("/logout")
def logout():
    # Log before clearing session so username is still available
    log_action("User Logout")
    session.clear()
    return jsonify({"status": "logged out"})


@auth_bp.get("/me")
def me():
    if "user_id" not in session:
        return jsonify({"logged_in": False}), 401

    role     = session.get("role_name", "")
    is_power = role in ("Admin", "Curator")

    permissions = {
        "can_analyze":          is_power,
        "can_edit_artifacts":   is_power,
        "can_delete_artifacts": role == "Admin",
        "can_manage_users":     role == "Admin",
        "can_import":           role == "Admin",
        "can_export_excel":     role == "Admin",
        "can_camera":           is_power,
        "can_compare":          is_power,
        "can_shipments":        is_power,
        "can_reports":          is_power,
    }

    return jsonify({
        "logged_in":   True,
        "user_id":     session["user_id"],
        "username":    session["username"],
        "role":        role,
        "full_name":   session.get("full_name", ""),
        "can_admin":   session.get("can_admin", False),
        "can_delete":  session.get("can_delete", False),
        "permissions": permissions,
    })


@auth_bp.post("/register")
@login_required
@role_required("Admin")
def register():
    data     = request.get_json(force=True)
    required = ("username", "email", "password", "full_name", "role_id")
    if not all(k in data for k in required):
        return jsonify({"error": f"Required fields: {list(required)}"}), 400
    pw_hash = hash_password(data["password"])
    try:
        uid = create_user(
            data["username"], data["email"], pw_hash,
            data["full_name"], int(data["role_id"]),
            data.get("alert_email", data["email"]),
        )
        log_action("User Created", details=f"New user: {data['username']} Role:{data['role_id']}")
        return jsonify({"user_id": uid, "status": "created"}), 201
    except Exception as e:
        return jsonify({"error": str(e)}), 409


@auth_bp.get("/users")
@login_required
@role_required("Admin")
def list_users():
    return jsonify(get_all_users())


@auth_bp.put("/users/<int:user_id>")
@login_required
@role_required("Admin")
def edit_user(user_id):
    data = request.get_json(force=True)
    is_active = data.get("is_active")
    if is_active is not None:
        is_active = int(is_active)
    update_user(
        user_id,
        data.get("full_name", ""),
        data.get("email", ""),
        data.get("alert_email", data.get("email", "")),
        int(data.get("role_id", 3)),
        is_active=is_active
    )
    log_action("User Edited", details=f"user_id:{user_id}")
    return jsonify({"status": "updated"})


@auth_bp.put("/users/<int:user_id>/password")
@login_required
@role_required("Admin")
def reset_user_password(user_id):
    data = request.get_json(force=True)
    password = data.get("password", "")
    if not password or len(password) < 6:
        return jsonify({"error": "Password must be at least 6 characters"}), 400
    from backend.utils.auth import hash_password
    pw_hash = hash_password(password)
    update_user_password(user_id, pw_hash)
    log_action("Password Reset", details=f"user_id:{user_id}")
    return jsonify({"status": "password updated"})


@auth_bp.put("/users/<int:user_id>/active")
@login_required
@role_required("Admin")
def toggle_user_active(user_id):
    data = request.get_json(force=True)
    is_active = int(data.get("is_active", 1))
    set_user_active(user_id, is_active)
    action = "User Activated" if is_active else "User Deactivated"
    log_action(action, details=f"user_id:{user_id}")
    return jsonify({"status": "updated", "is_active": is_active})
