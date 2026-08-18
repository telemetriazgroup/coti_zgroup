/**
 * Exportación / importación masiva del sistema (SUPERUSER).
 */
const { pool } = require('../config/db');

const EXPORT_VERSION = 1;

async function exportSystemData() {
  const [
    users,
    employees,
    clients,
    categories,
    catalogItems,
    projects,
    projectItems,
    projectShares,
    auditLog,
    odooPartners,
    odooSyncState,
  ] = await Promise.all([
    pool.query(
      `SELECT id, email, password_hash, role, active, created_at, updated_at FROM users ORDER BY email`
    ),
    pool.query(`SELECT * FROM employees ORDER BY apellidos, nombres`),
    pool.query(`SELECT * FROM clients ORDER BY razon_social`),
    pool.query(`SELECT * FROM catalog_categories ORDER BY sort_order, nombre`),
    pool.query(`SELECT * FROM catalog_items ORDER BY category_id, sort_order, codigo`),
    pool.query(`SELECT * FROM projects ORDER BY created_at`),
    pool.query(`SELECT * FROM project_items ORDER BY project_id, sort_order`),
    pool.query(`SELECT * FROM project_shares ORDER BY project_id, user_id`),
    pool.query(
      `SELECT id, project_id, event_type, actor_id, prev_data, new_data, ip_address, created_at
       FROM project_audit_log ORDER BY created_at`
    ),
    pool.query(`SELECT * FROM odoo_partners ORDER BY odoo_id`),
    pool.query(`SELECT * FROM odoo_sync_state ORDER BY model`),
  ]);

  return {
    version: EXPORT_VERSION,
    exportedAt: new Date().toISOString(),
    modules: {
      users: users.rows,
      employees: employees.rows,
      clients: clients.rows,
      catalogCategories: categories.rows,
      catalogItems: catalogItems.rows,
      projects: projects.rows,
      projectItems: projectItems.rows,
      projectShares: projectShares.rows,
      projectAuditLog: auditLog.rows,
      odooPartners: odooPartners.rows,
      odooSyncState: odooSyncState.rows,
    },
  };
}

