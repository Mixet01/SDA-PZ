import calendar
import copy
import json
import os
import re
import shutil
from functools import wraps
from datetime import date, datetime, time, timedelta
from html import escape
from io import BytesIO
from threading import Lock

from flask import Flask, Response, g, jsonify, render_template, request, send_file, session

try:
    import psycopg
    from psycopg.types.json import Jsonb
except Exception:
    psycopg = None
    Jsonb = None

BASE_DIR = os.path.dirname(os.path.abspath(__file__))
DATA_ROOT = os.environ.get("SDA_DATA_DIR", BASE_DIR).strip() or BASE_DIR
if not os.path.isabs(DATA_ROOT):
    DATA_ROOT = os.path.abspath(os.path.join(BASE_DIR, DATA_ROOT))

DATABASE_URL = os.environ.get("DATABASE_URL", "").strip()
DB_MODE = bool(DATABASE_URL)

DATA_FILE = os.path.join(DATA_ROOT, "dati_sda.json")
USERS_FILE = os.path.join(DATA_ROOT, "utenti_sda.json")
USER_DATA_DIR = os.path.join(DATA_ROOT, "user_data")

DEFAULT_SETTINGS = {
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
    "SOGLIA_STRAORDINARIO": 8,
}

DEFAULT_QUICK_SHIFTS = [
    {"name": "Mattina", "start": "06:00", "end": "14:00"},
    {"name": "Pomeriggio", "start": "14:00", "end": "22:00"},
    {"name": "Notte", "start": "22:00", "end": "06:00"},
    {"name": "Part-time Mattina", "start": "06:00", "end": "12:00"},
    {"name": "Part-time Sera", "start": "18:00", "end": "22:00"},
]


