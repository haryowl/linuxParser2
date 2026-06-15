# LinuxParser - Galileosky GPS Tracking Parser

A production-ready GPS tracking parser for Galileosky devices with web dashboard, real-time monitoring, and data export capabilities.

[![Node.js Version](https://img.shields.io/badge/node-%3E%3D14.18.0-brightgreen)](https://nodejs.org/)
[![License](https://img.shields.io/badge/license-ISC-blue.svg)](LICENSE)

## 🚀 Features

- **Real-time GPS Tracking**: Parse and process TCP packets from Galileosky GPS devices
- **Web Dashboard**: React-based frontend for monitoring and management
- **Mobile Interface**: Mobile-optimized frontend for on-the-go access
- **Data Export**: Export tracking data in CSV format with customizable date formats
- **User Management**: Role-based access control with permissions
- **Device Management**: Group devices, configure mappings, and track status
- **Automatic Exports**: Scheduled data exports with retention policies
- **WebSocket Support**: Real-time updates via WebSocket connections
- **Production Ready**: PM2 process management, Nginx configuration, logging

## 📋 Prerequisites

- **Node.js** >= 14.18.0
- **npm** >= 6.0.0
- **PM2** (for process management)
- **Nginx** (optional, for reverse proxy)
- **Linux/Ubuntu** (recommended) or Windows with WSL

## 🛠️ Installation

See **[DATABASE_MIGRATION.md](DATABASE_MIGRATION.md)** to merge data from `/opt/LinuxParser` into `/opt/linuxParser2`.

### Fresh Ubuntu server install

See **[FRESH_INSTALL_UBUNTU.md](FRESH_INSTALL_UBUNTU.md)** for a complete guide (clone from [linuxParser2](https://github.com/haryowl/linuxParser2), ports **8080/8081**, PM2, Nginx).

### Quick Start

```bash
# Clone the repository
git clone https://github.com/haryowl/LinuxParser.git
cd LinuxParser

# Install system dependencies (Ubuntu/WSL)
sudo bash scripts/install-dependencies-ubuntu.sh

# Or install manually:
# - Node.js, npm, PM2, build tools, Nginx
# See INSTALL_DEPENDENCIES_UBUNTU.md for details

# Install project dependencies
cd backend
npm install --production

cd ../frontend
npm install --production
npm run build

# Configure environment
cd ..
cp env.production.example env.production
nano env.production
# Set JWT_SECRET, SESSION_SECRET, SERVER_IP

# Initialize database
cd backend
node init-database.js
node create-default-admin.js

# Start application
cd ..
pm2 start ecosystem.config.js
pm2 save
```

### Detailed Installation

See [INSTALL_DEPENDENCIES_UBUNTU.md](INSTALL_DEPENDENCIES_UBUNTU.md) for complete installation instructions.

## ⚙️ Configuration

### Environment Variables

Copy the example environment file and configure:

```bash
cp env.production.example env.production
nano env.production
```

**Required Variables:**
- `JWT_SECRET` - Generate with: `openssl rand -hex 32`
- `SESSION_SECRET` - Generate with: `openssl rand -hex 32`
- `SERVER_IP` - Your server IP address

Optional login throttling defaults:
- `RATE_LIMIT_LOGIN_MAX_REQUESTS=30`
- `RATE_LIMIT_LOGIN_WINDOW_MS=60000`

Optional general API throttling defaults:
- `RATE_LIMIT_ENABLED=true`
- `RATE_LIMIT_MAX_REQUESTS=100`
- `RATE_LIMIT_WINDOW_MS=900000`

See [ENVIRONMENT_VARIABLES.md](ENVIRONMENT_VARIABLES.md) for complete documentation.

### Default Login

After initialization:
- **Username**: `admin`
- **Password**: `admin123`

⚠️ **Change the default password immediately after first login!**

## 🚀 Deployment

### Linux Server Deployment

1. **Prepare files** (on development machine):
   ```bash
   bash scripts/prepare-for-linux.sh
   ```

2. **Transfer to server**:
   ```bash
   scp -r --exclude='node_modules' gali-parse/ user@server:/opt/
   ```

3. **Deploy on server**:
   ```bash
   cd /opt/gali-parse
   sudo bash scripts/deploy-to-linux.sh
   ```

See [LINUX_DEPLOYMENT_GUIDE.md](LINUX_DEPLOYMENT_GUIDE.md) for complete deployment guide.

## 📁 Project Structure

```
gali-parse/
├── backend/              # Node.js/Express backend
│   ├── src/             # Source code
│   │   ├── routes/      # API routes
│   │   ├── models/      # Database models
│   │   ├── services/    # Business logic
│   │   └── utils/       # Utilities
│   ├── data/            # Database files
│   └── exports/         # Export files
├── frontend/            # React frontend
│   ├── src/            # Source code
│   └── build/          # Production build
├── mobile-frontend/     # Mobile React frontend
├── scripts/             # Deployment scripts
├── ecosystem.config.js  # PM2 configuration
├── nginx.conf          # Nginx configuration
└── env.production      # Environment variables (not in repo)
```

## 🔧 Usage

### Start Application

```bash
pm2 start ecosystem.config.js
```

### Monitor Application

```bash
# Status
pm2 status

# Logs
pm2 logs gali-parse

# Monitoring script
./monitor.sh status
./monitor.sh health
```

### Stop Application

```bash
pm2 stop gali-parse
```

## 📡 API Endpoints

- **Health Check**: `GET /api/auth/check`
- **Dashboard Stats**: `GET /api/dashboard/stats`
- **Records**: `GET /api/records`
- **Devices**: `GET /api/devices`
- **Export**: `GET /api/records/export`

See API documentation in the application dashboard.

## 🔒 Security Features

- ✅ JWT-based authentication
- ✅ Session management
- ✅ Password hashing with bcrypt
- ✅ Role-based access control
- ✅ Rate limiting
- ✅ Input validation
- ✅ CORS configuration
- ✅ Environment variable validation

## 📊 Features

- Real-time device tracking
- GPS data visualization
- Data export (CSV format)
- Automatic scheduled exports
- Device grouping
- User management
- Alert system
- Dashboard statistics

## 🛠️ Development

### Backend Development

```bash
cd backend
npm install
npm run dev
```

### Frontend Development

```bash
cd frontend
npm install
npm start
```

## 📝 Documentation

- [Installation Guide](INSTALL_DEPENDENCIES_UBUNTU.md)
- [Linux Deployment Guide](LINUX_DEPLOYMENT_GUIDE.md)
- [Deployment Checklist](DEPLOYMENT_CHECKLIST.md)
- [Environment Variables](ENVIRONMENT_VARIABLES.md)
- [Production Deployment Guide](PRODUCTION_DEPLOYMENT_GUIDE.md)

## 🤝 Contributing

Contributions are welcome! Please feel free to submit a Pull Request.

## 📄 License

ISC License

## ⚠️ Important Notes

1. **Security**: Always change default credentials and use strong secrets in production
2. **Database**: SQLite is used by default. For high-traffic deployments, consider PostgreSQL
3. **Backups**: Implement regular backups of database and configuration files
4. **Monitoring**: Use PM2 monitoring and log files to track application health

## 🐛 Troubleshooting

### Application won't start
- Check environment variables are set correctly
- Verify Node.js version >= 14.18.0
- Check PM2 logs: `pm2 logs gali-parse`

### Database errors
- Check database file permissions
- Ensure data directory exists and is writable

### Port conflicts
- Check if ports 8081, 3003 are available
- Modify ports in `env.production`

See [DEPLOYMENT_CHECKLIST.md](DEPLOYMENT_CHECKLIST.md) for troubleshooting guide.

## 📞 Support

For issues and questions, please open an issue on GitHub.

---

**Repository**: [https://github.com/haryowl/LinuxParser](https://github.com/haryowl/LinuxParser)


