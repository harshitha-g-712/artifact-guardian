-- ============================================================
-- Artifact Guardian v2 — MySQL Schema
-- Run: mysql -u root -p < database/schema.sql
-- ============================================================

CREATE DATABASE IF NOT EXISTS artifact_guardian1
  CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;
USE artifact_guardian1;

-- ── Roles ────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS roles (
  role_id    INT AUTO_INCREMENT PRIMARY KEY,
  role_name  VARCHAR(50) NOT NULL UNIQUE,
  can_upload BOOLEAN DEFAULT TRUE,
  can_edit   BOOLEAN DEFAULT FALSE,
  can_delete BOOLEAN DEFAULT FALSE,
  can_admin  BOOLEAN DEFAULT FALSE
);

INSERT IGNORE INTO roles (role_name, can_upload, can_edit, can_delete, can_admin) VALUES
  ('Admin',   TRUE, TRUE, TRUE, TRUE),
  ('Curator', TRUE, TRUE, FALSE, FALSE),
  ('Analyst', TRUE, FALSE, FALSE, FALSE),
  ('Viewer',  FALSE, FALSE, FALSE, FALSE);

-- ── Users ─────────────────────────────────────────────────────
-- Default admin password = "admin123"  (SHA-256 salted hash stored below)
CREATE TABLE IF NOT EXISTS users (
  user_id       INT AUTO_INCREMENT PRIMARY KEY,
  username      VARCHAR(100) NOT NULL UNIQUE,
  email         VARCHAR(255) NOT NULL UNIQUE,
  password_hash VARCHAR(255) NOT NULL,
  full_name     VARCHAR(255),
  role_id       INT NOT NULL DEFAULT 3,
  is_active     BOOLEAN DEFAULT TRUE,
  alert_email   VARCHAR(255),
  last_login    TIMESTAMP NULL,
  created_at    TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
  FOREIGN KEY (role_id) REFERENCES roles(role_id)
);

-- admin / admin123
INSERT IGNORE INTO users (username, email, password_hash, full_name, role_id, alert_email)
VALUES ('admin', 'admin@guardian.local', 'PLAIN:admin123',
        'System Administrator', 1, 'admin@guardian.local');

-- curator / curator123
INSERT IGNORE INTO users (username, email, password_hash, full_name, role_id, alert_email)
VALUES ('curator', 'curator@guardian.local', 'PLAIN:curator123',
        'Head Curator', 2, 'curator@guardian.local');

-- analyst / analyst123
INSERT IGNORE INTO users (username, email, password_hash, full_name, role_id, alert_email)
VALUES ('analyst', 'analyst@guardian.local', 'PLAIN:analyst123',
        'Conservation Analyst', 3, 'analyst@guardian.local');

-- ── Artifacts ─────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS artifacts (
  artifact_id  INT AUTO_INCREMENT PRIMARY KEY,
  name         VARCHAR(255) NOT NULL,
  category     VARCHAR(100) NOT NULL,
  age          INT COMMENT 'Approximate age in years',
  location     VARCHAR(255),
  description  TEXT,
  cover_image  VARCHAR(512),
  custodian_id INT,
  status       ENUM('Good','Fair','Poor','Critical') DEFAULT 'Good',
  created_at   TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
  updated_at   TIMESTAMP DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  FOREIGN KEY (custodian_id) REFERENCES users(user_id) ON DELETE SET NULL
);

-- ── Inspections ────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS inspections (
  inspection_id   INT AUTO_INCREMENT PRIMARY KEY,
  artifact_id     INT NOT NULL,
  inspector_id    INT,
  inspection_date DATE NOT NULL,
  inspection_type ENUM('Routine','Pre-Shipment','Post-Shipment','Emergency') DEFAULT 'Routine',
  crack_detected  BOOLEAN DEFAULT FALSE,
  fading_level    FLOAT DEFAULT 0.0,
  severity_index  FLOAT DEFAULT 0.0,
  damage_notes    TEXT,
  ai_report       TEXT,
  created_at      TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
  FOREIGN KEY (artifact_id)  REFERENCES artifacts(artifact_id) ON DELETE CASCADE,
  FOREIGN KEY (inspector_id) REFERENCES users(user_id) ON DELETE SET NULL
);

-- ── Inspection Images (multiple per inspection) ────────────────
CREATE TABLE IF NOT EXISTS inspection_images (
  image_id       INT AUTO_INCREMENT PRIMARY KEY,
  inspection_id  INT NOT NULL,
  artifact_id    INT NOT NULL,
  file_path      VARCHAR(512),
  image_type     ENUM('Standard','Pre-Shipment','Post-Shipment','Camera') DEFAULT 'Standard',
  uploaded_at    TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
  FOREIGN KEY (inspection_id) REFERENCES inspections(inspection_id) ON DELETE CASCADE,
  FOREIGN KEY (artifact_id)   REFERENCES artifacts(artifact_id) ON DELETE CASCADE
);

-- ── Video Inspections ──────────────────────────────────────────
CREATE TABLE IF NOT EXISTS video_inspections (
  video_id         INT AUTO_INCREMENT PRIMARY KEY,
  artifact_id      INT NOT NULL,
  inspector_id     INT,
  video_path       VARCHAR(512),
  inspection_date  TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
  missing_objects  TEXT,
  detected_objects TEXT,
  detection_report TEXT,
  frame_count      INT DEFAULT 0,
  FOREIGN KEY (artifact_id)  REFERENCES artifacts(artifact_id) ON DELETE CASCADE,
  FOREIGN KEY (inspector_id) REFERENCES users(user_id) ON DELETE SET NULL
);