class SDAEngine:
    def __init__(self, data_file, user_email=None):
        self.data_file = data_file
        self.user_email = user_email
        self.settings = copy.deepcopy(DEFAULT_SETTINGS)
        self.data = []
        self.quick_shifts = self.default_quick_shifts()
        self.load_data()

    def default_quick_shifts(self):
        return copy.deepcopy(DEFAULT_QUICK_SHIFTS)

    def parse_time_or_default(self, value, fallback):
        try:
            return datetime.strptime(str(value), "%H:%M").time()
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
        return f"{sign}{total // 60}.{total % 60:02d}"

    def format_detail(self, entry):
        details = self.get_detail_minutes(entry)
        if not details:
            return "-"
        return " | ".join(f"{k}: {self.minutes_to_hhmm(v)}" for k, v in sorted(details.items()))

    def get_detail_minutes(self, entry):
        detail_minutes = entry.get("detail_minutes", {})
        if isinstance(detail_minutes, dict) and detail_minutes:
            out = {}
            for k, v in detail_minutes.items():
                try:
                    out[k] = int(round(float(v)))
                except (TypeError, ValueError):
                    out[k] = 0
            return out
        detail_hours = entry.get("detail", {}) or {}
        out = {}
        for k, v in detail_hours.items():
            try:
                out[k] = int(round(float(v) * 60))
            except (TypeError, ValueError):
                out[k] = 0
        return out

    def normalize_entry_flags(self, entry):
        detail = entry.get("detail", {}) or {}
        desc = (entry.get("desc", "") or "").lower()
        has_festivo_hours = "FESTIVO_GIORNALIERO" in detail or "FESTIVO_NOTTURNO" in detail

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
            "malattia": False,
        }

    def get_entry(self, date_str):
        return next((e for e in self.data if e.get("date") == date_str), None)

    def upsert_entry(self, entry):
        self.data = [e for e in self.data if e.get("date") != entry["date"]]
        self.data.append(entry)
        self.data.sort(key=lambda x: x["date"])

    def remove_entry(self, date_str):
        self.data = [e for e in self.data if e.get("date") != date_str]

    def calculate(self, work_date, start, end, festivo, festivo_goduto, ferie, malattia):
        if ferie:
            return "Ferie", self.settings["FERIE"], {"FERIE": 8}, {"FERIE": 480}
        if malattia:
            return "Malattia", self.settings["MALATTIA"], {"MALATTIA": 8}, {"MALATTIA": 480}
        if festivo_goduto and not festivo:
            return "Festivo Goduto", self.settings["FESTIVO_GODUTO"], {"FESTIVO_GODUTO": 8}, {"FESTIVO_GODUTO": 480}

        details = {}
        start_dt = datetime.combine(work_date, start)
        end_dt = datetime.combine(work_date, end)
        if end_dt <= start_dt:
            end_dt += timedelta(days=1)

        soglia = int(self.settings["SOGLIA_STRAORDINARIO"] * 60)
        current = start_dt
        worked = 0
        is_saturday = work_date.weekday() == 5
        while current < end_dt:
            is_night = current.hour >= 22 or current.hour < 6
            if festivo:
                voce = "FESTIVO_NOTTURNO" if is_night else "FESTIVO_GIORNALIERO"
            elif is_saturday:
                voce = "SABATO_NOTTE" if is_night else "SABATO_GIORNO"
            elif worked >= soglia:
                voce = "OT_NOTTE" if is_night else "OT_GIORNO"
            else:
                voce = "BASE_NOTTE" if is_night else "BASE_GIORNO"
            details[voce] = details.get(voce, 0) + 1
            worked += 1
            current += timedelta(minutes=1)

        desc = "Lavorato"
        if festivo:
            details["FESTIVO_GODUTO"] = details.get("FESTIVO_GODUTO", 0) + 480
            desc = "Lavorato Festivo (+Goduto)"

        total = 0.0
        for voce, minutes in details.items():
            total += (self.settings.get(voce, 0) / 60) * minutes
        return desc, round(total, 2), {k: round(v / 60, 2) for k, v in details.items()}, details

    def build_entry(self, payload):
        date_str = str(payload.get("date", "")).strip()
        if not date_str:
            raise ValueError("Data mancante.")
        parsed_date = datetime.strptime(date_str, "%Y-%m-%d").date()

        festivo = bool(payload.get("festivo", False))
        festivo_goduto = bool(payload.get("festivo_goduto", False))
        ferie = bool(payload.get("ferie", False))
        malattia = bool(payload.get("malattia", False))
        start = self.parse_time_or_default(payload.get("start"), time(6, 0))
        end = self.parse_time_or_default(payload.get("end"), time(14, 0))

        desc, total, detail, detail_minutes = self.calculate(parsed_date, start, end, festivo, festivo_goduto, ferie, malattia)
        start_str = "" if (ferie or malattia or (festivo_goduto and not festivo)) else start.strftime("%H:%M")
        end_str = "" if (ferie or malattia or (festivo_goduto and not festivo)) else end.strftime("%H:%M")
        return {
            "date": parsed_date.strftime("%Y-%m-%d"),
            "start": start_str,
            "end": end_str,
            "desc": desc,
            "total": total,
            "detail": detail,
            "detail_minutes": detail_minutes,
            "festivo": festivo,
            "festivo_goduto": festivo_goduto,
            "ferie": ferie,
            "malattia": malattia,
        }

    def generate_month_days(self, month, year):
        days = calendar.monthrange(year, month)[1]
        for g in range(1, days + 1):
            d = datetime(year, month, g).strftime("%Y-%m-%d")
            if not any(entry.get("date") == d for entry in self.data):
                self.data.append(self.create_empty_entry(d))
        self.data.sort(key=lambda x: x["date"])

    def get_month_entries(self, month, year):
        self.generate_month_days(month, year)
        items = [e for e in self.data if datetime.strptime(e["date"], "%Y-%m-%d").month == month and datetime.strptime(e["date"], "%Y-%m-%d").year == year]
        items.sort(key=lambda x: x["date"])
        return items

    def build_month_view(self, month, year):
        entries = self.get_month_entries(month, year)
        rows = []
        total_eur = 0.0
        total_minutes = 0
        worked_days = 0
        by_type = {}
        last_week = None
        for entry in entries:
            d_obj = datetime.strptime(entry["date"], "%Y-%m-%d")
            week = d_obj.isocalendar()[1]
            if week != last_week:
                rows.append({"type": "week", "label": "----- NUOVA SETTIMANA -----"})
                last_week = week

            details = self.get_detail_minutes(entry)
            minutes = sum(details.values())
            placeholder = self.is_placeholder_entry(entry)
            absence = self.is_absence_entry(entry)

            if not placeholder:
                worked_days += 1
            total_eur += float(entry.get("total", 0) or 0)
            total_minutes += minutes
            for k, v in details.items():
                by_type[k] = by_type.get(k, 0) + v

            if placeholder:
                start_disp, end_disp, ore_disp, desc_disp, tot_disp, det_disp = "-", "-", "-", "Non lavorato", "-", "-"
            else:
                start_disp = "-" if absence else (entry.get("start", "") or "-")
                end_disp = "-" if absence else (entry.get("end", "") or "-")
                ore_disp = self.minutes_to_hhmm(minutes)
                desc_disp = entry.get("desc", "")
                tot_disp = f"{entry.get('total', 0):.2f}"
                det_disp = self.format_detail(entry)

            rows.append(
                {
                    "type": "entry",
                    "date": entry["date"],
                    "display_date": d_obj.strftime("%d %b").lower(),
                    "start_display": start_disp,
                    "end_display": end_disp,
                    "hours_display": ore_disp,
                    "desc_display": desc_disp,
                    "total_display": tot_disp,
                    "detail_display": det_disp,
                    "entry": entry,
                }
            )

        straordinario = by_type.get("OT_GIORNO", 0) + by_type.get("OT_NOTTE", 0)
        detail_lines = "\n".join(f"{k}: {self.minutes_to_hhmm(v)}" for k, v in sorted(by_type.items()))
        summary_text = (
            "=== RENDICONTO MESE ===\n\n"
            f"Totale Mese: {total_eur:.2f} EUR\n"
            f"Ore Totali Retribuite: {self.minutes_to_hhmm(total_minutes)}\n"
            f"Straordinario Totale: {self.minutes_to_hhmm(straordinario)}\n"
            f"Giorni Compilati: {worked_days}\n\n"
            f"Dettaglio Ore:\n{detail_lines if detail_lines else '-'}"
        )
        return {"rows": rows, "summary_text": summary_text, "report_text": self.build_report(entries, month, year)}

    def build_report(self, entries, month, year):
        total_eur = 0.0
        total_minutes = 0
        worked_days = 0
        best_day = None
        best_total = -1.0
        for entry in entries:
            total = float(entry.get("total", 0) or 0)
            minutes = sum(self.get_detail_minutes(entry).values())
            total_eur += total
            total_minutes += minutes
            if not self.is_placeholder_entry(entry):
                worked_days += 1
            if total > best_total:
                best_total = total
                best_day = entry.get("date")
        avg_eur = total_eur / worked_days if worked_days else 0
        avg_minutes = total_minutes / worked_days if worked_days else 0
        return (
            "REPORT MENSILE\n\n"
            f"Mese selezionato: {month:02d}/{year}\n"
            f"Totale EUR: {total_eur:.2f}\n"
            f"Ore totali retribuite: {self.minutes_to_hhmm(total_minutes)}\n"
            f"Giorni compilati: {worked_days}\n"
            f"Media EUR/giorno compilato: {avg_eur:.2f}\n"
            f"Media ore/giorno compilato: {self.minutes_to_hhmm(avg_minutes)}\n"
            f"Giorno con totale piu alto: {best_day or '-'} ({best_total:.2f} EUR)\n\n"
            "FUNZIONI NUOVE DISPONIBILI:\n"
            "- Aggiunta turno senza sovrascrittura automatica\n"
            "- Elimina turno selezionato\n"
            "- Turni rapidi in pagina dedicata + tendina veloce in pagina principale\n"
            "- Export PDF mensile e backup JSON"
        )

    def build_export_html(self, month, year, auto_print=False):
        entries = self.get_month_entries(month, year)
        total_eur = 0.0
        total_minutes = 0
        days = 0
        by_type = {}
        rows = []
        for entry in entries:
            details = self.get_detail_minutes(entry)
            minutes = sum(details.values())
            total = float(entry.get("total", 0) or 0)
            date_out = datetime.strptime(entry["date"], "%Y-%m-%d").strftime("%d/%m/%Y")
            placeholder = self.is_placeholder_entry(entry)
            absence = self.is_absence_entry(entry)
            if placeholder:
                s, e, o, d, t, det = "-", "-", "-", "Non lavorato", "-", "-"
            else:
                days += 1
                total_eur += total
                total_minutes += minutes
                for k, v in details.items():
                    by_type[k] = by_type.get(k, 0) + v
                s = "-" if absence else (entry.get("start", "") or "-")
                e = "-" if absence else (entry.get("end", "") or "-")
                o = self.minutes_to_hhmm(minutes)
                d = entry.get("desc", "")
                t = f"{total:.2f}"
                det = self.format_detail(entry)
            rows.append(f"<tr><td>{escape(date_out)}</td><td>{escape(s)}</td><td>{escape(e)}</td><td>{escape(o)}</td><td>{escape(d)}</td><td>{escape(t)}</td><td>{escape(det)}</td></tr>")

        by_type_rows = "".join(
            f"<tr><td>{escape(k)}</td><td>{escape(self.minutes_to_hhmm(v))}</td><td>{escape(self.minutes_to_hdot(v))}</td></tr>"
            for k, v in sorted(by_type.items())
        ) or "<tr><td colspan='3' style='text-align:center;'>Nessun dettaglio ore.</td></tr>"
        row_html = "".join(rows) or "<tr><td colspan='7' style='text-align:center;'>Nessun giorno compilato nel mese selezionato.</td></tr>"
        print_script = "<script>window.addEventListener('load',()=>window.print());</script>" if auto_print else ""
        return f"""<!doctype html><html><head><meta charset='utf-8'><title>Rendiconto Mensile SDA</title>
<style>body{{font-family:'Segoe UI',Arial,sans-serif;color:#0f172a;font-size:10pt}}h1{{font-size:18pt;margin-bottom:4px;color:#0b5cab}}.sub{{font-size:10pt;color:#334155;margin-bottom:12px}}.summary{{border:1px solid #cbd5e1;background:#f8fbff;border-radius:6px;padding:10px;margin-bottom:12px}}table{{width:100%;border-collapse:collapse}}th{{background:#0b5cab;color:#fff;font-weight:600;padding:6px;border:1px solid #9fb4ca}}td{{border:1px solid #cfd8e3;padding:6px;vertical-align:top}}tr:nth-child(even) td{{background:#f6faff}}.footer{{margin-top:12px;font-size:9pt;color:#475569}}</style></head>
<body><h1>Rendiconto Mensile SDA</h1><div class='sub'>Mese: {month:02d}/{year}</div><div class='summary'><b>Totale EUR:</b> {total_eur:.2f}<br><b>Ore Totali Retribuite:</b> {escape(self.minutes_to_hhmm(total_minutes))}<br><b>Giorni Compilati:</b> {days}</div><table><thead><tr><th>Data</th><th>Inizio</th><th>Fine</th><th>Ore HH:MM</th><th>Descrizione</th><th>Totale EUR</th><th>Tipologie Ore</th></tr></thead><tbody>{row_html}</tbody></table><h3 style='margin-top:14px;color:#0b5cab;'>Riepilogo Tipologia Ore</h3><table><thead><tr><th>Tipologia</th><th>Ore HH:MM</th><th>Ore h.mm</th></tr></thead><tbody>{by_type_rows}</tbody></table><div class='footer'>Generato il {datetime.now().strftime('%d/%m/%Y %H:%M')}</div>{print_script}</body></html>"""

    def recalculate_all(self):
        updated = []
        for entry in sorted(self.data, key=lambda x: x.get("date", "")):
            if self.is_placeholder_entry(entry):
                self.normalize_entry_flags(entry)
                updated.append(entry)
                continue
            self.normalize_entry_flags(entry)
            payload = {
                "date": entry.get("date", ""),
                "start": entry.get("start", ""),
                "end": entry.get("end", ""),
                "festivo": bool(entry.get("festivo", False)),
                "festivo_goduto": bool(entry.get("festivo_goduto", False)),
                "ferie": bool(entry.get("ferie", False)),
                "malattia": bool(entry.get("malattia", False)),
            }
            updated.append(self.build_entry(payload))
        self.data = sorted(updated, key=lambda x: x.get("date", ""))

    def to_payload(self):
        return {
            "settings": self.settings,
            "quick_shifts": self.quick_shifts,
            "data": self.data,
        }

    def apply_payload(self, payload):
        content = payload or {}
        self.settings = copy.deepcopy(DEFAULT_SETTINGS)
        self.settings.update(content.get("settings", {}))
        self.quick_shifts = self.sanitize_quick_shifts(content.get("quick_shifts"))
        self.data = content.get("data", [])
        for entry in self.data:
            self.normalize_entry_flags(entry)
            entry["detail"] = entry.get("detail", {}) or {}
            entry["detail_minutes"] = self.get_detail_minutes(entry)

    def save_data(self):
        if DB_MODE and self.user_email:
            db_save_user_payload(self.user_email, self.to_payload())
            return
        with open(self.data_file, "w", encoding="utf-8") as f:
            json.dump(self.to_payload(), f, indent=2)

    def load_data(self):
        if DB_MODE and self.user_email:
            payload = db_load_user_payload(self.user_email)
            self.apply_payload(payload)
            return
        if not os.path.exists(self.data_file):
            self.quick_shifts = self.default_quick_shifts()
            return
        with open(self.data_file, "r", encoding="utf-8") as f:
            payload = json.load(f)
        self.apply_payload(payload)


