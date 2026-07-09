import React, { useState, useEffect, useMemo, useCallback } from 'react';
import {
  Container,
  Grid,
  Paper,
  Typography,
  Button,
  Table,
  TableBody,
  TableCell,
  TableContainer,
  TableHead,
  TableRow,
  IconButton,
  Dialog,
  DialogTitle,
  DialogContent,
  DialogActions,
  TextField,
  FormControl,
  InputLabel,
  Select,
  MenuItem,
  Chip,
  Box,
  Tabs,
  Tab,
  Card,
  CardContent,
  Alert,
  Switch,
  FormControlLabel,
  Tooltip,
  Avatar,
  Divider,
  List,
  ListItem,
  ListItemText,
  ListItemSecondaryAction,
  Checkbox,
  FormGroup
} from '@mui/material';
import {
  Add as AddIcon,
  Edit as EditIcon,
  Delete as DeleteIcon,
  Person as PersonIcon,
  Group as GroupIcon,
  Devices as DevicesIcon,
  AccessTime as AccessTimeIcon,
  Security as SecurityIcon
} from '@mui/icons-material';
import { useAuth } from '../contexts/AuthContext';
import { BASE_URL, authenticatedFetch } from '../services/api';
import { 
  apiFetchUserDeviceGroupAccess, 
  apiFetchUserDeviceGroupAccessByUser, 
  apiGrantUserDeviceGroupAccess, 
  apiUpdateUserDeviceGroupAccess, 
  apiRevokeUserDeviceGroupAccess,
  apiBulkGrantUserDeviceGroupAccess
} from '../services/api';

// Memoized components to reduce re-renders
const UserRow = React.memo(({ user, currentUser, onEdit, onDelete, onDeviceAccess, onGroupAccess, roles }) => (
  <TableRow key={user.id}>
    <TableCell>
      <Box sx={{ display: 'flex', alignItems: 'center' }}>
        <Avatar sx={{ mr: 2 }}>
          <PersonIcon />
        </Avatar>
        <Box>
          <Typography variant="subtitle2">
            {user.firstName} {user.lastName}
          </Typography>
          <Typography variant="body2" color="text.secondary">
            @{user.username}
          </Typography>
        </Box>
      </Box>
    </TableCell>
    <TableCell>
      <Chip
        label={
          user.roleId 
            ? (roles.find(r => r.value === user.roleId.toString())?.label || 'Custom Role')
            : (user.role === 'admin' ? 'Administrator' : user.role === 'manager' ? 'Manager' : user.role === 'operator' ? 'Operator' : 'Viewer')
        }
        color={
          user.roleId 
            ? 'primary'
            : (user.role === 'admin' ? 'error' : user.role === 'manager' ? 'warning' : user.role === 'operator' ? 'info' : 'default')
        }
        size="small"
      />
    </TableCell>
    <TableCell>{user.email}</TableCell>
    <TableCell>
      <Chip
        label={user.isActive ? 'Active' : 'Inactive'}
        color={user.isActive ? 'success' : 'default'}
        size="small"
      />
    </TableCell>
    <TableCell>
      {user.lastLogin ? new Date(user.lastLogin).toLocaleDateString() : 'Never'}
    </TableCell>
    <TableCell>
      <Box sx={{ display: 'flex', gap: 1 }}>
        <Tooltip title="Edit User">
          <IconButton size="small" onClick={() => onEdit(user)}>
            <EditIcon />
          </IconButton>
        </Tooltip>
        <Tooltip title="Manage Device Group Access">
          <IconButton size="small" onClick={() => onGroupAccess(user)}>
            <GroupIcon />
          </IconButton>
        </Tooltip>
        <Tooltip title="Grant Individual Device Access">
          <IconButton size="small" onClick={() => onDeviceAccess(user)}>
            <DevicesIcon />
          </IconButton>
        </Tooltip>
        {user.id !== currentUser?.id && (
          <Tooltip title="Delete User">
            <IconButton size="small" onClick={() => onDelete(user.id)}>
              <DeleteIcon />
            </IconButton>
          </Tooltip>
        )}
      </Box>
    </TableCell>
  </TableRow>
));

