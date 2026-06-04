"""
app.py  —  Flask application factory & entry point
Run:  python app.py
"""
import os
import sys
from datetime import timedelta
from flask import Flask, send_from_directory
from flask_cors import CORS
from dotenv import load_dotenv

load_dotenv()
sys.path.insert(0, os.path.dirname(__file__))


def create_app() -> Flask:
    app = Flask(
        __name__,
        static_folder="frontend/static",
        template_folder="frontend/templates",
    )
    app.config["SECRET_KEY"] = "artifact-guardian-secret-2024-xyz"
    app.config["UPLOAD_FOLDER"]               = os.getenv("UPLOAD_FOLDER", "uploads")
    app.config["MAX_CONTENT_LENGTH"]          = int(os.getenv("MAX_CONTENT_LENGTH", 52428800))
    app.config["PERMANENT_SESSION_LIFETIME"]  = timedelta(hours=8)
    app.config["SESSION_COOKIE_SAMESITE"] = "Lax"
    app.config["SESSION_COOKIE_SECURE"] = False

    CORS(app, supports_credentials=True)

    # Blueprints
    from backend.routes.api import api
    from backend.routes.auth_routes import auth_bp
    app.register_blueprint(api)
    app.register_blueprint(auth_bp)

    # Serve login page
    @app.route("/login")
    def login_page():
        return send_from_directory(app.template_folder, "login.html")

    # Serve uploaded files
    @app.route("/uploads/<path:filename>")
    def uploaded_file(filename):
        return send_from_directory(app.config["UPLOAD_FOLDER"], filename)
    # Mobile camera page
    @app.route("/mobile-camera")
    def mobile_camera():
        return send_from_directory(app.template_folder, "mobile_camera.html")

    # SPA catch-all
    @app.route("/", defaults={"path": ""})
    @app.route("/<path:path>")
    def serve_spa(path):
    # Never serve SPA for API routes
        if path.startswith("api/") or path.startswith("api"):
            from flask import abort
            abort(404)
        static_file = os.path.join(app.static_folder, path)
        if path and os.path.exists(static_file):
           return send_from_directory(app.static_folder, path)
        return send_from_directory(app.template_folder, "index.html")

    return app


if __name__ == "__main__":
    application = create_app()
    application.run(
        host="0.0.0.0",
        port=5000,
        debug=os.getenv("FLASK_DEBUG", "True") == "True",
    )
