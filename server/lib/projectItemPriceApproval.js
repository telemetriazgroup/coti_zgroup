function pricesDiffer(a, b) {
  return Math.abs(Number(a || 0) - Number(b || 0)) > 0.005;
}

function isPricePending(status) {
  return String(status || '').toUpperCase() === 'PENDING';
}

function canReviewBudgetPrices(user) {
  const role = user?.role;
  return role === 'ADMIN' || role === 'SEMIADMIN' || role === 'SUPERUSER';
}

function commercialPricePatch(currentRow, nextPrice) {
  const n = Number(nextPrice);
  const approved =
    currentRow.approved_unit_price != null
      ? Number(currentRow.approved_unit_price)
      : Number(currentRow.unit_price);
  if (!pricesDiffer(n, approved)) {
    return { unitPrice: n, priceStatus: 'APPROVED', approvedUnitPrice: approved };
  }
  return { unitPrice: n, priceStatus: 'PENDING', approvedUnitPrice: approved };
}

function reviewerPricePatch(nextPrice) {
  const n = Number(nextPrice);
  return { unitPrice: n, priceStatus: 'APPROVED', approvedUnitPrice: n };
}

function priceApprovalMeta(mappedItems) {
  const pendingPriceCount = (mappedItems || []).filter((i) => i.pricePending).length;
  return { pendingPriceCount, hasPendingPrices: pendingPriceCount > 0 };
}

function getPool(client) {
  if (client) return client;
  return require('../config/db').pool;
}

function personLabel(row) {
  const name = String(row.name || '').trim();
  return name || row.email || 'Usuario';
}

function mapApprovalRequest(row) {
  if (!row) return null;
  return {
    id: row.id,
    requestedBy: row.requested_by,
    requestedByEmail: row.requested_by_email || null,
    requestedByName: personLabel({ name: row.requested_by_name, email: row.requested_by_email }),
    requestedAt: row.requested_at,
    status: row.status,
  };
}

async function countPendingPrices(projectId, client) {
  const db = getPool(client);
  const { rows } = await db.query(
    `SELECT COUNT(*)::int AS n FROM project_items WHERE project_id = $1 AND price_status = 'PENDING'`,
    [projectId]
  );
  return rows[0]?.n || 0;
}

async function hasPendingPrices(projectId, client) {
  return (await countPendingPrices(projectId, client)) > 0;
}

/** SEMIADMIN solo si es el encargado del comercial; ADMIN y SUPERUSER siempre. */
async function canApproveProjectPrices(user, project, client) {
  const role = user?.role;
  if (role === 'SUPERUSER' || role === 'ADMIN') return true;
  if (role !== 'SEMIADMIN' || !project) return false;
  const { isManagedCommercial } = require('./adminTeam');
  const ids = new Set();
  if (project.created_by) ids.add(project.created_by);
  const db = getPool(client);
  const { rows } = await db.query(
    `SELECT DISTINCT updated_by FROM project_items
     WHERE project_id = $1 AND price_status = 'PENDING' AND updated_by IS NOT NULL`,
    [project.id]
  );
  for (const r of rows) {
    if (r.updated_by) ids.add(r.updated_by);
  }
  for (const uid of ids) {
    if (await isManagedCommercial(user.id, uid)) return true;
  }
  return false;
}

async function listPriceApprovalRecipients(commercialUserId, client) {
  const db = getPool(client);
  const { rows } = await db.query(
    `SELECT u.id, u.email, u.role,
            TRIM(CONCAT(COALESCE(e.nombres, ''), ' ', COALESCE(e.apellidos, ''))) AS name
     FROM users u
     LEFT JOIN employees e ON e.user_id = u.id
     WHERE u.active = true AND (
       u.role IN ('ADMIN', 'SUPERUSER')
       OR (
         u.role = 'SEMIADMIN' AND (
           EXISTS (SELECT 1 FROM users c WHERE c.id = $1::uuid AND c.created_by = u.id)
           OR EXISTS (
             SELECT 1 FROM admin_commercial_assignments a
             WHERE a.admin_id = u.id AND a.commercial_id = $1::uuid
           )
         )
       )
     )
     ORDER BY CASE u.role WHEN 'SEMIADMIN' THEN 0 WHEN 'ADMIN' THEN 1 ELSE 2 END, u.email`,
    [commercialUserId]
  );
  return rows.map((r) => ({
    id: r.id,
    role: r.role,
    email: r.email,
    name: personLabel(r),
  }));
}

