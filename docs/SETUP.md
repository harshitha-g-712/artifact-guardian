# Artifact Guardian v2 — Setup & Run Guide

## Technologies & Versions
| Layer | Technology | Version |
|---|---|---|
| Language | Python | 3.10+ |
| Web Framework | Flask | 3.0.3 |
| Auth | Flask-Login + bcrypt | 0.6.3 |
| Email | Flask-Mail / smtplib | 0.10.0 |
| Database Driver | mysql-connector-python | 8.4.0 |
| ORM | SQLAlchemy | 2.0.30 |
| Image Processing | OpenCV (headless) | 4.9.0.80 |
| AI/ML | TensorFlow | 2.16.1 |
| Deep Learning Base | MobileNetV2 (ImageNet) | via TF |
| Array Math | NumPy | 1.26.4 |
| Image I/O | Pillow | 10.3.0 |
| PDF Export | ReportLab | 4.2.2 |
| Excel Export | openpyxl | 3.1.4 |
| Data Frames | pandas | 2.2.2 |
| UI Framework | Bootstrap | 5.3.3 |
| Charts | Chart.js | 4.4.3 |
| Icons | Bootstrap Icons | 1.11.3 |
| Fonts | Google Fonts (Cinzel, Inter) | CDN |
| Database | MySQL | 8.0+ |

---

## Prerequisites
- Python 3.10 or higher
- MySQL 8.0+ (MySQL Workbench recommended)
- pip (Python package manager)
- Node.js is NOT required (all frontend via CDN)

---

## 1. Database Setup (MySQL Workbench)

1. Open MySQL Workbench and connect to your local server
2. Open the file: `database/schema.sql`
3. Click the lightning bolt (Execute All) button
4. This creates:
   - Database `artifact_guardian`
   - Tables: users, roles, artifacts, inspections, inspection_images,
     video_inspections, alerts, shipments
   - Sample data (5 artifacts, 9 inspections, 4 alerts)
   - Default admin user: `admin` / `admin123`

---

## 2. Python Environment Setup

```bash
# Navigate to project root
cd artifact_guardian

# Create virtual environment (recommended)
python -m venv venv

# Activate virtual environment
# Windows:
venv\Scripts\activate
# macOS/Linux:
source venv/bin/activate

# Install all dependencies
pip install -r requirements.txt
```

---

## 3. Configure Environment

Edit `.env` file:

```env
# Database
DB_HOST=localhost
DB_PORT=3306
DB_USER=root
DB_PASSWORD=your_actual_mysql_password
DB_NAME=artifact_guardian

# Email (Gmail example — use App Password, not account password)
MAIL_SERVER=smtp.gmail.com
MAIL_PORT=587
MAIL_USE_TLS=True
MAIL_USERNAME=your_email@gmail.com
MAIL_PASSWORD=your_16_char_app_password

# App
SECRET_KEY=change-this-to-a-long-random-string-in-production
```

### Gmail App Password Setup:
1. Go to Google Account → Security → 2-Step Verification (enable it)
2. Search "App passwords" → Create one for "Mail"
3. Use the 16-character code as `MAIL_PASSWORD`

---

## 4. Run the Application

```bash
# Make sure virtual environment is active
python app.py
```

Open browser: **http://localhost:5000**

Login with: `admin` / `admin123`  *(change password immediately)*

---

## 5. Feature Guide

### AI Image Analysis
1. Go to **AI Analyze** section
2. Select an artifact from the dropdown
3. Choose inspection type (Routine / Pre-Shipment / Post-Shipment / Emergency)
4. Upload or drag-drop an artifact image
5. Click **Run AI Analysis**
6. Results show: severity index, fading %, crack detection, damage heatmap, AI report
7. If severity ≥ 6, an alert is automatically created and email sent to custodian

### Video / Missing Object Detection
1. Go to **Video & Camera**
2. Select artifact and enter expected objects (comma-separated)
3. Upload an MP4/AVI/MOV video
4. Click **Detect Missing Objects**
5. System analyzes sampled frames, lists missing/detected objects
6. If objects are missing: alert created + email sent immediately

### Live Camera Capture
1. Go to **Video & Camera** → **Live Camera** tab
2. Select camera (supports laptop + mobile cameras via browser)
3. Click **Start Camera**
4. Select artifact and inspection type
5. Click **Capture** to take a photo and run instant AI analysis

### Before/After Comparison
1. Go to **Compare**
2. Upload a "before" and "after" image of the same artifact
3. Click **Compare Images**
4. See: change % index, fading delta, difference heatmap

