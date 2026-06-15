# Offline Installation Guide (USB / No GitHub)

Copy a **complete working installation** from your existing server (`81.17.100.7`) to a USB drive, then install on a **new Ubuntu server** without `git pull` or internet.

**Source server:** `81.17.100.7` → `/opt/linuxParser2`  
**Target:** new Ubuntu server (same or different IP)

---

## What you need

| Item | Notes |
|------|--------|
| Source server | `81.17.100.7` with working app |
| USB flash disk | 2 GB+ free (4 GB+ recommended; archive may be 800 MB–1.5 GB) |
| New server | Ubuntu 20.04/22.04/24.04, same CPU arch (usually `x86_64`) |
| Node.js + PM2 on new server | **Required once** — see §A below (minimal packages, can use offline `.deb` if no internet) |

---

## Part A — One-time on NEW server (Node.js + PM2)

If the new server **already has** Node 18+ and PM2, skip to Part B.

**With internet (simplest):**

```bash
curl -fsSL https://deb.nodesource.com/setup_20.x | sudo -E bash -
sudo apt install -y nodejs build-essential
sudo npm install -g pm2
node --version
pm2 --version
```

**Fully air-gapped:** copy Node 20 `.deb` packages to USB on a PC, install with `sudo dpkg -i *.deb` on the new server (same Ubuntu version as source if possible).

---

## Part B — Create archive on SOURCE server (81.17.100.7)

SSH to source server:

```bash
ssh root@81.17.100.7
```

### B1. Stop app (clean backup, optional but recommended)

```bash
cd /opt/linuxParser2
pm2 stop gali-parse
```

### B2. Create compressed archive

This packs the **full app**: code, `node_modules`, frontend build, database, `env.production`, exports config.

```bash
cd /opt

sudo tar -czvf /tmp/linuxParser2-offline-$(date +%Y%m%d).tar.gz \
  --exclude='linuxParser2/logs/*.log' \
  --exclude='linuxParser2/.git' \
  --exclude='linuxParser2/frontend/build.zip' \
  --exclude='linuxParser2/**/node_modules/.cache' \
  linuxParser2

ls -lh /tmp/linuxParser2-offline-*.tar.gz
```

Note the file size (example: `850M`).

### B3. Optional checksum (verify copy integrity)

```bash
sha256sum /tmp/linuxParser2-offline-*.tar.gz | tee /tmp/linuxParser2-offline.sha256
```

### B4. Start source app again

```bash
cd /opt/linuxParser2
pm2 start gali-parse
```

---

## Part C — Copy archive to USB flash disk

Choose **one** method.

### Method 1 — USB plugged into source server (Linux)

```bash
# Find USB mount point
lsblk
sudo mkdir -p /mnt/usb
sudo mount /dev/sdb1 /mnt/usb    # replace sdb1 with your USB device

sudo cp /tmp/linuxParser2-offline-*.tar.gz /mnt/usb/
sudo cp /tmp/linuxParser2-offline.sha256 /mnt/usb/ 2>/dev/null || true

sync
sudo umount /mnt/usb
```

### Method 2 — Download to PC, then copy to USB

On your **Windows PC**:

```powershell
scp root@81.17.100.7:/tmp/linuxParser2-offline-YYYYMMDD.tar.gz D:\backup\
```

Copy the `.tar.gz` (and `.sha256` if created) to the USB stick.

### Method 3 — `scp` directly to new server (no USB)

If new server is reachable on LAN:

```bash
scp /tmp/linuxParser2-offline-*.tar.gz root@NEW_SERVER_IP:/tmp/
```

---

## Part D — Install on NEW server from USB

### D1. Mount USB on new server (if using flash disk)

```bash
lsblk
sudo mkdir -p /mnt/usb
sudo mount /dev/sdb1 /mnt/usb
ls -lh /mnt/usb/linuxParser2-offline-*.tar.gz
```

### D2. Verify checksum (optional)

```bash
cd /mnt/usb
sha256sum -c linuxParser2-offline.sha256
```

### D3. Extract to `/opt/linuxParser2`

```bash
# Backup if folder already exists
sudo mv /opt/linuxParser2 /opt/linuxParser2.bak-$(date +%Y%m%d) 2>/dev/null || true

# Extract
sudo tar -xzvf /mnt/usb/linuxParser2-offline-YYYYMMDD.tar.gz -C /opt

# Confirm
ls -la /opt/linuxParser2
ls -lh /opt/linuxParser2/backend/data/prod.sqlite
ls -la /opt/linuxParser2/frontend/build/index.html
```

### D4. Set ownership

Replace `youruser` with the user that will run PM2 (often your login user, not root):

