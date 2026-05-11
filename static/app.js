(function () {
  const state = {
    me: null,
    canEdit: true,
    viewedUser: null,
    quickShifts: [],
    settings: {},
    view: null,
    adminUsers: [],
    adminFilter: "all",
    activeScreen: "screen-turni",
    settingsDirty: false,
    settingsFocused: false,
    editingEntryDate: null,
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
    exportPdf: document.getElementById("export-pdf"),
    logoutProfile: document.getElementById("logout-btn-profile"),

    navButtons: Array.from(document.querySelectorAll(".nav-btn")),
    screens: Array.from(document.querySelectorAll(".screen")),
  };

  const googleClientId = (els.body.dataset.googleClientId || "").trim();
  const pwaAppName = (els.body.dataset.pwaAppName || "I Miei Turni").trim();
  const monthFormatter = new Intl.DateTimeFormat("it-IT", { month: "long", year: "numeric" });
  const localDB = window.sdaLocalDB || null;
  let syncInFlight = false;

  function formatEur(num) {
    return `€${Number(num || 0).toFixed(2)}`;
  }

  function minutesToHoursLabel(mins) {
    const safe = Number(mins || 0);
    return `${(safe / 60).toFixed(1)}h`;
  }

  function escapeHtml(value) {
    return String(value || "")
      .replaceAll("&", "&amp;")
      .replaceAll("<", "&lt;")
      .replaceAll(">", "&gt;")
      .replaceAll('"', "&quot;")
      .replaceAll("'", "&#39;");
  }

  function meCacheKey() {
    return "me";
  }

  function stateCacheKey(viewingEmail, year, month) {
    return `state:${viewingEmail || "guest"}:${year}-${String(month).padStart(2, "0")}`;
  }

  async function localGet(key) {
    if (!localDB) return null;
    try {
      return await localDB.get(key);
    } catch (_err) {
      return null;
    }
  }

  async function localSet(key, value) {
    if (!localDB) return;
    try {
      await localDB.set(key, value);
    } catch (_err) {
    }
  }

  async function enqueueMutation(item) {
    if (!localDB) return;
    try {
      await localDB.addQueue(item);
    } catch (_err) {
    }
  }

  async function api(url, options = {}) {
    const fetchOptions = { ...options };
    if (!fetchOptions.method || fetchOptions.method.toUpperCase() === "GET") {
      fetchOptions.cache = "no-store";
    }
    const response = await fetch(url, fetchOptions);
    let data = null;
    try {
      data = await response.json();
    } catch (_e) {
      data = null;
    }
    if (!response.ok) {
      const err = new Error((data && data.message) || "Operazione non riuscita.");
      err.payload = data;
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
    const m = String(month).padStart(2, "0");
    els.monthInput.value = `${year}-${m}`;
    els.monthLabel.textContent = monthFormatter.format(new Date(year, month - 1, 1));
  }

  function shiftMonth(step) {
    const { year, month } = getMonthYear();
    const d = new Date(year, month - 1, 1);
    d.setMonth(d.getMonth() + step);
    setMonthYear(d.getFullYear(), d.getMonth() + 1);
    refreshState();
  }

  function setEditable(editable) {
    const list = [
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
    ];
    list.forEach((el) => {
      if (el) el.disabled = !editable;
    });
  }

  function applyStatePayload(data) {
    state.canEdit = Boolean(data.can_edit);
    state.quickShifts = data.quick_shifts || [];
    state.settings = data.settings || {};
    state.view = data.view || { rows: [] };
    state.viewedUser = data.viewing_email || (state.me && state.me.email) || null;
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

  function setActiveScreen(screenId) {
    state.activeScreen = screenId;
    els.screens.forEach((s) => s.classList.toggle("active", s.id === screenId));
    els.navButtons.forEach((b) => b.classList.toggle("active", b.dataset.screen === screenId));
  }

  function openShiftModal() {
    if (!state.canEdit) return;
    els.shiftModal.classList.remove("hidden");
  }

  function closeShiftModal() {
    els.shiftModal.classList.add("hidden");
  }

  function clearShiftForm() {
    state.editingEntryDate = null;
    els.shiftDate.value = els.body.dataset.today || "";
    els.shiftStart.value = "06:00";
    els.shiftEnd.value = "14:00";
    els.flagFestivo.checked = false;
    els.flagFestivoGoduto.checked = false;
    els.flagFerie.checked = false;
    els.flagMalattia.checked = false;
    if (els.shiftModalTitle) els.shiftModalTitle.textContent = "Nuovo Turno";
    if (els.addShift) els.addShift.textContent = "Salva Turno";
    els.editLabel.textContent = "Compila i campi e salva.";
    syncShiftFlags();
  }

  function syncShiftFlags() {
    if (els.flagFestivo.checked) {
      els.flagFestivoGoduto.checked = true;
      els.flagFestivoGoduto.disabled = true;
      els.flagFerie.checked = false;
      els.flagMalattia.checked = false;
    } else {
      els.flagFestivoGoduto.disabled = false;
    }

    if (els.flagFestivoGoduto.checked && !els.flagFestivo.checked) {
      els.flagFerie.checked = false;
      els.flagMalattia.checked = false;
    }

    if (els.flagFerie.checked) {
      els.flagFestivo.checked = false;
      els.flagFestivoGoduto.checked = false;
      els.flagFestivoGoduto.disabled = false;
      els.flagMalattia.checked = false;
    }

    if (els.flagMalattia.checked) {
      els.flagFestivo.checked = false;
      els.flagFestivoGoduto.checked = false;
      els.flagFestivoGoduto.disabled = false;
      els.flagFerie.checked = false;
    }
  }

  function getEntryRows() {
    const rows = (state.view && state.view.rows) || [];
    return rows.filter((r) => r.type === "entry");
  }

  function computeMonthMetrics() {
    const rows = getEntryRows();
    let totalEur = 0;
    let totalMinutes = 0;
    let compiled = 0;
    let overtime = 0;
    const breakdown = {};

    rows.forEach((row) => {
      const entry = row.entry || {};
      const total = Number(entry.total || 0);
      totalEur += total;
      const details = entry.detail_minutes || {};
      const rowMinutes = Object.values(details).reduce((s, v) => s + Number(v || 0), 0);
      totalMinutes += rowMinutes;
      if (total > 0 || row.start_display !== "-") compiled += 1;
      overtime += Number(details.OT_GIORNO || 0) + Number(details.OT_NOTTE || 0);
      Object.keys(details).forEach((k) => {
        breakdown[k] = (breakdown[k] || 0) + Number(details[k] || 0);
      });
    });

    return { totalEur, totalMinutes, compiled, overtime, breakdown };
  }

  function renderReadonlyInfo() {
    const adminViewingOtherUser = userIsAdmin() && state.me && state.viewedUser && state.viewedUser !== state.me.email;
    if (adminViewingOtherUser) {
      els.readonlyBanner.classList.remove("hidden");
      els.backToMine.classList.remove("hidden");
      els.readonlyBanner.textContent = `Modalita admin: stai gestendo turni e paghe di ${state.viewedUser}.`;
      return;
    }
    if (state.canEdit) {
      els.readonlyBanner.classList.add("hidden");
      els.backToMine.classList.add("hidden");
      return;
    }
    els.readonlyBanner.classList.remove("hidden");
    els.backToMine.classList.remove("hidden");
    els.readonlyBanner.textContent = `Stai visualizzando i turni di ${state.viewedUser} in sola lettura.`;
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
      const totalText = row.total_display === "-" ? "€0.00" : `€${row.total_display}`;
      const detail = row.detail_display || row.desc_display || "-";
      const start = row.start_display || "-";
      const end = row.end_display || "-";
      const canDelete = state.canEdit && row.entry && !(
        !row.entry.desc &&
        !row.entry.start &&
        !row.entry.end &&
        Number(row.entry.total || 0) === 0 &&
        (!row.entry.detail || Object.keys(row.entry.detail).length === 0) &&
        (!row.entry.detail_minutes || Object.keys(row.entry.detail_minutes).length === 0)
      );
      const deleteMarkup = canDelete
        ? `<div class="shift-actions"><button class="trash-btn" title="Elimina turno" data-delete-date="${escapeHtml(date)}">&#128465;</button></div>`
        : "";

      const card = document.createElement("article");
      card.className = "shift-card";
      card.dataset.rowDate = date;
      card.innerHTML = `
        <div>
          <div class="shift-date">${escapeHtml(row.display_date || date)}</div>
          <div class="shift-time">${escapeHtml(start)}<br>${escapeHtml(end)}</div>
        </div>
        <div>
          <div class="shift-desc">${escapeHtml(detail)}</div>
          ${deleteMarkup}
        </div>
        <div class="shift-total">${escapeHtml(totalText)}</div>
      `;
      els.shiftList.appendChild(card);
    });
  }

  function findEntryRow(dateStr) {
    return getEntryRows().find((row) => row.date === dateStr) || null;
  }

  function openEditShift(dateStr) {
    const row = findEntryRow(dateStr);
    if (!row || !row.entry || !state.canEdit) return;
    const entry = row.entry;
    state.editingEntryDate = dateStr;
    if (els.shiftModalTitle) els.shiftModalTitle.textContent = "Modifica Turno";
    if (els.addShift) els.addShift.textContent = "Salva Modifiche";
    els.shiftDate.value = entry.date || dateStr;
    els.shiftStart.value = entry.start || "06:00";
    els.shiftEnd.value = entry.end || "14:00";
    els.flagFestivo.checked = Boolean(entry.festivo);
    els.flagFestivoGoduto.checked = Boolean(entry.festivo_goduto);
    els.flagFerie.checked = Boolean(entry.ferie);
    els.flagMalattia.checked = Boolean(entry.malattia);
    els.editLabel.textContent = `Modifica il turno del ${dateStr} e salva.`;
    syncShiftFlags();
    openShiftModal();
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
      const rows = group.fields
        .map(([key, label]) => {
          const v = Number(state.settings[key] || 0);
          return `<div class="setting-row"><label>${escapeHtml(label)}</label><input type="number" step="0.01" data-setting-key="${escapeHtml(key)}" value="${v}"></div>`;
        })
        .join("");
      card.innerHTML = `<h3>${escapeHtml(group.title)}</h3>${rows}`;
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
    if (!keys.length) {
      els.profileBreakdown.innerHTML = "<div class='empty-state'>Nessun dettaglio ore.</div>";
      return;
    }
    els.profileBreakdown.innerHTML = keys
      .map((k) => `<div class="breakdown-item"><span>${escapeHtml(k)}</span><strong>${escapeHtml(minutesToHoursLabel(metrics.breakdown[k]))}</strong></div>`)
      .join("");
  }

  function renderTurniSummaryCards() {
    const metrics = computeMonthMetrics();
    els.metricTotalEur.textContent = formatEur(metrics.totalEur);
    els.metricTotalHours.textContent = minutesToHoursLabel(metrics.totalMinutes);
    els.metricTotalShifts.textContent = String(metrics.compiled);
  }

  function renderAdminStatsAndList() {
    if (!userIsAdmin()) {
      els.adminUsersList.innerHTML = "<div class='empty-state'>Solo admin.</div>";
      return;
    }
    const users = state.adminUsers || [];
    const pending = users.filter((u) => !u.approved).length;
    const approved = users.filter((u) => u.approved).length;
    const denied = pending;

    els.adminTotal.textContent = String(users.length);
    els.adminPending.textContent = String(pending);
    els.adminApproved.textContent = String(approved);
    els.adminDenied.textContent = String(denied);

    let filtered = users;
    if (state.adminFilter === "pending") filtered = users.filter((u) => !u.approved);
    if (state.adminFilter === "approved") filtered = users.filter((u) => u.approved);
    if (state.adminFilter === "denied") filtered = users.filter((u) => !u.approved);

    if (!filtered.length) {
      els.adminUsersList.innerHTML = "<div class='empty-state'>Nessun utente.</div>";
      return;
    }

    els.adminUsersList.innerHTML = "";
    filtered.forEach((u) => {
      const isSelf = state.me && u.email === state.me.email;
      const badgeClass = u.role === "admin" ? "admin" : u.approved ? "ok" : "pending";
      const badgeText = u.role === "admin" ? "ADMIN" : u.approved ? "APPROVATO" : "IN ATTESA";

      const card = document.createElement("article");
      card.className = "user-card";
      card.innerHTML = `
        <div class="user-top">
          <h4 class="user-name">${escapeHtml(u.name || u.email)}</h4>
          <span class="badge ${badgeClass}">${badgeText}</span>
        </div>
        <div class="user-mail">${escapeHtml(u.email)}</div>
        <div class="user-meta">Registrato: ${escapeHtml(u.created_at || "-")} · Turni: ${escapeHtml(String(u.compiled_days || 0))}</div>
        <div class="user-actions"></div>
      `;
      const actions = card.querySelector(".user-actions");

      const viewBtn = document.createElement("button");
      viewBtn.className = "btn primary";
      viewBtn.textContent = "Apri";
      viewBtn.addEventListener("click", async () => {
        state.viewedUser = u.email;
        setActiveScreen("screen-turni");
        await refreshState();
      });
      actions.appendChild(viewBtn);

      if (!isSelf) {
        const toggleBtn = document.createElement("button");
        toggleBtn.className = u.approved ? "btn danger" : "btn secondary";
        toggleBtn.textContent = u.approved ? "Revoca" : "Approva";
        toggleBtn.addEventListener("click", async () => {
          try {
            await api(`/api/admin/users/${encodeURIComponent(u.email)}/approval`, {
              method: "POST",
              headers: { "Content-Type": "application/json" },
              body: JSON.stringify({ approved: !u.approved }),
            });
            await refreshAdminUsers();
          } catch (err) {
            alert(err.message);
          }
        });
        actions.appendChild(toggleBtn);

        const deleteBtn = document.createElement("button");
        deleteBtn.className = "btn danger";
        deleteBtn.textContent = "Elimina Utente";
        deleteBtn.addEventListener("click", async () => {
          if (!confirm(`Eliminare definitivamente l'utente ${u.email}?`)) return;
          try {
            await api(`/api/admin/users/${encodeURIComponent(u.email)}`, { method: "DELETE" });
            if (state.viewedUser === u.email && state.me) {
              state.viewedUser = state.me.email;
            }
            await refreshAdminUsers();
            await refreshState({ silent: true });
          } catch (err) {
            alert(err.message);
          }
        });
        actions.appendChild(deleteBtn);
      }

      els.adminUsersList.appendChild(card);
    });
  }

  async function refreshAdminUsers() {
    if (!userIsAdmin()) return;
    const data = await api("/api/admin/users");
    state.adminUsers = data.users || [];
    renderAdminStatsAndList();
  }

  async function refreshState(options = {}) {
    const { preferCache = false, silent = false } = options;
    const { year, month } = getMonthYear();
    const params = new URLSearchParams({ year: String(year), month: String(month) });
    if (userIsAdmin() && state.viewedUser && state.viewedUser !== state.me.email) {
      params.set("view_user", state.viewedUser);
    }
    const expectedViewing = params.get("view_user") || (state.me && state.me.email) || state.viewedUser;
    let hadCache = false;

    if (preferCache && expectedViewing) {
      const cached = await localGet(stateCacheKey(expectedViewing, year, month));
      if (cached) {
        applyStatePayload(cached);
        renderStatePayload();
        hadCache = true;
      }
    }

    try {
      const data = await api(`/api/state?${params.toString()}`);
      applyStatePayload(data);
      renderStatePayload();
      if (state.viewedUser) {
        await localSet(stateCacheKey(state.viewedUser, year, month), data);
      }
      if (userIsAdmin()) await refreshAdminUsers();
    } catch (err) {
      if (!hadCache || !silent) {
        throw err;
      }
    }
  }

  async function refreshMe(options = {}) {
    const { preferCache = false, silent = false } = options;
    let hadCache = false;

    if (preferCache) {
      const cachedMe = await localGet(meCacheKey());
      if (cachedMe && cachedMe.logged_in && cachedMe.user) {
        state.me = cachedMe.user;
        if (!state.me.approved) {
          showGate("pending");
        } else {
          showGate("app");
          els.helloUser.textContent = `Ciao, ${state.me.name || "utente"}`;
          els.adminNavBtn.classList.toggle("hidden", !userIsAdmin());
          els.bottomNav.classList.toggle("three", !userIsAdmin());
          if (!state.viewedUser) state.viewedUser = state.me.email;
        }
        hadCache = true;
      }
    }

    try {
      const meData = await api("/api/me");
      await localSet(meCacheKey(), meData);
      if (!meData.logged_in || !meData.user) {
        state.me = null;
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
      if (!state.viewedUser) state.viewedUser = state.me.email;
    } catch (err) {
      if (!hadCache || !silent) {
        throw err;
      }
    }
  }

  async function logout() {
    if (window.google && window.google.accounts && window.google.accounts.id) {
      window.google.accounts.id.disableAutoSelect();
    }
    await api("/auth/logout", { method: "POST" });
    await localSet(meCacheKey(), { ok: true, logged_in: false, user: null });
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
    if (userIsAdmin() && state.viewedUser && state.me && state.viewedUser !== state.me.email) {
      payload.view_user = state.viewedUser;
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

  async function applyLocalDelete(dateStr) {
    if (!state.view || !Array.isArray(state.view.rows)) return;
    const target = state.view.rows.find((row) => row.type === "entry" && row.date === dateStr);
    if (!target) return;

    target.start_display = "-";
    target.end_display = "-";
    target.hours_display = "-";
    target.desc_display = "Non lavorato";
    target.total_display = "-";
    target.detail_display = "-";
    target.entry = {
      date: dateStr,
      start: "",
      end: "",
      desc: "",
      total: 0,
      detail: {},
      detail_minutes: {},
      festivo: false,
      festivo_goduto: false,
      ferie: false,
      malattia: false,
    };

    renderStatePayload();

    const { year, month } = getMonthYear();
    if (state.viewedUser) {
      await localSet(
        stateCacheKey(state.viewedUser, year, month),
        {
          can_edit: state.canEdit,
          quick_shifts: state.quickShifts,
          settings: state.settings,
          view: state.view,
          viewing_email: state.viewedUser,
        }
      );
    }
  }

  async function deleteShift(dateStr) {
    if (!state.canEdit) return;
    if (!dateStr) return;
    if (!confirm(`Eliminare il turno del ${dateStr}?`)) return;
    await applyLocalDelete(dateStr);
    let url = `/api/entry/${encodeURIComponent(dateStr)}`;
    if (userIsAdmin() && state.viewedUser && state.me && state.viewedUser !== state.me.email) {
      url += `?view_user=${encodeURIComponent(state.viewedUser)}`;
    }
    try {
      await api(url, { method: "DELETE" });
      await refreshState({ silent: true });
    } catch (err) {
      await enqueueMutation({
        kind: "delete_shift",
        url,
        options: { method: "DELETE" },
      });
      alert("Turno rimosso in locale. La sincronizzazione col server verra ritentata.");
    }
  }

  async function saveSettings() {
    if (!state.canEdit) return;
    const next = {};
    const inputs = els.settingsSections.querySelectorAll("[data-setting-key]");
    inputs.forEach((input) => {
      next[input.dataset.settingKey] = Number(input.value);
    });
    const payload = { settings: next };
    if (userIsAdmin() && state.viewedUser && state.me && state.viewedUser !== state.me.email) {
      payload.view_user = state.viewedUser;
    }
    state.settings = { ...next };
    state.settingsDirty = false;
    renderSettings();
    const { year, month } = getMonthYear();
    if (state.viewedUser) {
      await localSet(
        stateCacheKey(state.viewedUser, year, month),
        {
          can_edit: state.canEdit,
          quick_shifts: state.quickShifts,
          settings: state.settings,
          view: state.view,
          viewing_email: state.viewedUser,
        }
      );
    }
    try {
      await api("/api/settings", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(payload),
      });
      await refreshState({ silent: true });
      alert("Impostazioni salvate.");
    } catch (err) {
      await enqueueMutation({
        kind: "save_settings",
        url: "/api/settings",
        options: {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify(payload),
        },
      });
      alert("Paghe salvate in locale. La sincronizzazione col server verra ritentata.");
    }
  }

  async function syncQueuedMutations() {
    if (!localDB || syncInFlight || !state.me) return;
    syncInFlight = true;
    try {
      const pending = await localDB.listQueue("pending");
      for (const item of pending) {
        await localDB.updateQueue(item.id, { status: "syncing", attempts: Number(item.attempts || 0) + 1 });
        try {
          await api(item.url, item.options || {});
          await localDB.deleteQueue(item.id);
        } catch (_err) {
          await localDB.updateQueue(item.id, { status: "pending" });
        }
      }
      if (pending.length && state.me && state.me.approved) {
        await refreshState({ silent: true });
      }
    } catch (_err) {
    } finally {
      syncInFlight = false;
    }
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
            if (state.me && state.me.approved) await refreshState();
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
    els.navButtons.forEach((btn) => {
      btn.addEventListener("click", () => setActiveScreen(btn.dataset.screen));
    });

    els.monthPrev.addEventListener("click", () => shiftMonth(-1));
    els.monthNext.addEventListener("click", () => shiftMonth(1));

    els.fabAdd.addEventListener("click", () => {
      clearShiftForm();
      openShiftModal();
    });
    els.modalClose.addEventListener("click", closeShiftModal);
    els.shiftModal.addEventListener("click", (e) => {
      if (e.target === els.shiftModal) closeShiftModal();
    });

    els.addShift.addEventListener("click", async () => {
      try {
        await addShift();
      } catch (err) {
        alert(err.message);
      }
    });

    els.shiftList.addEventListener("click", async (e) => {
      const btn = e.target.closest("[data-delete-date]");
      if (btn) {
        try {
          await deleteShift(btn.dataset.deleteDate);
        } catch (err) {
          alert(err.message);
        }
        return;
      }
      const card = e.target.closest(".shift-card");
      if (!card || !state.canEdit) return;
      const row = findEntryRow(card.dataset.rowDate);
      if (row && row.entry) {
        const hasValue = row.entry.desc || row.entry.start || row.entry.end || Number(row.entry.total || 0) > 0;
        if (hasValue) {
          openEditShift(row.date);
        } else {
          clearShiftForm();
          els.shiftDate.value = row.date;
          openShiftModal();
        }
      }
    });

    els.saveSettings.addEventListener("click", async () => {
      try {
        await saveSettings();
      } catch (err) {
        alert(err.message);
      }
    });

    if (els.settingsSections) {
      els.settingsSections.addEventListener("input", () => {
        state.settingsDirty = true;
      });
      els.settingsSections.addEventListener("focusin", () => {
        state.settingsFocused = true;
      });
      els.settingsSections.addEventListener("focusout", () => {
        setTimeout(() => {
          state.settingsFocused = !!document.activeElement && !!document.activeElement.closest && !!document.activeElement.closest("#settings-sections");
        }, 0);
      });
    }

    els.adminFilterButtons.forEach((btn) => {
      btn.addEventListener("click", () => {
        state.adminFilter = btn.dataset.adminFilter;
        els.adminFilterButtons.forEach((b) => b.classList.toggle("active", b === btn));
        renderAdminStatsAndList();
      });
    });

    els.backToMine.addEventListener("click", async () => {
      state.viewedUser = state.me ? state.me.email : null;
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
    if (els.pendingLogout) els.pendingLogout.addEventListener("click", doLogout);

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
          if (state.me && state.me.approved) await refreshState();
        } catch (err) {
          alert(err.message);
        }
      });
    }

    els.exportPdf.addEventListener("click", () => {
      const { year, month } = getMonthYear();
      const params = new URLSearchParams({ year: String(year), month: String(month), print: "1" });
      if (userIsAdmin() && state.viewedUser && state.viewedUser !== state.me.email) {
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

  function registerSmartRefresh() {
    let refreshTimer = null;
    let isRefreshing = false;

    const safeRefresh = async () => {
      if (isRefreshing || !state.me || document.hidden) return;
      if (state.settingsDirty) return;
      if (state.activeScreen === "screen-paghe") return;
      if (els.shiftModal && !els.shiftModal.classList.contains("hidden")) return;
      isRefreshing = true;
      try {
        await refreshMe();
        if (state.me && state.me.approved) {
          await refreshState();
          await syncQueuedMutations();
        }
      } catch (_err) {
      } finally {
        isRefreshing = false;
      }
    };

    document.addEventListener("visibilitychange", () => {
      if (!document.hidden) {
        safeRefresh();
      }
    });

    window.addEventListener("focus", safeRefresh);

    refreshTimer = window.setInterval(() => {
      safeRefresh();
    }, 15000);

    return () => {
      if (refreshTimer) {
        window.clearInterval(refreshTimer);
      }
    };
  }

  async function boot() {
    document.title = pwaAppName;
    const today = els.body.dataset.today || "";
    els.shiftDate.value = today;
    syncShiftFlags();
    const monthVal = els.body.dataset.month || "";
    els.monthInput.value = monthVal;
    const { year, month } = getMonthYear();
    if (year && month) setMonthYear(year, month);

    bindEvents();
    initGoogleSignIn();
    registerServiceWorker();
    registerSmartRefresh();

    try {
      await refreshMe({ preferCache: true, silent: true });
      if (state.me && state.me.approved) {
        await refreshState({ preferCache: true, silent: true });
        await syncQueuedMutations();
      }
    } catch (err) {
      alert(err.message);
    }
  }

  boot();
})();
