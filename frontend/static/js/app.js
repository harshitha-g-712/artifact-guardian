/* ================================================================
   Artifact Guardian v2 — app.js
   Full frontend logic: auth, dashboard, analyze, compare,
   video/camera, artifacts, inspections, gallery, shipments,
   trends, alerts, reports, import/export, users
   ================================================================ */

'use strict';

// ── State ─────────────────────────────────────────────────────────
const STATE = {
  user: null,
  artifacts: [],
  charts: {},
  cameraStream: null,
  theme: localStorage.getItem('ag-theme') || 'dark',
};

// ── Init ──────────────────────────────────────────────────────────
document.addEventListener('DOMContentLoaded', async () => {
  try {
    applyTheme(STATE.theme);
    await checkAuth();
    initNav();
    initDragDrop();
    loadDashboard();
    loadArtifactsAll();
    loadAlertCount();
    setInterval(loadAlertCount, 30000);
  } catch(e) {
    console.error('Init error:', e);
  }
});

// ── Auth ──────────────────────────────────────────────────────────
async function checkAuth() {
  try {
    const r = await fetch('/api/auth/me', { credentials: 'include' });
    if (!r.ok) { window.location.href = '/login'; return; }
    STATE.user = await r.json();
    if (!STATE.user.logged_in) { window.location.href = '/login'; return; }
    document.getElementById('userName').textContent   = STATE.user.full_name || STATE.user.username;
    document.getElementById('userRole').textContent   = STATE.user.role || '';
    document.getElementById('userAvatar').textContent = (STATE.user.full_name || STATE.user.username || 'U')[0].toUpperCase();
    // Hide legacy admin-only elements
    if (STATE.user.role !== 'Admin') {
      document.querySelectorAll('.admin-only').forEach(el => el.style.display = 'none');
    }
    // Apply full RBAC
    applyRBAC();
  } catch { window.location.href = '/login'; }
}
function canAccess(action) {
  return !!(STATE.user?.permissions?.[action]);
}

function applyRBAC() {
  const role  = STATE.user?.role  || '';
  const perms = STATE.user?.permissions || {};

  /* a) Nav link visibility */
  // Analyst treated same rank as Viewer
  const ROLE_RANK = { viewer: 1, analyst: 1, curator: 2, admin: 3 };
  const NAV_ROLES = {
    dashboard:   'viewer',
    artifacts:   'viewer',
    inspections: 'viewer',
    gallery:     'viewer',
    trends:      'viewer',
    alerts:      'viewer',
    heatmap:     'viewer',      // ← ADD THIS (all roles see heatmap)
    analyze:     'curator',
    compare:     'curator',
    video:       'curator',
    shipments:   'curator',
    reports:     'curator',
    audit:       'admin',       // ← ADD THIS (admin only)
    users:       'admin',
    import:      'admin',
  };

  const userRank = ROLE_RANK[role.toLowerCase()] || 1;

  document.querySelectorAll('.nav-link[data-section]').forEach(link => {
    const section  = link.dataset.section;
    const required = NAV_ROLES[section] || 'viewer';
    const reqRank  = ROLE_RANK[required] || 1;
    const li = link.closest('li');
    if (li) li.style.display = userRank >= reqRank ? '' : 'none';
  });

  // Hide nav-labels that have no visible children
  document.querySelectorAll('.nav-label').forEach(label => {
    let next = label.nextElementSibling;
    let hasVisible = false;
    while (next && !next.classList.contains('nav-label')) {
      if (next.style.display !== 'none') { hasVisible = true; break; }
      next = next.nextElementSibling;
    }
    label.style.display = hasVisible ? '' : 'none';
  });

  /* b) Hide buttons based on permissions */
  document.querySelectorAll('[data-permission]').forEach(el => {
    const perm = el.dataset.permission;
    if (!perms[perm]) el.style.display = 'none';
  });

  // Hide all delete buttons for non-Admin
  if (role !== 'Admin') {
    document.querySelectorAll('.btn-delete, [data-action="delete"]').forEach(el => {
      el.style.display = 'none';
    });
  }

  // Viewer / Analyst: hide artifact card action buttons
  if (role === 'Viewer' || role === 'Analyst') {
    document.querySelectorAll('.artifact-actions, .card-actions').forEach(el => {
      el.style.display = 'none';
    });
  }

  /* c) Role badge in sidebar */
  let badge = document.getElementById('roleBadge');
  if (!badge) {
    badge = document.createElement('span');
    badge.id = 'roleBadge';
    const userRoleEl = document.getElementById('userRole');
    if (userRoleEl) userRoleEl.insertAdjacentElement('afterend', badge);
  }
  badge.className = `role-badge ${role.toLowerCase()}`;
  badge.textContent = role;
}



async function logout() {
  await fetch('/api/auth/logout', { method: 'POST', credentials: 'include' });
  window.location.href = '/login';
}

// ── Navigation ────────────────────────────────────────────────────
function initNav() {
  document.querySelectorAll('.nav-link[data-section]').forEach(link => {
    link.addEventListener('click', e => {
      e.preventDefault();
      showSection(link.dataset.section);
      if (window.innerWidth < 960) closeSidebar();
    });
  });
  document.getElementById('sidebarToggle').addEventListener('click', toggleSidebar);
  document.addEventListener('click', e => {
    const sidebar = document.getElementById('sidebar');
    const toggle  = document.getElementById('sidebarToggle');
    if (window.innerWidth < 960 && sidebar.classList.contains('open') &&
        !sidebar.contains(e.target) && !toggle.contains(e.target)) {
      closeSidebar();
    }
  });
}

function showSection(name) {
  const role = STATE.user?.role || '';

  // Analyst = same access as Viewer (read-only)
  const ALLOWED = {
    Admin:   ['dashboard','analyze','compare','video','artifacts','inspections',
               'gallery','shipments','trends','alerts','reports','users','import',
               'audit','heatmap'],                               // ← added audit, heatmap
    Curator: ['dashboard','analyze','compare','video','artifacts','inspections',
               'gallery','shipments','trends','alerts','reports','heatmap'],  // ← added heatmap
    Viewer:  ['dashboard','artifacts','inspections','gallery','trends','alerts','heatmap'],  // ← added heatmap
    Analyst: ['dashboard','artifacts','inspections','gallery','trends','alerts','heatmap'],  // ← added heatmap
  };


  const allowed = ALLOWED[role] || ['dashboard'];

  if (!allowed.includes(name)) {
    toast('Access denied for your role', 'warning');
    // Show access denied panel
    document.querySelectorAll('.content-section').forEach(s => s.classList.remove('active'));
    document.querySelectorAll('.nav-link').forEach(l => l.classList.remove('active'));
    const panel = document.getElementById('accessDeniedPanel');
    if (panel) {
      panel.style.display = 'block';
      const label = document.getElementById('deniedRoleLabel');
      if (label) label.textContent = role;
    }
    return;
  }

  // Hide access denied panel
  const panel = document.getElementById('accessDeniedPanel');
  if (panel) panel.style.display = 'none';

  document.querySelectorAll('.content-section').forEach(s => s.classList.remove('active'));
  document.querySelectorAll('.nav-link').forEach(l => l.classList.remove('active'));
  const sec  = document.getElementById('section-' + name);
  if (sec) sec.classList.add('active');
  const link = document.querySelector(`.nav-link[data-section="${name}"]`);
  if (link) link.classList.add('active');

   const titles = {
    dashboard:'Dashboard', analyze:'AI Analyze', compare:'Compare Images',
    video:'Video & Camera', artifacts:'Artifacts', inspections:'Inspections',
    gallery:'Image Gallery', shipments:'Shipments', trends:'Deterioration Trends',
    alerts:'Alerts', reports:'Reports & Export', users:'User Management',
    import:'Import / Export',
    audit:'Audit Log',          // ← ADD THIS
    heatmap:'Risk Heatmap',     // ← ADD THIS
  };

  document.getElementById('pageTitle').textContent = titles[name] || name;

  // Lazy-load section data
  if (name === 'inspections') loadInspections();
  if (name === 'gallery')     populateArtifactSelect('galleryArt');
  if (name === 'trends')      populateArtifactSelect('trendArt');
  if (name === 'shipments')   loadShipments();
  if (name === 'alerts')      loadAlerts();
  if (name === 'users')       loadUsers();
  if (name === 'reports')     { populateAllReportSelects(); loadReportMonthly(); }
  if (name === 'analyze')     populateArtifactSelect('analyzeArtifact');
  if (name === 'video')       { populateArtifactSelect('videoArtifact'); populateArtifactSelect('cameraArtifact'); }
  if (name === 'import')  loadIeArtifactSelect();
  if (name === 'audit')   loadAuditLogs(1);
  if (name === 'heatmap') loadHeatmap();
}

function toggleSidebar() {
  document.getElementById('sidebar').classList.toggle('open');
}
function closeSidebar() {
  document.getElementById('sidebar').classList.remove('open');
}

// ── Theme ─────────────────────────────────────────────────────────
function toggleTheme() {
  STATE.theme = STATE.theme === 'dark' ? 'light' : 'dark';
  applyTheme(STATE.theme);
  localStorage.setItem('ag-theme', STATE.theme);
}
function applyTheme(t) {
  document.documentElement.setAttribute('data-theme', t);
  const icon = document.getElementById('themeIcon');
  if (icon) icon.className = t === 'dark' ? 'bi bi-sun-fill' : 'bi bi-moon-fill';
  // Redraw all charts with new theme
  Object.values(STATE.charts).forEach(c => { try { c.update(); } catch(_){} });
}

// ── Toast ─────────────────────────────────────────────────────────
function toast(msg, type = 'info', duration = 3500) {
  const icons = { success:'bi-check-circle-fill', error:'bi-x-circle-fill',
                  info:'bi-info-circle-fill', warning:'bi-exclamation-triangle-fill' };
  const wrap = document.getElementById('toastWrap');
  const el = document.createElement('div');
  el.className = `toast-item ${type}`;
  el.innerHTML = `<i class="bi ${icons[type]||icons.info}"></i><span>${msg}</span>`;
  wrap.appendChild(el);
  setTimeout(() => { el.style.opacity='0'; el.style.transform='translateX(40px)';
    setTimeout(() => el.remove(), 300); }, duration);
}

// ── API helper ────────────────────────────────────────────────────
async function api(url, opts = {}) {
  const defaults = { credentials: 'include', headers: {} };
  const merged = { ...defaults, ...opts, headers: { ...defaults.headers, ...(opts.headers||{}) } };
  if (merged.body && typeof merged.body === 'object' && !(merged.body instanceof FormData)) {
    merged.headers['Content-Type'] = 'application/json';
    merged.body = JSON.stringify(merged.body);
  }
  const r = await fetch(url, merged);
  if (r.status === 401) { window.location.href = '/login'; throw new Error('Unauthorized'); }
  if (r.status === 403) {
  toast('Access denied for your role', 'warning');
  throw new Error('403');
}
  return r;
}


// ── Artifacts (load all & cache) ──────────────────────────────────
async function loadArtifactsAll() {
  try {
    const r = await api('/api/artifacts');
    STATE.artifacts = await r.json();
    renderArtifactGrid(STATE.artifacts);
    populateAllArtifactSelects();
  } catch(e) { console.error(e); }
}

function populateAllArtifactSelects() {
  const selects = ['analyzeArtifact','videoArtifact','cameraArtifact','galleryArt',
                   'trendArt','pdfArt','excelArt','filterArtifact',
                   'inspArtifactFilter','shipArt'];
  selects.forEach(id => populateArtifactSelectFromCache(id));
}

function populateArtifactSelect(id) { populateArtifactSelectFromCache(id); }

function populateArtifactSelectFromCache(id) {
  const el = document.getElementById(id);
  if (!el) return;
  const first = el.options[0];
  el.innerHTML = '';
  if (first) el.appendChild(first);
  STATE.artifacts.forEach(a => {
    const opt = document.createElement('option');
    opt.value = a.artifact_id;
    opt.textContent = `${a.name} (${a.category})`;
    el.appendChild(opt);
  });
}

function filterArtifacts(search) {
  const cat = document.getElementById('categoryFilter')?.value || '';
  const q = (search || '').toLowerCase();
  const filtered = STATE.artifacts.filter(a =>
    (!q || a.name.toLowerCase().includes(q) || a.location?.toLowerCase().includes(q)) &&
    (!cat || a.category === cat)
  );
  renderArtifactGrid(filtered);
}

function renderArtifactGrid(artifacts) {
  const grid = document.getElementById('artGrid');
  if (!grid) return;
  if (!artifacts.length) {
    grid.innerHTML = '<div class="loading-cell" style="grid-column:1/-1">No artifacts found</div>';
    return;
  }
  grid.innerHTML = artifacts.map(a => {
    const sev = parseFloat(a.max_severity || 0);
    const sevPct = (sev / 10 * 100).toFixed(0);
    const sevClass = `sev-${Math.floor(sev)}`;
    const status = a.status || 'Good';
    const imgHtml = a.cover_image
      ? `<img src="/${a.cover_image}" alt="${a.name}" loading="lazy"/>`
      : `<i class="bi bi-archive no-img"></i>`;
    return `
    <div class="artifact-card">
      <div class="artifact-card-img">${imgHtml}</div>
      <div class="artifact-card-body">
        <div class="artifact-name" title="${a.name}">${a.name}</div>
        <div class="artifact-meta">
          <span><i class="bi bi-tag"></i>${a.category}</span>
          <span><i class="bi bi-hourglass"></i>${a.age} yrs</span><br>
          <span><i class="bi bi-geo-alt"></i>${a.location||'—'}</span>
        </div>
        <div class="artifact-card-footer">
          <span class="badge-status status-${status}">${status}</span>
          <div class="sev-wrap">
            <div class="sev-label"><span>Severity</span><span>${sev.toFixed(1)}</span></div>
            <div class="sev-bar"><div class="sev-fill ${sevClass}" style="width:${sevPct}%"></div></div>
          </div>
          <div class="artifact-actions">
            <button class="btn-icon" title="Inspect" onclick="openAnalyzeFor(${a.artifact_id})"><i class="bi bi-cpu"></i></button>
            <button class="btn-icon" title="Trend" onclick="openTrendFor(${a.artifact_id})"><i class="bi bi-graph-up"></i></button>
            <button class="btn-icon" title="Export PDF" onclick="exportPdfFor(${a.artifact_id})"><i class="bi bi-file-pdf"></i></button>
            <button class="btn-icon" title="QR Code"
          onclick="showArtifactQr(${a.artifact_id}, '${a.name.replace(/'/g,"\\'")}')">
    <i class="bi bi-qr-code"></i>
  </button>
          </div>
        </div>
      </div>
    </div>`;
  }).join('');
}

function openAnalyzeFor(id) {
  showSection('analyze');
  const el = document.getElementById('analyzeArtifact');
  if (el) el.value = id;
}
function openTrendFor(id) {
  showSection('trends');
  const el = document.getElementById('trendArt') || document.getElementById('trendArtifact');
  if (el) {
    el.value = id;
    loadTrend(id);
    loadPrediction(id);
  }
}
function exportPdfFor(id) {
  window.open(`/api/export/artifact/${id}/pdf`, '_blank');
  toast('Generating PDF…', 'info');
}

// ── Save Artifact ─────────────────────────────────────────────────
async function saveArtifact() {
  if (!canAccess('can_edit_artifacts')) { toast('Not authorized to edit artifacts', 'warning'); return; }
  const name = document.getElementById('artName').value.trim();
  const category = document.getElementById('artCat').value;
  const age = parseInt(document.getElementById('artAge').value) || 0;
  const location = document.getElementById('artLoc').value.trim();
  const description = document.getElementById('artDesc').value.trim();
  if (!name || !age || !location) { toast('Name, age and location are required', 'warning'); return; }
 try {
    const r = await api('/api/artifacts', { method:'POST', body:{ name, category, age, location, description} });
    const d = await r.json();
    if (r.ok) {
      // Upload cover image if provided
      const imageFile = document.getElementById('artImage')?.files[0];
      if (imageFile && d.artifact_id) {
        const fd = new FormData();
        fd.append('image', imageFile);
        await fetch(`/api/artifacts/${d.artifact_id}/cover`, { method:'POST', body:fd, credentials:'include' });
      }
      toast(`Artifact "${name}" registered!`, 'success');
      bootstrap.Modal.getInstance(document.getElementById('addArtModal'))?.hide();
      ['artName','artAge','artLoc','artDesc'].forEach(id => document.getElementById(id).value = '');
      const artImg = document.getElementById('artImage'); if (artImg) artImg.value = '';
      await loadArtifactsAll();
    } else { toast(d.error || 'Failed', 'error'); }
  } catch(e) { toast('Network error', 'error'); }
}

