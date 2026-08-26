const express = require('express');
const { body, validationResult } = require('express-validator');
const { requireAuth } = require('../middleware/auth');
const { getClientIp } = require('../utils/ip');
const { ALLOWED_KINDS, logUserActivity } = require('../lib/userActivity');

const router = express.Router();
router.use(requireAuth);

const kinds = [...ALLOWED_KINDS];

router.post(
  '/',
  [
    body('kind').isString().isIn(kinds),
    body('projectId').optional({ nullable: true }).isUUID(),
    body('summary').optional({ nullable: true }).isString().isLength({ max: 400 }),
    body('path').optional({ nullable: true }).isString().isLength({ max: 200 }),
  ],
  async (req, res) => {
    const errors = validationResult(req);
    if (!errors.isEmpty()) {
      return res.status(400).json({
        success: false,
        error: { code: 'VALIDATION_ERROR', message: errors.array()[0].msg },
      });
    }
    await logUserActivity({
      userId: req.user.id,
      kind: req.body.kind,
      projectId: req.body.projectId || null,
      summary: req.body.summary,
      path: req.body.path,
      ip: getClientIp(req),
    });
    return res.json({ success: true, data: { ok: true } });
  }
);

module.exports = router;
