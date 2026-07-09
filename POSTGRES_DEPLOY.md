# PostgreSQL deployment — linuxParserPG

Target server: **62.84.189.162**  
Repo: [https://github.com/haryowl/linuxParserPG](https://github.com/haryowl/linuxParserPG)

SQLite production stays on the old server unchanged.

---

## Phase 1 — New server base setup

SSH to the new server:

```bash
ssh root@62.84.189.162
```

Install dependencies (Ubuntu):

```bash
apt update && apt upgrade -y
apt install -y git curl build-essential nginx postgresql postgresql-contrib
curl -fsSL https://deb.nodesource.com/setup_20.x | bash -
apt install -y nodejs
npm install -g pm2
```

Open firewall ports:

```bash
ufw allow OpenSSH
ufw allow 8080/tcp    # frontend (nginx)
ufw allow 8081/tcp    # API (if exposed)
ufw allow 3003/tcp    # Galileosky TCP ingest
ufw enable
```

---

## Phase 2 — PostgreSQL database

```bash
sudo -u postgres psql <<'SQL'
CREATE USER galiparse_user WITH PASSWORD 'CHANGE_ME_STRONG_PASSWORD';
CREATE DATABASE galiparse OWNER galiparse_user;
GRANT ALL PRIVILEGES ON DATABASE galiparse TO galiparse_user;
SQL
```

Tune Postgres for large `Records` table (edit `postgresql.conf` as needed):

- `shared_buffers`
- `work_mem`
- `maintenance_work_mem`
- `max_connections`

Then:

```bash
systemctl restart postgresql
```

---

## Phase 3 — Clone app

```bash
mkdir -p /opt/linuxParserPG
cd /opt/linuxParserPG
git clone https://github.com/haryowl/linuxParserPG.git .
```

Configure environment:

```bash
cp env.production.postgres.example env.production
nano env.production
```

Set at minimum:

- `DATABASE_URL=postgres://galiparse_user:PASSWORD@127.0.0.1:5432/galiparse`
- `JWT_SECRET` / `SESSION_SECRET` (use `openssl rand -hex 32`)
- `SERVER_IP=62.84.189.162`
- `CORS_ORIGIN` with the new IP

Install and build:

```bash
cd backend && npm install && cd ..
cd frontend && npm install && npm run build && cd ..
mkdir -p logs backend/exports backups
```

Start with PM2:

```bash
pm2 start ecosystem.config.js
pm2 save
pm2 startup
```

Verify:

```bash
pm2 logs gali-parse --lines 50
curl -s http://127.0.0.1:8081/api/health || true
ss -ltnp | grep -E '8081|3003'
```

---

## Phase 4 — Migrate data from SQLite (old server)

On **old server** (`vmi2834739`), copy SQLite file to new server:

```bash
# Old server
cd /opt/linuxParser2
sqlite3 backend/data/prod.sqlite "PRAGMA wal_checkpoint(FULL);"
scp backend/data/prod.sqlite root@62.84.189.162:/tmp/prod.sqlite
```

On **new server**, install pgloader:

```bash
apt install -y pgloader
```

Create load file `/tmp/sqlite-to-pg.load`:

```lisp
LOAD DATABASE
     FROM sqlite:///tmp/prod.sqlite
     INTO postgresql://galiparse_user:CHANGE_ME_STRONG_PASSWORD@127.0.0.1/galiparse

WITH include drop, create tables, create indexes, reset sequences, workers = 4, concurrency = 2

SET work_mem to '256MB', maintenance_work_mem to '512MB'

CAST type datetime to timestamptz
     drop typemod
     using zero-dates-to-null;
```

Run migration (can take a long time for ~24GB):

```bash
pgloader /tmp/sqlite-to-pg.load
```

Validate counts:

```bash
sudo -u postgres psql -d galiparse -c 'SELECT COUNT(*) FROM "Records";'
sudo -u postgres psql -d galiparse -c 'SELECT COUNT(*) FROM "Devices";'
```

Restart app:

```bash
cd /opt/linuxParserPG
pm2 restart ecosystem.config.js --update-env
```

---

## Phase 5 — Nginx (frontend on :8080)

Point nginx to `/opt/linuxParserPG/frontend/build` and proxy `/api` + `/ws` to `127.0.0.1:8081` (same pattern as old server).

Update `SERVER_IP` and `CORS_ORIGIN` in `env.production` after nginx is configured.

---

## Phase 6 — Cutover devices

1. Test login, Devices, Tracking, Export on **62.84.189.162**
2. Point Galileosky devices to **62.84.189.162:3003** (or DNS → new IP)
3. Keep old SQLite server running as rollback until stable

---

## Code differences vs linuxParser2 (SQLite)

| Area | Postgres repo |
|------|----------------|
| `DB_DIALECT` | `postgres` |
| Sessions | `postgresSessionStore.js` (main DB) |
| Alerts stats | `to_char` instead of `strftime` |
| SQLite PRAGMA / VACUUM | Skipped when not SQLite |

---

## Rollback

If issues occur:

- Point devices back to old server IP
- Old SQLite app on `vmi2834739` is unchanged

---

## Quick checks after deploy

```bash
pm2 env 0 | grep -E 'DB_DIALECT|DATABASE_URL|TRACKING_MAX_POINTS'
sudo -u postgres psql -d galiparse -c "SELECT MAX(datetime) FROM \"Records\";"
```

Browser:

- Login works
- Devices list loads
- Tracking returns points (check `X-Tracking-Max-Points` header)
- Data Export works