// ── Dashboard ─────────────────────────────────────────────────────
async function loadDashboard() {
  try {
    const [statsR, inspR, monthlyR] = await Promise.all([
      api('/api/dashboard/stats'),
      api('/api/inspections?limit=10'),
      api('/api/stats/monthly'),
    ]);
    const stats   = await statsR.json();
    const insps   = await inspR.json();
    const monthly = await monthlyR.json();

    document.getElementById('s-artifacts').textContent   = stats.total_artifacts;
    document.getElementById('s-inspections').textContent = stats.total_inspections;
    document.getElementById('s-alerts').textContent      = stats.unread_alerts;
    document.getElementById('s-severity').textContent    = stats.avg_severity?.toFixed(1) || '0.0';

    renderDashboardCharts(stats, monthly);
    renderRecentTable(insps);
  } catch(e) { console.error('Dashboard error', e); toast('Could not load dashboard', 'error'); }
}

function renderDashboardCharts(stats, monthly) {
  const isDark = STATE.theme === 'dark';
  const gridColor = isDark ? 'rgba(255,255,255,.06)' : 'rgba(0,0,0,.06)';
  const textColor = isDark ? '#94a3b8' : '#475569';

  // Bar chart — severity by artifact
  const barCtx = document.getElementById('barChart');
  if (barCtx) {
    if (STATE.charts.bar) STATE.charts.bar.destroy();
    STATE.charts.bar = new Chart(barCtx, {
      type: 'bar',
      data: {
        labels: stats.top_damaged?.map(d => truncate(d.name, 16)) || [],
        datasets: [{
          label: 'Max Severity Index',
          data: stats.top_damaged?.map(d => d.severity) || [],
          backgroundColor: (stats.top_damaged || []).map(d =>
            d.severity >= 8 ? 'rgba(220,38,38,.7)' :
            d.severity >= 6 ? 'rgba(234,88,12,.7)' :
            d.severity >= 3.5? 'rgba(217,119,6,.7)' : 'rgba(22,163,74,.7)'),
          borderRadius: 6, borderSkipped: false,
        }]
      },
      options: { ...chartDefaults(gridColor, textColor), plugins: { legend:{ display:false } } }
    });
  }

  // Donut chart — condition distribution
  const donutCtx = document.getElementById('donutChart');
  if (donutCtx) {
    if (STATE.charts.donut) STATE.charts.donut.destroy();
    const dist = stats.status_distribution || {};
    STATE.charts.donut = new Chart(donutCtx, {
      type: 'doughnut',
      data: {
        labels: Object.keys(dist),
        datasets: [{
          data: Object.values(dist),
          backgroundColor: ['rgba(22,163,74,.8)','rgba(217,119,6,.8)','rgba(234,88,12,.8)','rgba(220,38,38,.8)'],
          borderColor: isDark ? '#111827' : '#fff', borderWidth: 3,
        }]
      },
      options: {
        responsive: true, maintainAspectRatio: false,
        plugins: { legend: { position:'bottom', labels:{ color:textColor, padding:12, font:{size:11} } } }
      }
    });
  }

  // Monthly bar chart
  const monthlyCtx = document.getElementById('monthlyChart');
  if (monthlyCtx) {
    if (STATE.charts.monthly) STATE.charts.monthly.destroy();
    const months = ['Jan','Feb','Mar','Apr','May','Jun','Jul','Aug','Sep','Oct','Nov','Dec'];
    const monthData = months.map((_,i) => {
      const row = (monthly || []).find(r => parseInt(r.month) === i+1);
      return row ? parseInt(row.count) : 0;
    });
    STATE.charts.monthly = new Chart(monthlyCtx, {
      type: 'bar',
      data: {
        labels: months,
        datasets: [{
          label: 'Inspections',
          data: monthData,
          backgroundColor: 'rgba(29,78,216,.6)',
          borderRadius: 5, borderSkipped: false,
        }]
      },
      options: { ...chartDefaults(gridColor, textColor), plugins:{ legend:{ display:false } } }
    });
  }
}

function renderRecentTable(insps) {
  const tbody = document.getElementById('recentTbody');
  if (!tbody) return;
  if (!insps.length) { tbody.innerHTML = '<tr><td colspan="7" class="loading-cell">No inspections yet</td></tr>'; return; }
  tbody.innerHTML = insps.map(i => `
    <tr>
      <td><strong>${i.artifact_name}</strong></td>
      <td>${i.inspection_date?.slice(0,10)||'—'}</td>
      <td>${i.inspection_type||'Routine'}</td>
      <td class="${i.crack_detected?'crack-yes':'crack-no'}">${i.crack_detected?'<i class="bi bi-x-circle-fill"></i> Yes':'<i class="bi bi-check-circle-fill"></i> No'}</td>
      <td>${(parseFloat(i.fading_level||0)*100).toFixed(0)}%</td>
      <td>${parseFloat(i.severity_index||0).toFixed(1)}</td>
      <td>${riskBadge(sevToRisk(i.severity_index))}</td>
    </tr>`).join('');
}

// ── Analyze Image ─────────────────────────────────────────────────
function initAnalyze() {
  const imgInput    = document.getElementById('imgInput');
  const dropZone    = document.getElementById('analyzeDropZone');
  if (!imgInput || !dropZone) return;

  // Click zone → open file picker
  dropZone.addEventListener('click', () => imgInput.click());

  // File chosen via picker
  imgInput.addEventListener('change', () => {
    if (imgInput.files[0]) loadAnalyzePreview(imgInput.files[0]);
  });

  // Drag & drop
  dropZone.addEventListener('dragover', e => { e.preventDefault(); dropZone.classList.add('dragover'); });
  dropZone.addEventListener('dragleave', () => dropZone.classList.remove('dragover'));
  dropZone.addEventListener('drop', e => {
    e.preventDefault(); dropZone.classList.remove('dragover');
    const file = e.dataTransfer.files[0]; if (!file) return;
    const dt = new DataTransfer(); dt.items.add(file);
    imgInput.files = dt.files;
    loadAnalyzePreview(file);
  });
}

function loadAnalyzePreview(file) {
  const reader = new FileReader();
  reader.onload = e => {
    document.getElementById('imgPrev').src        = e.target.result;
    document.getElementById('imgPrevWrap').classList.remove('d-none');
    document.getElementById('analyzeDropZone').style.display = 'none';
    document.getElementById('analyzeBtn').disabled = false;
    const fn = document.getElementById('analyzeFileName');
    if (fn) fn.textContent = `📎 ${file.name}`;
  };
  reader.readAsDataURL(file);
}

function clearImg() {
  document.getElementById('imgInput').value        = '';
  document.getElementById('imgPrev').src           = '';
  document.getElementById('imgPrevWrap').classList.add('d-none');
  document.getElementById('analyzeDropZone').style.display = '';
  document.getElementById('analyzeBtn').disabled   = true;
  const fn = document.getElementById('analyzeFileName');
  if (fn) fn.textContent = '';
}

async function runAnalysis() {
  if (!canAccess('can_analyze')) { toast('Not authorized for AI analysis', 'warning'); return; }
  const aid   = document.getElementById('analyzeArtifact').value;
  const itype = document.getElementById('inspectionType').value;
  const file  = document.getElementById('imgInput').files[0];

  if (!aid)  { toast('Select an artifact first', 'warning'); return; }
  if (!file) { toast('Upload an image first', 'warning'); return; }

  const btn    = document.getElementById('analyzeBtn');
  const loader = document.getElementById('analyzeLoader');
  const result = document.getElementById('analyzeResultPanel');

  btn.disabled = true;
  btn.innerHTML = '<span class="spinner" style="width:16px;height:16px;border-width:2px;display:inline-block"></span> Analyzing…';
  loader.classList.remove('d-none');
  result.innerHTML = '<div class="result-placeholder"><div class="spinner" style="width:40px;height:40px;border-width:3px"></div><p>AI processing image…</p></div>';

  const fd = new FormData();
  fd.append('image', file);
  fd.append('artifact_id', aid);
  fd.append('inspection_type', itype);

  try {
    const r = await fetch('/api/analyze', { method:'POST', body:fd, credentials:'include' });
    const d = await r.json();
    if (!r.ok) { toast(d.error || 'Analysis failed', 'error'); result.innerHTML='<div class="result-placeholder"><i class="bi bi-x-circle" style="color:var(--red)"></i><p>Analysis failed</p></div>'; return; }
    renderAnalysisResult(d);
    toast('Analysis complete!', 'success');
    await loadArtifactsAll();
    loadAlertCount();
  } catch(e) {
    console.error(e);
    toast('Network error during analysis', 'error');
    result.innerHTML='<div class="result-placeholder"><i class="bi bi-wifi-off"></i><p>Network error</p></div>';
  } finally {
    btn.disabled = false;
    btn.innerHTML = '<i class="bi bi-cpu"></i> Run AI Analysis';
    loader.classList.add('d-none');
  }
}

function renderAnalysisResult(d) {
  const risk = sevToRisk(d.severity_index);
  const html = `
    <h3 style="font-size:16px;font-weight:700;margin-bottom:14px;color:var(--text)">
      <i class="bi bi-check-circle-fill" style="color:var(--green);margin-right:8px"></i>Analysis Complete
    </h3>
    <div class="result-metrics">
      <div class="metric-box">
        <div class="metric-val" style="color:${riskColor(risk)}">${d.severity_index?.toFixed(1)}</div>
        <div class="metric-lbl">Severity Index</div>
      </div>
      <div class="metric-box">
        <div class="metric-val">${(d.fading_level*100).toFixed(0)}%</div>
        <div class="metric-lbl">Fading Level</div>
      </div>
      <div class="metric-box">
        <div class="metric-val ${d.crack_detected?'crack-yes':'crack-no'}">${d.crack_detected?'YES':'NO'}</div>
        <div class="metric-lbl">Crack Detected</div>
      </div>
      <div class="metric-box">
        <div class="metric-val">${riskBadge(risk)}</div>
        <div class="metric-lbl">Risk Level</div>
      </div>
    </div>
    <div class="sev-gauge"><div class="sev-gauge-fill" style="width:${(d.severity_index/10*100).toFixed(0)}%;background:${riskColor(risk)}"></div></div>
    ${d.heatmap_b64 ? `<div class="result-label"><i class="bi bi-thermometer-half"></i> Damage Heatmap</div>
      <img class="heatmap-img" src="data:image/jpeg;base64,${d.heatmap_b64}" alt="heatmap"/>` : ''}
    <div class="result-label"><i class="bi bi-file-text"></i> AI Report</div>
    <div class="ai-report-box">${d.ai_report||'No report generated'}</div>`;
  document.getElementById('analyzeResultPanel').innerHTML = html;
}

// ── Compare Images ────────────────────────────────────────────────
// Initialise compare drop zones after DOM is ready
function initCompare() {
  const beforeInput = document.getElementById('beforeInput');
  const afterInput  = document.getElementById('afterInput');
  const beforeZone  = document.getElementById('beforeZone');
  const afterZone   = document.getElementById('afterZone');
  if (!beforeZone || !afterZone) return;

  // Click zone → trigger hidden input
  beforeZone.addEventListener('click', () => beforeInput.click());
  afterZone.addEventListener('click',  () => afterInput.click());

  // File chosen via file picker
  beforeInput.addEventListener('change', () => loadComparePreview('before', beforeInput));
  afterInput.addEventListener('change',  () => loadComparePreview('after',  afterInput));

  // Drag & drop for compare zones
  [beforeZone, afterZone].forEach(zone => {
    zone.addEventListener('dragover', e => { e.preventDefault(); zone.classList.add('dragover'); });
    zone.addEventListener('dragleave', () => zone.classList.remove('dragover'));
    zone.addEventListener('drop', e => {
      e.preventDefault(); zone.classList.remove('dragover');
      const file = e.dataTransfer.files[0]; if (!file) return;
      const which = zone.id === 'beforeZone' ? 'before' : 'after';
      const input = document.getElementById(which + 'Input');
      const dt = new DataTransfer(); dt.items.add(file); input.files = dt.files;
      loadComparePreview(which, input);
    });
  });
}

function loadComparePreview(which, input) {
  const file = input.files[0]; if (!file) return;
  const reader = new FileReader();
  reader.onload = e => {
    const img  = document.getElementById(which + 'Prev');
    const wrap = document.getElementById(which + 'PrevWrap');
    const zone = document.getElementById(which + 'Zone');
    const name = document.getElementById(which + 'Name');
    img.src = e.target.result;
    wrap.classList.remove('d-none');
    zone.style.display = 'none';
    if (name) name.textContent = `📎 ${file.name}`;
    updateCompareStatus();
  };
  reader.readAsDataURL(file);
}

function clearCompare(which) {
  document.getElementById(which + 'Input').value = '';
  document.getElementById(which + 'PrevWrap').classList.add('d-none');
  document.getElementById(which + 'Zone').style.display = '';
  const name = document.getElementById(which + 'Name');
  if (name) name.textContent = '';
  updateCompareStatus();
}

function updateCompareStatus() {
  const bf = document.getElementById('beforeInput').files[0];
  const af = document.getElementById('afterInput').files[0];
  const status = document.getElementById('compareStatus');
  if (!bf && !af) { status.textContent = ''; return; }
  if (bf && !af)  { status.textContent = '✅ Before image loaded — now upload the After image'; return; }
  if (!bf && af)  { status.textContent = '✅ After image loaded — now upload the Before image'; return; }
  status.textContent = '✅ Both images ready — click Compare Images';
  status.style.color = '#4ade80';
}

async function runCompare() {
  const bf = document.getElementById('beforeInput').files[0];
  const af = document.getElementById('afterInput').files[0];
  if (!bf) { toast('Upload the BEFORE image first', 'warning'); return; }
  if (!af) { toast('Upload the AFTER image first', 'warning'); return; }

  const btn    = document.getElementById('compareBtn');
  const loader = document.getElementById('compareLoader');
  btn.disabled = true;
  btn.innerHTML = '<span class="spinner-sm" style="display:inline-block;width:14px;height:14px;border-width:2px"></span> Comparing…';
  loader.classList.remove('d-none');

  const fd = new FormData();
  fd.append('before', bf);
  fd.append('after',  af);

  try {
    const r = await fetch('/api/compare', { method:'POST', body:fd, credentials:'include' });
    const d = await r.json();
    if (!r.ok) { toast(d.error || 'Comparison failed', 'error'); return; }

    // Show diff map
    const diffWrap = document.getElementById('diffWrap');
    diffWrap.innerHTML = d.diff_image_b64
      ? `<img src="data:image/jpeg;base64,${d.diff_image_b64}" style="width:100%;border-radius:10px;display:block" alt="Difference Map"/>`
      : `<p style="color:#64748b;font-size:13px">No diff image returned</p>`;

    // Show result panel
    const panel = document.getElementById('compareResultPanel');
    panel.classList.remove('d-none');
    const delta = d.fading_delta || 0;
    const pct   = d.pct_change   || 0;
    panel.innerHTML = `
      <h3 style="font-size:15px;font-weight:700;margin-bottom:14px;color:var(--text)">
        <i class="bi bi-bar-chart-line-fill" style="color:#f59e0b;margin-right:8px"></i>Comparison Results
      </h3>
      <div style="display:grid;grid-template-columns:repeat(4,1fr);gap:12px;margin-bottom:16px">
        <div style="background:var(--bg2);border:1px solid var(--border);border-radius:10px;padding:14px;text-align:center">
          <div style="font-size:22px;font-weight:700;color:${pct>20?'#f87171':'#4ade80'}">${pct.toFixed(1)}%</div>
          <div style="font-size:11px;color:#64748b;margin-top:4px;text-transform:uppercase">Change Index</div>
        </div>
        <div style="background:var(--bg2);border:1px solid var(--border);border-radius:10px;padding:14px;text-align:center">
          <div style="font-size:22px;font-weight:700;color:var(--text)">${((d.fading_before||0)*100).toFixed(0)}%</div>
          <div style="font-size:11px;color:#64748b;margin-top:4px;text-transform:uppercase">Fading Before</div>
        </div>
        <div style="background:var(--bg2);border:1px solid var(--border);border-radius:10px;padding:14px;text-align:center">
          <div style="font-size:22px;font-weight:700;color:var(--text)">${((d.fading_after||0)*100).toFixed(0)}%</div>
          <div style="font-size:11px;color:#64748b;margin-top:4px;text-transform:uppercase">Fading After</div>
        </div>
        <div style="background:var(--bg2);border:1px solid var(--border);border-radius:10px;padding:14px;text-align:center">
          <div style="font-size:22px;font-weight:700;color:${delta>0?'#f87171':'#4ade80'}">${delta>0?'+':''}${(delta*100).toFixed(1)}%</div>
          <div style="font-size:11px;color:#64748b;margin-top:4px;text-transform:uppercase">Fading Δ</div>
        </div>
      </div>
      <div style="padding:12px 16px;border-radius:8px;font-size:13px;
           background:${pct>20?'rgba(220,38,38,.1)':'rgba(22,163,74,.1)'};
           border:1px solid ${pct>20?'rgba(220,38,38,.3)':'rgba(22,163,74,.3)'};
           color:${pct>20?'#f87171':'#4ade80'}">
        ${pct>20
          ? '⚠️ Significant deterioration detected between the two images. Conservation action recommended.'
          : '✅ Minimal change detected between the two images. Condition appears stable.'}
      </div>`;

    toast('Comparison complete!', 'success');
  } catch(e) {
    console.error(e);
    toast('Network error during comparison', 'error');
  } finally {
    btn.disabled = false;
    btn.innerHTML = '<i class="bi bi-arrow-left-right"></i> Compare Images';
    loader.classList.add('d-none');
  }
}

