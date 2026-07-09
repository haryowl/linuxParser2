const express = require('express');
const router = express.Router();
const { Role, User } = require('../models');
const { requireAuth } = require('./auth');
const logger = require('../utils/logger');

// Middleware to check if user is admin
const requireAdmin = (req, res, next) => {
  if (req.user.role !== 'admin') {
    return res.status(403).json({ error: 'Admin access required' });
  }
  next();
};

// Get all roles
router.get('/', requireAuth, requireAdmin, async (req, res) => {
  try {
    const roles = await Role.findAll({
      include: [
        {
          model: User,
          as: 'creator',
          attributes: ['id', 'username', 'firstName', 'lastName']
        },
        {
          model: User,
          as: 'users',
          attributes: ['id', 'username', 'firstName', 'lastName'],
          where: { isActive: true },
          required: false
        }
      ],
      order: [['createdAt', 'DESC']]
    });
    
    res.json(roles);
  } catch (error) {
    logger.error('Error fetching roles:', error);
    res.status(500).json({ error: 'Internal server error' });
  }
});

// Get single role
router.get('/:id', requireAuth, requireAdmin, async (req, res) => {
  try {
    const roleId = parseInt(req.params.id);
    
    const role = await Role.findByPk(roleId, {
      include: [
        {
          model: User,
          as: 'creator',
          attributes: ['id', 'username', 'firstName', 'lastName']
        },
        {
          model: User,
          as: 'users',
          attributes: ['id', 'username', 'firstName', 'lastName', 'isActive'],
          required: false
        }
      ]
    });
    
    if (!role) {
      return res.status(404).json({ error: 'Role not found' });
    }
    
    res.json(role);
  } catch (error) {
    logger.error('Error fetching role:', error);
    res.status(500).json({ error: 'Internal server error' });
  }
});

// Create new role
router.post('/', requireAuth, requireAdmin, async (req, res) => {
  try {
    const { name, description, permissions } = req.body;

    if (!name) {
      return res.status(400).json({ error: 'Role name is required' });
    }

    // Check if role name already exists
    const existingRole = await Role.findOne({
      where: { name }
    });

    if (existingRole) {
      return res.status(400).json({ error: 'Role name already exists' });
    }

    const role = await Role.create({
      name,
      description,
      permissions: permissions || {},
      createdBy: req.user.userId
    });

    logger.info('Role created successfully', { roleId: role.id, createdBy: req.user.userId });
    res.status(201).json(role);
  } catch (error) {
    logger.error('Error creating role:', error);
    res.status(500).json({ error: 'Internal server error' });
  }
});

// Update role
router.put('/:id', requireAuth, requireAdmin, async (req, res) => {
  try {
    const roleId = parseInt(req.params.id);
    const { name, description, permissions, isActive } = req.body;

    const role = await Role.findByPk(roleId);
    if (!role) {
      return res.status(404).json({ error: 'Role not found' });
    }

    // Prevent modification of system roles
    if (role.isSystem) {
      return res.status(400).json({ error: 'System roles cannot be modified' });
    }

    // Check if new name conflicts with existing role
    if (name && name !== role.name) {
      const existingRole = await Role.findOne({
        where: { name, id: { [require('sequelize').Op.ne]: roleId } }
      });

      if (existingRole) {
        return res.status(400).json({ error: 'Role name already exists' });
      }
    }

    await role.update({
      name: name || role.name,
      description: description !== undefined ? description : role.description,
      permissions: permissions || role.permissions,
      isActive: isActive !== undefined ? isActive : role.isActive
    });

    logger.info('Role updated successfully', { roleId, updatedBy: req.user.userId });
    res.json(role);
  } catch (error) {
    logger.error('Error updating role:', error);
    res.status(500).json({ error: 'Internal server error' });
  }
});