app = Flask(__name__, template_folder=os.path.join(BASE_DIR, "templates"), static_folder=os.path.join(BASE_DIR, "static"))
app.secret_key = os.environ.get("SDA_WEB_SECRET", "change-me-in-production")
app.config["PERMANENT_SESSION_LIFETIME"] = timedelta(days=30)

GOOGLE_CLIENT_ID = os.environ.get("GOOGLE_CLIENT_ID", "").strip()
lock = Lock()

os.makedirs(USER_DATA_DIR, exist_ok=True)


def default_user_payload():
    return {
        "settings": copy.deepcopy(DEFAULT_SETTINGS),
        "quick_shifts": copy.deepcopy(DEFAULT_QUICK_SHIFTS),
        "data": [],
    }


def db_connect():
    if psycopg is None:
        raise RuntimeError("Driver PostgreSQL non disponibile. Installa 'psycopg[binary]'.")
    return psycopg.connect(DATABASE_URL, autocommit=True, prepare_threshold=None)


def ensure_db_schema():
    if not DB_MODE:
        return
    with db_connect() as conn:
        with conn.cursor() as cur:
            cur.execute(
                """
                CREATE TABLE IF NOT EXISTS app_users (
                    email TEXT PRIMARY KEY,
                    name TEXT NOT NULL,
                    picture TEXT NOT NULL DEFAULT '',
                    role TEXT NOT NULL DEFAULT 'user',
                    approved BOOLEAN NOT NULL DEFAULT FALSE,
                    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
                    last_login TIMESTAMPTZ NOT NULL DEFAULT NOW()
                )
                """
            )
            cur.execute(
                """
                CREATE TABLE IF NOT EXISTS app_user_payloads (
                    email TEXT PRIMARY KEY REFERENCES app_users(email) ON DELETE CASCADE,
                    payload JSONB NOT NULL,
                    updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
                )
                """
            )


