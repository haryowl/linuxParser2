const express = require('express');
const router = express.Router();
const { DeviceGroup, Device, User } = require('../models');
const { requireAuth } = require('./auth');
const logger = require('../utils/logger');

// Middleware to check if user is admin or manager
const requireManager = (req, res, next) => {
  if (!['admin', 'manager'].includes(req.user.role)) {
    return res.status(403).json({ error: 'Manager access required' });
  }
  next();
};

// Get all device groups
router.get('/', requireAuth, async (req, res) => {
  try {
    let groups;
    try {
      groups = await DeviceGroup.findAll({
        where: { isActive: true },
        include: [
          {
            model: User,
            as: 'creator',
            attributes: ['id', 'username', 'firstName', 'lastName'],
            required: false
          },
          {
            model: Device,
            as: 'devices',
            attributes: ['id', 'name', 'imei', 'status', 'lastSeen'],
            required: false
          }
        ],
        order: [['createdAt', 'DESC']]
      });
    } catch (includeError) {
      // Includes can fail on association/schema drift — still return groups so Devices page loads.
      logger.warn('Device groups include query failed; returning groups without relations', {
        error: includeError.message
      });
      groups = await DeviceGroup.findAll({
        where: { isActive: true },
        attributes: ['id', 'name', 'description', 'color', 'isActive', 'createdBy', 'createdAt', 'updatedAt'],
        order: [['createdAt', 'DESC']]
      });
    }

    res.json(groups);
  } catch (error) {
    logger.error('Error fetching device groups:', error);
    res.status(500).json({ error: 'Internal server error' });
  }
});

// Get single device group
router.get('/:id', requireAuth, async (req, res) => {
  try {
    const groupId = parseInt(req.params.id);
    
    const group = await DeviceGroup.findByPk(groupId, {
      include: [
        {
          model: User,
          as: 'creator',
          attributes: ['id', 'username', 'firstName', 'lastName']
        },
        {
          model: Device,
          as: 'devices',
          attributes: ['id', 'name', 'imei', 'status', 'lastSeen'],
          required: false
        }
      ]
    });
    
    if (!group) {
      return res.status(404).json({ error: 'Device group not found' });
    }
    
    res.json(group);
  } catch (error) {
    logger.error('Error fetching device group:', error);
    res.status(500).json({ error: 'Internal server error' });
  }
});

// Create new device group (admin/manager only)
router.post('/', requireAuth, requireManager, async (req, res) => {
  try {
    const { name, description, color } = req.body;

    if (!name) {
      return res.status(400).json({ error: 'Group name is required' });
    }

    // Check if group name already exists
    const existingGroup = await DeviceGroup.findOne({
      where: { name, isActive: true }
    });

    if (existingGroup) {
      return res.status(400).json({ error: 'Group name already exists' });
    }

    const group = await DeviceGroup.create({
      name,
      description,
      color: color || '#1976d2',
      createdBy: req.user.userId
    });

    logger.info('Device group created successfully', { groupId: group.id, createdBy: req.user.userId });
    res.status(201).json(group);
  } catch (error) {
    logger.error('Error creating device group:', error);
    res.status(500).json({ error: 'Internal server error' });
  }
});

// Update device group (admin/manager only)
router.put('/:id', requireAuth, requireManager, async (req, res) => {
  try {
    const groupId = parseInt(req.params.id);
    const { name, description, color } = req.body;

    const group = await DeviceGroup.findByPk(groupId);
    if (!group) {
      return res.status(404).json({ error: 'Device group not found' });
    }

    // Check if new name conflicts with existing group
    if (name && name !== group.name) {
      const existingGroup = await DeviceGroup.findOne({
        where: { name, isActive: true }
      });

      if (existingGroup) {
        return res.status(400).json({ error: 'Group name already exists' });
      }
    }

    await group.update({
      name: name || group.name,
      description: description !== undefined ? description : group.description,
      color: color || group.color
    });

    logger.info('Device group updated successfully', { groupId, updatedBy: req.user.userId });
    res.json(group);
  } catch (error) {
    logger.error('Error updating device group:', error);
    res.status(500).json({ error: 'Internal server error' });
  }
});

// Delete device group (admin/manager only)
router.delete('/:id', requireAuth, requireManager, async (req, res) => {
  try {
    const groupId = parseInt(req.params.id);

    const group = await DeviceGroup.findByPk(groupId);
    if (!group) {
      return res.status(404).json({ error: 'Device group not found' });
    }

    // Soft delete
    await group.update({ isActive: false });

    logger.info('Device group deleted successfully', { groupId, deletedBy: req.user.userId });
    res.json({ message: 'Device group deleted successfully' });
  } catch (error) {
    logger.error('Error deleting device group:', error);
    res.status(500).json({ error: 'Internal server error' });
  }
});

// Add device to group (admin/manager only)
router.post('/:id/devices', requireAuth, requireManager, async (req, res) => {
  try {
    const groupId = parseInt(req.params.id);
    const { deviceId } = req.body;

    if (!deviceId) {
      return res.status(400).json({ error: 'Device ID is required' });
    }

    const group = await DeviceGroup.findByPk(groupId);
    if (!group) {
      return res.status(404).json({ error: 'Device group not found' });
    }

    const device = await Device.findByPk(deviceId);
    if (!device) {
      return res.status(404).json({ error: 'Device not found' });
    }

    // Check if device is already in this group (idempotent success)
    if (device.groupId === groupId) {
      logger.info('Device already in group', { groupId, deviceId, requestedBy: req.user.userId });
      return res.json({ message: 'Device is already in this group', alreadyInGroup: true });
    }

    // Add device to group
    await device.update({ groupId });

    logger.info('Device added to group', { groupId, deviceId, addedBy: req.user.userId });
    res.json({ message: 'Device added to group successfully' });
  } catch (error) {
    logger.error('Error adding device to group:', error);
    res.status(500).json({ error: 'Internal server error' });
  }
});

// Remove device from group (admin/manager only)
router.delete('/:id/devices/:deviceId', requireAuth, requireManager, async (req, res) => {
  try {
    const groupId = parseInt(req.params.id);
    const deviceId = req.params.deviceId;

    const group = await DeviceGroup.findByPk(groupId);
    if (!group) {
      return res.status(404).json({ error: 'Device group not found' });
    }

    const device = await Device.findByPk(deviceId);
    if (!device) {
      return res.status(404).json({ error: 'Device not found' });
    }

    // Check if device is in this group
    if (device.groupId !== groupId) {
      return res.status(400).json({ error: 'Device is not in this group' });
    }

    // Remove device from group
    await device.update({ groupId: null });

    logger.info('Device removed from group', { groupId, deviceId, removedBy: req.user.userId });
    res.json({ message: 'Device removed from group successfully' });
  } catch (error) {
    logger.error('Error removing device from group:', error);
    res.status(500).json({ error: 'Internal server error' });
  }
});

// Get devices in group
router.get('/:id/devices', requireAuth, async (req, res) => {
  try {
    const groupId = parseInt(req.params.id);

    const group = await DeviceGroup.findByPk(groupId);
    if (!group) {
      return res.status(404).json({ error: 'Device group not found' });
    }

    const devices = await Device.findAll({
      where: { groupId },
      order: [['name', 'ASC']]
    });

    res.json(devices);
  } catch (error) {
    logger.error('Error fetching group devices:', error);
    res.status(500).json({ error: 'Internal server error' });
  }
});

module.exports = router; 