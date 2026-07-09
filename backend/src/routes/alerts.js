// backend/src/routes/alerts.js
const express = require('express');
const router = express.Router();
const alertManager = require('../services/alertManager');
const { Alert, AlertRule, sequelize } = require('../models'); // Import models and sequelize
const asyncHandler = require('../utils/asyncHandler'); // Import asyncHandler
const { Op } = require('sequelize'); // Import Op for operators
const { dateGroupExpression } = require('../utils/sqlDialect');

// Get all alerts
router.get('/', asyncHandler(async (req, res) => {
    const alerts = await Alert.findAll();
    res.json(alerts);
}));

// Get alert history
router.get('/history', asyncHandler(async (req, res) => {
    const alerts = await Alert.findAll({
        order: [['createdAt', 'DESC']],
        limit: 100 // Limit to last 100 alerts
    });
    res.json(alerts);
}));

// Get alert statistics
router.get('/stats', asyncHandler(async (req, res) => {
    // Get severity distribution
    const severityDistribution = await Alert.findAll({
        attributes: ['severity', [sequelize.fn('COUNT', sequelize.col('id')), 'count']],
        group: ['severity']
    });

    // Get alerts over time (last 7 days)
    const sevenDaysAgo = new Date();
    sevenDaysAgo.setDate(sevenDaysAgo.getDate() - 7);
    const dateBucket = dateGroupExpression(sequelize, 'createdAt');
    const alertsOverTime = await Alert.findAll({
        attributes: [
            [dateBucket, 'date'],
            [sequelize.fn('COUNT', sequelize.col('id')), 'count']
        ],
        where: {
            createdAt: {
                [Op.gte]: sevenDaysAgo
            }
        },
        group: [dateBucket],
        order: [[dateBucket, 'ASC']]
    });

    // Get top triggers
    const topTriggers = await Alert.findAll({
        attributes: ['ruleId', [sequelize.fn('COUNT', sequelize.col('id')), 'count']],
        group: ['ruleId'],
        order: [[sequelize.fn('COUNT', sequelize.col('id')), 'DESC']],
        limit: 5
    });

    res.json({
        severityDistribution,
        alertsOverTime,
        topTriggers
    });
}));

// Export alerts
router.get('/export', asyncHandler(async (req, res) => {
    const alerts = await Alert.findAll({
        include: [AlertRule],
        order: [['createdAt', 'DESC']]
    });
    res.json(alerts);
}));

// Get alert by ID
router.get('/:id', asyncHandler(async (req, res) => {
    const alert = await Alert.findByPk(req.params.id);
    if (!alert) {
        return res.status(404).json({ message: 'Alert not found' });
    }
    res.json(alert);
}));

// Create a new alert rule
router.post('/rules', asyncHandler(async (req, res) => {
    const rule = await AlertRule.create(req.body);
    // After creating a rule, reload the rules in the AlertManager
    await alertManager.loadRules(); // Assuming you have a loadRules method
    res.status(201).json(rule);
}));

// Get all alert rules
router.get('/rules', asyncHandler(async (req, res) => {
    const rules = await AlertRule.findAll();
    res.json(rules);
}));

// Get alert rule by ID
router.get('/rules/:id', asyncHandler(async (req, res) => {
    const rule = await AlertRule.findByPk(req.params.id);
    if (!rule) {
        return res.status(404).json({ message: 'Alert rule not found' });
    }
    res.json(rule);
}));

// Update an alert rule
router.put('/rules/:id', asyncHandler(async (req, res) => {
    const { id } = req.params;
    const updates = req.body;
    const rule = await AlertRule.findByPk(id);

    if (!rule) {
        return res.status(404).json({ message: 'Alert rule not found' });
    }

    await rule.update(updates);
    // Reload rules after updating
    await alertManager.loadRules();
    res.json({ message: 'Alert rule updated successfully' });
}));

// Delete an alert rule
router.delete('/rules/:id', asyncHandler(async (req, res) => {
    const { id } = req.params;
    const rule = await AlertRule.findByPk(id);

    if (!rule) {
        return res.status(404).json({ message: 'Alert rule not found' });
    }

    await rule.destroy();
    // Reload rules after deleting
    await alertManager.loadRules();
    res.json({ message: 'Alert rule deleted successfully' });
}));

module.exports = router;