def db_load_users_registry():
    with db_connect() as conn:
        with conn.cursor() as cur:
            cur.execute(
                """
                SELECT email, name, picture, role, approved, created_at, last_login
                FROM app_users
                ORDER BY email
                """
            )
            rows = cur.fetchall()
    users = []
    for row in rows:
        users.append(
            {
                "email": row[0],
                "name": row[1],
                "picture": row[2] or "",
                "role": row[3] or "user",
                "approved": bool(row[4]),
                "created_at": row[5].isoformat(timespec="seconds") if row[5] else "",
                "last_login": row[6].isoformat(timespec="seconds") if row[6] else "",
            }
        )
    return {"users": users}


def db_save_user_record(user):
    with db_connect() as conn:
        with conn.cursor() as cur:
            cur.execute(
                """
                INSERT INTO app_users (email, name, picture, role, approved, created_at, last_login)
                VALUES (%s, %s, %s, %s, %s, COALESCE(%s, NOW()), COALESCE(%s, NOW()))
                ON CONFLICT (email) DO UPDATE SET
                    name = EXCLUDED.name,
                    picture = EXCLUDED.picture,
                    role = EXCLUDED.role,
                    approved = EXCLUDED.approved,
                    last_login = EXCLUDED.last_login
                """,
                (
                    user["email"],
                    user.get("name") or user["email"],
                    user.get("picture", ""),
                    user.get("role", "user"),
                    bool(user.get("approved", False)),
                    user.get("created_at"),
                    user.get("last_login"),
                ),
            )


