# Install on New Server — Archive Already in `/opt`

Use this guide when the compressed file is **already on the new server** in `/opt` (copied via USB, `scp`, or Windows download).

**Example archive:** `/opt/linuxParser2-offline-20260616.tar.gz`  
**After install:** app runs at `/opt/linuxParser2`  
**Ports:** Frontend `8080`, API `8081`, GPS TCP `3003`

---

## Before you start

| Requirement | Check |
|-------------|--------|
| Ubuntu 20.04 / 22.04 / 24.04 (x86_64) | `uname -m` → `x86_64` |
| Enough disk space | Archive size × ~2 (extract needs more room) |
| Node.js 18+ and PM2 | `node --version` and `pm2 --version` |
| Archive in `/opt` | `ls -lh /opt/linuxParser2-offline-*.tar.gz` |

---

## Step 1 — Install Node.js + PM2 (if not installed)

### With internet

```bash
sudo apt update
sudo apt install -y curl build-essential python3 sqlite3
curl -fsSL https://deb.nodesource.com/setup_20.x | sudo -E bash -
sudo apt install -y nodejs
sudo npm install -g pm2
node --version
pm2 --version
```

### Fully offline

Install Node 20 `.deb` packages from USB first:

```bash
sudo dpkg -i /path/to/debs/*.deb
sudo apt install -f -y
sudo npm install -g pm2
```

---

## Step 2 — Find the archive in `/opt`

```bash
cd /opt
ls -lh
```

You should see something like:

```
linuxParser2-offline-20260616.tar.gz
```

If you have **split parts** (from FAT32 USB), join them first:

```bash
cd /opt
cat linuxParser2-part-* > linuxParser2-offline.tar.gz
ls -lh linuxParser2-offline.tar.gz
```

### Optional — verify checksum

If you have `.sha256` file in `/opt`:

```bash
cd /opt
sha256sum -c linuxParser2-offline.sha256
```

Must show `OK`.

---

## Step 3 — Check free disk space

```bash
df -h /opt
```

Need at least **2× archive size** free (e.g. 40GB free for a 20GB archive).

---

## Step 4 — Backup old install (if exists)

```bash
sudo mv /opt/linuxParser2 /opt/linuxParser2.bak-$(date +%Y%m%d) 2>/dev/null || true
```

Do **not** delete the `.tar.gz` yet — keep it until the app works.

---

## Step 5 — Extract archive

Replace the filename with yours:

```bash
cd /opt
sudo tar -xzvf linuxParser2-offline-20260616.tar.gz
```

Extraction may take **30–90+ minutes** for a large database.

### Confirm extract

```bash
ls -la /opt/linuxParser2
ls -lh /opt/linuxParser2/backend/data/prod.sqlite
ls -la /opt/linuxParser2/frontend/build/index.html
ls -la /opt/linuxParser2/env.production
```

---

## Step 6 — Set permissions

Replace `youruser` with your login user (who runs PM2):

```bash
sudo chown -R youruser:youruser /opt/linuxParser2
sudo mkdir -p /opt/linuxParser2/logs
sudo chmod +x /opt/linuxParser2/monitor.sh /opt/linuxParser2/scripts/*.sh 2>/dev/null
sudo chmod -R 755 /opt/linuxParser2/backend/data
sudo chmod -R 755 /opt/linuxParser2/backend/exports
```

---

## Step 7 — Update configuration for new server IP

```bash
nano /opt/linuxParser2/env.production
```

Set your **new server IP** (replace `NEW_SERVER_IP`):

```env
SERVER_IP=NEW_SERVER_IP
SERVER_DOMAIN=NEW_SERVER_IP

HTTP_PORT=8081
FRONTEND_PORT=8080
TCP_PORT=3003

CORS_ORIGIN=http://NEW_SERVER_IP:8080,http://NEW_SERVER_IP:8081,http://NEW_SERVER_IP
```

**Keep unchanged:**
- `JWT_SECRET`
- `SESSION_SECRET`
- `DB_STORAGE=backend/data/prod.sqlite`

These must match the copied file so existing logins still work.

---

## Step 8 — Rebuild frontend (if IP changed)

Only if new server IP is **different** from the old server:

