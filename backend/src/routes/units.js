const express = require('express');
const router = express.Router();
const { prisma } = require('../config/db');
const { authenticate } = require('../middleware/auth');

router.get('/', authenticate, async (req, res) => {
  try {
    const [units, rawConversions] = await Promise.all([
      prisma.units.findMany({ orderBy: { name: 'asc' } }),
      prisma.unit_conversions.findMany(),
    ]);
    const unitIds = [...new Set(rawConversions.flatMap(({ from_unit_id, to_unit_id }) => [from_unit_id, to_unit_id]))];
    const referencedUnits = await prisma.units.findMany({ where: { id: { in: unitIds } }, select: { id: true, name: true } });
    const unitNames = new Map(referencedUnits.map(({ id, name }) => [id, name]));
    const conversions = rawConversions.map((conversion) => ({
      ...conversion,
      from_unit: unitNames.get(conversion.from_unit_id),
      to_unit: unitNames.get(conversion.to_unit_id),
    }));
    res.json({ success: true, data: { units, conversions } });
  } catch (err) {
    res.status(500).json({ success: false, message: 'Failed to fetch units' });
  }
});

module.exports = router;