// Delete role
router.delete('/:id', requireAuth, requireAdmin, async (req, res) => {
  try {
    const roleId = parseInt(req.params.id);

    const role = await Role.findByPk(roleId, {
      include: [
        {
          model: User,
          as: 'users',
          required: false
        }
      ]
    });

    if (!role) {
      return res.status(404).json({ error: 'Role not found' });
    }

    // Prevent deletion of system roles
    if (role.isSystem) {
      return res.status(400).json({ error: 'System roles cannot be deleted' });
    }

    // Check if role is assigned to any users
    if (role.users && role.users.length > 0) {
      return res.status(400).json({ 
        error: 'Cannot delete role that is assigned to users',
        userCount: role.users.length
      });
    }

    await role.destroy();

    logger.info('Role deleted successfully', { roleId, deletedBy: req.user.userId });
    res.json({ message: 'Role deleted successfully' });
  } catch (error) {
    logger.error('Error deleting role:', error);
    res.status(500).json({ error: 'Internal server error' });
  }
});

// Get available permissions (for frontend configuration)
router.get('/permissions/available', requireAuth, requireAdmin, async (req, res) => {
  try {
    const availablePermissions = {
      menus: [
        { value: 'dashboard', label: 'Dashboard', description: 'Access to main dashboard' },
        { value: 'devices', label: 'Devices', description: 'Access to device management' },
        { value: 'device-groups', label: 'Device Groups', description: 'Access to device group management' },
        { value: 'mapping', label: 'Mapping', description: 'Access to field mapping' },
        { value: 'tracking', label: 'Tracking', description: 'Access to location tracking' },
        { value: 'multi-tracking', label: 'Multi Tracking', description: 'Access to multi-device tracking' },
        { value: 'alerts', label: 'Alerts', description: 'Access to alert management' },
        { value: 'settings', label: 'Settings', description: 'Access to system settings' },
        { value: 'user-management', label: 'User Management', description: 'Access to user management' },
        { value: 'export', label: 'Data Export', description: 'Access to data export' },
        { value: 'data-sm', label: 'Data SM', description: 'Access to Data SM module' },
        { value: 'demo', label: 'Offline Demo', description: 'Access to demo features' }
      ],
      modules: [
        { value: 'devices', label: 'Devices', description: 'Device management operations' },
        { value: 'device-groups', label: 'Device Groups', description: 'Device group operations' },
        { value: 'users', label: 'Users', description: 'User management operations' },
        { value: 'roles', label: 'Roles', description: 'Role management operations' },
        { value: 'alerts', label: 'Alerts', description: 'Alert management operations' },
        { value: 'export', label: 'Export', description: 'Data export operations' }
      ],
      special: [
        { value: 'canManageUsers', label: 'Manage Users', description: 'Can create, edit, and delete users' },
        { value: 'canManageRoles', label: 'Manage Roles', description: 'Can create, edit, and delete roles' },
        { value: 'canManageSystem', label: 'Manage System', description: 'Can modify system settings' },
        { value: 'canExportData', label: 'Export Data', description: 'Can export system data' },
        { value: 'canViewAnalytics', label: 'View Analytics', description: 'Can view analytics and reports' }
      ]
    };

    res.json(availablePermissions);
  } catch (error) {
    logger.error('Error fetching available permissions:', error);
    res.status(500).json({ error: 'Internal server error' });
  }
});

// Get users assigned to a role
router.get('/:id/users', requireAuth, requireAdmin, async (req, res) => {
  try {
    const roleId = parseInt(req.params.id);

    const role = await Role.findByPk(roleId);
    if (!role) {
      return res.status(404).json({ error: 'Role not found' });
    }

    const users = await User.findAll({
      where: { roleId, isActive: true },
      attributes: ['id', 'username', 'firstName', 'lastName', 'email', 'lastLogin'],
      order: [['firstName', 'ASC']]
    });

    res.json(users);
  } catch (error) {
    logger.error('Error fetching role users:', error);
    res.status(500).json({ error: 'Internal server error' });
  }
});

module.exports = router; 