```bash
sudo chown -R youruser:youruser /opt/linuxParser2
sudo chmod -R 755 /opt/linuxParser2/backend/data
sudo chmod -R 755 /opt/linuxParser2/backend/exports
sudo mkdir -p /opt/linuxParser2/logs
```

### D5. Update configuration for NEW server IP

Edit `env.production` — **required** if the new server has a different IP:

```bash
nano /opt/linuxParser2/env.production
```

Change at minimum:

```env
SERVER_IP=NEW_SERVER_IP
SERVER_DOMAIN=NEW_SERVER_IP

HTTP_PORT=8081
FRONTEND_PORT=8080
TCP_PORT=3003

CORS_ORIGIN=http://NEW_SERVER_IP:8080,http://NEW_SERVER_IP:8081,http://NEW_SERVER_IP
```

Keep existing `JWT_SECRET` and `SESSION_SECRET` from the copied file (so logins stay the same).

### D6. Rebuild frontend for new IP (if IP changed)

The built JS may still point to `81.17.100.7`. Rebuild **offline** using bundled `node_modules`:

```bash
cd /opt/linuxParser2/frontend
REACT_APP_API_URL=http://NEW_SERVER_IP:8081 npm run build
```

If IP is the same (`81.17.100.7`), skip this step.

### D7. Start with PM2

```bash
cd /opt/linuxParser2
pm2 delete gali-parse 2>/dev/null || true
pm2 start ecosystem.config.js
pm2 save
pm2 startup
# Run the sudo command PM2 prints
```

### D8. Firewall

```bash
sudo ufw allow 8080/tcp
sudo ufw allow 8081/tcp
sudo ufw allow 3003/tcp
sudo ufw status
```

### D9. Verify

```bash
pm2 status
pm2 logs gali-parse --lines 30
ss -tlnp | grep -E '8081|3003'

curl http://127.0.0.1:8081/api/auth/check
```

Browser: `http://NEW_SERVER_IP:8081`

Login: same username/password as on source server (database was copied).

### D10. Unmount USB

```bash
sudo umount /mnt/usb
```

---

## Part E — Galileosky devices

Point trackers to the **new server**:

| Setting | Value |
|---------|-------|
| Server IP | `NEW_SERVER_IP` |
| TCP port | `3003` |

---

## Archive contents checklist

After extract, confirm these exist:

```bash
test -f /opt/linuxParser2/env.production && echo OK env
test -f /opt/linuxParser2/ecosystem.config.js && echo OK pm2
test -d /opt/linuxParser2/backend/node_modules && echo OK backend deps
test -d /opt/linuxParser2/frontend/node_modules && echo OK frontend deps
test -f /opt/linuxParser2/frontend/build/index.html && echo OK frontend build
test -f /opt/linuxParser2/backend/data/prod.sqlite && echo OK database
```

---

## Troubleshooting

| Problem | Fix |
|---------|-----|
| `pm2` shows 0b memory, many restarts | `pm2 logs gali-parse`; check `JWT_SECRET` in `env.production` |
| Browser blank / API errors | Rebuild frontend (D6) with correct `REACT_APP_API_URL` |
| `EADDRINUSE 8081` | `sudo ss -tlnp \| grep 8081` — stop conflicting app or change `HTTP_PORT` |
| `node: not found` | Install Node.js (Part A) |
| Archive too big for FAT32 USB | Use exFAT USB, or split: `split -b 1900M archive.tar.gz archive.tar.gz.` |
| Permission denied on sqlite | `chown -R user:user backend/data` |

---

## Smaller archive (no `node_modules`)

If USB is too small, exclude dependencies (new server **must** run `npm install` with internet):

```bash
sudo tar -czvf /tmp/linuxParser2-slim.tar.gz \
  --exclude='linuxParser2/backend/node_modules' \
  --exclude='linuxParser2/frontend/node_modules' \
  --exclude='linuxParser2/logs' \
  linuxParser2
```

On new server after extract: `cd backend && npm install` and `cd ../frontend && npm install && npm run build` (needs network).

---

## Quick command summary

**Source (81.17.100.7):**

```bash
cd /opt && sudo tar -czvf /tmp/linuxParser2-offline-$(date +%Y%m%d).tar.gz linuxParser2
```

**New server:**

```bash
sudo tar -xzf /mnt/usb/linuxParser2-offline-YYYYMMDD.tar.gz -C /opt
nano /opt/linuxParser2/env.production   # update NEW_SERVER_IP
cd /opt/linuxParser2/frontend && REACT_APP_API_URL=http://NEW_SERVER_IP:8081 npm run build
cd /opt/linuxParser2 && pm2 start ecosystem.config.js && pm2 save
```

---

**Security:** `env.production` and `prod.sqlite` contain secrets and live data. Keep the USB and archive secure; delete from `/tmp` on source server when done:

```bash
rm -f /tmp/linuxParser2-offline-*.tar.gz
```
