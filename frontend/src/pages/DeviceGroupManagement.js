import React, { useState, useEffect, useCallback, useMemo } from 'react';
import {
  Container,
  Paper,
  Typography,
  Button,
  Box,
  Grid,
  Card,
  CardContent,
  IconButton,
  Dialog,
  DialogTitle,
  DialogContent,
  DialogActions,
  TextField,
  Table,
  TableBody,
  TableCell,
  TableContainer,
  TableHead,
  TableRow,
  Chip,
  Alert,
  CircularProgress,
  Tooltip,
  FormControl,
  InputLabel,
  Select,
  MenuItem,
  Divider
} from '@mui/material';
import {
  Add as AddIcon,
  Edit as EditIcon,
  Delete as DeleteIcon,
  Devices as DevicesIcon,
  Group as GroupIcon,
  ColorLens as ColorIcon,
  Person as PersonIcon,
  Schedule as ScheduleIcon
} from '@mui/icons-material';
import { useSnackbar } from 'notistack';
import { formatDistanceToNow } from 'date-fns';
import { apiFetchDevicesRaw, apiFetchDeviceGroups, apiCreateDeviceGroup, apiUpdateDeviceGroup, apiDeleteDeviceGroup, apiAddDeviceToGroup, apiRemoveDeviceFromGroup } from '../services/api';

