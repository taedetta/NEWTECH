'use strict';

// At-risk student detection and intervention routes.
// Owns: GET/POST /thresholds, GET / (list at-risk), PATCH /:studentId/override,
//       GET/POST /:studentId/interventions.
// Does NOT own: user CRUD, booking management, flight log entry.

const express = require('express');
const { authenticateToken, requireRole } = require('../middleware/auth');
const atRiskDb = require('../db/at-risk');

const router = express.Router();

// All at-risk routes require authentication and admin/owner role
router.use(authenticateToken, requireRole('owner', 'admin', 'instructor'));

// GET / — compute and return at-risk students
router.get('/', async (req, res) => {
  try {
    const students = await atRiskDb.computeAtRiskStudents();
    res.json({ students });
  } catch (err) {
    console.error(`[at-risk] GET / error: ${err.message}`);
    res.status(500).json({ error: 'Failed to compute at-risk students' });
  }
});

// GET /thresholds — return current threshold settings
router.get('/thresholds', async (req, res) => {
  try {
    const thresholds = await atRiskDb.getThresholds();
    res.json(thresholds);
  } catch (err) {
    console.error(`[at-risk] GET /thresholds error: ${err.message}`);
    res.status(500).json({ error: 'Failed to load thresholds' });
  }
});

// POST /thresholds — update threshold settings (owner/admin only)
router.post('/thresholds', requireRole('owner', 'admin'), async (req, res) => {
  try {
    const { at_risk_low_days, at_risk_medium_days, at_risk_high_days, at_risk_critical_days } = req.body;
    if (!at_risk_low_days || !at_risk_medium_days || !at_risk_high_days || !at_risk_critical_days) {
      return res.status(400).json({ error: 'All four threshold values required' });
    }
    await atRiskDb.saveThresholds({ at_risk_low_days, at_risk_medium_days, at_risk_high_days, at_risk_critical_days });
    res.json({ success: true });
  } catch (err) {
    console.error(`[at-risk] POST /thresholds error: ${err.message}`);
    res.status(500).json({ error: 'Failed to save thresholds' });
  }
});

// PATCH /:studentId/override — set manual risk override
router.patch('/:studentId/override', requireRole('owner', 'admin'), async (req, res) => {
  try {
    const { level, notes } = req.body;
    await atRiskDb.setManualOverride(
      parseInt(req.params.studentId, 10),
      level || null,
      notes || null,
      req.user.id
    );
    res.json({ success: true });
  } catch (err) {
    console.error(`[at-risk] PATCH /${req.params.studentId}/override error: ${err.message}`);
    res.status(500).json({ error: 'Failed to save override' });
  }
});

// GET /:studentId/interventions — list intervention history
router.get('/:studentId/interventions', async (req, res) => {
  try {
    const interventions = await atRiskDb.getInterventions(parseInt(req.params.studentId, 10));
    res.json(interventions);
  } catch (err) {
    console.error(`[at-risk] GET /${req.params.studentId}/interventions error: ${err.message}`);
    res.status(500).json({ error: 'Failed to load interventions' });
  }
});

// POST /:studentId/interventions — log a new intervention
router.post('/:studentId/interventions', async (req, res) => {
  try {
    const { intervention_type, outcome, notes } = req.body;
    if (!intervention_type) {
      return res.status(400).json({ error: 'intervention_type is required' });
    }
    await atRiskDb.logIntervention(
      parseInt(req.params.studentId, 10),
      req.user.id,
      intervention_type,
      outcome || null,
      notes || null
    );
    res.json({ success: true });
  } catch (err) {
    console.error(`[at-risk] POST /${req.params.studentId}/interventions error: ${err.message}`);
    res.status(500).json({ error: 'Failed to log intervention' });
  }
});

module.exports = router;
