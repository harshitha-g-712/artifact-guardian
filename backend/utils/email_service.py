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
        "password": os.getenv("MAIL_PASSWORD", "").replace(" ", ""),  # strip spaces from app password
        "sender":   os.getenv("MAIL_DEFAULT_SENDER", os.getenv("MAIL_USERNAME", "")),
        "fallback": os.getenv("ALERT_FALLBACK_EMAIL", ""),
    }


def send_email(to_email: str, subject: str, html_body: str, text_body: str = "") -> bool:
    cfg = _cfg()
    if not cfg["user"] or not cfg["password"]:
        print(f"[EMAIL] SMTP not configured -- skipping email to {to_email}")
        print(f"[EMAIL] Set MAIL_USERNAME and MAIL_PASSWORD in .env file")
        return False
    if not to_email or "@" not in to_email:
        print(f"[EMAIL] Invalid recipient: {to_email}")
        return False
    try:
        msg = MIMEMultipart("alternative")
        msg["Subject"] = subject
        msg["From"]    = cfg["sender"] or cfg["user"]
        msg["To"]      = to_email
        if text_body:
            msg.attach(MIMEText(text_body, "plain"))
        msg.attach(MIMEText(html_body, "html"))
        with smtplib.SMTP(cfg["server"], cfg["port"], timeout=10) as server:
            server.ehlo()
            if cfg["tls"]:
                server.starttls()
                server.ehlo()
            server.login(cfg["user"], cfg["password"])
            server.sendmail(cfg["sender"] or cfg["user"], [to_email], msg.as_string())
        print(f"[EMAIL] Sent '{subject}' -> {to_email}")
        return True
    except smtplib.SMTPAuthenticationError:
        print(f"[EMAIL] Auth failed. Use Gmail App Password (myaccount.google.com -> Security -> App Passwords)")
        return False
    except Exception as e:
        print(f"[EMAIL] Failed: {e}")
        return False


def send_test_email(to_email: str) -> dict:
    """Send a test email to verify SMTP config."""
    cfg = _cfg()
    if not cfg["user"] or not cfg["password"]:
        return {"success": False, "error": "SMTP not configured. Set MAIL_USERNAME and MAIL_PASSWORD in .env"}
    app_url = os.getenv("APP_URL", "http://localhost:5000")
    html = f"""<!DOCTYPE html>
<html><body style="font-family:Arial,sans-serif;background:#0b1120;margin:0;padding:20px;">
<div style="max-width:520px;margin:0 auto;background:#111827;border-radius:16px;overflow:hidden;">
  <div style="background:#1a3352;padding:24px;text-align:center;">
    <h1 style="color:#fff;margin:0;font-size:22px;">Email Test Successful</h1>
    <p style="color:rgba(255,255,255,.8);margin:8px 0 0;">Artifact Guardian Email System</p>
  </div>
  <div style="padding:28px;">
    <p style="color:#cbd5e1;line-height:1.7;">Your email configuration is working correctly.
    Artifact Guardian will send damage alerts, missing object notifications and
    shipment reports to this address.</p>
    <div style="background:#0b1120;border-left:4px solid #c9951a;padding:14px;border-radius:6px;margin:20px 0;">
      <p style="color:#fbbf24;margin:0;font-size:13px;font-weight:600;">Configured sender: {cfg['user']}</p>
      <p style="color:#94a3b8;margin:8px 0 0;font-size:12px;">SMTP: {cfg['server']}:{cfg['port']}</p>
    </div>
    <a href="{app_url}" style="display:inline-block;background:#1a3352;color:#fff;
       padding:12px 24px;border-radius:10px;text-decoration:none;font-weight:600;">
      Open Artifact Guardian
    </a>
  </div>
</div></body></html>"""
    success = send_email(to_email, "Artifact Guardian -- Email Test", html,
                         "Email test successful. Your SMTP configuration is working.")
    if success:
        return {"success": True, "message": f"Test email sent to {to_email}"}
    else:
        return {"success": False, "error": "Failed. Check MAIL_PASSWORD -- use Gmail App Password not regular password."}


def _sev_color(severity):
    return {"CRITICAL": "#dc2626", "HIGH": "#ea580c",
            "MEDIUM": "#d97706", "LOW": "#16a34a"}.get(severity, "#6b7280")


