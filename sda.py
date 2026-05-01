import sys
import json
import os
import calendar
from datetime import datetime, timedelta
from html import escape

from PyQt5.QtWidgets import *
from PyQt5.QtCore import QDate, QTime, Qt
from PyQt5.QtGui import QTextDocument
from PyQt5.QtPrintSupport import QPrinter

DATA_FILE = "dati_sda.json"


class SDAApp(QWidget):
    def __init__(self):
        super().__init__()
        self.setWindowTitle("Gestione Ore SDA Potenza - by Donato Langerame")
        self.resize(1500, 900)

        self.settings = {
            "BASE_GIORNO": 10,
            "BASE_NOTTE": 12,
            "OT_GIORNO": 14,
            "OT_NOTTE": 16,
            "SABATO_GIORNO": 13,
            "SABATO_NOTTE": 15,
            "FESTIVO_GIORNALIERO": 18,
            "FESTIVO_NOTTURNO": 20,
            "FERIE": 80,
            "MALATTIA": 80,
            "FESTIVO_GODUTO": 80,
            "SOGLIA_STRAORDINARIO": 8
        }

        self.data = []
        self.quick_shifts = self.default_quick_shifts()
        self.row_entry_dates = {}
        self.current_edit_date = None
        self.current_quick_index = None

        self.load_data()
        self.init_ui()

    # ================= UTILS =================

    def default_quick_shifts(self):
        return [
            {"name": "Mattina", "start": "06:00", "end": "14:00"},
            {"name": "Pomeriggio", "start": "14:00", "end": "22:00"},
            {"name": "Notte", "start": "22:00", "end": "06:00"},
            {"name": "Part-time Mattina", "start": "06:00", "end": "12:00"},
            {"name": "Part-time Sera", "start": "18:00", "end": "22:00"},
        ]

    def parse_time_or_default(self, value, fallback):
        try:
            return datetime.strptime(value, "%H:%M").time()
        except (TypeError, ValueError):
            return fallback

    def minutes_to_hhmm(self, minutes):
        total = int(round(float(minutes or 0)))
        sign = "-" if total < 0 else ""
        total = abs(total)
        return f"{sign}{total // 60:02d}:{total % 60:02d}"

    def minutes_to_hdot(self, minutes):
        total = int(round(float(minutes or 0)))
        sign = "-" if total < 0 else ""
        total = abs(total)
        hours = total // 60
        mins = total % 60
        return f"{sign}{hours}.{mins:02d}"

    def format_hours(self, minutes):
        return self.minutes_to_hhmm(minutes)

    def get_detail_minutes(self, entry):
        detail_minutes = entry.get("detail_minutes", {})
        if isinstance(detail_minutes, dict) and detail_minutes:
            normalized = {}
            for key, value in detail_minutes.items():
                try:
                    normalized[key] = int(round(float(value)))
                except (TypeError, ValueError):
                    normalized[key] = 0
            return normalized

        detail_hours = entry.get("detail", {}) or {}
        converted = {}
        for key, value in detail_hours.items():
            try:
                converted[key] = int(round(float(value) * 60))
            except (TypeError, ValueError):
                converted[key] = 0
        return converted

    def format_detail(self, entry):
        detail_minutes = self.get_detail_minutes(entry)
        if not detail_minutes:
            return "-"
        parts = []
        for key in sorted(detail_minutes.keys()):
            minutes = detail_minutes[key]
            parts.append(f"{key}: {self.format_hours(minutes)}")
        return " | ".join(parts)

    def normalize_entry_flags(self, entry):
        detail = entry.get("detail", {}) or {}
        desc = (entry.get("desc", "") or "").lower()

        has_festivo_hours = (
            "FESTIVO_GIORNALIERO" in detail or "FESTIVO_NOTTURNO" in detail
        )

        festivo = entry.get("festivo")
        if festivo is None:
            festivo = has_festivo_hours or ("festivo" in desc and "goduto" not in desc)

        festivo_goduto = entry.get("festivo_goduto")
        if festivo_goduto is None:
            festivo_goduto = ("FESTIVO_GODUTO" in detail and not has_festivo_hours) or ("festivo goduto" in desc)

        ferie = entry.get("ferie")
        if ferie is None:
            ferie = "ferie" in desc

        malattia = entry.get("malattia")
        if malattia is None:
            malattia = "malattia" in desc

        entry["festivo"] = bool(festivo)
        entry["festivo_goduto"] = bool(festivo_goduto)
        entry["ferie"] = bool(ferie)
        entry["malattia"] = bool(malattia)

    def is_placeholder_entry(self, entry):
        return (
            not entry.get("desc")
            and not entry.get("start")
            and not entry.get("end")
            and float(entry.get("total", 0) or 0) == 0
            and not entry.get("detail")
            and not entry.get("detail_minutes")
        )

    def is_absence_entry(self, entry):
        return bool(
            entry.get("ferie", False)
            or entry.get("malattia", False)
            or (entry.get("festivo_goduto", False) and not entry.get("festivo", False))
        )

    def sanitize_quick_shifts(self, shifts):
        cleaned = []
        for shift in shifts or []:
            if not isinstance(shift, dict):
                continue

            name = str(shift.get("name", "")).strip()
            start = str(shift.get("start", "")).strip()
            end = str(shift.get("end", "")).strip()

            try:
                datetime.strptime(start, "%H:%M")
                datetime.strptime(end, "%H:%M")
            except ValueError:
                continue

            if name:
                cleaned.append({"name": name, "start": start, "end": end})

        return cleaned or self.default_quick_shifts()

    def create_empty_entry(self, date_str):
        return {
            "date": date_str,
            "start": "",
            "end": "",
            "desc": "",
            "total": 0,
            "detail": {},
            "detail_minutes": {},
            "festivo": False,
            "festivo_goduto": False,
            "ferie": False,
            "malattia": False
        }

    def recalculate_entry(self, entry):
        if self.is_placeholder_entry(entry):
            self.normalize_entry_flags(entry)
            return

        try:
            date = datetime.strptime(entry["date"], "%Y-%m-%d").date()
        except (KeyError, ValueError):
            return

        self.normalize_entry_flags(entry)

        start = self.parse_time_or_default(entry.get("start"), datetime.strptime("06:00", "%H:%M").time())
        end = self.parse_time_or_default(entry.get("end"), datetime.strptime("14:00", "%H:%M").time())

        desc, total, detail, detail_minutes = self.calculate(
            date,
            start,
            end,
            entry["festivo"],
            entry["festivo_goduto"],
            entry["ferie"],
            entry["malattia"]
        )

        if entry["ferie"] or entry["malattia"] or (entry["festivo_goduto"] and not entry["festivo"]):
            entry["start"] = ""
            entry["end"] = ""
        else:
            entry["start"] = start.strftime("%H:%M")
            entry["end"] = end.strftime("%H:%M")
        entry["desc"] = desc
        entry["total"] = total
        entry["detail"] = detail
        entry["detail_minutes"] = detail_minutes

    def recalculate_all_entries(self):
        for entry in self.data:
            self.recalculate_entry(entry)

    def get_selected_entry_date(self):
        selected = self.table.selectedItems()
        if not selected:
            return None
        row = selected[0].row()
        return self.row_entry_dates.get(row)

    def build_entry_from_form(self, target_date=None):
        date = target_date or self.date.date().toPyDate()
        start = self.start.time().toPyTime()
        end = self.end.time().toPyTime()

        festivo = self.festivo.isChecked()
        festivo_goduto = self.festivo_goduto.isChecked()
        ferie = self.ferie.isChecked()
        malattia = self.malattia.isChecked()

        desc, total, detail, detail_minutes = self.calculate(
            date, start, end, festivo, festivo_goduto, ferie, malattia
        )

        start_str = start.strftime("%H:%M")
        end_str = end.strftime("%H:%M")
        if ferie or malattia or (festivo_goduto and not festivo):
            start_str = ""
            end_str = ""

        return {
            "date": date.strftime("%Y-%m-%d"),
            "start": start_str,
            "end": end_str,
            "desc": desc,
            "total": total,
            "detail": detail,
            "detail_minutes": detail_minutes,
            "festivo": festivo,
            "festivo_goduto": festivo_goduto,
            "ferie": ferie,
            "malattia": malattia
        }

    def upsert_entry(self, entry, replace_date=None):
        to_remove = {entry["date"]}
        if replace_date:
            to_remove.add(replace_date)

        self.data = [e for e in self.data if e.get("date") not in to_remove]
        self.data.append(entry)
        self.data.sort(key=lambda x: x["date"])

    # ================= UI =================

    def init_ui(self):
        layout = QVBoxLayout()
        self.tabs = QTabWidget()

        self.tab_lavoro = QWidget()
        self.tab_turni_rapidi = QWidget()
        self.tab_report = QWidget()
        self.tab_impostazioni = QWidget()

        self.tabs.addTab(self.tab_lavoro, "Inserimento Turni")
        self.tabs.addTab(self.tab_turni_rapidi, "Turni Rapidi")
        self.tabs.addTab(self.tab_report, "Report e Utility")
        self.tabs.addTab(self.tab_impostazioni, "Impostazioni Paghe")

        self.init_tab_lavoro()
        self.init_tab_turni_rapidi()
        self.init_tab_report()
        self.init_tab_impostazioni()

        layout.addWidget(self.tabs)
        self.setLayout(layout)

        self.apply_theme()

    def apply_theme(self):
        self.setStyleSheet("""
            QWidget {
                background-color: #f4f7fb;
                font-family: 'Segoe UI';
                font-size: 13px;
                color: #111827;
            }

            #Header {
                background: qlineargradient(
                    x1:0, y1:0, x2:1, y2:0,
                    stop:0 #111827, stop:1 #1d4ed8
                );
                color: white;
                font-size: 22px;
                font-weight: bold;
                padding: 18px;
                border-radius: 14px;
            }

            QGroupBox {
                border: 1px solid #d9e2ef;
                border-radius: 12px;
                margin-top: 14px;
                padding-top: 12px;
                background: white;
            }

            QGroupBox::title {
                subcontrol-origin: margin;
                left: 12px;
                padding: 0 4px;
                color: #1d4ed8;
                font-weight: bold;
            }

            QTabWidget::pane {
                border: 1px solid #d8e3f1;
                border-radius: 12px;
                background: white;
            }

            QTabBar::tab {
                background: #eaf1fb;
                border: 1px solid #d0dff3;
                border-bottom: none;
                padding: 10px 20px;
                border-top-left-radius: 10px;
                border-top-right-radius: 10px;
                margin-right: 4px;
                color: #334155;
                font-weight: 600;
            }

            QTabBar::tab:hover {
                background: #dce9fa;
            }

            QTabBar::tab:selected {
                background: #1d4ed8;
                color: white;
                font-weight: bold;
            }

            QDateEdit, QTimeEdit, QDoubleSpinBox, QLineEdit, QComboBox, QTextEdit {
                background: white;
                border: 1px solid #c8d7ec;
                border-radius: 8px;
                padding: 6px;
            }

            QDateEdit:focus, QTimeEdit:focus, QDoubleSpinBox:focus, QLineEdit:focus, QComboBox:focus, QTextEdit:focus {
                border: 1px solid #2563eb;
            }

            QPushButton {
                background-color: #2563eb;
                color: white;
                border-radius: 10px;
                padding: 8px 16px;
                font-weight: 600;
                border: 1px solid #1d4ed8;
            }

            QPushButton:hover {
                background-color: #1d4ed8;
            }

            QPushButton:pressed {
                background-color: #1e40af;
            }

            #DangerButton {
                background-color: #ef4444;
                border: 1px solid #dc2626;
            }

            #DangerButton:hover {
                background-color: #dc2626;
            }

            #SecondaryButton {
                background-color: #475569;
                border: 1px solid #334155;
            }

            #SecondaryButton:hover {
                background-color: #334155;
            }

            QTableWidget {
                background: white;
                alternate-background-color: #f8fbff;
                border: 1px solid #d5e2f2;
                border-radius: 12px;
                gridline-color: #e4edf8;
                selection-background-color: #dbeafe;
                selection-color: #0f172a;
            }

            QHeaderView::section {
                background-color: #1d4ed8;
                color: white;
                padding: 7px;
                border: none;
                font-weight: bold;
            }

            QLabel {
                color: #111827;
            }

            #HintLabel {
                color: #475569;
                font-style: italic;
            }

            #SummaryBox {
                background: #f3f8ff;
                border: 1px solid #cfe0f6;
                border-radius: 12px;
                padding: 12px;
                font-size: 13px;
            }
        """)

    # ================= TAB LAVORO =================

    def init_tab_lavoro(self):
        layout = QVBoxLayout()

        header = QLabel("SDA Poste Italiane - Gestione Avanzata Turni")
        header.setObjectName("Header")
        header.setAlignment(Qt.AlignCenter)
        layout.addWidget(header)

        mese_layout = QHBoxLayout()
        self.mese_selector = QDateEdit()
        self.mese_selector.setDisplayFormat("MM/yyyy")
        self.mese_selector.setDate(QDate.currentDate())
        self.mese_selector.dateChanged.connect(self.refresh_table)

        refresh_btn = QPushButton("Aggiorna Mese")
        refresh_btn.clicked.connect(self.refresh_table)

        mese_layout.addWidget(QLabel("Mese:"))
        mese_layout.addWidget(self.mese_selector)
        mese_layout.addWidget(refresh_btn)
        mese_layout.addStretch()
        layout.addLayout(mese_layout)

        form_group = QGroupBox("Inserimento Rapido Turno")
        form_layout = QVBoxLayout()

        row_main = QHBoxLayout()
        self.date = QDateEdit()
        self.date.setCalendarPopup(True)
        self.date.setDate(QDate.currentDate())

        self.start = QTimeEdit()
        self.start.setTime(QTime(6, 0))

        self.end = QTimeEdit()
        self.end.setTime(QTime(14, 0))

        row_main.addWidget(QLabel("Data"))
        row_main.addWidget(self.date)
        row_main.addWidget(QLabel("Inizio"))
        row_main.addWidget(self.start)
        row_main.addWidget(QLabel("Fine"))
        row_main.addWidget(self.end)
        form_layout.addLayout(row_main)

        quick_row = QHBoxLayout()
        self.main_quick_shift_combo = QComboBox()
        self.main_quick_shift_combo.setMinimumWidth(330)
        self.refresh_main_quick_shift_combo()

        apply_quick_btn = QPushButton("Applica Turno Rapido")
        apply_quick_btn.clicked.connect(self.apply_main_quick_shift)

        manage_quick_btn = QPushButton("Gestisci Turni Rapidi")
        manage_quick_btn.setObjectName("SecondaryButton")
        manage_quick_btn.clicked.connect(lambda: self.tabs.setCurrentWidget(self.tab_turni_rapidi))

        quick_row.addWidget(QLabel("Turno rapido"))
        quick_row.addWidget(self.main_quick_shift_combo)
        quick_row.addWidget(apply_quick_btn)
        quick_row.addWidget(manage_quick_btn)
        quick_row.addStretch()
        form_layout.addLayout(quick_row)

        row_flags = QHBoxLayout()
        self.festivo = QCheckBox("Festivo lavorato (Goduto +8h automatico)")
        self.festivo_goduto = QCheckBox("Festivo goduto (+8h)")
        self.ferie = QCheckBox("Ferie")
        self.malattia = QCheckBox("Malattia")

        row_flags.addWidget(self.festivo)
        row_flags.addWidget(self.festivo_goduto)
        row_flags.addWidget(self.ferie)
        row_flags.addWidget(self.malattia)
        row_flags.addStretch()
        form_layout.addLayout(row_flags)

        action_row = QHBoxLayout()
        add_btn = QPushButton("Aggiungi Turno")
        add_btn.clicked.connect(self.save_current_entry)

        delete_btn = QPushButton("Elimina Turno Selezionato")
        delete_btn.setObjectName("DangerButton")
        delete_btn.clicked.connect(self.delete_selected_entry)

        action_row.addWidget(add_btn)
        action_row.addWidget(delete_btn)
        action_row.addStretch()
        form_layout.addLayout(action_row)

        self.edit_mode_label = QLabel("Nuovo inserimento: scegli data, orari o turno rapido e premi Aggiungi Turno.")
        self.edit_mode_label.setObjectName("HintLabel")
        form_layout.addWidget(self.edit_mode_label)

        form_group.setLayout(form_layout)
        layout.addWidget(form_group)

        self.table = QTableWidget()
        self.table.setColumnCount(7)
        self.table.setHorizontalHeaderLabels([
            "Data",
            "Inizio",
            "Fine",
            "Ore (HH:MM)",
            "Descrizione",
            "Totale EUR",
            "Dettaglio Ore"
        ])
        self.table.setAlternatingRowColors(True)
        self.table.horizontalHeader().setStretchLastSection(True)
        self.table.setSelectionBehavior(QAbstractItemView.SelectRows)
        self.table.setSelectionMode(QAbstractItemView.SingleSelection)
        self.table.setEditTriggers(QAbstractItemView.NoEditTriggers)
        self.table.cellClicked.connect(self.on_table_cell_clicked)
        layout.addWidget(self.table)

        self.riepilogo = QLabel("")
        self.riepilogo.setObjectName("SummaryBox")
        self.riepilogo.setAlignment(Qt.AlignTop)
        self.riepilogo.setTextInteractionFlags(Qt.TextSelectableByMouse)
        layout.addWidget(self.riepilogo)

        self.tab_lavoro.setLayout(layout)
        self.refresh_table()

    # ================= TAB TURNI RAPIDI =================

    def init_tab_turni_rapidi(self):
        layout = QVBoxLayout()

        header = QLabel("Gestione Turni Rapidi")
        header.setObjectName("Header")
        header.setAlignment(Qt.AlignCenter)
        layout.addWidget(header)

        hint = QLabel("Crea, modifica o elimina preset veloci e applicali al giorno in compilazione.")
        hint.setObjectName("HintLabel")
        layout.addWidget(hint)

        form_group = QGroupBox("Dettaglio Turno Rapido")
        form_layout = QHBoxLayout()

        self.quick_name_input = QLineEdit()
        self.quick_name_input.setPlaceholderText("Nome turno rapido")

        self.quick_start = QTimeEdit()
        self.quick_start.setTime(QTime(6, 0))

        self.quick_end = QTimeEdit()
        self.quick_end.setTime(QTime(14, 0))

        save_quick_btn = QPushButton("Salva / Aggiorna")
        save_quick_btn.clicked.connect(self.save_quick_shift)

        new_quick_btn = QPushButton("Nuovo")
        new_quick_btn.setObjectName("SecondaryButton")
        new_quick_btn.clicked.connect(self.clear_quick_shift_form)

        delete_quick_btn = QPushButton("Elimina")
        delete_quick_btn.setObjectName("DangerButton")
        delete_quick_btn.clicked.connect(self.remove_selected_quick_shift)

        apply_quick_btn = QPushButton("Applica al Giorno")
        apply_quick_btn.clicked.connect(self.apply_selected_quick_shift)

        form_layout.addWidget(QLabel("Nome"))
        form_layout.addWidget(self.quick_name_input)
        form_layout.addWidget(QLabel("Inizio"))
        form_layout.addWidget(self.quick_start)
        form_layout.addWidget(QLabel("Fine"))
        form_layout.addWidget(self.quick_end)
        form_layout.addWidget(save_quick_btn)
        form_layout.addWidget(new_quick_btn)
        form_layout.addWidget(delete_quick_btn)
        form_layout.addWidget(apply_quick_btn)

        form_group.setLayout(form_layout)
        layout.addWidget(form_group)

        self.quick_table = QTableWidget()
        self.quick_table.setColumnCount(3)
        self.quick_table.setHorizontalHeaderLabels(["Nome", "Inizio", "Fine"])
        self.quick_table.setSelectionBehavior(QAbstractItemView.SelectRows)
        self.quick_table.setSelectionMode(QAbstractItemView.SingleSelection)
        self.quick_table.setEditTriggers(QAbstractItemView.NoEditTriggers)
        self.quick_table.setAlternatingRowColors(True)
        self.quick_table.horizontalHeader().setStretchLastSection(True)
        self.quick_table.cellClicked.connect(self.on_quick_shift_table_clicked)
        layout.addWidget(self.quick_table)

        self.tab_turni_rapidi.setLayout(layout)
        self.refresh_quick_shifts_table()
        self.clear_quick_shift_form()

    # ================= TAB REPORT =================

    def init_tab_report(self):
        layout = QVBoxLayout()

        title = QLabel("Report Mensile, Export e Utility")
        title.setObjectName("Header")
        title.setAlignment(Qt.AlignCenter)
        layout.addWidget(title)

        tools = QHBoxLayout()
        export_pdf_btn = QPushButton("Esporta PDF del Mese")
        export_pdf_btn.clicked.connect(self.export_current_month_pdf)

        export_backup_btn = QPushButton("Esporta Backup JSON")
        export_backup_btn.clicked.connect(self.export_backup_json)

        recalc_btn = QPushButton("Ricalcola Tutto lo Storico")
        recalc_btn.clicked.connect(self.recalculate_entire_history)

        tools.addWidget(export_pdf_btn)
        tools.addWidget(export_backup_btn)
        tools.addWidget(recalc_btn)
        tools.addStretch()
        layout.addLayout(tools)

        self.report_text = QTextEdit()
        self.report_text.setReadOnly(True)
        layout.addWidget(self.report_text)

        self.tab_report.setLayout(layout)

    # ================= TAB IMPOSTAZIONI =================

    def init_tab_impostazioni(self):
        layout = QVBoxLayout()
        self.spinboxes = {}

        for key, value in self.settings.items():
            row = QHBoxLayout()
            label = QLabel(key)
            spin = QDoubleSpinBox()
            spin.setMaximum(1000)
            spin.setDecimals(2)
            spin.setValue(value)
            self.spinboxes[key] = spin
            row.addWidget(label)
            row.addWidget(spin)
            layout.addLayout(row)

        save_btn = QPushButton("Salva Impostazioni")
        save_btn.clicked.connect(self.save_settings)

        layout.addWidget(save_btn)
        layout.addStretch()
        self.tab_impostazioni.setLayout(layout)

    # ================= GIORNI MESE =================

    def genera_giorni_mese(self):
        selected_month = self.mese_selector.date().month()
        selected_year = self.mese_selector.date().year()
        giorni = calendar.monthrange(selected_year, selected_month)[1]

        for g in range(1, giorni + 1):
            data_str = datetime(selected_year, selected_month, g).strftime("%Y-%m-%d")
            if not any(entry["date"] == data_str for entry in self.data):
                self.data.append(self.create_empty_entry(data_str))

        self.data.sort(key=lambda x: x["date"])

    # ================= CALCOLO =================

    def calculate(self, date, start, end, festivo, festivo_goduto, ferie, malattia):
        if ferie:
            return "Ferie", self.settings["FERIE"], {"FERIE": 8}, {"FERIE": 8 * 60}
        if malattia:
            return "Malattia", self.settings["MALATTIA"], {"MALATTIA": 8}, {"MALATTIA": 8 * 60}
        if festivo_goduto and not festivo:
            return "Festivo Goduto", self.settings["FESTIVO_GODUTO"], {"FESTIVO_GODUTO": 8}, {"FESTIVO_GODUTO": 8 * 60}

        dettaglio_minuti = {}

        start_dt = datetime.combine(date, start)
        end_dt = datetime.combine(date, end)

        if end_dt <= start_dt:
            end_dt += timedelta(days=1)

        soglia_minuti = int(self.settings["SOGLIA_STRAORDINARIO"] * 60)
        current = start_dt
        minuti_lavorati = 0
        is_saturday = date.weekday() == 5

        while current < end_dt:
            is_night = current.hour >= 22 or current.hour < 6

            if festivo:
                voce = "FESTIVO_NOTTURNO" if is_night else "FESTIVO_GIORNALIERO"
            elif is_saturday:
                voce = "SABATO_NOTTE" if is_night else "SABATO_GIORNO"
            else:
                if minuti_lavorati >= soglia_minuti:
                    voce = "OT_NOTTE" if is_night else "OT_GIORNO"
                else:
                    voce = "BASE_NOTTE" if is_night else "BASE_GIORNO"

            dettaglio_minuti[voce] = dettaglio_minuti.get(voce, 0) + 1
            minuti_lavorati += 1
            current += timedelta(minutes=1)

        descrizione = "Lavorato"
        if festivo:
            dettaglio_minuti["FESTIVO_GODUTO"] = dettaglio_minuti.get("FESTIVO_GODUTO", 0) + (8 * 60)
            descrizione = "Lavorato Festivo (+Goduto)"

        totale = 0
        for voce, minuti in dettaglio_minuti.items():
            tariffa_oraria = self.settings.get(voce, 0)
            totale += (tariffa_oraria / 60) * minuti

        detail_hours = {k: round(v / 60, 2) for k, v in dettaglio_minuti.items()}
        return descrizione, round(totale, 2), detail_hours, dettaglio_minuti

    # ================= REFRESH =================

    def refresh_main_quick_shift_combo(self):
        if not hasattr(self, "main_quick_shift_combo"):
            return

        self.main_quick_shift_combo.blockSignals(True)
        self.main_quick_shift_combo.clear()
        self.main_quick_shift_combo.addItem("Seleziona turno rapido")
        for shift in self.quick_shifts:
            self.main_quick_shift_combo.addItem(f"{shift['name']} ({shift['start']} - {shift['end']})")
        self.main_quick_shift_combo.blockSignals(False)

    def refresh_quick_shifts_table(self):
        if not hasattr(self, "quick_table"):
            return

        self.quick_table.setRowCount(0)
        for shift in self.quick_shifts:
            row = self.quick_table.rowCount()
            self.quick_table.insertRow(row)

            self.quick_table.setItem(row, 0, QTableWidgetItem(shift["name"]))
            self.quick_table.setItem(row, 1, QTableWidgetItem(shift["start"]))
            self.quick_table.setItem(row, 2, QTableWidgetItem(shift["end"]))

    def on_quick_shift_table_clicked(self, row, _column):
        if row < 0 or row >= len(self.quick_shifts):
            return
        shift = self.quick_shifts[row]
        self.current_quick_index = row
        self.quick_name_input.setText(shift["name"])

        start = datetime.strptime(shift["start"], "%H:%M").time()
        end = datetime.strptime(shift["end"], "%H:%M").time()
        self.quick_start.setTime(QTime(start.hour, start.minute))
        self.quick_end.setTime(QTime(end.hour, end.minute))

    def clear_quick_shift_form(self):
        self.current_quick_index = None
        if hasattr(self, "quick_name_input"):
            self.quick_name_input.clear()
        if hasattr(self, "quick_start"):
            self.quick_start.setTime(QTime(6, 0))
        if hasattr(self, "quick_end"):
            self.quick_end.setTime(QTime(14, 0))

    def apply_main_quick_shift(self):
        if not hasattr(self, "main_quick_shift_combo"):
            return

        idx = self.main_quick_shift_combo.currentIndex() - 1
        if idx < 0 or idx >= len(self.quick_shifts):
            QMessageBox.information(self, "Turno rapido", "Seleziona prima un turno rapido.")
            return

        shift = self.quick_shifts[idx]
        start = datetime.strptime(shift["start"], "%H:%M").time()
        end = datetime.strptime(shift["end"], "%H:%M").time()
        self.start.setTime(QTime(start.hour, start.minute))
        self.end.setTime(QTime(end.hour, end.minute))

    def refresh_table(self):
        self.genera_giorni_mese()
        self.table.setRowCount(0)
        self.row_entry_dates = {}

        selected_month = self.mese_selector.date().month()
        selected_year = self.mese_selector.date().year()

        filtered_data = [
            entry for entry in self.data
            if datetime.strptime(entry["date"], "%Y-%m-%d").month == selected_month
            and datetime.strptime(entry["date"], "%Y-%m-%d").year == selected_year
        ]

        filtered_data.sort(key=lambda x: x["date"])

        totale_mese = 0
        riepilogo_minuti = {}
        total_minutes = 0
        giorni_compilati = 0
        last_week = None

        for entry in filtered_data:
            date_obj = datetime.strptime(entry["date"], "%Y-%m-%d")
            week = date_obj.isocalendar()[1]

            if week != last_week:
                row = self.table.rowCount()
                self.table.insertRow(row)
                self.table.setSpan(row, 0, 1, 7)
                self.table.setItem(row, 0, QTableWidgetItem("----- NUOVA SETTIMANA -----"))
                self.row_entry_dates[row] = None
                last_week = week

            row = self.table.rowCount()
            self.table.insertRow(row)

            detail_minutes = self.get_detail_minutes(entry)
            entry_minutes = sum(detail_minutes.values())
            placeholder = self.is_placeholder_entry(entry)
            absence = self.is_absence_entry(entry)

            if not placeholder:
                giorni_compilati += 1

            data_formattata = date_obj.strftime("%d %b").lower()
            if placeholder:
                start_display = "-"
                end_display = "-"
                hours_display = "-"
                desc_display = "Non lavorato"
                total_display = "-"
                detail_display = "-"
            elif absence:
                start_display = "-"
                end_display = "-"
                hours_display = self.minutes_to_hhmm(entry_minutes)
                desc_display = entry.get("desc", "")
                total_display = f"{entry.get('total', 0):.2f}"
                detail_display = self.format_detail(entry)
            else:
                start_display = entry.get("start", "")
                end_display = entry.get("end", "")
                hours_display = self.minutes_to_hhmm(entry_minutes)
                desc_display = entry.get("desc", "")
                total_display = f"{entry.get('total', 0):.2f}"
                detail_display = self.format_detail(entry)

            self.table.setItem(row, 0, QTableWidgetItem(data_formattata))
            self.table.setItem(row, 1, QTableWidgetItem(start_display))
            self.table.setItem(row, 2, QTableWidgetItem(end_display))
            self.table.setItem(row, 3, QTableWidgetItem(hours_display))
            self.table.setItem(row, 4, QTableWidgetItem(desc_display))
            self.table.setItem(row, 5, QTableWidgetItem(total_display))
            self.table.setItem(row, 6, QTableWidgetItem(detail_display))
            self.row_entry_dates[row] = entry["date"]

            totale_mese += float(entry.get("total", 0) or 0)
            total_minutes += entry_minutes
            for k, v in detail_minutes.items():
                riepilogo_minuti[k] = riepilogo_minuti.get(k, 0) + v

        overtime_minutes = (
            riepilogo_minuti.get("OT_GIORNO", 0)
            + riepilogo_minuti.get("OT_NOTTE", 0)
        )

        righe = "\n".join(
            [f"{k}: {self.format_hours(v)}" for k, v in sorted(riepilogo_minuti.items())]
        )

        self.riepilogo.setText(
            f"=== RENDICONTO MESE ===\n\n"
            f"Totale Mese: {totale_mese:.2f} EUR\n"
            f"Ore Totali Retribuite: {self.format_hours(total_minutes)}\n"
            f"Straordinario Totale: {self.format_hours(overtime_minutes)}\n"
            f"Giorni Compilati: {giorni_compilati}\n\n"
            f"Dettaglio Ore:\n{righe if righe else '-'}"
        )

        self.update_report_tab()

    def update_report_tab(self):
        if not hasattr(self, "report_text"):
            return

        selected_month = self.mese_selector.date().month()
        selected_year = self.mese_selector.date().year()

        filtered_data = [
            entry for entry in self.data
            if datetime.strptime(entry["date"], "%Y-%m-%d").month == selected_month
            and datetime.strptime(entry["date"], "%Y-%m-%d").year == selected_year
        ]

        total_eur = 0.0
        total_minutes = 0
        worked_days = 0
        best_day = None
        best_day_total = -1

        for entry in filtered_data:
            total = float(entry.get("total", 0) or 0)
            minutes = sum(self.get_detail_minutes(entry).values())
            total_eur += total
            total_minutes += minutes

            if not self.is_placeholder_entry(entry):
                worked_days += 1

            if total > best_day_total:
                best_day_total = total
                best_day = entry.get("date")

        avg_eur_day = (total_eur / worked_days) if worked_days else 0
        avg_minutes_day = (total_minutes / worked_days) if worked_days else 0

        report = (
            "REPORT MENSILE\n\n"
            f"Mese selezionato: {selected_month:02d}/{selected_year}\n"
            f"Totale EUR: {total_eur:.2f}\n"
            f"Ore totali retribuite: {self.format_hours(total_minutes)}\n"
            f"Giorni compilati: {worked_days}\n"
            f"Media EUR/giorno compilato: {avg_eur_day:.2f}\n"
            f"Media ore/giorno compilato: {self.format_hours(avg_minutes_day)}\n"
            f"Giorno con totale piu alto: {best_day or '-'} ({best_day_total:.2f} EUR)\n\n"
            "FUNZIONI NUOVE DISPONIBILI:\n"
            "- Aggiunta turno senza sovrascrittura automatica\n"
            "- Elimina turno selezionato\n"
            "- Turni rapidi in pagina dedicata + tendina veloce in pagina principale\n"
            "- Export PDF mensile e backup JSON"
        )

        self.report_text.setPlainText(report)

    # ================= AZIONI TURNI =================

    def on_table_cell_clicked(self, row, _column):
        date_str = self.row_entry_dates.get(row)
        if not date_str:
            return

        entry = next((e for e in self.data if e.get("date") == date_str), None)
        if not entry:
            return

        self.current_edit_date = date_str
        self.edit_mode_label.setText(f"Giorno selezionato: {date_str}. Puoi eliminarlo o compilare un altro giorno.")

        date_obj = datetime.strptime(date_str, "%Y-%m-%d")
        self.date.setDate(QDate(date_obj.year, date_obj.month, date_obj.day))

        start_time = self.parse_time_or_default(entry.get("start"), datetime.strptime("06:00", "%H:%M").time())
        end_time = self.parse_time_or_default(entry.get("end"), datetime.strptime("14:00", "%H:%M").time())

        self.start.setTime(QTime(start_time.hour, start_time.minute))
        self.end.setTime(QTime(end_time.hour, end_time.minute))

        self.festivo.setChecked(bool(entry.get("festivo", False)))
        self.festivo_goduto.setChecked(bool(entry.get("festivo_goduto", False)))
        self.ferie.setChecked(bool(entry.get("ferie", False)))
        self.malattia.setChecked(bool(entry.get("malattia", False)))

    def clear_form_for_new_entry(self):
        self.current_edit_date = None
        self.edit_mode_label.setText("Nuovo inserimento: scegli data, orari o turno rapido e premi Aggiungi Turno.")
        self.festivo.setChecked(False)
        self.festivo_goduto.setChecked(False)
        self.ferie.setChecked(False)
        self.malattia.setChecked(False)
        if hasattr(self, "main_quick_shift_combo"):
            self.main_quick_shift_combo.setCurrentIndex(0)

    def apply_selected_quick_shift(self):
        idx = self.current_quick_index
        if idx is None and hasattr(self, "quick_table"):
            selected = self.quick_table.selectedItems()
            if selected:
                idx = selected[0].row()

        if idx is None or idx < 0 or idx >= len(self.quick_shifts):
            QMessageBox.information(self, "Turno rapido", "Seleziona un turno rapido dalla pagina dedicata.")
            return

        shift = self.quick_shifts[idx]
        start = datetime.strptime(shift["start"], "%H:%M").time()
        end = datetime.strptime(shift["end"], "%H:%M").time()
        self.start.setTime(QTime(start.hour, start.minute))
        self.end.setTime(QTime(end.hour, end.minute))

    def remove_selected_quick_shift(self):
        idx = self.current_quick_index
        if idx is None and hasattr(self, "quick_table"):
            selected = self.quick_table.selectedItems()
            if selected:
                idx = selected[0].row()

        if idx is None or idx < 0 or idx >= len(self.quick_shifts):
            QMessageBox.information(self, "Turno rapido", "Seleziona un turno rapido da eliminare.")
            return

        shift = self.quick_shifts[idx]
        reply = QMessageBox.question(
            self,
            "Conferma eliminazione",
            f"Eliminare il turno rapido '{shift['name']}'?",
            QMessageBox.Yes | QMessageBox.No
        )
        if reply == QMessageBox.No:
            return

        self.quick_shifts.pop(idx)
        if not self.quick_shifts:
            self.quick_shifts = self.default_quick_shifts()
        self.current_quick_index = None
        self.refresh_quick_shifts_table()
        self.refresh_main_quick_shift_combo()
        self.clear_quick_shift_form()
        self.save_data()
        QMessageBox.information(self, "Eliminato", "Turno rapido eliminato.")

    def save_quick_shift(self):
        name = self.quick_name_input.text().strip()
        if not name:
            QMessageBox.warning(self, "Nome mancante", "Inserisci un nome per il turno rapido.")
            return

        start = self.quick_start.time().toString("HH:mm")
        end = self.quick_end.time().toString("HH:mm")

        same_name_idx = next(
            (i for i, shift in enumerate(self.quick_shifts) if shift["name"].lower() == name.lower()),
            None
        )

        if self.current_quick_index is not None:
            target_idx = self.current_quick_index
            if same_name_idx is not None and same_name_idx != target_idx:
                QMessageBox.warning(self, "Nome duplicato", "Esiste gia un turno rapido con questo nome.")
                return
            self.quick_shifts[target_idx] = {"name": name, "start": start, "end": end}
        else:
            if same_name_idx is not None:
                reply = QMessageBox.question(
                    self,
                    "Sovrascrivere turno rapido",
                    f"Esiste gia un turno rapido chiamato '{name}'. Vuoi sovrascriverlo?",
                    QMessageBox.Yes | QMessageBox.No
                )
                if reply == QMessageBox.No:
                    return
                self.quick_shifts[same_name_idx] = {"name": name, "start": start, "end": end}
            else:
                self.quick_shifts.append({"name": name, "start": start, "end": end})

        self.save_data()
        self.refresh_quick_shifts_table()
        self.refresh_main_quick_shift_combo()
        self.clear_quick_shift_form()
        QMessageBox.information(self, "Salvato", "Turno rapido salvato.")

    # ================= SALVA / MODIFICA / ELIMINA =================

    def save_current_entry(self):
        new_entry = self.build_entry_from_form()
        existing = next((e for e in self.data if e.get("date") == new_entry["date"]), None)
        if existing and not self.is_placeholder_entry(existing):
            QMessageBox.warning(
                self,
                "Giorno gia inserito",
                "Quel giorno e gia compilato. Eliminalo prima di aggiungere un nuovo turno."
            )
            return

        self.upsert_entry(new_entry)
        self.save_data()
        self.refresh_table()
        self.current_edit_date = None
        self.edit_mode_label.setText("Turno aggiunto. Se devi cambiarlo, selezionalo e usa Elimina.")

    def update_selected_entry(self):
        selected_date = self.current_edit_date or self.get_selected_entry_date()
        if not selected_date:
            QMessageBox.warning(
                self,
                "Selezione mancante",
                "Seleziona un turno dalla tabella prima di usare Modifica."
            )
            return

        new_entry = self.build_entry_from_form()
        self.upsert_entry(new_entry, replace_date=selected_date)
        self.save_data()
        self.refresh_table()
        self.current_edit_date = new_entry["date"]
        self.edit_mode_label.setText(f"Modalita: modifica turno del {new_entry['date']}")
        QMessageBox.information(self, "Modificato", "Turno aggiornato con successo.")

    def delete_selected_entry(self):
        selected_date = self.current_edit_date or self.get_selected_entry_date()
        if not selected_date:
            fallback_date = self.date.date().toPyDate().strftime("%Y-%m-%d")
            fallback_entry = next((e for e in self.data if e.get("date") == fallback_date), None)
            if fallback_entry and not self.is_placeholder_entry(fallback_entry):
                selected_date = fallback_date
        if not selected_date:
            QMessageBox.warning(
                self,
                "Selezione mancante",
                "Seleziona un turno dalla tabella prima di eliminare."
            )
            return

        selected_entry = next((e for e in self.data if e.get("date") == selected_date), None)
        if not selected_entry or self.is_placeholder_entry(selected_entry):
            QMessageBox.information(
                self,
                "Nessun turno",
                "Quel giorno non ha un turno compilato da eliminare."
            )
            return

        reply = QMessageBox.question(
            self,
            "Conferma eliminazione",
            f"Eliminare il turno del {selected_date}?",
            QMessageBox.Yes | QMessageBox.No
        )
        if reply == QMessageBox.No:
            return

        self.data = [e for e in self.data if e.get("date") != selected_date]
        self.save_data()
        self.refresh_table()
        self.clear_form_for_new_entry()
        QMessageBox.information(self, "Eliminato", "Turno eliminato.")

    # ================= EXPORT E UTILITY =================

    def export_current_month_pdf(self):
        selected_month = self.mese_selector.date().month()
        selected_year = self.mese_selector.date().year()

        filtered_data = [
            entry for entry in self.data
            if datetime.strptime(entry["date"], "%Y-%m-%d").month == selected_month
            and datetime.strptime(entry["date"], "%Y-%m-%d").year == selected_year
        ]
        filtered_data.sort(key=lambda x: x["date"])

        all_month_entries = filtered_data

        default_name = f"rendiconto_{selected_year}_{selected_month:02d}.pdf"
        path, _ = QFileDialog.getSaveFileName(
            self,
            "Salva PDF",
            default_name,
            "PDF (*.pdf)"
        )
        if not path:
            return
        if not path.lower().endswith(".pdf"):
            path += ".pdf"

        total_eur = 0.0
        total_minutes = 0
        giorni_compilati = 0
        riepilogo_tipologie = {}
        table_rows = []

        for entry in all_month_entries:
            detail_minutes = self.get_detail_minutes(entry)
            minutes = sum(detail_minutes.values())
            total = float(entry.get("total", 0) or 0)

            date_out = datetime.strptime(entry["date"], "%Y-%m-%d").strftime("%d/%m/%Y")
            placeholder = self.is_placeholder_entry(entry)
            absence = self.is_absence_entry(entry)

            if placeholder:
                start_text = "-"
                end_text = "-"
                ore_text = "-"
                desc_text = "Non lavorato"
                total_text = "-"
                detail_text = "-"
            else:
                giorni_compilati += 1
                total_eur += total
                total_minutes += minutes
                for key, value in detail_minutes.items():
                    riepilogo_tipologie[key] = riepilogo_tipologie.get(key, 0) + value

                start_text = "-" if absence else (entry.get("start", "") or "-")
                end_text = "-" if absence else (entry.get("end", "") or "-")
                ore_text = self.minutes_to_hhmm(minutes)
                desc_text = entry.get("desc", "")
                total_text = f"{total:.2f}"
                detail_text = self.format_detail(entry)

            table_rows.append(
                "<tr>"
                f"<td>{escape(date_out)}</td>"
                f"<td>{escape(start_text)}</td>"
                f"<td>{escape(end_text)}</td>"
                f"<td>{escape(ore_text)}</td>"
                f"<td>{escape(desc_text)}</td>"
                f"<td>{escape(total_text)}</td>"
                f"<td>{escape(detail_text)}</td>"
                "</tr>"
            )

        if not table_rows:
            table_rows.append(
                "<tr><td colspan='7' style='text-align:center; padding:14px;'>"
                "Nessun giorno compilato nel mese selezionato."
                "</td></tr>"
            )

        righe_tipologie = []
        for key in sorted(riepilogo_tipologie.keys()):
            mins = riepilogo_tipologie[key]
            righe_tipologie.append(
                "<tr>"
                f"<td>{escape(key)}</td>"
                f"<td>{escape(self.minutes_to_hhmm(mins))}</td>"
                f"<td>{escape(self.minutes_to_hdot(mins))}</td>"
                "</tr>"
            )
        if not righe_tipologie:
            righe_tipologie.append(
                "<tr><td colspan='3' style='text-align:center; padding:8px;'>Nessun dettaglio ore.</td></tr>"
            )

        html = f"""
        <html>
        <head>
            <meta charset="utf-8">
            <style>
                body {{
                    font-family: 'Segoe UI', Arial, sans-serif;
                    color: #0f172a;
                    font-size: 10pt;
                }}
                h1 {{
                    font-size: 18pt;
                    margin-bottom: 4px;
                    color: #0b5cab;
                }}
                .sub {{
                    font-size: 10pt;
                    color: #334155;
                    margin-bottom: 12px;
                }}
                .summary {{
                    border: 1px solid #cbd5e1;
                    background: #f8fbff;
                    border-radius: 6px;
                    padding: 10px;
                    margin-bottom: 12px;
                }}
                table {{
                    width: 100%;
                    border-collapse: collapse;
                }}
                th {{
                    background: #0b5cab;
                    color: white;
                    font-weight: 600;
                    padding: 6px;
                    border: 1px solid #9fb4ca;
                }}
                td {{
                    border: 1px solid #cfd8e3;
                    padding: 6px;
                    vertical-align: top;
                }}
                tr:nth-child(even) td {{
                    background: #f6faff;
                }}
                .footer {{
                    margin-top: 12px;
                    font-size: 9pt;
                    color: #475569;
                }}
            </style>
        </head>
        <body>
            <h1>Rendiconto Mensile SDA</h1>
            <div class="sub">Mese: {selected_month:02d}/{selected_year}</div>
            <div class="summary">
                <b>Totale EUR:</b> {total_eur:.2f}<br>
                <b>Ore Totali Retribuite:</b> {escape(self.format_hours(total_minutes))}<br>
                <b>Giorni Compilati:</b> {giorni_compilati}
            </div>
            <table>
                <thead>
                    <tr>
                        <th>Data</th>
                        <th>Inizio</th>
                        <th>Fine</th>
                        <th>Ore HH:MM</th>
                        <th>Descrizione</th>
                        <th>Totale EUR</th>
                        <th>Tipologie Ore</th>
                    </tr>
                </thead>
                <tbody>
                    {''.join(table_rows)}
                </tbody>
            </table>
            <h3 style="margin-top:14px; color:#0b5cab;">Riepilogo Tipologia Ore</h3>
            <table>
                <thead>
                    <tr>
                        <th>Tipologia</th>
                        <th>Ore HH:MM</th>
                        <th>Ore h.mm</th>
                    </tr>
                </thead>
                <tbody>
                    {''.join(righe_tipologie)}
                </tbody>
            </table>
            <div class="footer">
                Generato il {datetime.now().strftime('%d/%m/%Y %H:%M')}
            </div>
        </body>
        </html>
        """

        printer = QPrinter(QPrinter.HighResolution)
        printer.setOutputFormat(QPrinter.PdfFormat)
        printer.setOutputFileName(path)
        printer.setPageSize(QPrinter.A4)
        printer.setPageMargins(12, 12, 12, 12, QPrinter.Millimeter)

        document = QTextDocument()
        document.setHtml(html)
        document.print_(printer)

        QMessageBox.information(self, "Export completato", f"PDF salvato in:\n{path}")

    def export_backup_json(self):
        now_tag = datetime.now().strftime("%Y%m%d_%H%M")
        default_name = f"backup_sda_{now_tag}.json"

        path, _ = QFileDialog.getSaveFileName(
            self,
            "Salva Backup JSON",
            default_name,
            "JSON (*.json)"
        )
        if not path:
            return

        payload = {
            "settings": self.settings,
            "quick_shifts": self.quick_shifts,
            "data": self.data
        }
        with open(path, "w", encoding="utf-8") as f:
            json.dump(payload, f, indent=2)

        QMessageBox.information(self, "Backup completato", f"Backup salvato in:\n{path}")

    def recalculate_entire_history(self):
        self.recalculate_all_entries()
        self.save_data()
        self.refresh_table()
        QMessageBox.information(
            self,
            "Ricalcolo completato",
            "Storico ricalcolato usando le impostazioni correnti."
        )

    # ================= SALVATAGGIO DATI =================

    def save_settings(self):
        for key in self.spinboxes:
            self.settings[key] = self.spinboxes[key].value()
        self.recalculate_all_entries()
        self.save_data()
        self.refresh_table()
        QMessageBox.information(
            self,
            "Salvato",
            "Impostazioni aggiornate e storico ricalcolato."
        )

    def save_data(self):
        with open(DATA_FILE, "w", encoding="utf-8") as f:
            json.dump(
                {
                    "settings": self.settings,
                    "quick_shifts": self.quick_shifts,
                    "data": self.data
                },
                f,
                indent=2
            )

    def load_data(self):
        if os.path.exists(DATA_FILE):
            with open(DATA_FILE, "r", encoding="utf-8") as f:
                content = json.load(f)
                self.settings.update(content.get("settings", {}))
                self.quick_shifts = self.sanitize_quick_shifts(content.get("quick_shifts"))
                self.data = content.get("data", [])

                for entry in self.data:
                    self.normalize_entry_flags(entry)
                    entry["detail"] = entry.get("detail", {}) or {}
                    entry["detail_minutes"] = self.get_detail_minutes(entry)
        else:
            self.quick_shifts = self.default_quick_shifts()


if __name__ == "__main__":
    app = QApplication(sys.argv)
    window = SDAApp()
    window.show()
    sys.exit(app.exec_())
