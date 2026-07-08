import React, { useState, useEffect, useCallback } from 'react';
import { useNavigate } from 'react-router-dom';
import {
  Container,
  Paper,
  Table,
  TableBody,
  TableCell,
  TableContainer,
  TableHead,
  TableRow,
  Typography,
  Button,
  Box,
  Chip,
  CircularProgress,
  Alert,
  IconButton,
  Tooltip,
  FormControl,
  InputLabel,
  Select,
  MenuItem,
  TextField,
  Grid
} from '@mui/material';
import { 
  LocationOn as LocationIcon, 
  Refresh as RefreshIcon,
  Edit as EditIcon,
  Group as GroupIcon,
  FilterList as FilterIcon,
  Clear as ClearIcon
} from '@mui/icons-material';
import useWebSocket from '../hooks/useWebSocket';
import { useWebSocketConnection } from '../contexts/WebSocketContext';
import { apiFetchDevices, apiFetchDeviceGroups } from '../services/api';
import DeviceEditDialog from '../components/DeviceEditDialog';

const DeviceList = () => {
  const navigate = useNavigate();
  const [devices, setDevices] = useState([]);
  const [groups, setGroups] = useState([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);
  const [editDialogOpen, setEditDialogOpen] = useState(false);
  const [selectedDevice, setSelectedDevice] = useState(null);
  
  // Filter states
  const [groupFilter, setGroupFilter] = useState('');
  const [statusFilter, setStatusFilter] = useState('');
  const [searchTerm, setSearchTerm] = useState('');

  // WebSocket connection for real-time updates
  const handleWebSocketMessage = useCallback((message) => {
    if (message.topic === 'device_updated') {
      const data = message.data || message;
      console.log('Device update received:', data);
      
      if (data.isNew) {
        // New device - add to list
        setDevices(prevDevices => {
          const newDevice = {
            id: Date.now(), // Temporary ID
            name: `Device ${data.imei}`,
            imei: data.imei,
            status: data.isActive ? 'Active' : 'Inactive',
            lastSeen: data.lastSeen,
            isActive: data.isActive
          };
          
          // Check if device already exists
          const exists = prevDevices.find(d => d.imei === data.imei);
          if (exists) {
            // Update existing device
            return prevDevices.map(d => 
              d.imei === data.imei 
                ? { ...d, lastSeen: data.lastSeen, isActive: data.isActive, status: data.isActive ? 'Active' : 'Inactive' }
                : d
            );
          } else {
            // Add new device
            return [...prevDevices, newDevice];
          }
        });
      } else {
        // Existing device update
        setDevices(prevDevices => 
          prevDevices.map(d => 
            d.imei === data.imei 
              ? { ...d, lastSeen: data.lastSeen, isActive: data.isActive, status: data.isActive ? 'Active' : 'Inactive' }
              : d
          )
        );
      }
    }
  }, []);

  const { isConnected } = useWebSocketConnection();
  useWebSocket(null, handleWebSocketMessage);

  // Fetch devices and groups independently so group failures never block the device list.
  const fetchData = async () => {
    setLoading(true);
    setError(null);

    const FETCH_TIMEOUT_MS = 45000;
    const withTimeout = (promise, label) =>
      Promise.race([
        promise,
        new Promise((_, reject) =>
          setTimeout(() => reject(new Error(`${label} timed out`)), FETCH_TIMEOUT_MS)
        )
      ]);

    try {
      const [devicesResult, groupsResult] = await Promise.allSettled([
        withTimeout(apiFetchDevices(), 'Devices'),
        withTimeout(apiFetchDeviceGroups(), 'Device groups')
      ]);

      if (devicesResult.status === 'fulfilled' && devicesResult.value?.success) {
        setDevices(devicesResult.value.data || []);
      } else {
        const message =
          devicesResult.status === 'fulfilled'
            ? (devicesResult.value?.message || 'Failed to fetch devices')
            : (devicesResult.reason?.message || 'Failed to fetch devices');
        setError(message);
        console.error('Error fetching devices:', devicesResult);
      }

      if (groupsResult.status === 'fulfilled' && groupsResult.value?.success) {
        setGroups(groupsResult.value.data || []);
      } else if (groupsResult.status === 'fulfilled' && Array.isArray(groupsResult.value)) {
        // Backward compatibility if API still returns a bare array
        setGroups(groupsResult.value);
      } else {
        setGroups([]);
        console.warn('Device groups unavailable; continuing with devices only', groupsResult);
      }
    } catch (err) {
      console.error('Error fetching data:', err);
      setError('Failed to fetch data');
    } finally {
      setLoading(false);
    }
  };

  // Initial fetch
  useEffect(() => {
    fetchData();
  }, []);

  // Filter devices based on current filters
  const filteredDevices = devices.filter(device => {
    const matchesGroup = !groupFilter || device.groupId === parseInt(groupFilter);
    const matchesStatus = !statusFilter || device.status === statusFilter;
    const matchesSearch = !searchTerm || 
      device.name?.toLowerCase().includes(searchTerm.toLowerCase()) ||
      device.imei?.toLowerCase().includes(searchTerm.toLowerCase());
    
    return matchesGroup && matchesStatus && matchesSearch;
  });

  // Get group name by ID
  const getGroupName = (groupId) => {
    if (!groupId) return null;
    const group = groups.find(g => g.id === groupId);
    return group ? group.name : null;
  };

  // Get group color by ID
  const getGroupColor = (groupId) => {
    if (!groupId) return null;
    const group = groups.find(g => g.id === groupId);
    return group ? group.color : null;
  };

  // Clear all filters
  const clearFilters = () => {
    setGroupFilter('');
    setStatusFilter('');
    setSearchTerm('');
  };

  const handleDeviceClick = (deviceId) => {
    navigate(`/devices/${deviceId}`);
  };

  const handleTrackingClick = () => {
    navigate('/tracking');
  };

  const handleGroupManagementClick = () => {
    navigate('/device-groups');
  };

  const handleEditDevice = (device) => {
    setSelectedDevice(device);
    setEditDialogOpen(true);
  };

  const handleEditSave = (updatedDevice) => {
    setDevices(prevDevices => 
      prevDevices.map(d => 
        d.id === updatedDevice.id ? updatedDevice : d
      )
    );
  };

  const handleEditClose = () => {
    setEditDialogOpen(false);
    setSelectedDevice(null);
  };

  const getStatusColor = (status) => {
    switch (status) {
      case 'Active':
        return 'success';
      case 'Inactive':
        return 'error';
      default:
        return 'default';
    }
  };

  const formatLastSeen = (lastSeen) => {
    if (!lastSeen) return 'Never';
    const date = new Date(lastSeen);
    const now = new Date();
    const diffMs = now - date;
    const diffMins = Math.floor(diffMs / 60000);
    
    if (diffMins < 1) return 'Just now';
    if (diffMins < 60) return `${diffMins} minutes ago`;
    if (diffMins < 1440) return `${Math.floor(diffMins / 60)} hours ago`;
    return date.toLocaleString();
  };

  if (loading) {
    return (
      <Container maxWidth="lg" sx={{ mt: 4, mb: 4, textAlign: 'center' }}>
        <CircularProgress />
        <Typography variant="h6" sx={{ mt: 2 }}>
          Loading devices...
        </Typography>
      </Container>
    );
  }

  return (
    <Container maxWidth="lg" sx={{ mt: 4, mb: 4 }}>
      <Box display="flex" justifyContent="space-between" alignItems="center" mb={3}>
        <Typography variant="h4" component="h1">
          Devices
        </Typography>
        <Box>
          <Button
            variant="outlined"
            startIcon={<GroupIcon />}
            onClick={handleGroupManagementClick}
            sx={{ mr: 2 }}
          >
            Manage Groups
          </Button>
          <Button
            variant="outlined"
            startIcon={<RefreshIcon />}
            onClick={fetchData}
            sx={{ mr: 2 }}
          >
            Refresh
          </Button>
          <Button
            variant="contained"
            color="primary"
            startIcon={<LocationIcon />}
            onClick={handleTrackingClick}
          >
            View Tracking
          </Button>
        </Box>
      </Box>

      {/* Filters */}
      <Paper sx={{ p: 2, mb: 3 }}>
        <Box display="flex" alignItems="center" mb={2}>
          <FilterIcon sx={{ mr: 1 }} />
          <Typography variant="h6">Filters</Typography>
        </Box>
        <Grid container spacing={2} alignItems="center">
          <Grid item xs={12} sm={6} md={3}>
            <TextField
              fullWidth
              label="Search devices"
              value={searchTerm}
              onChange={(e) => setSearchTerm(e.target.value)}
              placeholder="Search by name or IMEI..."
            />
          </Grid>
          <Grid item xs={12} sm={6} md={3}>
            <FormControl fullWidth>
              <InputLabel>Group</InputLabel>
              <Select
                value={groupFilter}
                onChange={(e) => setGroupFilter(e.target.value)}
                label="Group"
              >
                <MenuItem value="">All Groups</MenuItem>
                {groups.map((group) => (
                  <MenuItem key={group.id} value={group.id}>
                    <Box sx={{ display: 'flex', alignItems: 'center' }}>
                      <Box
                        sx={{
                          width: 12,
                          height: 12,
                          borderRadius: '50%',
                          backgroundColor: group.color,
                          mr: 1
                        }}
                      />
                      {group.name}
                    </Box>
                  </MenuItem>
                ))}
              </Select>
            </FormControl>
          </Grid>
          <Grid item xs={12} sm={6} md={3}>
            <FormControl fullWidth>
              <InputLabel>Status</InputLabel>
              <Select
                value={statusFilter}
                onChange={(e) => setStatusFilter(e.target.value)}
                label="Status"
              >
                <MenuItem value="">All Status</MenuItem>
                <MenuItem value="Active">Active</MenuItem>
                <MenuItem value="Inactive">Inactive</MenuItem>
              </Select>
            </FormControl>
          </Grid>
          <Grid item xs={12} sm={6} md={3}>
            <Button
              variant="outlined"
              startIcon={<ClearIcon />}
              onClick={clearFilters}
              fullWidth
            >
              Clear Filters
            </Button>
          </Grid>
        </Grid>
        <Box sx={{ mt: 2 }}>
          <Typography variant="body2" color="text.secondary">
            Showing {filteredDevices.length} of {devices.length} devices
          </Typography>
        </Box>
      </Paper>

      {error && (
        <Alert severity="error" sx={{ mb: 2 }}>
          {error}
        </Alert>
      )}

      {!isConnected && (
        <Alert severity="warning" sx={{ mb: 2 }}>
          WebSocket disconnected - real-time updates unavailable
        </Alert>
      )}

      <TableContainer component={Paper}>
        <Table>
          <TableHead>
            <TableRow>
              <TableCell>Name</TableCell>
              <TableCell>IMEI</TableCell>
              <TableCell>Group</TableCell>
              <TableCell>Status</TableCell>
              <TableCell>Last Seen</TableCell>
              <TableCell>Custom Fields</TableCell>
              <TableCell>Actions</TableCell>
            </TableRow>
          </TableHead>
          <TableBody>
            {filteredDevices.length === 0 ? (
              <TableRow>
                <TableCell colSpan={7} align="center">
                  <Typography variant="body1" color="textSecondary">
                    {devices.length === 0 ? 'No devices found' : 'No devices match the current filters'}
                  </Typography>
                </TableCell>
              </TableRow>
            ) : (
              filteredDevices.map((device) => (
                <TableRow key={device.id || device.imei}>
                  <TableCell>
                    <Typography variant="body1" fontWeight="medium">
                      {device.name}
                    </Typography>
                  </TableCell>
                  <TableCell>
                    <Typography variant="body2" fontFamily="monospace">
                      {device.imei}
                    </Typography>
                  </TableCell>
                  <TableCell>
                    {device.groupId ? (
                      <Chip
                        icon={<GroupIcon />}
                        label={getGroupName(device.groupId)}
                        size="small"
                        sx={{
                          backgroundColor: getGroupColor(device.groupId),
                          color: 'white',
                          '& .MuiChip-icon': {
                            color: 'white'
                          }
                        }}
                      />
                    ) : (
                      <Typography variant="body2" color="textSecondary">
                        No Group
                      </Typography>
                    )}
                  </TableCell>
                  <TableCell>
                    <Chip 
                      label={device.status} 
                      color={getStatusColor(device.status)}
                      size="small"
                    />
                  </TableCell>
                  <TableCell>{formatLastSeen(device.lastSeen)}</TableCell>
                  <TableCell>
                    {device.customFields && Object.keys(device.customFields).length > 0 ? (
                      <Box sx={{ display: 'flex', flexWrap: 'wrap', gap: 0.5 }}>
                        {Object.entries(device.customFields).slice(0, 2).map(([key, value]) => (
                          <Chip
                            key={key}
                            label={`${key}: ${value}`}
                            size="small"
                            variant="outlined"
                            color="secondary"
                          />
                        ))}
                        {Object.keys(device.customFields).length > 2 && (
                          <Chip
                            label={`+${Object.keys(device.customFields).length - 2} more`}
                            size="small"
                            variant="outlined"
                            color="info"
                          />
                        )}
                      </Box>
                    ) : (
                      <Typography variant="body2" color="textSecondary">
                        No custom fields
                      </Typography>
                    )}
                  </TableCell>
                  <TableCell>
                    <Box sx={{ display: 'flex', gap: 1 }}>
                      <Tooltip title="Edit Device">
                        <IconButton
                          size="small"
                          color="primary"
                          onClick={() => handleEditDevice(device)}
                        >
                          <EditIcon />
                        </IconButton>
                      </Tooltip>
                      <Button
                        variant="outlined"
                        color="primary"
                        size="small"
                        onClick={() => handleDeviceClick(device.id || device.imei)}
                      >
                        Details
                      </Button>
                    </Box>
                  </TableCell>
                </TableRow>
              ))
            )}
          </TableBody>
        </Table>
      </TableContainer>

      {/* Device Edit Dialog */}
      <DeviceEditDialog
        open={editDialogOpen}
        device={selectedDevice}
        onClose={handleEditClose}
        onSave={handleEditSave}
      />
    </Container>
  );
};

export default DeviceList; 