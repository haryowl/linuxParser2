# Database Migration — Laptop → Server (81.17.100.7)

Merge an **old database file on your Windows laptop** into the **live server** at `81.17.100.7` without losing data already on the server.

| Item | Value |
|------|--------|
| Server IP | `81.17.100.7` |
| App folder | `/opt/LinuxParser2` (verify with `ls /opt/` — may be `linuxParser2`) |
| Laptop file | `C:\Users\haryo\` (your old `prod.sqlite`) |
| Strategy | **Merge** — keep new server users + live devices, add old history |

---

## Before you start

1. Confirm the file on your laptop — usually one of:
   - `C:\Users\haryo\prod.sqlite`
   - `C:\Users\haryo\old-prod.sqlite`
   - `C:\Users\haryo\backend\data\prod.sqlite`

2. Check size in **PowerShell**:

```powershell
Get-Item C:\Users\haryo\prod.sqlite | Select-Object Name, Length, LastWriteTime
```

Expect roughly **300–400 MB** if it is the full old database.

3. You need **SSH access** to `81.17.100.7` (user `root` or `haryow`).

---

## Step 1 — Upload old database from laptop to server

### Option A — PowerShell / CMD (`scp`)

Replace `prod.sqlite` if your filename is different.

```powershell
scp C:\Users\haryo\prod.sqlite root@81.17.100.7:/opt/LinuxParser2/backend/data/old-prod.sqlite
```

If your SSH user is not root:

```powershell
scp C:\Users\haryo\prod.sqlite haryow@81.17.100.7:/tmp/old-prod.sqlite
```

Then on the server (SSH):

```bash
sudo mv /tmp/old-prod.sqlite /opt/LinuxParser2/backend/data/old-prod.sqlite
```

### Option B — WinSCP / FileZilla

| Field | Value |
|-------|--------|
| Host | `81.17.100.7` |
| Protocol | SFTP |
| Remote path | `/opt/LinuxParser2/backend/data/` |
| Remote filename | `old-prod.sqlite` |
| Local file | `C:\Users\haryo\prod.sqlite` |

Upload can take several minutes for ~344 MB.

### Verify on server

```bash
ssh root@81.17.100.7
ls -lh /opt/LinuxParser2/backend/data/old-prod.sqlite
ls -lh /opt/LinuxParser2/backend/data/prod.sqlite
```

You should see **both** files:
- `prod.sqlite` — current server database
- `old-prod.sqlite` — old database from laptop

---

## Step 2 — Stop the app on the server

```bash
cd /opt/LinuxParser2
pm2 stop gali-parse
```

Do not skip this — SQLite must not be written while merging.

---

## Step 3 — Backup current server database

```bash
cd /opt/LinuxParser2/backend/data
cp prod.sqlite prod.sqlite.backup-$(date +%Y%m%d-%H%M)
ls -lh prod.sqlite*
```

---

## Step 4 — (Optional) Compare old vs new

```bash
cd /opt/LinuxParser2/backend/data

sqlite3 prod.sqlite "SELECT COUNT(*) AS server_devices FROM Devices;"
sqlite3 prod.sqlite "SELECT COUNT(*) AS server_records FROM Records;"

sqlite3 old-prod.sqlite "SELECT COUNT(*) AS old_devices FROM Devices;"
sqlite3 old-prod.sqlite "SELECT COUNT(*) AS old_records FROM Records;"
```

Write these numbers down — you will compare after merge.

---

## Step 5 — Run merge script

The merge script appends old data into `prod.sqlite` and **keeps** new server users.

```bash
cd /opt/LinuxParser2

# Get merge script if not present yet
git pull
# OR skip git if offline — script must exist at:
#   backend/scripts/mergeSqliteDatabase.js

cd backend
node scripts/mergeSqliteDatabase.js ./data/old-prod.sqlite
```

**Expected output (example):**

```
Pre-merge counts:
  Devices: new=5 old=120
  Records: new=12000 old=2500000

Merging (new server users are kept)...
  device_groups: +3 rows
  Devices: +120 rows
  Records: +2500000 rows

Done.
```

The script also creates an automatic backup:  
`prod.sqlite.pre-merge-TIMESTAMP`

**If `mergeSqliteDatabase.js` is missing**, copy it from your project folder on the laptop:

```powershell
scp C:\Users\haryo\Downloads\LinuxOHW\backend\scripts\mergeSqliteDatabase.js root@81.17.100.7:/opt/LinuxParser2/backend/scripts/
```

---

## Step 6 — Verify merged database

```bash
cd /opt/LinuxParser2/backend/data