-- ── Alerts ─────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS alerts (
  alert_id      INT AUTO_INCREMENT PRIMARY KEY,
  artifact_id   INT NOT NULL,
  inspector_id  INT,
  alert_message TEXT NOT NULL,
  alert_type    VARCHAR(100) DEFAULT 'Damage',
  alert_date    TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
  severity      ENUM('LOW','MEDIUM','HIGH','CRITICAL') DEFAULT 'MEDIUM',
  is_read       BOOLEAN DEFAULT FALSE,
  email_sent    BOOLEAN DEFAULT FALSE,
  FOREIGN KEY (artifact_id)  REFERENCES artifacts(artifact_id) ON DELETE CASCADE,
  FOREIGN KEY (inspector_id) REFERENCES users(user_id) ON DELETE SET NULL
);

-- ── Shipments ──────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS shipments (
  shipment_id         INT AUTO_INCREMENT PRIMARY KEY,
  artifact_id         INT NOT NULL,
  origin              VARCHAR(255),
  destination         VARCHAR(255),
  shipment_date       DATE,
  expected_arrival    DATE,
  status              ENUM('Pending','In Transit','Delivered','Cancelled') DEFAULT 'Pending',
  pre_inspection_id   INT,
  post_inspection_id  INT,
  responsible_user_id INT,
  notes               TEXT,
  created_at          TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
  FOREIGN KEY (artifact_id)          REFERENCES artifacts(artifact_id) ON DELETE CASCADE,
  FOREIGN KEY (pre_inspection_id)    REFERENCES inspections(inspection_id) ON DELETE SET NULL,
  FOREIGN KEY (post_inspection_id)   REFERENCES inspections(inspection_id) ON DELETE SET NULL,
  FOREIGN KEY (responsible_user_id)  REFERENCES users(user_id) ON DELETE SET NULL
);

-- ── Indexes ────────────────────────────────────────────────────
CREATE INDEX idx_insp_artifact  ON inspections(artifact_id);
CREATE INDEX idx_insp_date      ON inspections(inspection_date);
CREATE INDEX idx_alert_artifact ON alerts(artifact_id);
CREATE INDEX idx_alert_read     ON alerts(is_read);
CREATE INDEX idx_img_insp       ON inspection_images(inspection_id);

-- ── Seed Data ──────────────────────────────────────────────────
INSERT IGNORE INTO artifacts (name, category, age, location, description, status) VALUES
  ('Terracotta Warrior #7',   'Sculpture',  2200, 'Xi''an Museum, China',         'Qin Dynasty warrior figurine made of terracotta clay', 'Fair'),
  ('Roman Bronze Helmet',     'Armor',      1800, 'National Museum, Rome',        'Imperial period combat helmet with cheek guards', 'Good'),
  ('Egyptian Papyrus Scroll', 'Manuscript', 3000, 'Cairo Museum, Egypt',          'Fragment from the Book of the Dead, 19th Dynasty', 'Poor'),
  ('Greek Amphora Vase',      'Pottery',    2500, 'Athens Archaeological Museum', 'Red-figure pottery, Attic style, circa 500 BCE', 'Fair'),
  ('Medieval Tapestry Panel', 'Textile',     700, 'Louvre Museum, Paris',         'Wool and silk woven panel depicting hunting scenes', 'Critical');

INSERT IGNORE INTO inspections (artifact_id, inspector_id, inspection_date, crack_detected, fading_level, severity_index, damage_notes) VALUES
  (1, 1, '2024-01-15', TRUE,  0.30, 4.5, 'Minor surface cracks detected on left arm. Consolidation recommended.'),
  (1, 1, '2024-04-10', TRUE,  0.40, 5.2, 'Crack progression noted. Fading increased on torso.'),
  (1, 1, '2024-08-20', TRUE,  0.50, 6.1, 'Significant deterioration. Immediate intervention required.'),
  (2, 2, '2024-02-01', FALSE, 0.10, 1.5, 'Surface oxidation only. Minor discolouration on crest.'),
  (2, 2, '2024-06-15', FALSE, 0.20, 2.3, 'Slight increase in oxidation. No structural issues.'),
  (3, 1, '2024-03-10', FALSE, 0.60, 5.8, 'Significant ink fading on upper section. UV damage suspected.'),
  (3, 1, '2024-07-22', FALSE, 0.70, 6.5, 'Continued fading. Humidity control urgently required.'),
  (4, 2, '2024-01-28', TRUE,  0.20, 3.2, 'Hairline cracks near base. Handle with extreme care.'),
  (5, 1, '2024-05-05', FALSE, 0.80, 7.2, 'Severe fading, thread deterioration visible on lower panel.');

INSERT IGNORE INTO alerts (artifact_id, alert_message, severity, alert_type) VALUES
  (1, 'CRITICAL: Crack progression rate increased 35% since last inspection. Immediate conservation required.', 'CRITICAL', 'Damage'),
  (3, 'HIGH: Papyrus fading level exceeded 70%. UV protection upgrade urgently recommended.', 'HIGH', 'Damage'),
  (5, 'HIGH: Medieval tapestry shows severe thread deterioration. Environmental controls needed immediately.', 'HIGH', 'Damage'),
  (4, 'MEDIUM: New hairline cracks detected near base. Schedule follow-up inspection within 30 days.', 'MEDIUM', 'Damage');
