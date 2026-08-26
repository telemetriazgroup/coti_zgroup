function normEmail(email) {
  return String(email || '').trim().toLowerCase();
}

/**
 * Conserva SUPERUSER locales. El dump no inserta otro SUPERUSER ni reusa su email.
 * userIdMap: id del dump → id real (el SUPERUSER que importa).
 */
function planUserImport(dumpUsers, keptSuperusers, keepUserId) {
  const kept = Array.isArray(keptSuperusers) ? keptSuperusers : [];
  const preferId = keepUserId || kept[0]?.id || null;
  const keptEmails = new Set(kept.map((s) => normEmail(s.email)).filter(Boolean));
  const keptIds = new Set(kept.map((s) => s.id).filter(Boolean));
  const userIdMap = new Map();
  const toInsert = [];

  for (const row of dumpUsers || []) {
    if (!row || !row.id) continue;
    const email = normEmail(row.email);
    const byEmail = kept.find((s) => normEmail(s.email) === email);
    const keepAs = byEmail?.id || (keptIds.has(row.id) ? row.id : null);
    if (row.role === 'SUPERUSER' || keepAs || (email && keptEmails.has(email))) {
      userIdMap.set(row.id, keepAs || preferId);
      continue;
    }
    toInsert.push({ ...row, email: email || row.email });
  }

  return { userIdMap, toInsert, preferId, keptIds };
}

function remapUserId(id, userIdMap) {
  if (!id) return null;
  return userIdMap.has(id) ? userIdMap.get(id) : id;
}

module.exports = { normEmail, planUserImport, remapUserId };