const GroupCard = React.memo(({ group, onEdit, onDelete, onManageDevices }) => (
  <Grid item xs={12} md={6} lg={4} key={group.id}>
    <Card>
      <CardContent>
        <Box sx={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', mb: 2 }}>
          <Box sx={{ display: 'flex', alignItems: 'center' }}>
            <Box
              sx={{
                width: 16,
                height: 16,
                borderRadius: '50%',
                backgroundColor: group.color,
                mr: 1
              }}
            />
            <Typography variant="h6">{group.name}</Typography>
          </Box>
          <Box sx={{ display: 'flex', gap: 1 }}>
            <IconButton size="small" onClick={() => onEdit(group)}>
              <EditIcon />
            </IconButton>
            <IconButton size="small" onClick={() => onDelete(group.id)}>
              <DeleteIcon />
            </IconButton>
          </Box>
        </Box>
        <Typography variant="body2" color="text.secondary" sx={{ mb: 2 }}>
          {group.description || 'No description'}
        </Typography>
        <Box sx={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', mb: 1 }}>
          <Typography variant="caption" color="text.secondary">
            Created by {group.creator?.firstName} {group.creator?.lastName}
          </Typography>
          <Typography variant="caption" color="text.secondary">
            {group.devices?.length || 0} devices
          </Typography>
        </Box>
        <Button
          variant="outlined"
          size="small"
          startIcon={<DevicesIcon />}
          onClick={() => onManageDevices(group)}
          fullWidth
        >
          Manage Devices
        </Button>
      </CardContent>
    </Card>
  </Grid>
));

const UserManagement = () => {
  const { user: currentUser } = useAuth();
  const [activeTab, setActiveTab] = useState(0);
  const [data, setData] = useState({ users: [], deviceGroups: [], devices: [], userGroupAccess: [] });
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [success, setSuccess] = useState('');

  // Dialog states - consolidated to reduce memory
  const [dialogs, setDialogs] = useState({
    user: false,
    group: false,
    deviceAccess: false,
    groupAccess: false,
    groupManagement: false
  });

  const [selectedItems, setSelectedItems] = useState({
    user: null,
    group: null,
    userForGroupAccess: null
  });

  const [forms, setForms] = useState({
    user: {
      username: '',
      email: '',
      password: '',
      firstName: '',
      lastName: '',
      role: 'viewer',
      permissions: { menus: ['dashboard'], devices: [], deviceGroups: [] }
    },
    group: { name: '', description: '', color: '#1976d2' },
    deviceAccess: { deviceId: '', accessLevel: 'read', expiresAt: '' },
    groupAccess: { 
      groupId: '', 
      accessLevel: 'read', 
      expiresAt: '', 
      notes: '',
      selectedGroups: []
    },
    groupDevice: { deviceId: '' }
  });

  // Memoized constants
  const availableMenus = useMemo(() => [
    { value: 'dashboard', label: 'Dashboard' },
    { value: 'devices', label: 'Devices' },
    { value: 'mapping', label: 'Mapping' },
    { value: 'tracking', label: 'Tracking' },
    { value: 'alerts', label: 'Alerts' },
    { value: 'settings', label: 'Settings' },
    { value: 'export', label: 'Data Export' },
    { value: 'demo', label: 'Offline Demo' },
    { value: 'user-management', label: 'User Management' }
  ], []);

  // Fetch roles from API
  const [roles, setRoles] = useState([
    { value: 'admin', label: 'Administrator', color: 'error' },
    { value: 'manager', label: 'Manager', color: 'warning' },
    { value: 'operator', label: 'Operator', color: 'info' },
    { value: 'viewer', label: 'Viewer', color: 'default' }
  ]);

  // Load roles from API
  const loadRoles = useCallback(async () => {
    try {
      const response = await authenticatedFetch('/api/roles');
      if (response.ok) {
        const apiRoles = await response.json();
        // Combine template roles with custom roles
        const templateRoles = [
          { value: 'admin', label: 'Administrator', color: 'error' },
          { value: 'manager', label: 'Manager', color: 'warning' },
          { value: 'operator', label: 'Operator', color: 'info' },
          { value: 'viewer', label: 'Viewer', color: 'default' }
        ];
        
        const customRoles = apiRoles.map(role => ({
          value: role.id.toString(), // Use role ID as value for custom roles
          label: role.name,
          color: 'primary',
          isCustom: true
        }));
        
        setRoles([...templateRoles, ...customRoles]);
      }
    } catch (error) {
      console.error('Error loading roles:', error);
    }
  }, []);

  useEffect(() => {
    loadRoles();
  }, [loadRoles]);

  const accessLevels = useMemo(() => [
    { value: 'read', label: 'Read Only', color: 'default' },
    { value: 'write', label: 'Read & Write', color: 'info' },
    { value: 'admin', label: 'Full Access', color: 'error' }
  ], []);

  // Helper functions
  const fetchUsers = useCallback(async () => {
    try {
      const response = await fetch(`${BASE_URL}/api/users`, {
        credentials: 'include'
      });
      
      if (response.ok) {
        const users = await response.json();
        return { ok: true, data: users };
      } else {
        console.error('Failed to fetch users:', response.status);
        return { ok: false, data: [] };
      }
    } catch (error) {
      console.error('Error fetching users:', error);
      return { ok: false, data: [] };
    }
  }, []);

  // Data loading
  const loadData = useCallback(async () => {
    try {
      setLoading(true);
      setError('');
      
      const [usersRes, groupsRes, devicesRes, accessRes] = await Promise.all([
        fetchUsers(),
        authenticatedFetch(`/api/device-groups`).catch(err => ({ ok: false, error: err })),
        authenticatedFetch(`/api/devices`).catch(err => ({ ok: false, error: err })),
        apiFetchUserDeviceGroupAccess().catch(err => ({ ok: false, error: err }))
      ]);

      const newData = { users: [], deviceGroups: [], devices: [], userGroupAccess: [] };

      if (usersRes.ok) {
        newData.users = usersRes.data;
      }
      
      if (groupsRes.ok) {
        newData.deviceGroups = await groupsRes.json();
      }
      
      if (devicesRes.ok) {
        newData.devices = await devicesRes.json();
      }

      if (accessRes && !accessRes.error) {
        newData.userGroupAccess = accessRes;
      }

      setData(newData);
    } catch (error) {
      console.error('Error loading data:', error);
      setError('Failed to load data. Please refresh the page.');
    } finally {
      setLoading(false);
    }
  }, [fetchUsers]);

  useEffect(() => {
    loadData();
  }, [loadData]);

  // Form handlers
  const resetForm = useCallback((formType) => {
    const defaultForms = {
      user: {
        username: '',
        email: '',
        password: '',
        firstName: '',
        lastName: '',
        role: 'viewer',
        permissions: { menus: ['dashboard'], devices: [], deviceGroups: [] }
      },
      group: { name: '', description: '', color: '#1976d2' },
      deviceAccess: { deviceId: '', accessLevel: 'read', expiresAt: '' },
      groupAccess: { 
        groupId: '', 
        accessLevel: 'read', 
        expiresAt: '', 
        notes: '',
        selectedGroups: []
      },
      groupDevice: { deviceId: '' }
    };

    setForms(prev => ({
      ...prev,
      [formType]: defaultForms[formType]
    }));
  }, []);

  const openDialog = useCallback((dialogType, item = null) => {
    setSelectedItems(prev => ({
      ...prev,
      [dialogType === 'user' ? 'user' : dialogType === 'group' ? 'group' : 'userForGroupAccess']: item
    }));

    if (item) {
      if (dialogType === 'user') {
        setForms(prev => ({
          ...prev,
          user: {
            username: item.username,
            email: item.email,
            password: '',
            firstName: item.firstName,
            lastName: item.lastName,
            role: item.roleId ? item.roleId.toString() : item.role, // Use roleId for custom roles, role for template roles
            permissions: item.permissions || { menus: ['dashboard'], devices: [], deviceGroups: [] }
          }
        }));
      } else if (dialogType === 'group') {
        setForms(prev => ({
          ...prev,
          group: {
            name: item.name,
            description: item.description || '',
            color: item.color
          }
        }));
      }
    } else {
      resetForm(dialogType === 'user' ? 'user' : 'group');
    }

    setDialogs(prev => ({ ...prev, [dialogType]: true }));
  }, [resetForm]);

  const closeDialog = useCallback((dialogType) => {
    setDialogs(prev => ({ ...prev, [dialogType]: false }));
    setSelectedItems(prev => ({
      ...prev,
      [dialogType === 'user' ? 'user' : dialogType === 'group' ? 'group' : 'userForGroupAccess']: null
    }));
    resetForm(dialogType === 'user' ? 'user' : 'group');
  }, [resetForm]);

  // User form handlers
  const handleUserSubmit = useCallback(async () => {
    try {
      const url = selectedItems.user ? `${BASE_URL}/api/users/${selectedItems.user.id}` : `${BASE_URL}/api/users`;
      const method = selectedItems.user ? 'PUT' : 'POST';
      
      // Prepare user data based on role type
      const userData = { ...forms.user };
      
      // Check if the selected role is a custom role (has isCustom flag)
      const selectedRole = roles.find(r => r.value === forms.user.role);
      if (selectedRole && selectedRole.isCustom) {
        // For custom roles, send roleId and set role to null
        userData.roleId = parseInt(forms.user.role);
        userData.role = null; // Clear the role enum
      } else {
        // For template roles, send role and clear roleId
        userData.roleId = null; // Clear any existing roleId
      }
      
      const response = await authenticatedFetch(url, {
        method,
        body: JSON.stringify(userData)
      });

      if (response.ok) {
        setSuccess(selectedItems.user ? 'User updated successfully' : 'User created successfully');
        closeDialog('user');
        loadData();
      } else {
        const error = await response.json();
        setError(error.error || 'Failed to save user');
      }
    } catch (error) {
      setError('Failed to save user');
    }
  }, [selectedItems.user, forms.user, roles, closeDialog, loadData]);

  // Group form handlers
  const handleGroupSubmit = useCallback(async () => {
    try {
      const url = selectedItems.group ? `${BASE_URL}/api/device-groups/${selectedItems.group.id}` : `${BASE_URL}/api/device-groups`;
      const method = selectedItems.group ? 'PUT' : 'POST';
      
      const response = await authenticatedFetch(url, {
        method,
        body: JSON.stringify(forms.group)
      });

      if (response.ok) {
        setSuccess(selectedItems.group ? 'Group updated successfully' : 'Group created successfully');
        closeDialog('group');
        loadData();
      } else {
        const error = await response.json();
        setError(error.error || 'Failed to save group');
      }
    } catch (error) {
      setError('Failed to save group');
    }
  }, [selectedItems.group, forms.group, closeDialog, loadData]);

  // Device Group Access handlers
  const handleGroupAccessSubmit = useCallback(async () => {
    try {
      const { selectedGroups, accessLevel, expiresAt, notes } = forms.groupAccess;
      
      if (selectedGroups.length === 0) {
        setError('Please select at least one device group');
        return;
      }

      const results = [];
      const errors = [];

      for (const groupId of selectedGroups) {
        try {
          await apiGrantUserDeviceGroupAccess({
            userId: selectedItems.userForGroupAccess.id,
            groupId,
            accessLevel,
            expiresAt: expiresAt || null,
            notes: notes || null
          });
          results.push({ groupId, success: true });
        } catch (error) {
          errors.push({ groupId, error: error.message });
        }
      }

      if (results.length > 0) {
        setSuccess(`Successfully granted access to ${results.length} group(s)`);
        if (errors.length > 0) {
          setError(`Failed to grant access to ${errors.length} group(s)`);
        }
        closeDialog('groupAccess');
        loadData();
      } else {
        setError('Failed to grant access to any groups');
      }
    } catch (error) {
      setError('Failed to grant group access');
    }
  }, [forms.groupAccess, selectedItems.userForGroupAccess, closeDialog, loadData]);

  // Delete handlers
  const handleDeleteUser = useCallback(async (userId) => {
    if (!window.confirm('Are you sure you want to delete this user?')) return;
    
    try {
      const response = await authenticatedFetch(`/api/users/${userId}`, {
        method: 'DELETE'
      });

      if (response.ok) {
        setSuccess('User deleted successfully');
        loadData();
      } else {
        setError('Failed to delete user');
      }
    } catch (error) {
      setError('Failed to delete user');
    }
  }, [loadData]);

  const handleDeleteGroup = useCallback(async (groupId) => {
    if (!window.confirm('Are you sure you want to delete this group?')) return;
    
    try {
      const response = await authenticatedFetch(`/api/device-groups/${groupId}`, {
        method: 'DELETE'
      });

      if (response.ok) {
        setSuccess('Group deleted successfully');
        loadData();
      } else {
        setError('Failed to delete group');
      }
    } catch (error) {
      setError('Failed to delete group');
    }
  }, [loadData]);

  const handleRevokeGroupAccess = useCallback(async (accessId) => {
    if (!window.confirm('Are you sure you want to revoke this access?')) return;
    
    try {
      await apiRevokeUserDeviceGroupAccess(accessId);
      setSuccess('Access revoked successfully');
      loadData();
    } catch (error) {
      setError('Failed to revoke access');
    }
  }, [loadData]);

  // Get user's current group access
  const getUserGroupAccess = useCallback((userId) => {
    return data.userGroupAccess.filter(access => access.userId === userId);
  }, [data.userGroupAccess]);

  if (loading) {
    return (
      <Container maxWidth="xl">
        <Typography>Loading...</Typography>
      </Container>
    );
  }

  return (
    <Container maxWidth="xl">
      <Box sx={{ mb: 4 }}>
        <Typography variant="h4" gutterBottom>
          User Management
        </Typography>
        <Typography variant="body1" color="text.secondary">
          Manage users, permissions, and device access
        </Typography>
      </Box>

      {error && (
        <Alert severity="error" sx={{ mb: 2 }} onClose={() => setError('')}>
          {error}
        </Alert>
      )}

      {success && (
        <Alert severity="success" sx={{ mb: 2 }} onClose={() => setSuccess('')}>
          {success}
        </Alert>
      )}

      <Paper sx={{ mb: 3 }}>
        <Tabs value={activeTab} onChange={(e, newValue) => setActiveTab(newValue)}>
          <Tab label="Users" />
          <Tab label="Device Groups" />
          <Tab label="Group Access Management" />
        </Tabs>
      </Paper>

      {/* Users Tab */}
      {activeTab === 0 && (
        <Paper>
          <Box sx={{ p: 3, display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
            <Typography variant="h6">Users</Typography>
            <Button
              variant="contained"
              startIcon={<AddIcon />}
              onClick={() => openDialog('user')}
            >
              Add User
            </Button>
          </Box>
          
          <TableContainer>
            <Table>
              <TableHead>
                <TableRow>
                  <TableCell>User</TableCell>
                  <TableCell>Role</TableCell>
                  <TableCell>Email</TableCell>
                  <TableCell>Status</TableCell>
                  <TableCell>Last Login</TableCell>
                  <TableCell>Actions</TableCell>
                </TableRow>
              </TableHead>
              <TableBody>
                {data.users.map((user) => (
                  <UserRow
                    key={user.id}
                    user={user}
                    currentUser={currentUser}
                    onEdit={(user) => openDialog('user', user)}
                    onDelete={handleDeleteUser}
                    onDeviceAccess={(user) => openDialog('deviceAccess', user)}
                    onGroupAccess={(user) => openDialog('groupAccess', user)}
                    roles={roles}
                  />
                ))}
              </TableBody>
            </Table>
          </TableContainer>
        </Paper>
      )}

      {/* Device Groups Tab */}
      {activeTab === 1 && (
        <Paper>
          <Box sx={{ p: 3, display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
            <Typography variant="h6">Device Groups</Typography>
            <Button
              variant="contained"
              startIcon={<AddIcon />}
              onClick={() => openDialog('group')}
            >
              Add Group
            </Button>
          </Box>
          
          <Grid container spacing={3} sx={{ p: 3 }}>
            {data.deviceGroups.map((group) => (
              <GroupCard
                key={group.id}
                group={group}
                onEdit={(group) => openDialog('group', group)}
                onDelete={handleDeleteGroup}
                onManageDevices={(group) => openDialog('groupManagement', group)}
              />
            ))}
          </Grid>
        </Paper>
      )}

      {/* Group Access Management Tab */}
      {activeTab === 2 && (
        <Paper>
          <Box sx={{ p: 3 }}>
            <Typography variant="h6" gutterBottom>
              Device Group Access Management
            </Typography>
            <Typography variant="body2" color="text.secondary" sx={{ mb: 3 }}>
              Manage which users have access to which device groups
            </Typography>
            
            <TableContainer>
              <Table>
                <TableHead>
                  <TableRow>
                    <TableCell>User</TableCell>
                    <TableCell>Device Group</TableCell>
                    <TableCell>Access Level</TableCell>
                    <TableCell>Granted By</TableCell>
                    <TableCell>Expires</TableCell>
                    <TableCell>Actions</TableCell>
                  </TableRow>
                </TableHead>
                <TableBody>
                  {data.userGroupAccess.map((access) => (
                    <TableRow key={access.id}>
                      <TableCell>
                        <Box sx={{ display: 'flex', alignItems: 'center' }}>
                          <Avatar sx={{ mr: 2, width: 32, height: 32 }}>
                            <PersonIcon />
                          </Avatar>
                          <Box>
                            <Typography variant="subtitle2">
                              {access.user?.firstName} {access.user?.lastName}
                            </Typography>
                            <Typography variant="caption" color="text.secondary">
                              @{access.user?.username}
                            </Typography>
                          </Box>
                        </Box>
                      </TableCell>
                      <TableCell>
                        <Box sx={{ display: 'flex', alignItems: 'center' }}>
                          <Box
                            sx={{
                              width: 12,
                              height: 12,
                              borderRadius: '50%',
                              backgroundColor: access.group?.color,
                              mr: 1
                            }}
                          />
                          {access.group?.name}
                        </Box>
                      </TableCell>
                      <TableCell>
                        <Chip
                          label={access.accessLevel}
                          size="small"
                          color={access.accessLevel === 'admin' ? 'error' : access.accessLevel === 'write' ? 'info' : 'default'}
                        />
                      </TableCell>
                      <TableCell>
                        {access.grantedByUser?.firstName} {access.grantedByUser?.lastName}
                      </TableCell>
                      <TableCell>
                        {access.expiresAt ? new Date(access.expiresAt).toLocaleDateString() : 'Never'}
                      </TableCell>
                      <TableCell>
                        <Tooltip title="Revoke Access">
                          <IconButton
                            size="small"
                            color="error"
                            onClick={() => handleRevokeGroupAccess(access.id)}
                          >
                            <DeleteIcon />
                          </IconButton>
                        </Tooltip>
                      </TableCell>
                    </TableRow>
                  ))}
                </TableBody>
              </Table>
            </TableContainer>
          </Box>
        </Paper>
      )}

      {/* User Dialog */}
      <Dialog open={dialogs.user} onClose={() => closeDialog('user')} maxWidth="md" fullWidth>
        <DialogTitle>
          {selectedItems.user ? 'Edit User' : 'Add New User'}
        </DialogTitle>
        <DialogContent>
          <Grid container spacing={2} sx={{ mt: 1 }}>
            <Grid item xs={12} sm={6}>
              <TextField
                fullWidth
                label="Username"
                value={forms.user.username}
                onChange={(e) => setForms(prev => ({ ...prev, user: { ...prev.user, username: e.target.value } }))}
              />
            </Grid>
            <Grid item xs={12} sm={6}>
              <TextField
                fullWidth
                label="Email"
                type="email"
                value={forms.user.email}
                onChange={(e) => setForms(prev => ({ ...prev, user: { ...prev.user, email: e.target.value } }))}
              />
            </Grid>
            <Grid item xs={12} sm={6}>
              <TextField
                fullWidth
                label="First Name"
                value={forms.user.firstName}
                onChange={(e) => setForms(prev => ({ ...prev, user: { ...prev.user, firstName: e.target.value } }))}
              />
            </Grid>
            <Grid item xs={12} sm={6}>
              <TextField
                fullWidth
                label="Last Name"
                value={forms.user.lastName}
                onChange={(e) => setForms(prev => ({ ...prev, user: { ...prev.user, lastName: e.target.value } }))}
              />
            </Grid>
            <Grid item xs={12} sm={6}>
              <FormControl fullWidth>
                <InputLabel>Role</InputLabel>
                <Select
                  value={forms.user.role}
                  onChange={(e) => setForms(prev => ({ ...prev, user: { ...prev.user, role: e.target.value } }))}
                  label="Role"
                >
                  {roles.map((role) => (
                    <MenuItem key={role.value} value={role.value}>
                      {role.label}
                    </MenuItem>
                  ))}
                </Select>
              </FormControl>
            </Grid>
            <Grid item xs={12} sm={6}>
              <TextField
                fullWidth
                label="Password"
                type="password"
                value={forms.user.password}
                onChange={(e) => setForms(prev => ({ ...prev, user: { ...prev.user, password: e.target.value } }))}
                helperText={selectedItems.user ? 'Leave blank to keep current password' : ''}
              />
            </Grid>
          </Grid>
        </DialogContent>
        <DialogActions>
          <Button onClick={() => closeDialog('user')}>Cancel</Button>
          <Button onClick={handleUserSubmit} variant="contained">
            {selectedItems.user ? 'Update' : 'Create'}
          </Button>
        </DialogActions>
      </Dialog>

      {/* Group Dialog */}
      <Dialog open={dialogs.group} onClose={() => closeDialog('group')} maxWidth="sm" fullWidth>
        <DialogTitle>
          {selectedItems.group ? 'Edit Device Group' : 'Add New Device Group'}
        </DialogTitle>
        <DialogContent>
          <Grid container spacing={2} sx={{ mt: 1 }}>
            <Grid item xs={12}>
              <TextField
                fullWidth
                label="Group Name"
                value={forms.group.name}
                onChange={(e) => setForms(prev => ({ ...prev, group: { ...prev.group, name: e.target.value } }))}
              />
            </Grid>
            <Grid item xs={12}>
              <TextField
                fullWidth
                label="Description"
                multiline
                rows={3}
                value={forms.group.description}
                onChange={(e) => setForms(prev => ({ ...prev, group: { ...prev.group, description: e.target.value } }))}
              />
            </Grid>
            <Grid item xs={12}>
              <TextField
                fullWidth
                label="Color"
                type="color"
                value={forms.group.color}
                onChange={(e) => setForms(prev => ({ ...prev, group: { ...prev.group, color: e.target.value } }))}
              />
            </Grid>
          </Grid>
        </DialogContent>
        <DialogActions>
          <Button onClick={() => closeDialog('group')}>Cancel</Button>
          <Button onClick={handleGroupSubmit} variant="contained">
            {selectedItems.group ? 'Update' : 'Create'}
          </Button>
        </DialogActions>
      </Dialog>

      {/* Group Access Dialog */}
      <Dialog open={dialogs.groupAccess} onClose={() => closeDialog('groupAccess')} maxWidth="md" fullWidth>
        <DialogTitle>
          Manage Device Group Access - {selectedItems.userForGroupAccess?.firstName} {selectedItems.userForGroupAccess?.lastName}
        </DialogTitle>
        <DialogContent>
          <Box sx={{ mt: 2 }}>
            <Typography variant="h6" gutterBottom>
              Current Access
            </Typography>
            <List dense>
              {getUserGroupAccess(selectedItems.userForGroupAccess?.id).map((access) => (
                <ListItem key={access.id}>
                  <ListItemText
                    primary={
                      <Box sx={{ display: 'flex', alignItems: 'center' }}>
                        <Box
                          sx={{
                            width: 12,
                            height: 12,
                            borderRadius: '50%',
                            backgroundColor: access.group?.color,
                            mr: 1
                          }}
                        />
                        {access.group?.name}
                      </Box>
                    }
                    secondary={`${access.accessLevel} access - Granted by ${access.grantedByUser?.firstName} ${access.grantedByUser?.lastName}`}
                  />
                  <ListItemSecondaryAction>
                    <Tooltip title="Revoke Access">
                      <IconButton
                        edge="end"
                        size="small"
                        color="error"
                        onClick={() => handleRevokeGroupAccess(access.id)}
                      >
                        <DeleteIcon />
                      </IconButton>
                    </Tooltip>
                  </ListItemSecondaryAction>
                </ListItem>
              ))}
              {getUserGroupAccess(selectedItems.userForGroupAccess?.id).length === 0 && (
                <ListItem>
                  <ListItemText
                    primary="No device group access"
                    secondary="This user has no access to any device groups"
                  />
                </ListItem>
              )}
            </List>

            <Divider sx={{ my: 3 }} />

            <Typography variant="h6" gutterBottom>
              Grant New Access
            </Typography>
            
            <Grid container spacing={2}>
              <Grid item xs={12}>
                <FormControl fullWidth>
                  <InputLabel>Access Level</InputLabel>
                  <Select
                    value={forms.groupAccess.accessLevel}
                    onChange={(e) => setForms(prev => ({ 
                      ...prev, 
                      groupAccess: { ...prev.groupAccess, accessLevel: e.target.value } 
                    }))}
                    label="Access Level"
                  >
                    {accessLevels.map((level) => (
                      <MenuItem key={level.value} value={level.value}>
                        {level.label}
                      </MenuItem>
                    ))}
                  </Select>
                </FormControl>
              </Grid>
              
              <Grid item xs={12}>
                <TextField
                  fullWidth
                  label="Expires At (Optional)"
                  type="datetime-local"
                  value={forms.groupAccess.expiresAt}
                  onChange={(e) => setForms(prev => ({ 
                    ...prev, 
                    groupAccess: { ...prev.groupAccess, expiresAt: e.target.value } 
                  }))}
                  InputLabelProps={{ shrink: true }}
                />
              </Grid>
              
              <Grid item xs={12}>
                <TextField
                  fullWidth
                  label="Notes (Optional)"
                  multiline
                  rows={2}
                  value={forms.groupAccess.notes}
                  onChange={(e) => setForms(prev => ({ 
                    ...prev, 
                    groupAccess: { ...prev.groupAccess, notes: e.target.value } 
                  }))}
                />
              </Grid>
              
              <Grid item xs={12}>
                <Typography variant="subtitle2" gutterBottom>
                  Select Device Groups
                </Typography>
                <FormGroup>
                  {data.deviceGroups
                    .filter(group => !getUserGroupAccess(selectedItems.userForGroupAccess?.id)
                      .some(access => access.groupId === group.id))
                    .map((group) => (
                      <FormControlLabel
                        key={group.id}
                        control={
                          <Checkbox
                            checked={forms.groupAccess.selectedGroups.includes(group.id)}
                            onChange={(e) => {
                              const newSelected = e.target.checked
                                ? [...forms.groupAccess.selectedGroups, group.id]
                                : forms.groupAccess.selectedGroups.filter(id => id !== group.id);
                              setForms(prev => ({
                                ...prev,
                                groupAccess: { ...prev.groupAccess, selectedGroups: newSelected }
                              }));
                            }}
                          />
                        }
                        label={
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
                        }
                      />
                    ))}
                </FormGroup>
              </Grid>
            </Grid>
          </Box>
        </DialogContent>
        <DialogActions>
          <Button onClick={() => closeDialog('groupAccess')}>Cancel</Button>
          <Button 
            onClick={handleGroupAccessSubmit} 
            variant="contained"
            disabled={forms.groupAccess.selectedGroups.length === 0}
          >
            Grant Access
          </Button>
        </DialogActions>
      </Dialog>
    </Container>
  );
};

export default UserManagement; 