'use strict';

const express = require('express');
const locationsDb = require('../db/locations');
const { authenticateToken, requireRole } = require('../middleware/auth');

const router = express.Router();

router.get('/', authenticateToken, async (req, res) => {
  try {
    const locations = await locationsDb.listLocations();
    res.json({ locations });
  } catch (err) {
    console.error('[locations] GET / error:', err.message);
    res.status(500).json({ error: 'Failed to load locations' });
  }
});

router.post('/', authenticateToken, requireRole('owner', 'admin'), async (req, res) => {
  try {
    const { code, name, timezone, weather_station, is_default } = req.body;
    if (!code || !name) return res.status(400).json({ error: 'code and name required' });
    const location = await locationsDb.createLocation({ code, name, timezone, weather_station, is_default });
    res.status(201).json({ location });
  } catch (err) {
    console.error('[locations] POST / error:', err.message);
    res.status(500).json({ error: 'Failed to create location' });
  }
});

router.patch('/:id', authenticateToken, requireRole('owner', 'admin'), async (req, res) => {
  try {
    const location = await locationsDb.updateLocation(parseInt(req.params.id, 10), req.body);
    if (!location) return res.status(404).json({ error: 'Not found' });
    res.json({ location });
  } catch (err) {
    console.error('[locations] PATCH /:id error:', err.message);
    res.status(500).json({ error: 'Failed to update location' });
  }
});

module.exports = router;