// ── Video Analysis ────────────────────────────────────────────────
function switchVTab(tab, btn) {
  document.querySelectorAll('.vtab').forEach(b => b.classList.remove('active'));
  btn.classList.add('active');
  document.getElementById('vtab-upload').classList.toggle('d-none', tab!=='upload');
  document.getElementById('vtab-camera').classList.toggle('d-none', tab!=='camera');
  if (tab === 'camera') enumerateCameras();
}

function previewVideo(input) {
  const file = input.files[0]; if (!file) return;
  const vid = document.getElementById('videoPrev');
  if (vid) { vid.src = URL.createObjectURL(file); vid.classList.remove('d-none'); }
  const btn = document.getElementById('videoBtn');
  if (btn) btn.disabled = false;
  const fn = document.getElementById('videoFileName');
  if (fn) fn.textContent = `📎 ${file.name}`;
  const zone = document.getElementById('videoDropZone');
  if (zone) zone.style.display = 'none';
}

async function runVideoAnalysis() {
  if (!canAccess('can_analyze')) { toast('Not authorized for video analysis', 'warning'); return; }
  const aid = document.getElementById('videoArtifact').value;
  const expected = document.getElementById('expectedObjects').value;
  const file = document.getElementById('videoInput').files[0];
  if (!aid)  { toast('Select an artifact', 'warning'); return; }
  if (!file) { toast('Upload a video', 'warning'); return; }
  const btn = document.getElementById('videoBtn');
  if (btn) { btn.disabled=true; btn.innerHTML='<span class="spinner" style="width:14px;height:14px;border-width:2px;display:inline-block"></span> Analyzing…'; }
  const fd = new FormData();
  fd.append('video', file); fd.append('artifact_id', aid);
  fd.append('expected_objects', expected);
  try {
    const r = await fetch('/api/video/analyze', { method:'POST', body:fd, credentials:'include' });
    const d = await r.json();
    if (!r.ok) { toast(d.error||'Failed','error'); return; }
    const resultDiv = document.getElementById('videoResultPanel');
    resultDiv.style.display = 'block';
    const missingHtml = d.missing_objects?.length
      ? `<ul class="missing-obj-list">${d.missing_objects.map(o=>`<li><i class="bi bi-exclamation-circle-fill"></i>${o}</li>`).join('')}</ul>`
      : '<p style="color:var(--green);font-weight:700;padding:12px;background:var(--green-a);border-radius:8px"><i class="bi bi-check-circle-fill"></i> All expected objects detected — nothing missing!</p>';
    const detectedHtml = (d.detected_objects||[]).length
      ? `<div style="display:flex;flex-wrap:wrap;gap:6px;margin:8px 0">${d.detected_objects.map(o=>`<span style="background:var(--green-a);color:#4ade80;border-radius:20px;padding:3px 12px;font-size:11px;font-weight:600">${o}</span>`).join('')}</div>`
      : '<p style="color:var(--muted);font-size:13px">None detected</p>';
    resultDiv.innerHTML = `
      <h3 style="font-size:15px;font-weight:700;margin-bottom:14px;color:var(--text)">
        <i class="bi bi-camera-video" style="margin-right:8px;color:var(--accent)"></i>Video Analysis Results
      </h3>
      <div style="display:grid;grid-template-columns:1fr 1fr 1fr;gap:10px;margin-bottom:14px">
        <div style="background:var(--bg2);border:1px solid var(--border);border-radius:10px;padding:12px;text-align:center">
          <div style="font-size:20px;font-weight:700;color:var(--text)">${d.frame_count||0}</div>
          <div style="font-size:10px;color:#64748b;margin-top:3px;text-transform:uppercase">Frames</div>
        </div>
        <div style="background:var(--bg2);border:1px solid var(--border);border-radius:10px;padding:12px;text-align:center">
          <div style="font-size:20px;font-weight:700;color:${d.missing_objects?.length?'#f87171':'#4ade80'}">${d.missing_objects?.length||0}</div>
          <div style="font-size:10px;color:#64748b;margin-top:3px;text-transform:uppercase">Missing</div>
        </div>
        <div style="background:var(--bg2);border:1px solid var(--border);border-radius:10px;padding:12px;text-align:center">
          <div style="font-size:20px;font-weight:700;color:var(--accent)">${d.change_score_pct??d.change_score??0}%</div>
          <div style="font-size:10px;color:#64748b;margin-top:3px;text-transform:uppercase">Scene Change</div>
        </div>
      </div>
      <div style="font-size:11px;font-weight:700;text-transform:uppercase;letter-spacing:.6px;color:#64748b;margin:12px 0 6px">
        <i class="bi bi-exclamation-triangle" style="color:#f87171"></i> Missing Objects
      </div>
      ${missingHtml}
      <div style="font-size:11px;font-weight:700;text-transform:uppercase;letter-spacing:.6px;color:#64748b;margin:12px 0 6px">
        <i class="bi bi-check2-circle" style="color:#4ade80"></i> Detected / Present
      </div>
      ${detectedHtml}
      <div style="margin-top:12px;padding:10px 14px;background:var(--bg2);border-radius:8px;font-size:12px;color:#64748b">
        Early scene objects: <strong style="color:var(--text)">${d.early_object_count??'—'}</strong> &nbsp;|&nbsp;
        Late scene objects: <strong style="color:var(--text)">${d.late_object_count??'—'}</strong> &nbsp;|&nbsp;
        Pixel diff: <strong style="color:var(--text)">${d.mean_pixel_diff??'—'}</strong>
      </div>`;
    if (d.missing_objects?.length) toast(`${d.missing_objects.length} missing object(s) detected! Alert sent.`, 'error', 5000);
    else toast('Video analysis complete — all objects present', 'success');
    loadAlertCount();
  } catch(e) { toast('Network error','error'); console.error(e); }
  finally {
    const b = document.getElementById('videoBtn');
    if (b) { b.disabled=false; b.innerHTML='<i class="bi bi-search"></i> Detect Missing Objects'; }
  }
}

// ── Camera ────────────────────────────────────────────────────────
function generateMobileQR() {
    // Always use the current origin so it works with Cloudflare, ngrok, or local
    const mobileURL = `${window.location.origin}/mobile-camera`;

    const canvas = document.getElementById('mobileQR');
    QRCode.toCanvas(canvas, mobileURL, function (error) {
        if (error) console.error(error);
    });

    document.getElementById('mobileLink').innerHTML =
        `<a href="${mobileURL}" target="_blank">${mobileURL}</a>`;
}
async function enumerateCameras() {
  try {
    const devices = await navigator.mediaDevices.enumerateDevices();
    const cams = devices.filter(d => d.kind === 'videoinput');
    const sel = document.getElementById('cameraSelect');
    sel.innerHTML = cams.map((c,i) => `<option value="${c.deviceId}">${c.label||'Camera '+(i+1)}</option>`).join('');
  } catch(e) { console.error('Camera enumerate error', e); }
}

function onCameraSourceChange(val) {
  const qrBox = document.getElementById('mobileQRBox');
  const facingEl = document.getElementById('facingMode');
  const selectEl = document.getElementById('cameraSelect');
  const startBtn = document.getElementById('startCamBtn');
  facingEl.classList.add('d-none');
  selectEl.classList.add('d-none');
  qrBox.style.display = 'none';
  if (val === 'mobile') {
    qrBox.style.display = 'block';
    generateMobileQR();
    // On mobile device, enable Start so phone can use its own camera directly
    const isMobile = /Mobi|Android|iPhone|iPad/i.test(navigator.userAgent);
    startBtn.disabled = !isMobile;
  }
  else if (val === 'laptop') {
    selectEl.classList.remove('d-none');
    startBtn.disabled = false;
    enumerateCameras();
  }
  else {
    startBtn.disabled = true;
  }
}

async function startCamera() {
  if (!canAccess('can_camera')) { toast('Not authorized to use camera', 'warning'); return; }
  const isSecureContext = window.isSecureContext ||
    window.location.protocol === 'https:' ||
    window.location.hostname === 'localhost' ||
    window.location.hostname === '127.0.0.1' ||
    window.location.hostname.endsWith('.localhost');

  if (!isSecureContext || !navigator.mediaDevices || !navigator.mediaDevices.getUserMedia) {
    const statusEl = document.getElementById('cameraStatus');
    if (statusEl) {
      statusEl.innerHTML =
        '<span style="color:var(--red)"><i class="bi bi-shield-lock"></i> Camera requires HTTPS.</span> ' +
        'Use <strong>https://</strong> or open from <strong>localhost</strong>. ' +
        'Alternatively use the <strong>Mobile Camera</strong> option and scan the QR code on your phone.';
    }
    toast('Camera requires HTTPS. Try the Mobile Camera option instead.', 'error', 6000);
    return;
  }

  const source   = document.getElementById('cameraSourceType').value;
  const deviceId = document.getElementById('cameraSelect').value;
  let constraints;

  if (source === 'mobile') {
    // Try rear camera first, fall back to any camera
    const constraints_list = [
      { video: { facingMode: { exact: 'environment' } } },
      { video: { facingMode: 'environment' } },
      { video: true }
    ];
    let stream = null;
    for (const c of constraints_list) {
      try { stream = await navigator.mediaDevices.getUserMedia(c); break; }
      catch(e) { stream = null; }
    }
    if (!stream) {
      document.getElementById('cameraStatus').textContent = 'Camera access denied';
      toast('Camera access denied', 'error');
      return;
    }
    STATE.cameraStream = stream;
    const feed = document.getElementById('cameraFeed');
    feed.srcObject = stream;
    feed.setAttribute('autoplay', '');
    feed.setAttribute('playsinline', '');
    try { await feed.play(); } catch(_) {}
    document.getElementById('stopCamBtn').disabled       = false;
    document.getElementById('captureBtn').disabled       = false;
    document.getElementById('startCamBtn').disabled      = true;
    document.getElementById('cameraSourceType').disabled = true;
    document.getElementById('cameraStatus').textContent  = 'Camera active';
    toast('Camera started', 'success');
    return;
  } else if (source === 'laptop') {
    constraints = { video: deviceId ? { deviceId: { exact: deviceId } } : true };
  } else {
    toast('Please select a camera source first', 'warning');
    return;
  }

  try {
    STATE.cameraStream = await navigator.mediaDevices.getUserMedia(constraints);
    const feed = document.getElementById('cameraFeed');
    feed.srcObject = STATE.cameraStream;
    feed.setAttribute('autoplay', '');
    feed.setAttribute('playsinline', '');
    try { await feed.play(); } catch(_) {}
    document.getElementById('stopCamBtn').disabled       = false;
    document.getElementById('captureBtn').disabled       = false;
    document.getElementById('startCamBtn').disabled      = true;
    document.getElementById('cameraSourceType').disabled = true;
    document.getElementById('cameraStatus').textContent  = 'Camera active';
    toast('Camera started', 'success');
  } catch(e) {
    let msg = 'Camera access denied';
    if (e.name === 'NotAllowedError')  msg = 'Camera permission denied — please allow camera access in your browser.';
    if (e.name === 'NotFoundError')    msg = 'No camera found — check your device settings.';
    if (e.name === 'NotReadableError') msg = 'Camera is in use by another application.';
    document.getElementById('cameraStatus').textContent = msg;
    toast(msg, 'error', 5000);
  }
}

function stopCamera() {
  if (STATE.cameraStream) {
    STATE.cameraStream.getTracks().forEach(t => t.stop());
    STATE.cameraStream = null;
    document.getElementById('cameraFeed').srcObject = null;
    document.getElementById('stopCamBtn').disabled       = true;
    document.getElementById('captureBtn').disabled       = true;
    document.getElementById('startCamBtn').disabled      = false;
    document.getElementById('cameraSourceType').disabled = false;
    document.getElementById('cameraStatus').textContent  = 'Camera not started';
  }
}

async function captureFrame() {
  if (!canAccess('can_camera')) { toast('Not authorized to use camera', 'warning'); return; }

  const feed = document.getElementById('cameraFeed');
  if (!feed.srcObject || feed.readyState < 2) {
    toast('Camera is not ready yet', 'warning');
    return;
  }
  const canvas = document.getElementById('cameraCanvas');
  canvas.width  = feed.videoWidth  || 640;
  canvas.height = feed.videoHeight || 480;
  const ctx = canvas.getContext('2d');
  await new Promise(resolve => requestAnimationFrame(resolve));
  ctx.drawImage(feed, 0, 0, canvas.width, canvas.height);
  const aid   = document.getElementById('cameraArtifact').value;
  const itype = document.getElementById('cameraInspType').value;
  document.getElementById('captureResult').innerHTML =
    `<img src="${canvas.toDataURL()}" alt="capture" style="border-radius:var(--radius);max-height:220px;width:100%;object-fit:cover"/>
     <p style="color:var(--text2);font-size:13px;margin-top:8px">Frame captured</p>`;
  if (!aid) { toast('Select an artifact to save capture', 'warning'); return; }
  document.getElementById('captureResult').innerHTML +=
    `<div id="captureLoader" style="margin-top:10px;padding:12px;background:var(--card2);border-radius:8px;font-size:12px;color:var(--text2)">
      <div class="spinner" style="width:16px;height:16px;border-width:2px;display:inline-block;vertical-align:middle"></div>
      Analyzing…
    </div>`;
  canvas.toBlob(async blob => {
    const fd = new FormData();
    fd.append('image', blob, 'capture.jpg');
    fd.append('artifact_id', aid);
    fd.append('inspection_type', itype);
    try {
      const r = await fetch('/api/analyze', { method:'POST', body:fd, credentials:'include' });
      const d = await r.json();
      const loader = document.getElementById('captureLoader');
      if (r.ok) {
        if (loader) loader.outerHTML =
          `<div style="margin-top:10px;padding:12px;background:var(--card2);border-radius:8px;font-size:12px;color:var(--text2)">
            Severity: <strong style="color:var(--text)">${d.severity_index?.toFixed(1)}/10</strong> |
            Risk: ${riskBadge(sevToRisk(d.severity_index))} |
            Cracks: <strong class="${d.crack_detected?'crack-yes':'crack-no'}">${d.crack_detected?'YES':'NO'}</strong>
          </div>`;
        toast('Capture analyzed and saved!', 'success');

        // Enable fingerprint buttons after successful capture
        const efb = document.getElementById('enrollFpBtn');
        const vfb = document.getElementById('verifyFpBtn');
        if (efb) efb.disabled = false;
        if (vfb) vfb.disabled = false;
        // Show fp history for this artifact
        const fph = document.getElementById('fpHistoryPanel');
        if (fph) { fph.style.display = 'block'; loadFpHistory(aid); }
        loadAlertCount();
      } else {
        if (loader) loader.remove();
        toast(d.error || 'Analysis failed', 'error');
      }
    } catch(e) { toast('Analysis error', 'error'); }
  }, 'image/jpeg', 0.9);
}
// ── Inspections ───────────────────────────────────────────────────
async function loadInspections() {
  const search = document.getElementById('inspSearch')?.value||'';
  const aid    = document.getElementById('inspArtifactFilter')?.value||'';
  let url = `/api/inspections?search=${encodeURIComponent(search)}`;
  if (aid) url += `&artifact_id=${aid}`;
  try {
    const r = await api(url);
    const insps = await r.json();
    renderInspectionsTable(insps);
  } catch(e) { console.error(e); }
}

function renderInspectionsTable(insps) {
  const tbody = document.getElementById('inspTbody'); if (!tbody) return;
  if (!insps.length) { tbody.innerHTML='<tr><td colspan="9" class="loading-cell">No inspections found</td></tr>'; return; }
  tbody.innerHTML = insps.map(i => `
    <tr>
      <td style="color:var(--muted)">#${i.inspection_id}</td>
      <td><strong>${i.artifact_name||'—'}</strong></td>
      <td>${i.inspection_date?.slice(0,10)||'—'}</td>
      <td>${i.inspection_type||'Routine'}</td>
      <td class="${i.crack_detected?'crack-yes':'crack-no'}">${i.crack_detected?'Yes':'No'}</td>
      <td>${(parseFloat(i.fading_level||0)*100).toFixed(0)}%</td>
      <td>${parseFloat(i.severity_index||0).toFixed(1)}</td>
      <td>${riskBadge(sevToRisk(i.severity_index))}</td>
      <td>
        <button class="btn-icon" title="View report" onclick="viewInspection(${i.inspection_id})"><i class="bi bi-eye"></i></button>
        <button class="btn-icon" title="Print" onclick="printInspection(${i.inspection_id})"><i class="bi bi-printer"></i></button>
      </td>
    </tr>`).join('');
}