async function importSystemData(payload, { mode = 'merge' } = {}) {
  if (!payload || typeof payload !== 'object' || !payload.modules) {
    throw new Error('Archivo inválido: falta modules');
  }
  const m = payload.modules;
  const stats = {
    users: 0,
    employees: 0,
    clients: 0,
    catalogCategories: 0,
    catalogItems: 0,
    projects: 0,
    projectItems: 0,
    projectShares: 0,
    odooPartners: 0,
    odooSyncState: 0,
  };

  const client = await pool.connect();
  try {
    await client.query('BEGIN');

    if (mode === 'replace') {
      await client.query(`DELETE FROM project_audit_log`);
      await client.query(`DELETE FROM project_shares`);
      await client.query(`DELETE FROM project_items`);
      await client.query(`DELETE FROM project_budget_snapshots`);
      await client.query(`DELETE FROM project_plans`);
      await client.query(`DELETE FROM projects`);
      await client.query(`DELETE FROM catalog_items`);
      await client.query(`DELETE FROM catalog_categories`);
      await client.query(`DELETE FROM clients`);
      await client.query(`DELETE FROM odoo_sync_locks`);
      await client.query(`DELETE FROM odoo_partners`);
      await client.query(`DELETE FROM odoo_sync_state`);
      await client.query(`DELETE FROM employees WHERE user_id NOT IN (SELECT id FROM users WHERE role = 'SUPERUSER')`);
    }

    for (const row of m.users || []) {
      await client.query(
        `INSERT INTO users (id, email, password_hash, role, active, created_at, updated_at)
         VALUES ($1, $2, COALESCE($3, ''), $4, $5, $6, $7)
         ON CONFLICT (id) DO UPDATE SET
           email = EXCLUDED.email,
           role = EXCLUDED.role,
           active = EXCLUDED.active,
           updated_at = NOW()`,
        [
          row.id,
          row.email,
          row.password_hash || '$2b$12$INVALIDPLACEHOLDER000000000000000000000000000000000',
          row.role,
          row.active !== false,
          row.created_at || new Date(),
          row.updated_at || new Date(),
        ]
      );
      stats.users++;
    }

    for (const row of m.employees || []) {
      await client.query(
        `INSERT INTO employees (id, user_id, nombres, apellidos, cargo, telefono, dni, foto_url, fecha_ingreso, notas, created_at, updated_at)
         VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12)
         ON CONFLICT (id) DO UPDATE SET
           nombres = EXCLUDED.nombres, apellidos = EXCLUDED.apellidos, cargo = EXCLUDED.cargo,
           telefono = EXCLUDED.telefono, updated_at = NOW()`,
        [
          row.id,
          row.user_id,
          row.nombres,
          row.apellidos,
          row.cargo,
          row.telefono,
          row.dni,
          row.foto_url,
          row.fecha_ingreso,
          row.notas,
          row.created_at || new Date(),
          row.updated_at || new Date(),
        ]
      );
      stats.employees++;
    }

    for (const row of m.odooPartners || []) {
      await client.query(
        `INSERT INTO odoo_partners (
           odoo_id, x_ztrack_uid, raw, name, display_name, vat, email, phone, mobile, city,
           is_company, parent_odoo_id, type, active, customer_rank, supplier_rank, category_ids,
           odoo_write_date, last_pushed_write_date, sync_status, updated_at
         ) VALUES (
           $1,$2,$3::jsonb,$4,$5,$6,$7,$8,$9,$10,
           $11,$12,$13,$14,$15,$16,$17,
           $18,$19,$20,$21
         )
         ON CONFLICT (odoo_id) DO UPDATE SET
           raw = EXCLUDED.raw, name = EXCLUDED.name, vat = EXCLUDED.vat,
           odoo_write_date = EXCLUDED.odoo_write_date, sync_status = EXCLUDED.sync_status,
           updated_at = NOW()`,
        [
          row.odoo_id,
          row.x_ztrack_uid || null,
          JSON.stringify(row.raw || {}),
          row.name,
          row.display_name,
          row.vat,
          row.email,
          row.phone,
          row.mobile,
          row.city,
          row.is_company === true,
          row.parent_odoo_id || null,
          row.type || null,
          row.active !== false,
          row.customer_rank || 0,
          row.supplier_rank || 0,
          row.category_ids || [],
          row.odoo_write_date,
          row.last_pushed_write_date || null,
          row.sync_status || 'sincronizado',
          row.updated_at || new Date(),
        ]
      );
      stats.odooPartners++;
    }

    for (const row of m.odooSyncState || []) {
      await client.query(
        `INSERT INTO odoo_sync_state (
           model, watermark, last_run_at, last_ok_at, duration_ms,
           created_n, updated_n, error_n, last_error,
           category_cliente_id, category_proveedor_id, category_contacto_id, updated_at
         ) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13)
         ON CONFLICT (model) DO UPDATE SET
           watermark = EXCLUDED.watermark, last_ok_at = EXCLUDED.last_ok_at,
           category_cliente_id = EXCLUDED.category_cliente_id,
           category_proveedor_id = EXCLUDED.category_proveedor_id,
           category_contacto_id = EXCLUDED.category_contacto_id,
           updated_at = NOW()`,
        [
          row.model,
          row.watermark || null,
          row.last_run_at || null,
          row.last_ok_at || null,
          row.duration_ms || null,
          row.created_n || 0,
          row.updated_n || 0,
          row.error_n || 0,
          row.last_error || null,
          row.category_cliente_id || null,
          row.category_proveedor_id || null,
          row.category_contacto_id || null,
          row.updated_at || new Date(),
        ]
      );
      stats.odooSyncState++;
    }

    for (const row of m.clients || []) {
      await client.query(
        `INSERT INTO clients (
           id, active, razon_social, ruc, contacto_nombre, contacto_email, contacto_telefono,
           direccion, ciudad, notas, created_by, created_at, updated_at,
           odoo_id, odoo_parent_id, odoo_contact_id, sync_origin, odoo_write_date
         )
         VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16,$17,$18)
         ON CONFLICT (id) DO UPDATE SET
           razon_social = EXCLUDED.razon_social, ruc = EXCLUDED.ruc, active = EXCLUDED.active,
           odoo_id = EXCLUDED.odoo_id, sync_origin = EXCLUDED.sync_origin, updated_at = NOW()`,
        [
          row.id,
          row.active !== false,
          row.razon_social,
          row.ruc,
          row.contacto_nombre,
          row.contacto_email,
          row.contacto_telefono,
          row.direccion,
          row.ciudad,
          row.notas,
          row.created_by,
          row.created_at || new Date(),
          row.updated_at || new Date(),
          row.odoo_id || null,
          row.odoo_parent_id || null,
          row.odoo_contact_id || null,
          row.sync_origin || 'local',
          row.odoo_write_date || null,
        ]
      );
      stats.clients++;
    }

    for (const row of m.catalogCategories || []) {
      await client.query(
        `INSERT INTO catalog_categories (id, nombre, sort_order, active, created_at, updated_at)
         VALUES ($1,$2,$3,$4,$5,$6)
         ON CONFLICT (id) DO UPDATE SET nombre = EXCLUDED.nombre, sort_order = EXCLUDED.sort_order, active = EXCLUDED.active`,
        [row.id, row.nombre, row.sort_order, row.active !== false, row.created_at || new Date(), row.updated_at || new Date()]
      );
      stats.catalogCategories++;
    }

    for (const row of m.catalogItems || []) {
      await client.query(
        `INSERT INTO catalog_items (id, category_id, codigo, descripcion, unidad, tipo, unit_price, active, sort_order, created_by, created_at, updated_at)
         VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12)
         ON CONFLICT (id) DO UPDATE SET
           descripcion = EXCLUDED.descripcion, unit_price = EXCLUDED.unit_price, active = EXCLUDED.active`,
        [
          row.id,
          row.category_id,
          row.codigo,
          row.descripcion,
          row.unidad,
          row.tipo,
          row.unit_price,
          row.active !== false,
          row.sort_order,
          row.created_by,
          row.created_at || new Date(),
          row.updated_at || new Date(),
        ]
      );
      stats.catalogItems++;
    }

    for (const row of m.projects || []) {
      await client.query(
        `INSERT INTO projects (id, nombre, odoo_ref, client_id, status, created_by, assigned_viewer, currency, tc, finance_params, deleted_at, created_at, updated_at)
         VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10::jsonb,$11,$12,$13)
         ON CONFLICT (id) DO UPDATE SET
           nombre = EXCLUDED.nombre, status = EXCLUDED.status, finance_params = EXCLUDED.finance_params, updated_at = NOW()`,
        [
          row.id,
          row.nombre,
          row.odoo_ref,
          row.client_id,
          row.status,
          row.created_by,
          row.assigned_viewer,
          row.currency || 'USD',
          row.tc,
          JSON.stringify(row.finance_params || {}),
          row.deleted_at,
          row.created_at || new Date(),
          row.updated_at || new Date(),
        ]
      );
      stats.projects++;
    }

    for (const row of m.projectItems || []) {
      await client.query(
        `INSERT INTO project_items (id, project_id, catalog_item_id, codigo, descripcion, unidad, tipo, unit_price, official_unit_price, qty, is_custom, category_id, sort_order, created_by, created_at, updated_at)
         VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16)
         ON CONFLICT (id) DO UPDATE SET
           qty = EXCLUDED.qty, unit_price = EXCLUDED.unit_price, updated_at = NOW()`,
        [
          row.id,
          row.project_id,
          row.catalog_item_id,
          row.codigo,
          row.descripcion,
          row.unidad,
          row.tipo,
          row.unit_price,
          row.official_unit_price,
          row.qty,
          row.is_custom,
          row.category_id,
          row.sort_order,
          row.created_by || null,
          row.created_at || new Date(),
          row.updated_at || new Date(),
        ]
      );
      stats.projectItems++;
    }

    for (const row of m.projectShares || []) {
      await client.query(
        `INSERT INTO project_shares (id, project_id, user_id, shared_by, created_at)
         VALUES ($1,$2,$3,$4,$5)
         ON CONFLICT (project_id, user_id) DO NOTHING`,
        [row.id, row.project_id, row.user_id, row.shared_by, row.created_at || new Date()]
      );
      stats.projectShares++;
    }

    await client.query('COMMIT');
    return stats;
  } catch (err) {
    await client.query('ROLLBACK');
    throw err;
  } finally {
    client.release();
  }
}

module.exports = { exportSystemData, importSystemData, EXPORT_VERSION };