def send_damage_alert(to_email, artifact_name, severity, severity_index, message):
    c = _sev_color(severity)
    app_url = os.getenv("APP_URL", "http://localhost:5000")
    html = f"""<!DOCTYPE html>
<html><body style="font-family:Arial,sans-serif;background:#0b1120;margin:0;padding:20px;">
<div style="max-width:600px;margin:0 auto;background:#111827;border-radius:16px;overflow:hidden;">
  <div style="background:{c};padding:28px;text-align:center;">
    <h1 style="color:#fff;margin:0;font-size:26px;">ARTIFACT ALERT</h1>
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
      View in Artifact Guardian
    </a>
  </div>
  <div style="padding:16px;background:#0b1120;text-align:center;color:#475569;font-size:12px;">
    Artifact Guardian -- AI Heritage Preservation System
  </div>
</div></body></html>"""
    text = f"ARTIFACT ALERT [{severity}]\n\nArtifact: {artifact_name}\nSeverity Index: {severity_index}/10\n\n{message}\n\nView: {app_url}"
    return send_email(to_email, f"[{severity}] Artifact Alert: {artifact_name}", html, text)


def send_missing_object_alert(to_email, artifact_name, missing_objects, video_filename):
    app_url = os.getenv("APP_URL", "http://localhost:5000")
    items = "".join(
        f"<li style='color:#fca5a5;padding:5px 0;font-size:14px;'>{obj}</li>"
        for obj in missing_objects
    )
    html = f"""<!DOCTYPE html>
<html><body style="font-family:Arial,sans-serif;background:#0b1120;margin:0;padding:20px;">
<div style="max-width:600px;margin:0 auto;background:#111827;border-radius:16px;overflow:hidden;">
  <div style="background:#7f1d1d;padding:28px;text-align:center;">
    <h1 style="color:#fff;margin:0;font-size:26px;">MISSING OBJECTS DETECTED</h1>
    <p style="color:rgba(255,255,255,.85);margin:8px 0 0;">Video analysis has flagged missing items</p>
  </div>
  <div style="padding:32px;">
    <h2 style="color:#f1f5f9;margin:0 0 8px;">{artifact_name}</h2>
    <p style="color:#94a3b8;margin-bottom:16px;">Source video: {video_filename}</p>
    <p style="color:#f1f5f9;font-weight:600;margin-bottom:8px;">The following objects were NOT detected:</p>
    <ul style="background:#450a0a;padding:16px 16px 16px 36px;border-radius:8px;">{items}</ul>
    <a href="{app_url}" style="display:inline-block;background:#dc2626;color:#fff;padding:13px 28px;
       border-radius:10px;text-decoration:none;margin-top:24px;font-weight:700;">
      View Dashboard
    </a>
  </div>
</div></body></html>"""
    text = f"MISSING OBJECTS ALERT\n\nArtifact: {artifact_name}\nVideo: {video_filename}\nMissing: {', '.join(missing_objects)}\n\nView: {app_url}"
    return send_email(to_email, f"[CRITICAL] Missing Objects Detected: {artifact_name}", html, text)


def send_shipment_report(to_email, artifact_name, shipment_info, pre_report, post_report):
    app_url = os.getenv("APP_URL", "http://localhost:5000")
    html = f"""<!DOCTYPE html>
<html><body style="font-family:Arial,sans-serif;background:#0b1120;margin:0;padding:20px;">
<div style="max-width:620px;margin:0 auto;background:#111827;border-radius:16px;overflow:hidden;">
  <div style="background:#1e3a5f;padding:28px;text-align:center;">
    <h1 style="color:#fff;margin:0;font-size:24px;">Shipment Inspection Report</h1>
    <p style="color:rgba(255,255,255,.8);margin:8px 0 0;">{artifact_name}</p>
  </div>
  <div style="padding:32px;">
    <p style="color:#94a3b8;margin-bottom:24px;">
      <strong style="color:#e2e8f0;">From:</strong> {shipment_info.get('origin','--')}
      &nbsp;to&nbsp;
      <strong style="color:#e2e8f0;">To:</strong> {shipment_info.get('destination','--')}
    </p>
    <h3 style="color:#60a5fa;margin-bottom:8px;">Pre-Shipment Report</h3>
    <pre style="background:#0b1120;padding:14px;border-radius:8px;color:#a5b4fc;font-size:12px;
      white-space:pre-wrap;overflow-x:auto;">{pre_report}</pre>
    <h3 style="color:#34d399;margin:20px 0 8px;">Post-Shipment Report</h3>
    <pre style="background:#0b1120;padding:14px;border-radius:8px;color:#6ee7b7;font-size:12px;
      white-space:pre-wrap;overflow-x:auto;">{post_report}</pre>
    <a href="{app_url}" style="display:inline-block;background:#1e3a5f;color:#fff;
       padding:13px 28px;border-radius:10px;text-decoration:none;margin-top:24px;font-weight:700;">
      View Full Report
    </a>
  </div>
</div></body></html>"""
    return send_email(to_email, f"Shipment Report: {artifact_name}", html)