async function viewInspection(id) {
  document.getElementById('inspDetailBody').innerHTML =
    '<div class="loading-overlay"><div class="spinner"></div></div>';
  bootstrap.Modal.getOrCreateInstance(document.getElementById('inspDetailModal')).show();
  try {
    const r = await api(`/api/inspections/${id}`);
    const d = await r.json();
    const risk = sevToRisk(d.severity_index);
    document.getElementById('inspDetailBody').innerHTML = `
      <div class="insp-detail-grid">
        <div class="insp-detail-item"><div class="insp-detail-label">Artifact</div><div class="insp-detail-value">${d.artifact_name}</div></div>
        <div class="insp-detail-item"><div class="insp-detail-label">Date</div><div class="insp-detail-value">${d.inspection_date?.slice(0,10)}</div></div>
        <div class="insp-detail-item"><div class="insp-detail-label">Type</div><div class="insp-detail-value">${d.inspection_type||'Routine'}</div></div>
        <div class="insp-detail-item"><div class="insp-detail-label">Risk</div><div class="insp-detail-value">${riskBadge(risk)}</div></div>
        <div class="insp-detail-item"><div class="insp-detail-label">Severity</div><div class="insp-detail-value">${parseFloat(d.severity_index||0).toFixed(1)}/10</div></div>
        <div class="insp-detail-item"><div class="insp-detail-label">Fading</div><div class="insp-detail-value">${(parseFloat(d.fading_level||0)*100).toFixed(0)}%</div></div>
        <div class="insp-detail-item"><div class="insp-detail-label">Cracks</div><div class="insp-detail-value ${d.crack_detected?'crack-yes':'crack-no'}">${d.crack_detected?'Detected':'None'}</div></div>
      </div>
      ${d.damage_notes ? `<div class="result-label">Notes</div><p style="color:var(--text2);font-size:13px">${d.damage_notes}</p>`:''}
      ${d.ai_report    ? `<div class="result-label">AI Report</div><div class="ai-report-box">${d.ai_report}</div>`:''}
      ${d.images?.length ? `<div class="result-label">Images</div><div style="display:flex;gap:8px;flex-wrap:wrap">${d.images.map(img=>`<img src="/${img.file_path}" style="height:100px;border-radius:8px;object-fit:cover"/>`).join('')}</div>`:''}`;
  } catch(e) { document.getElementById('inspDetailBody').innerHTML = '<p>Error loading inspection</p>'; }
}

async function printInspection(id) {
  window.print(); // Simplified; in production open print view
}

// ── Gallery ───────────────────────────────────────────────────────
async function loadGallery(aid) {
  if (!aid) return;
  const grid = document.getElementById('galleryGrid');
  grid.innerHTML = '<div class="loading-cell">Loading images…</div>';
  try {
    const r = await api(`/api/artifacts/${aid}/gallery`);
    const images = await r.json();
    if (!images.length) { grid.innerHTML='<div class="loading-cell">No images for this artifact</div>'; return; }
    grid.innerHTML = images.map(img => `
      <div class="gallery-item" onclick="openLightbox('/${img.file_path}')">
        <img src="/${img.file_path}" alt="image" loading="lazy" onerror="this.src='/static/images/no-img.svg'"/>
        <div class="gallery-item-info">
          <div class="gallery-item-type">${img.image_type||'Standard'}</div>
          <div class="gallery-item-date">${img.uploaded_at?.slice(0,10)||'—'}</div>
        </div>
      </div>`).join('');
  } catch(e) { grid.innerHTML='<div class="loading-cell">Error loading gallery</div>'; }
}

// ── Shipments ─────────────────────────────────────────────────────
async function loadShipments() {
  try {
    const r = await api('/api/shipments');
    const ships = await r.json();
    const tbody = document.getElementById('shipTbody'); if (!tbody) return;
    if (!ships.length) { tbody.innerHTML='<tr><td colspan="7" class="loading-cell">No shipments</td></tr>'; return; }
    tbody.innerHTML = ships.map(s => `
      <tr>
        <td style="color:var(--muted)">#${s.shipment_id}</td>
        <td><strong>${s.artifact_name}</strong></td>
        <td>${s.origin||'—'}</td>
        <td>${s.destination||'—'}</td>
        <td>${s.shipment_date||'—'}</td>
        <td><span class="ship-status ship-${s.status}">${s.status}</span></td>
        <td><button class="btn-icon" onclick="viewShipment(${s.shipment_id})"><i class="bi bi-eye"></i></button></td>
      </tr>`).join('');
  } catch(e) { console.error(e); }
}

async function saveShipment() {
  const aid     = document.getElementById('shipArt').value;
  const origin  = document.getElementById('shipOrigin').value.trim();
  const dest    = document.getElementById('shipDest').value.trim();
  const date    = document.getElementById('shipDate').value;
  const arrival = document.getElementById('shipArrival').value;
  const notes   = document.getElementById('shipNotes').value.trim();
  if (!aid||!origin||!dest||!date) { toast('Artifact, origin, destination and date required','warning'); return; }
  try {
    const r = await api('/api/shipments', { method:'POST', body:{ artifact_id:parseInt(aid), origin, destination:dest, shipment_date:date, expected_arrival:arrival, notes } });
    const d = await r.json();
    if (r.ok) {
      toast('Shipment created!','success');
      bootstrap.Modal.getInstance(document.getElementById('addShipModal'))?.hide();
      loadShipments();
    } else toast(d.error||'Failed','error');
  } catch(e) { toast('Network error','error'); }
}

// ── Trends ────────────────────────────────────────────────────────
async function loadTrend(aid) {
  if (!aid) return;
  try {
    const r = await api(`/api/artifacts/${aid}/trend`);
    const d = await r.json();
    renderTrendCharts(d);
  } catch(e) { console.error(e); }
}

function renderTrendCharts(d) {
  const isDark = STATE.theme === 'dark';
  const gridColor = isDark ? 'rgba(255,255,255,.06)' : 'rgba(0,0,0,.06)';
  const textColor = isDark ? '#94a3b8' : '#475569';
  const history  = d.history  || [];
  const forecast = d.prediction?.forecast || [];
  const labels   = history.map(r => r.inspection_date?.slice(0,10)||'');
  const sevData  = history.map(r => r.severity_index);
  const forecastLabels = ['F+1','F+2','F+3'];
  const allLabels = [...labels, ...forecastLabels];
  const allSev    = [...sevData, ...forecast];
  const trendCtx = document.getElementById('trendChart');
  if (trendCtx) {
    if (STATE.charts.trend) STATE.charts.trend.destroy();
    STATE.charts.trend = new Chart(trendCtx, {
      type:'line',
      data:{
        labels: allLabels,
        datasets:[
          { label:'Severity Index', data: [...sevData, ...Array(3).fill(null)],
            borderColor:'#f59e0b', backgroundColor:'rgba(245,158,11,.1)',
            fill:true, tension:.4, pointRadius:4 },
          { label:'Forecast', data: [...Array(sevData.length-1).fill(null), sevData[sevData.length-1]||0, ...forecast],
            borderColor:'#f87171', backgroundColor:'rgba(248,113,113,.08)',
            fill:false, tension:.4, borderDash:[6,4], pointRadius:3 },
        ]
      },
      options: chartDefaults(gridColor, textColor)
    });
  }
  // Fading chart
  const fadingCtx = document.getElementById('fadingChart');
  if (fadingCtx) {
    if (STATE.charts.fading) STATE.charts.fading.destroy();
    STATE.charts.fading = new Chart(fadingCtx, {
      type:'line',
      data:{
        labels,
        datasets:[{ label:'Fading Level', data:history.map(r=>(r.fading_level*100).toFixed(1)),
          borderColor:'#a78bfa', backgroundColor:'rgba(167,139,250,.1)',
          fill:true, tension:.4, pointRadius:4 }]
      },
      options: chartDefaults(gridColor, textColor)
    });
  }
  // Summary panel
  const pred = d.prediction || {};
  const slope = pred.slope || 0;
  const trendClass = pred.trend_label === 'Deteriorating' ? 'trend-deteriorating' :
                     pred.trend_label === 'Improving'     ? 'trend-improving'     : 'trend-stable';
  const summaryEl = document.getElementById('trendSummary');
  if (summaryEl) summaryEl.innerHTML = `
    <div class="trend-stat"><span class="trend-stat-label">Trend</span><span class="trend-stat-value ${trendClass}">${pred.trend_label||'—'}</span></div>
    <div class="trend-stat"><span class="trend-stat-label">Slope (per period)</span><span class="trend-stat-value">${slope?.toFixed(3)}</span></div>
    <div class="trend-stat"><span class="trend-stat-label">Data Points</span><span class="trend-stat-value">${history.length}</span></div>
    <div class="trend-stat"><span class="trend-stat-label">Latest Severity</span><span class="trend-stat-value">${sevData[sevData.length-1]?.toFixed(1)||'—'}</span></div>
    <div class="trend-stat"><span class="trend-stat-label">Forecast (next)</span><span class="trend-stat-value">${forecast[0]?.toFixed(1)||'—'}</span></div>
    <div class="trend-stat"><span class="trend-stat-label">Max Recorded</span><span class="trend-stat-value">${Math.max(...sevData,0).toFixed(1)}</span></div>`;
}

// ── Alerts ────────────────────────────────────────────────────────
let _allAlerts = [];
let _activeSevFilter = 'ALL';
async function loadAlerts() {
  const unread = document.getElementById('unreadOnly')?.checked || false;
  try {
    const r = await api('/api/alerts' + (unread ? '?unread=true' : ''));
    _allAlerts = await r.json();
    renderAlerts();
  } catch(e) { console.error(e); }
}

function setSevFilter(sev, btn) {
  _activeSevFilter = sev;
  document.querySelectorAll('.sev-filter').forEach(b => b.classList.remove('active'));
  btn.classList.add('active');
  renderAlerts();
}

function renderAlerts() {
  const el = document.getElementById('alertsList');
  if (!el) return;

  const filtered = _activeSevFilter === 'ALL'
    ? _allAlerts
    : _allAlerts.filter(a => a.severity === _activeSevFilter);

  // Update count info
  const countEl = document.getElementById('alertsCountInfo');
  if (countEl) {
    const unread = filtered.filter(a => !a.is_read).length;
    countEl.textContent = `${filtered.length} alert${filtered.length!==1?'s':''} · ${unread} unread`;
  }

  // Update stats row
  const statsEl = document.getElementById('alertsStatsRow');
  if (statsEl) {
    const total    = _allAlerts.length;
    const unread   = _allAlerts.filter(a => !a.is_read).length;
    const critical = _allAlerts.filter(a => a.severity === 'CRITICAL').length;
    const high     = _allAlerts.filter(a => a.severity === 'HIGH').length;
    statsEl.innerHTML = `
      <div class="alerts-stat-box">
        <div class="alerts-stat-icon" style="background:rgba(201,149,26,.12)">
          <i class="bi bi-bell-fill" style="color:var(--accent)"></i>
        </div>
        <div><div class="alerts-stat-val">${total}</div><div class="alerts-stat-lbl">Total</div></div>
      </div>
      <div class="alerts-stat-box">
        <div class="alerts-stat-icon" style="background:rgba(59,130,246,.12)">
          <i class="bi bi-envelope-fill" style="color:#60a5fa"></i>
        </div>
        <div><div class="alerts-stat-val">${unread}</div><div class="alerts-stat-lbl">Unread</div></div>
      </div>
      <div class="alerts-stat-box">
        <div class="alerts-stat-icon" style="background:var(--red-a)">
          <i class="bi bi-exclamation-triangle-fill" style="color:#f87171"></i>
        </div>
        <div><div class="alerts-stat-val">${critical}</div><div class="alerts-stat-lbl">Critical</div></div>
      </div>
      <div class="alerts-stat-box">
        <div class="alerts-stat-icon" style="background:rgba(234,88,12,.15)">
          <i class="bi bi-exclamation-circle-fill" style="color:#fb923c"></i>
        </div>
        <div><div class="alerts-stat-val">${high}</div><div class="alerts-stat-lbl">High</div></div>
      </div>`;
  }

  if (!filtered.length) {
    el.innerHTML = `<div class="no-alerts">
      <i class="bi bi-bell-slash"></i>
      <p>${_activeSevFilter === 'ALL' ? 'No alerts found' : `No ${_activeSevFilter} alerts`}</p>
    </div>`;
    return;
  }

  // Group by date
  const groups = {};
  filtered.forEach(a => {
    const dateKey = a.alert_date ? a.alert_date.slice(0, 10) : 'Unknown';
    const label   = formatDateLabel(dateKey);
    if (!groups[label]) groups[label] = [];
    groups[label].push(a);
  });

  el.innerHTML = Object.entries(groups).map(([label, alerts]) => `
    <div class="alerts-date-group">
      <div class="alerts-date-label">${label}</div>
      ${alerts.map(a => `
        <div class="alert-card ${a.is_read?'':'unread'} alert-${a.severity}" id="alert-${a.alert_id}">
          <div class="alert-card-inner">
            <div class="alert-header">
              ${!a.is_read ? `<div class="alert-unread-dot"></div>` : ''}
              <div class="alert-artifact"><i class="bi bi-archive"></i>${a.artifact_name}</div>
              <span class="alert-type-badge badge-risk risk-${a.severity}">${a.severity}</span>
            </div>
            <div class="alert-message">${a.alert_message}</div>
            <div class="alert-footer">
              <div class="alert-date">
                <i class="bi bi-clock"></i>
                ${a.alert_date?.replace('T',' ').slice(0,16)||'—'}
                ${a.email_sent?`<span class="alert-email-tag"><i class="bi bi-envelope-check"></i> Email sent</span>`:''}
              </div>
              <div class="alert-actions">
                ${!a.is_read
                  ? `<button class="btn-read" onclick="markRead(${a.alert_id})"><i class="bi bi-check"></i> Mark read</button>`
                  : `<span class="btn-read-done"><i class="bi bi-check-circle-fill" style="color:var(--green)"></i> Read</span>`
                }
                <button class="btn-read" onclick="openTrendFor(${a.artifact_id})"><i class="bi bi-graph-up"></i> Trend</button>
              </div>
            </div>
          </div>
        </div>`).join('')}
    </div>`).join('');
}

function formatDateLabel(dateStr) {
  if (!dateStr || dateStr === 'Unknown') return 'Unknown date';
  try {
    const d    = new Date(dateStr + 'T00:00:00');
    const diff = Math.floor((new Date(new Date().toDateString()) - new Date(d.toDateString())) / 86400000);
    if (diff === 0) return 'Today';
    if (diff === 1) return 'Yesterday';
    if (diff < 7)  return `${diff} days ago`;
    return d.toLocaleDateString('en-GB', { day:'numeric', month:'long', year:'numeric' });
  } catch { return dateStr; }
}

async function loadAlertCount() {
  try {
    const r = await api('/api/alerts?unread=true');
    const d = await r.json();
    const count = d.length || 0;
    ['alertBadge','topbarBadge'].forEach(id => {
      const el = document.getElementById(id);
      if (el) { el.textContent = count; el.style.display = count ? 'flex' : 'none'; }
    });
  } catch(_) {}
}

async function markRead(alertId) {
  await api(`/api/alerts/${alertId}/read`, { method:'PATCH' });
  const a = _allAlerts.find(x => x.alert_id === alertId);
  if (a) a.is_read = true;
  renderAlerts();
  loadAlertCount();
}

async function markAllRead() {
  await api('/api/alerts/read-all', { method:'POST' });
  toast('All alerts marked as read', 'success');
  _allAlerts.forEach(a => a.is_read = true);
  renderAlerts();
  loadAlertCount();
}

// ── QR Code — Artifact Card ───────────────────────────────────────
function showArtifactQr(id, name) {
  const existing = document.getElementById('artifactQrPopup');
  if (existing) existing.remove();
  const artifactUrl = `${window.location.origin}/#artifact-${id}`;
  const popup = document.createElement('div');
  popup.id = 'artifactQrPopup';
  popup.style.cssText = `position:fixed;inset:0;z-index:9999;background:rgba(0,0,0,.75);
    display:flex;align-items:center;justify-content:center;padding:20px;`;
  popup.innerHTML = `
    <div style="background:var(--bg2);border:1px solid var(--border);border-radius:16px;
                width:100%;max-width:360px;overflow:hidden;box-shadow:0 32px 80px rgba(0,0,0,.7)">
      <div style="padding:16px 20px;border-bottom:1px solid var(--border);
                  display:flex;justify-content:space-between;align-items:center">
        <div>
          <div style="font-size:15px;font-weight:700;color:var(--text)">
            <i class="bi bi-qr-code" style="color:var(--accent);margin-right:8px"></i>Artifact QR Code
          </div>
          <div style="font-size:12px;color:var(--muted);margin-top:2px">${name}</div>
        </div>
        <button onclick="document.getElementById('artifactQrPopup').remove()"
          style="background:none;border:none;color:var(--muted);font-size:20px;cursor:pointer;
                 width:30px;height:30px;border-radius:6px;display:flex;align-items:center;justify-content:center">
          <i class="bi bi-x-lg"></i>
        </button>
      </div>
      <div style="padding:24px;text-align:center">
        <div style="background:#fff;border-radius:12px;padding:16px;display:inline-block;margin-bottom:14px">
          <canvas id="artifactQrCanvas"></canvas>
        </div>
        <div style="font-size:11px;color:var(--muted);margin-bottom:16px;word-break:break-all;
             background:var(--bg);border:1px solid var(--border);border-radius:8px;padding:8px 12px">
          ${artifactUrl}
        </div>
        <div style="display:flex;gap:8px;justify-content:center">
          <button onclick="downloadArtifactQr('${name}')"
            style="padding:9px 18px;border-radius:8px;font-size:13px;font-weight:600;cursor:pointer;
                   background:linear-gradient(135deg,#1e3a5f,#2d5a9e);color:#fff;border:none">
            <i class="bi bi-download"></i> Download QR
          </button>
          <button onclick="document.getElementById('artifactQrPopup').remove()"
            style="padding:9px 18px;border-radius:8px;font-size:13px;font-weight:600;cursor:pointer;
                   background:var(--bg);border:1px solid var(--border);color:var(--text)">
            Close
          </button>
        </div>
      </div>
    </div>`;
  document.body.appendChild(popup);
  popup.addEventListener('click', e => { if (e.target === popup) popup.remove(); });
  const canvas = document.getElementById('artifactQrCanvas');
  QRCode.toCanvas(canvas, artifactUrl, { width:200, margin:1,
    color:{ dark:'#000000', light:'#ffffff' }
  }, err => { if (err) toast('QR generation failed', 'error'); });
}

