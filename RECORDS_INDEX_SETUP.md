# Create Records Indexes on Old / Copied Database

Use this when you copied an old `prod.sqlite` that has **no indexes** on the `Records` table (common with large 10–20 GB databases).

The script creates these 4 indexes:

| Index | Columns |
|-------|---------|
| `records_device_imei_idx` | `deviceImei` |
| `records_datetime_idx` | `datetime` |
| `records_timestamp_idx` | `timestamp` |
| `records_device_datetime_idx` | `deviceImei`, `datetime` |

---

## Before you start

1. **Stop the app** — DB must not be locked:
   ```bash
   pm2 stop gali-parse
   ```

2. **Check free disk space** — index build needs extra space (often 20–50% of DB size on large files):
   ```bash
   df -h /opt/linuxParser2/backend/data
   ```

3. **Check current indexes**:
   ```bash
   sqlite3 /opt/linuxParser2/backend/data/prod.sqlite ".indexes Records"
   ```

   If you already see all 4 names, you can skip this script.

---

## Run the script

```bash
cd /opt/linuxParser2/backend

# Default: uses DB path from env.production (backend/data/prod.sqlite)
node scripts/createRecordsIndexes.js

# Or specify DB path explicitly
node scripts/createRecordsIndexes.js ./data/prod.sqlite
```

**Large DB (10–20 GB):** each index may take **30 minutes to several hours**. Run in `screen` or `tmux`:

```bash
screen -S indexes
cd /opt/linuxParser2/backend
node scripts/createRecordsIndexes.js ./data/prod.sqlite
# Detach: Ctrl+A then D
# Reattach: screen -r indexes
```

---

## Other options

```bash
# List indexes only (no changes)
node scripts/createRecordsIndexes.js ./data/prod.sqlite --list-only

# Show SQL without running
node scripts/createRecordsIndexes.js ./data/prod.sqlite --dry-run

# Skip integrity warning (corrupt/partial DB)
node scripts/createRecordsIndexes.js ./data/prod.sqlite --skip-integrity-check
```

Or via npm:

```bash
npm run create-indexes -- ./data/prod.sqlite
```

---

## After indexes are created

```bash
sqlite3 /opt/linuxParser2/backend/data/prod.sqlite ".indexes Records"
pm2 start gali-parse
pm2 logs gali-parse --lines 30
```

Expected indexes:

```
records_device_datetime_idx
records_device_imei_idx
records_datetime_idx
records_timestamp_idx
```

---

## Manual SQL (alternative)

If you prefer `sqlite3` CLI directly:

```bash
pm2 stop gali-parse
sqlite3 /opt/linuxParser2/backend/data/prod.sqlite
```

```sql
PRAGMA journal_mode = WAL;
CREATE INDEX IF NOT EXISTS records_device_imei_idx ON Records (deviceImei);
CREATE INDEX IF NOT EXISTS records_datetime_idx ON Records (datetime);
CREATE INDEX IF NOT EXISTS records_timestamp_idx ON Records (timestamp);
CREATE INDEX IF NOT EXISTS records_device_datetime_idx ON Records (deviceImei, datetime);
ANALYZE Records;
.quit
```

```bash
pm2 start gali-parse
```

---

## Troubleshooting

| Problem | Fix |
|---------|-----|
| `database is locked` | `pm2 stop gali-parse` and retry |
| `database disk image is malformed` | DB is corrupt — restore from backup or re-copy from old server |
| Script very slow | Normal on 20GB — wait; use `screen` |
| `no such table: Records` | Wrong DB file path |
| App still slow after indexes | Run `ANALYZE Records;` and confirm indexes with `.indexes Records` |

---

## Related

- Runtime auto-index on startup: `backend/src/utils/ensureRecordIndexes.js`
- Script source: `backend/scripts/createRecordsIndexes.js`
