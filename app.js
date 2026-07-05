/* =====================================================================
   Community Health Watch — client-only demo build (HTML/CSS/JS)

   IMPORTANT: This version has no real server or database. All data
   (users, check-ins, symptom reports, alerts) lives in plain JS
   variables in memory, so everything resets on page refresh and is
   only visible in this one browser tab. It's meant to demo the Phase 1
   UX and business logic end-to-end without any backend setup.

   For real multi-user use with persistence, passwords that are
   actually hashed, and data survives a refresh, you need a server +
   database — see the earlier Next.js/Prisma version of this project.
   ===================================================================== */

// Surface any unexpected error directly on the page. If you ever see this
// banner, please copy its exact text — that pinpoints the real problem
// immediately, rather than the app just silently appearing "broken."
window.addEventListener("error", function (event) {
  const banner = document.getElementById("fatal-error-banner");
  if (!banner) return;
  banner.textContent =
    "A script error occurred: " + event.message +
    (event.filename ? " (" + event.filename + ":" + event.lineno + ")" : "");
  banner.classList.remove("hidden");
});

// ---------------------------------------------------------------------
// In-memory "database"
// ---------------------------------------------------------------------
const db = {
  users: [],          // { id, name, email, password, role, areaCode }
  healthRecords: [],   // { id, userId, temperatureC, heartRateBpm, systolicBp, diastolicBp, spo2Percent, notes, healthScore, createdAt }
  symptomReports: [],  // { id, userId, symptoms[], severity, notes, areaCode, createdAt }
  alerts: [],          // { id, areaCode, title, description, severity, status, triggerType, createdAt }
};

let nextId = 1;
function makeId() {
  return "id_" + nextId++;
}

// ---------------------------------------------------------------------
// Seed demo data (mirrors the backend version's seed script)
// ---------------------------------------------------------------------
function seedDemoData() {
  const admin = {
    id: makeId(), name: "Ada Admin", email: "admin@example.com",
    password: "Password123!", role: "ADMIN", areaCode: null,
  };
  const officer = {
    id: makeId(), name: "Oscar Officer", email: "officer@example.com",
    password: "Password123!", role: "OFFICER", areaCode: "WARD-12",
  };
  const citizen = {
    id: makeId(), name: "Cara Citizen", email: "citizen@example.com",
    password: "Password123!", role: "CITIZEN", areaCode: "WARD-12",
  };
  db.users.push(admin, officer, citizen);

  addHealthRecord(citizen.id, {
    temperatureC: 36.8, heartRateBpm: 72, systolicBp: 118, diastolicBp: 76, spo2Percent: 98,
  });
  addSymptomReport(citizen.id, { symptoms: ["cough", "fatigue"], severity: 2 });
}

// ---------------------------------------------------------------------
// Core domain logic (ported 1:1 from the backend's lib/health-logic.js)
// ---------------------------------------------------------------------
function calculateHealthScore({ temperatureC, heartRateBpm, systolicBp, diastolicBp, spo2Percent }) {
  let score = 100;

  if (temperatureC >= 38.0) score -= 30;
  else if (temperatureC >= 37.3) score -= 15;
  else if (temperatureC < 35.5) score -= 20;

  if (heartRateBpm > 120 || heartRateBpm < 40) score -= 25;
  else if (heartRateBpm > 100 || heartRateBpm < 50) score -= 10;

  if (systolicBp != null && diastolicBp != null) {
    if (systolicBp >= 180 || diastolicBp >= 120) score -= 25;
    else if (systolicBp >= 140 || diastolicBp >= 90) score -= 10;
    else if (systolicBp < 90 || diastolicBp < 60) score -= 10;
  }

  if (spo2Percent != null) {
    if (spo2Percent < 90) score -= 30;
    else if (spo2Percent < 95) score -= 15;
  }

  return Math.max(0, Math.min(100, score));
}

function classifyHealthRecord(score) {
  if (score >= 80) return "NORMAL";
  if (score >= 60) return "WATCH";
  return "CRITICAL";
}

const ALERT_WINDOW_HOURS = 24;