def db_load_user_payload(email):
    email = normalize_email(email)
    with db_connect() as conn:
        with conn.cursor() as cur:
            cur.execute("SELECT payload FROM app_user_payloads WHERE email=%s", (email,))
            row = cur.fetchone()

    if not row:
        payload = default_user_payload()
        db_save_user_payload(email, payload)
        return payload

    raw = row[0]
    if isinstance(raw, dict):
        return raw
    if isinstance(raw, str):
        try:
            return json.loads(raw)
        except Exception:
            return default_user_payload()
    return default_user_payload()


def db_save_user_payload(email, payload):
    email = normalize_email(email)
    safe_payload = payload or default_user_payload()
    with db_connect() as conn:
        with conn.cursor() as cur:
            cur.execute(
                """
                INSERT INTO app_user_payloads (email, payload, updated_at)
                VALUES (%s, %s, NOW())
                ON CONFLICT (email) DO UPDATE SET
                    payload = EXCLUDED.payload,
                    updated_at = NOW()
                """,
                (email, Jsonb(safe_payload)),
            )


def bootstrap_data_root():
    if DB_MODE:
        ensure_db_schema()
        legacy_users_file = os.path.join(BASE_DIR, "utenti_sda.json")
        legacy_user_dir = os.path.join(BASE_DIR, "user_data")
        legacy_main_data = os.path.join(BASE_DIR, "dati_sda.json")

        with db_connect() as conn:
            with conn.cursor() as cur:
                cur.execute("SELECT COUNT(*) FROM app_users")
                count = int(cur.fetchone()[0] or 0)

        if count > 0:
            return

        legacy_users = []
        if os.path.exists(legacy_users_file):
            with open(legacy_users_file, "r", encoding="utf-8") as f:
                content = json.load(f)
            legacy_users = content.get("users", []) if isinstance(content, dict) else []

        for user in legacy_users:
            email = str(user.get("email") or "").strip().lower()
            if not email:
                continue
            db_save_user_record(
                {
                    "email": email,
                    "name": user.get("name") or email,
                    "picture": user.get("picture", ""),
                    "role": user.get("role", "user"),
                    "approved": bool(user.get("approved", False)),
                    "created_at": user.get("created_at"),
                    "last_login": user.get("last_login"),
                }
            )

            payload = None
            safe_slug = re.sub(r"[^a-zA-Z0-9_.-]", "_", email) or "user"
            candidate = os.path.join(legacy_user_dir, f"dati_{safe_slug}.json")
            if os.path.exists(candidate):
                with open(candidate, "r", encoding="utf-8") as f:
                    payload = json.load(f)
            elif os.path.exists(legacy_main_data):
                with open(legacy_main_data, "r", encoding="utf-8") as f:
                    payload = json.load(f)
            else:
                payload = default_user_payload()
            db_save_user_payload(email, payload)
        return

    legacy_data = os.path.join(BASE_DIR, "dati_sda.json")
    legacy_users = os.path.join(BASE_DIR, "utenti_sda.json")
    legacy_user_dir = os.path.join(BASE_DIR, "user_data")

    if DATA_ROOT != BASE_DIR:
        if not os.path.exists(DATA_FILE) and os.path.exists(legacy_data):
            shutil.copyfile(legacy_data, DATA_FILE)
        if not os.path.exists(USERS_FILE) and os.path.exists(legacy_users):
            shutil.copyfile(legacy_users, USERS_FILE)
        if os.path.isdir(legacy_user_dir):
            os.makedirs(USER_DATA_DIR, exist_ok=True)
            for name in os.listdir(legacy_user_dir):
                src = os.path.join(legacy_user_dir, name)
                dst = os.path.join(USER_DATA_DIR, name)
                if os.path.isfile(src) and not os.path.exists(dst):
                    shutil.copyfile(src, dst)


