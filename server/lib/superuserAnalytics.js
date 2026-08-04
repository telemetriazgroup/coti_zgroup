/** Analíticas globales de cotizaciones e ítems (solo SUPERUSER). */

const { pool } = require('../config/db');

const TZ = 'America/Lima';
const ITEM_LINE_FILTER = `COALESCE(pi.is_bundle_header, false) = false`;
const VALUE_LINE_FILTER = `COALESCE(pi.is_bundle_component, false) = false`;

function mapSeries(rows, periodKey) {
  return rows.map((r) => ({
    period: r[periodKey],
    projectsCount: r.projects_count,
    itemsCount: r.items_count,
    pipelineValue: r.pipeline_value != null ? Number(r.pipeline_value) : 0,
  }));
}

async function loadSuperuserAnalytics() {
  const [
    overviewRes,
    projectsDayRes,
    projectsWeekRes,
    projectsMonthRes,
    usersRes,
    topItemsRes,
  ] = await Promise.all([
    pool.query(`
      SELECT
        (SELECT COUNT(DISTINCT p.created_by)::int
         FROM projects p WHERE p.deleted_at IS NULL) AS users_with_projects,
        (SELECT COUNT(*)::int FROM projects p WHERE p.deleted_at IS NULL) AS projects_total,
        (SELECT COUNT(*)::int FROM project_items pi
         INNER JOIN projects p ON p.id = pi.project_id
         WHERE p.deleted_at IS NULL AND ${ITEM_LINE_FILTER}) AS items_total,
        (SELECT COALESCE(SUM(pi.subtotal), 0)::numeric FROM project_items pi
         INNER JOIN projects p ON p.id = pi.project_id
         WHERE p.deleted_at IS NULL AND ${VALUE_LINE_FILTER}) AS pipeline_total,
        (SELECT COUNT(*)::int FROM projects p
         WHERE p.deleted_at IS NULL
           AND (p.created_at AT TIME ZONE '${TZ}')::date = (NOW() AT TIME ZONE '${TZ}')::date) AS projects_today,
        (SELECT COUNT(*)::int FROM projects p
         WHERE p.deleted_at IS NULL
           AND p.created_at >= date_trunc('week', (NOW() AT TIME ZONE '${TZ}')::timestamp)) AS projects_week,
        (SELECT COUNT(*)::int FROM projects p
         WHERE p.deleted_at IS NULL
           AND p.created_at >= date_trunc('month', (NOW() AT TIME ZONE '${TZ}')::timestamp)) AS projects_month,
        (SELECT COUNT(*)::int FROM project_items pi
         INNER JOIN projects p ON p.id = pi.project_id
         WHERE p.deleted_at IS NULL AND ${ITEM_LINE_FILTER}
           AND (pi.created_at AT TIME ZONE '${TZ}')::date = (NOW() AT TIME ZONE '${TZ}')::date) AS items_today,
        (SELECT COUNT(*)::int FROM project_items pi
         INNER JOIN projects p ON p.id = pi.project_id
         WHERE p.deleted_at IS NULL AND ${ITEM_LINE_FILTER}
           AND pi.created_at >= date_trunc('week', (NOW() AT TIME ZONE '${TZ}')::timestamp)) AS items_week,
        (SELECT COUNT(*)::int FROM project_items pi
         INNER JOIN projects p ON p.id = pi.project_id
         WHERE p.deleted_at IS NULL AND ${ITEM_LINE_FILTER}
           AND pi.created_at >= date_trunc('month', (NOW() AT TIME ZONE '${TZ}')::timestamp)) AS items_month
    `),

    pool.query(`
      WITH days AS (
        SELECT generate_series(
          (NOW() AT TIME ZONE '${TZ}')::date - INTERVAL '29 days',
          (NOW() AT TIME ZONE '${TZ}')::date,
          INTERVAL '1 day'
        )::date AS d
      ),
      proj AS (
        SELECT (p.created_at AT TIME ZONE '${TZ}')::date AS d, COUNT(*)::int AS n
        FROM projects p
        WHERE p.deleted_at IS NULL
          AND p.created_at >= (NOW() AT TIME ZONE '${TZ}')::date - INTERVAL '29 days'
        GROUP BY 1
      ),
      pipe AS (
        SELECT (p.created_at AT TIME ZONE '${TZ}')::date AS d,
               COALESCE(SUM(pi.subtotal), 0)::numeric AS v
        FROM projects p
        LEFT JOIN project_items pi ON pi.project_id = p.id AND ${VALUE_LINE_FILTER}
        WHERE p.deleted_at IS NULL
          AND p.created_at >= (NOW() AT TIME ZONE '${TZ}')::date - INTERVAL '29 days'
        GROUP BY 1
      ),
      items AS (
        SELECT (pi.created_at AT TIME ZONE '${TZ}')::date AS d, COUNT(*)::int AS n
        FROM project_items pi
        INNER JOIN projects p ON p.id = pi.project_id
        WHERE p.deleted_at IS NULL AND ${ITEM_LINE_FILTER}
          AND pi.created_at >= (NOW() AT TIME ZONE '${TZ}')::date - INTERVAL '29 days'
        GROUP BY 1
      )
      SELECT
        to_char(days.d, 'YYYY-MM-DD') AS period_day,
        COALESCE(proj.n, 0)::int AS projects_count,
        COALESCE(items.n, 0)::int AS items_count,
        COALESCE(pipe.v, 0)::numeric AS pipeline_value
      FROM days
      LEFT JOIN proj ON proj.d = days.d
      LEFT JOIN pipe ON pipe.d = days.d
      LEFT JOIN items ON items.d = days.d
      ORDER BY days.d
    `),

    pool.query(`
      WITH weeks AS (
        SELECT generate_series(
          date_trunc('week', (NOW() AT TIME ZONE '${TZ}')::timestamp) - INTERVAL '11 weeks',
          date_trunc('week', (NOW() AT TIME ZONE '${TZ}')::timestamp),
          INTERVAL '1 week'
        ) AS w
      ),
      proj AS (
        SELECT date_trunc('week', p.created_at AT TIME ZONE '${TZ}') AS w, COUNT(*)::int AS n
        FROM projects p
        WHERE p.deleted_at IS NULL
          AND p.created_at >= date_trunc('week', (NOW() AT TIME ZONE '${TZ}')::timestamp) - INTERVAL '11 weeks'
        GROUP BY 1
      ),
      pipe AS (
        SELECT date_trunc('week', p.created_at AT TIME ZONE '${TZ}') AS w,
               COALESCE(SUM(pi.subtotal), 0)::numeric AS v
        FROM projects p
        LEFT JOIN project_items pi ON pi.project_id = p.id AND ${VALUE_LINE_FILTER}
        WHERE p.deleted_at IS NULL
          AND p.created_at >= date_trunc('week', (NOW() AT TIME ZONE '${TZ}')::timestamp) - INTERVAL '11 weeks'
        GROUP BY 1
      ),
      items AS (
        SELECT date_trunc('week', pi.created_at AT TIME ZONE '${TZ}') AS w, COUNT(*)::int AS n
        FROM project_items pi
        INNER JOIN projects p ON p.id = pi.project_id
        WHERE p.deleted_at IS NULL AND ${ITEM_LINE_FILTER}
          AND pi.created_at >= date_trunc('week', (NOW() AT TIME ZONE '${TZ}')::timestamp) - INTERVAL '11 weeks'
        GROUP BY 1
      )
      SELECT
        to_char(weeks.w, 'IYYY-"W"IW') AS period_week,
        COALESCE(proj.n, 0)::int AS projects_count,
        COALESCE(items.n, 0)::int AS items_count,
        COALESCE(pipe.v, 0)::numeric AS pipeline_value
      FROM weeks
      LEFT JOIN proj ON proj.w = weeks.w
      LEFT JOIN pipe ON pipe.w = weeks.w
      LEFT JOIN items ON items.w = weeks.w
      ORDER BY weeks.w
    `),

    pool.query(`
      WITH months AS (
        SELECT generate_series(
          date_trunc('month', (NOW() AT TIME ZONE '${TZ}')::timestamp) - INTERVAL '11 months',
          date_trunc('month', (NOW() AT TIME ZONE '${TZ}')::timestamp),
          INTERVAL '1 month'
        ) AS m
      ),
      proj AS (
        SELECT date_trunc('month', p.created_at AT TIME ZONE '${TZ}') AS m, COUNT(*)::int AS n
        FROM projects p
        WHERE p.deleted_at IS NULL
          AND p.created_at >= date_trunc('month', (NOW() AT TIME ZONE '${TZ}')::timestamp) - INTERVAL '11 months'
        GROUP BY 1
      ),
      pipe AS (
        SELECT date_trunc('month', p.created_at AT TIME ZONE '${TZ}') AS m,
               COALESCE(SUM(pi.subtotal), 0)::numeric AS v
        FROM projects p
        LEFT JOIN project_items pi ON pi.project_id = p.id AND ${VALUE_LINE_FILTER}
        WHERE p.deleted_at IS NULL
          AND p.created_at >= date_trunc('month', (NOW() AT TIME ZONE '${TZ}')::timestamp) - INTERVAL '11 months'
        GROUP BY 1
      ),
      items AS (
        SELECT date_trunc('month', pi.created_at AT TIME ZONE '${TZ}') AS m, COUNT(*)::int AS n
        FROM project_items pi
        INNER JOIN projects p ON p.id = pi.project_id
        WHERE p.deleted_at IS NULL AND ${ITEM_LINE_FILTER}
          AND pi.created_at >= date_trunc('month', (NOW() AT TIME ZONE '${TZ}')::timestamp) - INTERVAL '11 months'
        GROUP BY 1
      )
      SELECT
        to_char(months.m, 'YYYY-MM') AS period_month,
        COALESCE(proj.n, 0)::int AS projects_count,
        COALESCE(items.n, 0)::int AS items_count,
        COALESCE(pipe.v, 0)::numeric AS pipeline_value
      FROM months
      LEFT JOIN proj ON proj.m = months.m
      LEFT JOIN pipe ON pipe.m = months.m
      LEFT JOIN items ON items.m = months.m
      ORDER BY months.m
    `),

    pool.query(`
      SELECT
        u.id,
        u.email,
        u.role,
        e.nombres,
        e.apellidos,
        COUNT(DISTINCT p.id)::int AS projects_total,
        COALESCE(SUM(pi.subtotal) FILTER (WHERE ${VALUE_LINE_FILTER}), 0)::numeric AS pipeline_value,
        COUNT(pi.id) FILTER (WHERE ${ITEM_LINE_FILTER})::int AS items_total,
        COUNT(DISTINCT p.id) FILTER (
          WHERE (p.created_at AT TIME ZONE '${TZ}')::date = (NOW() AT TIME ZONE '${TZ}')::date
        )::int AS projects_today,
        COUNT(DISTINCT p.id) FILTER (
          WHERE p.created_at >= date_trunc('week', (NOW() AT TIME ZONE '${TZ}')::timestamp)
        )::int AS projects_week,
        COUNT(DISTINCT p.id) FILTER (
          WHERE p.created_at >= date_trunc('month', (NOW() AT TIME ZONE '${TZ}')::timestamp)
        )::int AS projects_month,
        COUNT(pi.id) FILTER (
          WHERE ${ITEM_LINE_FILTER}
            AND (pi.created_at AT TIME ZONE '${TZ}')::date = (NOW() AT TIME ZONE '${TZ}')::date
        )::int AS items_today,
        COUNT(pi.id) FILTER (
          WHERE ${ITEM_LINE_FILTER}
            AND pi.created_at >= date_trunc('week', (NOW() AT TIME ZONE '${TZ}')::timestamp)
        )::int AS items_week,
        COUNT(pi.id) FILTER (
          WHERE ${ITEM_LINE_FILTER}
            AND pi.created_at >= date_trunc('month', (NOW() AT TIME ZONE '${TZ}')::timestamp)
        )::int AS items_month
      FROM users u
      INNER JOIN projects p ON p.created_by = u.id AND p.deleted_at IS NULL
      LEFT JOIN employees e ON e.user_id = u.id
      LEFT JOIN project_items pi ON pi.project_id = p.id
      GROUP BY u.id, u.email, u.role, e.nombres, e.apellidos
      ORDER BY projects_total DESC, pipeline_value DESC
    `),

    pool.query(`
      SELECT
        ci.id AS catalog_item_id,
        ci.codigo,
        ci.descripcion,
        COUNT(*)::int AS line_count,
        COUNT(DISTINCT pi.project_id)::int AS project_count,
        COALESCE(SUM(pi.qty), 0)::numeric AS total_qty,
        COALESCE(SUM(pi.subtotal), 0)::numeric AS total_subtotal
      FROM project_items pi
      INNER JOIN projects p ON p.id = pi.project_id AND p.deleted_at IS NULL
      INNER JOIN catalog_items ci ON ci.id = pi.catalog_item_id
      WHERE pi.catalog_item_id IS NOT NULL
        AND ${VALUE_LINE_FILTER}
      GROUP BY ci.id, ci.codigo, ci.descripcion
      ORDER BY line_count DESC, project_count DESC, total_qty DESC
      LIMIT 25
    `),
  ]);

  const ov = overviewRes.rows[0] || {};

  return {
    overview: {
      usersWithProjects: ov.users_with_projects || 0,
      projectsTotal: ov.projects_total || 0,
      itemsTotal: ov.items_total || 0,
      pipelineTotal: ov.pipeline_total != null ? Number(ov.pipeline_total) : 0,
      projectsToday: ov.projects_today || 0,
      projectsWeek: ov.projects_week || 0,
      projectsMonth: ov.projects_month || 0,
      itemsToday: ov.items_today || 0,
      itemsWeek: ov.items_week || 0,
      itemsMonth: ov.items_month || 0,
    },
    series: {
      day: mapSeries(projectsDayRes.rows, 'period_day'),
      week: mapSeries(projectsWeekRes.rows, 'period_week'),
      month: mapSeries(projectsMonthRes.rows, 'period_month'),
    },
    byUser: usersRes.rows.map((r) => ({
      id: r.id,
      email: r.email,
      role: r.role,
      nombres: r.nombres,
      apellidos: r.apellidos,
      projectsTotal: r.projects_total,
      pipelineValue: r.pipeline_value != null ? Number(r.pipeline_value) : 0,
      itemsTotal: r.items_total,
      projectsToday: r.projects_today,
      projectsWeek: r.projects_week,
      projectsMonth: r.projects_month,
      itemsToday: r.items_today,
      itemsWeek: r.items_week,
      itemsMonth: r.items_month,
    })),
    topCatalogItems: topItemsRes.rows.map((r) => ({
      catalogItemId: r.catalog_item_id,
      codigo: r.codigo,
      descripcion: r.descripcion,
      lineCount: r.line_count,
      projectCount: r.project_count,
      totalQty: r.total_qty != null ? Number(r.total_qty) : 0,
      totalSubtotal: r.total_subtotal != null ? Number(r.total_subtotal) : 0,
    })),
  };
}

module.exports = { loadSuperuserAnalytics };