function evaluateAreaAlert({ areaCode, totalReports, feverCount, lowSpo2Count, avgSeverity }) {
  if (totalReports === 0) return { trigger: false };

  const feverRate = feverCount / totalReports;

  if (lowSpo2Count >= 3) {
    return {
      trigger: true, triggerType: "LOW_SPO2_CLUSTER", severity: "HIGH",
      title: `Low oxygen saturation cluster in ${areaCode}`,
      description: `${lowSpo2Count} residents in ${areaCode} reported SpO2 below 95% recently. Recommend priority follow-up.`,
    };
  }

  if (feverCount >= 5 && feverRate >= 0.3) {
    return {
      trigger: true, triggerType: "FEVER_CLUSTER",
      severity: feverRate >= 0.5 ? "HIGH" : "MEDIUM",
      title: `Fever cluster detected in ${areaCode}`,
      description: `${feverCount} of ${totalReports} recent reports in ${areaCode} include fever (${Math.round(feverRate * 100)}%).`,
    };
  }

  if (avgSeverity >= 3.5 && totalReports >= 5) {
    return {
      trigger: true, triggerType: "SYMPTOM_SEVERITY_SPIKE", severity: "MEDIUM",
      title: `Elevated symptom severity in ${areaCode}`,
      description: `Average self-reported severity in ${areaCode} is ${avgSeverity.toFixed(1)}/5 across ${totalReports} reports.`,
    };
  }

  return { trigger: false };
}

// ---------------------------------------------------------------------
// Data-layer helpers (stand in for the API routes)
// ---------------------------------------------------------------------
function findUserByEmail(email) {
  return db.users.find((u) => u.email.toLowerCase() === email.toLowerCase().trim());
}

function registerUser({ name, email, password, areaCode }) {
  if (findUserByEmail(email)) {
    throw new Error("An account with this email already exists");
  }
  const user = {
    id: makeId(),
    name: name.trim(),
    email: email.toLowerCase().trim(),
    password, // NOTE: plaintext, demo only — a real backend must hash this (see lib/auth.js in the Next.js version)
    role: "CITIZEN",
    areaCode: areaCode ? areaCode.trim() : null,
  };
  db.users.push(user);
  return user;
}

function loginUser({ email, password }) {
  const user = findUserByEmail(email);
  if (!user || user.password !== password) {
    throw new Error("Invalid email or password");
  }
  return user;
}

function addHealthRecord(userId, data) {
  const healthScore = calculateHealthScore(data);
  const record = {
    id: makeId(),
    userId,
    temperatureC: data.temperatureC,
    heartRateBpm: data.heartRateBpm,
    systolicBp: data.systolicBp ?? null,
    diastolicBp: data.diastolicBp ?? null,
    spo2Percent: data.spo2Percent ?? null,
    notes: data.notes || null,
    healthScore,
    createdAt: new Date(),
  };
  db.healthRecords.push(record);
  return record;
}

function addSymptomReport(userId, data) {
  const user = db.users.find((u) => u.id === userId);
  const report = {
    id: makeId(),
    userId,
    symptoms: data.symptoms,
    severity: data.severity,
    notes: data.notes || null,
    areaCode: user ? user.areaCode : null,
    createdAt: new Date(),
  };
  db.symptomReports.push(report);

  if (report.areaCode) evaluateAndRaiseAreaAlert(report.areaCode);
  return report;
}

function evaluateAndRaiseAreaAlert(areaCode) {
  const since = new Date(Date.now() - ALERT_WINDOW_HOURS * 60 * 60 * 1000);

  const recentReports = db.symptomReports.filter((r) => r.areaCode === areaCode && r.createdAt >= since);
  const totalReports = recentReports.length;
  const feverCount = recentReports.filter((r) => r.symptoms.includes("fever")).length;
  const avgSeverity = totalReports > 0
    ? recentReports.reduce((sum, r) => sum + r.severity, 0) / totalReports
    : 0;

  const lowSpo2Count = db.healthRecords.filter((r) => {
    if (r.createdAt < since || r.spo2Percent == null || r.spo2Percent >= 95) return false;
    const owner = db.users.find((u) => u.id === r.userId);
    return owner && owner.areaCode === areaCode;
  }).length;

  const result = evaluateAreaAlert({ areaCode, totalReports, feverCount, lowSpo2Count, avgSeverity });
  if (!result.trigger) return;

  const existingOpen = db.alerts.find(
    (a) => a.areaCode === areaCode && a.triggerType === result.triggerType && a.status === "OPEN"
  );
  if (existingOpen) return;

  db.alerts.push({
    id: makeId(),
    areaCode,
    title: result.title,
    description: result.description,
    severity: result.severity,
    status: "OPEN",
    triggerType: result.triggerType,
    createdAt: new Date(),
  });
}

