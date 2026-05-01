(function () {
  const state = {
    me: null,
    canEdit: true,
    currentEditDate: null,
    currentQuickIndex: null,
    quickShifts: [],
    settings: {},
    view: null,
    viewedUser: null,
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
    currentUser: document.getElementById("current-user"),
    logoutBtn: document.getElementById("logout-btn"),
    adminTabBtn: document.getElementById("admin-tab-btn"),
    adminUsersBody: document.querySelector("#admin-users-table tbody"),
    readonlyBanner: document.getElementById("readonly-banner"),
    backToMine: document.getElementById("back-to-mine"),
    tabs: Array.from(document.querySelectorAll(".tab-btn")),
    panels: Array.from(document.querySelectorAll(".tab-panel")),
    month: document.getElementById("mese-selector"),
    refreshMonth: document.getElementById("refresh-month"),
    shiftDate: document.getElementById("shift-date"),
    shiftStart: document.getElementById("shift-start"),
    shiftEnd: document.getElementById("shift-end"),
    quickMain: document.getElementById("quick-main"),
    applyMainQuick: document.getElementById("apply-main-quick"),
    openQuickTab: document.getElementById("open-quick-tab"),
    flagFestivo: document.getElementById("flag-festivo"),
    flagFestivoGoduto: document.getElementById("flag-festivo-goduto"),
    flagFerie: document.getElementById("flag-ferie"),
    flagMalattia: document.getElementById("flag-malattia"),
    addShift: document.getElementById("add-shift"),
    deleteShift: document.getElementById("delete-shift"),
    editLabel: document.getElementById("edit-label"),
    monthTableBody: document.querySelector("#month-table tbody"),
    summaryBox: document.getElementById("summary-box"),
    quickName: document.getElementById("quick-name"),
    quickStart: document.getElementById("quick-start"),
    quickEnd: document.getElementById("quick-end"),
    saveQuick: document.getElementById("save-quick"),
    newQuick: document.getElementById("new-quick"),
    deleteQuick: document.getElementById("delete-quick"),
    applyQuickToDay: document.getElementById("apply-quick-to-day"),
    quickTableBody: document.querySelector("#quick-table tbody"),
    exportPdf: document.getElementById("export-pdf"),
    exportBackup: document.getElementById("export-backup"),
    recalculateAll: document.getElementById("recalculate-all"),
    reportText: document.getElementById("report-text"),
    settingsBox: document.getElementById("settings-box"),
    saveSettings: document.getElementById("save-settings"),
  };

  const googleClientId = (els.body.dataset.googleClientId || "").trim();
  let googleInitDone = false;

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
      const message = (data && data.message) || "Operazione non riuscita.";
      const err = new Error(message);
      err.status = response.status;
      err.payload = data;
      throw err;
    }
    return data;
  }

  function activateTab(tabId) {
    for (const btn of els.tabs) {
      btn.classList.toggle("active", btn.dataset.tab === tabId);
    }
    for (const panel of els.panels) {
      panel.classList.toggle("active", panel.id === tabId);
    }
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
    const parts = (els.month.value || "").split("-");
    return {
      year: Number(parts[0] || 0),
      month: Number(parts[1] || 0),
    };
  }

  function setEditable(flag) {
    const editableControls = [
      els.shiftDate,
      els.shiftStart,
      els.shiftEnd,
      els.quickMain,
      els.applyMainQuick,
      els.flagFestivo,
      els.flagFestivoGoduto,
      els.flagFerie,
      els.flagMalattia,
      els.addShift,
      els.deleteShift,
      els.quickName,
      els.quickStart,
      els.quickEnd,
      els.saveQuick,
      els.newQuick,
      els.deleteQuick,
      els.applyQuickToDay,
      els.saveSettings,
      els.recalculateAll,
    ];
    editableControls.forEach((el) => {
      if (el) el.disabled = !flag;
    });
  }

  function clearEntrySelection() {
    state.currentEditDate = null;
    els.editLabel.textContent = "Nuovo inserimento: scegli data, orari o turno rapido e premi Aggiungi Turno.";
    els.flagFestivo.checked = false;
    els.flagFestivoGoduto.checked = false;
    els.flagFerie.checked = false;
    els.flagMalattia.checked = false;
    els.quickMain.value = "";
  }

  function selectEntry(entry, dateStr) {
    state.currentEditDate = dateStr;
    els.editLabel.textContent = `Giorno selezionato: ${dateStr}. Puoi eliminarlo o compilare un altro giorno.`;
    els.shiftDate.value = dateStr;
    els.shiftStart.value = entry.start || "06:00";
    els.shiftEnd.value = entry.end || "14:00";
    els.flagFestivo.checked = Boolean(entry.festivo);
    els.flagFestivoGoduto.checked = Boolean(entry.festivo_goduto);
    els.flagFerie.checked = Boolean(entry.ferie);
    els.flagMalattia.checked = Boolean(entry.malattia);
  }

  function clearQuickForm() {
    state.currentQuickIndex = null;
    els.quickName.value = "";
    els.quickStart.value = "06:00";
    els.quickEnd.value = "14:00";
  }

  function renderQuickSelect() {
    els.quickMain.innerHTML = "";
    const first = document.createElement("option");
    first.value = "";
    first.textContent = "Seleziona turno rapido";
    els.quickMain.appendChild(first);
    state.quickShifts.forEach((shift, idx) => {
      const opt = document.createElement("option");
      opt.value = String(idx);
      opt.textContent = `${shift.name} (${shift.start} - ${shift.end})`;
      els.quickMain.appendChild(opt);
    });
  }

  function renderQuickTable() {
    els.quickTableBody.innerHTML = "";
    state.quickShifts.forEach((shift, idx) => {
      const tr = document.createElement("tr");
      tr.classList.add("selectable");
      if (state.currentQuickIndex === idx) tr.classList.add("selected");
      tr.innerHTML = `<td>${escapeHtml(shift.name)}</td><td>${escapeHtml(shift.start)}</td><td>${escapeHtml(shift.end)}</td>`;
      tr.addEventListener("click", () => {
        state.currentQuickIndex = idx;
        els.quickName.value = shift.name;
        els.quickStart.value = shift.start;
        els.quickEnd.value = shift.end;
        renderQuickTable();
      });
      els.quickTableBody.appendChild(tr);
    });
  }

  function renderSettings() {
    els.settingsBox.innerHTML = "";
    Object.keys(state.settings).forEach((key) => {
      const row = document.createElement("div");
      row.className = "setting-row";
      const label = document.createElement("label");
      label.textContent = key;
      const input = document.createElement("input");
      input.type = "number";
      input.step = "0.01";
      input.max = "1000";
      input.value = String(state.settings[key]);
      input.dataset.settingKey = key;
      row.appendChild(label);
      row.appendChild(input);
      els.settingsBox.appendChild(row);
    });
  }

  function renderMonthTable() {
    els.monthTableBody.innerHTML = "";
    const rows = (state.view && state.view.rows) || [];
    let selectedStillExists = false;

    rows.forEach((row) => {
      const tr = document.createElement("tr");
      if (row.type === "week") {
        tr.className = "week-row";
        tr.innerHTML = `<td colspan="7">${escapeHtml(row.label)}</td>`;
      } else {
        tr.classList.add("selectable");
        if (state.currentEditDate === row.date) {
          tr.classList.add("selected");
          selectedStillExists = true;
        }
        tr.innerHTML = `<td>${escapeHtml(row.display_date)}</td><td>${escapeHtml(row.start_display)}</td><td>${escapeHtml(row.end_display)}</td><td>${escapeHtml(row.hours_display)}</td><td>${escapeHtml(row.desc_display)}</td><td>${escapeHtml(row.total_display)}</td><td>${escapeHtml(row.detail_display)}</td>`;
        tr.addEventListener("click", () => {
          selectEntry(row.entry, row.date);
          renderMonthTable();
        });
      }
      els.monthTableBody.appendChild(tr);
    });

    if (state.currentEditDate && !selectedStillExists) clearEntrySelection();
  }

  function renderReadonlyBanner() {
    if (state.canEdit) {
      els.readonlyBanner.classList.add("hidden");
      els.backToMine.classList.add("hidden");
      return;
    }
    const viewing = state.viewedUser || "";
    els.readonlyBanner.textContent = `Modalita sola lettura: stai visualizzando i turni di ${viewing}.`;
    els.readonlyBanner.classList.remove("hidden");
    els.backToMine.classList.remove("hidden");
  }

  async function renderAdminUsers() {
    if (!userIsAdmin()) {
      els.adminUsersBody.innerHTML = "";
      return;
    }
    const data = await api("/api/admin/users");
    els.adminUsersBody.innerHTML = "";
    data.users.forEach((u) => {
      const tr = document.createElement("tr");
      const isSelf = state.me && u.email === state.me.email;
      const status = u.approved ? "Approvato" : "In attesa";
      const statusColor = u.approved ? "#065f46" : "#92400e";

      tr.innerHTML = `
        <td><strong>${escapeHtml(u.name)}</strong><br><small>${escapeHtml(u.email)}</small></td>
        <td>${escapeHtml(u.role)}</td>
        <td style="color:${statusColor};font-weight:600">${status}</td>
        <td>${escapeHtml(String(u.compiled_days))}</td>
        <td>${escapeHtml(u.last_login || "-")}</td>
        <td></td>
      `;

      const actions = tr.querySelector("td:last-child");
      const viewBtn = document.createElement("button");
      viewBtn.className = "secondary";
      viewBtn.textContent = "Visualizza turni";
      viewBtn.addEventListener("click", async () => {
        state.viewedUser = u.email;
        activateTab("tab-lavoro");
        await refreshState();
      });
      actions.appendChild(viewBtn);

      if (!isSelf) {
        const approveBtn = document.createElement("button");
        approveBtn.className = u.approved ? "danger" : "";
        approveBtn.textContent = u.approved ? "Nega accesso" : "Approva";
        approveBtn.addEventListener("click", async () => {
          try {
            await api(`/api/admin/users/${encodeURIComponent(u.email)}/approval`, {
              method: "POST",
              headers: { "Content-Type": "application/json" },
              body: JSON.stringify({ approved: !u.approved }),
            });
            await renderAdminUsers();
          } catch (err) {
            alert(err.message);
          }
        });
        actions.appendChild(approveBtn);
      }

      els.adminUsersBody.appendChild(tr);
    });
  }

  function applyQuickToForm(index) {
    const shift = state.quickShifts[index];
    if (!shift) {
      alert("Seleziona prima un turno rapido.");
      return;
    }
    els.shiftStart.value = shift.start;
    els.shiftEnd.value = shift.end;
  }

  async function refreshState() {
    const { month, year } = getMonthYear();
    const params = new URLSearchParams({ month: String(month), year: String(year) });
    if (userIsAdmin() && state.viewedUser && state.viewedUser !== state.me.email) {
      params.set("view_user", state.viewedUser);
    }
    const data = await api(`/api/state?${params.toString()}`);
    state.quickShifts = data.quick_shifts || [];
    state.settings = data.settings || {};
    state.view = data.view || { rows: [], summary_text: "", report_text: "" };
    state.canEdit = Boolean(data.can_edit);
    state.viewedUser = data.viewing_email || state.me.email;

    renderQuickSelect();
    renderQuickTable();
    renderSettings();
    renderMonthTable();
    renderReadonlyBanner();
    setEditable(state.canEdit);
    els.summaryBox.textContent = state.view.summary_text || "";
    els.reportText.value = state.view.report_text || "";
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
    const role = state.me.role === "admin" ? "Admin" : "Utente";
    const viewingTag = state.viewedUser && state.viewedUser !== state.me.email ? ` | Vista: ${state.viewedUser}` : "";
    els.currentUser.textContent = `${state.me.name} (${role}) - ${state.me.email}${viewingTag}`;
    els.adminTabBtn.classList.toggle("hidden", !userIsAdmin());
    if (!state.viewedUser) state.viewedUser = state.me.email;
  }

  async function logout() {
    await api("/auth/logout", { method: "POST" });
    state.me = null;
    state.viewedUser = null;
    showGate("auth");
  }

  async function handleGoogleCredential(response) {
    if (!response || !response.credential) return;
    try {
      await api("/auth/google", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ credential: response.credential }),
      });
      await refreshMe();
      if (state.me && state.me.approved) {
        await refreshState();
        if (userIsAdmin()) await renderAdminUsers();
      }
    } catch (err) {
      alert(err.message);
    }
  }

  function initGoogleSignIn() {
    if (!googleClientId || !els.googleSignin || googleInitDone) return;

    const tryInit = () => {
      if (!window.google || !window.google.accounts || !window.google.accounts.id) {
        setTimeout(tryInit, 250);
        return;
      }
      googleInitDone = true;
      window.__handleGoogleCredential = handleGoogleCredential;
      window.google.accounts.id.initialize({
        client_id: googleClientId,
        callback: window.__handleGoogleCredential,
      });
      window.google.accounts.id.renderButton(els.googleSignin, {
        theme: "outline",
        size: "large",
        shape: "pill",
        text: "continue_with",
      });
    };
    tryInit();
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
    state.currentEditDate = null;
    els.editLabel.textContent = "Turno aggiunto. Se devi cambiarlo, selezionalo e usa Elimina.";
    await refreshState();
  }

  async function deleteShift() {
    if (!state.canEdit) return;
    let target = state.currentEditDate;
    if (!target && els.shiftDate.value) target = els.shiftDate.value;
    if (!target) {
      alert("Seleziona un turno dalla tabella prima di eliminare.");
      return;
    }
    if (!confirm(`Eliminare il turno del ${target}?`)) return;
    await api(`/api/entry/${encodeURIComponent(target)}`, { method: "DELETE" });
    clearEntrySelection();
    await refreshState();
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
      alert("Seleziona un turno rapido da eliminare.");
      return;
    }
    const shift = state.quickShifts[state.currentQuickIndex];
    if (!shift) return;
    if (!confirm(`Eliminare il turno rapido '${shift.name}'?`)) return;
    await api(`/api/quick-shift/${state.currentQuickIndex}`, { method: "DELETE" });
    clearQuickForm();
    await refreshState();
  }

  async function saveSettings() {
    if (!state.canEdit) return;
    const values = {};
    els.settingsBox.querySelectorAll("input[data-setting-key]").forEach((input) => {
      values[input.dataset.settingKey] = Number(input.value);
    });
    await api("/api/settings", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ settings: values }),
    });
    await refreshState();
    alert("Impostazioni aggiornate e storico ricalcolato.");
  }

  function bindEvents() {
    els.tabs.forEach((btn) => btn.addEventListener("click", () => activateTab(btn.dataset.tab)));
    els.openQuickTab.addEventListener("click", () => activateTab("tab-quick"));
    els.refreshMonth.addEventListener("click", refreshState);
    els.month.addEventListener("change", refreshState);
    els.logoutBtn.addEventListener("click", async () => {
      try {
        await logout();
      } catch (err) {
        alert(err.message);
      }
    });
    if (els.pendingLogout) {
      els.pendingLogout.addEventListener("click", async () => {
        try {
          await logout();
        } catch (err) {
          alert(err.message);
        }
      });
    }
    if (els.devLogin) {
      els.devLogin.addEventListener("click", async () => {
        try {
          await api("/auth/dev-login", {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({
              name: (els.devName && els.devName.value) || "",
              email: (els.devEmail && els.devEmail.value) || "",
            }),
          });
          await refreshMe();
          if (state.me && state.me.approved) {
            await refreshState();
            if (userIsAdmin()) await renderAdminUsers();
          }
        } catch (err) {
          alert(err.message);
        }
      });
    }
    els.backToMine.addEventListener("click", async () => {
      state.viewedUser = state.me ? state.me.email : null;
      await refreshState();
    });

    els.applyMainQuick.addEventListener("click", () => {
      if (els.quickMain.value === "") {
        alert("Seleziona prima un turno rapido.");
        return;
      }
      applyQuickToForm(Number(els.quickMain.value));
    });

    els.addShift.addEventListener("click", async () => {
      try {
        await addShift();
      } catch (err) {
        alert(err.message);
      }
    });
    els.deleteShift.addEventListener("click", async () => {
      try {
        await deleteShift();
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
    els.applyQuickToDay.addEventListener("click", () => {
      if (!Number.isInteger(state.currentQuickIndex)) {
        alert("Seleziona un turno rapido dalla tabella.");
        return;
      }
      applyQuickToForm(state.currentQuickIndex);
      activateTab("tab-lavoro");
    });

    els.exportPdf.addEventListener("click", () => {
      const { month, year } = getMonthYear();
      const params = new URLSearchParams({ month: String(month), year: String(year), print: "1" });
      if (userIsAdmin() && state.viewedUser && state.viewedUser !== state.me.email) params.set("view_user", state.viewedUser);
      window.open(`/api/export-month-html?${params.toString()}`, "_blank");
    });
    els.exportBackup.addEventListener("click", () => {
      const params = new URLSearchParams();
      if (userIsAdmin() && state.viewedUser && state.viewedUser !== state.me.email) params.set("view_user", state.viewedUser);
      const q = params.toString();
      window.location.href = q ? `/api/export-backup?${q}` : "/api/export-backup";
    });
    els.recalculateAll.addEventListener("click", async () => {
      if (!state.canEdit) return;
      if (!confirm("Ricalcolare tutto lo storico usando le impostazioni correnti?")) return;
      try {
        await api("/api/recalculate", { method: "POST" });
        await refreshState();
        alert("Storico ricalcolato usando le impostazioni correnti.");
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
  }

  async function boot() {
    els.month.value = els.body.dataset.month || "";
    els.shiftDate.value = els.body.dataset.today || "";
    bindEvents();
    initGoogleSignIn();

    try {
      await refreshMe();
      if (state.me && state.me.approved) {
        await refreshState();
        if (userIsAdmin()) await renderAdminUsers();
      }
    } catch (err) {
      alert(err.message);
    }
  }

  boot();
})();
