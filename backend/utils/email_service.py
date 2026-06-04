"""
email_service.py  —  SMTP email alerts (Gmail or any SMTP)
"""
import os
import smtplib
from email.mime.multipart import MIMEMultipart
from email.mime.text import MIMEText
from dotenv import load_dotenv

load_dotenv()


def _cfg():
    return {
        "server":   os.getenv("MAIL_SERVER", "smtp.gmail.com"),
        "port":     int(os.getenv("MAIL_PORT", 587)),
        "tls":      os.getenv("MAIL_USE_TLS", "True") == "True",
        "user":     os.getenv("MAIL_USERNAME", ""),
        "password": os.getenv("MAIL_PASSWORD", ""),
        "sender":   os.getenv("MAIL_DEFAULT_SENDER", ""),
    }


def send_email(to_email: str, subject: str, html_body: str, text_body: str = "") -> bool:
    cfg = _cfg()
    if not cfg["user"] or not cfg["password"]:
        print(f"[EMAIL] SMTP not configured — skipping email to {to_email}")
        return False
    try:
        msg = MIMEMultipart("alternative")
        msg["Subject"] = subject
        msg["From"] = cfg["sender"]
        msg["To"] = to_email
        if text_body:
            msg.attach(MIMEText(text_body, "plain"))
        msg.attach(MIMEText(html_body, "html"))
        with smtplib.SMTP(cfg["server"], cfg["port"]) as server:
            if cfg["tls"]:
                server.starttls()
            server.login(cfg["user"], cfg["password"])
            server.sendmail(cfg["sender"], to_email, msg.as_string())
        print(f"[EMAIL] Sent '{subject}' → {to_email}")
        return True
    except Exception as e:
        print(f"[EMAIL] Failed: {e}")
        return False


def _sev_color(severity):
    return {"CRITICAL": "#dc2626", "HIGH": "#ea580c",
            "MEDIUM": "#d97706", "LOW": "#16a34a"}.get(severity, "#6b7280")


def send_damage_alert(to_email, artifact_name, severity, severity_index, message):
    c = _sev_color(severity)
    app_url = os.getenv("APP_URL", "http://localhost:5000")
    html = f"""<!DOCTYPE html>
<html><body style="font-family:Inter,Arial,sans-serif;background:#0b1120;margin:0;padding:20px;">
<div style="max-width:600px;margin:0 auto;background:#111827;border-radius:16px;overflow:hidden;">
  <div style="background:{c};padding:28px;text-align:center;">
    <h1 style="color:#fff;margin:0;font-size:26px;">⚠ ARTIFACT ALERT</h1>
    <p style="color:rgba(255,255,255,.85);margin:8px 0 0;font-size:15px;">{severity} Risk Detected</p>
  </div>
  <div style="padding:32px;">
    <h2 style="color:#f1f5f9;margin:0 0 16px;">{artifact_name}</h2>
    <div style="background:#0b1120;border-left:4px solid {c};padding:16px;border-radius:6px;margin-bottom:20px;">
      <p style="color:#cbd5e1;margin:0;line-height:1.6;">{message}</p>
    </div>
    <table style="width:100%;border-collapse:collapse;">
      <tr>
        <td style="padding:10px;color:#94a3b8;border-bottom:1px solid #1f2d3d;">Risk Level</td>
        <td style="padding:10px;border-bottom:1px solid #1f2d3d;">
          <span style="background:{c};color:#fff;padding:4px 14px;border-radius:20px;font-size:13px;font-weight:700;">{severity}</span>
        </td>
      </tr>
      <tr>
        <td style="padding:10px;color:#94a3b8;">Severity Index</td>
        <td style="padding:10px;color:#f1f5f9;font-weight:700;font-size:18px;">{severity_index} / 10.0</td>
      </tr>
    </table>
    <a href="{app_url}" style="display:inline-block;background:{c};color:#fff;padding:13px 28px;
       border-radius:10px;text-decoration:none;margin-top:24px;font-weight:700;">
      View in Artifact Guardian →
    </a>
  </div>
  <div style="padding:16px;background:#0b1120;text-align:center;color:#475569;font-size:12px;">
    Artifact Guardian — AI Heritage Preservation System
  </div>
</div></body></html>"""
    text = f"ARTIFACT ALERT [{severity}]\n\nArtifact: {artifact_name}\nSeverity Index: {severity_index}/10\n\n{message}\n\nView: {app_url}"
    return send_email(to_email, f"[{severity}] Artifact Alert: {artifact_name}", html, text)