function getDashboardStats() {
  const startOfToday = new Date();
  startOfToday.setHours(0, 0, 0, 0);

  const totalUsers = db.users.filter((u) => u.role === "CITIZEN").length;
  const healthRecordsToday = db.healthRecords.filter((r) => r.createdAt >= startOfToday).length;
  const symptomReportsToday = db.symptomReports.filter((r) => r.createdAt >= startOfToday).length;
  const criticalRecordsToday = db.healthRecords.filter(
    (r) => r.createdAt >= startOfToday && r.healthScore < 60
  ).length;
  const openAlerts = db.alerts
    .filter((a) => a.status === "OPEN")
    .sort((a, b) => b.createdAt - a.createdAt)
    .slice(0, 20);

  const areaCounts = {};
  db.symptomReports
    .filter((r) => r.createdAt >= startOfToday && r.areaCode)
    .forEach((r) => { areaCounts[r.areaCode] = (areaCounts[r.areaCode] || 0) + 1; });
  const areaBreakdown = Object.entries(areaCounts)
    .map(([areaCode, reportCount]) => ({ areaCode, reportCount }))
    .sort((a, b) => b.reportCount - a.reportCount)
    .slice(0, 10);

  return { totalUsers, healthRecordsToday, symptomReportsToday, criticalRecordsToday, openAlerts, areaBreakdown };
}

// ---------------------------------------------------------------------
// Session (in-memory only — logging out or refreshing clears it)
// ---------------------------------------------------------------------
let currentUser = null;

// ---------------------------------------------------------------------
// View routing
// ---------------------------------------------------------------------
const VIEWS = [
  "login", "register", "citizen-dashboard", "checkin", "symptoms", "admin-dashboard",
];

function showView(name) {
  VIEWS.forEach((v) => {
    document.getElementById(`view-${v}`).classList.toggle("hidden", v !== name);
  });

  const header = document.getElementById("app-header");
  const isAuthView = name === "login" || name === "register";
  header.classList.toggle("hidden", isAuthView);

  if (name === "citizen-dashboard") renderCitizenDashboard();
  if (name === "admin-dashboard") renderAdminDashboard();
  if (name === "symptoms") renderSymptomOptions();
}

function renderNav() {
  const nav = document.getElementById("nav-links");
  nav.innerHTML = "";

  const links = currentUser.role === "CITIZEN"
    ? [
        { label: "Dashboard", view: "citizen-dashboard" },
        { label: "Daily check-in", view: "checkin" },
        { label: "Report symptoms", view: "symptoms" },
      ]
    : [{ label: "Dashboard", view: "admin-dashboard" }];

  links.forEach((link) => {
    const a = document.createElement("a");
    a.href = "#";
    a.textContent = link.label;
    a.addEventListener("click", (e) => { e.preventDefault(); showView(link.view); });
    nav.appendChild(a);
  });

  const userLabel = document.createElement("span");
  userLabel.className = "nav-user";
  userLabel.textContent = currentUser.name;
  nav.appendChild(userLabel);

  const logoutBtn = document.createElement("button");
  logoutBtn.className = "logout-btn";
  logoutBtn.textContent = "Sign out";
  logoutBtn.addEventListener("click", handleLogout);
  nav.appendChild(logoutBtn);
}

function goToPostLoginView() {
  renderNav();
  showView(currentUser.role === "CITIZEN" ? "citizen-dashboard" : "admin-dashboard");
}

function handleLogout() {
  currentUser = null;
  document.getElementById("login-form").reset();
  showView("login");
}

