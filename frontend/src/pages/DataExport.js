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
  Checkbox,
  FormControlLabel,
  Tabs,
  Tab,
  Chip,
  OutlinedInput,
} from '@mui/material';
import FileDownloadIcon from '@mui/icons-material/FileDownload';
import RefreshIcon from '@mui/icons-material/Refresh';
import axios from 'axios';
import { useSnackbar } from 'notistack';
import { BASE_URL, startAsyncExport, fetchExportJobStatus, getExportJobDownloadUrl, fetchDevices } from '../services/api';

const PREVIEW_PAGE_SIZE = 100;

const DataExport = () => {
  const { enqueueSnackbar } = useSnackbar();
  const [records, setRecords] = useState([]);
  const [loading, setLoading] = useState(false);
  const [previewPage, setPreviewPage] = useState(0);
  const [hasMore, setHasMore] = useState(false);
  const [startDate, setStartDate] = useState(new Date(Date.now() - 7 * 24 * 60 * 60 * 1000).toISOString().split('T')[0]);
  const [endDate, setEndDate] = useState(new Date().toISOString().split('T')[0]);
  const [selectedFields, setSelectedFields] = useState({
    timestamp: true,
    datetime: true, // Add datetime field
    deviceImei: true,
    recordNumber: true,
    latitude: true,
    longitude: true,
    speed: true,
    direction: true,
    altitude: true, // Add altitude field
    course: true, // Add course field
    satellites: true, // Add satellites field
    hdop: true, // Add hdop field
    status: true,
    supplyVoltage: true,
    batteryVoltage: true,
    input0: true,
    input1: true,
    input2: true,
    input3: true,
    inputVoltage0: true,
    inputVoltage1: true,
    inputVoltage2: true,
    inputVoltage3: true,
    inputVoltage4: true,
    inputVoltage5: true,
    inputVoltage6: true,
    userData0: true,
    userData1: true,
    userData2: true,
    userData3: true,
    userData4: true,
    userData5: true,
    userData6: true,
    userData7: true,
    modbus0: true,
    modbus1: true,
    modbus2: true,
    modbus3: true,
    modbus4: true,
    modbus5: true,
    modbus6: true,
    modbus7: true,
    modbus8: true,
    modbus9: true,
    modbus10: true,
    modbus11: true,
    modbus12: true,
    modbus13: true,
    modbus14: true,
    modbus15: true
  });
  const [exportFormat, setExportFormat] = useState('csv');
  const [activeTab, setActiveTab] = useState(0);
  const [availableDevices, setAvailableDevices] = useState([]);
  const [selectedImeis, setSelectedImeis] = useState([]);
  const [devicesLoading, setDevicesLoading] = useState(false);
  const [backgroundExporting, setBackgroundExporting] = useState(false);
  const [exportJobStatus, setExportJobStatus] = useState(null);

  const fieldGroups = {
    'Basic Information': ['timestamp', 'datetime', 'deviceImei', 'recordNumber', 'latitude', 'longitude', 'speed', 'direction', 'altitude', 'course', 'satellites', 'hdop', 'status'],
    'Power Information': ['supplyVoltage', 'batteryVoltage'],
    'Input States': ['input0', 'input1', 'input2', 'input3'],
    'Input Voltages': ['inputVoltage0', 'inputVoltage1', 'inputVoltage2', 'inputVoltage3', 'inputVoltage4', 'inputVoltage5', 'inputVoltage6'],
    'User Data': ['userData0', 'userData1', 'userData2', 'userData3', 'userData4', 'userData5', 'userData6', 'userData7'],
    'Modbus Data': ['modbus0', 'modbus1', 'modbus2', 'modbus3', 'modbus4', 'modbus5', 'modbus6', 'modbus7', 'modbus8', 'modbus9', 'modbus10', 'modbus11', 'modbus12', 'modbus13', 'modbus14', 'modbus15']
  };

  const toStartOfDayIso = (dateStr) => {
    const date = new Date(dateStr);
    date.setHours(0, 0, 0, 0);
    return date.toISOString();
  };

  const toEndOfDayIso = (dateStr) => {
    const date = new Date(dateStr);
    date.setHours(23, 59, 59, 999);
    return date.toISOString();
  };

  const fetchData = async (page = previewPage) => {
    setLoading(true);
    try {
      const params = {
        startDate: toStartOfDayIso(startDate),
        endDate: toEndOfDayIso(endDate),
        merge: '1',
        limit: PREVIEW_PAGE_SIZE,
        offset: page * PREVIEW_PAGE_SIZE,
        paginated: '1',
      };

      if (selectedImeis.length > 0) {
        params.imeis = selectedImeis.join(',');
      }

      const response = await axios.get(`${BASE_URL}/api/records`, {
        params,
        withCredentials: true
      });
      const payload = response.data;
      setRecords(payload.records || []);
      setHasMore(Boolean(payload.hasMore));
      setPreviewPage(page);
    } catch (error) {
      console.error('Error fetching data:', error);
      enqueueSnackbar('Failed to load preview data', { variant: 'error' });
    }
    setLoading(false);
  };

  const getDeviceLabel = (imei) => {
    const device = availableDevices.find((d) => d.imei === imei);
    return device?.name || imei;
  };

  const fetchAvailableDevices = async () => {
    setDevicesLoading(true);
    try {
      const response = await fetchDevices();
      if (!response.ok) {
        throw new Error('Failed to load devices');
      }
      const devices = await response.json();
      const sorted = (Array.isArray(devices) ? devices : [])
        .filter((device) => device?.imei)
        .sort((a, b) => (a.name || a.imei).localeCompare(b.name || b.imei, undefined, { sensitivity: 'base' }));
      setAvailableDevices(sorted);
    } catch (error) {
      console.error('Error fetching devices:', error);
      setAvailableDevices([]);
    } finally {
      setDevicesLoading(false);
    }
  };

  useEffect(() => {
    fetchAvailableDevices();
  }, []);

  const pollExportJob = async (jobId) => {
    const maxAttempts = 120;
    for (let attempt = 0; attempt < maxAttempts; attempt += 1) {
      const response = await fetchExportJobStatus(jobId);
      if (!response.ok) {
        throw new Error('Failed to check export job status');
      }
      const status = await response.json();
      setExportJobStatus(status);

      if (status.status === 'completed') {
        return status;
      }
      if (status.status === 'failed') {
        throw new Error(status.error || 'Background export failed');
      }

      await new Promise((resolve) => setTimeout(resolve, 2000));
    }
    throw new Error('Background export timed out');
  };

  const handleBackgroundExport = async () => {
    setBackgroundExporting(true);
    setExportJobStatus(null);
    try {
      const response = await startAsyncExport({
        startDate: toStartOfDayIso(startDate),
        endDate: toEndOfDayIso(endDate),
        format: exportFormat,
        fields: Object.entries(selectedFields)
          .filter(([_, selected]) => selected)
          .map(([field]) => field),
        imeis: selectedImeis.length > 0 ? selectedImeis : undefined,
      });

      if (!response.ok) {
        throw new Error('Failed to start background export');
      }

      const job = await response.json();
      enqueueSnackbar('Background export started', { variant: 'info' });
      const completedJob = await pollExportJob(job.id);

      const downloadResponse = await fetch(getExportJobDownloadUrl(job.id), {
        credentials: 'include'
      });

      if (!downloadResponse.ok) {
        throw new Error('Failed to download export file');
      }

      const blob = await downloadResponse.blob();
      const url = window.URL.createObjectURL(blob);
      const link = document.createElement('a');
      link.href = url;
      link.setAttribute('download', `data-export.${exportFormat === 'excel' ? 'xlsx' : exportFormat}`);
      document.body.appendChild(link);
      link.click();
      link.remove();

      if (completedJob.truncated) {
        enqueueSnackbar('Export capped at server maximum rows', { variant: 'warning' });
      } else {
        enqueueSnackbar(`Export ready (${completedJob.rowCount || 0} rows)`, { variant: 'success' });
      }
    } catch (error) {
      console.error('Background export error:', error);
      enqueueSnackbar(error.message || 'Background export failed', { variant: 'error' });
    } finally {
      setBackgroundExporting(false);
    }
  };

  const handleExport = async () => {
    try {
      const response = await axios.post(
        `${BASE_URL}/api/records/export`,
        {
          startDate: toStartOfDayIso(startDate),
          endDate: toEndOfDayIso(endDate),
          format: exportFormat,
          fields: Object.entries(selectedFields)
            .filter(([_, selected]) => selected)
            .map(([field]) => field),
          imeis: selectedImeis.length > 0 ? selectedImeis : undefined, // Include IMEI filtering
        },
        {
          responseType: 'blob',
          withCredentials: true,
        }
      );

      const url = window.URL.createObjectURL(new Blob([response.data]));
      const link = document.createElement('a');
      link.href = url;
      link.setAttribute('download', `data-export.${exportFormat}`);
      document.body.appendChild(link);
      link.click();
      link.remove();
    } catch (error) {
      console.error('Error exporting data:', error);
      enqueueSnackbar('Export failed. Try a smaller date range.', { variant: 'error' });
    }
  };

  const handleFieldToggle = (field) => {
    setSelectedFields((prev) => ({
      ...prev,
      [field]: !prev[field],
    }));
  };

  const handleTabChange = (event, newValue) => {
    setActiveTab(newValue);
  };

  const handleDeviceChange = (event) => {
    const value = event.target.value;
    setSelectedImeis(typeof value === 'string' ? value.split(',') : value);
  };

  return (
    <Container maxWidth="lg" sx={{ mt: 4, mb: 4 }}>
      <Paper sx={{ p: 3, mb: 3 }}>
        <Typography variant="h6" gutterBottom>
          Data Export
        </Typography>
        <Typography variant="body2" color="text.secondary" sx={{ mb: 2 }}>
          Export data using device datetime for accurate time filtering. The 'datetime' field contains the device's timestamp, 
          while 'timestamp' contains the server's reception time.
        </Typography>
        <Grid container spacing={3} alignItems="center">
          <Grid item xs={12} md={3}>
            <TextField
              fullWidth
              label="Start Date"
              type="date"
              value={startDate}
              onChange={(e) => setStartDate(e.target.value)}
              InputLabelProps={{
                shrink: true,
              }}
            />
          </Grid>
          <Grid item xs={12} md={3}>
            <TextField
              fullWidth
              label="End Date"
              type="date"
              value={endDate}
              onChange={(e) => setEndDate(e.target.value)}
              InputLabelProps={{
                shrink: true,
              }}
            />
          </Grid>
          <Grid item xs={12} md={2}>
            <FormControl fullWidth>
              <InputLabel>Export Format</InputLabel>
              <Select
                value={exportFormat}
                onChange={(e) => setExportFormat(e.target.value)}
                label="Export Format"
              >
                <MenuItem value="csv">CSV</MenuItem>
                <MenuItem value="json">JSON</MenuItem>
                <MenuItem value="excel">Excel</MenuItem>
              </Select>
            </FormControl>
          </Grid>
          <Grid item xs={12} md={4}>
            <FormControl fullWidth>
              <InputLabel>Select Device Names (Optional)</InputLabel>
              <Select
                multiple
                value={selectedImeis}
                onChange={handleDeviceChange}
                input={<OutlinedInput label="Select Device Names (Optional)" />}
                renderValue={(selected) => (
                  <Box sx={{ display: 'flex', flexWrap: 'wrap', gap: 0.5 }}>
                    {selected.map((imei) => (
                      <Chip key={imei} label={getDeviceLabel(imei)} size="small" />
                    ))}
                  </Box>
                )}
                disabled={devicesLoading}
              >
                {devicesLoading ? (
                  <MenuItem disabled>Loading devices...</MenuItem>
                ) : availableDevices.length === 0 ? (
                  <MenuItem disabled>No devices available</MenuItem>
                ) : (
                  availableDevices.map((device) => (
                    <MenuItem key={device.imei} value={device.imei}>
                      {device.name || device.imei}
                    </MenuItem>
                  ))
                )}
              </Select>
            </FormControl>
            {selectedImeis.length === 0 && (
              <Typography variant="caption" color="text.secondary" sx={{ mt: 1, display: 'block' }}>
                Leave empty to export data from all devices
              </Typography>
            )}
          </Grid>
          <Grid item xs={12} md={6}>
            <Button
              variant="contained"
              startIcon={<FileDownloadIcon />}
              onClick={handleExport}
              fullWidth
              disabled={backgroundExporting}
            >
              Quick Export
            </Button>
          </Grid>
          <Grid item xs={12} md={6}>
            <Button
              variant="outlined"
              startIcon={<FileDownloadIcon />}
              onClick={handleBackgroundExport}
              fullWidth
              disabled={backgroundExporting}
            >
              {backgroundExporting
                ? `Background Export${exportJobStatus ? ` (${exportJobStatus.progress || 0}%)` : '...'}`
                : 'Background Export (large ranges)'}
            </Button>
          </Grid>
        </Grid>
      </Paper>

      <Paper sx={{ p: 3, mb: 3 }}>
        <Typography variant="h6" gutterBottom>
          Select Fields to Export
        </Typography>
        <Tabs value={activeTab} onChange={handleTabChange} sx={{ mb: 2 }}>
          {Object.keys(fieldGroups).map((groupName, index) => (
            <Tab key={groupName} label={groupName} />
          ))}
        </Tabs>
        <Grid container spacing={2}>
          {Object.entries(fieldGroups)[activeTab][1].map((field) => (
            <Grid item xs={6} sm={4} md={3} key={field}>
              <FormControlLabel
                control={
                  <Checkbox
                    checked={selectedFields[field]}
                    onChange={() => handleFieldToggle(field)}
                  />
                }
                label={field.charAt(0).toUpperCase() + field.slice(1)}
              />
            </Grid>
          ))}
        </Grid>
      </Paper>

      <Paper sx={{ p: 3 }}>
        <Box display="flex" justifyContent="space-between" alignItems="center" mb={2} flexWrap="wrap" gap={1}>
          <Box>
            <Typography variant="h6">Data Preview</Typography>
            <Typography variant="caption" color="text.secondary">
              Click Load Preview to fetch data. Showing {PREVIEW_PAGE_SIZE} rows per page.
            </Typography>
          </Box>
          <Box display="flex" gap={1} alignItems="center">
            <Button
              startIcon={<RefreshIcon />}
              onClick={() => fetchData(0)}
              disabled={loading}
              variant="outlined"
            >
              Load Preview
            </Button>
            <Button
              onClick={() => fetchData(Math.max(0, previewPage - 1))}
              disabled={loading || previewPage === 0}
            >
              Previous
            </Button>
            <Typography variant="body2">Page {previewPage + 1}</Typography>
            <Button
              onClick={() => fetchData(previewPage + 1)}
              disabled={loading || !hasMore}
            >
              Next
            </Button>
          </Box>
        </Box>
        <TableContainer>
          <Table>
            <TableHead>
              <TableRow>
                {Object.entries(selectedFields)
                  .filter(([_, selected]) => selected)
                  .map(([field]) => (
                    <TableCell key={field}>
                      {field.charAt(0).toUpperCase() + field.slice(1)}
                    </TableCell>
                  ))}
              </TableRow>
            </TableHead>
            <TableBody>
              {records.map((record, index) => (
                <TableRow key={index}>
                  {Object.entries(selectedFields)
                    .filter(([_, selected]) => selected)
                    .map(([field]) => (
                      <TableCell key={field}>
                        {field === 'timestamp' || field === 'datetime'
                          ? record[field]
                            ? new Date(record[field]).toLocaleString()
                            : 'N/A'
                          : typeof record[field] === 'boolean'
                          ? (record[field] ? 'ON' : 'OFF')
                          : typeof record[field] === 'object'
                          ? JSON.stringify(record[field])
                          : (record[field] === null || record[field] === undefined ? 'N/A' : record[field])}
                      </TableCell>
                    ))}
                </TableRow>
              ))}
            </TableBody>
          </Table>
        </TableContainer>
      </Paper>
    </Container>
  );
};

export default DataExport; 