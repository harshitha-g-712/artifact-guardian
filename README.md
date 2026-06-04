# 🛡️ Artifact Guardian v2

**AI-Powered Heritage Artifact Preservation & Monitoring System**

---

## Features
- **AI Damage Detection** — TensorFlow MobileNetV2 detects cracks, fading, surface damage
- **Video Missing-Object Detection** — Upload videos; AI detects missing artifacts and sends email alerts
- **Live Camera Capture** — Use laptop or mobile camera for real-time inspections (Pre/Post-shipment)
- **Before/After Comparison** — Compute deterioration delta with OpenCV difference heatmaps
- **Damage Heatmap Overlay** — Visual highlight of damaged regions on any uploaded image
- **Deterioration Trend Charts** — Linear regression forecast with Chart.js visualization
- **Email Alerts** — Automatic SMTP email on HIGH/CRITICAL damage or missing objects
- **Role-based Auth** — Admin / Curator / Analyst / Viewer with session management
- **PDF & Excel Export** — Full inspection reports as PDF, data export as Excel
- **CSV Import** — Bulk-import artifact records from spreadsheet
- **Dark / Light Mode** — Persistent theme toggle
- **Mobile Responsive** — Works on phones and tablets

## Quick Start
```bash
# 1. Setup MySQL (run database/schema.sql in MySQL Workbench)
# 2. Configure .env (set DB_PASSWORD, MAIL credentials)
# 3. Install Python packages
pip install -r requirements.txt
# 4. Run
python app.py
# 5. Open http://localhost:5000 — login: admin / admin123
```

See `docs/SETUP.md` for full instructions.