function downloadArtifactQr(name) {
  const canvas = document.getElementById('artifactQrCanvas');
  if (!canvas) return;
  const link = document.createElement('a');
  link.download = `qr_${name.replace(/\s+/g,'_')}.png`;
  link.href = canvas.toDataURL('image/png');
  link.click();
  toast('QR Code downloaded!', 'success');
}

// ── QR Scanner — Nav Button ────────────────────────────────────────
function openQrScanner() {
  const existing = document.getElementById('qrScannerModal');
  if (existing) existing.remove();
  const modal = document.createElement('div');
  modal.id = 'qrScannerModal';
  modal.style.cssText = `position:fixed;inset:0;z-index:9999;background:rgba(0,0,0,.85);
    display:flex;align-items:center;justify-content:center;padding:20px;`;
  modal.innerHTML = `
    <div style="background:var(--bg2);border:1px solid var(--border);border-radius:16px;
                width:100%;max-width:480px;overflow:hidden;box-shadow:0 32px 80px rgba(0,0,0,.7)">
      <div style="padding:16px 20px;border-bottom:1px solid var(--border);
                  display:flex;justify-content:space-between;align-items:center">
        <div style="font-size:15px;font-weight:700;color:var(--text)">
          <i class="bi bi-qr-code-scan" style="color:var(--accent);margin-right:8px"></i>QR Code Scanner
        </div>
        <button onclick="closeQrScanner()"
          style="background:none;border:none;color:var(--muted);font-size:20px;cursor:pointer;
                 width:30px;height:30px;display:flex;align-items:center;justify-content:center;border-radius:6px">
          <i class="bi bi-x-lg"></i>
        </button>
      </div>
      <div style="position:relative;background:#000;aspect-ratio:4/3;overflow:hidden">
        <video id="qrVideo" autoplay playsinline muted
          style="width:100%;height:100%;object-fit:cover;display:block"></video>
        <div style="position:absolute;inset:0;display:flex;align-items:center;justify-content:center;pointer-events:none">
          <div style="width:200px;height:200px;position:relative">
            <div style="position:absolute;top:0;left:0;width:30px;height:30px;border-top:3px solid #f59e0b;border-left:3px solid #f59e0b;border-radius:3px 0 0 0"></div>
            <div style="position:absolute;top:0;right:0;width:30px;height:30px;border-top:3px solid #f59e0b;border-right:3px solid #f59e0b;border-radius:0 3px 0 0"></div>
            <div style="position:absolute;bottom:0;left:0;width:30px;height:30px;border-bottom:3px solid #f59e0b;border-left:3px solid #f59e0b;border-radius:0 0 0 3px"></div>
            <div style="position:absolute;bottom:0;right:0;width:30px;height:30px;border-bottom:3px solid #f59e0b;border-right:3px solid #f59e0b;border-radius:0 0 3px 0"></div>
            <div id="qrScanLine" style="position:absolute;left:10px;right:10px;height:2px;
              background:linear-gradient(90deg,transparent,#f59e0b,transparent);
              animation:qrScan 2s linear infinite;top:50%"></div>
          </div>
        </div>
        <canvas id="qrCanvas" style="display:none"></canvas>
      </div>
      <div id="qrStatus" style="padding:12px 20px;font-size:13px;color:var(--muted);text-align:center;
           border-bottom:1px solid var(--border);min-height:44px;display:flex;align-items:center;justify-content:center">
        <i class="bi bi-camera" style="margin-right:6px"></i> Starting camera…
      </div>
      <div id="qrResult" style="display:none;padding:16px 20px;border-bottom:1px solid var(--border)">
        <div style="font-size:11px;text-transform:uppercase;letter-spacing:1px;color:var(--muted);margin-bottom:8px">Scanned Result</div>
        <div id="qrResultText" style="font-size:13px;color:var(--text);word-break:break-all;
             background:var(--bg);border:1px solid var(--border);border-radius:8px;padding:10px 12px;margin-bottom:10px"></div>
        <div id="qrArtifactInfo" style="display:none"></div>
        <div style="display:flex;gap:8px;flex-wrap:wrap">
          <button id="qrOpenBtn" style="display:none;padding:8px 16px;border-radius:8px;font-size:12px;
            font-weight:600;cursor:pointer;background:var(--accent);color:#fff;border:none"
            onclick="qrOpenLink()">
            <i class="bi bi-box-arrow-up-right"></i> Open Link
          </button>
          <button onclick="qrRescan()"
            style="padding:8px 16px;border-radius:8px;font-size:12px;font-weight:600;cursor:pointer;
                   background:var(--bg);border:1px solid var(--border);color:var(--text)">
            <i class="bi bi-arrow-repeat"></i> Scan Again
          </button>
        </div>
      </div>
      <div style="padding:12px 20px;display:flex;justify-content:center">
        <button onclick="closeQrScanner()"
          style="padding:8px 24px;border-radius:8px;font-size:13px;font-weight:600;cursor:pointer;
                 background:var(--bg);border:1px solid var(--border);color:var(--text)">Close</button>
      </div>
    </div>
    <style>@keyframes qrScan{0%{top:10%}50%{top:85%}100%{top:10%}}</style>`;
  document.body.appendChild(modal);
  modal.addEventListener('click', e => { if (e.target === modal) closeQrScanner(); });
  startQrCamera();
}

let _qrStream = null, _qrInterval = null, _qrLastResult = null, _qrScanSource = null;

async function startQrCamera() {
  const video = document.getElementById('qrVideo');
  const status = document.getElementById('qrStatus');
  if (!video) return;
  try {
    _qrStream = await navigator.mediaDevices.getUserMedia({ video:{ facingMode:{ ideal:'environment' } } });
    video.srcObject = _qrStream;
    await video.play();
    status.innerHTML = '<i class="bi bi-camera-fill" style="color:#4ade80;margin-right:6px"></i> Camera active — point at a QR code';
    _qrInterval = setInterval(scanQrFrame, 300);
  } catch(e) {
    status.innerHTML = e.name === 'NotAllowedError'
      ? '<i class="bi bi-camera-video-off" style="color:#f87171;margin-right:6px"></i> Camera permission denied.'
      : '<i class="bi bi-exclamation-circle" style="color:#f87171;margin-right:6px"></i> Camera error: ' + e.message;
  }
}

function scanQrFrame() {
  const video = document.getElementById('qrVideo');
  const canvas = document.getElementById('qrCanvas');
  if (!video || !canvas || video.readyState !== 4) return;
  canvas.width = video.videoWidth; canvas.height = video.videoHeight;
  const ctx = canvas.getContext('2d');
  ctx.drawImage(video, 0, 0);
  if ('BarcodeDetector' in window) {
    new BarcodeDetector({ formats:['qr_code'] }).detect(canvas)
      .then(codes => { if (codes.length > 0) qrFoundResult(codes[0].rawValue); })
      .catch(() => {});
    return;
  }
  if (typeof jsQR !== 'undefined') {
    const imgData = ctx.getImageData(0, 0, canvas.width, canvas.height);
    const code = jsQR(imgData.data, imgData.width, imgData.height);
    if (code) qrFoundResult(code.data);
  }
}

function qrFoundResult(text) {
  if (_qrScanSource === 'blocked') return;
  if (text === _qrLastResult) return;
  _qrLastResult = text;
  clearInterval(_qrInterval); _qrInterval = null;
  document.getElementById('qrStatus').innerHTML =
    '<i class="bi bi-check-circle-fill" style="color:#4ade80;margin-right:6px"></i> QR Code detected!';
  document.getElementById('qrResultText').textContent = text;
  document.getElementById('qrResult').style.display = 'block';
  const openBtn = document.getElementById('qrOpenBtn');
  if (text.startsWith('http://') || text.startsWith('https://')) {
    openBtn.style.display = 'inline-flex';
    openBtn.dataset.url = text;
    if (text.includes('/mobile-camera')) {
      const info = document.getElementById('qrArtifactInfo');
      info.style.display = 'block';
      info.innerHTML = `<div style="background:rgba(212,160,23,.1);border:1px solid rgba(212,160,23,.3);
        border-radius:8px;padding:10px 12px;margin-bottom:10px;font-size:12px;color:#f59e0b">
        <i class="bi bi-shield-check"></i> Artifact Guardian mobile camera link detected</div>`;
    }
  }
  toast('QR Code scanned!', 'success');
}

function qrOpenLink() {
  const url = document.getElementById('qrOpenBtn')?.dataset.url;
  if (url) window.open(url, '_blank');
}

function qrRescan() {
  _qrLastResult = null;
  document.getElementById('qrResult').style.display = 'none';
  document.getElementById('qrStatus').innerHTML =
    '<i class="bi bi-camera-fill" style="color:#4ade80;margin-right:6px"></i> Camera active — point at a QR code';
  _qrInterval = setInterval(scanQrFrame, 300);
}

function closeQrScanner() {
  clearInterval(_qrInterval); _qrInterval = null; _qrLastResult = null;
  if (_qrStream) { _qrStream.getTracks().forEach(t => t.stop()); _qrStream = null; }
  _qrScanSource = null;
  const modal = document.getElementById('qrScannerModal');
  if (modal) modal.remove();
}

// QR scanner permission fallback. Kept isolated to the scanner modal.
function openQrScanner() {
  const existing = document.getElementById('qrScannerModal');
  if (existing) existing.remove();

  const modal = document.createElement('div');
  modal.id = 'qrScannerModal';
  modal.style.cssText = `position:fixed;inset:0;z-index:9999;background:rgba(0,0,0,.85);
    display:flex;align-items:center;justify-content:center;padding:16px;`;

  modal.innerHTML = `
    <div style="background:var(--bg2);border:1px solid var(--border);border-radius:16px;
                width:min(520px,100%);max-height:calc(100vh - 32px);overflow:hidden;
                box-shadow:0 32px 80px rgba(0,0,0,.7);display:flex;flex-direction:column">
      <div style="padding:16px 20px;border-bottom:1px solid var(--border);
                  display:flex;justify-content:space-between;align-items:center;flex-shrink:0">
        <div style="font-size:15px;font-weight:700;color:var(--text)">
          <i class="bi bi-qr-code-scan" style="color:var(--accent);margin-right:8px"></i>QR Code Scanner
        </div>
        <button onclick="closeQrScanner()"
          style="background:none;border:none;color:var(--muted);font-size:20px;cursor:pointer;
                 width:30px;height:30px;display:flex;align-items:center;justify-content:center;border-radius:6px">
          <i class="bi bi-x-lg"></i>
        </button>
      </div>

      <div style="position:relative;background:#000;aspect-ratio:4/3;overflow:hidden;flex-shrink:0">
        <video id="qrVideo" autoplay playsinline muted
          style="width:100%;height:100%;object-fit:cover;display:block"></video>
        <div id="qrCameraFallback" style="position:absolute;inset:0;display:none;align-items:center;
             justify-content:center;text-align:center;padding:28px;color:var(--muted);background:#020407">
          <div>
            <i class="bi bi-camera-video-off" style="font-size:34px;color:#f87171;margin-bottom:10px;display:block"></i>
            <div style="font-size:13px;color:var(--text);font-weight:700;margin-bottom:4px">Camera unavailable</div>
            <div style="font-size:12px;line-height:1.5">Allow camera access in Chrome site settings, then retry.</div>
          </div>
        </div>
        <div style="position:absolute;inset:0;display:flex;align-items:center;justify-content:center;pointer-events:none">
          <div id="qrScannerFrame" style="width:200px;height:200px;position:relative">
            <div style="position:absolute;top:0;left:0;width:30px;height:30px;border-top:3px solid #f59e0b;border-left:3px solid #f59e0b;border-radius:3px 0 0 0"></div>
            <div style="position:absolute;top:0;right:0;width:30px;height:30px;border-top:3px solid #f59e0b;border-right:3px solid #f59e0b;border-radius:0 3px 0 0"></div>
            <div style="position:absolute;bottom:0;left:0;width:30px;height:30px;border-bottom:3px solid #f59e0b;border-left:3px solid #f59e0b;border-radius:0 0 0 3px"></div>
            <div style="position:absolute;bottom:0;right:0;width:30px;height:30px;border-bottom:3px solid #f59e0b;border-right:3px solid #f59e0b;border-radius:0 0 3px 0"></div>
            <div id="qrScanLine" style="position:absolute;left:10px;right:10px;height:2px;
              background:linear-gradient(90deg,transparent,#f59e0b,transparent);
              animation:qrScan 2s linear infinite;top:50%"></div>
          </div>
        </div>
        <canvas id="qrCanvas" style="display:none"></canvas>
      </div>

      <div id="qrStatus" style="padding:12px 20px;font-size:13px;color:var(--muted);text-align:center;
           border-bottom:1px solid var(--border);min-height:44px;display:flex;align-items:center;justify-content:center">
        <i class="bi bi-camera" style="margin-right:6px"></i> Starting camera...
      </div>

      <div style="padding:12px 20px;border-bottom:1px solid var(--border);
                  display:flex;gap:8px;justify-content:center;flex-wrap:wrap">
        <button onclick="startQrCamera()"
          style="padding:8px 16px;border-radius:8px;font-size:12px;font-weight:600;cursor:pointer;
                 background:var(--accent);border:1px solid var(--accent);color:#111827">
          <i class="bi bi-arrow-clockwise"></i> Retry Camera
        </button>
        <button onclick="document.getElementById('qrImageInput').click()"
          style="padding:8px 16px;border-radius:8px;font-size:12px;font-weight:600;cursor:pointer;
                 background:var(--bg);border:1px solid var(--border);color:var(--text)">
          <i class="bi bi-image"></i> Upload QR Image
        </button>
        <input id="qrImageInput" type="file" accept="image/*" style="display:none">
      </div>

      <div id="qrResult" style="display:none;padding:16px 20px;border-bottom:1px solid var(--border)">
        <div style="font-size:11px;text-transform:uppercase;letter-spacing:1px;color:var(--muted);margin-bottom:8px">Scanned Result</div>
        <div id="qrResultText" style="font-size:13px;color:var(--text);word-break:break-all;
             background:var(--bg);border:1px solid var(--border);border-radius:8px;padding:10px 12px;margin-bottom:10px"></div>
        <div id="qrArtifactInfo" style="display:none"></div>
        <div style="display:flex;gap:8px;flex-wrap:wrap">
          <button id="qrOpenBtn" style="display:none;padding:8px 16px;border-radius:8px;font-size:12px;
            font-weight:600;cursor:pointer;background:var(--accent);color:#fff;border:none"
            onclick="qrOpenLink()">
            <i class="bi bi-box-arrow-up-right"></i> Open Link
          </button>
          <button onclick="qrRescan()"
            style="padding:8px 16px;border-radius:8px;font-size:12px;font-weight:600;cursor:pointer;
                   background:var(--bg);border:1px solid var(--border);color:var(--text)">
            <i class="bi bi-arrow-repeat"></i> Scan Again
          </button>
        </div>
      </div>

      <div style="padding:12px 20px;display:flex;justify-content:center;flex-shrink:0">
        <button onclick="closeQrScanner()"
          style="padding:8px 24px;border-radius:8px;font-size:13px;font-weight:600;cursor:pointer;
                 background:var(--bg);border:1px solid var(--border);color:var(--text)">Close</button>
      </div>
    </div>
    <style>@keyframes qrScan{0%{top:10%}50%{top:85%}100%{top:10%}}</style>`;

  document.body.appendChild(modal);
  modal.addEventListener('click', e => { if (e.target === modal) closeQrScanner(); });
  document.getElementById('qrImageInput')?.addEventListener('change', scanQrImageFile);
  startQrCamera();
}