### Export Reports
- **PDF**: Reports → Artifact PDF Report → select artifact → Download PDF
- **Excel**: Reports → Excel Inspection Log → Download Excel
- **Print**: Inspections → click print icon on any row

### Import Artifacts (CSV)
CSV format (headers required):
```
name,category,age,location,description
Vase 42,Pottery,2500,"Athens, Greece",Red-figure Attic
```
Go to Admin → Import/Export → Upload CSV

---

## 6. User Roles

| Role | Upload | Edit | Delete | Admin |
|---|---|---|---|---|
| Admin | ✓ | ✓ | ✓ | ✓ |
| Curator | ✓ | ✓ | — | — |
| Analyst | ✓ | — | — | — |
| Viewer | — | — | — | — |

---

## 7. Project Structure

```
artifact_guardian/
├── app.py                          # Flask app factory + entry point
├── requirements.txt
├── .env                            # Configuration (never commit this)
├── backend/
│   ├── ai_engine/
│   │   └── damage_detection.py    # TF model, severity, AI report, video analysis
│   ├── models/
│   │   └── database.py            # All MySQL queries
│   ├── routes/
│   │   ├── api.py                 # All REST API endpoints
│   │   └── auth_routes.py         # Login/logout/register
│   └── utils/
│       ├── auth.py                # Session auth, role decorators
│       ├── email_service.py       # SMTP email alerts
│       ├── export_service.py      # PDF + Excel export
│       └── preprocessing.py       # OpenCV pipeline, heatmap, compare
├── database/
│   └── schema.sql                 # Full MySQL schema + seed data
├── frontend/
│   ├── static/
│   │   ├── css/style.css          # Complete responsive stylesheet
│   │   └── js/app.js              # Full frontend JavaScript
│   └── templates/
│       ├── index.html             # Main dashboard SPA
│       └── login.html             # Login page
├── uploads/                       # Uploaded images/videos
├── exports/                       # Generated export files
└── docs/
    └── SETUP.md                   # This file
```

---

## 8. API Endpoints Reference

| Method | Endpoint | Description |
|---|---|---|
| POST | /api/auth/login | Login |
| POST | /api/auth/logout | Logout |
| GET | /api/auth/me | Current user |
| POST | /api/auth/register | Create user (Admin) |
| GET | /api/artifacts | List all artifacts |
| POST | /api/artifacts | Create artifact |
| PUT | /api/artifacts/:id | Update artifact |
| DELETE | /api/artifacts/:id | Delete artifact (Admin) |
| POST | /api/analyze | Upload & analyze image |
| POST | /api/compare | Compare before/after |
| POST | /api/heatmap | Generate heatmap only |
| POST | /api/video/analyze | Video missing-object detection |
| GET | /api/inspections | List inspections (filterable) |
| GET | /api/inspections/:id | Inspection detail with images |
| GET | /api/artifacts/:id/trend | Trend + forecast data |
| GET | /api/alerts | List alerts |
| PATCH | /api/alerts/:id/read | Mark alert read |
| POST | /api/alerts/read-all | Mark all read |
| GET | /api/shipments | List shipments |
| POST | /api/shipments | Create shipment |
| GET | /api/dashboard/stats | Dashboard statistics |
| GET | /api/stats/monthly | Monthly inspection counts |
| GET | /api/export/inspections/excel | Export Excel |
| GET | /api/export/artifact/:id/pdf | Export PDF report |
| POST | /api/import/artifacts/csv | Import CSV |
| GET | /api/artifacts/:id/gallery | Image gallery |

---

## 9. Troubleshooting

**"Could not connect to MySQL"**
→ Check DB_PASSWORD in .env matches MySQL root password
→ Ensure MySQL service is running: `sudo service mysql start`

**"TensorFlow not found" warning**
→ The system falls back to a heuristic algorithm — still fully functional
→ To install TF: `pip install tensorflow==2.16.1`

**Email alerts not sending**
→ Check MAIL_USERNAME and MAIL_PASSWORD in .env
→ Ensure 2FA + App Password is set up on Gmail
→ Test: `python -c "from backend.utils.email_service import send_email; print(send_email('test@x.com','test','<p>test</p>'))"`

**Camera not working**
→ Browser requires HTTPS for camera access on non-localhost
→ For production, set up SSL/TLS certificate
→ On localhost (127.0.0.1) it works over HTTP

**PDF export fails**
→ Install: `pip install reportlab==4.2.2`

**Excel export fails**
→ Install: `pip install openpyxl==3.1.4`