// ---------------------------------------------------------------------
// Rendering: Citizen dashboard
// ---------------------------------------------------------------------
function renderCitizenDashboard() {
  document.getElementById("citizen-welcome").textContent =
    `Welcome back, ${currentUser.name.split(" ")[0]}`;

  const container = document.getElementById("citizen-records");
  const records = db.healthRecords
    .filter((r) => r.userId === currentUser.id)
    .sort((a, b) => b.createdAt - a.createdAt)
    .slice(0, 10);

  if (records.length === 0) {
    container.innerHTML = `
      <div class="card empty-state">
        <p>No check-ins yet. Your first entry starts your health record.</p>
        <button class="btn btn-primary" id="first-checkin-btn" style="margin-top:12px;">Submit your first check-in</button>
      </div>`;
    document.getElementById("first-checkin-btn").addEventListener("click", () => showView("checkin"));
    return;
  }

  container.innerHTML = records.map((r) => {
    const status = classifyHealthRecord(r.healthScore);
    const statusClass = { NORMAL: "status-normal", WATCH: "status-watch", CRITICAL: "status-critical" }[status];
    return `
      <div class="card record-card">
        <div class="record-top">
          <span class="record-date">${r.createdAt.toLocaleString()}</span>
          <span class="record-status ${statusClass}">${status} &middot; score ${r.healthScore}</span>
        </div>
        <div class="vitals-readout">
          <span>TEMP ${r.temperatureC.toFixed(1)}&deg;C</span>
          <span>HR ${r.heartRateBpm} bpm</span>
          ${r.systolicBp && r.diastolicBp ? `<span>BP ${r.systolicBp}/${r.diastolicBp}</span>` : ""}
          ${r.spo2Percent ? `<span>SpO2 ${r.spo2Percent}%</span>` : ""}
        </div>
        ${r.notes ? `<p class="record-notes">${escapeHtml(r.notes)}</p>` : ""}
      </div>`;
  }).join("");
}

// ---------------------------------------------------------------------
// Rendering: Admin dashboard
// ---------------------------------------------------------------------
function renderAdminDashboard() {
  const stats = getDashboardStats();

  document.getElementById("stat-total-users").textContent = stats.totalUsers;
  document.getElementById("stat-checkins-today").textContent = stats.healthRecordsToday;
  document.getElementById("stat-symptoms-today").textContent = stats.symptomReportsToday;

  const criticalEl = document.getElementById("stat-critical-today");
  criticalEl.textContent = stats.criticalRecordsToday;
  criticalEl.classList.toggle("critical", stats.criticalRecordsToday > 0);

  const alertsList = document.getElementById("alerts-list");
  alertsList.innerHTML = stats.openAlerts.length === 0
    ? `<li class="no-data">No active alerts. All clear.</li>`
    : stats.openAlerts.map((alert) => `
        <li class="alert-item alert-${alert.severity.toLowerCase()}">
          <div class="alert-top">
            <span>${escapeHtml(alert.title)}</span>
            <span>${alert.severity}</span>
          </div>
          <p class="alert-desc">${escapeHtml(alert.description)}</p>
          <p class="alert-time">${alert.createdAt.toLocaleString()}</p>
        </li>`).join("");

  const areaList = document.getElementById("area-breakdown-list");
  areaList.innerHTML = stats.areaBreakdown.length === 0
    ? `<li class="no-data">No symptom reports yet today.</li>`
    : stats.areaBreakdown.map((row) => `
        <li class="area-row">
          <span>${escapeHtml(row.areaCode)}</span>
          <span class="count">${row.reportCount}</span>
        </li>`).join("");
}

// ---------------------------------------------------------------------
// Symptom options (checkbox grid)
// ---------------------------------------------------------------------
const SYMPTOM_OPTIONS = [
  { value: "fever", label: "Fever" },
  { value: "cough", label: "Cough" },
  { value: "sore_throat", label: "Sore throat" },
  { value: "shortness_of_breath", label: "Shortness of breath" },
  { value: "fatigue", label: "Fatigue" },
  { value: "headache", label: "Headache" },
  { value: "nausea", label: "Nausea" },
  { value: "diarrhea", label: "Diarrhea" },
  { value: "loss_of_taste_smell", label: "Loss of taste/smell" },
  { value: "body_ache", label: "Body ache" },
];
let selectedSymptoms = [];

