import React, { useState, useEffect } from 'react';
import {
  Container,
  Paper,
  Typography,
  Table,
  TableBody,
  TableCell,
  TableContainer,
  TableHead,
  TableRow,
  Button,
  Box,
  FormControl,
  InputLabel,
  Select,
  MenuItem,
  TextField,
  Grid,
  Chip,
  Switch,
  FormControlLabel,
  Alert,
  CircularProgress,
  IconButton,
  List,
  ListItem,
  ListItemText,
  ListItemSecondaryAction
} from '@mui/material';
import FileDownloadIcon from '@mui/icons-material/FileDownload';
import RefreshIcon from '@mui/icons-material/Refresh';
import ScheduleIcon from '@mui/icons-material/Schedule';
import AddIcon from '@mui/icons-material/Add';
import DeleteIcon from '@mui/icons-material/Delete';
import axios from 'axios';
import { useSnackbar } from 'notistack';
import { BASE_URL } from '../services/api';
import DeviceSearchSelect from '../components/DeviceSearchSelect';

const DataSM = () => {
  const { enqueueSnackbar } = useSnackbar();
  const [records, setRecords] = useState([]);
  const [loading, setLoading] = useState(false);
  const [startDate, setStartDate] = useState(new Date(Date.now() - 24 * 60 * 60 * 1000).toISOString().split('T')[0]);
  const [endDate, setEndDate] = useState(new Date().toISOString().split('T')[0]);
  const [startHour, setStartHour] = useState('00');
  const [endHour, setEndHour] = useState('23');
  const [availableDevices, setAvailableDevices] = useState([]);
  const [selectedDevices, setSelectedDevices] = useState([]);
  const [autoExportEnabled, setAutoExportEnabled] = useState(false);
  const [autoExportTimes, setAutoExportTimes] = useState(['00:00']); // Array of times
  const [newExportTime, setNewExportTime] = useState('00:00'); // For adding new time
  const [hoursBack, setHoursBack] = useState(24); // Time range: 1-168 hours (7 days)
  const [exporting, setExporting] = useState(false);

  // Field mapping for Data SM
  const fieldMapping = {
    deviceImei: 'IMEI',
    datetime: 'Timestamp',
    latitude: 'Lat',
    longitude: 'Lon',
    altitude: 'Alt',
    satellites: 'Satellite',
    speed: 'Speed',
    userData0: 'Sensor Kiri',
    userData1: 'Sensor Kanan',
    modbus0: 'Sensor Serial (Ultrasonic)',
    userData2: 'Uptime Seconds'
  };

  const fetchData = async () => {
    setLoading(true);
    try {
      const params = {
        startDate: new Date(`${startDate}T${startHour}:00:00`).toISOString(),
        endDate: new Date(`${endDate}T${endHour}:59:59`).toISOString(),
        merge: '1',
        limit: 500,
      };
      
      if (selectedDevices.length > 0) {
        params.imeis = selectedDevices.join(',');
      }
      
      const response = await axios.get(`${BASE_URL}/api/records`, { 
        params,
        withCredentials: true
      });
      setRecords(response.data);
      enqueueSnackbar(`Loaded ${response.data.length} records`, { variant: 'success' });
    } catch (error) {
      console.error('Error fetching data:', error);
      enqueueSnackbar('Failed to load preview data', { variant: 'error' });
    }
    setLoading(false);
  };

  const fetchAvailableDevices = async () => {
    console.log('🔄 fetchAvailableDevices called');
    try {
      const response = await axios.get(`${BASE_URL}/api/devices`, {
        withCredentials: true
      });
      setAvailableDevices(response.data);
      console.log('✅ fetchAvailableDevices completed:', response.data.length, 'devices');
    } catch (error) {
      console.error('Error fetching devices:', error);
      setAvailableDevices([]);
      enqueueSnackbar('Failed to load devices', { variant: 'error' });
    }
  };

  const fetchAutoExportStatus = async () => {
    console.log('🔄 fetchAutoExportStatus called - BASE_URL:', BASE_URL);
    try {
      const url = `${BASE_URL}/api/auto-export/status`;
      console.log('🌐 Making request to:', url);
      
      const response = await axios.get(url, {
        withCredentials: true,
        timeout: 10000 // 10 second timeout
      });
      
      console.log('✅ Auto-export status response:', response.data);
      console.log('📊 Response status:', response.status);
      console.log('📋 Response headers:', response.headers);
      
      // Find the Data SM auto-export configuration
      const dataSMConfig = response.data.find(config => config.type === 'data-sm');
      
      console.log('🔍 Data SM config found:', dataSMConfig);
      
      if (dataSMConfig && dataSMConfig.enabled) {
        console.log('✅ Setting auto-export enabled:', dataSMConfig.enabled);
        setAutoExportEnabled(true);
        // Support both old format (single time) and new format (multiple times)
        if (dataSMConfig.times && dataSMConfig.times.length > 0) {
          setAutoExportTimes(dataSMConfig.times);
        } else if (dataSMConfig.time) {
          setAutoExportTimes([dataSMConfig.time]);
        }
        // Set time range (hours back)
        if (dataSMConfig.hoursBack) {
          setHoursBack(dataSMConfig.hoursBack);
        }
        setSelectedDevices(dataSMConfig.devices || []);
      } else {
        console.log('ℹ️ No enabled Data SM config found, resetting to defaults');
        setAutoExportEnabled(false);
        setAutoExportTimes(['00:00']);
        setHoursBack(24);
        setSelectedDevices([]);
      }
    } catch (error) {
      console.error('Error fetching auto export status:', error);
      enqueueSnackbar('Failed to load auto-export settings', { variant: 'warning' });
      setAutoExportEnabled(false);
      setAutoExportTimes(['00:00']);
      setSelectedDevices([]);
    }
  };

  useEffect(() => {
    const initializeData = async () => {
      try {
        await Promise.all([
          fetchAvailableDevices(),
          fetchAutoExportStatus()
        ]);
      } catch (error) {
        console.error('❌ Error during data initialization:', error);
      }
    };
    
    initializeData();
  }, []);

  const handleExport = async () => {
    setExporting(true);
    try {
      const params = {
        startDate: new Date(`${startDate}T${startHour}:00:00`).toISOString(),
        endDate: new Date(`${endDate}T${endHour}:59:59`).toISOString(),
        format: 'csv',
        fields: Object.keys(fieldMapping),
        imeis: selectedDevices.length > 0 ? selectedDevices : undefined,
        customHeaders: fieldMapping,
        fileExtension: 'pfsl'
      };

      const response = await axios.post(
        `${BASE_URL}/api/records/export-sm`,
        params,
        {
          responseType: 'blob',
          withCredentials: true
        }
      );

      const contentDisposition = response.headers['content-disposition'];
      let filename = 'export.pfsl';
      if (contentDisposition) {
        const filenameMatch = contentDisposition.match(/filename="(.+)"/);
        if (filenameMatch) {
          filename = filenameMatch[1];
        }
      }

      const url = window.URL.createObjectURL(new Blob([response.data]));
      const link = document.createElement('a');
      link.href = url;
      link.setAttribute('download', filename);
      document.body.appendChild(link);
      link.click();
      link.remove();
      enqueueSnackbar('Export downloaded successfully', { variant: 'success' });
    } catch (error) {
      console.error('Error exporting data:', error);
      enqueueSnackbar('Export failed. Try a smaller date range.', { variant: 'error' });
    }
    setExporting(false);
  };

  const handleAutoExportToggle = async () => {
    console.log('🔄 handleAutoExportToggle called, current state:', autoExportEnabled);
    try {
      const newState = !autoExportEnabled;
      console.log('🔄 Sending auto-export request:', {
        enabled: newState,
        times: autoExportTimes,
        hoursBack: hoursBack,
        devices: selectedDevices,
        fields: Object.keys(fieldMapping),
        customHeaders: fieldMapping
      });
      
      const response = await axios.post(`${BASE_URL}/api/auto-export/sm`, {
        enabled: newState,
        times: autoExportTimes,
        hoursBack: hoursBack,
        devices: selectedDevices,
        fields: Object.keys(fieldMapping),
        customHeaders: fieldMapping
      }, {
        withCredentials: true
      });
      
      console.log('✅ Auto-export toggle response:', response.data);
      setAutoExportEnabled(newState);
      
      // Refresh the status after toggling
      setTimeout(() => {
        fetchAutoExportStatus();
      }, 500);
      enqueueSnackbar(newState ? 'Auto-export enabled' : 'Auto-export disabled', { variant: 'success' });
    } catch (error) {
      console.error('Error toggling auto export:', error);
      enqueueSnackbar('Failed to update auto-export settings', { variant: 'error' });
    }
  };

  const handleAddExportTime = () => {
    if (newExportTime && !autoExportTimes.includes(newExportTime)) {
      const updatedTimes = [...autoExportTimes, newExportTime].sort();
      setAutoExportTimes(updatedTimes);
      setNewExportTime('00:00');
      
      // If auto-export is enabled, update backend immediately
      if (autoExportEnabled) {
        updateAutoExportConfig(updatedTimes, hoursBack);
      }
    }
  };

  const handleRemoveExportTime = (timeToRemove) => {
    if (autoExportTimes.length > 1) {
      const updatedTimes = autoExportTimes.filter(t => t !== timeToRemove);
      setAutoExportTimes(updatedTimes);
      
      // If auto-export is enabled, update backend immediately
      if (autoExportEnabled) {
        updateAutoExportConfig(updatedTimes, hoursBack);
      }
    }
  };

  const handleHoursBackChange = async (newHoursBack) => {
    setHoursBack(newHoursBack);
    
    // If auto-export is enabled, update backend immediately
    if (autoExportEnabled) {
      await updateAutoExportConfig(autoExportTimes, newHoursBack);
    }
  };

  const updateAutoExportConfig = async (times, hoursBackValue) => {
    try {
      await axios.post(`${BASE_URL}/api/auto-export/sm`, {
        enabled: true,
        times: times,
        hoursBack: hoursBackValue,
        devices: selectedDevices,
        fields: Object.keys(fieldMapping),
        customHeaders: fieldMapping
      }, {
        withCredentials: true
      });
      enqueueSnackbar('Auto-export schedule updated', { variant: 'success' });
    } catch (error) {
      console.error('Error updating auto-export config:', error);
      enqueueSnackbar('Failed to update auto-export schedule', { variant: 'error' });
    }
  };

  // Match backend Data SM export: Asia/Jakarta YYYY-MM-DD HH:mm:ss
  const formatDateTimeYmdHms = (value) => {
    if (value == null || value === '') return '';
    const date = new Date(value);
    if (Number.isNaN(date.getTime())) return '';
    const parts = new Intl.DateTimeFormat('en-GB', {
      timeZone: 'Asia/Jakarta',
      year: 'numeric',
      month: '2-digit',
      day: '2-digit',
      hour: '2-digit',
      minute: '2-digit',
      second: '2-digit',
      hour12: false
    }).formatToParts(date);
    const get = (type) => parts.find((part) => part.type === type)?.value || '';
    return `${get('year')}-${get('month')}-${get('day')} ${get('hour')}:${get('minute')}:${get('second')}`;
  };

  const cellValue = (value) => (value === null || value === undefined ? '' : value);

  const hasMeaningfulData = (record) => {
    const hasGPS = record.latitude != null && record.longitude != null;
    const hasAltitude = record.altitude != null;
    const hasSatellites = record.satellites != null;
    const hasSpeed = record.speed != null;
    const hasSensorData =
      record.userData0 != null ||
      record.userData1 != null ||
      record.userData2 != null ||
      record.modbus0 != null;
    return hasGPS || hasAltitude || hasSatellites || hasSpeed || hasSensorData;
  };

  const formatDataForDisplay = (records) => {
    // Same filter as /api/records/export-sm — drop IMEI-only / empty shell rows
    return records.filter(hasMeaningfulData).map((record) => {
      const device = availableDevices.find((d) => d.imei === record.deviceImei);
      return {
        deviceName: device ? device.name : record.deviceImei,
        deviceImei: record.deviceImei,
        datetime: formatDateTimeYmdHms(record.datetime),
        latitude: cellValue(record.latitude),
        longitude: cellValue(record.longitude),
        speed: cellValue(record.speed),
        altitude: cellValue(record.altitude),
        satellites: cellValue(record.satellites),
        userData0: cellValue(record.userData0),
        userData1: cellValue(record.userData1),
        modbus0: cellValue(record.modbus0),
        userData2: cellValue(record.userData2)
      };
    });
  };

  const previewRecords = formatDataForDisplay(records).slice(0, 100);

  return (
    <Container maxWidth="xl" sx={{ py: 4 }}>
      <Paper sx={{ p: 3 }}>
        <Typography variant="h4" gutterBottom>
          Data SM
        </Typography>
        <Typography variant="subtitle1" color="text.secondary" gutterBottom>
          Sensor monitoring data export
        </Typography>

        <Box sx={{ mt: 3 }}>
          <Typography variant="h6" gutterBottom>
            Export Configuration
          </Typography>
          
          <Grid container spacing={2} sx={{ mt: 2 }}>
            <Grid item xs={12} md={3}>
              <TextField
                fullWidth
                label="Start Date"
                type="date"
                value={startDate}
                onChange={(e) => setStartDate(e.target.value)}
                InputLabelProps={{ shrink: true }}
              />
            </Grid>
            <Grid item xs={12} md={3}>
              <TextField
                fullWidth
                label="End Date"
                type="date"
                value={endDate}
                onChange={(e) => setEndDate(e.target.value)}
                InputLabelProps={{ shrink: true }}
              />
            </Grid>
            <Grid item xs={12} md={3}>
              <FormControl fullWidth>
                <InputLabel>Start Hour</InputLabel>
                <Select
                  value={startHour}
                  onChange={(e) => setStartHour(e.target.value)}
                >
                  {Array.from({length: 24}, (_, i) => (
                    <MenuItem key={i} value={String(i).padStart(2, '0')}>
                      {String(i).padStart(2, '0')}:00
                    </MenuItem>
                  ))}
                </Select>
              </FormControl>
            </Grid>
            <Grid item xs={12} md={3}>
              <FormControl fullWidth>
                <InputLabel>End Hour</InputLabel>
                <Select
                  value={endHour}
                  onChange={(e) => setEndHour(e.target.value)}
                >
                  {Array.from({length: 24}, (_, i) => (
                    <MenuItem key={i} value={String(i).padStart(2, '0')}>
                      {String(i).padStart(2, '0')}:59
                    </MenuItem>
                  ))}
                </Select>
              </FormControl>
            </Grid>
          </Grid>

          <Grid container spacing={2} sx={{ mt: 2 }}>
            <Grid item xs={12}>
              <DeviceSearchSelect
                multiple
                valueKey="imei"
                label="Select Devices"
                devices={availableDevices}
                value={selectedDevices}
                onChange={setSelectedDevices}
                helperText={selectedDevices.length === 0 ? 'Leave empty to include all devices' : undefined}
              />
            </Grid>
          </Grid>

          {/* Auto Export Configuration */}
          <Box sx={{ mt: 3, p: 2, bgcolor: 'grey.50', borderRadius: 1 }}>
            <Typography variant="h6" gutterBottom>
              Auto Export Configuration
            </Typography>
            <Grid container spacing={2} alignItems="center">
              <Grid item xs={12} md={4}>
                <FormControlLabel
                  control={
                    <Switch
                      checked={autoExportEnabled}
                      onChange={handleAutoExportToggle}
                    />
                  }
                  label={`Auto Export ${autoExportEnabled ? 'Enabled' : 'Disabled'}`}
                />
              </Grid>
              <Grid item xs={12} md={4}>
                <TextField
                  fullWidth
                  label="Time Range (Hours Back)"
                  type="number"
                  value={hoursBack}
                  onChange={(e) => {
                    const value = parseInt(e.target.value, 10);
                    if (value >= 1 && value <= 168) {
                      handleHoursBackChange(value);
                    }
                  }}
                  disabled={!autoExportEnabled}
                  inputProps={{ min: 1, max: 168 }}
                  helperText="Export data from X hours ago to now (1-168 hours = 7 days)"
                  InputLabelProps={{ shrink: true }}
                />
              </Grid>
              <Grid item xs={12} md={4}>
                <Button
                  variant="outlined"
                  size="small"
                  onClick={fetchAutoExportStatus}
                >
                  Refresh Status
                </Button>
              </Grid>
            </Grid>

            {/* Multiple Export Times */}
            <Box sx={{ mt: 3 }}>
              <Typography variant="subtitle2" gutterBottom>
                Export Times (UTC) - Multiple schedules per day
              </Typography>
              <List dense>
                {autoExportTimes.map((time, index) => (
                  <ListItem key={index}>
                    <ListItemText primary={time} />
                    <ListItemSecondaryAction>
                      {autoExportTimes.length > 1 && (
                        <IconButton
                          edge="end"
                          aria-label="delete"
                          onClick={() => handleRemoveExportTime(time)}
                          disabled={!autoExportEnabled}
                        >
                          <DeleteIcon />
                        </IconButton>
                      )}
                    </ListItemSecondaryAction>
                  </ListItem>
                ))}
              </List>
              
              {autoExportEnabled && (
                <Box sx={{ mt: 2, display: 'flex', gap: 2, alignItems: 'center' }}>
                  <TextField
                    label="Add Export Time (UTC)"
                    type="time"
                    value={newExportTime}
                    onChange={(e) => setNewExportTime(e.target.value)}
                    size="small"
                    InputLabelProps={{ shrink: true }}
                  />
                  <Button
                    variant="outlined"
                    size="small"
                    startIcon={<AddIcon />}
                    onClick={handleAddExportTime}
                    disabled={autoExportTimes.includes(newExportTime)}
                  >
                    Add Time
                  </Button>
                </Box>
              )}
            </Box>
          </Box>

          {/* Action Buttons */}
          <Box sx={{ mt: 3, display: 'flex', gap: 2 }}>
            <Button
              variant="contained"
              startIcon={<FileDownloadIcon />}
              onClick={handleExport}
              disabled={exporting}
            >
              {exporting ? <CircularProgress size={20} /> : 'Export Data SM'}
            </Button>
            <Button
              variant="outlined"
              startIcon={<RefreshIcon />}
              onClick={fetchData}
              disabled={loading}
            >
              Refresh Data
            </Button>
          </Box>

          {/* Data Preview */}
          {previewRecords.length > 0 && (
            <Box sx={{ mt: 3 }}>
              <Typography variant="h6" gutterBottom>
                Data Preview ({previewRecords.length} records shown)
              </Typography>
              <Typography variant="body2" color="text.secondary" gutterBottom>
                {startDate} {startHour}:00 - {endDate} {endHour}:59 (timestamps Asia/Jakarta)
              </Typography>
              <TableContainer component={Paper} sx={{ mt: 2 }}>
                <Table size="small">
                  <TableHead>
                    <TableRow>
                      <TableCell>IMEI</TableCell>
                      <TableCell>Timestamp</TableCell>
                      <TableCell>Lat</TableCell>
                      <TableCell>Lon</TableCell>
                      <TableCell>Alt</TableCell>
                      <TableCell>Satellite</TableCell>
                      <TableCell>Speed</TableCell>
                      <TableCell>Sensor Kiri</TableCell>
                      <TableCell>Sensor Kanan</TableCell>
                      <TableCell>Sensor Serial</TableCell>
                    </TableRow>
                  </TableHead>
                  <TableBody>
                    {previewRecords.map((record, index) => (
                      <TableRow key={index}>
                        <TableCell>{record.deviceImei}</TableCell>
                        <TableCell>{record.datetime}</TableCell>
                        <TableCell>{record.latitude}</TableCell>
                        <TableCell>{record.longitude}</TableCell>
                        <TableCell>{record.altitude}</TableCell>
                        <TableCell>{record.satellites}</TableCell>
                        <TableCell>{record.speed}</TableCell>
                        <TableCell>{record.userData0}</TableCell>
                        <TableCell>{record.userData1}</TableCell>
                        <TableCell>{record.modbus0}</TableCell>
                      </TableRow>
                    ))}
                  </TableBody>
                </Table>
              </TableContainer>
            </Box>
          )}
        </Box>
      </Paper>
    </Container>
  );
};

export default DataSM;