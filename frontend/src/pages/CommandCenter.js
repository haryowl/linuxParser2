// frontend/src/pages/CommandCenter.js

import React, { useEffect, useMemo, useState, useCallback } from 'react';
import {
  Container,
  Grid,
  Paper,
  Typography,
  FormControl,
  InputLabel,
  Select,
  MenuItem,
  TextField,
  Button,
  Alert,
  Divider,
  List,
  ListItem,
  ListItemText,
  Chip
} from '@mui/material';
import { useWebSocketMessage, useWebSocketConnection } from '../hooks/useWebSocket';
import {
  apiFetchDevicesRaw,
  apiFetchCommandList,
  apiFetchCommandPresets,
  apiFetchCommandHistory,
  apiSendDeviceCommand,
  apiSendDeviceCommandsBulk
} from '../services/api';
import DeviceSearchSelect from '../components/DeviceSearchSelect';

const CommandCenter = () => {
  const [devices, setDevices] = useState([]);
  const [selectedDeviceIds, setSelectedDeviceIds] = useState([]);
  const [commandList, setCommandList] = useState([]);
  const [presets, setPresets] = useState([]);
  const [commandText, setCommandText] = useState('');
  const [commandNumber, setCommandNumber] = useState('');
  const [payloadHex, setPayloadHex] = useState('');
  const [history, setHistory] = useState([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');
  const [success, setSuccess] = useState('');

  const primaryDeviceId = selectedDeviceIds[0] || '';
  const selectedDevice = useMemo(
    () => devices.find(device => device.id === primaryDeviceId),
    [devices, primaryDeviceId]
  );

  const loadDevices = useCallback(async () => {
    try {
      const list = await apiFetchDevicesRaw();
      setDevices(Array.isArray(list) ? list : []);
      if (list && list.length > 0) {
        setSelectedDeviceIds([list[0].id]);
      }
    } catch (err) {
      setError(err.message || 'Failed to load devices');
    }
  }, []);

  const loadCommandList = useCallback(async () => {
    try {
      const response = await apiFetchCommandList();
      const data = await response.json();
      if (response.ok) {
        setCommandList(Array.isArray(data) ? data : []);
      }
    } catch (err) {
      setError(err.message || 'Failed to load command list');
    }
  }, []);

  const loadPresets = useCallback(async (deviceId) => {
    if (!deviceId) return;
    try {
      const response = await apiFetchCommandPresets(deviceId);
      const data = await response.json();
      if (response.ok) {
        setPresets(Array.isArray(data.presets) ? data.presets : []);
      } else {
        setPresets([]);
      }
    } catch (err) {
      setPresets([]);
    }
  }, []);

  const loadHistory = useCallback(async (deviceId) => {
    if (!deviceId) return;
    try {
      const response = await apiFetchCommandHistory(deviceId);
      const data = await response.json();
      if (response.ok) {
        setHistory(Array.isArray(data) ? data : []);
      }
    } catch (err) {
      setHistory([]);
    }
  }, []);

  useEffect(() => {
    loadDevices();
    loadCommandList();
  }, [loadDevices, loadCommandList]);

  useEffect(() => {
    if (primaryDeviceId) {
      loadPresets(primaryDeviceId);
      loadHistory(primaryDeviceId);
    }
  }, [primaryDeviceId, loadPresets, loadHistory]);

  const handleWebSocketMessage = useCallback((message) => {
    if (message.topic !== 'command_reply') return;
    const replyImei = message.data?.imei || message.imei;
    if (selectedDevice?.imei && replyImei && replyImei !== selectedDevice.imei) {
      return;
    }
    // Reload from API so status/replyText come from DB, not a synthetic stub
    if (primaryDeviceId) {
      loadHistory(primaryDeviceId);
    }
  }, [selectedDevice, primaryDeviceId, loadHistory]);

  useWebSocketMessage(handleWebSocketMessage);
  const { isConnected, send } = useWebSocketConnection();

  useEffect(() => {
    if (!isConnected || !selectedDevice?.imei) return undefined;
    send({ type: 'subscribe', deviceId: selectedDevice.imei });
    return () => {
      send({ type: 'unsubscribe', deviceId: selectedDevice.imei });
    };
  }, [isConnected, selectedDevice, send]);

  const handleSend = async () => {
    if (selectedDeviceIds.length === 0) {
      setError('Please select at least one device');
      return;
    }
    if (!commandText && !payloadHex) {
      setError('Command text or payload hex is required');
      return;
    }

    setLoading(true);
    setError('');
    setSuccess('');
    try {
      const payload = payloadHex
        ? { payloadHex: payloadHex.trim() }
        : { commandText: commandText.trim(), commandNumber: commandNumber ? Number(commandNumber) : undefined };

      if (selectedDeviceIds.length === 1) {
        const response = await apiSendDeviceCommand(selectedDeviceIds[0], payload);
        const data = await response.json();
        if (!response.ok) {
          throw new Error(data.error || 'Failed to send command');
        }
        setSuccess(`Command queued (${data.commandId})`);
        loadHistory(selectedDeviceIds[0]);
      } else {
        const response = await apiSendDeviceCommandsBulk(selectedDeviceIds, payload);
        const data = await response.json();
        if (!response.ok) {
          throw new Error(data.error || 'Failed to send commands');
        }
        const successCount = Array.isArray(data.results)
          ? data.results.filter(item => !item.error).length
          : 0;
        setSuccess(`Commands queued for ${successCount}/${selectedDeviceIds.length} devices`);
        if (primaryDeviceId) {
          loadHistory(primaryDeviceId);
        }
      }
      setCommandText('');
      setCommandNumber('');
      setPayloadHex('');
    } catch (err) {
      setError(err.message || 'Failed to send command');
    } finally {
      setLoading(false);
    }
  };

  return (
    <Container maxWidth="lg" sx={{ mt: 4, mb: 4 }}>
      <Typography variant="h4" sx={{ mb: 2 }}>Command Center</Typography>

      {error && <Alert severity="error" sx={{ mb: 2 }}>{error}</Alert>}
      {success && <Alert severity="success" sx={{ mb: 2 }}>{success}</Alert>}

      <Grid container spacing={3}>
        <Grid item xs={12} md={6}>
          <Paper sx={{ p: 2 }}>
            <Typography variant="h6" sx={{ mb: 2 }}>Send Command</Typography>
            <DeviceSearchSelect
              multiple
              valueKey="id"
              label="Devices"
              devices={devices}
              value={selectedDeviceIds}
              onChange={setSelectedDeviceIds}
              sx={{ mb: 2 }}
            />

            <FormControl fullWidth sx={{ mb: 2 }}>
              <InputLabel>Preset Command</InputLabel>
              <Select
                label="Preset Command"
                value=""
                onChange={(event) => setCommandText(event.target.value)}
              >
                {presets.map(preset => (
                  <MenuItem key={preset} value={preset}>{preset}</MenuItem>
                ))}
              </Select>
            </FormControl>

            <TextField
              label="Command Text"
              value={commandText}
              onChange={(event) => setCommandText(event.target.value)}
              fullWidth
              sx={{ mb: 2 }}
            />

            <TextField
              label="Command Number (optional)"
              value={commandNumber}
              onChange={(event) => setCommandNumber(event.target.value)}
              type="number"
              fullWidth
              sx={{ mb: 2 }}
            />

            <TextField
              label="Raw Payload Hex (optional)"
              value={payloadHex}
              onChange={(event) => setPayloadHex(event.target.value)}
              fullWidth
              sx={{ mb: 2 }}
              helperText="If provided, payload hex overrides command text"
            />

            <Button variant="contained" onClick={handleSend} disabled={loading}>
              {loading ? 'Sending...' : 'Send Command'}
            </Button>
          </Paper>
        </Grid>

        <Grid item xs={12} md={6}>
          <Paper sx={{ p: 2, mb: 3 }}>
            <Typography variant="h6" sx={{ mb: 2 }}>Command List</Typography>
            {commandList.length === 0 && (
              <Typography color="text.secondary">No command list found.</Typography>
            )}
            {commandList.length > 0 && (
              <List dense>
                {commandList.slice(0, 20).map((command) => (
                  <ListItem key={command.name}>
                    <ListItemText
                      primary={command.name}
                      secondary={command.description || ''}
                    />
                  </ListItem>
                ))}
              </List>
            )}
          </Paper>

          <Paper sx={{ p: 2 }}>
            <Typography variant="h6" sx={{ mb: 2 }}>Command History</Typography>
            <Button size="small" onClick={() => loadHistory(primaryDeviceId)} sx={{ mb: 1 }}>
              Refresh
            </Button>
            <Divider sx={{ mb: 2 }} />
            {history.length === 0 && (
              <Typography color="text.secondary">No commands sent yet.</Typography>
            )}
            {history.length > 0 && (
              <List dense>
                {history.map(entry => (
                  <ListItem key={entry.id} alignItems="flex-start">
                    <ListItemText
                      primary={`${entry.commandText || 'Command'}${entry.commandNumber ? ` (#${entry.commandNumber})` : ''}`}
                      secondary={
                        <>
                          <Typography variant="caption" display="block">
                            {entry.createdAt ? new Date(entry.createdAt).toLocaleString() : 'Unknown time'}
                          </Typography>
                          {entry.replyText && (
                            <Typography variant="caption" display="block">
                              Reply: {entry.replyText}
                            </Typography>
                          )}
                          {entry.replyDataHex && (
                            <Typography variant="caption" display="block">
                              Reply HEX: {entry.replyDataHex}
                            </Typography>
                          )}
                        </>
                      }
                    />
                    <Chip size="small" label={entry.status || 'queued'} />
                  </ListItem>
                ))}
              </List>
            )}
          </Paper>
        </Grid>
      </Grid>
    </Container>
  );
};

export default CommandCenter;
