# SDA Web App

Versione web dell'applicazione `sda.py`, mantenendo struttura e logica il piu possibile identiche.

## Avvio

1. Installa dipendenze:
   ```powershell
   python -m pip install -r requirements-web.txt
   ```
2. Configura variabili ambiente (PowerShell):
   ```powershell
   $env:GOOGLE_CLIENT_ID="IL_TUO_CLIENT_ID_GOOGLE"
   $env:SDA_WEB_SECRET="una-chiave-lunga-casuale"
   $env:PWA_APP_NAME="I Miei Turni"
   $env:PWA_SHORT_NAME="Turni"
   $env:PWA_ICON_TEXT="MT"
   ```
3. Avvia server:
   ```powershell
   python sda_web.py
   ```
4. Apri dal browser:
   - Locale PC: `http://127.0.0.1:8000`
   - Da iPhone/Android nella stessa rete: `http://IP_DEL_PC:8000`

## Deploy su Render FREE (consigliato: Supabase Postgres)

Se vuoi restare su Render free senza perdere dati, usa Supabase come storage permanente.

### 1) Crea database su Supabase

1. Crea progetto su Supabase.
2. Vai in `Project Settings -> Database`.
3. Copia la connection string Postgres (URI), ad esempio:
   - `postgresql://postgres.xxx:[PASSWORD]@aws-0-eu-central-1.pooler.supabase.com:6543/postgres?sslmode=require`
4. Sostituisci `[PASSWORD]` con la password DB.

### 2) Crea Web Service su Render

1. Crea un Web Service dal repo GitHub.
2. Build Command:
   - `pip install -r requirements-web.txt`
3. Start Command:
   - `gunicorn sda_web:app --bind 0.0.0.0:$PORT`

### 3) Environment Variables su Render

- `DATABASE_URL=<URI_SUPABASE_POSTGRES>`
- `SDA_WEB_SECRET=<chiave-lunga-casuale>`
- `GOOGLE_CLIENT_ID=<client id OAuth Google>`
- Opzionale: `PYTHON_VERSION=3.11.11`

Con `DATABASE_URL` impostata, l'app salva utenti e turni in Postgres (Supabase) invece che in file locali.

### 3.b) Branding PWA personalizzabile

Puoi personalizzare nome, tema e icona installabile con queste variabili:

- `PWA_APP_NAME=I Miei Turni`
- `PWA_SHORT_NAME=Turni`
- `PWA_THEME_COLOR=#0e2346`
- `PWA_BG_COLOR=#f4f7fc`
- `PWA_ICON_TEXT=MT`
- `PWA_ICON_START=#1d6dff`
- `PWA_ICON_END=#00d1c7`

Esempio: `PWA_ICON_TEXT=SDA` crea un'icona con le lettere scelte da te.

### 4) Primo avvio

Al primo deploy con DB vuoto:
- il primo utente che fa login diventa `admin`
- gli utenti successivi sono `user` in attesa approvazione

### 5) Migrazione dati locali (automatica)

Se nel progetto esistono gia `utenti_sda.json` e `user_data/`, al primo avvio in modalita DB l'app prova a importarli in Postgres se il DB e vuoto.

## Deploy su Render PAID (alternativa con file JSON)

1. Aggiungi Persistent Disk:
   - Mount path: `/var/data/sda`
2. Environment variable:
   - `SDA_DATA_DIR=/var/data/sda`

In questo caso i dati restano su file JSON persistenti.

## Login e ruoli

- Primo utente registrato: creato automaticamente come `admin` e approvato.
- Utenti successivi: creati come `user` in stato `in attesa`.
- L'admin puo:
  - approvare/negare accesso
  - visualizzare i turni inseriti dagli altri utenti

## Dati

- Modalita DB (`DATABASE_URL` presente):
  - utenti: tabella `app_users`
  - turni/configurazioni per utente: tabella `app_user_payloads` (JSONB)
- Modalita file (`DATABASE_URL` assente):
  - archivio utenti: `utenti_sda.json`
  - turni per utente: `user_data/`

### Flusso salvataggio (DB)

1. Login Google/dev -> upsert in `app_users`
2. L'utente lavora sull'app -> lettura payload JSONB da `app_user_payloads`
3. Salva turno / paghe / turni rapidi -> update payload JSONB dello stesso utente

L'admin puo vedere altri utenti, ma in sola lettura.

## Note export PDF

Il pulsante "Esporta PDF del Mese" apre una vista pronta per la stampa: dal browser puoi salvarla in PDF su Windows, iPhone e Android.

## PWA

L'app ora include:

- `manifest.webmanifest`
- `service-worker.js`
- icona SVG dinamica
- supporto installazione su Android/desktop
- supporto "Aggiungi alla schermata Home" su iPhone