function renderSymptomOptions() {
  selectedSymptoms = [];
  const container = document.getElementById("symptom-options");
  container.innerHTML = SYMPTOM_OPTIONS.map((opt) => `
    <label class="symptom-option" data-value="${opt.value}">
      <input type="checkbox" value="${opt.value}" />
      ${opt.label}
    </label>`).join("");

  container.querySelectorAll(".symptom-option").forEach((el) => {
    el.addEventListener("click", (e) => {
      e.preventDefault();
      const value = el.dataset.value;
      const checkbox = el.querySelector("input");
      const isSelected = selectedSymptoms.includes(value);
      if (isSelected) {
        selectedSymptoms = selectedSymptoms.filter((v) => v !== value);
      } else {
        selectedSymptoms.push(value);
      }
      checkbox.checked = !isSelected;
      el.classList.toggle("selected", !isSelected);
    });
  });

  document.getElementById("sym-severity").value = 2;
  document.getElementById("severity-value").textContent = "2";
  document.getElementById("sym-notes").value = "";
  document.getElementById("symptoms-error").classList.add("hidden");
}

// ---------------------------------------------------------------------
// Small helpers
// ---------------------------------------------------------------------
function escapeHtml(str) {
  const div = document.createElement("div");
  div.textContent = str;
  return div.innerHTML;
}

function showError(elementId, message) {
  const el = document.getElementById(elementId);
  el.textContent = message;
  el.classList.remove("hidden");
}

function hideError(elementId) {
  document.getElementById(elementId).classList.add("hidden");
}

// ---------------------------------------------------------------------
// Event wiring
// ---------------------------------------------------------------------
document.addEventListener("DOMContentLoaded", () => {
  seedDemoData();

  // Login / register switch links
  document.querySelectorAll("[data-goto]").forEach((el) => {
    el.addEventListener("click", (e) => {
      e.preventDefault();
      showView(el.dataset.goto);
    });
  });

  // Login form
  document.getElementById("login-form").addEventListener("submit", (e) => {
    e.preventDefault();
    hideError("login-error");
    const email = document.getElementById("login-email").value;
    const password = document.getElementById("login-password").value;
    try {
      currentUser = loginUser({ email, password });
      e.target.reset();
      goToPostLoginView();
    } catch (err) {
      showError("login-error", err.message);
    }
  });

  // Register form
  document.getElementById("register-form").addEventListener("submit", (e) => {
    e.preventDefault();
    hideError("register-error");
    const name = document.getElementById("reg-name").value;
    const email = document.getElementById("reg-email").value;
    const password = document.getElementById("reg-password").value;
    const areaCode = document.getElementById("reg-area").value;
    try {
      currentUser = registerUser({ name, email, password, areaCode });
      e.target.reset();
      goToPostLoginView();
    } catch (err) {
      showError("register-error", err.message);
    }
  });

  // Check-in form
  document.getElementById("checkin-form").addEventListener("submit", (e) => {
    e.preventDefault();
    hideError("checkin-error");
    const temperatureC = parseFloat(document.getElementById("ci-temp").value);
    const heartRateBpm = parseInt(document.getElementById("ci-hr").value, 10);
    const sys = document.getElementById("ci-sys").value;
    const dia = document.getElementById("ci-dia").value;
    const spo2 = document.getElementById("ci-spo2").value;
    const notes = document.getElementById("ci-notes").value;

    if (Number.isNaN(temperatureC) || Number.isNaN(heartRateBpm)) {
      showError("checkin-error", "Temperature and heart rate are required.");
      return;
    }

    addHealthRecord(currentUser.id, {
      temperatureC,
      heartRateBpm,
      systolicBp: sys ? parseInt(sys, 10) : null,
      diastolicBp: dia ? parseInt(dia, 10) : null,
      spo2Percent: spo2 ? parseInt(spo2, 10) : null,
      notes,
    });

    e.target.reset();
    showView("citizen-dashboard");
  });

  // Symptom severity slider live value
  document.getElementById("sym-severity").addEventListener("input", (e) => {
    document.getElementById("severity-value").textContent = e.target.value;
  });

  // Symptoms form
  document.getElementById("symptoms-form").addEventListener("submit", (e) => {
    e.preventDefault();
    hideError("symptoms-error");
    if (selectedSymptoms.length === 0) {
      showError("symptoms-error", "Select at least one symptom.");
      return;
    }
    const severity = parseInt(document.getElementById("sym-severity").value, 10);
    const notes = document.getElementById("sym-notes").value;

    addSymptomReport(currentUser.id, { symptoms: [...selectedSymptoms], severity, notes });

    e.target.reset();
    showView("citizen-dashboard");
  });

  showView("login");
});
