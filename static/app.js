(function () {
  const state = {
    me: null,
    canEdit: true,
    viewedUser: null,
    settings: {},
    view: null,
    adminUsers: [],
    adminFilter: "all",
    activeScreen: "screen-turni",
    vacationYear: new Date().getFullYear(),
    vacations: null,
    settingsDirty: false,
    settingsFocused: false,
    editingEntryDate: null,
    refreshInFlight: false,
    lastRefreshAt: 0,
  };

  const els = {
    body: document.body,
    authGate: document.getElementById("auth-gate"),
    pendingGate: document.getElementById("pending-gate"),
    appMain: document.getElementById("app-main"),
    googleSignin: document.getElementById("google-signin"),
    devName: document.getElementById("dev-name"),
    devEmail: document.getElementById("dev-email"),
    devLogin: document.getElementById("dev-login"),
    pendingLogout: document.getElementById("pending-logout"),
    monthInput: document.getElementById("mese-selector"),
    monthPrev: document.getElementById("month-prev"),
    monthNext: document.getElementById("month-next"),
    monthLabel: document.getElementById("month-label"),
    helloUser: document.getElementById("hello-user"),
    readonlyBanner: document.getElementById("readonly-banner"),
    backToMine: document.getElementById("back-to-mine"),
    metricTotalEur: document.getElementById("metric-total-eur"),
    metricTotalHours: document.getElementById("metric-total-hours"),
    metricTotalShifts: document.getElementById("metric-total-shifts"),
    shiftList: document.getElementById("shift-list"),
    fabAdd: document.getElementById("fab-add-turno"),
    shiftModal: document.getElementById("shift-modal"),
    modalClose: document.getElementById("modal-close"),
    shiftDate: document.getElementById("shift-date"),
    shiftStart: document.getElementById("shift-start"),
    shiftEnd: document.getElementById("shift-end"),
    flagFestivo: document.getElementById("flag-festivo"),
    flagFestivoGoduto: document.getElementById("flag-festivo-goduto"),
    flagFerie: document.getElementById("flag-ferie"),
    flagMalattia: document.getElementById("flag-malattia"),
    addShift: document.getElementById("add-shift"),
    editLabel: document.getElementById("edit-label"),
    shiftModalTitle: document.getElementById("shift-modal-title"),
    settingsSections: document.getElementById("settings-sections"),
    saveSettings: document.getElementById("save-settings"),
    adminNavBtn: document.getElementById("admin-nav-btn"),
    bottomNav: document.querySelector(".bottom-nav"),
    adminTotal: document.getElementById("admin-total"),
    adminPending: document.getElementById("admin-pending"),
    adminApproved: document.getElementById("admin-approved"),
    adminDenied: document.getElementById("admin-denied"),
    adminUsersList: document.getElementById("admin-users-list"),
    adminFilterButtons: Array.from(document.querySelectorAll("[data-admin-filter]")),
    profileTotalEur: document.getElementById("profile-total-eur"),
    profileTotalHours: document.getElementById("profile-total-hours"),
    profileTotalShifts: document.getElementById("profile-total-shifts"),
    profileOvertime: document.getElementById("profile-overtime"),
    profileBreakdown: document.getElementById("profile-breakdown"),
    vacationPrev: document.getElementById("vacation-prev"),
    vacationNext: document.getElementById("vacation-next"),
    vacationYearLabel: document.getElementById("vacation-year-label"),
    vacationTotalDays: document.getElementById("vacation-total-days"),
    vacationMonthsUsed: document.getElementById("vacation-months-used"),
    vacationMonths: document.getElementById("vacation-months"),
    vacationList: document.getElementById("vacation-list"),
    exportPdf: document.getElementById("export-pdf"),
    logoutProfile: document.getElementById("logout-btn-profile"),
    navButtons: Array.from(document.querySelectorAll(".nav-btn")),
    screens: Array.from(document.querySelectorAll(".screen")),
  };

  const googleClientId = (els.body.dataset.googleClientId || "").trim();
  const pwaAppName = (els.body.dataset.pwaAppName || "I Miei Turni").trim();
  const monthFormatter = new Intl.DateTimeFormat("it-IT", { month: "long", year: "numeric" });
  const euroFormatter = new Intl.NumberFormat("it-IT", { style: "currency", currency: "EUR" });
  const monthShortFormatter = new Intl.DateTimeFormat("it-IT", { month: "short" });
  const weekdayFormatter = new Intl.DateTimeFormat("it-IT", { weekday: "short" });

  function formatEur(num) {
    return euroFormatter.format(Number(num || 0));
  }

  function minutesToHoursLabel(mins) {
    return `${(Number(mins || 0) / 60).toFixed(1)}h`;
  }

  function escapeHtml(value) {
    return String(value || "")
      .replaceAll("&", "&amp;")
      .replaceAll("<", "&lt;")
      .replaceAll(">", "&gt;")
      .replaceAll('"', "&quot;")
      .replaceAll("'", "&#39;");
  }

  function safeDate(dateStr) {
    const dateObj = new Date(`${dateStr}T12:00:00`);
    return Number.isNaN(dateObj.getTime()) ? null : dateObj;
  }

  function formatShiftDateParts(dateStr) {
    const dateObj = safeDate(dateStr);
    if (!dateObj) {
      return { day: "--", month: "---", weekday: "" };
    }
    return {
      day: String(dateObj.getDate()).padStart(2, "0"),
      month: monthShortFormatter.format(dateObj).replace(".", "").toUpperCase(),
      weekday: weekdayFormatter.format(dateObj).replace(".", ""),
    };
  }

  function hhmmToCompactLabel(value) {
    const [hoursRaw, minutesRaw] = String(value || "").split(":");
    const hours = Number(hoursRaw || 0);
    const minutes = Number(minutesRaw || 0);
    if (!hours && !minutes) return "0h";
    if (!minutes) return `${hours}h`;
    return `${hours}h ${String(minutes).padStart(2, "0")}m`;
  }

  function buildShiftTitle(row, hasValue) {
    if (!hasValue) return "Giornata libera";
    const raw = String(row.desc_display || "").trim();
    if (!raw || raw === "-") return "Turno lavorato";
    if (raw === "Lavorato") return "Turno lavorato";
    return raw.replace("(+Goduto)", "+ goduto");
  }

  function buildShiftMeta(row, hasValue) {
    const start = row.start_display || "-";
    const end = row.end_display || "-";
    const entry = row.entry || {};
    if (start !== "-" && end !== "-") {
      return `${start} -> ${end}`;
    }
    if (entry.ferie) return "Assenza retribuita";
    if (entry.malattia) return "Giornata di malattia";
    if (entry.festivo_goduto && !entry.festivo) return "Recupero festivo";
    return hasValue ? "Valore giornaliero applicato" : (state.canEdit ? "Tocca per inserire un turno" : "Nessun turno inserito");
  }

  function buildShiftHours(row, hasValue) {
    if (row.hours_display && row.hours_display !== "-") {
      return `${hhmmToCompactLabel(row.hours_display)} lavorate`;
    }
    return hasValue ? "Compenso giornaliero calcolato" : "Nessuna attivita registrata";
  }

  function iconMarkup(name) {
    const icons = {
      trash: '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M4 7h16"/><path d="M9 7V4h6v3"/><path d="M7 7l1 12h8l1-12"/><path d="M10 11v5"/><path d="M14 11v5"/></svg>',
    };
    return icons[name] || "";
  }

  async function api(url, options = {}) {
    const fetchOptions = { ...options, cache: "no-store" };
    const response = await fetch(url, fetchOptions);
    let data = null;
    try {
      data = await response.json();
    } catch (_err) {
      data = null;
    }
    if (!response.ok) {
      const err = new Error((data && data.message) || "Operazione non riuscita.");
      err.status = response.status;
      throw err;
    }
    return data;
  }

  function showGate(mode) {
    els.authGate.classList.toggle("hidden", mode !== "auth");
    els.pendingGate.classList.toggle("hidden", mode !== "pending");
    els.appMain.classList.toggle("hidden", mode !== "app");
  }

  function userIsAdmin() {
    return !!(state.me && state.me.role === "admin");
  }

  function getMonthYear() {
    const [y, m] = (els.monthInput.value || "").split("-");
    return { year: Number(y), month: Number(m) };
  }

  function setMonthYear(year, month) {
    const paddedMonth = String(month).padStart(2, "0");
    els.monthInput.value = `${year}-${paddedMonth}`;
    els.monthLabel.textContent = monthFormatter.format(new Date(year, month - 1, 1));
  }

  function shiftMonth(step) {
    const { year, month } = getMonthYear();
    const dateObj = new Date(year, month - 1, 1);
    dateObj.setMonth(dateObj.getMonth() + step);
    setMonthYear(dateObj.getFullYear(), dateObj.getMonth() + 1);
    refreshState();
  }

  function setEditable(editable) {
    [
      els.fabAdd,
      els.addShift,
      els.flagFestivo,
      els.flagFestivoGoduto,
      els.flagFerie,
      els.flagMalattia,
      els.shiftDate,
      els.shiftStart,
      els.shiftEnd,
      els.saveSettings,
    ].forEach((el) => {
      if (el) {
        el.disabled = !editable;
      }
    });
  }

  function applyStatePayload(data) {
    state.canEdit = Boolean(data.can_edit);
    state.settings = data.settings || {};
    state.view = data.view || { rows: [] };
    state.viewedUser = data.viewing_email || (state.me && state.me.email) || null;
  }

  function setActiveScreen(screenId) {
    state.activeScreen = screenId;
    els.screens.forEach((screen) => screen.classList.toggle("active", screen.id === screenId));
    els.navButtons.forEach((button) => button.classList.toggle("active", button.dataset.screen === screenId));
  }

  function clearShiftForm() {
    state.editingEntryDate = null;
    els.shiftDate.value = els.body.dataset.today || "";
    els.shiftStart.value = "06:00";
    els.shiftEnd.value = "14:00";
    els.flagFestivo.checked = false;
    els.flagFestivoGoduto.checked = false;
    els.flagFestivoGoduto.disabled = false;
    els.flagFerie.checked = false;
    els.flagMalattia.checked = false;
    els.shiftModalTitle.textContent = "Nuovo Turno";
    els.addShift.textContent = "Salva Turno";
    els.editLabel.textContent = "Compila i campi e salva.";
    syncShiftFlags();
  }

  function openShiftModal() {
    if (!state.canEdit) return;
    els.shiftModal.classList.remove("hidden");
  }

  function closeShiftModal() {
    els.shiftModal.classList.add("hidden");
  }

  function syncShiftFlags() {
    if (els.flagFestivo.checked) {
      els.flagFerie.checked = false;
      els.flagMalattia.checked = false;
    }

    if (els.flagFestivoGoduto.checked && !els.flagFestivo.checked) {
      els.flagFerie.checked = false;
      els.flagMalattia.checked = false;
    }

    if (els.flagFerie.checked) {
      els.flagFestivo.checked = false;
      els.flagFestivoGoduto.checked = false;
      els.flagMalattia.checked = false;
    }

    if (els.flagMalattia.checked) {
      els.flagFestivo.checked = false;
      els.flagFestivoGoduto.checked = false;
      els.flagFerie.checked = false;
    }
  }

  function getEntryRows() {
    return ((state.view && state.view.rows) || []).filter((row) => row.type === "entry");
  }

  function computeMonthMetrics() {
    let totalEur = 0;
    let totalMinutes = 0;
    let compiled = 0;
    let overtime = 0;
    const breakdown = {};

    getEntryRows().forEach((row) => {
      const entry = row.entry || {};
      const total = Number(entry.total || 0);
      const details = entry.detail_minutes || {};
      const rowMinutes = Object.values(details).reduce((sum, value) => sum + Number(value || 0), 0);
      totalEur += total;
      totalMinutes += rowMinutes;
      if (total > 0 || row.start_display !== "-") {
        compiled += 1;
      }
      overtime += Number(details.OT_GIORNO || 0) + Number(details.OT_NOTTE || 0);
      Object.keys(details).forEach((key) => {
        breakdown[key] = (breakdown[key] || 0) + Number(details[key] || 0);
      });
    });

    return { totalEur, totalMinutes, compiled, overtime, breakdown };
  }

  function renderReadonlyInfo() {
    const viewingOtherUser = userIsAdmin() && state.me && state.viewedUser && state.viewedUser !== state.me.email;
    if (viewingOtherUser) {
      els.readonlyBanner.classList.remove("hidden");
      els.backToMine.classList.remove("hidden");
      els.readonlyBanner.textContent = `Modalita admin: stai solo visualizzando i dati di ${state.viewedUser}.`;
      return;
    }
    els.readonlyBanner.classList.add("hidden");
    els.backToMine.classList.add("hidden");
  }

  function renderTurniSummaryCards() {
    const metrics = computeMonthMetrics();
    els.metricTotalEur.textContent = formatEur(metrics.totalEur);
    els.metricTotalHours.textContent = minutesToHoursLabel(metrics.totalMinutes);
    els.metricTotalShifts.textContent = String(metrics.compiled);
  }

  function renderShiftList() {
    const rows = getEntryRows();
    els.shiftList.innerHTML = "";

    if (!rows.length) {
      els.shiftList.innerHTML = "<div class='empty-state'>Nessun turno nel mese selezionato.</div>";
      return;
    }

    rows.forEach((row) => {
      const date = row.date || "";
      const hasValue = row.entry && (row.entry.desc || row.entry.start || row.entry.end || Number(row.entry.total || 0) > 0);
      const canDelete = state.canEdit && hasValue;
      const dateParts = formatShiftDateParts(date);
      const title = buildShiftTitle(row, hasValue);
      const meta = buildShiftMeta(row, hasValue);
      const hours = buildShiftHours(row, hasValue);
      const totalText = hasValue ? formatEur(row.entry.total || 0) : "—";

      const card = document.createElement("article");
      card.className = `shift-card ${hasValue ? "has-entry" : "is-empty"}`;
      card.dataset.rowDate = date;
      card.innerHTML = `
        <div class="shift-date-block">
          <div class="shift-day">${escapeHtml(dateParts.day)}</div>
          <div class="shift-month">${escapeHtml(dateParts.month)}</div>
          <div class="shift-weekday">${escapeHtml(dateParts.weekday)}</div>
        </div>
        <div class="shift-main">
          <div class="shift-title">${escapeHtml(title)}</div>
          <div class="shift-meta">${escapeHtml(meta)}</div>
          <div class="shift-hours">${escapeHtml(hours)}</div>
        </div>
        <div class="shift-side">
          <div class="shift-total">${escapeHtml(totalText)}</div>
          ${canDelete ? `<div class="shift-actions"><button class="trash-btn" title="Elimina turno" data-delete-date="${escapeHtml(date)}">${iconMarkup("trash")}</button></div>` : "" }
        </div>
      `;
      els.shiftList.appendChild(card);
    });
  }

  function renderSettings() {
    const groups = [
      {
        title: "Tariffe Base",
        fields: [
          ["BASE_GIORNO", "Giorno (06-22)"],
          ["BASE_NOTTE", "Notte (22-06)"],
        ],
      },
      {
        title: "Straordinario",
        fields: [
          ["OT_GIORNO", "Straord. Giorno"],
          ["OT_NOTTE", "Straord. Notte"],
          ["SOGLIA_STRAORDINARIO", "Soglia Straord. (ore)"],
        ],
      },
      {
        title: "Sabato",
        fields: [
          ["SABATO_GIORNO", "Sabato Giorno"],
          ["SABATO_NOTTE", "Sabato Notte"],
        ],
      },
      {
        title: "Festivi e Assenze",
        fields: [
          ["FESTIVO_GIORNALIERO", "Festivo Giorno"],
          ["FESTIVO_NOTTURNO", "Festivo Notte"],
          ["FESTIVO_GODUTO", "Festivo Goduto"],
          ["FERIE", "Ferie"],
          ["MALATTIA", "Malattia"],
        ],
      },
    ];

    els.settingsSections.innerHTML = "";
    groups.forEach((group) => {
      const card = document.createElement("div");
      card.className = "setting-card";
      card.innerHTML = `
        <h3>${escapeHtml(group.title)}</h3>
        ${group.fields.map(([key, label]) => `
          <div class="setting-row">
            <label>${escapeHtml(label)}</label>
            <input type="number" step="0.01" data-setting-key="${escapeHtml(key)}" value="${Number(state.settings[key] || 0)}" ${state.canEdit ? "" : "disabled"}>
          </div>
        `).join("")}
      `;
      els.settingsSections.appendChild(card);
    });
  }

  function renderProfile() {
    const metrics = computeMonthMetrics();
    els.profileTotalEur.textContent = formatEur(metrics.totalEur);
    els.profileTotalHours.textContent = minutesToHoursLabel(metrics.totalMinutes);
    els.profileTotalShifts.textContent = String(metrics.compiled);
    els.profileOvertime.textContent = minutesToHoursLabel(metrics.overtime);

    const keys = Object.keys(metrics.breakdown).sort();
    els.profileBreakdown.innerHTML = keys.length
      ? keys.map((key) => `<div class="breakdown-item"><span>${escapeHtml(key)}</span><strong>${escapeHtml(minutesToHoursLabel(metrics.breakdown[key]))}</strong></div>`).join("")
      : "<div class='empty-state'>Nessun dettaglio ore.</div>";
  }

  function renderVacations() {
    const data = state.vacations || { total_days: 0, months_used: 0, months: [], days: [] };
    els.vacationYearLabel.textContent = String(state.vacationYear);
    els.vacationTotalDays.textContent = String(data.total_days || 0);
    els.vacationMonthsUsed.textContent = String(data.months_used || 0);

    els.vacationMonths.innerHTML = (data.months || [])
      .map((month) => {
        const active = Number(month.count || 0) > 0 ? "active" : "";
        return `
          <article class="vacation-month ${active}">
            <span>${escapeHtml(month.month_name)}</span>
            <strong>${escapeHtml(String(month.count || 0))}</strong>
          </article>
        `;
      })
      .join("");

    const days = data.days || [];
    els.vacationList.innerHTML = days.length
      ? days.map((day) => `
        <article class="vacation-day">
          <div>
            <strong>${escapeHtml(day.display_date)}</strong>
            <span>${escapeHtml(day.month_name)}</span>
          </div>
          <span>${formatEur(Number(day.total_display || 0))}</span>
        </article>
      `).join("")
      : "<div class='empty-state'>Nessuna ferie segnata per questo anno.</div>";
  }

  function renderAdminStatsAndList() {
    if (!userIsAdmin()) {
      els.adminUsersList.innerHTML = "<div class='empty-state'>Solo admin.</div>";
      return;
    }

    const users = state.adminUsers || [];
    const pending = users.filter((user) => !user.approved).length;
    const approved = users.filter((user) => user.approved).length;
    const admins = users.filter((user) => user.role === "admin").length;

    els.adminTotal.textContent = String(users.length);
    els.adminPending.textContent = String(pending);
    els.adminApproved.textContent = String(approved);
    els.adminDenied.textContent = String(admins);

    let filtered = users;
    if (state.adminFilter === "pending") filtered = users.filter((user) => !user.approved);
    if (state.adminFilter === "approved") filtered = users.filter((user) => user.approved);

    if (!filtered.length) {
      els.adminUsersList.innerHTML = "<div class='empty-state'>Nessun utente.</div>";
      return;
    }

    els.adminUsersList.innerHTML = "";
    filtered.forEach((user) => {
      const isSelf = state.me && user.email === state.me.email;
      const badgeClass = user.role === "admin" ? "admin" : user.approved ? "ok" : "pending";
      const badgeText = user.role === "admin" ? "ADMIN" : user.approved ? "APPROVATO" : "IN ATTESA";

      const card = document.createElement("article");
      card.className = "user-card";
      card.innerHTML = `
        <div class="user-top">
          <h4 class="user-name">${escapeHtml(user.name || user.email)}</h4>
          <span class="badge ${badgeClass}">${badgeText}</span>
        </div>
        <div class="user-mail">${escapeHtml(user.email)}</div>
        <div class="user-meta">Registrato: ${escapeHtml(user.created_at || "-")} | Turni: ${escapeHtml(String(user.compiled_days || 0))}</div>
        <div class="user-actions"></div>
      `;
      const actions = card.querySelector(".user-actions");

      const viewButton = document.createElement("button");
      viewButton.className = "btn secondary";
      viewButton.textContent = "Visualizza";
      viewButton.addEventListener("click", async () => {
        state.viewedUser = user.email;
        setActiveScreen("screen-turni");
        await refreshState();
      });
      actions.appendChild(viewButton);

      if (!isSelf) {
        const approvalButton = document.createElement("button");
        approvalButton.className = user.approved ? "btn secondary" : "btn primary";
        approvalButton.textContent = user.approved ? "Revoca" : "Approva";
        approvalButton.addEventListener("click", async () => {
          try {
            await api(`/api/admin/users/${encodeURIComponent(user.email)}/approval`, {
              method: "POST",
              headers: { "Content-Type": "application/json" },
              body: JSON.stringify({ approved: !user.approved }),
            });
            await refreshAdminUsers();
          } catch (err) {
            alert(err.message);
          }
        });
        actions.appendChild(approvalButton);

        const deleteButton = document.createElement("button");
        deleteButton.className = "btn danger";
        deleteButton.textContent = "Elimina";
        deleteButton.addEventListener("click", async () => {
          if (!confirm(`Eliminare definitivamente l'utente ${user.email}?`)) return;
          try {
            await api(`/api/admin/users/${encodeURIComponent(user.email)}`, { method: "DELETE" });
            if (state.viewedUser === user.email && state.me) {
              state.viewedUser = state.me.email;
            }
            await refreshAdminUsers();
            await refreshState();
          } catch (err) {
            alert(err.message);
          }
        });
        actions.appendChild(deleteButton);
      }

      els.adminUsersList.appendChild(card);
    });
  }

  function renderStatePayload() {
    renderReadonlyInfo();
    setEditable(state.canEdit);
    renderShiftList();
    renderTurniSummaryCards();
    if (!(state.activeScreen === "screen-paghe" && (state.settingsDirty || state.settingsFocused))) {
      renderSettings();
    }
    renderProfile();
  }

  async function refreshAdminUsers() {
    if (!userIsAdmin()) return;
    const data = await api("/api/admin/users");
    state.adminUsers = data.users || [];
    renderAdminStatsAndList();
  }

  async function refreshMe() {
    const meData = await api("/api/me");
    if (!meData.logged_in || !meData.user) {
      state.me = null;
      state.viewedUser = null;
      showGate("auth");
      return;
    }
    state.me = meData.user;
    if (!state.me.approved) {
      showGate("pending");
      return;
    }
    showGate("app");
    els.helloUser.textContent = `Ciao, ${state.me.name || "utente"}`;
    els.adminNavBtn.classList.toggle("hidden", !userIsAdmin());
    els.bottomNav.classList.toggle("three", !userIsAdmin());
    if (!state.viewedUser) {
      state.viewedUser = state.me.email;
    }
  }

  async function refreshState() {
    const { year, month } = getMonthYear();
    const params = new URLSearchParams({ year: String(year), month: String(month) });
    if (userIsAdmin() && state.viewedUser && state.me && state.viewedUser !== state.me.email) {
      params.set("view_user", state.viewedUser);
    }
    const data = await api(`/api/state?${params.toString()}`);
    applyStatePayload(data);
    renderStatePayload();
    if (userIsAdmin()) {
      await refreshAdminUsers();
    }
  }

  async function guardedRefresh() {
    if (state.refreshInFlight || !state.me || !state.me.approved) return;
    if (document.hidden) return;
    if (state.settingsDirty || state.settingsFocused) return;
    if (els.shiftModal && !els.shiftModal.classList.contains("hidden")) return;
    if (Date.now() - state.lastRefreshAt < 5000) return;

    state.refreshInFlight = true;
    try {
      await refreshMe();
      if (state.me && state.me.approved) {
        await refreshState();
      }
      state.lastRefreshAt = Date.now();
    } catch (_err) {
    } finally {
      state.refreshInFlight = false;
    }
  }

  async function logout() {
    if (window.google && window.google.accounts && window.google.accounts.id) {
      window.google.accounts.id.disableAutoSelect();
    }
    await api("/auth/logout", { method: "POST" });
    state.me = null;
    state.viewedUser = null;
    showGate("auth");
  }

  async function addShift() {
    if (!state.canEdit) return;
    const payload = {
      date: els.shiftDate.value,
      start: els.shiftStart.value,
      end: els.shiftEnd.value,
      festivo: els.flagFestivo.checked,
      festivo_goduto: els.flagFestivoGoduto.checked,
      ferie: els.flagFerie.checked,
      malattia: els.flagMalattia.checked,
    };
    if (state.editingEntryDate) {
      payload.original_date = state.editingEntryDate;
    }
    await api("/api/entry", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(payload),
    });
    closeShiftModal();
    clearShiftForm();
    await refreshState();
  }

  async function deleteShift(dateStr) {
    if (!state.canEdit || !dateStr) return;
    if (!confirm(`Eliminare il turno del ${dateStr}?`)) return;
    await api(`/api/entry/${encodeURIComponent(dateStr)}`, { method: "DELETE" });
    await refreshState();
  }

  async function saveSettings() {
    if (!state.canEdit) return;
    const nextSettings = {};
    els.settingsSections.querySelectorAll("[data-setting-key]").forEach((input) => {
      nextSettings[input.dataset.settingKey] = Number(input.value);
    });
    await api("/api/settings", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ settings: nextSettings }),
    });
    state.settingsDirty = false;
    await refreshState();
    alert("Impostazioni salvate.");
  }

  function findEntryRow(dateStr) {
    return getEntryRows().find((row) => row.date === dateStr) || null;
  }

  function openEditShift(dateStr) {
    const row = findEntryRow(dateStr);
    if (!row || !row.entry || !state.canEdit) return;
    const entry = row.entry;
    state.editingEntryDate = dateStr;
    els.shiftModalTitle.textContent = "Modifica Turno";
    els.addShift.textContent = "Salva Modifiche";
    els.shiftDate.value = entry.date || dateStr;
    els.shiftStart.value = entry.start || "06:00";
    els.shiftEnd.value = entry.end || "14:00";
    els.flagFestivo.checked = Boolean(entry.festivo);
    els.flagFestivoGoduto.checked = Boolean(entry.festivo_goduto);
    els.flagFestivoGoduto.disabled = false;
    els.flagFerie.checked = Boolean(entry.ferie);
    els.flagMalattia.checked = Boolean(entry.malattia);
    els.editLabel.textContent = `Modifica il turno del ${dateStr} e salva.`;
    syncShiftFlags();
    openShiftModal();
  }

  function initGoogleSignIn() {
    if (!googleClientId || !els.googleSignin) return;
    const waitGoogle = () => {
      if (!window.google || !window.google.accounts || !window.google.accounts.id) {
        setTimeout(waitGoogle, 200);
        return;
      }
      window.google.accounts.id.initialize({
        client_id: googleClientId,
        callback: async (response) => {
          try {
            await api("/auth/google", {
              method: "POST",
              headers: { "Content-Type": "application/json" },
              body: JSON.stringify({ credential: response.credential }),
            });
            await refreshMe();
            if (state.me && state.me.approved) {
              await refreshState();
            }
          } catch (err) {
            alert(err.message);
          }
        },
      });
      window.google.accounts.id.renderButton(els.googleSignin, {
        theme: "outline",
        size: "large",
        shape: "pill",
        text: "continue_with",
      });
    };
    waitGoogle();
  }

  function bindEvents() {
    els.navButtons.forEach((button) => {
      button.addEventListener("click", () => setActiveScreen(button.dataset.screen));
    });

    els.monthPrev.addEventListener("click", () => shiftMonth(-1));
    els.monthNext.addEventListener("click", () => shiftMonth(1));

    els.fabAdd.addEventListener("click", () => {
      clearShiftForm();
      openShiftModal();
    });

    els.modalClose.addEventListener("click", closeShiftModal);
    els.shiftModal.addEventListener("click", (event) => {
      if (event.target === els.shiftModal) {
        closeShiftModal();
      }
    });

    els.addShift.addEventListener("click", async () => {
      try {
        await addShift();
      } catch (err) {
        alert(err.message);
      }
    });

    els.shiftList.addEventListener("click", async (event) => {
      const deleteButton = event.target.closest("[data-delete-date]");
      if (deleteButton) {
        try {
          await deleteShift(deleteButton.dataset.deleteDate);
        } catch (err) {
          alert(err.message);
        }
        return;
      }

      const card = event.target.closest(".shift-card");
      if (!card || !state.canEdit) return;
      const row = findEntryRow(card.dataset.rowDate);
      if (!row || !row.entry) return;

      const hasValue = row.entry.desc || row.entry.start || row.entry.end || Number(row.entry.total || 0) > 0;
      if (hasValue) {
        openEditShift(row.date);
      } else {
        clearShiftForm();
        els.shiftDate.value = row.date;
        openShiftModal();
      }
    });

    els.saveSettings.addEventListener("click", async () => {
      try {
        await saveSettings();
      } catch (err) {
        alert(err.message);
      }
    });

    els.settingsSections.addEventListener("input", () => {
      state.settingsDirty = true;
    });
    els.settingsSections.addEventListener("focusin", () => {
      state.settingsFocused = true;
    });
    els.settingsSections.addEventListener("focusout", () => {
      setTimeout(() => {
        state.settingsFocused = !!document.activeElement.closest("#settings-sections");
      }, 0);
    });

    els.adminFilterButtons.forEach((button) => {
      button.addEventListener("click", () => {
        state.adminFilter = button.dataset.adminFilter;
        els.adminFilterButtons.forEach((item) => item.classList.toggle("active", item === button));
        renderAdminStatsAndList();
      });
    });

    els.backToMine.addEventListener("click", async () => {
      if (!state.me) return;
      state.viewedUser = state.me.email;
      await refreshState();
    });

    [els.flagFestivo, els.flagFestivoGoduto, els.flagFerie, els.flagMalattia].forEach((checkbox) => {
      checkbox.addEventListener("change", syncShiftFlags);
    });

    const doLogout = async () => {
      try {
        await logout();
      } catch (err) {
        alert(err.message);
      }
    };

    els.logoutProfile.addEventListener("click", doLogout);
    if (els.pendingLogout) {
      els.pendingLogout.addEventListener("click", doLogout);
    }

    if (els.devLogin) {
      els.devLogin.addEventListener("click", async () => {
        try {
          await api("/auth/dev-login", {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({
              email: (els.devEmail && els.devEmail.value) || "",
              name: (els.devName && els.devName.value) || "",
            }),
          });
          await refreshMe();
          if (state.me && state.me.approved) {
            await refreshState();
          }
        } catch (err) {
          alert(err.message);
        }
      });
    }

    els.exportPdf.addEventListener("click", () => {
      const { year, month } = getMonthYear();
      const params = new URLSearchParams({ year: String(year), month: String(month), print: "1" });
      if (userIsAdmin() && state.viewedUser && state.me && state.viewedUser !== state.me.email) {
        params.set("view_user", state.viewedUser);
      }
      window.open(`/api/export-month-html?${params.toString()}`, "_blank");
    });
  }

  function registerServiceWorker() {
    if (!("serviceWorker" in navigator)) return;
    window.addEventListener("load", () => {
      navigator.serviceWorker.register("/service-worker.js").catch(() => {});
    });
  }

  function registerSoftRefresh() {
    document.addEventListener("visibilitychange", () => {
      if (!document.hidden) {
        guardedRefresh();
      }
    });
    window.addEventListener("focus", guardedRefresh);
  }

  async function boot() {
    document.title = pwaAppName;
    els.shiftDate.value = els.body.dataset.today || "";
    syncShiftFlags();

    const monthValue = els.body.dataset.month || "";
    els.monthInput.value = monthValue;
    const { year, month } = getMonthYear();
    if (year && month) {
      setMonthYear(year, month);
    }

    bindEvents();
    initGoogleSignIn();
    registerServiceWorker();
    registerSoftRefresh();

    try {
      await refreshMe();
      if (state.me && state.me.approved) {
        await refreshState();
      }
    } catch (err) {
      alert(err.message);
    }
  }

  boot();
})();