```bash
cd /opt/linuxParser2/frontend
REACT_APP_API_URL=http://NEW_SERVER_IP:8081 npm run build
```

If IP is the same, skip this step.

---

## Step 9 — Start the application

```bash
cd /opt/linuxParser2
pm2 delete gali-parse 2>/dev/null || true
pm2 start ecosystem.config.js
pm2 save
pm2 startup
```

Run the `sudo env PATH=...` command that PM2 prints (so app starts after reboot).

---

## Step 10 — Open firewall ports

```bash
sudo ufw allow OpenSSH
sudo ufw allow 8080/tcp
sudo ufw allow 8081/tcp
sudo ufw allow 3003/tcp
sudo ufw enable
sudo ufw status
```

---

## Step 11 — Verify installation

```bash
pm2 status
pm2 logs gali-parse --lines 30
ss -tlnp | grep -E '8081|3003'
curl http://127.0.0.1:8081/api/auth/check
sqlite3 /opt/linuxParser2/backend/data/prod.sqlite "SELECT COUNT(*) FROM Devices;"
```

Open browser: `http://NEW_SERVER_IP:8081`

Login with the **same username/password** as on the old server.

---

## Step 12 — Point GPS devices to new server

| Setting | Value |
|---------|-------|
| Server IP | `NEW_SERVER_IP` |
| TCP port | `3003` |

---

## Step 13 — Cleanup (optional, after everything works)

Free disk space by removing the archive:

```bash
# Only after you confirm the app works!
rm -f /opt/linuxParser2-offline-*.tar.gz
rm -f /opt/linuxParser2-offline.sha256
rm -f /opt/linuxParser2-part-*
```

---

## One-block copy-paste (fill in values)

```bash
# 1. Find archive
cd /opt && ls -lh linuxParser2-offline-*.tar.gz

# 2. Extract (change filename)
sudo tar -xzvf linuxParser2-offline-20260616.tar.gz

# 3. Permissions (change youruser)
sudo chown -R youruser:youruser /opt/linuxParser2
sudo mkdir -p /opt/linuxParser2/logs
sudo chmod -R 755 /opt/linuxParser2/backend/data /opt/linuxParser2/backend/exports

# 4. Edit IP
nano /opt/linuxParser2/env.production

# 5. Rebuild frontend if IP changed (change NEW_SERVER_IP)
cd /opt/linuxParser2/frontend
REACT_APP_API_URL=http://NEW_SERVER_IP:8081 npm run build

# 6. Start
cd /opt/linuxParser2
pm2 start ecosystem.config.js
pm2 save
pm2 startup

# 7. Verify
pm2 status
curl http://127.0.0.1:8081/api/auth/check
```

---

## Post-install checklist

```bash
test -f /opt/linuxParser2/env.production && echo OK env
test -f /opt/linuxParser2/ecosystem.config.js && echo OK pm2
test -d /opt/linuxParser2/backend/node_modules && echo OK backend deps
test -f /opt/linuxParser2/frontend/build/index.html && echo OK frontend
test -f /opt/linuxParser2/backend/data/prod.sqlite && echo OK database
pm2 status | grep gali-parse
```

---

## Troubleshooting

| Problem | Fix |
|---------|-----|
| `tar: Cannot open: No such file` | `ls /opt` — use exact filename |
| `No space left on device` | `df -h /opt` — free space or use larger disk |
| `pm2: command not found` | Install Node.js + PM2 (Step 1) |
| PM2 shows `0b` memory, restarts | `pm2 logs gali-parse` — check `JWT_SECRET` in `env.production` |
| Blank page / API errors | Rebuild frontend (Step 8) with correct IP |
| `EADDRINUSE 8081` | `ss -tlnp \| grep 8081` — stop other app using port |
| Login fails | Secrets changed — restore original `env.production` from archive |
| `database disk image is malformed` | DB was corrupt before copy — use healthy backup |

---

## Related guides

- [SERVER_COPY_OFFLINE_GUIDE.md](SERVER_COPY_OFFLINE_GUIDE.md) — full flow: compress on old server → transfer → install
- [OFFLINE_INSTALL.md](OFFLINE_INSTALL.md) — USB transfer details
- [FRESH_INSTALL_UBUNTU.md](FRESH_INSTALL_UBUNTU.md) — install from GitHub (needs internet)
