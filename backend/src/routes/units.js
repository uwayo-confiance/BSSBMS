const express = require('express');
const router = express.Router();
const { pool } = require('../config/db');
const { authenticate } = require('../middleware/auth');

router.get('/', authenticate, async (req, res) => {
  try {
    const [units] = await pool.execute(`SELECT * FROM units ORDER BY name`);
    const [conversions] = await pool.execute(`
      SELECT uc.*, uf.name AS from_unit, ut.name AS to_unit
      FROM unit_conversions uc
      JOIN units uf ON uc.from_unit_id = uf.id
      JOIN units ut ON uc.to_unit_id = ut.id
    `);
    res.json({ success: true, data: { units, conversions } });
  } catch (err) {
    res.status(500).json({ success: false, message: 'Failed to fetch units' });
  }
});

module.exports = router;