async function getOpenPriceApprovalRequest(projectId, client) {
  const db = getPool(client);
  const { rows } = await db.query(
    `SELECT r.*,
            ru.email AS requested_by_email,
            TRIM(CONCAT(COALESCE(re.nombres, ''), ' ', COALESCE(re.apellidos, ''))) AS requested_by_name
     FROM project_price_approval_requests r
     JOIN users ru ON ru.id = r.requested_by
     LEFT JOIN employees re ON re.user_id = r.requested_by
     WHERE r.project_id = $1 AND r.status = 'PENDING'
     ORDER BY r.requested_at DESC
     LIMIT 1`,
    [projectId]
  );
  return mapApprovalRequest(rows[0]);
}

async function upsertPriceApprovalRequest(projectId, userId, client) {
  const db = getPool(client);
  const open = await db.query(
    `SELECT id FROM project_price_approval_requests
      WHERE project_id = $1 AND status = 'PENDING'
      LIMIT 1`,
    [projectId]
  );
  if (open.rows[0]) {
    const { rows } = await db.query(
      `UPDATE project_price_approval_requests
          SET requested_at = NOW(), requested_by = $2
        WHERE id = $1
      RETURNING id, project_id, requested_by, status, requested_at`,
      [open.rows[0].id, userId]
    );
    return rows[0];
  }
  const { rows } = await db.query(
    `INSERT INTO project_price_approval_requests (project_id, requested_by, status, requested_at)
     VALUES ($1, $2, 'PENDING', NOW())
     RETURNING id, project_id, requested_by, status, requested_at`,
    [projectId, userId]
  );
  return rows[0];
}

async function resolveOpenPriceApprovalRequest(projectId, userId, client) {
  const db = getPool(client);
  await db.query(
    `UPDATE project_price_approval_requests
        SET status = 'RESOLVED', resolved_at = NOW(), resolved_by = $2
      WHERE project_id = $1 AND status = 'PENDING'`,
    [projectId, userId]
  );
}

async function resolveRequestIfNoPending(projectId, userId, client) {
  if (await hasPendingPrices(projectId, client)) return;
  await resolveOpenPriceApprovalRequest(projectId, userId, client);
}

async function countOpenPriceApprovalRequestsForReviewer(user, client) {
  const db = getPool(client);
  const role = user?.role;
  if (role === 'SUPERUSER' || role === 'ADMIN') {
    const { rows } = await db.query(
      `SELECT COUNT(*)::int AS n
         FROM project_price_approval_requests r
         JOIN projects p ON p.id = r.project_id
        WHERE r.status = 'PENDING' AND p.deleted_at IS NULL`
    );
    return rows[0]?.n || 0;
  }
  if (role !== 'SEMIADMIN') return 0;
  const { rows } = await db.query(
    `SELECT COUNT(*)::int AS n
       FROM project_price_approval_requests r
       JOIN projects p ON p.id = r.project_id
      WHERE r.status = 'PENDING' AND p.deleted_at IS NULL
        AND EXISTS (
          SELECT 1 FROM users u
           WHERE u.id = r.requested_by AND u.role = 'COMERCIAL' AND (
             u.created_by = $1::uuid OR EXISTS (
               SELECT 1 FROM admin_commercial_assignments a
               WHERE a.admin_id = $1::uuid AND a.commercial_id = u.id
             )
           )
        )`,
    [user.id]
  );
  return rows[0]?.n || 0;
}

async function loadPriceApprovalState(user, project, mappedItems, client) {
  const meta = priceApprovalMeta(mappedItems);
  const canReview = await canApproveProjectPrices(user, project, client);
  const request = await getOpenPriceApprovalRequest(project.id, client);
  const recipients =
    user?.role === 'COMERCIAL' ? await listPriceApprovalRecipients(user.id, client) : [];
  return {
    ...meta,
    canReviewPrices: canReview,
    priceApprovalRequest: request,
    priceApprovalRecipients: recipients,
  };
}

module.exports = {
  pricesDiffer,
  isPricePending,
  canReviewBudgetPrices,
  canApproveProjectPrices,
  commercialPricePatch,
  reviewerPricePatch,
  priceApprovalMeta,
  countPendingPrices,
  hasPendingPrices,
  listPriceApprovalRecipients,
  getOpenPriceApprovalRequest,
  upsertPriceApprovalRequest,
  resolveOpenPriceApprovalRequest,
  resolveRequestIfNoPending,
  countOpenPriceApprovalRequestsForReviewer,
  loadPriceApprovalState,
};