def month_year_from_request():
    today = date.today()
    try:
        month = int(request.args.get("month", today.month))
        year = int(request.args.get("year", today.year))
    except (TypeError, ValueError):
        month, year = today.month, today.year
    return max(1, min(12, month)), max(1900, min(3000, year))


bootstrap_data_root()


def normalize_email(value):
    return str(value or "").strip().lower()


def user_slug(email):
    safe = re.sub(r"[^a-zA-Z0-9_.-]", "_", normalize_email(email))
    return safe or "user"


def user_data_path(email):
    return os.path.join(USER_DATA_DIR, f"dati_{user_slug(email)}.json")


def load_users_registry():
    if DB_MODE:
        return db_load_users_registry()
    if not os.path.exists(USERS_FILE):
        return {"users": []}
    with open(USERS_FILE, "r", encoding="utf-8") as f:
        data = json.load(f)
    if not isinstance(data.get("users"), list):
        data["users"] = []
    return data


def save_users_registry(registry):
    if DB_MODE:
        for user in registry.get("users", []):
            db_save_user_record(user)
        return
    with open(USERS_FILE, "w", encoding="utf-8") as f:
        json.dump(registry, f, indent=2, ensure_ascii=False)


def find_user(registry, email):
    email = normalize_email(email)
    return next((u for u in registry["users"] if normalize_email(u.get("email")) == email), None)


def ensure_user_data_seed(email, is_first_user):
    if DB_MODE:
        payload = db_load_user_payload(email)
        if is_first_user and payload == default_user_payload() and os.path.exists(DATA_FILE):
            with open(DATA_FILE, "r", encoding="utf-8") as f:
                legacy = json.load(f)
            db_save_user_payload(email, legacy)
        return
    path = user_data_path(email)
    if os.path.exists(path):
        return
    if is_first_user and os.path.exists(DATA_FILE):
        shutil.copyfile(DATA_FILE, path)


def register_or_update_user(email, name, picture):
    registry = load_users_registry()
    now = datetime.now().isoformat(timespec="seconds")
    email = normalize_email(email)
    user = find_user(registry, email)

    is_new = False
    is_first = False
    if user is None:
        is_new = True
        is_first = len(registry["users"]) == 0
        user = {
            "email": email,
            "name": name or email,
            "picture": picture or "",
            "role": "admin" if is_first else "user",
            "approved": True if is_first else False,
            "created_at": now,
            "last_login": now,
        }
        registry["users"].append(user)
    else:
        user["name"] = name or user.get("name") or email
        user["picture"] = picture or user.get("picture", "")
        user["last_login"] = now

    save_users_registry(registry)
    ensure_user_data_seed(email, is_first_user=is_first)
    return user


def get_user_from_session():
    email = normalize_email(session.get("user_email"))
    if not email:
        return None
    registry = load_users_registry()
    user = find_user(registry, email)
    if not user:
        session.pop("user_email", None)
    return user


def login_required(approved_only=True):
    def decorator(fn):
        @wraps(fn)
        def wrapped(*args, **kwargs):
            user = get_user_from_session()
            if not user:
                return jsonify({"ok": False, "message": "Login richiesto.", "error_code": "LOGIN_REQUIRED"}), 401
            if approved_only and not user.get("approved", False):
                return jsonify({"ok": False, "message": "In attesa di approvazione amministratore.", "error_code": "PENDING_APPROVAL"}), 403
            g.current_user = user
            return fn(*args, **kwargs)

        return wrapped

    return decorator


def admin_required(fn):
    @wraps(fn)
    @login_required(approved_only=True)
    def wrapped(*args, **kwargs):
        user = g.current_user
        if user.get("role") != "admin":
            return jsonify({"ok": False, "message": "Permessi admin richiesti."}), 403
        return fn(*args, **kwargs)

    return wrapped


def get_engine_for(email):
    path = user_data_path(email)
    return SDAEngine(path, user_email=email)


def resolve_view_user(current_user):
    target = normalize_email(current_user["email"])
    can_edit = True
    requested = normalize_email(request.args.get("view_user"))
    if requested and requested != target and current_user.get("role") == "admin":
        reg = load_users_registry()
        if find_user(reg, requested):
            target = requested
            can_edit = False
    return target, can_edit


@app.get("/")
def index():
    today = date.today()
    return render_template(
        "index.html",
        today_date=today.strftime("%Y-%m-%d"),
        current_month=today.strftime("%Y-%m"),
        google_client_id=GOOGLE_CLIENT_ID,
    )


@app.get("/api/me")
def api_me():
    user = get_user_from_session()
    return jsonify(
        {
            "ok": True,
            "logged_in": bool(user),
            "google_enabled": bool(GOOGLE_CLIENT_ID),
            "user": user,
        }
    )