const DeviceGroupManagement = () => {
  const { enqueueSnackbar } = useSnackbar();
  const [groups, setGroups] = useState([]);
  const [devices, setDevices] = useState([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  
  // Dialog states
  const [groupDialog, setGroupDialog] = useState({ open: false, editing: null });
  const [deviceDialog, setDeviceDialog] = useState({ open: false, group: null });
  
  // Form states
  const [groupForm, setGroupForm] = useState({
    name: '',
    description: '',
    color: '#1976d2'
  });
  
  const [selectedDeviceId, setSelectedDeviceId] = useState('');

  // Load data
  const loadData = useCallback(async () => {
    try {
      setLoading(true);
      setError('');
      
      console.log('🔄 Loading device groups and devices...');
      
      const [devicesData, groupsData] = await Promise.all([
        apiFetchDevicesRaw(),
        apiFetchDeviceGroups()
      ]);
      
      console.log('📱 Devices data:', devicesData);
      console.log('🏷️ Groups data:', groupsData);
      
      // Set devices
      const devicesArray = Array.isArray(devicesData) ? devicesData : [];
      console.log('📱 Setting devices:', devicesArray.length, 'devices');
      setDevices(devicesArray);
      
      // Set groups (apiFetchDeviceGroups returns { success, data })
      const groupsArray = Array.isArray(groupsData?.data)
        ? groupsData.data
        : (Array.isArray(groupsData) ? groupsData : []);
      console.log('🏷️ Setting groups:', groupsArray.length, 'groups');
      setGroups(groupsArray);
      
    } catch (error) {
      console.error('❌ Error loading data:', error);
      setError('Failed to load device groups and devices');
      setGroups([]);
      setDevices([]);
      enqueueSnackbar('Failed to load data', { variant: 'error' });
    } finally {
      setLoading(false);
    }
  }, [enqueueSnackbar]);

  useEffect(() => {
    loadData();
  }, [loadData]);

  // Handle group form submission
  const handleGroupSubmit = async () => {
    try {
      if (!groupForm.name.trim()) {
        enqueueSnackbar('Group name is required', { variant: 'error' });
        return;
      }

      if (groupDialog.editing) {
        await apiUpdateDeviceGroup(groupDialog.editing.id, groupForm);
        enqueueSnackbar('Device group updated successfully', { variant: 'success' });
      } else {
        await apiCreateDeviceGroup(groupForm);
        enqueueSnackbar('Device group created successfully', { variant: 'success' });
      }
      
      setGroupDialog({ open: false, editing: null });
      setGroupForm({ name: '', description: '', color: '#1976d2' });
      loadData();
    } catch (error) {
      console.error('Error saving group:', error);
      enqueueSnackbar(error.response?.data?.error || 'Failed to save group', { variant: 'error' });
    }
  };

  // Handle group deletion
  const handleDeleteGroup = async (groupId) => {
    if (!window.confirm('Are you sure you want to delete this device group? This will remove all devices from the group.')) {
      return;
    }

    try {
      await apiDeleteDeviceGroup(groupId);
      enqueueSnackbar('Device group deleted successfully', { variant: 'success' });
      loadData();
    } catch (error) {
      console.error('Error deleting group:', error);
      enqueueSnackbar(error.response?.data?.error || 'Failed to delete group', { variant: 'error' });
    }
  };

  // Handle adding device to group
  const handleAddDeviceToGroup = async () => {
    if (!selectedDeviceId) {
      enqueueSnackbar('Please select a device', { variant: 'error' });
      return;
    }

    try {
      console.log('🔄 Adding device to group:', { deviceId: selectedDeviceId, groupId: deviceDialog.group.id });
      const result = await apiAddDeviceToGroup(deviceDialog.group.id, selectedDeviceId);
      if (result?.alreadyInGroup) {
        enqueueSnackbar('Device is already in this group', { variant: 'info' });
      } else {
        enqueueSnackbar('Device added to group successfully', { variant: 'success' });
      }
      setDeviceDialog({ open: false, group: null });
      setSelectedDeviceId('');
      console.log('🔄 Reloading data after adding device...');
      await loadData();
      console.log('✅ Data reloaded successfully');
    } catch (error) {
      console.error('Error adding device to group:', error);
      enqueueSnackbar(error.message || 'Failed to add device to group', { variant: 'error' });
    }
  };

  // Handle removing device from group
  const handleRemoveDeviceFromGroup = async (groupId, deviceId) => {
    if (!window.confirm('Are you sure you want to remove this device from the group?')) {
      return;
    }

    try {
      await apiRemoveDeviceFromGroup(groupId, deviceId);
      enqueueSnackbar('Device removed from group successfully', { variant: 'success' });
      loadData();
    } catch (error) {
      console.error('Error removing device from group:', error);
      enqueueSnackbar(error.response?.data?.error || 'Failed to remove device from group', { variant: 'error' });
    }
  };

  // Open group dialog
  const openGroupDialog = (group = null) => {
    if (group) {
      setGroupForm({
        name: group.name,
        description: group.description || '',
        color: group.color
      });
      setGroupDialog({ open: true, editing: group });
    } else {
      setGroupForm({ name: '', description: '', color: '#1976d2' });
      setGroupDialog({ open: true, editing: null });
    }
  };

  // Get available devices for a group (devices not in any group or in this specific group)
  const getAvailableDevices = useCallback((groupId) => {
    if (!Array.isArray(devices)) return [];
    return devices.filter(device => 
      !device.groupId || device.groupId === groupId
    );
  }, [devices]);

  // Get devices in a specific group
  const getDevicesInGroup = useCallback((groupId) => {
    if (!Array.isArray(devices)) return [];
    console.log('🔍 Filtering devices for group:', groupId);
    console.log('📱 Available devices:', devices.map(d => ({ id: d.id, name: d.name, groupId: d.groupId, groupIdType: typeof d.groupId })));
    
    const devicesInGroup = devices.filter(device => {
      const deviceGroupId = parseInt(device.groupId);
      const targetGroupId = parseInt(groupId);
      const matches = deviceGroupId === targetGroupId;
      console.log(`Device ${device.name}: groupId=${device.groupId} (${typeof device.groupId}) vs target=${groupId} (${typeof groupId}) = ${matches}`);
      return matches;
    });
    
    console.log('✅ Devices in group:', devicesInGroup.map(d => d.name));
    return devicesInGroup;
  }, [devices]);

  if (loading) {
    return (
      <Container maxWidth="xl" sx={{ py: 4 }}>
        <Box display="flex" justifyContent="center" alignItems="center" minHeight="400px">
          <CircularProgress />
        </Box>
      </Container>
    );
  }

  return (
    <Container maxWidth="xl" sx={{ py: 4 }}>
      <Box sx={{ mb: 4 }}>
        <Box sx={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', mb: 2 }}>
          <Typography variant="h4" component="h1" fontWeight="bold">
            Device Group Management
          </Typography>
          <Button
            variant="contained"
            startIcon={<AddIcon />}
            onClick={() => openGroupDialog()}
          >
            Create Group
          </Button>
        </Box>
        <Typography variant="body1" color="text.secondary">
          Organize your devices into logical groups for better management and access control.
        </Typography>
      </Box>

      {error && (
        <Alert severity="error" sx={{ mb: 3 }}>
          {error}
        </Alert>
      )}

      <Grid container spacing={3}>
        {Array.isArray(groups) && groups.map((group) => (
          <Grid item xs={12} md={6} lg={4} key={group.id}>
            <Card sx={{ height: '100%', display: 'flex', flexDirection: 'column' }}>
              <CardContent sx={{ flexGrow: 1 }}>
                <Box sx={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', mb: 2 }}>
                  <Box sx={{ display: 'flex', alignItems: 'center', flex: 1 }}>
                    <Box
                      sx={{
                        width: 16,
                        height: 16,
                        borderRadius: '50%',
                        backgroundColor: group.color,
                        mr: 1.5,
                        border: '2px solid',
                        borderColor: 'divider'
                      }}
                    />
                    <Typography variant="h6" sx={{ fontWeight: 600 }}>
                      {group.name}
                    </Typography>
                  </Box>
                  <Box sx={{ display: 'flex', gap: 0.5 }}>
                    <Tooltip title="Edit Group">
                      <IconButton size="small" onClick={() => openGroupDialog(group)}>
                        <EditIcon fontSize="small" />
                      </IconButton>
                    </Tooltip>
                    <Tooltip title="Delete Group">
                      <IconButton size="small" onClick={() => handleDeleteGroup(group.id)}>
                        <DeleteIcon fontSize="small" />
                      </IconButton>
                    </Tooltip>
                  </Box>
                </Box>

                <Typography variant="body2" color="text.secondary" sx={{ mb: 2, minHeight: 40 }}>
                  {group.description || 'No description provided'}
                </Typography>

                <Box sx={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', mb: 2 }}>
                  <Box sx={{ display: 'flex', alignItems: 'center', gap: 1 }}>
                    <PersonIcon fontSize="small" color="action" />
                    <Typography variant="caption" color="text.secondary">
                      {group.creator?.firstName} {group.creator?.lastName}
                    </Typography>
                  </Box>
                  <Chip
                    icon={<DevicesIcon />}
                    label={`${getDevicesInGroup(group.id).length} devices`}
                    size="small"
                    variant="outlined"
                  />
                </Box>

                <Box sx={{ display: 'flex', alignItems: 'center', gap: 1, mb: 2 }}>
                  <ScheduleIcon fontSize="small" color="action" />
                  <Typography variant="caption" color="text.secondary">
                    Created {formatDistanceToNow(new Date(group.createdAt), { addSuffix: true })}
                  </Typography>
                </Box>

                <Divider sx={{ my: 2 }} />

                <Button
                  variant="outlined"
                  size="small"
                  startIcon={<DevicesIcon />}
                  onClick={async () => {
                    console.log('🔍 Opening device dialog for group:', group.id, group.name);
                    console.log('📱 Current devices state:', devices.map(d => ({ id: d.id, name: d.name, groupId: d.groupId })));
                    await loadData(); // Refresh data before opening dialog
                    setDeviceDialog({ open: true, group });
                  }}
                  fullWidth
                >
                  Manage Devices
                </Button>
              </CardContent>
            </Card>
          </Grid>
        ))}
      </Grid>

      {Array.isArray(groups) && groups.length === 0 && !loading && (
        <Paper sx={{ p: 4, textAlign: 'center' }}>
          <GroupIcon sx={{ fontSize: 64, color: 'text.secondary', mb: 2 }} />
          <Typography variant="h6" color="text.secondary" gutterBottom>
            No Device Groups
          </Typography>
          <Typography variant="body2" color="text.secondary" sx={{ mb: 3 }}>
            Create your first device group to start organizing your devices.
          </Typography>
          <Button
            variant="contained"
            startIcon={<AddIcon />}
            onClick={() => openGroupDialog()}
          >
            Create First Group
          </Button>
        </Paper>
      )}

      {/* Group Dialog */}
      <Dialog open={groupDialog.open} onClose={() => setGroupDialog({ open: false, editing: null })} maxWidth="sm" fullWidth>
        <DialogTitle>
          {groupDialog.editing ? 'Edit Device Group' : 'Create New Device Group'}
        </DialogTitle>
        <DialogContent>
          <Box sx={{ pt: 1 }}>
            <TextField
              fullWidth
              label="Group Name"
              value={groupForm.name}
              onChange={(e) => setGroupForm({ ...groupForm, name: e.target.value })}
              sx={{ mb: 2 }}
            />
            <TextField
              fullWidth
              label="Description"
              multiline
              rows={3}
              value={groupForm.description}
              onChange={(e) => setGroupForm({ ...groupForm, description: e.target.value })}
              sx={{ mb: 2 }}
            />
            <TextField
              fullWidth
              label="Group Color"
              type="color"
              value={groupForm.color}
              onChange={(e) => setGroupForm({ ...groupForm, color: e.target.value })}
              InputProps={{
                startAdornment: <ColorIcon sx={{ mr: 1, color: 'action.active' }} />
              }}
            />
          </Box>
        </DialogContent>
        <DialogActions>
          <Button onClick={() => setGroupDialog({ open: false, editing: null })}>
            Cancel
          </Button>
          <Button onClick={handleGroupSubmit} variant="contained">
            {groupDialog.editing ? 'Update' : 'Create'}
          </Button>
        </DialogActions>
      </Dialog>

      {/* Device Management Dialog */}
      <Dialog open={deviceDialog.open} onClose={() => setDeviceDialog({ open: false, group: null })} maxWidth="md" fullWidth>
        <DialogTitle>
          Manage Devices - {deviceDialog.group?.name}
        </DialogTitle>
        <DialogContent>
          <Box sx={{ pt: 1 }}>
            <Typography variant="h6" sx={{ mb: 2 }}>
              Devices in Group
            </Typography>
            <TableContainer component={Paper} variant="outlined" sx={{ mb: 3 }}>
              <Table size="small">
                <TableHead>
                  <TableRow>
                    <TableCell>Device Name</TableCell>
                    <TableCell>IMEI</TableCell>
                    <TableCell>Status</TableCell>
                    <TableCell>Last Seen</TableCell>
                    <TableCell align="right">Actions</TableCell>
                  </TableRow>
                </TableHead>
                <TableBody>
                  {getDevicesInGroup(deviceDialog.group?.id).map((device) => (
                    <TableRow key={device.id}>
                      <TableCell>{device.name}</TableCell>
                      <TableCell>{device.imei}</TableCell>
                      <TableCell>
                        <Chip
                          label={device.status}
                          size="small"
                          color={device.status === 'active' ? 'success' : 'default'}
                        />
                      </TableCell>
                      <TableCell>
                        {device.lastSeen ? formatDistanceToNow(new Date(device.lastSeen), { addSuffix: true }) : 'Never'}
                      </TableCell>
                      <TableCell align="right">
                        <Tooltip title="Remove from Group">
                          <IconButton
                            size="small"
                            onClick={() => handleRemoveDeviceFromGroup(deviceDialog.group.id, device.id)}
                          >
                            <DeleteIcon fontSize="small" />
                          </IconButton>
                        </Tooltip>
                      </TableCell>
                    </TableRow>
                  ))}
                  {getDevicesInGroup(deviceDialog.group?.id).length === 0 && (
                    <TableRow>
                      <TableCell colSpan={5} align="center" sx={{ py: 3 }}>
                        <Typography variant="body2" color="text.secondary">
                          No devices in this group
                        </Typography>
                      </TableCell>
                    </TableRow>
                  )}
                </TableBody>
              </Table>
            </TableContainer>

            <Typography variant="h6" sx={{ mb: 2 }}>
              Add Device to Group
            </Typography>
            <Box sx={{ display: 'flex', gap: 2, alignItems: 'center' }}>
              <FormControl fullWidth>
                <InputLabel>Select Device</InputLabel>
                <Select
                  value={selectedDeviceId}
                  onChange={(e) => setSelectedDeviceId(e.target.value)}
                  label="Select Device"
                >
                  {getAvailableDevices(deviceDialog.group?.id)
                    .filter(device => device.groupId !== deviceDialog.group?.id)
                    .map((device) => (
                      <MenuItem key={device.id} value={device.id}>
                        {device.name} ({device.imei})
                      </MenuItem>
                    ))}
                </Select>
              </FormControl>
              <Button
                variant="contained"
                onClick={handleAddDeviceToGroup}
                disabled={!selectedDeviceId}
              >
                Add Device
              </Button>
            </Box>
          </Box>
        </DialogContent>
        <DialogActions>
          <Button onClick={() => setDeviceDialog({ open: false, group: null })}>
            Close
          </Button>
        </DialogActions>
      </Dialog>
    </Container>
  );
};

export default DeviceGroupManagement; 