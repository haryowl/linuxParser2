# Copy Running Server → New Server (Full Offline)

Step-by-step: compress `/opt/linuxParser2` on your **running Linux server**, copy via USB (or direct transfer), deploy on a **new offline Ubuntu server**.

**Your source:** `root@vmi2834739` → `/opt/linuxParser2`  
**Ports:** Frontend `8080`, API `8081`, GPS TCP `3003`

---

## Overview

```
SOURCE SERVER                    USB / DISK                    NEW SERVER
/opt/linuxParser2  →  tar.gz  →  copy  →  extract /opt/linuxParser2  →  PM2 start
```

---

## What you need

| Item | Notes |
|------|--------|
| Source server | Running app at `/opt/linuxParser2` |
| USB or external disk | **30GB+** if DB is ~20GB; use **exFAT** (not FAT32) |
| New Ubuntu server | 20.04 / 22.04 / 24.04, **x86_64** (same as source) |
| Node.js 18+ and PM2 | Install once on new server (offline `.deb` on USB if no internet) |

---

## Part A — Prepare NEW server (one-time, before or after copy)

### Option 1 — New server has internet (easiest)

```bash
sudo apt update
sudo apt install -y curl build-essential python3 sqlite3
curl -fsSL https://deb.nodesource.com/setup_20.x | sudo -E bash -
sudo apt install -y nodejs
sudo npm install -g pm2
node --version
pm2 --version
```

### Option 2 — Fully offline

On a PC with internet, download for **same Ubuntu version** as new server:

- `nodejs` 20.x `.deb` packages (from NodeSource)
- `build-essential`, `python3`, `sqlite3`
- PM2: copy `/usr/lib/node_modules/pm2` and global npm cache from source server, or run `npm install -g pm2` on source and copy npm global folder

Copy `.deb` files to USB → on new server:

```bash
sudo dpkg -i /mnt/usb/debs/*.deb
sudo apt install -f -y
```

---

## Part B — Create archive on SOURCE server

SSH to source:

```bash
ssh root@81.17.100.7
```

### B1. Stop the app

```bash
cd /opt/linuxParser2
pm2 stop gali-parse
```

### B2. Confirm real database location

Production DB should be:

```bash
ls -lh /opt/linuxParser2/backend/data/prod.sqlite
```

**Note:** You may also have `prod.sqlite` in `/opt/linuxParser2/` root — that is **not** the normal path. The app uses `backend/data/prod.sqlite` (see `env.production` → `DB_STORAGE`).

### B3. Create compressed archive

```bash
cd /opt

sudo tar -czvf /tmp/linuxParser2-offline-$(date +%Y%m%d).tar.gz \
  --exclude='linuxParser2/logs/*.log' \
  --exclude='linuxParser2/.git' \
  --exclude='linuxParser2/frontend/build.zip' \
  --exclude='linuxParser2/**/node_modules/.cache' \
  --exclude='linuxParser2/sqlite-tools-linux-x64-*.zip' \
  --exclude='linuxParser2/prod.sqlite' \
  --exclude='linuxParser2/old-prod.sqlite' \
  --exclude='linuxParser2/*.pre-merge-*' \
  linuxParser2

ls -lh /tmp/linuxParser2-offline-*.tar.gz
```

**Includes:** code, `node_modules`, `frontend/build`, `env.production`, `backend/data/prod.sqlite`, configs.

**Excludes:** log files, root-level duplicate sqlite files, sqlite tool zip (optional).

> **20GB database:** Archive may be **15–25 GB**. Ensure USB has enough space. Compression is slow (30–90+ min).

### B4. Checksum (verify USB copy)

```bash
sha256sum /tmp/linuxParser2-offline-*.tar.gz | tee /tmp/linuxParser2-offline.sha256
cat /tmp/linuxParser2-offline.sha256
```

### B5. Start source app again

```bash
cd /opt/linuxParser2
pm2 start gali-parse
```

---

## Part C — Copy archive to USB

### USB on source server

```bash
lsblk
sudo mkdir -p /mnt/usb
sudo mount /dev/sdb1 /mnt/usb    # use your device

sudo cp /tmp/linuxParser2-offline-*.tar.gz /mnt/usb/
sudo cp /tmp/linuxParser2-offline.sha256 /mnt/usb/

sync
sudo umount /mnt/usb
```

### Or: Windows PC middle step

```powershell
scp root@81.17.100.7:/tmp/linuxParser2-offline-YYYYMMDD.tar.gz D:\backup\
```

Copy from `D:\backup\` to USB stick.

### Split if FAT32 (4GB limit)

```bash
split -b 3900M /tmp/linuxParser2-offline-YYYYMMDD.tar.gz /tmp/linuxParser2-part-

# On new server:
cat /mnt/usb/linuxParser2-part-* > /tmp/linuxParser2-offline.tar.gz
```

---

## Part D — Deploy on NEW server (offline)

> **Archive already in `/opt`?** Skip USB steps — use **[INSTALL_FROM_ARCHIVE_IN_OPT.md](INSTALL_FROM_ARCHIVE_IN_OPT.md)** instead.

### D1. Mount USB and verify checksum

```bash
sudo mkdir -p /mnt/usb
sudo mount /dev/sdb1 /mnt/usb
cd /mnt/usb
sha256sum -c linuxParser2-offline.sha256
```

### D2. Extract

```bash
sudo mkdir -p /opt
sudo tar -xzvf /mnt/usb/linuxParser2-offline-YYYYMMDD.tar.gz -C /opt

