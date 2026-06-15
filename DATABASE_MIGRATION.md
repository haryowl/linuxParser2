# Database Migration — Old Server to New Server

Migrate from **old** `/opt/LinuxParser` to **new** `/opt/linuxParser2` while keeping data already collected on the new server.

**Laptop → server:** if the old database is on your PC, see **[DATABASE_MIGRATION_FROM_LAPTOP.md](DATABASE_MIGRATION_FROM_LAPTOP.md)** (e.g. `C:\Users\haryo\prod.sqlite` → `81.17.100.7`).

**Your case:** different IMEIs on each server → **merge (append)**, not full replace.

| Server | Path | Version |
|--------|------|---------|
| Old | `/opt/LinuxParser` | `5db5324` |
| New | `/opt/linuxParser2` | `13cdce0+` |
| Old DB size | ~344 MB | `backend/data/prod.sqlite` |

---

## What gets merged

| Data | Action |
|------|--------|
| Old **Devices** (by IMEI) | Added to new DB |
| Old **Records** (history) | Added to new DB |
| Old **device_groups**, mappings, alerts | Added where no conflict |
| **New server users** | **Kept** (old `users` table not imported) |
| New server devices already sending | **Kept** |

---

## Step 1 — Stop apps

**Old server** (optional, read-only copy is fine):

```bash
pm2 stop gali-parse
```

**New server** (required):

```bash
cd /opt/linuxParser2
pm2 stop gali-parse
```

---

## Step 2 — Copy old database to new server

Run on **new server** (`81.17.100.7`):

```bash
cd /opt/linuxParser2/backend/data

# Backup new DB first
cp prod.sqlite prod.sqlite.backup-$(date +%Y%m%d-%H%M)

# Copy from old server (replace OLD_SERVER_IP)
scp haryow@OLD_SERVER_IP:/opt/LinuxParser/backend/data/prod.sqlite ./old-prod.sqlite

ls -lh prod.sqlite old-prod.sqlite
```

Expected: `old-prod.sqlite` ≈ **344M**.

---

## Step 3 — Compare schemas (optional but recommended)

```bash
cd /opt/linuxParser2/backend/data
sqlite3 prod.sqlite ".tables" > new-tables.txt
sqlite3 old-prod.sqlite ".tables" > old-tables.txt
diff new-tables.txt old-tables.txt

sqlite3 prod.sqlite "PRAGMA table_info(Records);" | wc -l
sqlite3 old-prod.sqlite "PRAGMA table_info(Records);" | wc -l
```

Small column count differences are OK — the merge script uses **shared columns only**.

---

## Step 4 — Run merge script

On **new server**:

```bash
cd /opt/linuxParser2
git pull   # get scripts/mergeSqliteDatabase.js

cd backend
node scripts/mergeSqliteDatabase.js ./data/old-prod.sqlite
```

Example output:

```
Pre-merge counts:
  Devices: new=5 old=120
  Records: new=12000 old=2500000
...
  Devices: +120 rows
  Records: +2500000 rows
```

The script automatically creates `prod.sqlite.pre-merge-TIMESTAMP` backup.

---

## Step 5 — Start app and verify

```bash
cd /opt/linuxParser2
pm2 start ecosystem.config.js
pm2 logs gali-parse --lines 30

sqlite3 backend/data/prod.sqlite "SELECT COUNT(*) AS devices FROM Devices;"
sqlite3 backend/data/prod.sqlite "SELECT COUNT(*) AS records FROM Records;"
sqlite3 backend/data/prod.sqlite "SELECT imei, name FROM Devices ORDER BY createdAt DESC LIMIT 15;"
```

Browser: `http://81.17.100.7:8081` — you should see **both** old and new devices.

---

## Step 6 — Optional: copy export configs

```bash
scp haryow@OLD_SERVER_IP:/opt/LinuxParser/backend/data/auto-export-configs.json \
  /opt/linuxParser2/backend/data/ 2>/dev/null || true
```

---

## Rollback

```bash
cd /opt/linuxParser2
pm2 stop gali-parse
cp backend/data/prod.sqlite.backup-YYYYMMDD-HHMM backend/data/prod.sqlite
pm2 start ecosystem.config.js
```

---

## Login / users

- **New server accounts** remain (e.g. `admin` you created on linuxParser2).
- **Old server users** are not imported by default.
- To log in as an old user, either:
  - Create the same username on the new server, or
  - Manually import one user from old DB (ask for help if needed).

---

## Old server devices

After migration, you can:

1. **Leave old trackers** on old server IP until phased out, or
2. **Repoint trackers** to new server `81.17.100.7:3003` (TCP port unchanged).

Historical data from old server is already in the merged DB.

---

## Troubleshooting

| Issue | Fix |
|-------|-----|
| `Merge failed: Records: ...` | Run schema compare; share error for column-specific SQL |
| Duplicate IMEI | Script skips by IMEI — safe |
| Missing old devices in UI | Check `SELECT COUNT(*) FROM Devices` |
| Slow merge | Normal for 344MB+; Records insert may take several minutes |
| `database is locked` | Ensure `pm2 stop gali-parse` |

---

## Manual merge (without script)

If you prefer raw SQLite:

```bash
cd /opt/linuxParser2/backend/data
cp prod.sqlite prod.sqlite.backup
sqlite3 prod.sqlite << 'EOF'
ATTACH 'old-prod.sqlite' AS old;

INSERT INTO Devices SELECT * FROM old.Devices
WHERE imei NOT IN (SELECT imei FROM Devices);

INSERT INTO Records (deviceImei, timestamp, datetime, /* list shared columns */)
SELECT deviceImei, timestamp, datetime, ...
FROM old.Records
WHERE deviceImei IN (SELECT imei FROM old.Devices);

DETACH old;
EOF
```

Use the automated script when possible — it handles column differences between `5db5324` and `13cdce0`.
