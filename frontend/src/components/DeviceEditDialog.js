import React, { useState, useEffect } from 'react';
import {
  Dialog,
  DialogTitle,
  DialogContent,
  DialogActions,
  TextField,
  Button,
  Box,
  Typography,
  IconButton,
  Chip,
  Alert,
  CircularProgress,
  FormControl,
  InputLabel,
  Select,
  MenuItem
} from '@mui/material';
import { Add as AddIcon, Group as GroupIcon } from '@mui/icons-material';
import { authenticatedFetch, apiFetchDeviceGroups } from '../services/api';

const DeviceEditDialog = ({ open, device, onClose, onSave }) => {
  const [formData, setFormData] = useState({
    name: '',
    groupId: null,
    customFields: {}
  });
  const [groups, setGroups] = useState([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState(null);
  const [newCustomField, setNewCustomField] = useState({ key: '', value: '' });

  // Load groups when dialog opens
  useEffect(() => {
    if (open) {
      loadGroups();
    }
  }, [open]);

  useEffect(() => {
    if (device) {
      setFormData({
        name: device.name || '',
        groupId: device.groupId || null,
        customFields: device.customFields || {}
      });
    }
  }, [device]);

  const loadGroups = async () => {
    try {
      const groupsData = await apiFetchDeviceGroups();
      const groupsArray = Array.isArray(groupsData?.data)
        ? groupsData.data
        : (Array.isArray(groupsData) ? groupsData : []);
      setGroups(groupsArray);
    } catch (error) {
      console.error('Error loading groups:', error);
    }
  };

  const handleInputChange = (field, value) => {
    setFormData(prev => ({
      ...prev,
      [field]: value
    }));
  };

  const handleCustomFieldChange = (key, value) => {
    setNewCustomField({ key, value });
  };

  const addCustomField = () => {
    if (newCustomField.key.trim() && newCustomField.value.trim()) {
      setFormData(prev => ({
        ...prev,
        customFields: {
          ...prev.customFields,
          [newCustomField.key.trim()]: newCustomField.value.trim()
        }
      }));
      setNewCustomField({ key: '', value: '' });
    }
  };

  const removeCustomField = (key) => {
    setFormData(prev => {
      const newCustomFields = { ...prev.customFields };
      delete newCustomFields[key];
      return {
        ...prev,
        customFields: newCustomFields
      };
    });
  };

  const handleSave = async () => {
    if (!device) return;

    try {
      setLoading(true);
      setError(null);

      const response = await authenticatedFetch(`/api/devices/${device.id}`, {
        method: 'PUT',
        headers: {
          'Content-Type': 'application/json',
        },
        body: JSON.stringify(formData)
      });

      if (response.ok) {
        const result = await response.json();
        onSave(result.device || { ...device, ...formData });
        onClose();
      } else {
        const errorData = await response.json();
        setError(errorData.message || 'Failed to update device');
      }
    } catch (err) {
      console.error('Error updating device:', err);
      setError('Failed to update device');
    } finally {
      setLoading(false);
    }
  };

  const handleKeyPress = (event) => {
    if (event.key === 'Enter') {
      addCustomField();
    }
  };

  return (
    <Dialog open={open} onClose={onClose} maxWidth="md" fullWidth>
      <DialogTitle>
        Edit Device: {device?.imei}
      </DialogTitle>
      <DialogContent>
        {error && (
          <Alert severity="error" sx={{ mb: 2 }}>
            {error}
          </Alert>
        )}

        <Box sx={{ mb: 3 }}>
          <TextField
            fullWidth
            label="Device Name"
            value={formData.name}
            onChange={(e) => handleInputChange('name', e.target.value)}
            margin="normal"
            required
          />
        </Box>

        <Box sx={{ mb: 3 }}>
          <Typography variant="h6" gutterBottom>
            Device Group
          </Typography>
          <Typography variant="body2" color="textSecondary" sx={{ mb: 2 }}>
            Assign this device to a group for better organization
          </Typography>
          <FormControl fullWidth>
            <InputLabel>Select Group</InputLabel>
            <Select
              value={formData.groupId || ''}
              onChange={(e) => handleInputChange('groupId', e.target.value || null)}
              label="Select Group"
            >
              <MenuItem value="">
                <em>No Group</em>
              </MenuItem>
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
                    {group.description && (
                      <Typography variant="caption" color="text.secondary" sx={{ ml: 1 }}>
                        ({group.description})
                      </Typography>
                    )}
                  </Box>
                </MenuItem>
              ))}
            </Select>
          </FormControl>
        </Box>

        <Box sx={{ mb: 3 }}>
          <Typography variant="h6" gutterBottom>
            Custom Fields
          </Typography>
          <Typography variant="body2" color="textSecondary" sx={{ mb: 2 }}>
            Add custom information or notes for this device
          </Typography>

          {/* Existing custom fields */}
          <Box sx={{ mb: 2 }}>
            {Object.entries(formData.customFields).map(([key, value]) => (
              <Chip
                key={key}
                label={`${key}: ${value}`}
                onDelete={() => removeCustomField(key)}
                sx={{ mr: 1, mb: 1 }}
                color="primary"
                variant="outlined"
              />
            ))}
          </Box>

          {/* Add new custom field */}
          <Box sx={{ display: 'flex', gap: 1, alignItems: 'center' }}>
            <TextField
              label="Field Name"
              value={newCustomField.key}
              onChange={(e) => handleCustomFieldChange(e.target.value, newCustomField.value)}
              onKeyPress={handleKeyPress}
              size="small"
              sx={{ flex: 1 }}
              placeholder="e.g., Location, Owner, Notes"
            />
            <TextField
              label="Value"
              value={newCustomField.value}
              onChange={(e) => handleCustomFieldChange(newCustomField.key, e.target.value)}
              onKeyPress={handleKeyPress}
              size="small"
              sx={{ flex: 1 }}
              placeholder="e.g., Warehouse A, John Doe, Important device"
            />
            <IconButton
              onClick={addCustomField}
              color="primary"
              disabled={!newCustomField.key.trim() || !newCustomField.value.trim()}
            >
              <AddIcon />
            </IconButton>
          </Box>
        </Box>
      </DialogContent>
      <DialogActions>
        <Button onClick={onClose} disabled={loading}>
          Cancel
        </Button>
        <Button
          onClick={handleSave}
          variant="contained"
          disabled={loading || !formData.name.trim()}
          startIcon={loading ? <CircularProgress size={20} /> : null}
        >
          {loading ? 'Saving...' : 'Save Changes'}
        </Button>
      </DialogActions>
    </Dialog>
  );
};

export default DeviceEditDialog; 