@app.post("/auth/google")
def auth_google():
    payload = request.get_json(silent=True) or {}
    credential = str(payload.get("credential", "")).strip()
    if not credential:
        return jsonify({"ok": False, "message": "Token Google mancante."}), 400
    if not GOOGLE_CLIENT_ID:
        return jsonify({"ok": False, "message": "GOOGLE_CLIENT_ID non configurato lato server."}), 400

    try:
        from google.auth.transport import requests as google_requests
        from google.oauth2 import id_token
    except Exception as exc:
        return jsonify({"ok": False, "message": f"Dipendenze Google mancanti ({exc}). Reinstalla requirements-web.txt."}), 500

    try:
        info = id_token.verify_oauth2_token(credential, google_requests.Request(), GOOGLE_CLIENT_ID)
    except Exception:
        return jsonify({"ok": False, "message": "Token Google non valido."}), 401

    email = normalize_email(info.get("email"))
    if not email or not info.get("email_verified", False):
        return jsonify({"ok": False, "message": "Email Google non verificata."}), 401

    name = str(info.get("name") or email)
    picture = str(info.get("picture") or "")
    with lock:
        user = register_or_update_user(email, name, picture)
    session["user_email"] = email
    session.permanent = True
    return jsonify({"ok": True, "user": user})


@app.post("/auth/dev-login")
def auth_dev_login():
    if GOOGLE_CLIENT_ID:
        return jsonify({"ok": False, "message": "Dev login disabilitato quando Google e configurato."}), 403
    payload = request.get_json(silent=True) or {}
    email = normalize_email(payload.get("email"))
    name = str(payload.get("name") or email)
    if not email:
        return jsonify({"ok": False, "message": "Email obbligatoria."}), 400
    with lock:
        user = register_or_update_user(email, name, "")
    session["user_email"] = email
    session.permanent = True
    return jsonify({"ok": True, "user": user})


@app.post("/auth/logout")
def auth_logout():
    session.clear()
    return jsonify({"ok": True})


@app.get("/api/state")
@login_required(approved_only=True)
def api_state():
    month, year = month_year_from_request()
    current_user = g.current_user
    target_email, can_edit = resolve_view_user(current_user)

    with lock:
        engine = get_engine_for(target_email)
        view = engine.build_month_view(month, year)
    return jsonify(
        {
            "ok": True,
            "month": month,
            "year": year,
            "view": view,
            "quick_shifts": engine.quick_shifts,
            "settings": engine.settings,
            "viewer_email": current_user["email"],
            "viewing_email": target_email,
            "can_edit": can_edit,
        }
    )


@app.post("/api/entry")
@login_required(approved_only=True)
def api_add_entry():
    email = g.current_user["email"]
    payload = request.get_json(silent=True) or {}
    with lock:
        engine = get_engine_for(email)
        try:
            entry = engine.build_entry(payload)
        except ValueError as exc:
            return jsonify({"ok": False, "message": str(exc)}), 400
        existing = engine.get_entry(entry["date"])
        if existing and not engine.is_placeholder_entry(existing):
            return jsonify({"ok": False, "message": "Quel giorno e gia compilato. Eliminalo prima di aggiungere un nuovo turno."}), 409
        engine.upsert_entry(entry)
        engine.save_data()
    return jsonify({"ok": True, "message": "Turno aggiunto."})


@app.delete("/api/entry/<date_str>")
@login_required(approved_only=True)
def api_delete_entry(date_str):
    email = g.current_user["email"]
    with lock:
        engine = get_engine_for(email)
        existing = engine.get_entry(date_str)
        if not existing or engine.is_placeholder_entry(existing):
            return jsonify({"ok": False, "message": "Quel giorno non ha un turno compilato da eliminare."}), 404
        engine.remove_entry(date_str)
        engine.save_data()
    return jsonify({"ok": True, "message": "Turno eliminato."})


@app.post("/api/quick-shift")
@login_required(approved_only=True)
def api_quick_shift():
    email = g.current_user["email"]
    payload = request.get_json(silent=True) or {}
    name = str(payload.get("name", "")).strip()
    start = str(payload.get("start", "")).strip()
    end = str(payload.get("end", "")).strip()
    idx = payload.get("index")
    overwrite = bool(payload.get("overwrite", False))
    if not name:
        return jsonify({"ok": False, "message": "Inserisci un nome per il turno rapido."}), 400
    try:
        datetime.strptime(start, "%H:%M")
        datetime.strptime(end, "%H:%M")
    except ValueError:
        return jsonify({"ok": False, "message": "Orario non valido. Usa formato HH:MM."}), 400

    with lock:
        engine = get_engine_for(email)
        same = next((i for i, s in enumerate(engine.quick_shifts) if s["name"].lower() == name.lower()), None)
        if isinstance(idx, int):
            if idx < 0 or idx >= len(engine.quick_shifts):
                return jsonify({"ok": False, "message": "Indice turno rapido non valido."}), 400
            if same is not None and same != idx:
                return jsonify({"ok": False, "message": "Esiste gia un turno rapido con questo nome."}), 409
            engine.quick_shifts[idx] = {"name": name, "start": start, "end": end}
        else:
            if same is not None and not overwrite:
                return jsonify({"ok": False, "error_code": "DUPLICATE_NAME", "message": f"Esiste gia un turno rapido chiamato '{name}'. Vuoi sovrascriverlo?"}), 409
            if same is not None:
                engine.quick_shifts[same] = {"name": name, "start": start, "end": end}
            else:
                engine.quick_shifts.append({"name": name, "start": start, "end": end})
        engine.save_data()
    return jsonify({"ok": True, "message": "Turno rapido salvato."})