# 📍 PASTE THIS AT THE VERY BOTTOM OF backend/utils/email_service.py

import base64
from email.mime.multipart import MIMEMultipart
from email.mime.text import MIMEText
from email.mime.image import MIMEImage
import smtplib

def send_production_damage_alert(to_email, artifact_name, category, severity_score, ai_report, heatmap_b64=None):
    """
    Sends an enterprise-grade HTML conservation brief with dynamic climate guardrails
    and inline computer vision heatmap attachments.
    """
    cfg = _cfg()  # Pulls your existing SMTP login configuration automatically
    if not cfg["user"] or not cfg["password"]:
        print(f"[EMAIL] SMTP not configured -- skipping brief to {to_email}")
        return False

    # Define color themes based on severity thresholds
    if severity_score >= 8.0:
        status_label = "CRITICAL THREAT DETECTED"
        brand_color = "#ef4444"  # Crimson Red
        bg_gradient = "#991b1b"
    else:
        status_label = "HIGH RISK DEGRADATION ALERT"
        brand_color = "#f97316"  # Amber Orange
        bg_gradient = "#9a3412"

    # Museum-grade climate boundary lookup matrix
    protocols = {
        "Painting": {
            "bounds": "RH: 50% ±3% | Temp: 19°C–21°C | Light: < 50 Lux",
            "actions": "Isolate from active display immediately. Verify gallery UV-filtration screens are intact. Seal climate enclosure to prevent canvas tension warps."
        },
        "Vase": {
            "bounds": "RH: < 45% | Temp: 18°C–22°C | Light: Ambient",
            "actions": "Inspect structural baseline for mechanical stress shifts. Relocate away from high-vibration building zones, doors, or public walkways. Verify stabilizing mounts."
        },
        "Textile": {
            "bounds": "RH: 45%–50% | Temp: 18°C–20°C | Light: < 50 Lux (UV blocked)",
            "actions": "Isolate item from open-air environments. Verify display case seal integrity to clear potential pest vectors, micro-dust deposition, or relative moisture spikes."
        }
    }

    profile = protocols.get(category, {
        "bounds": "RH: 50% | Temp: 20°C | Light: Filtered",
        "actions": "Restrict localized environmental access. File an immediate preservation ticket and schedule a manual hand-inspection by a certified conservator."
    })

    # Assemble Email Container
    msg = MIMEMultipart("related")
    msg["Subject"] = f"⚠️ [{status_label}] {artifact_name}"
    msg["From"] = cfg["sender"]
    msg["To"] = to_email

    msg_alternative = MIMEMultipart("alternative")
    msg.attach(msg_alternative)

    # Clean Responsive HTML/CSS Layout Body 
    html_body = f"""
    <!DOCTYPE html>
    <html>
    <head>
        <meta charset="utf-8">
        <style>
            body {{ font-family: 'Segoe UI', Arial, sans-serif; background-color: #090e1a; margin: 0; padding: 20px; color: #eaf0f8; }}
            .container {{ max-width: 600px; margin: 0 auto; background-color: #101828; border: 1px solid #1c2e44; border-radius: 12px; overflow: hidden; }}
            .header {{ background: linear-gradient(135deg, {bg_gradient}, #101828); padding: 30px 20px; text-align: center; border-bottom: 3px solid {brand_color}; }}
            .header h1 {{ margin: 0; font-size: 20px; color: #ffffff; text-transform: uppercase; letter-spacing: 1px; }}
            .header .badge {{ display: inline-block; margin-top: 10px; background-color: {brand_color}; color: #ffffff; padding: 4px 12px; font-size: 11px; font-weight: bold; border-radius: 20px; }}
            .content {{ padding: 24px; }}
            .grid {{ width: 100%; border-collapse: collapse; margin-bottom: 20px; }}
            .grid td {{ padding: 10px; border-bottom: 1px solid #1c2e44; font-size: 14px; }}
            .grid .label {{ color: #8fa3be; font-weight: 600; width: 35%; }}
            .grid .value {{ color: #eaf0f8; font-weight: bold; }}
            .protocol-box {{ background-color: #162035; border-left: 4px solid {brand_color}; padding: 16px; border-radius: 4px; margin-bottom: 24px; }}
            .protocol-title {{ color: {brand_color}; font-weight: bold; font-size: 13px; text-transform: uppercase; margin-bottom: 6px; }}
            .report-box {{ background-color: #0d1525; border: 1px solid #1c2e44; padding: 14px; border-radius: 6px; font-family: monospace; font-size: 12px; color: #a5b4fc; white-space: pre-wrap; margin-bottom: 24px; }}
            .image-wrap {{ text-align: center; margin-top: 20px; background-color: #0d1525; padding: 15px; border-radius: 8px; border: 1px solid #1c2e44; }}
            .image-wrap img {{ max-width: 100%; height: auto; border-radius: 6px; border: 1px solid #253d58; }}
        </style>
    </head>
    <body>
        <div class="container">
            <div class="header">
                <h1>Artifact Guardian Brief</h1>
                <div class="badge">{status_label}</div>
            </div>
            <div class="content">
                <table class="grid">
                    <tr><td class="label">Artifact Name</td><td class="value">{artifact_name}</td></tr>
                    <tr><td class="label">Material Group</td><td class="value">{category}</td></tr>
                    <tr><td class="label">Severity Score</td><td class="value" style="color: {brand_color}">{severity_score:.1f} / 10.0</td></tr>
                </table>

                <div class="protocol-box">
                    <div class="protocol-title">🔒 Prescribed Environment Target Limits</div>
                    <div style="font-size: 14px; font-weight: bold; margin-bottom: 8px; color: #ffffff;">{profile['bounds']}</div>
                    <div style="font-size: 13px; color: #8fa3be; line-height: 1.4;">{profile['actions']}</div>
                </div>

                <div style="font-size: 13px; font-weight: bold; margin-bottom: 8px; color: #8fa3be; text-transform: uppercase;">🤖 AI Computer Vision Diagnostics</div>
                <div class="report-box">{ai_report}</div>

                {"<div class='image-wrap'><div style='font-size:12px; color:#8fa3be; margin-bottom:10px; font-weight:600;'>📊 CV Damage Map Overlay</div><img src='cid:heatmap_img' alt='CV Heatmap'/></div>" if heatmap_b64 else ""}
            </div>
        </div>
    </body>
    </html>
    """
    msg_alternative.attach(MIMEText(html_body, "html"))

    # Safely inject the raw Base64 string directly into an inline email attachment mapping
    if heatmap_b64:
        try:
            if "," in heatmap_b64:
                heatmap_b64 = heatmap_b64.split(",")[1]
            img_data = base64.b64decode(heatmap_b64)
            img_part = MIMEImage(img_data, name="heatmap.png")
            img_part.add_header("Content-ID", "<heatmap_img>")
            img_part.add_header("Content-Disposition", "inline", filename="heatmap.png")
            msg.attach(img_part)
        except Exception as e:
            print(f"[EMAIL ERROR] Heatmap decoding exception: {e}")

    # Dispatch SMTP connection pipeline
    try:
        server = smtplib.SMTP(cfg["server"], cfg["port"])
        if cfg["tls"]:
            server.starttls()
        server.login(cfg["user"], cfg["password"])
        server.sendmail(cfg["sender"], [to_email], msg.as_string())
        server.quit()
        print(f"[EMAIL] Deep Conservation Brief successfully dispatched to -> {to_email}")
        return True
    except Exception as e:
        print(f"[EMAIL ERROR] Connection failure: {e}")
        return False
