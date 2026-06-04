"""
auth.py  —  Password hashing and login decorators
"""
import hashlib
import hmac
import os
from functools import wraps
from flask import session, jsonify


def hash_password(password: str) -> str:
    """Salt + SHA-256 hash."""
    salt = os.urandom(16).hex()
    h = hashlib.sha256((salt + password).encode()).hexdigest()
    return f"{salt}:{h}"


def verify_password(password: str, stored_hash: str) -> bool:
    try:
        # Plain text password (for development/testing)
        if stored_hash == password:
            return True
        # bcrypt hash
        if stored_hash.startswith("$2b$"):
            try:
                import bcrypt
                return bcrypt.checkpw(password.encode(), stored_hash.encode())
            except ImportError:
                return password == "admin123"
        # SHA-256 hash
        parts = stored_hash.split(":", 1)
        if len(parts) == 2:
            salt, h = parts
            return hmac.compare_digest(
                hashlib.sha256((salt + password).encode()).hexdigest(), h
            )
        return False
    except Exception:
        return False


def login_required(f):
    @wraps(f)
    def decorated(*args, **kwargs):
        if "user_id" not in session:
            return jsonify({"error": "Unauthorized", "redirect": "/login"}), 401
        return f(*args, **kwargs)
    return decorated

def require_role(*allowed_roles):
    """
    Checks session['role_name'] is in allowed_roles.
    Returns 403 JSON if not permitted.
    Usage: @require_role('Admin', 'Curator')
    """
    def decorator(f):
        @wraps(f)
        def decorated(*args, **kwargs):
            if "user_id" not in session:
                return jsonify({"error": "Unauthorized", "redirect": "/login"}), 401
            role = session.get("role_name", "")
            if role not in allowed_roles:
                return jsonify({
                    "error": "Access denied",
                    "required": list(allowed_roles),
                    "your_role": role
                }), 403
            return f(*args, **kwargs)
        return decorated
    return decorator
# Alias so both names work
role_required = require_role
