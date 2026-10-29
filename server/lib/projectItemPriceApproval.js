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

module.exports = {
  pricesDiffer,
  isPricePending,
  canReviewBudgetPrices,
  commercialPricePatch,
  reviewerPricePatch,
  priceApprovalMeta,
  countPendingPrices,
  hasPendingPrices,
};
