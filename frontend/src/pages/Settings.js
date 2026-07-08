import React, { useState, useEffect, useCallback } from 'react';
import {
  Container,
  Typography,
  Grid,
  TextField,
  Button,
  Switch,
  FormControlLabel,
  Box,
  Alert,
  Snackbar,
  Card,
  CardContent,
  Dialog,
  DialogTitle,
  DialogContent,
  DialogActions,
  List,
  ListItem,
  ListItemText,
  ListItemSecondaryAction,
  Chip,
  useTheme,
  MenuItem
} from '@mui/material';
import {
  Save as SaveIcon,
  Backup as BackupIcon,
  FileDownload as ExportIcon,
  FileUpload as ImportIcon,
  Refresh as RefreshIcon,
  Memory as MemoryIcon,
  Storage as StorageIcon,
  Speed as SpeedIcon,
  Warning as WarningIcon,
  CheckCircle as CheckCircleIcon,
  Error as ErrorIcon,
  Settings as SettingsIcon,
  DarkMode as DarkModeIcon,
  LightMode as LightModeIcon
} from '@mui/icons-material';
// import axios from 'axios';
import { BASE_URL } from '../services/api';
import { alpha } from '@mui/material/styles';
import { useTheme as useAppTheme } from '../contexts/ThemeContext';
import { useAuth } from '../contexts/AuthContext';
import {
  fetchSettings as apiFetchSettings,
  updateSettings as apiUpdateSettings,
  fetchDataForwarderConfig,
  updateDataForwarderConfig,
  authenticatedFetch,
  fetchDataForwarderLogs,
  fetchDevices,
  fetchRetentionConfig,
  updateRetentionConfig,
  runRetentionPurge,
  fetchStorageConfig,
  updateStorageConfig,
  runStorageCleanup
} from '../services/api';

