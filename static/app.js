(function () {
  const state = {
    me: null,
    canEdit: true,
    viewedUser: null,
    currentQuickIndex: null,
    quickShifts: [],
    settings: {},
    view: null,
    adminUsers: [],
    adminFilter: "all",
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
    quickMain: document.getElementById("quick-main"),
    applyMainQuick: document.getElementById("apply-main-quick"),
    flagFestivo: document.getElementById("flag-festivo"),
    flagFestivoGoduto: document.getElementById("flag-festivo-goduto"),
    flagFerie: document.getElementById("flag-ferie"),
    flagMalattia: document.getElementById("flag-malattia"),
    addShift: document.getElementById("add-shift"),
    editLabel: document.getElementById("edit-label"),

    settingsSections: document.getElementById("settings-sections"),
    saveSettings: document.getElementById("save-settings"),

    quickList: document.getElementById("quick-list"),
    quickName: document.getElementById("quick-name"),
    quickStart: document.getElementById("quick-start"),
    quickEnd: document.getElementById("quick-end"),
    saveQuick: document.getElementById("save-quick"),
    newQuick: document.getElementById("new-quick"),
    deleteQuick: document.getElementById("delete-quick"),

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
    exportBackup: document.getElementById("export-backup"),
    logoutProfile: document.getElementById("logout-btn-profile"),

    navButtons: Array.from(document.querySelectorAll(".nav-btn")),
    screens: Array.from(document.querySelectorAll(".screen")),
  };

  const googleClientId = (els.body.dataset.googleClientId || "").trim();
  const pwaAppName = (els.body.dataset.pwaAppName || "I Miei Turni").trim();
  const monthFormatter = new Intl.DateTimeFormat("it-IT", { month: "long", year: "numeric" });

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

  async function api(url, options = {}) {
    const response = await fetch(url, options);
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
      els.quickMain,
      els.applyMainQuick,
      els.flagFestivo,
      els.flagFestivoGoduto,
      els.flagFerie,
      els.flagMalattia,
      els.shiftDate,
      els.shiftStart,
      els.shiftEnd,
      els.saveSettings,
      els.quickName,
      els.quickStart,
      els.quickEnd,
      els.saveQuick,
      els.newQuick,
      els.deleteQuick,
    ];
    list.forEach((el) => {
      if (el) el.disabled = !editable;
    });
  }

  function setActiveScreen(screenId) {
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
    els.shiftDate.value = els.body.dataset.today || "";
    els.shiftStart.value = "06:00";
    els.shiftEnd.value = "14:00";
    els.flagFestivo.checked = false;
    els.flagFestivoGoduto.checked = false;
    els.flagFerie.checked = false;
    els.flagMalattia.checked = false;
    els.quickMain.value = "";
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

  function clearQuickForm() {
    state.currentQuickIndex = null;
    els.quickName.value = "";
    els.quickStart.value = "06:00";
    els.quickEnd.value = "14:00";
    renderQuickList();
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
    if (state.canEdit) {
      els.readonlyBanner.classList.add("hidden");
      els.backToMine.classList.add("hidden");
      return;
    }
    els.readonlyBanner.classList.remove("hidden");
    els.backToMine.classList.remove("hidden");
    els.readonlyBanner.textContent = `Stai visualizzando i turni di ${state.viewedUser} in sola lettura.`;
  }

  function renderQuickSelect() {
    els.quickMain.innerHTML = "<option value=''>Turno rapido</option>";
    state.quickShifts.forEach((q, idx) => {
      const opt = document.createElement("option");
      opt.value = String(idx);
      opt.textContent = `${q.name} (${q.start}-${q.end})`;
      els.quickMain.appendChild(opt);
    });
  }

  function renderQuickList() {
    els.quickList.innerHTML = "";
    if (!state.quickShifts.length) {
      els.quickList.innerHTML = "<div class='empty-state'>Nessun turno rapido.</div>";
      return;
    }
    state.quickShifts.forEach((q, idx) => {
      const item = document.createElement("div");
      item.className = `quick-item${state.currentQuickIndex === idx ? " selected" : ""}`;
      item.innerHTML = `<div><strong>${escapeHtml(q.name)}</strong><div class='sub'>${escapeHtml(q.start)} - ${escapeHtml(q.end)}</div></div><span>›</span>`;
      item.addEventListener("click", () => {
        state.currentQuickIndex = idx;
        els.quickName.value = q.name;
        els.quickStart.value = q.start;
        els.quickEnd.value = q.end;
        renderQuickList();
      });
      els.quickList.appendChild(item);
    });
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

      const card = document.createElement("article");
      card.className = "shift-card";
      card.innerHTML = `
        <div>
          <div class="shift-date">${escapeHtml(row.display_date || date)}</div>
          <div class="shift-time">${escapeHtml(start)}<br>${escapeHtml(end)}</div>
        </div>
        <div>
          <div class="shift-desc">${escapeHtml(detail)}</div>
          <div class="shift-actions">
            <button class="trash-btn" title="Elimina turno" data-delete-date="${escapeHtml(date)}">&#128465;</button>
          </div>
        </div>
        <div class="shift-total">${escapeHtml(totalText)}</div>
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

  function applyQuickToShiftForm(index) {
    const q = state.quickShifts[index];
    if (!q) {
      alert("Seleziona prima un turno rapido.");
      return;
    }
    els.shiftStart.value = q.start;
    els.shiftEnd.value = q.end;
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
      viewBtn.textContent = "Visualizza";
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

  async function refreshState() {
    const { year, month } = getMonthYear();
    const params = new URLSearchParams({ year: String(year), month: String(month) });
    if (userIsAdmin() && state.viewedUser && state.viewedUser !== state.me.email) {
      params.set("view_user", state.viewedUser);
    }
    const data = await api(`/api/state?${params.toString()}`);
    state.canEdit = Boolean(data.can_edit);
    state.quickShifts = data.quick_shifts || [];
    state.settings = data.settings || {};
    state.view = data.view || { rows: [] };
    state.viewedUser = data.viewing_email || state.me.email;

    renderReadonlyInfo();
    setEditable(state.canEdit);
    renderQuickSelect();
    renderQuickList();
    renderShiftList();
    renderTurniSummaryCards();
    renderSettings();
    renderProfile();
    if (userIsAdmin()) await refreshAdminUsers();
  }

  async function refreshMe() {
    const meData = await api("/api/me");
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
  }

  async function logout() {
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
    if (!state.canEdit) return;
    if (!dateStr) return;
    if (!confirm(`Eliminare il turno del ${dateStr}?`)) return;
    await api(`/api/entry/${encodeURIComponent(dateStr)}`, { method: "DELETE" });
    await refreshState();
  }

  async function saveSettings() {
    if (!state.canEdit) return;
    const next = {};
    const inputs = els.settingsSections.querySelectorAll("[data-setting-key]");
    inputs.forEach((input) => {
      next[input.dataset.settingKey] = Number(input.value);
    });
    await api("/api/settings", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ settings: next }),
    });
    await refreshState();
    alert("Impostazioni salvate.");
  }

  async function saveQuickShift(overwrite = false) {
    if (!state.canEdit) return;
    const payload = {
      name: els.quickName.value.trim(),
      start: els.quickStart.value,
      end: els.quickEnd.value,
      overwrite,
    };
    if (Number.isInteger(state.currentQuickIndex)) payload.index = state.currentQuickIndex;
    try {
      await api("/api/quick-shift", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(payload),
      });
    } catch (err) {
      const code = err.payload && err.payload.error_code;
      if (code === "DUPLICATE_NAME" && confirm(err.message)) return saveQuickShift(true);
      throw err;
    }
    clearQuickForm();
    await refreshState();
  }

  async function deleteQuickShift() {
    if (!state.canEdit) return;
    if (!Number.isInteger(state.currentQuickIndex)) {
      alert("Seleziona un turno rapido.");
      return;
    }
    const q = state.quickShifts[state.currentQuickIndex];
    if (!q) return;
    if (!confirm(`Eliminare turno rapido '${q.name}'?`)) return;
    await api(`/api/quick-shift/${state.currentQuickIndex}`, { method: "DELETE" });
    clearQuickForm();
    await refreshState();
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

    els.applyMainQuick.addEventListener("click", () => {
      if (els.quickMain.value === "") return alert("Seleziona un turno rapido.");
      applyQuickToShiftForm(Number(els.quickMain.value));
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
      if (!btn) return;
      try {
        await deleteShift(btn.dataset.deleteDate);
      } catch (err) {
        alert(err.message);
      }
    });

    els.saveSettings.addEventListener("click", async () => {
      try {
        await saveSettings();
      } catch (err) {
        alert(err.message);
      }
    });

    els.saveQuick.addEventListener("click", async () => {
      try {
        await saveQuickShift(false);
      } catch (err) {
        alert(err.message);
      }
    });
    els.newQuick.addEventListener("click", clearQuickForm);
    els.deleteQuick.addEventListener("click", async () => {
      try {
        await deleteQuickShift();
      } catch (err) {
        alert(err.message);
      }
    });

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

    els.exportBackup.addEventListener("click", () => {
      const params = new URLSearchParams();
      if (userIsAdmin() && state.viewedUser && state.viewedUser !== state.me.email) {
        params.set("view_user", state.viewedUser);
      }
      const q = params.toString();
      window.location.href = q ? `/api/export-backup?${q}` : "/api/export-backup";
    });
  }

  function registerServiceWorker() {
    if (!("serviceWorker" in navigator)) return;
    window.addEventListener("load", () => {
      navigator.serviceWorker.register("/service-worker.js").catch(() => {});
    });
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
