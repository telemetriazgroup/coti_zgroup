const express = require('express');
const { requireAuth, requireRole } = require('../middleware/auth');
const { getFinanceDefaults, saveFinanceDefaults } = require('../lib/financeDefaults');

const router = express.Router();
router.use(requireAuth);

router.get('/finance-defaults', requireRole('ADMIN', 'SUPERUSER'), async (req, res) => {
  try {
    const data = await getFinanceDefaults();
    return res.json({ success: true, data });
  } catch (err) {
    console.error('[SETTINGS] finance-defaults get:', err);
    return res.status(500).json({ success: false, error: { code: 'SERVER_ERROR', message: 'Error interno' } });
  }
});

router.put('/finance-defaults', requireRole('ADMIN', 'SUPERUSER'), async (req, res) => {
  try {
    const data = await saveFinanceDefaults(req.body || {}, req.user.id);
    return res.json({ success: true, data });
  } catch (err) {
    console.error('[SETTINGS] finance-defaults put:', err);
    return res.status(500).json({ success: false, error: { code: 'SERVER_ERROR', message: 'Error interno' } });
  }
});

module.exports = router;