def send_missing_object_alert(to_email, artifact_name, missing_objects, video_filename):
    app_url = os.getenv("APP_URL", "http://localhost:5000")
    items = "".join(f"<li style='color:#fca5a5;padding:5px 0;font-size:14px;'>🔴 {obj}</li>" for obj in missing_objects)
    html = f"""<!DOCTYPE html>
<html><body style="font-family:Inter,Arial,sans-serif;background:#0b1120;margin:0;padding:20px;">
<div style="max-width:600px;margin:0 auto;background:#111827;border-radius:16px;overflow:hidden;">
  <div style="background:#7f1d1d;padding:28px;text-align:center;">
    <h1 style="color:#fff;margin:0;font-size:26px;">🚨 MISSING OBJECTS DETECTED</h1>
    <p style="color:rgba(255,255,255,.85);margin:8px 0 0;">Video analysis has flagged missing items</p>
  </div>
  <div style="padding:32px;">
    <h2 style="color:#f1f5f9;margin:0 0 8px;">{artifact_name}</h2>
    <p style="color:#94a3b8;margin-bottom:16px;">Source video: <code style="background:#0b1120;padding:3px 8px;border-radius:4px;">{video_filename}</code></p>
    <p style="color:#f1f5f9;font-weight:600;margin-bottom:8px;">The following objects were NOT detected:</p>
    <ul style="background:#450a0a;padding:16px 16px 16px 36px;border-radius:8px;list-style:none;">{items}</ul>
    <a href="{app_url}" style="display:inline-block;background:#dc2626;color:#fff;padding:13px 28px;border-radius:10px;text-decoration:none;margin-top:24px;font-weight:700;">View Dashboard →</a>
  </div>
</div></body></html>"""
    text = f"MISSING OBJECTS ALERT\n\nArtifact: {artifact_name}\nVideo: {video_filename}\nMissing: {', '.join(missing_objects)}\n\nView: {app_url}"
    return send_email(to_email, f"[CRITICAL] Missing Objects Detected: {artifact_name}", html, text)


def send_shipment_report(to_email, artifact_name, shipment_info, pre_report, post_report):
    app_url = os.getenv("APP_URL", "http://localhost:5000")
    html = f"""<!DOCTYPE html>
<html><body style="font-family:Inter,Arial,sans-serif;background:#0b1120;margin:0;padding:20px;">
<div style="max-width:620px;margin:0 auto;background:#111827;border-radius:16px;overflow:hidden;">
  <div style="background:#1e3a5f;padding:28px;text-align:center;">
    <h1 style="color:#fff;margin:0;font-size:24px;">📦 Shipment Inspection Report</h1>
    <p style="color:rgba(255,255,255,.8);margin:8px 0 0;">{artifact_name}</p>
  </div>
  <div style="padding:32px;">
    <p style="color:#94a3b8;margin-bottom:24px;">
      <strong style="color:#e2e8f0;">From:</strong> {shipment_info.get('origin','—')} &nbsp;→&nbsp;
      <strong style="color:#e2e8f0;">To:</strong> {shipment_info.get('destination','—')}
    </p>
    <h3 style="color:#60a5fa;margin-bottom:8px;">Pre-Shipment Report</h3>
    <pre style="background:#0b1120;padding:14px;border-radius:8px;color:#a5b4fc;font-size:12px;white-space:pre-wrap;overflow-x:auto;">{pre_report}</pre>
    <h3 style="color:#34d399;margin:20px 0 8px;">Post-Shipment Report</h3>
    <pre style="background:#0b1120;padding:14px;border-radius:8px;color:#6ee7b7;font-size:12px;white-space:pre-wrap;overflow-x:auto;">{post_report}</pre>
    <a href="{app_url}" style="display:inline-block;background:#1e3a5f;color:#fff;padding:13px 28px;border-radius:10px;text-decoration:none;margin-top:24px;font-weight:700;">View Full Report →</a>
  </div>
</div></body></html>"""
    return send_email(to_email, f"Shipment Report: {artifact_name}", html)