const Settings = () => {
  const theme = useTheme();
  const { isDarkMode, toggleTheme } = useAppTheme();
  const { user } = useAuth();
  const isAdmin = user?.role === 'admin';
  const [settings, setSettings] = useState({
    serverUrl: BASE_URL || '',
    wsUrl: BASE_URL.replace('http', 'ws') || '',
    dataRetentionDays: 30,
    enableNotifications: true,
    enableAutoRefresh: true,
    refreshInterval: 30,
    enableDataExport: true,
    exportFormat: 'csv',
    enableDebugLogging: false
  });

  const [snackbar, setSnackbar] = useState({
    open: false,
    message: '',
    severity: 'success'
  });

  const [backups, setBackups] = useState([]);
  const [importDialogOpen, setImportDialogOpen] = useState(false);
  const [selectedFile, setSelectedFile] = useState(null);
  const [backupDialogOpen, setBackupDialogOpen] = useState(false);
  const [backupName, setBackupName] = useState('');
  const [systemStatus, setSystemStatus] = useState({
    cpu: 0,
    memory: { heapUsed: 0, heapTotal: 0, external: 0, rss: 0 },
    platform: 'Unknown',
    version: 'Unknown',
    uptime: 0,
    pid: 0,
    startTime: null,
    lastUpdate: null
  });
  const [isLoadingStatus, setIsLoadingStatus] = useState(false);
  const [systemHealth, setSystemHealth] = useState({
    status: 'unknown',
    checks: {},
    lastCheck: null
  });
  const [isCheckingHealth, setIsCheckingHealth] = useState(false);

  // Data Forwarder Config State
  const [forwarderConfig, setForwarderConfig] = useState({ enabled: false, targetUrl: 'http://accessmyship.com:8008/GpsGate/' });
  const [isLoadingForwarder, setIsLoadingForwarder] = useState(false);
  const [forwarderLogs, setForwarderLogs] = useState([]);
  const [isLoadingLogs, setIsLoadingLogs] = useState(false);
  const [deviceOptions, setDeviceOptions] = useState([]);
  const [retentionConfig, setRetentionConfig] = useState({
    enabled: false,
    retentionDays: 365,
    lastPurgeAt: null,
    lastPurgeDeleted: 0
  });
  const [isLoadingRetention, setIsLoadingRetention] = useState(false);
  const [isPurgingRetention, setIsPurgingRetention] = useState(false);
  const [storageConfig, setStorageConfig] = useState({
    logs: { enabled: true, maxTotalSizeMB: 500, maxFilesPerDirectory: 5 },
    exports: { enabled: true, retentionDays: 30 },
    backups: { enabled: true, retentionDays: 7, maxCount: 20 }
  });
  const [isLoadingStorage, setIsLoadingStorage] = useState(false);
  const [isRunningCleanup, setIsRunningCleanup] = useState(false);

  const showSnackbar = (message, severity) => {
    setSnackbar({
      open: true,
      message,
      severity
    });
  };

  const handleCloseSnackbar = () => {
    setSnackbar({ ...snackbar, open: false });
  };

  const formatSize = (mb) => {
    if (mb === null || mb === undefined || Number.isNaN(Number(mb))) return '0 MB';
    const value = Number(mb);
    if (value >= 1024) return `${(value / 1024).toFixed(2)} GB`;
    return `${value.toFixed(1)} MB`;
  };

  const loadStorageConfig = useCallback(async () => {
    if (!isAdmin) return;
    try {
      setIsLoadingStorage(true);
      const response = await fetchStorageConfig();
      if (response.ok) {
        const data = await response.json();
        setStorageConfig(data);
      }
    } catch (error) {
      showSnackbar('Failed to load storage settings', 'error');
    } finally {
      setIsLoadingStorage(false);
    }
  }, [isAdmin]);

  const handleSaveStorage = async () => {
    try {
      setIsLoadingStorage(true);
      const response = await updateStorageConfig({
        logs: storageConfig.logs,
        exports: storageConfig.exports,
        backups: storageConfig.backups
      });
      if (response.ok) {
        const data = await response.json();
        setStorageConfig(data.config || storageConfig);
        showSnackbar('Storage settings saved', 'success');
      } else {
        showSnackbar('Failed to save storage settings', 'error');
      }
    } catch (error) {
      showSnackbar('Failed to save storage settings', 'error');
    } finally {
      setIsLoadingStorage(false);
    }
  };

  const handleRunStorageCleanup = async (section) => {
    try {
      setIsRunningCleanup(true);
      const response = await runStorageCleanup(section);
      if (response.ok) {
        const data = await response.json();
        if (data.config) {
          setStorageConfig(data.config);
        }
        showSnackbar(section ? `${section} cleanup completed` : 'Storage cleanup completed', 'success');
        await fetchSystemStatus();
      } else {
        showSnackbar('Storage cleanup failed', 'error');
      }
    } catch (error) {
      showSnackbar('Storage cleanup failed', 'error');
    } finally {
      setIsRunningCleanup(false);
    }
  };

  const loadRetentionConfig = useCallback(async () => {
    if (!isAdmin) return;
    try {
      setIsLoadingRetention(true);
      const response = await fetchRetentionConfig();
      if (response.ok) {
        const data = await response.json();
        setRetentionConfig(data);
      }
    } catch (error) {
      showSnackbar('Failed to load retention settings', 'error');
    } finally {
      setIsLoadingRetention(false);
    }
  }, [isAdmin]);

  const handleSaveRetention = async () => {
    try {
      setIsLoadingRetention(true);
      const response = await updateRetentionConfig({
        enabled: retentionConfig.enabled,
        retentionDays: retentionConfig.retentionDays
      });
      if (response.ok) {
        const data = await response.json();
        setRetentionConfig(data.config || retentionConfig);
        showSnackbar('Retention settings saved', 'success');
      } else {
        showSnackbar('Failed to save retention settings', 'error');
      }
    } catch (error) {
      showSnackbar('Failed to save retention settings', 'error');
    } finally {
      setIsLoadingRetention(false);
    }
  };

  const handleRunRetentionPurge = async () => {
    try {
      setIsPurgingRetention(true);
      const response = await runRetentionPurge();
      if (response.ok) {
        const data = await response.json();
        setRetentionConfig((prev) => ({
          ...prev,
          lastPurgeAt: data.result?.cutoff || new Date().toISOString(),
          lastPurgeDeleted: data.result?.deleted || 0
        }));
        showSnackbar(`Purge completed (${data.result?.deleted || 0} records removed)`, 'success');
        await loadRetentionConfig();
      } else {
        showSnackbar('Retention purge failed', 'error');
      }
    } catch (error) {
      showSnackbar('Retention purge failed', 'error');
    } finally {
      setIsPurgingRetention(false);
    }
  };

  const fetchSettings = useCallback(async () => {
    try {
      const response = await apiFetchSettings();
      if (response.ok) {
        const data = await response.json();
        // Merge with default settings to ensure all required fields exist
        setSettings(prevSettings => ({
          ...prevSettings,
          ...data,
          // Ensure these fields always have values
          serverUrl: data.serverUrl || prevSettings.serverUrl || BASE_URL || '',
          wsUrl: data.wsUrl || prevSettings.wsUrl || BASE_URL.replace('http', 'ws') || '',
          dataRetentionDays: data.dataRetentionDays || prevSettings.dataRetentionDays || 30,
          enableNotifications: data.enableNotifications !== undefined ? data.enableNotifications : prevSettings.enableNotifications,
          enableAutoRefresh: data.enableAutoRefresh !== undefined ? data.enableAutoRefresh : prevSettings.enableAutoRefresh,
          refreshInterval: data.refreshInterval || prevSettings.refreshInterval || 30,
          enableDataExport: data.enableDataExport !== undefined ? data.enableDataExport : prevSettings.enableDataExport,
          exportFormat: data.exportFormat || prevSettings.exportFormat || 'csv',
          enableDebugLogging: data.enableDebugLogging !== undefined ? data.enableDebugLogging : prevSettings.enableDebugLogging
        }));
      } else {
        showSnackbar('Error loading settings', 'error');
      }
    } catch (error) {
      console.error('Error fetching settings:', error);
      showSnackbar('Error loading settings', 'error');
    }
  }, []);

  const fetchBackups = async () => {
    try {
      const response = await authenticatedFetch(`${BASE_URL}/api/settings/backups`);
      if (response.ok) {
        const data = await response.json();
        setBackups(Array.isArray(data) ? data : []);
      } else {
        setBackups([]);
      }
    } catch (error) {
      console.error('Error fetching backups:', error);
      setBackups([]);
    }
  };

  const fetchSystemStatus = async () => {
    setIsLoadingStatus(true);
    try {
      const response = await authenticatedFetch(`${BASE_URL}/api/settings/status`);
      if (response.ok) {
        const data = await response.json();
        setSystemStatus(prevStatus => ({
          ...prevStatus,
          ...data,
          // Ensure these fields always have proper values
          cpu: data.cpu || 0,
          memory: data.memory || { heapUsed: 0, heapTotal: 0, external: 0, rss: 0 },
          platform: data.platform || 'Unknown',
          version: data.version || 'Unknown',
          uptime: data.uptime || 0,
          pid: data.pid || 0,
          startTime: data.startTime ? new Date(data.startTime) : null,
          lastUpdate: new Date()
        }));
      }
    } catch (error) {
      console.error('Error fetching system status:', error);
    } finally {
      setIsLoadingStatus(false);
    }
  };

  const checkSystemHealth = async () => {
    setIsCheckingHealth(true);
    try {
      const response = await authenticatedFetch(`${BASE_URL}/api/settings/health`);
      if (response.ok) {
        const data = await response.json();
        setSystemHealth(prevHealth => ({
          ...prevHealth,
          ...data,
          // Ensure these fields always have values
          status: data.status || 'unknown',
          checks: data.checks || {},
          lastCheck: new Date()
        }));
      }
    } catch (error) {
      console.error('Error checking system health:', error);
    } finally {
      setIsCheckingHealth(false);
    }
  };

  const fetchForwarderConfig = useCallback(async () => {
    setIsLoadingForwarder(true);
    try {
      const response = await fetchDataForwarderConfig();
      if (response.ok) {
        const data = await response.json();
        setForwarderConfig(data);
      } else {
        showSnackbar('Failed to load data forwarder config', 'error');
      }
    } catch (e) {
      showSnackbar('Error loading data forwarder config', 'error');
    } finally {
      setIsLoadingForwarder(false);
    }
  }, []);

  const handleLoadForwarderLogs = async () => {
    setIsLoadingLogs(true);
    try {
      const response = await fetchDataForwarderLogs();
      if (response.ok) {
        const data = await response.json();
        setForwarderLogs(data.logs || []);
      } else {
        setForwarderLogs(['Failed to load logs']);
      }
    } catch (e) {
      setForwarderLogs(['Error loading logs']);
    } finally {
      setIsLoadingLogs(false);
    }
  };

  useEffect(() => {
    // Load essential data only
    fetchSettings();
    fetchForwarderConfig();
    loadRetentionConfig();
    loadStorageConfig();
    
    // Load secondary data with delay to avoid overwhelming
    setTimeout(() => {
      fetchBackups();
      fetchSystemStatus();
      checkSystemHealth();
    }, 1000);
    
    // Reduce polling frequency - only poll system status, not health
    const statusInterval = setInterval(fetchSystemStatus, 120000); // Every 2 minutes instead of 30 seconds
    
    return () => {
      clearInterval(statusInterval);
    };
  }, [fetchSettings, fetchForwarderConfig, loadRetentionConfig, loadStorageConfig]);

  useEffect(() => {
    // Fetch device IMEIs for the multi-select
    const loadDevices = async () => {
      try {
        const response = await fetchDevices();
        if (response.ok) {
          const devices = await response.json();
          setDeviceOptions(devices.map(d => ({ label: d.imei, value: d.imei })));
        }
      } catch (e) {}
    };
    loadDevices();
  }, []);

  const handleSave = async () => {
    try {
      const response = await apiUpdateSettings(settings);
      if (response.ok) {
        showSnackbar('Settings saved successfully', 'success');
      } else {
        showSnackbar('Error saving settings', 'error');
      }
    } catch (error) {
      console.error('Error saving settings:', error);
      showSnackbar('Error saving settings', 'error');
    }
  };

  const handleCreateBackup = async () => {
    try {
      await authenticatedFetch(`${BASE_URL}/api/settings/backups`, {
        method: 'POST',
        body: JSON.stringify({
          name: backupName || `Backup_${new Date().toISOString()}`
        })
      });
      setBackupDialogOpen(false);
      setBackupName('');
      fetchBackups();
      setSnackbar({ open: true, message: 'Backup created successfully', severity: 'success' });
    } catch (error) {
      console.error('Error creating backup:', error);
      setSnackbar({ open: true, message: 'Error creating backup', severity: 'error' });
    }
  };

  // const handleRestoreBackup = async (backupFile) => {
  //   try {
  //     await authenticatedFetch(`${BASE_URL}/api/settings/backups/${backupId}/restore`, {
  //       method: 'POST'
  //     });
  //     fetchSettings();
  //     setSnackbar({ open: true, message: 'Settings restored successfully', severity: 'success' });
  //   } catch (error) {
  //     console.error('Error restoring backup:', error);
  //     setSnackbar({ open: true, message: 'Error restoring backup', severity: 'error' });
  //   }
  // };

  // const handleDeleteBackup = async (backupFile) => {
  //   try {
  //     await authenticatedFetch(`${BASE_URL}/api/settings/backups/${backupId}`, {
  //       method: 'DELETE'
  //     });
  //     fetchBackups();
  //     setSnackbar({ open: true, message: 'Backup deleted successfully', severity: 'success' });
  //   } catch (error) {
  //     console.error('Error deleting backup:', error);
  //     setSnackbar({ open: true, message: 'Error deleting backup', severity: 'error' });
  //   }
  // };

  const handleExportSettings = async () => {
    try {
      const response = await authenticatedFetch(`${BASE_URL}/api/settings/export`, {
        method: 'GET',
        responseType: 'blob'
      });
      
      const url = window.URL.createObjectURL(new Blob([response.data]));
      const link = document.createElement('a');
      link.href = url;
      link.setAttribute('download', 'settings.json');
      document.body.appendChild(link);
      link.click();
      link.remove();
    } catch (error) {
      console.error('Error exporting settings:', error);
      setSnackbar({ open: true, message: 'Error exporting settings', severity: 'error' });
    }
  };

  const handleImportSettings = async () => {
    if (!selectedFile) return;

    const formData = new FormData();
    formData.append('file', selectedFile);

    try {
      await authenticatedFetch(`${BASE_URL}/api/settings/import`, {
        method: 'POST',
        body: formData
      });
      setImportDialogOpen(false);
      setSelectedFile(null);
      fetchSettings();
      setSnackbar({ open: true, message: 'Settings imported successfully', severity: 'success' });
    } catch (error) {
      console.error('Error importing settings:', error);
      setSnackbar({ open: true, message: 'Error importing settings', severity: 'error' });
    }
  };

  const handleForwarderChange = (e) => {
    const { name, value, type, checked } = e.target;
    setForwarderConfig(cfg => ({
      ...cfg,
      [name]: type === 'checkbox' ? checked : value
    }));
  };

  const handleSaveForwarder = async () => {
    setIsLoadingForwarder(true);
    try {
      const response = await updateDataForwarderConfig(forwarderConfig);
      if (response.ok) {
        showSnackbar('Data forwarder config saved', 'success');
      } else {
        showSnackbar('Failed to save data forwarder config', 'error');
      }
    } catch (e) {
      showSnackbar('Error saving data forwarder config', 'error');
    } finally {
      setIsLoadingForwarder(false);
    }
  };

  const formatUptime = (seconds) => {
    const days = Math.floor(seconds / 86400);
    const hours = Math.floor((seconds % 86400) / 3600);
    const minutes = Math.floor((seconds % 3600) / 60);
    return `${days}d ${hours}h ${minutes}m`;
  };

  const getHealthStatusColor = (status) => {
    const normalized = typeof status === 'object' ? status?.status : status;
    if (!normalized) return 'default';
    switch (normalized.toLowerCase()) {
      case 'healthy':
        return 'success';
      case 'warning':
        return 'warning';
      case 'error':
        return 'error';
      default:
        return 'default';
    }
  };

  const getHealthStatusIcon = (status) => {
    const normalized = typeof status === 'object' ? status?.status : status;
    if (!normalized) return <ErrorIcon />;
    switch (normalized.toLowerCase()) {
      case 'healthy':
        return <CheckCircleIcon />;
      case 'warning':
        return <WarningIcon />;
      case 'error':
        return <ErrorIcon />;
      default:
        return <ErrorIcon />;
    }
  };

  const normalizeHealthCheck = (check) => {
    if (typeof check === 'string') {
      return { status: check, value: '', detail: '' };
    }
    return {
      status: check?.status || 'unknown',
      value: check?.value || '',
      detail: check?.detail || ''
    };
  };

  const formatCheckName = (name) => {
    if (name === 'systemMemory') return 'System Memory';
    if (name === 'cache') return 'API Cache';
    return name.charAt(0).toUpperCase() + name.slice(1);
  };

  return (
    <Container maxWidth="xl" sx={{ mt: 2, mb: 4 }}>
      {/* Header */}
      <Box sx={{ 
        display: 'flex', 
        justifyContent: 'space-between', 
        alignItems: 'center', 
        mb: 4,
        p: 3,
        backgroundColor: 'background.paper',
        borderRadius: 3,
        border: `1px solid ${theme.palette.divider}`,
        boxShadow: '0 2px 8px rgba(0,0,0,0.1)'
      }}>
        <Box>
          <Typography variant="h3" component="h1" fontWeight="bold" gutterBottom color="text.primary">
            System Settings
          </Typography>
          <Typography variant="body1" color="text.secondary">
            Configure system preferences and manage backups
          </Typography>
        </Box>
        <Box sx={{ display: 'flex', gap: 2 }}>
          <Button
            variant="outlined"
            startIcon={<BackupIcon />}
            onClick={() => setBackupDialogOpen(true)}
          >
            Create Backup
          </Button>
          <Button
            variant="outlined"
            startIcon={<ExportIcon />}
            onClick={handleExportSettings}
          >
            Export
          </Button>
          <Button
            variant="outlined"
            startIcon={<ImportIcon />}
            onClick={() => setImportDialogOpen(true)}
          >
            Import
          </Button>
          <Button
            variant="contained"
            color="primary"
            startIcon={<SaveIcon />}
            onClick={handleSave}
          >
            Save Changes
          </Button>
        </Box>
      </Box>

      <Grid container spacing={3}>
        {/* System Health */}
        <Grid item xs={12}>
          <Card sx={{ 
            backgroundColor: 'background.paper',
            border: `1px solid ${theme.palette.divider}`,
            boxShadow: '0 2px 8px rgba(0,0,0,0.1)'
          }}>
            <CardContent sx={{ p: 3 }}>
              <Box sx={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', mb: 3 }}>
                <Typography variant="h5" fontWeight="600" color="text.primary">
                  System Health
                </Typography>
                <Button
                  startIcon={<RefreshIcon />}
                  onClick={checkSystemHealth}
                  disabled={isCheckingHealth}
                  variant="outlined"
                  size="small"
                >
                  Check Health
                </Button>
              </Box>
              <Box sx={{ display: 'flex', alignItems: 'center', mb: 3 }}>
                <Chip
                  icon={getHealthStatusIcon(systemHealth?.status)}
                  label={(systemHealth?.status || 'unknown').toUpperCase()}
                  color={getHealthStatusColor(systemHealth?.status)}
                  sx={{ mr: 2, fontWeight: 600 }}
                />
                {systemHealth?.lastCheck && (
                  <Typography variant="body2" color="text.secondary">
                    Last checked: {systemHealth.lastCheck.toLocaleString()}
                  </Typography>
                )}
              </Box>
              <List>
                {systemHealth?.checks && typeof systemHealth.checks === 'object' ?
                  Object.entries(systemHealth.checks).map(([name, rawCheck]) => {
                    const check = normalizeHealthCheck(rawCheck);
                    return (
                    <ListItem key={name} sx={{ 
                      p: 2, 
                      mb: 1, 
                      borderRadius: 2,
                      backgroundColor: alpha(theme.palette.background.default, 0.5),
                      border: `1px solid ${theme.palette.divider}`
                    }}>
                      <ListItemText
                        primary={`${formatCheckName(name)}${check.value ? `: ${check.value}` : ''}`}
                        secondary={check.detail || `Status: ${check.status}`}
                        primaryTypographyProps={{ fontWeight: 600, color: 'text.primary' }}
                        secondaryTypographyProps={{ color: 'text.secondary' }}
                      />
                      <ListItemSecondaryAction>
                        <Chip
                          icon={getHealthStatusIcon(check.status)}
                          label={(check.status || 'unknown').toUpperCase()}
                          color={getHealthStatusColor(check.status)}
                          size="small"
                          variant="outlined"
                        />
                      </ListItemSecondaryAction>
                    </ListItem>
                  );
                  })
                  : 
                  <ListItem sx={{ 
                    p: 2, 
                    borderRadius: 2,
                    backgroundColor: alpha(theme.palette.background.default, 0.5),
                    border: `1px solid ${theme.palette.divider}`
                  }}>
                    <ListItemText
                      primary="No health checks available"
                      secondary="Health check data is not available"
                      primaryTypographyProps={{ color: 'text.primary' }}
                      secondaryTypographyProps={{ color: 'text.secondary' }}
                    />
                  </ListItem>
                }
              </List>
            </CardContent>
          </Card>
        </Grid>

        {/* System Status */}
        <Grid item xs={12}>
          <Card sx={{ 
            backgroundColor: 'background.paper',
            border: `1px solid ${theme.palette.divider}`,
            boxShadow: '0 2px 8px rgba(0,0,0,0.1)'
          }}>
            <CardContent sx={{ p: 3 }}>
              <Box sx={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', mb: 3 }}>
                <Typography variant="h5" fontWeight="600" color="text.primary">
                  System Status
                </Typography>
                <Button
                  startIcon={<RefreshIcon />}
                  onClick={fetchSystemStatus}
                  disabled={isLoadingStatus}
                  variant="outlined"
                  size="small"
                >
                  Refresh
                </Button>
              </Box>
              <Grid container spacing={3}>
                <Grid item xs={12} md={3}>
                  <Box sx={{ 
                    p: 3, 
                    borderRadius: 2,
                    backgroundColor: alpha(theme.palette.primary.main, 0.05),
                    border: `1px solid ${alpha(theme.palette.primary.main, 0.2)}`,
                    textAlign: 'center'
                  }}>
                    <MemoryIcon sx={{ fontSize: 48, color: theme.palette.primary.main, mb: 2 }} />
                    <Typography variant="h4" fontWeight="bold" color="primary.main" gutterBottom>
                      {systemStatus.memory?.process?.heapUsedMB
                        ?? (systemStatus.memory ? Math.round(systemStatus.memory.heapUsed / 1024 / 1024) : 0)} MB
                    </Typography>
                    <Typography variant="subtitle1" fontWeight="600" gutterBottom color="text.primary">
                      Process RAM
                    </Typography>
                    <Typography variant="body2" color="text.secondary">
                      Heap used / {systemStatus.memory?.process?.heapTotalMB || 0} MB total
                    </Typography>
                  </Box>
                </Grid>
                <Grid item xs={12} md={3}>
                  <Box sx={{ 
                    p: 3, 
                    borderRadius: 2,
                    backgroundColor: alpha(theme.palette.success.main, 0.05),
                    border: `1px solid ${alpha(theme.palette.success.main, 0.2)}`,
                    textAlign: 'center'
                  }}>
                    <StorageIcon sx={{ fontSize: 48, color: theme.palette.success.main, mb: 2 }} />
                    <Typography variant="h4" fontWeight="bold" color="success.main" gutterBottom>
                      {systemStatus.memory?.system?.usedPercent ?? 0}%
                    </Typography>
                    <Typography variant="subtitle1" fontWeight="600" gutterBottom color="text.primary">
                      System RAM
                    </Typography>
                    <Typography variant="body2" color="text.secondary">
                      {formatSize(systemStatus.memory?.system?.usedMB)} / {formatSize(systemStatus.memory?.system?.totalMB)}
                    </Typography>
                  </Box>
                </Grid>
                <Grid item xs={12} md={3}>
                  <Box sx={{ 
                    p: 3, 
                    borderRadius: 2,
                    backgroundColor: alpha(theme.palette.warning.main, 0.05),
                    border: `1px solid ${alpha(theme.palette.warning.main, 0.2)}`,
                    textAlign: 'center'
                  }}>
                    <StorageIcon sx={{ fontSize: 48, color: theme.palette.warning.main, mb: 2 }} />
                    <Typography variant="h4" fontWeight="bold" color="warning.main" gutterBottom>
                      {formatSize(systemStatus.storage?.total?.mb)}
                    </Typography>
                    <Typography variant="subtitle1" fontWeight="600" gutterBottom color="text.primary">
                      App Storage
                    </Typography>
                    <Typography variant="body2" color="text.secondary">
                      Database, logs, exports, backups
                    </Typography>
                  </Box>
                </Grid>
                <Grid item xs={12} md={3}>
                  <Box sx={{ 
                    p: 3, 
                    borderRadius: 2,
                    backgroundColor: alpha(theme.palette.info.main, 0.05),
                    border: `1px solid ${alpha(theme.palette.info.main, 0.2)}`,
                    textAlign: 'center'
                  }}>
                    <SpeedIcon sx={{ fontSize: 48, color: theme.palette.info.main, mb: 2 }} />
                    <Typography variant="h4" fontWeight="bold" color="info.main" gutterBottom>
                      {systemStatus.cache?.activeEntries ?? 0}
                    </Typography>
                    <Typography variant="subtitle1" fontWeight="600" gutterBottom color="text.primary">
                      API Cache
                    </Typography>
                    <Typography variant="body2" color="text.secondary">
                      {systemStatus.cpu || 0} CPU cores · {systemStatus.platform || 'Unknown'}
                    </Typography>
                  </Box>
                </Grid>
              </Grid>
              <Box sx={{ mt: 3, p: 3, borderRadius: 2, backgroundColor: alpha(theme.palette.background.default, 0.5), border: `1px solid ${theme.palette.divider}` }}>
                <Typography variant="subtitle1" fontWeight="600" gutterBottom color="text.primary">
                  Storage Breakdown
                </Typography>
                <Grid container spacing={2}>
                  <Grid item xs={12} md={4}>
                    <Typography variant="body2" color="text.secondary">
                      Database: {formatSize(systemStatus.storage?.database?.mb)}
                    </Typography>
                  </Grid>
                  <Grid item xs={12} md={4}>
                    <Typography variant="body2" color="text.secondary">
                      Logs: {formatSize(systemStatus.storage?.logs?.mb)}
                    </Typography>
                  </Grid>
                  <Grid item xs={12} md={4}>
                    <Typography variant="body2" color="text.secondary">
                      Exports: {formatSize(systemStatus.storage?.exports?.mb)}
                    </Typography>
                  </Grid>
                  <Grid item xs={12} md={4}>
                    <Typography variant="body2" color="text.secondary">
                      Backups: {formatSize(systemStatus.storage?.backups?.mb)}
                    </Typography>
                  </Grid>
                  <Grid item xs={12} md={4}>
                    <Typography variant="body2" color="text.secondary">
                      Sessions: {formatSize(systemStatus.storage?.sessions?.mb)}
                    </Typography>
                  </Grid>
                  <Grid item xs={12} md={4}>
                    <Typography variant="body2" color="text.secondary">
                      Process RSS: {formatSize(systemStatus.memory?.process?.rssMB)}
                    </Typography>
                  </Grid>
                </Grid>
                {systemStatus.buffers && (
                  <Box sx={{ mt: 2 }}>
                    <Typography variant="subtitle2" fontWeight="600" gutterBottom color="text.primary">
                      GPS Buffers
                    </Typography>
                    <Typography variant="body2" color="text.secondary">
                      Memory buffer: {formatSize((systemStatus.buffers.memoryBufferSize || 0) / (1024 * 1024))} ·
                      Disk buffer: {formatSize((systemStatus.buffers.diskBufferSize || 0) / (1024 * 1024))} ·
                      Active connections: {systemStatus.buffers.activeConnections || 0}
                    </Typography>
                  </Box>
                )}
              </Box>
              <Box sx={{ mt: 2, p: 3, borderRadius: 2, backgroundColor: alpha(theme.palette.background.default, 0.5), border: `1px solid ${theme.palette.divider}` }}>
                <Grid container spacing={2}>
                  <Grid item xs={12} md={6}>
                    <Typography variant="body2" color="text.secondary">
                      Uptime: {formatUptime(systemStatus.uptime || 0)}
                    </Typography>
                  </Grid>
                  <Grid item xs={12} md={6}>
                    <Typography variant="body2" color="text.secondary">
                      Node Version: {systemStatus.version || 'Unknown'}
                    </Typography>
                  </Grid>
                </Grid>
              </Box>
              {systemStatus.lastUpdate && (
                <Typography variant="caption" color="text.secondary" display="block" mt={2} textAlign="center">
                  Last updated: {systemStatus.lastUpdate.toLocaleString()}
                </Typography>
              )}
            </CardContent>
          </Card>
        </Grid>

        {/* Configuration Settings */}
        <Grid item xs={12} md={6}>
          <Card sx={{ 
            backgroundColor: 'background.paper',
            border: `1px solid ${theme.palette.divider}`,
            boxShadow: '0 2px 8px rgba(0,0,0,0.1)'
          }}>
            <CardContent sx={{ p: 3 }}>
              <Box sx={{ display: 'flex', alignItems: 'center', mb: 3 }}>
                <SettingsIcon sx={{ mr: 2, color: theme.palette.primary.main }} />
                <Typography variant="h5" fontWeight="600" color="text.primary">
                  Server Configuration
                </Typography>
              </Box>
              <TextField
                fullWidth
                label="Server URL"
                value={settings.serverUrl}
                onChange={(e) => setSettings({ ...settings, serverUrl: e.target.value })}
                margin="normal"
                variant="outlined"
              />
              <TextField
                fullWidth
                label="WebSocket URL"
                value={settings.wsUrl}
                onChange={(e) => setSettings({ ...settings, wsUrl: e.target.value })}
                margin="normal"
                variant="outlined"
              />
            </CardContent>
          </Card>
        </Grid>

        <Grid item xs={12} md={6}>
          <Card sx={{ 
            backgroundColor: 'background.paper',
            border: `1px solid ${theme.palette.divider}`,
            boxShadow: '0 2px 8px rgba(0,0,0,0.1)'
          }}>
            <CardContent sx={{ p: 3 }}>
              <Box sx={{ display: 'flex', alignItems: 'center', mb: 3 }}>
                <StorageIcon sx={{ mr: 2, color: theme.palette.success.main }} />
                <Typography variant="h5" fontWeight="600" color="text.primary">
                  Data Management
                </Typography>
              </Box>
              <TextField
                fullWidth
                type="number"
                label="Data Retention (days)"
                value={settings.dataRetentionDays}
                onChange={(e) => setSettings({ ...settings, dataRetentionDays: parseInt(e.target.value) || 30 })}
                margin="normal"
                variant="outlined"
              />
              <FormControlLabel
                control={
                  <Switch
                    checked={settings.enableDataExport}
                    onChange={(e) => setSettings({ ...settings, enableDataExport: e.target.checked })}
                  />
                }
                label="Enable Data Export"
                sx={{ mt: 2 }}
              />
            </CardContent>
          </Card>
        </Grid>

        <Grid item xs={12} md={6}>
          <Card sx={{ 
            backgroundColor: 'background.paper',
            border: `1px solid ${theme.palette.divider}`,
            boxShadow: '0 2px 8px rgba(0,0,0,0.1)'
          }}>
            <CardContent sx={{ p: 3 }}>
              <Box sx={{ display: 'flex', alignItems: 'center', mb: 3 }}>
                <SettingsIcon sx={{ mr: 2, color: theme.palette.warning.main }} />
                <Typography variant="h5" fontWeight="600" color="text.primary">
                  Notifications
                </Typography>
              </Box>
              <FormControlLabel
                control={
                  <Switch
                    checked={settings.enableNotifications}
                    onChange={(e) => setSettings({ ...settings, enableNotifications: e.target.checked })}
                  />
                }
                label="Enable Notifications"
              />
            </CardContent>
          </Card>
        </Grid>

        <Grid item xs={12} md={6}>
          <Card sx={{ 
            backgroundColor: 'background.paper',
            border: `1px solid ${theme.palette.divider}`,
            boxShadow: '0 2px 8px rgba(0,0,0,0.1)'
          }}>
            <CardContent sx={{ p: 3 }}>
              <Box sx={{ display: 'flex', alignItems: 'center', mb: 3 }}>
                <SpeedIcon sx={{ mr: 2, color: theme.palette.info.main }} />
                <Typography variant="h5" fontWeight="600" color="text.primary">
                  Display Settings
                </Typography>
              </Box>
              <FormControlLabel
                control={
                  <Switch
                    checked={settings.enableAutoRefresh}
                    onChange={(e) => setSettings({ ...settings, enableAutoRefresh: e.target.checked })}
                  />
                }
                label="Enable Auto Refresh"
              />
              <TextField
                fullWidth
                type="number"
                label="Refresh Interval (seconds)"
                value={settings.refreshInterval}
                onChange={(e) => setSettings({ ...settings, refreshInterval: parseInt(e.target.value) })}
                margin="normal"
                variant="outlined"
                disabled={!settings.enableAutoRefresh}
              />
            </CardContent>
          </Card>
        </Grid>

        <Grid item xs={12} md={6}>
          <Card sx={{ 
            backgroundColor: 'background.paper',
            border: `1px solid ${theme.palette.divider}`,
            boxShadow: '0 2px 8px rgba(0,0,0,0.1)'
          }}>
            <CardContent sx={{ p: 3 }}>
              <Box sx={{ display: 'flex', alignItems: 'center', mb: 3 }}>
                {isDarkMode ? (
                  <DarkModeIcon sx={{ mr: 2, color: theme.palette.secondary.main }} />
                ) : (
                  <LightModeIcon sx={{ mr: 2, color: theme.palette.secondary.main }} />
                )}
                <Typography variant="h5" fontWeight="600" color="text.primary">
                  Theme Settings
                </Typography>
              </Box>
              <Box sx={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', mb: 2 }}>
                <Typography variant="body1" color="text.primary">
                  Dark Mode
                </Typography>
                <Switch
                  checked={isDarkMode}
                  onChange={toggleTheme}
                  color="secondary"
                />
              </Box>
              <Typography variant="body2" color="text.secondary">
                {isDarkMode ? 'Switch to light mode for a brighter interface' : 'Switch to dark mode for reduced eye strain'}
              </Typography>
            </CardContent>
          </Card>
        </Grid>

        {isAdmin && (
          <Grid item xs={12}>
            <Card sx={{ mt: 1 }}>
              <CardContent>
                <Typography variant="h6" gutterBottom>Storage Cleanup</Typography>
                <Typography variant="body2" color="text.secondary" sx={{ mb: 2 }}>
                  Automatically clean old logs, export files, and backups. Runs daily at 03:30 UTC.
                </Typography>
                <Grid container spacing={2}>
                  <Grid item xs={12}>
                    <Typography variant="subtitle2" fontWeight="600">Logs</Typography>
                  </Grid>
                  <Grid item xs={12} sm={4}>
                    <FormControlLabel
                      control={(
                        <Switch
                          checked={storageConfig.logs?.enabled ?? true}
                          onChange={(e) => setStorageConfig((prev) => ({
                            ...prev,
                            logs: { ...prev.logs, enabled: e.target.checked }
                          }))}
                        />
                      )}
                      label="Enable log cleanup"
                    />
                  </Grid>
                  <Grid item xs={12} sm={4}>
                    <TextField
                      label="Max total log size (MB)"
                      type="number"
                      fullWidth
                      value={storageConfig.logs?.maxTotalSizeMB ?? 500}
                      onChange={(e) => setStorageConfig((prev) => ({
                        ...prev,
                        logs: { ...prev.logs, maxTotalSizeMB: Number(e.target.value) }
                      }))}
                      inputProps={{ min: 50, max: 10000 }}
                    />
                  </Grid>
                  <Grid item xs={12} sm={4}>
                    <TextField
                      label="Max log files per folder"
                      type="number"
                      fullWidth
                      value={storageConfig.logs?.maxFilesPerDirectory ?? 5}
                      onChange={(e) => setStorageConfig((prev) => ({
                        ...prev,
                        logs: { ...prev.logs, maxFilesPerDirectory: Number(e.target.value) }
                      }))}
                      inputProps={{ min: 1, max: 50 }}
                    />
                  </Grid>
                  <Grid item xs={12}>
                    <Typography variant="caption" color="text.secondary" display="block">
                      Last log cleanup: {storageConfig.logs?.lastCleanupAt
                        ? new Date(storageConfig.logs.lastCleanupAt).toLocaleString()
                        : 'Never'}
                      {storageConfig.logs?.lastCleanupDeleted
                        ? ` (${storageConfig.logs.lastCleanupDeleted} files, ${storageConfig.logs.lastCleanupFreedMB || 0} MB freed)`
                        : ''}
                    </Typography>
                  </Grid>

                  <Grid item xs={12}>
                    <Typography variant="subtitle2" fontWeight="600">Exports</Typography>
                  </Grid>
                  <Grid item xs={12} sm={6}>
                    <FormControlLabel
                      control={(
                        <Switch
                          checked={storageConfig.exports?.enabled ?? true}
                          onChange={(e) => setStorageConfig((prev) => ({
                            ...prev,
                            exports: { ...prev.exports, enabled: e.target.checked }
                          }))}
                        />
                      )}
                      label="Enable export cleanup"
                    />
                  </Grid>
                  <Grid item xs={12} sm={6}>
                    <TextField
                      label="Export retention (days)"
                      type="number"
                      fullWidth
                      value={storageConfig.exports?.retentionDays ?? 30}
                      onChange={(e) => setStorageConfig((prev) => ({
                        ...prev,
                        exports: { ...prev.exports, retentionDays: Number(e.target.value) }
                      }))}
                      inputProps={{ min: 1, max: 365 }}
                    />
                  </Grid>

                  <Grid item xs={12}>
                    <Typography variant="subtitle2" fontWeight="600">Backups</Typography>
                  </Grid>
                  <Grid item xs={12} sm={4}>
                    <FormControlLabel
                      control={(
                        <Switch
                          checked={storageConfig.backups?.enabled ?? true}
                          onChange={(e) => setStorageConfig((prev) => ({
                            ...prev,
                            backups: { ...prev.backups, enabled: e.target.checked }
                          }))}
                        />
                      )}
                      label="Enable backup cleanup"
                    />
                  </Grid>
                  <Grid item xs={12} sm={4}>
                    <TextField
                      label="Backup retention (days)"
                      type="number"
                      fullWidth
                      value={storageConfig.backups?.retentionDays ?? 7}
                      onChange={(e) => setStorageConfig((prev) => ({
                        ...prev,
                        backups: { ...prev.backups, retentionDays: Number(e.target.value) }
                      }))}
                      inputProps={{ min: 1, max: 365 }}
                    />
                  </Grid>
                  <Grid item xs={12} sm={4}>
                    <TextField
                      label="Max backup files"
                      type="number"
                      fullWidth
                      value={storageConfig.backups?.maxCount ?? 20}
                      onChange={(e) => setStorageConfig((prev) => ({
                        ...prev,
                        backups: { ...prev.backups, maxCount: Number(e.target.value) }
                      }))}
                      inputProps={{ min: 1, max: 200 }}
                    />
                  </Grid>

                  <Grid item xs={12}>
                    <Box sx={{ display: 'flex', gap: 1, flexWrap: 'wrap' }}>
                      <Button
                        variant="contained"
                        startIcon={<SaveIcon />}
                        onClick={handleSaveStorage}
                        disabled={isLoadingStorage}
                      >
                        Save Storage Settings
                      </Button>
                      <Button
                        variant="outlined"
                        color="warning"
                        startIcon={<WarningIcon />}
                        onClick={() => handleRunStorageCleanup()}
                        disabled={isRunningCleanup}
                      >
                        {isRunningCleanup ? 'Cleaning...' : 'Run Cleanup Now'}
                      </Button>
                    </Box>
                  </Grid>
                </Grid>
              </CardContent>
            </Card>
          </Grid>
        )}

        {isAdmin && (
          <Grid item xs={12} md={6}>
            <Card sx={{ mt: 4 }}>
              <CardContent>
                <Typography variant="h6" gutterBottom>Record Retention</Typography>
                <Typography variant="body2" color="text.secondary" sx={{ mb: 2 }}>
                  Automatically delete records older than the configured number of days. Runs daily at 03:00 UTC.
                </Typography>
                <Grid container spacing={2} alignItems="center">
                  <Grid item xs={12} sm={6}>
                    <FormControlLabel
                      control={(
                        <Switch
                          checked={retentionConfig.enabled}
                          onChange={(e) => setRetentionConfig((prev) => ({ ...prev, enabled: e.target.checked }))}
                          color="primary"
                        />
                      )}
                      label="Enable automatic retention"
                    />
                  </Grid>
                  <Grid item xs={12} sm={6}>
                    <TextField
                      label="Retention days"
                      type="number"
                      fullWidth
                      value={retentionConfig.retentionDays}
                      onChange={(e) => setRetentionConfig((prev) => ({
                        ...prev,
                        retentionDays: Number(e.target.value)
                      }))}
                      inputProps={{ min: 30, max: 3650 }}
                    />
                  </Grid>
                  <Grid item xs={12}>
                    <Typography variant="body2" color="text.secondary">
                      Last purge: {retentionConfig.lastPurgeAt
                        ? new Date(retentionConfig.lastPurgeAt).toLocaleString()
                        : 'Never'}
                      {retentionConfig.lastPurgeDeleted
                        ? ` (${retentionConfig.lastPurgeDeleted} records removed)`
                        : ''}
                    </Typography>
                  </Grid>
                  <Grid item xs={12}>
                    <Box sx={{ display: 'flex', gap: 1, flexWrap: 'wrap' }}>
                      <Button
                        variant="contained"
                        startIcon={<SaveIcon />}
                        onClick={handleSaveRetention}
                        disabled={isLoadingRetention}
                      >
                        Save Retention Settings
                      </Button>
                      <Button
                        variant="outlined"
                        color="warning"
                        startIcon={<WarningIcon />}
                        onClick={handleRunRetentionPurge}
                        disabled={isPurgingRetention || !retentionConfig.enabled}
                      >
                        {isPurgingRetention ? 'Purging...' : 'Run Purge Now'}
                      </Button>
                    </Box>
                  </Grid>
                </Grid>
              </CardContent>
            </Card>
          </Grid>
        )}

        <Grid item xs={12} md={6}>
          <Card sx={{ mt: 4 }}>
            <CardContent>
              <Typography variant="h6" gutterBottom>Data Forwarder Configuration</Typography>
              <Grid container spacing={2} alignItems="center">
                <Grid item xs={12} sm={6} md={4}>
                  <FormControlLabel
                    control={<Switch checked={forwarderConfig.enabled} onChange={handleForwarderChange} name="enabled" color="primary" />}
                    label="Enable Data Forwarder"
                  />
                </Grid>
                <Grid item xs={12} sm={6} md={4}>
                  <FormControlLabel
                    control={<Switch checked={forwarderConfig.autoForwardEnabled || false} onChange={e => setForwarderConfig(cfg => ({ ...cfg, autoForwardEnabled: e.target.checked }))} name="autoForwardEnabled" color="primary" />}
                    label="Automatic Forwarding"
                  />
                </Grid>
                <Grid item xs={12} sm={6} md={4}>
                  <TextField
                    label="Forward Interval (minutes)"
                    name="autoForwardIntervalMinutes"
                    type="number"
                    value={forwarderConfig.autoForwardIntervalMinutes || 5}
                    onChange={e => setForwarderConfig(cfg => ({ ...cfg, autoForwardIntervalMinutes: Number(e.target.value) }))}
                    fullWidth
                    disabled={!forwarderConfig.autoForwardEnabled}
                    inputProps={{ min: 1 }}
                  />
                </Grid>
                <Grid item xs={12} sm={12} md={4}>
                  <TextField
                    label="Device IMEIs to Forward"
                    name="forwardDeviceImeis"
                    select
                    SelectProps={{ multiple: true }}
                    value={forwarderConfig.forwardDeviceImeis || []}
                    onChange={e => setForwarderConfig(cfg => ({ ...cfg, forwardDeviceImeis: e.target.value }))}
                    fullWidth
                    disabled={!forwarderConfig.autoForwardEnabled}
                  >
                    {deviceOptions.map(opt => (
                      <MenuItem key={opt.value} value={opt.value}>{opt.label}</MenuItem>
                    ))}
                  </TextField>
                </Grid>
                <Grid item xs={12} sm={6} md={8}>
                  <TextField
                    label="Target URL"
                    name="targetUrl"
                    value={forwarderConfig.targetUrl}
                    onChange={handleForwarderChange}
                    fullWidth
                    disabled={!forwarderConfig.enabled}
                  />
                </Grid>
                <Grid item xs={12}>
                  <Button
                    variant="contained"
                    color="primary"
                    startIcon={<SaveIcon />}
                    onClick={handleSaveForwarder}
                    disabled={isLoadingForwarder}
                  >
                    Save Data Forwarder Settings
                  </Button>
                </Grid>
              </Grid>
            </CardContent>
          </Card>
        </Grid>

        <Grid item xs={12} md={6}>
          <Card sx={{ mt: 2 }}>
            <CardContent>
              <Typography variant="h6" gutterBottom>Data Forwarder Logs</Typography>
              <Button variant="outlined" onClick={handleLoadForwarderLogs} disabled={isLoadingLogs} sx={{ mb: 2 }}>
                {isLoadingLogs ? 'Loading...' : 'Load Logs'}
              </Button>
              <Box sx={{ maxHeight: 300, overflow: 'auto', background: '#222', color: '#fff', p: 2, borderRadius: 2 }}>
                {forwarderLogs.length === 0 ? (
                  <Typography variant="body2" color="textSecondary">No logs loaded.</Typography>
                ) : (
                  <pre style={{ margin: 0, fontSize: 12 }}>{forwarderLogs.join('\n')}</pre>
                )}
              </Box>
            </CardContent>
          </Card>
        </Grid>
      </Grid>

      {/* Dialogs */}
      <Dialog open={backupDialogOpen} onClose={() => setBackupDialogOpen(false)} maxWidth="sm" fullWidth>
        <DialogTitle>Create Backup</DialogTitle>
        <DialogContent>
          <TextField
            fullWidth
            label="Backup Name"
            value={backupName}
            onChange={(e) => setBackupName(e.target.value)}
            margin="normal"
            variant="outlined"
            placeholder="Enter backup name or leave empty for auto-generated name"
          />
        </DialogContent>
        <DialogActions>
          <Button onClick={() => setBackupDialogOpen(false)}>Cancel</Button>
          <Button onClick={handleCreateBackup} variant="contained" color="primary">
            Create Backup
          </Button>
        </DialogActions>
      </Dialog>

      <Dialog open={importDialogOpen} onClose={() => setImportDialogOpen(false)} maxWidth="sm" fullWidth>
        <DialogTitle>Import Settings</DialogTitle>
        <DialogContent>
          <input
            type="file"
            accept=".json"
            onChange={(e) => setSelectedFile(e.target.files[0])}
            style={{ marginTop: 16 }}
          />
        </DialogContent>
        <DialogActions>
          <Button onClick={() => setImportDialogOpen(false)}>Cancel</Button>
          <Button onClick={handleImportSettings} variant="contained" color="primary" disabled={!selectedFile}>
            Import Settings
          </Button>
        </DialogActions>
      </Dialog>

      <Snackbar
        open={snackbar.open}
        autoHideDuration={6000}
        onClose={handleCloseSnackbar}
        anchorOrigin={{ vertical: 'top', horizontal: 'right' }}
      >
        <Alert onClose={handleCloseSnackbar} severity={snackbar.severity} sx={{ width: '100%' }}>
          {snackbar.message}
        </Alert>
      </Snackbar>
    </Container>
  );
};

export default Settings;