ls -la /opt/linuxParser2
ls -lh /opt/linuxParser2/backend/data/prod.sqlite
ls -la /opt/linuxParser2/frontend/build/index.html
```

### D3. Set ownership and permissions

```bash
sudo chown -R $USER:$USER /opt/linuxParser2
mkdir -p /opt/linuxParser2/logs
chmod +x /opt/linuxParser2/monitor.sh /opt/linuxParser2/scripts/*.sh 2>/dev/null
chmod -R 755 /opt/linuxParser2/backend/data
chmod -R 755 /opt/linuxParser2/backend/exports
```

### D4. Edit configuration for NEW server IP

```bash
nano /opt/linuxParser2/env.production
```

Update at minimum:

```env
SERVER_IP=NEW_SERVER_IP
SERVER_DOMAIN=NEW_SERVER_IP

HTTP_PORT=8081
FRONTEND_PORT=8080
TCP_PORT=3003

CORS_ORIGIN=http://NEW_SERVER_IP:8080,http://NEW_SERVER_IP:8081,http://NEW_SERVER_IP
```

Keep existing `JWT_SECRET`, `SESSION_SECRET`, `DB_STORAGE=backend/data/prod.sqlite`.

### D5. Rebuild frontend (if IP changed)

Only if new server IP is **different** from old server:

```bash
cd /opt/linuxParser2/frontend
REACT_APP_API_URL=http://NEW_SERVER_IP:8081 npm run build
```

If IP is the same, skip rebuild.

### D6. Start with PM2

```bash
cd /opt/linuxParser2
pm2 delete gali-parse 2>/dev/null || true
pm2 start ecosystem.config.js
pm2 save
pm2 startup
# Run the sudo command PM2 prints
```

### D7. Firewall

```bash
sudo ufw allow OpenSSH
sudo ufw allow 8080/tcp
sudo ufw allow 8081/tcp
sudo ufw allow 3003/tcp
sudo ufw enable
sudo ufw status
```

### D8. Verify

```bash
pm2 status
pm2 logs gali-parse --lines 30
ss -tlnp | grep -E '8081|3003'

curl http://127.0.0.1:8081/api/auth/check
sqlite3 /opt/linuxParser2/backend/data/prod.sqlite "SELECT COUNT(*) FROM Devices;"
```

Browser: `http://NEW_SERVER_IP:8081`

### D9. Unmount USB

```bash
sudo umount /mnt/usb
```

---

## Part E — Galileosky devices

Point trackers to **new server**:

| Setting | Value |
|---------|-------|
| Server IP | `NEW_SERVER_IP` |
| TCP port | `3003` |

---

## Checklist after deploy

```bash
test -f /opt/linuxParser2/env.production && echo OK env
test -f /opt/linuxParser2/ecosystem.config.js && echo OK pm2
test -d /opt/linuxParser2/backend/node_modules && echo OK backend deps
test -f /opt/linuxParser2/frontend/build/index.html && echo OK frontend build
test -f /opt/linuxParser2/backend/data/prod.sqlite && echo OK database
pm2 status | grep gali-parse
```

---

## Troubleshooting

| Problem | Fix |
|---------|-----|
| Archive too large for USB | exFAT USB, or split with `split`, or exclude `backend/data` and copy DB separately |
| `pm2: command not found` | Install Node + PM2 (Part A) |
| `EADDRINUSE 8081` | `ss -tlnp \| grep 8081` — stop conflicting app |
| Login fails | Check `JWT_SECRET` / `SESSION_SECRET` in `env.production` |
| Blank UI | Rebuild frontend with correct `REACT_APP_API_URL` |
| `database malformed` | DB was corrupt before copy — use healthy `backend/data/prod.sqlite` |
| 0b memory / PM2 restart loop | `pm2 logs gali-parse` — usually missing secrets or wrong cwd |

---

## Quick command summary

**Source server:**

```bash
cd /opt/linuxParser2 && pm2 stop gali-parse
cd /opt && sudo tar -czvf /tmp/linuxParser2-offline-$(date +%Y%m%d).tar.gz \
  --exclude='linuxParser2/logs/*.log' \
  --exclude='linuxParser2/prod.sqlite' \
  --exclude='linuxParser2/old-prod.sqlite' \
  linuxParser2
sha256sum /tmp/linuxParser2-offline-*.tar.gz | tee /tmp/linuxParser2-offline.sha256
pm2 start gali-parse
```

**New server:**

```bash
sudo tar -xzf /mnt/usb/linuxParser2-offline-YYYYMMDD.tar.gz -C /opt
nano /opt/linuxParser2/env.production
cd /opt/linuxParser2/frontend && REACT_APP_API_URL=http://NEW_IP:8081 npm run build
cd /opt/linuxParser2 && pm2 start ecosystem.config.js && pm2 save
```

---

## Security

- `env.production` contains secrets — protect USB and delete `/tmp` archive on source when done.
- Do not commit `env.production` to Git.

---

## Related docs

- [OFFLINE_INSTALL.md](OFFLINE_INSTALL.md)
- [FRESH_INSTALL_UBUNTU.md](FRESH_INSTALL_UBUNTU.md)
- [DATABASE_MIGRATION.md](DATABASE_MIGRATION.md)
