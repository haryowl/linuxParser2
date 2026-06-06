# Fresh Installation Guide — Ubuntu Linux Server

Complete step-by-step guide to deploy **Gali-Parse / LinuxParser** on a new Ubuntu server by cloning from GitHub.

**Repository:** [https://github.com/haryowl/linuxParser2](https://github.com/haryowl/linuxParser2)

---

## Overview

| Component | Default port | Purpose |
|-----------|--------------|---------|
| Frontend (web UI) | **8080** | React dashboard |
| Backend (API + WebSocket) | **8081** | REST API, `/ws` live updates |
| TCP server | **3003** | Galileosky GPS device data |

Ports **8080/8081** are used instead of 3000/3001 so this app can run alongside other services on the same server.

---

## 1. Server requirements

- **OS:** Ubuntu 20.04 / 22.04 / 24.04 LTS (64-bit)
- **RAM:** 2 GB minimum (4 GB+ recommended)
- **Disk:** 10 GB+ free
- **Node.js:** 18.x or 20.x (LTS)
- **Network:** Public or LAN IP; open ports 8080, 8081, 3003 (and 80/443 if using Nginx)

---

## 2. Install system dependencies

SSH into your server, then run:

```bash
sudo apt update && sudo apt upgrade -y

# Node.js 20 LTS
curl -fsSL https://deb.nodesource.com/setup_20.x | sudo -E bash -
sudo apt install -y nodejs build-essential python3 git nginx gettext-base

# Process manager
sudo npm install -g pm2

# Verify
node --version    # v20.x
npm --version
pm2 --version
```

---

## 3. Clone the application

```bash
sudo mkdir -p /opt/linuxParser2
sudo chown $USER:$USER /opt/linuxParser2

git clone https://github.com/haryowl/linuxParser2.git /opt/linuxParser2
cd /opt/linuxParser2
```

---

## 4. Create required directories

```bash
mkdir -p backend/data backend/exports logs backups
chmod -R 755 backend/data backend/exports logs backups
```

---

## 5. Configure environment

Copy the example file and edit it:

```bash
cp env.production.example env.production
nano env.production
```

**Minimum values to change:**

```bash
# Replace with your server IP or domain
SERVER_IP=203.0.113.10
SERVER_DOMAIN=gps.example.com

# Ports (defaults — change only if 8080/8081 are taken)
HTTP_PORT=8081
FRONTEND_PORT=8080
TCP_PORT=3003

# Generate secrets (run on server):
# openssl rand -hex 32
JWT_SECRET=paste-your-64-char-hex-here
SESSION_SECRET=paste-another-64-char-hex-here

# Must include every URL users open in the browser
CORS_ORIGIN=http://203.0.113.10:8080,http://203.0.113.10:8081,http://gps.example.com

# If using Nginx on port 80 with HTTPS later:
# COOKIE_SECURE=true

# Nginx paths (if using Nginx)
FRONTEND_BUILD_PATH=/opt/linuxParser2/frontend/build
```

Generate secrets:

```bash
echo "JWT_SECRET=$(openssl rand -hex 32)"
echo "SESSION_SECRET=$(openssl rand -hex 32)"
```

---

## 6. Install dependencies

```bash
cd /opt/linuxParser2

# Backend
cd backend
npm install
cd ..

# Frontend (needs devDependencies for build)
cd frontend
npm install
cd ..
```

---

## 7. Initialize database

The app uses SQLite by default (`backend/data/prod.sqlite`).

```bash
cd /opt/linuxParser2/backend
node init-database.js
node create-default-admin.js
```

Both scripts load `env.production` and use the same database file (`backend/data/prod.sqlite`).

Default login (change immediately after first login):

| Field | Value |
|-------|-------|
| Username | `admin` |
| Password | `admin123` |

---

## 8. Build the frontend

Set the API URL to your backend port **before** building:

```bash
cd /opt/linuxParser2/frontend

# Replace SERVER_IP with your actual IP or domain
export REACT_APP_API_URL=http://203.0.113.10:8081

NODE_OPTIONS=--max-old-space-size=12288 npm run build
```

Or create `frontend/.env` permanently:

```bash
cat > /opt/linuxParser2/frontend/.env << 'EOF'
REACT_APP_API_URL=http://203.0.113.10:8081
EOF
npm run build
```

---

## 9. Start with PM2

From the project root:

```bash
cd /opt/linuxParser2
pm2 start ecosystem.config.js
pm2 save
pm2 startup
# Run the command PM2 prints (sudo env PATH=...)
```

**Backend only (API + can serve built UI from port 8081):**

The backend automatically serves `frontend/build` if it exists. After build, the dashboard is available at:

- `http://YOUR_IP:8081`

**Optional — serve frontend on port 8080 separately:**

```bash
cd /opt/linuxParser2/frontend
pm2 start "npx serve -s build -l 8080" --name gali-parse-frontend
pm2 save
```

Then open:

- UI: `http://YOUR_IP:8080`
- API: `http://YOUR_IP:8081/api`

---

## 10. Firewall (UFW)

```bash
sudo ufw allow OpenSSH
sudo ufw allow 8080/tcp    # Frontend
sudo ufw allow 8081/tcp    # Backend API
sudo ufw allow 3003/tcp    # Galileosky TCP devices
sudo ufw allow 80/tcp      # Nginx (optional)
sudo ufw allow 443/tcp     # HTTPS (optional)
sudo ufw enable
sudo ufw status
```

---

## 11. Nginx reverse proxy (optional, recommended for production)

Serve the UI on port **80** and proxy API/WebSocket to the backend on **8081**.

```bash
cd /opt/linuxParser2

# Set variables from env.production
export $(grep -v '^#' env.production | xargs)

# Generate site config
envsubst '${HTTP_PORT} ${SERVER_DOMAIN} ${SERVER_IP} ${FRONTEND_BUILD_PATH} ${MOBILE_FRONTEND_BUILD_PATH} ${MAX_FILE_SIZE}' \
  < nginx.conf | sudo tee /etc/nginx/sites-available/linuxparser2

sudo ln -sf /etc/nginx/sites-available/linuxparser2 /etc/nginx/sites-enabled/
sudo rm -f /etc/nginx/sites-enabled/default
sudo nginx -t
sudo systemctl reload nginx
```

Access: `http://YOUR_IP` or `http://your-domain.com`

With Nginx, set in `env.production`:

```bash
CORS_ORIGIN=http://YOUR_IP,http://your-domain.com
REACT_APP_API_URL=http://YOUR_IP   # or https://your-domain.com when using TLS
```

Rebuild frontend after changing `REACT_APP_API_URL`.

---

## 12. Configure Galileosky devices

Point trackers to your server:

| Setting | Value |
|---------|-------|
| Server IP | Your server public IP |
| TCP port | **3003** |

Verify TCP is listening:

```bash
ss -tlnp | grep 3003
pm2 logs gali-parse --lines 50
```

---

## 13. Verify installation

```bash
# PM2 status
pm2 status

# API health
curl -s http://localhost:8081/api/auth/check

# Login test
curl -s -X POST http://localhost:8081/api/auth/login \
  -H "Content-Type: application/json" \
  -d '{"username":"admin","password":"admin123"}' \
  -c /tmp/cookies.txt

# Ports in use
ss -tlnp | grep -E '8080|8081|3003'
```

Open in browser:

- `http://YOUR_IP:8080` (if frontend serve is running), or
- `http://YOUR_IP:8081` (backend serving static build), or
- `http://YOUR_IP` (with Nginx)

---

## 14. Useful PM2 commands

```bash
pm2 status
pm2 logs gali-parse
pm2 logs gali-parse --lines 100
pm2 restart gali-parse
pm2 stop gali-parse
pm2 monit
```

---

## 15. Updating the application

```bash
cd /opt/linuxParser2
git pull

cd backend && npm install && cd ..
cd frontend && npm install && npm run build && cd ..

pm2 restart gali-parse
pm2 restart gali-parse-frontend   # if using separate frontend process
```

---

## 16. Troubleshooting

### Port already in use

```bash
sudo ss -tlnp | grep -E '8080|8081'
# Stop conflicting service or change HTTP_PORT / FRONTEND_PORT in env.production
pm2 restart gali-parse
```

### PM2 shows online but browser cannot connect

Usually the process is crash-looping (check **↺ restarts** and **0b memory**):

```bash
cd /opt/linuxParser2
pm2 delete gali-parse
pm2 start ecosystem.config.js
pm2 logs gali-parse --lines 80
ss -tlnp | grep -E '8081|8080|3003'
curl -v http://127.0.0.1:8081/api/auth/check
```

Common causes:
- PM2 started from the wrong directory — always run `pm2 start` from `/opt/linuxParser2`
- `JWT_SECRET` / `SESSION_SECRET` still placeholder values in `env.production`
- Port 8081 already used by another app (`iot-monitoring`, etc.)

```bash
sudo ss -tlnp | grep 8081
sudo ufw allow 8081/tcp
sudo ufw allow 8080/tcp
```

### `no such table: users` after init-database

This happens if `init-database.js` and `create-default-admin.js` used different database files. Re-run both from `backend/` (they now share `env.production`):

```bash
cd /opt/linuxParser2/backend
node init-database.js
node create-default-admin.js
```

### Login fails / session issues

- Check `JWT_SECRET` and `SESSION_SECRET` are set (not placeholder values).
- Ensure `CORS_ORIGIN` includes the exact URL in the browser (with port).
- Behind HTTPS: set `COOKIE_SECURE=true`.

### Frontend cannot reach API

- Rebuild with correct `REACT_APP_API_URL`.
- Check firewall allows 8081.
- Test: `curl http://localhost:8081/api/auth/check`

### No device data

- Confirm port **3003** is open and listening.
- Check logs: `pm2 logs gali-parse | grep -i tcp`

### Run startup checks

```bash
chmod +x scripts/check-startup.sh scripts/fix-startup.sh
./scripts/check-startup.sh
```

---

## 17. Quick install (copy-paste summary)

Replace `YOUR_SERVER_IP` before running:

```bash
export SERVER_IP=YOUR_SERVER_IP
export APP_DIR=/opt/linuxParser2

sudo apt update && sudo apt install -y curl git build-essential python3 nginx gettext-base
curl -fsSL https://deb.nodesource.com/setup_20.x | sudo -E bash -
sudo apt install -y nodejs
sudo npm install -g pm2

sudo mkdir -p $APP_DIR && sudo chown $USER:$USER $APP_DIR
git clone https://github.com/haryowl/linuxParser2.git $APP_DIR
cd $APP_DIR

mkdir -p backend/data backend/exports logs backups
cp env.production.example env.production

JWT=$(openssl rand -hex 32)
SESSION=$(openssl rand -hex 32)
sed -i "s/your-server-ip/$SERVER_IP/g" env.production
sed -i "s/your-domain.com/$SERVER_IP/g" env.production
sed -i "s/your-super-secure-jwt-secret-key-change-this-in-production/$JWT/" env.production
sed -i "s/your-super-secure-session-secret-key-change-this-in-production/$SESSION/" env.production

cd backend && npm install && node init-database.js && node create-default-admin.js && cd ..
cd frontend && npm install && REACT_APP_API_URL=http://$SERVER_IP:8081 npm run build && cd ..

cd $APP_DIR && pm2 start ecosystem.config.js && pm2 save && pm2 startup

curl http://localhost:8081/api/auth/check
echo "Open http://$SERVER_IP:8081 in your browser (admin / admin123)"
```

---

## Related documentation

- `env.production.example` — all environment variables
- `ENVIRONMENT_VARIABLES.md` — variable reference
- `DEPLOYMENT_CHECKLIST.md` — production checklist
- `nginx.conf` — Nginx template

---

**Security reminder:** Change the default `admin` password immediately after first login. Never commit `env.production` to Git — it contains secrets.