sqlite3 prod.sqlite "SELECT COUNT(*) AS total_devices FROM Devices;"
sqlite3 prod.sqlite "SELECT COUNT(*) AS total_records FROM Records;"

sqlite3 prod.sqlite "SELECT imei, name, lastSeen FROM Devices ORDER BY lastSeen DESC LIMIT 20;"
```

Total devices/records should be **≥** pre-merge server counts + old counts (minus any duplicate IMEIs, if any).

---

## Step 7 — Start the app

```bash
cd /opt/LinuxParser2
pm2 start gali-parse
# or: pm2 restart gali-parse

pm2 status
pm2 logs gali-parse --lines 30
```

Test API:

```bash
curl http://127.0.0.1:8081/api/auth/check
```

Browser: **http://81.17.100.7:8081**  
Log in with your **server** account (not old-server users unless you created them).

---

## Step 8 — Cleanup (after you confirm UI looks correct)

```bash
# Keep old-prod.sqlite for a few days as extra safety, then:
# rm /opt/LinuxParser2/backend/data/old-prod.sqlite
```

---

## What is merged vs kept

| Data | Result |
|------|--------|
| Old devices (by IMEI) | Added to server |
| Old GPS / telemetry (`Records`) | Added |
| Old groups, mappings, alerts | Added where no conflict |
| **Server users / logins** | **Kept** (old `users` not imported) |
| Devices already on server | **Kept** |

---

## Rollback (if something goes wrong)

```bash
cd /opt/LinuxParser2
pm2 stop gali-parse

cd backend/data
cp prod.sqlite.backup-YYYYMMDD-HHMM prod.sqlite
# OR use auto backup:
# cp prod.sqlite.pre-merge-TIMESTAMP prod.sqlite

cd /opt/LinuxParser2
pm2 start gali-parse
```

---

## Troubleshooting

### Wrong app path (`LinuxParser2` vs `linuxParser2`)

```bash
ls /opt/ | grep -i parser
```

Use the exact folder name in all commands.

### `scp` not found on Windows

Use WinSCP, or enable OpenSSH Client in Windows Settings → Apps → Optional features.

### `database is locked`

```bash
pm2 stop gali-parse
# retry merge
```

### `Merge failed: Records: ...`

Compare schemas:

```bash
sqlite3 /opt/LinuxParser2/backend/data/prod.sqlite "PRAGMA table_info(Records);" > /tmp/new.txt
sqlite3 /opt/LinuxParser2/backend/data/old-prod.sqlite "PRAGMA table_info(Records);" > /tmp/old.txt
diff /tmp/new.txt /tmp/old.txt
```

Share the error message for column-specific help.

### Login works but old devices not visible

Check permissions (admin sees all). As admin:

```bash
sqlite3 /opt/LinuxParser2/backend/data/prod.sqlite \
  "SELECT COUNT(*) FROM Devices WHERE imei IN (SELECT imei FROM olddb.Devices);"
```

(Re-attach old file only if needed for debugging.)

### Laptop file is not `prod.sqlite`

If you have a `.zip` or backup folder, extract until you find `prod.sqlite` (SQLite file, not `.db-journal`).

---

## Quick copy-paste checklist

**Laptop (PowerShell):**

```powershell
scp C:\Users\haryo\prod.sqlite root@81.17.100.7:/opt/LinuxParser2/backend/data/old-prod.sqlite
```

**Server (SSH):**

```bash
cd /opt/LinuxParser2 && pm2 stop gali-parse
cd backend/data && cp prod.sqlite prod.sqlite.backup-$(date +%Y%m%d-%H%M)
cd /opt/LinuxParser2/backend && node scripts/mergeSqliteDatabase.js ./data/old-prod.sqlite
cd /opt/LinuxParser2 && pm2 start gali-parse
sqlite3 backend/data/prod.sqlite "SELECT COUNT(*) FROM Devices; SELECT COUNT(*) FROM Records;"
```

---

## Related docs

- [DATABASE_MIGRATION.md](DATABASE_MIGRATION.md) — server-to-server migration
- [OFFLINE_INSTALL.md](OFFLINE_INSTALL.md) — full offline app copy via USB
