// frontend/src/components/Layout.js

import React, { useState, useEffect } from 'react';
import { Outlet, useNavigate, useLocation } from 'react-router-dom';
import {
  AppBar,
  Box,
  CssBaseline,
  Divider,
  Drawer,
  IconButton,
  List,
  ListItem,
  ListItemButton,
  ListItemIcon,
  ListItemText,
  Toolbar,
  Typography,
  useTheme,
  useMediaQuery,
  Avatar,
  Menu,
  MenuItem,
  Badge,
  Chip,
  alpha,
  Tooltip
} from '@mui/material';
import {
  Menu as MenuIcon,
  Dashboard as DashboardIcon,
  Devices as DevicesIcon,
  Map as MapIcon,
  Settings as SettingsIcon,
  Notifications as NotificationsIcon,
  TableChart as TableChartIcon,
  LocationOn as LocationIcon,
  Science as ScienceIcon,
  AccountCircle as AccountIcon,
  Logout as LogoutIcon,
  Person as PersonIcon,
  Satellite as SatelliteIcon,
  LightMode as LightModeIcon,
  DarkMode as DarkModeIcon,
  People as PeopleIcon,
  Group as GroupIcon,
  Security as SecurityIcon
} from '@mui/icons-material';
import { useAuth } from '../contexts/AuthContext';
import { useData } from '../contexts/DataContext';
import { useTheme as useAppTheme } from '../contexts/ThemeContext';
import useAriaHiddenFix from '../hooks/useAriaHiddenFix';

const drawerWidth = 240; // Reduce drawer width