async function startQrCamera() {
  const video = document.getElementById('qrVideo');
  const status = document.getElementById('qrStatus');
  const fallback = document.getElementById('qrCameraFallback');
  const frame = document.getElementById('qrScannerFrame');
  if (!video || !status) return;

  clearInterval(_qrInterval); _qrInterval = null; _qrLastResult = null;
  if (_qrStream) { _qrStream.getTracks().forEach(t => t.stop()); _qrStream = null; }
  _qrScanSource = 'camera';
  document.getElementById('qrResult').style.display = 'none';
  if (fallback) fallback.style.display = 'none';
  if (frame) frame.style.display = 'block';
  video.style.display = 'block';
  status.innerHTML = '<i class="bi bi-camera" style="margin-right:6px"></i> Starting camera...';

  if (!navigator.mediaDevices?.getUserMedia) {
    showQrCameraError('Camera is not supported in this browser. Upload a QR image instead.');
    return;
  }

  try {
    try {
      _qrStream = await navigator.mediaDevices.getUserMedia({ video:{ facingMode:{ ideal:'environment' } } });
    } catch (firstError) {
      if (firstError.name === 'NotAllowedError' || firstError.name === 'SecurityError') throw firstError;
      _qrStream = await navigator.mediaDevices.getUserMedia({ video:true });
    }
    video.srcObject = _qrStream;
    await video.play();
    status.innerHTML = '<i class="bi bi-camera-fill" style="color:#4ade80;margin-right:6px"></i> Camera active - point at a QR code';
    _qrInterval = setInterval(scanQrFrame, 300);
  } catch (e) {
    const denied = e.name === 'NotAllowedError' || e.name === 'SecurityError';
    showQrCameraError(denied
      ? 'Camera permission denied. Allow camera access in Chrome site settings, then retry, or upload a QR image.'
      : 'Camera error: ' + (e.message || 'Unable to start camera.'));
  }
}

function showQrCameraError(message) {
  const status = document.getElementById('qrStatus');
  const video = document.getElementById('qrVideo');
  const fallback = document.getElementById('qrCameraFallback');
  const frame = document.getElementById('qrScannerFrame');
  clearInterval(_qrInterval); _qrInterval = null; _qrLastResult = null; _qrScanSource = 'blocked';
  const result = document.getElementById('qrResult');
  if (result) result.style.display = 'none';
  if (video) video.style.display = 'none';
  if (fallback) fallback.style.display = 'flex';
  if (frame) frame.style.display = 'none';
  if (status) {
    status.innerHTML = `<i class="bi bi-camera-video-off" style="color:#f87171;margin-right:6px"></i> ${message}`;
  }
}

function scanQrFrame() {
  const video = document.getElementById('qrVideo');
  const canvas = document.getElementById('qrCanvas');
  if (!video || !canvas || video.readyState !== 4) return;
  canvas.width = video.videoWidth;
  canvas.height = video.videoHeight;
  canvas.getContext('2d').drawImage(video, 0, 0);
  decodeQrFromCanvas(canvas);
}

function decodeQrFromCanvas(canvas) {
  if ('BarcodeDetector' in window) {
    new BarcodeDetector({ formats:['qr_code'] }).detect(canvas)
      .then(codes => { if (codes.length > 0) qrFoundResult(codes[0].rawValue); })
      .catch(() => {});
    return;
  }
  if (typeof jsQR !== 'undefined') {
    const ctx = canvas.getContext('2d');
    const imgData = ctx.getImageData(0, 0, canvas.width, canvas.height);
    const code = jsQR(imgData.data, imgData.width, imgData.height);
    if (code) qrFoundResult(code.data);
  }
}

function scanQrImageFile(event) {
  const file = event.target.files?.[0];
  event.target.value = '';
  if (!file) return;

  const status = document.getElementById('qrStatus');
  const canvas = document.getElementById('qrCanvas');
  const img = new Image();
  const objectUrl = URL.createObjectURL(file);
  let found = false;
  _qrScanSource = 'image';

  img.onload = () => {
    canvas.width = img.naturalWidth;
    canvas.height = img.naturalHeight;
    canvas.getContext('2d').drawImage(img, 0, 0);
    _qrLastResult = null;
    const originalFoundResult = qrFoundResult;
    qrFoundResult = text => { found = true; originalFoundResult(text); };
    decodeQrFromCanvas(canvas);
    setTimeout(() => {
      qrFoundResult = originalFoundResult;
      if (!found && status) {
        status.innerHTML = '<i class="bi bi-exclamation-circle" style="color:#f87171;margin-right:6px"></i> No QR code found in that image.';
      }
      URL.revokeObjectURL(objectUrl);
    }, 250);
  };
  img.onerror = () => {
    if (status) status.innerHTML = '<i class="bi bi-exclamation-circle" style="color:#f87171;margin-right:6px"></i> Could not read that image.';
    URL.revokeObjectURL(objectUrl);
  };
  if (status) status.innerHTML = '<i class="bi bi-image" style="margin-right:6px"></i> Scanning uploaded image...';
  img.src = objectUrl;
}

function qrRescan() {
  _qrLastResult = null;
  document.getElementById('qrResult').style.display = 'none';
  if (_qrStream) {
    _qrScanSource = 'camera';
    document.getElementById('qrStatus').innerHTML =
      '<i class="bi bi-camera-fill" style="color:#4ade80;margin-right:6px"></i> Camera active - point at a QR code';
    if (!_qrInterval) _qrInterval = setInterval(scanQrFrame, 300);
  } else {
    startQrCamera();
  }
}

// ── Risk Heatmap ──────────────────────────────────────────────────
let _heatmapChart = null;