@app.delete("/api/quick-shift/<int:idx>")
@login_required(approved_only=True)
def api_delete_quick_shift(idx):
    email = g.current_user["email"]
    with lock:
        engine = get_engine_for(email)
        if idx < 0 or idx >= len(engine.quick_shifts):
            return jsonify({"ok": False, "message": "Seleziona un turno rapido da eliminare."}), 404
        engine.quick_shifts.pop(idx)
        if not engine.quick_shifts:
            engine.quick_shifts = engine.default_quick_shifts()
        engine.save_data()
    return jsonify({"ok": True, "message": "Turno rapido eliminato."})


@app.post("/api/settings")
@login_required(approved_only=True)
def api_settings():
    email = g.current_user["email"]
    payload = request.get_json(silent=True) or {}
    incoming = payload.get("settings", {})
    if not isinstance(incoming, dict):
        return jsonify({"ok": False, "message": "Formato impostazioni non valido."}), 400
    with lock:
        engine = get_engine_for(email)
        for key in engine.settings:
            if key in incoming:
                try:
                    engine.settings[key] = float(incoming[key])
                except (TypeError, ValueError):
                    pass
        engine.recalculate_all()
        engine.save_data()
    return jsonify({"ok": True, "message": "Impostazioni aggiornate e storico ricalcolato."})


@app.post("/api/recalculate")
@login_required(approved_only=True)
def api_recalculate():
    email = g.current_user["email"]
    with lock:
        engine = get_engine_for(email)
        engine.recalculate_all()
        engine.save_data()
    return jsonify({"ok": True, "message": "Storico ricalcolato usando le impostazioni correnti."})


@app.get("/api/export-backup")
@login_required(approved_only=True)
def api_export_backup():
    current_user = g.current_user
    target_email, _can_edit = resolve_view_user(current_user)
    now_tag = datetime.now().strftime("%Y%m%d_%H%M")
    with lock:
        engine = get_engine_for(target_email)
        payload = {"settings": engine.settings, "quick_shifts": engine.quick_shifts, "data": engine.data}
    raw = json.dumps(payload, indent=2, ensure_ascii=False).encode("utf-8")
    return send_file(BytesIO(raw), mimetype="application/json", as_attachment=True, download_name=f"backup_sda_{user_slug(target_email)}_{now_tag}.json")


@app.get("/api/export-month-html")
@login_required(approved_only=True)
def api_export_month():
    current_user = g.current_user
    target_email, _can_edit = resolve_view_user(current_user)
    month, year = month_year_from_request()
    auto_print = request.args.get("print") == "1"
    with lock:
        engine = get_engine_for(target_email)
        html = engine.build_export_html(month, year, auto_print=auto_print)
    return Response(html, mimetype="text/html; charset=utf-8")


@app.get("/api/admin/users")
@admin_required
def api_admin_users():
    registry = load_users_registry()
    users_out = []
    with lock:
        for user in registry["users"]:
            engine = get_engine_for(user["email"])
            compiled_days = sum(1 for entry in engine.data if not engine.is_placeholder_entry(entry))
            users_out.append(
                {
                    "email": user["email"],
                    "name": user.get("name", user["email"]),
                    "picture": user.get("picture", ""),
                    "role": user.get("role", "user"),
                    "approved": bool(user.get("approved", False)),
                    "created_at": user.get("created_at", ""),
                    "last_login": user.get("last_login", ""),
                    "compiled_days": compiled_days,
                }
            )
    users_out.sort(key=lambda x: x["email"])
    return jsonify({"ok": True, "users": users_out})


@app.post("/api/admin/users/<path:email>/approval")
@admin_required
def api_admin_set_approval(email):
    target_email = normalize_email(email)
    payload = request.get_json(silent=True) or {}
    approved = bool(payload.get("approved", False))
    current_user = g.current_user
    if target_email == normalize_email(current_user["email"]) and not approved:
        return jsonify({"ok": False, "message": "Non puoi revocare l'approvazione del tuo account admin."}), 400

    with lock:
        registry = load_users_registry()
        target = find_user(registry, target_email)
        if not target:
            return jsonify({"ok": False, "message": "Utente non trovato."}), 404
        target["approved"] = approved
        save_users_registry(registry)
    return jsonify({"ok": True, "message": "Stato approvazione aggiornato."})


if __name__ == "__main__":
    app.run(host="0.0.0.0", port=8000, debug=True)