const Layout = ({ children }) => {
  const [mobileOpen, setMobileOpen] = useState(false);
  const [anchorEl, setAnchorEl] = useState(null);
  const theme = useTheme();
  const { isDarkMode, toggleTheme } = useAppTheme();
  const isMobile = useMediaQuery(theme.breakpoints.down('md'));
  const navigate = useNavigate();
  const location = useLocation();
  const { user, logout, hasMenuAccess } = useAuth();
  const { alerts } = useData();

  // Fix aria-hidden accessibility issue
  useAriaHiddenFix();

  useEffect(() => {
    const prefetch = () => {
      import('../pages/DataExport');
      import('../pages/DataSM');
      import('../pages/UserManagement');
      import('../pages/RoleManagement');
      import('../pages/Command');
      import('../pages/DeviceDetail');
    };
    const schedule = window.requestIdleCallback || ((cb) => setTimeout(cb, 1500));
    schedule(prefetch);
  }, []);

  const prefetchRoute = (path) => {
    const loaders = {
      '/export': () => import('../pages/DataExport'),
      '/data-sm': () => import('../pages/DataSM'),
      '/user-management': () => import('../pages/UserManagement'),
      '/role-management': () => import('../pages/RoleManagement'),
      '/command': () => import('../pages/Command'),
      '/command/archive-stat': () => import('../pages/Command'),
      '/command/command-center': () => import('../pages/Command'),
      '/command/broadcast': () => import('../pages/Command')
    };
    loaders[path]?.();
  };

  const handleDrawerToggle = () => {
    setMobileOpen(!mobileOpen);
  };

  const handleProfileMenuOpen = (event) => {
    setAnchorEl(event.currentTarget);
  };

  const handleProfileMenuClose = () => {
    setAnchorEl(null);
  };

  const handleLogout = async () => {
    try {
      await logout();
      handleProfileMenuClose();
    } catch (error) {
      console.error('Logout failed:', error);
    }
  };

  const menuItems = [
    { 
      text: 'Dashboard', 
      icon: <DashboardIcon />, 
      path: '/',
      description: 'System overview and analytics',
      permission: 'dashboard'
    },
    { 
      text: 'Devices', 
      icon: <DevicesIcon />, 
      path: '/devices',
      description: 'Manage connected devices',
      permission: 'devices'
    },
    { 
      text: 'Device Groups', 
      icon: <GroupIcon />, 
      path: '/device-groups',
      description: 'Organize devices into groups',
      permission: 'device-groups',
      adminOnly: true
    },
    { 
      text: 'Mapping', 
      icon: <MapIcon />, 
      path: '/mapping',
      description: 'Field mapping configuration',
      permission: 'mapping'
    },
    { 
      text: 'Tracking', 
      icon: <LocationIcon />, 
      path: '/tracking',
      description: 'Real-time location tracking',
      permission: 'tracking'
    },
    {
      text: 'Multi Tracking',
      icon: <MapIcon />,
      path: '/multi-tracking',
      description: 'Multi-device location tracking',
      permission: 'multi-tracking',
      adminOnly: false
    },
    { 
      text: 'Alerts', 
      icon: <NotificationsIcon />, 
      path: '/alerts',
      description: 'System alerts and notifications',
      permission: 'alerts',
      badge: alerts.filter(a => a.status === 'active').length
    },
    { 
      text: 'Settings', 
      icon: <SettingsIcon />, 
      path: '/settings',
      description: 'System configuration',
      permission: 'settings'
    },
    { 
      text: 'User Management', 
      icon: <PeopleIcon />, 
      path: '/user-management',
      description: 'Manage users and permissions',
      permission: 'user-management',
      adminOnly: true
    },
    { 
      text: 'Role Management', 
      icon: <SecurityIcon />, 
      path: '/role-management',
      description: 'Manage roles and permissions',
      permission: 'user-management',
      adminOnly: true
    },
    { 
      text: 'Data Export', 
      icon: <TableChartIcon />, 
      path: '/export',
      description: 'Export data and reports',
      permission: 'export'
    },
    { 
      text: 'Data SM', 
      icon: <ScienceIcon />, 
      path: '/data-sm',
      description: 'Sensor monitoring data export',
      permission: 'data-sm'
    },
    {
      text: 'Command',
      icon: <SatelliteIcon />,
      path: '/command/archive-stat',
      matchPrefix: '/command',
      description: 'Archive Stat, Command Center, and Broadcast',
      permission: 'devices'
    },
    { 
      text: 'Offline Demo', 
      icon: <ScienceIcon />, 
      path: '/demo',
      description: 'Offline functionality demo',
      permission: 'demo'
    }
  ];

  // Filter menu items based on user permissions
  const filteredMenuItems = menuItems.filter(item => {
    // Admin has access to everything
    if (user?.role === 'admin') {
      return true;
    }
    
    // Check admin-only items
    if (item.adminOnly && user?.role !== 'admin') {
      return false;
    }
    
    // Check menu access permissions for non-admin users
    if (item.permission && user?.role !== 'admin') {
      // Handle different permission structures
      if (user?.permissions?.menus) {
        if (typeof user.permissions.menus === 'object') {
          // New structure: permissions.menus[menuName].access
          return user.permissions.menus[item.permission]?.access === true;
        } else if (Array.isArray(user.permissions.menus)) {
          // Old structure: permissions.menus array
          return user.permissions.menus.includes(item.permission);
        }
      }
      
      // Fallback: check if menu name is in permissions array (legacy)
      if (Array.isArray(user?.permissions)) {
        return user.permissions.includes(item.permission);
      }
    }
    
    return true;
  });

  const drawer = (
    <Box sx={{ height: '100%', display: 'flex', flexDirection: 'column' }}>
      {/* Header */}
      <Box sx={{ 
        p: 2, 
        borderBottom: `1px solid ${theme.palette.divider}`,
        background: `linear-gradient(135deg, ${theme.palette.primary.main} 0%, ${theme.palette.primary.dark} 100%)`,
        color: 'white'
      }}>
        <Box sx={{ display: 'flex', alignItems: 'center', mb: 1 }}>
          <SatelliteIcon sx={{ fontSize: 24, mr: 1.5 }} />
          <Box>
            <Typography variant="h6" fontWeight="bold" sx={{ lineHeight: 1.2 }}>
              OHW
            </Typography>
            <Typography variant="caption" sx={{ opacity: 0.9 }}>
              Device Management System
            </Typography>
          </Box>
        </Box>
      </Box>
      
      {/* User Info */}
      {user && (
        <Box sx={{ 
          p: 2, 
          borderBottom: `1px solid ${theme.palette.divider}`,
          background: alpha(theme.palette.primary.main, 0.05)
        }}>
          <Box sx={{ display: 'flex', alignItems: 'center' }}>
            <Avatar 
              sx={{ 
                width: 36, 
                height: 36, 
                mr: 1.5,
                background: `linear-gradient(135deg, ${theme.palette.primary.main} 0%, ${theme.palette.secondary.main} 100%)`
              }}
            >
              <PersonIcon />
            </Avatar>
            <Box sx={{ flex: 1 }}>
              <Typography variant="subtitle2" fontWeight="600" color="text.primary">
                {user.name || user.username || 'User'}
              </Typography>
              <Typography variant="caption" color="text.secondary">
                {user.role || 'User'}
              </Typography>
            </Box>
          </Box>
        </Box>
      )}
      
      {/* Navigation */}
      <Box sx={{ flex: 1, overflow: 'auto' }}>
        <List sx={{ p: 1 }}>
          {filteredMenuItems.map((item) => {
            const isSelected = item.matchPrefix
              ? location.pathname.startsWith(item.matchPrefix)
              : location.pathname === item.path;
            
            return (
              <ListItem key={item.text} disablePadding sx={{ mb: 0.5 }}>
                <ListItemButton
                  selected={isSelected}
                  onMouseEnter={() => prefetchRoute(item.path)}
                  onClick={() => {
                    navigate(item.path);
                    if (isMobile) {
                      setMobileOpen(false);
                    }
                  }}
                  sx={{
                    borderRadius: 1.5,
                    py: 1,
                    px: 1.5,
                    '&.Mui-selected': {
                      backgroundColor: alpha(theme.palette.primary.main, 0.1),
                      color: theme.palette.primary.main,
                      '&:hover': {
                        backgroundColor: alpha(theme.palette.primary.main, 0.15),
                      },
                      '& .MuiListItemIcon-root': {
                        color: theme.palette.primary.main,
                      },
                    },
                    '&:hover': {
                      backgroundColor: alpha(theme.palette.primary.main, 0.05),
                    },
                  }}
                >
                  <ListItemIcon sx={{ 
                    minWidth: 32,
                    color: isSelected ? theme.palette.primary.main : theme.palette.text.secondary
                  }}>
                    {item.badge ? (
                      <Badge badgeContent={item.badge} color="error" max={99} size="small">
                        {item.icon}
                      </Badge>
                    ) : (
                      item.icon
                    )}
                  </ListItemIcon>
                  <Box sx={{ flex: 1 }}>
                    <ListItemText 
                      primary={item.text}
                      secondary={item.description}
                      primaryTypographyProps={{
                        fontWeight: isSelected ? 600 : 500,
                        fontSize: '0.8125rem'
                      }}
                      secondaryTypographyProps={{
                        fontSize: '0.6875rem',
                        color: theme.palette.text.secondary
                      }}
                    />
                  </Box>
                </ListItemButton>
              </ListItem>
            );
          })}
        </List>
      </Box>
    </Box>
  );

  return (
    <Box sx={{ display: 'flex', minHeight: '100vh' }}>
      <CssBaseline />
      <AppBar
        position="fixed"
        elevation={0}
        sx={{
          width: { md: `calc(100% - ${drawerWidth}px)` },
          ml: { md: `${drawerWidth}px` },
          backgroundColor: 'background.paper',
          borderBottom: `1px solid ${theme.palette.divider}`,
          backdropFilter: 'blur(8px)',
        }}
      >
        <Toolbar sx={{ minHeight: 56 }}>
          <IconButton
            color="inherit"
            aria-label="open drawer"
            edge="start"
            onClick={handleDrawerToggle}
            sx={{ mr: 2, display: { md: 'none' } }}
          >
            <MenuIcon />
          </IconButton>
          
          <Box sx={{ flexGrow: 1 }}>
            <Typography variant="h6" fontWeight="600" color="text.primary">
              {filteredMenuItems.find((item) => (
                item.matchPrefix
                  ? location.pathname.startsWith(item.matchPrefix)
                  : item.path === location.pathname
              ))?.text || 'Dashboard'}
            </Typography>
            <Typography variant="caption" color="text.secondary">
              {filteredMenuItems.find((item) => (
                item.matchPrefix
                  ? location.pathname.startsWith(item.matchPrefix)
                  : item.path === location.pathname
              ))?.description || 'System overview'}
            </Typography>
          </Box>
          
          {/* User Menu */}
          {user && (
            <Box sx={{ display: 'flex', alignItems: 'center', gap: 2 }}>
              {alerts.filter(a => a.status === 'active').length > 0 && (
                <Chip 
                  label={`${alerts.filter(a => a.status === 'active').length} Active Alerts`}
                  color="warning"
                  size="small"
                  variant="outlined"
                  onClick={() => navigate('/alerts')}
                  sx={{ 
                    fontWeight: 600,
                    cursor: 'pointer',
                    '&:hover': {
                      backgroundColor: alpha(theme.palette.warning.main, 0.1),
                    }
                  }}
                />
              )}
              <Tooltip title={isDarkMode ? 'Switch to Light Mode' : 'Switch to Dark Mode'}>
                <IconButton
                  color="inherit"
                  onClick={toggleTheme}
                  sx={{ 
                    border: `1px solid ${theme.palette.divider}`,
                    '&:hover': {
                      backgroundColor: alpha(theme.palette.primary.main, 0.05),
                    }
                  }}
                >
                  {isDarkMode ? <LightModeIcon /> : <DarkModeIcon />}
                </IconButton>
              </Tooltip>
              <IconButton
                color="inherit"
                onClick={handleProfileMenuOpen}
                sx={{ 
                  border: `1px solid ${theme.palette.divider}`,
                  '&:hover': {
                    backgroundColor: alpha(theme.palette.primary.main, 0.05),
                  }
                }}
              >
                <AccountIcon />
              </IconButton>
              <Menu
                anchorEl={anchorEl}
                open={Boolean(anchorEl)}
                onClose={handleProfileMenuClose}
                anchorOrigin={{
                  vertical: 'bottom',
                  horizontal: 'right',
                }}
                transformOrigin={{
                  vertical: 'top',
                  horizontal: 'right',
                }}
                PaperProps={{
                  elevation: 3,
                  sx: {
                    borderRadius: 2,
                    minWidth: 200,
                  }
                }}
              >
                <MenuItem 
                  onClick={() => { navigate('/settings'); handleProfileMenuClose(); }}
                  sx={{ py: 1.5 }}
                >
                  <ListItemIcon>
                    <SettingsIcon fontSize="small" />
                  </ListItemIcon>
                  Settings
                </MenuItem>
                <Divider />
                <MenuItem onClick={handleLogout} sx={{ py: 1.5 }}>
                  <ListItemIcon>
                    <LogoutIcon fontSize="small" />
                  </ListItemIcon>
                  Logout
                </MenuItem>
              </Menu>
            </Box>
          )}
        </Toolbar>
      </AppBar>
      
      <Box
        component="nav"
        sx={{ width: { md: drawerWidth }, flexShrink: { md: 0 } }}
      >
        <Drawer
          variant="temporary"
          open={mobileOpen}
          onClose={handleDrawerToggle}
          ModalProps={{
            keepMounted: true
          }}
          sx={{
            display: { xs: 'block', md: 'none' },
            '& .MuiDrawer-paper': {
              boxSizing: 'border-box',
              width: drawerWidth,
              border: 'none',
            }
          }}
        >
          {drawer}
        </Drawer>
        <Drawer
          variant="permanent"
          sx={{
            display: { xs: 'none', md: 'block' },
            '& .MuiDrawer-paper': {
              boxSizing: 'border-box',
              width: drawerWidth,
              border: 'none',
            }
          }}
          open
        >
          {drawer}
        </Drawer>
      </Box>
      
      <Box
        component="main"
        sx={{
          flexGrow: 1,
          p: { xs: 2, md: 4 },
          width: { md: `calc(100% - ${drawerWidth}px)` },
          mt: '70px',
          backgroundColor: 'background.default',
          minHeight: 'calc(100vh - 70px)'
        }}
      >
        {children || <Outlet />}
      </Box>
    </Box>
  );
};

export default Layout;