async function loadHeatmap() {
  try {
    const r = await fetch('/api/risk-heatmap', { credentials: 'include' });
    if (!r.ok) { toast('Could not load heatmap data', 'error'); return; }
    const d = await r.json();

    const riskColor = { CRITICAL:'#f87171', HIGH:'#fb923c', MEDIUM:'#fbbf24', LOW:'#4ade80' };

    // Summary stats
    document.getElementById('heatmapSummary').innerHTML = `
      <div style="background:var(--bg2);border:1px solid var(--border);border-radius:12px;padding:16px;text-align:center">
        <div style="font-size:28px;font-weight:700;color:var(--text)">${d.total_artifacts}</div>
        <div style="font-size:11px;color:var(--muted);text-transform:uppercase;margin-top:4px">Total Artifacts</div>
      </div>
      <div style="background:var(--bg2);border:1px solid var(--border);border-radius:12px;padding:16px;text-align:center">
        <div style="font-size:28px;font-weight:700;color:var(--text)">${d.total_rooms}</div>
        <div style="font-size:11px;color:var(--muted);text-transform:uppercase;margin-top:4px">Storage Locations</div>
      </div>
      <div style="background:rgba(220,38,38,.1);border:1px solid rgba(220,38,38,.3);border-radius:12px;padding:16px;text-align:center">
        <div style="font-size:28px;font-weight:700;color:#f87171">${d.critical_rooms}</div>
        <div style="font-size:11px;color:#f87171;text-transform:uppercase;margin-top:4px">Critical Locations</div>
      </div>
      <div style="background:rgba(234,88,12,.1);border:1px solid rgba(234,88,12,.3);border-radius:12px;padding:16px;text-align:center">
        <div style="font-size:28px;font-weight:700;color:#fb923c">${d.high_risk_rooms}</div>
        <div style="font-size:11px;color:#fb923c;text-transform:uppercase;margin-top:4px">High Risk Locations</div>
      </div>`;

    // Bar chart
    const top12   = d.rooms.slice(0, 12);
    const labels  = top12.map(r => r.room_name.length > 16 ? r.room_name.substring(0,14)+'…' : r.room_name);
    const sevData = top12.map(r => r.avg_severity.toFixed(2));
    const bgColors = top12.map(r =>
      r.risk_level==='CRITICAL' ? 'rgba(248,113,113,.8)' :
      r.risk_level==='HIGH'     ? 'rgba(251,146,60,.8)'  :
      r.risk_level==='MEDIUM'   ? 'rgba(251,191,36,.8)'  : 'rgba(74,222,128,.8)');

    const ctx = document.getElementById('heatmapChart').getContext('2d');
    if (_heatmapChart) _heatmapChart.destroy();
    _heatmapChart = new Chart(ctx, {
      type: 'bar',
      data: { labels, datasets: [{ label:'Avg Severity', data:sevData,
        backgroundColor:bgColors, borderRadius:6, borderSkipped:false }]},
      options: {
        responsive:true, maintainAspectRatio:false,
        plugins:{ legend:{ display:false } },
        scales:{
          x:{ ticks:{ color:'#94a3b8', font:{ size:11 } }, grid:{ color:'rgba(255,255,255,.05)' } },
          y:{ min:0, max:10, ticks:{ color:'#94a3b8' }, grid:{ color:'rgba(255,255,255,.05)' } }
        }
      }
    });

    // Room cards
    document.getElementById('heatmapGrid').innerHTML = d.rooms.map(room => {
      const col = riskColor[room.risk_level] || '#94a3b8';
      const bg  = room.risk_level==='CRITICAL' ? 'rgba(220,38,38,.08)' :
                  room.risk_level==='HIGH'      ? 'rgba(234,88,12,.08)' :
                  room.risk_level==='MEDIUM'    ? 'rgba(217,119,6,.08)' : 'rgba(22,163,74,.08)';
      const safe = JSON.stringify(room).replace(/"/g,'&quot;');
      return `
        <div onclick="showHeatmapRoom(${safe})"
          style="background:${bg};border:1px solid ${col}33;border-radius:12px;padding:14px;
                 cursor:pointer;transition:all .2s"
          onmouseover="this.style.transform='translateY(-2px)'"
          onmouseout="this.style.transform='translateY(0)'">
          <div style="display:flex;justify-content:space-between;align-items:flex-start;margin-bottom:10px">
            <div style="font-size:13px;font-weight:600;color:var(--text);flex:1">${room.room_name}</div>
            <span style="padding:2px 8px;border-radius:20px;font-size:10px;font-weight:700;
                  background:${col}22;color:${col};border:1px solid ${col}44;white-space:nowrap;margin-left:6px">
              ${room.risk_level}
            </span>
          </div>
          <div style="display:grid;grid-template-columns:1fr 1fr;gap:6px;font-size:12px">
            <div style="color:var(--muted)">Artifacts: <strong style="color:var(--text)">${room.total}</strong></div>
            <div style="color:var(--muted)">High Risk: <strong style="color:${col}">${room.high_risk}</strong></div>
            <div style="color:var(--muted)">Avg Sev: <strong style="color:${col}">${room.avg_severity}</strong></div>
            <div style="color:var(--muted)">Max Sev: <strong style="color:${col}">${room.max_severity.toFixed(1)}</strong></div>
          </div>
        </div>`;
    }).join('');

  } catch(e) {
    console.error(e);
    toast('Heatmap load error: ' + e.message, 'error');
  }
}

function showHeatmapRoom(room) {
  const riskColor = { CRITICAL:'#f87171', HIGH:'#fb923c', MEDIUM:'#fbbf24', LOW:'#4ade80' };
  const col = riskColor[room.risk_level] || '#94a3b8';
  document.getElementById('heatmapRoomTitle').innerHTML =
    `<i class="bi bi-geo-alt" style="color:${col};margin-right:6px"></i>${room.room_name}
     <span style="padding:2px 10px;border-radius:20px;font-size:11px;font-weight:700;
           background:${col}22;color:${col};border:1px solid ${col}44;margin-left:8px">${room.risk_level}</span>`;

  const rows = room.artifacts.map(a => `
    <tr>
      <td style="padding:10px 12px;color:var(--text);font-size:13px">${a.name}</td>
      <td style="padding:10px 12px;color:var(--muted);font-size:12px">${a.category}</td>
      <td style="padding:10px 12px;text-align:center">
        <span style="padding:2px 8px;border-radius:20px;font-size:11px;font-weight:700;
              background:${a.max_severity>=8?'rgba(220,38,38,.2)':a.max_severity>=6?'rgba(234,88,12,.2)':a.max_severity>=3.5?'rgba(217,119,6,.2)':'rgba(22,163,74,.2)'};
              color:${a.max_severity>=8?'#f87171':a.max_severity>=6?'#fb923c':a.max_severity>=3.5?'#fbbf24':'#4ade80'}">
          ${a.max_severity.toFixed(1)}
        </span>
      </td>
      <td style="padding:10px 12px;text-align:center;color:var(--muted);font-size:12px">${a.status||'—'}</td>
      <td style="padding:10px 12px;text-align:center;color:var(--muted);font-size:12px">${a.last_inspection||'Never'}</td>
    </tr>`).join('');

  document.getElementById('heatmapRoomDetail').innerHTML = `
    <table style="width:100%;border-collapse:collapse">
      <thead>
        <tr style="border-bottom:1px solid var(--border)">
          <th style="padding:8px 12px;text-align:left;font-size:11px;color:var(--muted);text-transform:uppercase">Artifact</th>
          <th style="padding:8px 12px;text-align:left;font-size:11px;color:var(--muted);text-transform:uppercase">Category</th>
          <th style="padding:8px 12px;text-align:center;font-size:11px;color:var(--muted);text-transform:uppercase">Severity</th>
          <th style="padding:8px 12px;text-align:center;font-size:11px;color:var(--muted);text-transform:uppercase">Status</th>
          <th style="padding:8px 12px;text-align:center;font-size:11px;color:var(--muted);text-transform:uppercase">Last Inspected</th>
        </tr>
      </thead>
      <tbody>${rows}</tbody>
    </table>`;

  document.getElementById('heatmapDetailWrap').style.display = 'block';
  document.getElementById('heatmapDetailWrap').scrollIntoView({ behavior:'smooth' });
}

// ── Reports ───────────────────────────────────────────────────────
function populateAllReportSelects() {
  populateArtifactSelectFromCache('pdfArt');
  populateArtifactSelectFromCache('excelArt');
}

async function exportPdf() {
  const aid = document.getElementById('pdfArt').value;
  if (!aid) { toast('Select an artifact','warning'); return; }
  window.open(`/api/export/artifact/${aid}/pdf`, '_blank');
  toast('Generating PDF report…','info');
}

async function exportExcel() {
  window.open('/api/export/inspections/excel','_blank');
  toast('Downloading Excel…','info');
}

async function exportExcelFiltered() {
  const aid = document.getElementById('excelArt')?.value||'';
  const url = '/api/export/inspections/excel' + (aid?`?artifact_id=${aid}`:'');
  window.open(url,'_blank');
  toast('Downloading Excel…','info');
}

async function loadReportMonthly() {
  const year = document.getElementById('repYear')?.value || new Date().getFullYear();
  const ctx = document.getElementById('repMonthChart'); if (!ctx) return;
  try {
    const r = await api(`/api/stats/monthly?year=${year}`);
    const data = await r.json();
    const isDark = STATE.theme==='dark';
    const gridColor=isDark?'rgba(255,255,255,.06)':'rgba(0,0,0,.06)';
    const textColor=isDark?'#94a3b8':'#475569';
    const months=['Jan','Feb','Mar','Apr','May','Jun','Jul','Aug','Sep','Oct','Nov','Dec'];
    const counts=months.map((_,i)=>{ const row=data.find(r=>parseInt(r.month)===i+1); return row?parseInt(row.count):0; });
    if (STATE.charts.repMonthly) STATE.charts.repMonthly.destroy();
    STATE.charts.repMonthly = new Chart(ctx,{
      type:'bar',data:{labels:months,datasets:[{label:'Inspections',data:counts,backgroundColor:'rgba(29,78,216,.65)',borderRadius:5,borderSkipped:false}]},
      options:{...chartDefaults(gridColor,textColor),plugins:{legend:{display:false}}}
    });
  } catch(e) { console.error(e); }
}

// ── Users ─────────────────────────────────────────────────────────
async function loadUsers() {
  try {
    const r = await api('/api/users');
    const users = await r.json();
    const tbody = document.getElementById('usersTbody'); if (!tbody) return;
    if (!users.length) { tbody.innerHTML='<tr><td colspan="6" class="loading-cell">No users</td></tr>'; return; }
    tbody.innerHTML = users.map(u => `
      <tr>
        <td><strong>${u.username}</strong></td>
        <td>${u.full_name||'—'}</td>
        <td>${u.email||'—'}</td>
        <td><span class="badge-risk risk-${u.role_name==='Admin'?'CRITICAL':u.role_name==='Curator'?'MEDIUM':'LOW'}">${u.role_name}</span></td>
        <td><span style="color:${u.is_active?'var(--green)':'var(--red)'}">${u.is_active?'Active':'Disabled'}</span></td>
        <td style="color:var(--muted);font-size:12px">${u.last_login?.slice(0,16)||'Never'}</td>
      </tr>`).join('');
  } catch(e) { console.error(e); }
}

async function saveUser() {
  if (!canAccess('can_manage_users')) { toast('Not authorized to manage users', 'warning'); return; }
  const username  = document.getElementById('newUsername').value.trim();
  const full_name = document.getElementById('newFullName').value.trim();
  const email     = document.getElementById('newEmail').value.trim();
  const alert_email = document.getElementById('newAlertEmail').value.trim();
  const password  = document.getElementById('newPassword').value;
  const role_id   = parseInt(document.getElementById('newRole').value);
  if (!username||!email||!password) { toast('Username, email and password required','warning'); return; }
  try {
    const r = await api('/api/auth/register', { method:'POST', body:{ username, full_name, email, alert_email:alert_email||email, password, role_id } });
    const d = await r.json();
    if (r.ok) {
      toast(`User "${username}" created!`,'success');
      bootstrap.Modal.getInstance(document.getElementById('addUserModal'))?.hide();
      loadUsers();
    } else toast(d.error||'Failed','error');
  } catch(e) { toast('Network error','error'); }
}

// ── Import CSV ────────────────────────────────────────────────────
async function importCsv() {
  if (!canAccess('can_import')) { toast('Not authorized to import', 'warning'); return; }

  const file = document.getElementById('csvInput').files[0];
  if (!file) { toast('Select a CSV file','warning'); return; }
  const fd = new FormData(); fd.append('file', file);
  try {
    const r = await fetch('/api/import/artifacts/csv',{method:'POST',body:fd,credentials:'include'});
    const d = await r.json();
    if (r.ok) {
      document.getElementById('importResult').innerHTML =
        `<p style="color:var(--green);font-size:13px"><i class="bi bi-check-circle"></i> Imported ${d.imported} artifact(s)</p>`;
      toast(`Imported ${d.imported} artifacts!`,'success');
      await loadArtifactsAll();
    } else toast(d.error||'Import failed','error');
  } catch(e) { toast('Import error','error'); }
}
// Populate the PDF artifact select on page load
async function loadIeArtifactSelect() {
  const sel = document.getElementById('iePdfArtSelect');
  if (!sel || sel.dataset.loaded) return;
  try {
    const r = await api('/api/artifacts');
    const arts = await r.json();
    arts.forEach(a => {
      const o = document.createElement('option');
      o.value = a.artifact_id; o.textContent = `${a.artifact_id} — ${a.name}`;
      sel.appendChild(o);
    });
    sel.dataset.loaded = '1';
  } catch(e) { console.error(e); }
}

// ── CSV drop zone handlers ────────────────────────────────────────
function onCsvSelected(input) {
  const name = input.files[0]?.name || '';
  if (name) document.getElementById('csvDropText').textContent = `📄 ${name}`;
}
function handleCsvDrop(e) {
  e.preventDefault();
  document.getElementById('csvDropZone').classList.remove('drag-over');
  const file = e.dataTransfer.files[0];
  if (file && file.name.endsWith('.csv')) {
    const dt = new DataTransfer(); dt.items.add(file);
    document.getElementById('csvInput').files = dt.files;
    document.getElementById('csvDropText').textContent = `📄 ${file.name}`;
  } else { toast('Please drop a .csv file', 'warning'); }
}
function onInspCsvSelected(input) {
  const name = input.files[0]?.name || '';
  if (name) document.getElementById('inspDropText').textContent = `📄 ${name}`;
}
function handleInspDrop(e) {
  e.preventDefault();
  document.getElementById('inspDropZone').classList.remove('drag-over');
  const file = e.dataTransfer.files[0];
  if (file && file.name.endsWith('.csv')) {
    const dt = new DataTransfer(); dt.items.add(file);
    document.getElementById('inspCsvInput').files = dt.files;
    document.getElementById('inspDropText').textContent = `📄 ${file.name}`;
  } else { toast('Please drop a .csv file', 'warning'); }
}

// ── Download CSV templates ────────────────────────────────────────
function downloadCsvTemplate() {
  const csv = 'name,category,age,location,description\nExample Artifact,Sculpture,500,Gallery A,Brief description here';
  _downloadBlob(csv, 'artifacts_template.csv', 'text/csv');
  toast('Template downloaded', 'success');
}
function downloadInspectionCsvTemplate() {
  const csv = 'artifact_id,inspection_date,inspection_type,crack_detected,fading_level,severity_index,damage_notes\n1031,2026-01-10,Routine,1,0.42,5.8,Minor surface cracks detected';
  _downloadBlob(csv, 'inspections_template.csv', 'text/csv');
  toast('Template downloaded', 'success');
}
function _downloadBlob(content, filename, mime) {
  const blob = new Blob([content], { type: mime });
  const a = document.createElement('a');
  a.href = URL.createObjectURL(blob); a.download = filename; a.click();
}

// ── Import Inspections CSV ────────────────────────────────────────
async function importInspectionsCsv() {
  if (!canAccess('can_import')) { toast('Not authorized to import', 'warning'); return; }
  const file = document.getElementById('inspCsvInput').files[0];
  if (!file) { toast('Select a CSV file first', 'warning'); return; }
  const resultEl = document.getElementById('importInspResult');
  resultEl.className = 'ie-result';
  resultEl.textContent = 'Importing…';
  const fd = new FormData(); fd.append('file', file);
  try {
    const r = await fetch('/api/import/inspections/csv', { method:'POST', body:fd, credentials:'include' });
    const d = await r.json();
    if (r.ok) {
      resultEl.className = 'ie-result success';
      resultEl.innerHTML = `<i class="bi bi-check-circle"></i> Imported ${d.imported} inspection(s)`;
      toast(`Imported ${d.imported} inspections!`, 'success');
    } else {
      resultEl.className = 'ie-result error';
      resultEl.innerHTML = `<i class="bi bi-x-circle"></i> ${d.error || 'Import failed'}`;
      toast(d.error || 'Import failed', 'error');
    }
  } catch(e) {
    resultEl.className = 'ie-result error';
    resultEl.textContent = 'Network error';
    toast('Import error', 'error');
  }
}

// ── Export Artifacts CSV ──────────────────────────────────────────
async function exportArtifactsCsv() {
  toast('Preparing export…', 'info');
  try {
    const r = await api('/api/artifacts');
    const arts = await r.json();
    if (!arts.length) { toast('No artifacts to export', 'warning'); return; }
    const headers = ['artifact_id','name','category','age','location','description','condition_status','created_at'];
    const rows = arts.map(a => headers.map(h => `"${(a[h]||'').toString().replace(/"/g,'""')}"`).join(','));
    _downloadBlob([headers.join(','), ...rows].join('\n'),
      `artifacts_export_${new Date().toISOString().slice(0,10)}.csv`, 'text/csv');
    toast(`Exported ${arts.length} artifacts`, 'success');
  } catch(e) { toast('Export failed', 'error'); }
}

// ── Export Alerts CSV ─────────────────────────────────────────────
async function exportAlertsCsv() {
  toast('Preparing alerts export…', 'info');
  try {
    const r = await api('/api/alerts');
    const alerts = await r.json();
    if (!alerts.length) { toast('No alerts to export', 'warning'); return; }
    const headers = ['alert_id','artifact_name','severity','alert_message','alert_date','is_read','email_sent'];
    const rows = alerts.map(a => headers.map(h => `"${(a[h]||'').toString().replace(/"/g,'""')}"`).join(','));
    _downloadBlob([headers.join(','), ...rows].join('\n'),
      `alerts_export_${new Date().toISOString().slice(0,10)}.csv`, 'text/csv');
    toast(`Exported ${alerts.length} alerts`, 'success');
  } catch(e) { toast('Export failed', 'error'); }
}

// ── Export single artifact PDF from IE page ───────────────────────
function ieExportPdf() {
  const aid = document.getElementById('iePdfArtSelect').value;
  if (!aid) { toast('Select an artifact first', 'warning'); return; }
  window.open(`/api/export/artifact/${aid}/pdf`, '_blank');
  toast('Generating PDF report…', 'info');
}

// ── Global Search ─────────────────────────────────────────────────
function globalSearchFn(q) {
  if (!q.trim()) { renderArtifactGrid(STATE.artifacts); return; }
  const ql = q.toLowerCase();
  const filtered = STATE.artifacts.filter(a =>
    a.name?.toLowerCase().includes(ql) || a.category?.toLowerCase().includes(ql) ||
    a.location?.toLowerCase().includes(ql));
  if (filtered.length) {
    showSection('artifacts');
    renderArtifactGrid(filtered);
  } else {
    // Fall through to inspections search
    showSection('inspections');
    document.getElementById('inspSearch').value = q;
    loadInspections();
  }
}

// ── Drag & Drop ───────────────────────────────────────────────────
function initDragDrop() {
  const zoneMap = {
    'analyzeDropZone': 'imgInput',
    'beforeZone':      'beforeInput',
    'afterZone':       'afterInput',
    'videoDropZone':   'videoInput',
  };
  Object.entries(zoneMap).forEach(([zoneId, inputId]) => {
    const zone  = document.getElementById(zoneId);
    const input = document.getElementById(inputId);
    if (!zone || !input) return;

    zone.addEventListener('click', () => input.click());

    input.addEventListener('change', () => {
      const file = input.files[0]; if (!file) return;
      if (zoneId === 'analyzeDropZone')  loadAnalyzePreview(file);
      if (zoneId === 'beforeZone')       loadComparePreview('before', input);
      if (zoneId === 'afterZone')        loadComparePreview('after', input);
      if (zoneId === 'videoDropZone')    loadVideoPreview(file);
    });

    zone.addEventListener('dragover', e => { e.preventDefault(); zone.classList.add('dragover'); });
    zone.addEventListener('dragleave', () => zone.classList.remove('dragover'));
    zone.addEventListener('drop', e => {
      e.preventDefault(); zone.classList.remove('dragover');
      const file = e.dataTransfer.files[0]; if (!file) return;
      const dt = new DataTransfer(); dt.items.add(file); input.files = dt.files;
      if (zoneId === 'analyzeDropZone')  loadAnalyzePreview(file);
      if (zoneId === 'beforeZone')       loadComparePreview('before', input);
      if (zoneId === 'afterZone')        loadComparePreview('after', input);
      if (zoneId === 'videoDropZone')    loadVideoPreview(file);
    });
  });
}

function loadVideoPreview(file) {
  const vid = document.getElementById('videoPrev');
  const btn = document.getElementById('videoBtn');
  const fn  = document.getElementById('videoFileName');
  if (vid) { vid.src = URL.createObjectURL(file); vid.classList.remove('d-none'); }
  if (btn) btn.disabled = false;
  if (fn)  fn.textContent = `📎 ${file.name}`;
  const zone = document.getElementById('videoDropZone');
  if (zone) zone.style.display = 'none';
}

// ── Chart Defaults ────────────────────────────────────────────────
function chartDefaults(gridColor, textColor) {
  return {
    responsive: true, maintainAspectRatio: false,
    plugins: { legend: { labels: { color: textColor, font:{size:11} } } },
    scales: {
      x: { ticks:{ color:textColor, font:{size:11} }, grid:{ color:gridColor } },
      y: { ticks:{ color:textColor, font:{size:11} }, grid:{ color:gridColor } }
    }
  };
}

// ── Helpers ───────────────────────────────────────────────────────
function sevToRisk(sev) {
  const s = parseFloat(sev||0);
  if (s>=8) return 'CRITICAL'; if (s>=6) return 'HIGH'; if (s>=3.5) return 'MEDIUM'; return 'LOW';
}
function riskBadge(risk) {
  return `<span class="badge-risk risk-${risk}">${risk}</span>`;
}
function riskColor(risk) {
  return { CRITICAL:'#f87171', HIGH:'#fb923c', MEDIUM:'#fbbf24', LOW:'#4ade80' }[risk] || '#94a3b8';
}
function truncate(s, n) { return s?.length > n ? s.slice(0,n)+'…' : s; }
// ── Lightbox ──────────────────────────────────────────────────────
function openLightbox(src) {
  // Remove existing lightbox if any
  document.getElementById('lightboxOverlay')?.remove();
  const overlay = document.createElement('div');
  overlay.id = 'lightboxOverlay';
  overlay.style.cssText = `
    position:fixed;inset:0;background:rgba(0,0,0,.92);z-index:9999;
    display:flex;align-items:center;justify-content:center;cursor:zoom-out;
  `;
  overlay.innerHTML = `
    <img src="${src}" style="max-width:90vw;max-height:90vh;border-radius:12px;
      object-fit:contain;box-shadow:0 25px 60px rgba(0,0,0,.8)" 
      onerror="this.src='/static/images/no-img.svg'"/>
    <button onclick="document.getElementById('lightboxOverlay').remove()" 
      style="position:absolute;top:20px;right:24px;background:rgba(255,255,255,.15);
      color:#fff;border:none;border-radius:50%;width:40px;height:40px;
      font-size:20px;cursor:pointer;display:flex;align-items:center;justify-content:center">
      ✕
    </button>`;
  overlay.addEventListener('click', e => {
    if (e.target === overlay) overlay.remove();
  });
  document.body.appendChild(overlay);
}
// ════════════════════════════════════════════════════════════
// SECTION 3 — JAVASCRIPT
// Add ALL of these functions to the END of your app.js file
// Do NOT modify any existing functions
// ════════════════════════════════════════════════════════════


// ── FEATURE 1: ARTIFACT DNA FINGERPRINTING ───────────────────────────────────

async function enrollFingerprint() {
  const canvas = document.getElementById('cameraCanvas');
  const aid    = document.getElementById('cameraArtifact').value;
  if (!aid) { toast('Select an artifact first', 'warning'); return; }

  const btn = document.getElementById('enrollFpBtn');
  btn.disabled = true;
  btn.innerHTML = '<span class="spinner" style="width:13px;height:13px;border-width:2px;display:inline-block;vertical-align:middle"></span> Enrolling…';

  canvas.toBlob(async blob => {
    const fd = new FormData();
    fd.append('image', blob, 'enroll.jpg');
    try {
      const r = await fetch(`/api/artifacts/${aid}/fingerprint/enroll`, {
        method: 'POST', body: fd, credentials: 'include'
      });
      const d = await r.json();
      if (r.ok) {
        toast(`✅ Fingerprint enrolled! ID: ${d.fingerprint_id}`, 'success', 5000);
        // Show success in captureResult
        const cr = document.getElementById('captureResult');
        if (cr) cr.innerHTML += `
          <div style="margin-top:10px;padding:12px;background:var(--green-a,rgba(22,163,74,.15));
            border:1px solid var(--green,#16a34a);border-radius:8px;font-size:13px;color:#4ade80">
            <i class="bi bi-fingerprint"></i> <strong>Master fingerprint enrolled</strong>
            — Fingerprint ID: ${d.fingerprint_id}
          </div>`;
      } else {
        toast(d.error || 'Enrollment failed', 'error');
      }
    } catch(e) { toast('Network error during enrollment', 'error'); }
    finally {
      btn.disabled = false;
      btn.innerHTML = '<i class="bi bi-fingerprint"></i> Enroll DNA';
    }
  }, 'image/jpeg', 0.9);
}

async function verifyFingerprint() {
  const canvas = document.getElementById('cameraCanvas');
  const aid    = document.getElementById('cameraArtifact').value;
  if (!aid) { toast('Select an artifact first', 'warning'); return; }

  const btn = document.getElementById('verifyFpBtn');
  btn.disabled = true;
  btn.innerHTML = '<span class="spinner" style="width:13px;height:13px;border-width:2px;display:inline-block;vertical-align:middle"></span> Verifying…';

  canvas.toBlob(async blob => {
    const fd = new FormData();
    fd.append('image', blob, 'verify.jpg');
    try {
      const r = await fetch(`/api/artifacts/${aid}/fingerprint/verify`, {
        method: 'POST', body: fd, credentials: 'include'
      });
      const d = await r.json();
      if (r.ok) {
        renderFingerprintResult(d);
        if (d.authentic) toast('✅ Fingerprint AUTHENTIC — artifact verified!', 'success', 5000);
        else toast(`⚠️ Fingerprint ${d.status} — ${d.overall_score.toFixed(1)}% match`, 'error', 7000);
      } else {
        toast(d.error || 'Verification failed', 'error');
      }
    } catch(e) { toast('Network error during verification', 'error'); }
    finally {
      btn.disabled = false;
      btn.innerHTML = '<i class="bi bi-shield-check"></i> Verify DNA';
    }
  }, 'image/jpeg', 0.9);
}

function renderFingerprintResult(d) {
  const colors = {
    AUTHENTIC:  { bg: 'rgba(22,163,74,.15)',  border: '#16a34a', text: '#4ade80',  icon: '✅' },
    SUSPICIOUS: { bg: 'rgba(217,119,6,.15)',  border: '#d97706', text: '#fbbf24',  icon: '⚠️' },
    ALERT:      { bg: 'rgba(220,38,38,.15)',  border: '#dc2626', text: '#f87171',  icon: '🚨' },
  };
  const c   = colors[d.status] || colors.SUSPICIOUS;
  const cr  = document.getElementById('captureResult');
  if (!cr) return;

  const scores = [
    { label: 'Hash',         val: d.hash_similarity },
    { label: 'Texture',      val: d.texture_similarity },
    { label: 'Color',        val: d.color_similarity },
    { label: 'Surface',      val: d.surface_similarity },
    { label: 'Crack Pattern',val: d.crack_pattern_similarity },
  ];

  const scoreGrid = scores.map(s => `
    <div style="background:var(--bg2,#0f172a);border:1px solid var(--border,#1f2d3d);
      border-radius:8px;padding:10px;text-align:center">
      <div style="font-size:18px;font-weight:700;color:${s.val >= 90 ? '#4ade80' : s.val >= 75 ? '#fbbf24' : '#f87171'}">
        ${s.val.toFixed(0)}%
      </div>
      <div style="font-size:10px;color:var(--muted,#475569);margin-top:3px;text-transform:uppercase">${s.label}</div>
    </div>`).join('');

  cr.innerHTML += `
    <div style="margin-top:14px;border:2px solid ${c.border};border-radius:12px;
      background:${c.bg};padding:16px">
      <!-- Status banner -->
      <div style="text-align:center;margin-bottom:14px">
        <div style="font-size:36px;font-weight:900;color:${c.text};letter-spacing:1px">
          ${c.icon} ${d.status}
        </div>
        <div style="font-size:48px;font-weight:900;color:${c.text};line-height:1">
          ${d.overall_score.toFixed(1)}%
        </div>
        <div style="font-size:12px;color:var(--muted,#475569);margin-top:4px">Overall Match Score</div>
      </div>
      <!-- 5-score grid -->
      <div style="display:grid;grid-template-columns:repeat(5,1fr);gap:8px;margin-bottom:12px">
        ${scoreGrid}
      </div>
      ${!d.authentic ? `
      <div style="background:rgba(220,38,38,.1);border:1px solid rgba(220,38,38,.3);
        border-radius:8px;padding:12px;font-size:13px;color:#f87171;text-align:center">
        ⚠️ <strong>Warning:</strong> This artifact's appearance does not match the master fingerprint.
        Possible tampering, forgery or substitution detected. An alert has been created.
      </div>` : `
      <div style="background:rgba(22,163,74,.1);border:1px solid rgba(22,163,74,.3);
        border-radius:8px;padding:12px;font-size:13px;color:#4ade80;text-align:center">
        ✅ Artifact appearance matches master fingerprint within acceptable threshold.
      </div>`}
    </div>`;
}

async function loadFpHistory(artifactId) {
  if (!artifactId) return;
  try {
    const r = await api(`/api/artifacts/${artifactId}/fingerprint/history`);
    const rows = await r.json();
    const el = document.getElementById('fpHistoryList');
    if (!el) return;
    if (!rows.length) { el.innerHTML='<p style="color:var(--muted);font-size:13px">No verifications yet</p>'; return; }
    el.innerHTML = rows.map(v => {
      const c = v.status === 'AUTHENTIC' ? '#4ade80' : v.status === 'SUSPICIOUS' ? '#fbbf24' : '#f87171';
      return `<div style="display:flex;justify-content:space-between;align-items:center;
        padding:8px 12px;background:var(--bg2);border-radius:8px;margin-bottom:6px;font-size:13px">
        <span style="color:var(--text2)">${v.verified_at?.slice(0,16)||'—'}</span>
        <span style="color:${c};font-weight:700">${v.status}</span>
        <span style="color:var(--text)">${v.overall_score?.toFixed(1)}%</span>
      </div>`;
    }).join('');
  } catch(e) { console.error(e); }
}


// ── FEATURE 2: TEMPORAL DETERIORATION PREDICTION ─────────────────────────────

async function loadPrediction(artifactId) {
  const panel = document.getElementById('predictionPanel');
  if (!panel || !artifactId) return;

  panel.innerHTML = `<div style="text-align:center;padding:32px;color:var(--muted)">
    <div class="spinner" style="width:32px;height:32px;border-width:3px;margin:0 auto 12px"></div>
    <p>Running prediction model…</p>
  </div>`;

  try {
    const r = await api(`/api/artifacts/${artifactId}/predict`);
    const d = await r.json();
    if (!r.ok) {
      panel.innerHTML = `<p style="color:var(--muted);font-size:13px;padding:16px">⚠️ ${d.error||'Prediction failed'}</p>`;
      return;
    }
    if (d.status === 'insufficient_data') {
      panel.innerHTML = `
        <div style="text-align:center;padding:24px;color:var(--muted)">
          <i class="bi bi-bar-chart" style="font-size:36px;opacity:.4;display:block;margin-bottom:10px"></i>
          <p style="font-size:14px;font-weight:600;color:var(--text)">Not enough data yet</p>
          <p style="font-size:13px;margin-top:6px">${d.message}</p>
          <p style="font-size:12px;margin-top:4px">Add ${d.needed} more inspection${d.needed>1?'s':''} to enable predictions.</p>
        </div>`;
      return;
    }
    renderPrediction(d, panel);
  } catch(e) {
    panel.innerHTML = `<p style="color:var(--muted);font-size:13px;padding:16px">Network error loading prediction</p>`;
  }
}

function renderPrediction(d, panel) {
  const labelMeta = {
    CRITICAL_NOW:  { color:'#f87171', bg:'rgba(220,38,38,.15)',  border:'rgba(220,38,38,.3)',  icon:'🔴', text:'CRITICAL NOW'  },
    CRITICAL_SOON: { color:'#fb923c', bg:'rgba(234,88,12,.15)',  border:'rgba(234,88,12,.3)',  icon:'🟠', text:'CRITICAL SOON' },
    HIGH_RISK:     { color:'#fbbf24', bg:'rgba(217,119,6,.15)',  border:'rgba(217,119,6,.3)',  icon:'🟡', text:'HIGH RISK'     },
    MEDIUM_RISK:   { color:'#60a5fa', bg:'rgba(29,78,216,.15)',  border:'rgba(29,78,216,.3)',  icon:'🔵', text:'MEDIUM RISK'   },
    LOW_RISK:      { color:'#4ade80', bg:'rgba(22,163,74,.15)',  border:'rgba(22,163,74,.3)',  icon:'🟢', text:'LOW RISK'      },
  };
  const lm = labelMeta[d.forecast_label] || labelMeta.MEDIUM_RISK;

  function sevColor(s) {
    if (s >= 8) return '#f87171';
    if (s >= 6) return '#fb923c';
    if (s >= 3.5) return '#fbbf24';
    return '#4ade80';
  }

  const timeline = [
    { label: 'Now',   val: d.forecast.now },
    { label: '+30d',  val: d.forecast.d30 },
    { label: '+60d',  val: d.forecast.d60 },
    { label: '+90d',  val: d.forecast.d90 },
  ].map(t => `
    <div style="background:var(--bg2,#0f172a);border:1px solid var(--border,#1f2d3d);
      border-radius:10px;padding:12px;text-align:center">
      <div style="font-size:22px;font-weight:800;color:${sevColor(t.val)}">${t.val.toFixed(1)}</div>
      <div style="font-size:10px;color:var(--muted);margin-top:4px;text-transform:uppercase">${t.label}</div>
    </div>`).join('');

  panel.innerHTML = `
    <div style="padding:20px 0 0">
      <!-- Forecast label badge -->
      <div style="display:flex;align-items:center;gap:12px;margin-bottom:16px;flex-wrap:wrap">
        <div style="background:${lm.bg};border:1px solid ${lm.border};border-radius:10px;
          padding:10px 18px;font-size:15px;font-weight:800;color:${lm.color}">
          ${lm.icon} ${lm.text}
        </div>
        ${d.days_to_critical ? `
        <div style="font-size:13px;color:var(--text2)">
          <i class="bi bi-clock" style="color:#f87171"></i>
          Critical in <strong style="color:#f87171">${d.days_to_critical} days</strong>
          (${d.critical_date})
        </div>` : `
        <div style="font-size:13px;color:#4ade80">
          <i class="bi bi-shield-check"></i> No critical threshold within 2 years
        </div>`}
        ${d.safe_display_days ? `
        <div style="font-size:13px;color:var(--text2)">
          <i class="bi bi-eye" style="color:#fbbf24"></i>
          Safe display: <strong style="color:#fbbf24">${d.safe_display_days} days remaining</strong>
        </div>` : ''}
      </div>

      <!-- Severity timeline -->
      <div style="font-size:11px;font-weight:700;text-transform:uppercase;letter-spacing:.6px;
        color:var(--muted);margin-bottom:10px">
        <i class="bi bi-graph-up-arrow"></i> Severity Forecast
      </div>
      <div style="display:grid;grid-template-columns:repeat(4,1fr);gap:10px;margin-bottom:16px">
        ${timeline}
      </div>

      <!-- Fading & crack -->
      <div style="display:grid;grid-template-columns:1fr 1fr;gap:10px;margin-bottom:16px">
        <div style="background:var(--bg2);border:1px solid var(--border);border-radius:10px;padding:14px">
          <div style="font-size:11px;text-transform:uppercase;letter-spacing:.5px;color:var(--muted);margin-bottom:6px">
            Fading at 90 Days
          </div>
          <div style="font-size:24px;font-weight:800;color:#a78bfa">${d.fading_at_90d.toFixed(1)}%</div>
          <div style="font-size:11px;color:var(--muted);margin-top:4px">
            +${d.fading_monthly_rate.toFixed(2)}% / month
          </div>
        </div>
        <div style="background:var(--bg2);border:1px solid var(--border);border-radius:10px;padding:14px">
          <div style="font-size:11px;text-transform:uppercase;letter-spacing:.5px;color:var(--muted);margin-bottom:6px">
            Crack Probability
          </div>
          <div style="font-size:24px;font-weight:800;color:${d.crack_probability_pct > 60 ? '#f87171' : d.crack_probability_pct > 30 ? '#fbbf24' : '#4ade80'}">
            ${d.crack_probability_pct.toFixed(1)}%
          </div>
          <div style="font-size:11px;color:var(--muted);margin-top:4px">historical rate</div>
        </div>
      </div>

      <!-- Bottom info bar -->
      <div style="background:var(--bg2);border:1px solid var(--border);border-radius:10px;
        padding:12px 16px;display:flex;flex-wrap:wrap;gap:16px;font-size:12px;color:var(--muted)">
        <span><i class="bi bi-calendar-check" style="color:var(--accent,#d4a017)"></i>
          Next inspection: <strong style="color:var(--text)">${d.next_inspection_date}</strong></span>
        <span><i class="bi bi-graph-up" style="color:var(--accent,#d4a017)"></i>
          Confidence: <strong style="color:var(--text)">${d.confidence_pct.toFixed(0)}%</strong></span>
        <span><i class="bi bi-search" style="color:var(--accent,#d4a017)"></i>
          Based on <strong style="color:var(--text)">${d.inspection_count}</strong> inspections
          (${d.regression_degree === 2 ? 'polynomial' : 'linear'} model)</span>
      </div>
    </div>`;
}
let AUDIT_PAGE = 1;

async function loadAuditLogs(page = 1) {
  AUDIT_PAGE = page;
  const search  = document.getElementById('auditSearch')?.value  || '';
  const user    = document.getElementById('auditUserFilter')?.value || '';
  const action   = document.getElementById('auditActionFilter')?.value || '';
  const dateFrom = document.getElementById('auditDateFrom')?.value || '';
  const dateTo   = document.getElementById('auditDateTo')?.value   || '';
  const url = `/api/audit-logs?page=${page}&search=${encodeURIComponent(search)}`
            + `&user=${encodeURIComponent(user)}&action=${encodeURIComponent(action)}`
            + `&date_from=${dateFrom}&date_to=${dateTo}`;
  try {
    const r = await api(url);
    if (r.status === 403) {
      document.getElementById('auditTableWrap').innerHTML =
        '<p style="color:var(--muted);padding:24px;text-align:center">Admin access required</p>';
      return;
    }
    const d = await r.json();
    renderAuditTable(d);
    populateAuditUserFilter(d.users || []);
  } catch(e) { console.error('Audit load error', e); }
}

function renderAuditTable(d) {
  const tbody = document.getElementById('auditTbody');
  const info  = document.getElementById('auditPageInfo');
  if (!tbody) return;

  if (!d.logs.length) {
    tbody.innerHTML = '<tr><td colspan="6" class="loading-cell">No audit logs found</td></tr>';
    if (info) info.textContent = '';
    return;
  }

  const actionMeta = {
    'User Login':           { icon:'bi-box-arrow-in-right', bg:'rgba(59,130,246,.15)',  color:'#60a5fa' },
    'User Logout':          { icon:'bi-box-arrow-right',    bg:'rgba(100,116,139,.15)', color:'#94a3b8' },
    'AI Analysis Run':      { icon:'bi-cpu',                bg:'rgba(201,149,26,.15)',  color:'#e8af2a' },
    'Artifact Created':     { icon:'bi-plus-circle',        bg:'rgba(22,163,74,.15)',   color:'#4ade80' },
    'Artifact Edited':      { icon:'bi-pencil',             bg:'rgba(59,130,246,.12)',  color:'#93c5fd' },
    'Artifact Deleted':     { icon:'bi-trash',              bg:'rgba(220,38,38,.15)',   color:'#f87171' },
    'Fingerprint Enrolled': { icon:'bi-fingerprint',        bg:'rgba(139,92,246,.15)',  color:'#c4b5fd' },
    'Fingerprint Verified': { icon:'bi-shield-check',       bg:'rgba(139,92,246,.15)',  color:'#c4b5fd' },
    'Report Generated':     { icon:'bi-file-pdf',           bg:'rgba(234,88,12,.15)',   color:'#fb923c' },
  };

  tbody.innerHTML = d.logs.map(l => {
    const m = actionMeta[l.action] || { icon:'bi-activity', bg:'rgba(201,149,26,.1)', color:'var(--accent)' };
    return `
      <tr>
        <td style="color:var(--muted);font-size:11px;white-space:nowrap">
          ${l.created_at?.slice(0,16).replace('T',' ') || '—'}
        </td>
        <td>
          <strong style="color:var(--text)">${l.username || '—'}</strong>
          <div style="font-size:11px;color:var(--muted)">${l.role || ''}</div>
        </td>
        <td>
          <span style="display:inline-flex;align-items:center;gap:6px;padding:3px 10px;
                       border-radius:20px;font-size:11px;font-weight:600;
                       background:${m.bg};color:${m.color}">
            <i class="bi ${m.icon}"></i>${l.action}
          </span>
        </td>
        <td style="color:var(--text2)">${l.artifact_name || '—'}</td>
        <td style="font-size:11px;color:var(--muted);max-width:200px;
            overflow:hidden;text-overflow:ellipsis;white-space:nowrap"
            title="${l.details || ''}">${l.details || '—'}</td>
        <td style="font-size:11px;color:var(--muted)">${l.ip_address || '—'}</td>
      </tr>`;
  }).join('');

  if (info) {
    info.innerHTML = `
      Showing <strong>${d.logs.length}</strong> of <strong>${d.total}</strong> entries
      &nbsp;|&nbsp; Page ${d.page} of ${d.pages}`;
  }
  renderAuditPagination(d.page, d.pages);
}

function renderAuditPagination(current, total) {
  const el = document.getElementById('auditPagination');
  if (!el || total <= 1) { if (el) el.innerHTML = ''; return; }
  let html = '';
  const start = Math.max(1, current - 2);
  const end   = Math.min(total, current + 2);
  if (current > 1)
    html += `<button class="audit-pg-btn" onclick="loadAuditLogs(${current-1})">‹</button>`;
  for (let p = start; p <= end; p++)
    html += `<button class="audit-pg-btn${p === current ? ' active' : ''}"
               onclick="loadAuditLogs(${p})">${p}</button>`;
  if (current < total)
    html += `<button class="audit-pg-btn" onclick="loadAuditLogs(${current+1})">›</button>`;
  el.innerHTML = html;
}

function populateAuditUserFilter(users) {
  const sel = document.getElementById('auditUserFilter');
  if (!sel || sel.dataset.populated) return;
  sel.dataset.populated = '1';
  users.forEach(u => {
    const opt = document.createElement('option');
    opt.value = u; opt.textContent = u;
    sel.appendChild(opt);
  });
}

async function clearOldAuditLogs() {
  const days = prompt('Delete logs older than how many days?', '90');
  if (!days) return;
  const r = await api(`/api/audit-logs?days=${days}`, { method: 'DELETE' });
  const d = await r.json();
  toast(`Deleted ${d.deleted} old log entries`, 'success');
  loadAuditLogs(1);
}
function exportAuditCSV() {
  const search   = document.getElementById('auditSearch')?.value  || '';
  const user     = document.getElementById('auditUserFilter')?.value || '';
  const action   = document.getElementById('auditActionFilter')?.value || '';
  const dateFrom = document.getElementById('auditDateFrom')?.value || '';
  const dateTo   = document.getElementById('auditDateTo')?.value   || '';
  // Fetch all pages and build CSV
  const url = `/api/audit-logs?page=1&per_page=9999&search=${encodeURIComponent(search)}`
            + `&user=${encodeURIComponent(user)}&action=${encodeURIComponent(action)}`
            + `&date_from=${dateFrom}&date_to=${dateTo}`;
  api(url).then(r => r.json()).then(d => {
    if (!d.logs?.length) { toast('No logs to export', 'warning'); return; }
    const headers = ['Timestamp','User','Role','Action','Artifact','Details','IP'];
    const rows = d.logs.map(l => [
      (l.created_at||'').slice(0,16).replace('T',' '),
      l.username||'',
      l.role||'',
      l.action||'',
      l.artifact_name||'',
      (l.details||'').replace(/,/g,' '),
      l.ip_address||''
    ].map(v => `"${v}"`).join(','));
    const csv  = [headers.join(','), ...rows].join('\n');
    const blob = new Blob([csv], { type:'text/csv' });
    const a    = document.createElement('a');
    a.href     = URL.createObjectURL(blob);
    a.download = `audit_log_${new Date().toISOString().slice(0,10)}.csv`;
    a.click();
    toast('Audit log exported', 'success');
  }).catch(() => toast('Export failed', 'error'));
}
