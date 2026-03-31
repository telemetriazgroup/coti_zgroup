/**
 * ZGROUP — Seed de Base de Datos
 * Ejecutar: node server/db/seed.js
 *
 * Crea:
 * 1. Usuario ADMIN inicial
 * 2. 4 categorías del catálogo
 * 3. 55 ítems del catálogo (migrados desde HTML v6.0)
 */

require('dotenv').config();
const bcrypt = require('bcrypt');
const { pool, initSchema } = require('../config/db');

// ─── CATÁLOGO COMPLETO (55 ítems del HTML v6.0) ─────────────────
const CATALOG = {
  'Trab. Estructura': [
    { codigo: 'TE-001', desc: 'Panel Frigorífico Pared/Techo 100mm',       und: 'M2',  tipo: 'ACTIVO',      precio: 55.00 },
    { codigo: 'TE-002', desc: 'Panel Frigorífico Pared/Techo 150mm',       und: 'M2',  tipo: 'ACTIVO',      precio: 68.00 },
    { codigo: 'TE-003', desc: 'Panel Frigorífico Piso 100mm',              und: 'M2',  tipo: 'ACTIVO',      precio: 62.00 },
    { codigo: 'TE-004', desc: 'Panel Frigorífico Piso 150mm',              und: 'M2',  tipo: 'ACTIVO',      precio: 75.00 },
    { codigo: 'TE-005', desc: 'Perfil Angular Aluminio 50x50mm',           und: 'ML',  tipo: 'ACTIVO',      precio: 8.50  },
    { codigo: 'TE-006', desc: 'Perfil U Aluminio 100mm',                   und: 'ML',  tipo: 'ACTIVO',      precio: 12.00 },
    { codigo: 'TE-007', desc: 'Perfil T Aluminio 100mm',                   und: 'ML',  tipo: 'ACTIVO',      precio: 11.00 },
    { codigo: 'TE-008', desc: 'Zócalo PVC Blanco 100mm',                   und: 'ML',  tipo: 'ACTIVO',      precio: 4.20  },
    { codigo: 'TE-009', desc: 'Tornillo Autorroscante Galvanizado 1"',     und: 'CENT',tipo: 'CONSUMIBLE',   precio: 0.18  },
    { codigo: 'TE-010', desc: 'Tornillo Autorroscante Galvanizado 2"',     und: 'CENT',tipo: 'CONSUMIBLE',   precio: 0.25  },
    { codigo: 'TE-011', desc: 'Silicona Estructural Neutra 300ml',         und: 'UND', tipo: 'CONSUMIBLE',   precio: 9.50  },
    { codigo: 'TE-012', desc: 'Espuma Poliuretano 750ml',                  und: 'UND', tipo: 'CONSUMIBLE',   precio: 14.00 },
    { codigo: 'TE-013', desc: 'Cinta Butilo 50mm x 25m',                  und: 'ROL', tipo: 'CONSUMIBLE',   precio: 18.50 },
    { codigo: 'TE-014', desc: 'Soporte Omega Galvanizado',                 und: 'UND', tipo: 'ACTIVO',      precio: 3.80  },
    { codigo: 'TE-015', desc: 'Estructura Metálica Galvanizada 2"x2"',     und: 'ML',  tipo: 'ACTIVO',      precio: 15.00 },
    { codigo: 'TE-016', desc: 'Placa Base Anclaje 150x150mm',              und: 'UND', tipo: 'ACTIVO',      precio: 6.50  },
    { codigo: 'TE-017', desc: 'Perno Expansivo 3/8"x3"',                  und: 'UND', tipo: 'CONSUMIBLE',   precio: 1.20  },
    { codigo: 'TE-018', desc: 'Varilla Roscada Galvanizada 3/8" x 1m',    und: 'UND', tipo: 'CONSUMIBLE',   precio: 3.50  },
    { codigo: 'TE-019', desc: 'Pintura Anticorrosiva Epóxica (GL)',        und: 'GLN', tipo: 'CONSUMIBLE',   precio: 45.00 },
    { codigo: 'TE-020', desc: 'Mano de Obra Montaje Estructura (m2)',      und: 'M2',  tipo: 'CONSUMIBLE',   precio: 12.00 },
    { codigo: 'TE-021', desc: 'Traslado y Logística Equipos',              und: 'GLB', tipo: 'CONSUMIBLE',   precio: 350.00},
  ],
  'Sistema de Frio': [
    { codigo: 'SF-001', desc: 'Unidad Condensadora 1HP R404A',             und: 'UND', tipo: 'ACTIVO',      precio: 1200.00},
    { codigo: 'SF-002', desc: 'Unidad Condensadora 2HP R404A',             und: 'UND', tipo: 'ACTIVO',      precio: 1850.00},
    { codigo: 'SF-003', desc: 'Unidad Condensadora 3HP R404A',             und: 'UND', tipo: 'ACTIVO',      precio: 2400.00},
    { codigo: 'SF-004', desc: 'Evaporador Cubico 1000W',                   und: 'UND', tipo: 'ACTIVO',      precio: 680.00 },
    { codigo: 'SF-005', desc: 'Evaporador Cubico 1500W',                   und: 'UND', tipo: 'ACTIVO',      precio: 920.00 },
    { codigo: 'SF-006', desc: 'Válvula Expansión Termostática 1/4"',       und: 'UND', tipo: 'ACTIVO',      precio: 95.00  },
    { codigo: 'SF-007', desc: 'Control de Temperatura Digital',            und: 'UND', tipo: 'ACTIVO',      precio: 85.00  },
    { codigo: 'SF-008', desc: 'Instalación y Carga Refrigerante (Servicio)',und: 'GLB', tipo: 'CONSUMIBLE',  precio: 450.00 },
  ],
  'Accesorios': [
    { codigo: 'AC-001', desc: 'Lámpara LED Interna 18W IP65',              und: 'UND', tipo: 'ACTIVO',      precio: 45.00  },
    { codigo: 'AC-002', desc: 'Lámpara LED Interna 36W IP65',              und: 'UND', tipo: 'ACTIVO',      precio: 75.00  },
    { codigo: 'AC-003', desc: 'Interruptor Iluminación IP65',              und: 'UND', tipo: 'ACTIVO',      precio: 28.00  },
    { codigo: 'AC-004', desc: 'Tomacorriente Industrial IP65',             und: 'UND', tipo: 'ACTIVO',      precio: 35.00  },
    { codigo: 'AC-005', desc: 'Termómetro Digital Exterior',               und: 'UND', tipo: 'ACTIVO',      precio: 55.00  },
    { codigo: 'AC-006', desc: 'Sensor de Temperatura Pt100',               und: 'UND', tipo: 'ACTIVO',      precio: 42.00  },
    { codigo: 'AC-007', desc: 'Alarma Temperatura con Buzzer 110dB',       und: 'UND', tipo: 'ACTIVO',      precio: 65.00  },
    { codigo: 'AC-008', desc: 'Canaleta PVC 40x25mm',                     und: 'ML',  tipo: 'CONSUMIBLE',   precio: 3.80   },
    { codigo: 'AC-009', desc: 'Cable THW 14AWG (m)',                      und: 'ML',  tipo: 'CONSUMIBLE',   precio: 1.20   },
    { codigo: 'AC-010', desc: 'Breaker Termomagnetico 20A',               und: 'UND', tipo: 'ACTIVO',      precio: 22.00  },
    { codigo: 'AC-011', desc: 'Tablero Eléctrico 4 Polos',                und: 'UND', tipo: 'ACTIVO',      precio: 85.00  },
    { codigo: 'AC-012', desc: 'Cortina de Tiras PVC Transparente 2mx1m',  und: 'UND', tipo: 'ACTIVO',      precio: 120.00 },
    { codigo: 'AC-013', desc: 'Rampa de Carga PVC 200x30cm',              und: 'UND', tipo: 'ACTIVO',      precio: 95.00  },
    { codigo: 'AC-014', desc: 'Señalética Seguridad Cámara Frigorífica',   und: 'KIT', tipo: 'CONSUMIBLE',   precio: 45.00  },
    { codigo: 'AC-015', desc: 'Bisagra Piano Acero Inox 1.8m',            und: 'UND', tipo: 'ACTIVO',      precio: 55.00  },
    { codigo: 'AC-016', desc: 'Manija Interior Emergencia',               und: 'UND', tipo: 'ACTIVO',      precio: 38.00  },
    { codigo: 'AC-017', desc: 'Llave Cierre Exterior con Llave',          und: 'UND', tipo: 'ACTIVO',      precio: 45.00  },
    { codigo: 'AC-018', desc: 'Resistencia Antiescarcha Marco Puerta 80W', und: 'UND', tipo: 'ACTIVO',      precio: 65.00  },
  ],
  'Puertas': [
    { codigo: 'PU-001', desc: 'Puerta Frigorífica Abatible 0.8x1.9m',     und: 'UND', tipo: 'ACTIVO',      precio: 850.00 },
    { codigo: 'PU-002', desc: 'Puerta Frigorífica Abatible 1.0x2.0m',     und: 'UND', tipo: 'ACTIVO',      precio: 980.00 },
    { codigo: 'PU-003', desc: 'Puerta Frigorífica Abatible 1.2x2.1m',     und: 'UND', tipo: 'ACTIVO',      precio: 1150.00},
    { codigo: 'PU-004', desc: 'Puerta Frigorífica Corredera 1.5x2.0m',    und: 'UND', tipo: 'ACTIVO',      precio: 1450.00},
    { codigo: 'PU-005', desc: 'Puerta Frigorífica Corredera 2.0x2.2m',    und: 'UND', tipo: 'ACTIVO',      precio: 1850.00},
    { codigo: 'PU-006', desc: 'Marco Puerta Panel 100mm (Kit)',            und: 'KIT', tipo: 'ACTIVO',      precio: 320.00 },
    { codigo: 'PU-007', desc: 'Marco Puerta Panel 150mm (Kit)',            und: 'KIT', tipo: 'ACTIVO',      precio: 380.00 },
    { codigo: 'PU-008', desc: 'Instalación Puerta Frigorífica',           und: 'UND', tipo: 'CONSUMIBLE',   precio: 180.00 },
  ],
};

async function seed() {
  const client = await pool.connect();
  try {
    await client.query('BEGIN');

    console.log('🌱 Iniciando seed de ZGROUP Cotizaciones...\n');

    // ── 1. ADMIN INICIAL ──────────────────────────────────────────
    const adminEmail    = process.env.ADMIN_EMAIL    || 'admin@zgroup.pe';
    const adminPassword = process.env.ADMIN_PASSWORD || 'ZGroup2025!';

    const { rows: existingAdmin } = await client.query(
      'SELECT id FROM users WHERE email = $1', [adminEmail]
    );

    let adminId;
    if (existingAdmin.length === 0) {
      const passwordHash = await bcrypt.hash(adminPassword, 12);
      const { rows: adminRows } = await client.query(
        `INSERT INTO users (email, password_hash, role) VALUES ($1, $2, 'ADMIN') RETURNING id`,
        [adminEmail, passwordHash]
      );
      adminId = adminRows[0].id;

      await client.query(
        `INSERT INTO employees (user_id, nombres, apellidos, cargo)
         VALUES ($1, 'Administrador', 'ZGROUP', 'Administrador del Sistema')`,
        [adminId]
      );
      console.log(`✅ Admin creado: ${adminEmail} / ${adminPassword}`);
    } else {
      adminId = existingAdmin[0].id;
      console.log(`ℹ️  Admin ya existe: ${adminEmail}`);
    }

    // ── 2. DEMO COMERCIAL ─────────────────────────────────────────
    const comercialEmail = 'comercial@zgroup.pe';
    const { rows: existingComercial } = await client.query(
      'SELECT id FROM users WHERE email = $1', [comercialEmail]
    );

    if (existingComercial.length === 0) {
      const comercialHash = await bcrypt.hash('ZGroup2025!', 12);
      const { rows: comRows } = await client.query(
        `INSERT INTO users (email, password_hash, role) VALUES ($1, $2, 'COMERCIAL') RETURNING id`,
        [comercialEmail, comercialHash]
      );
      await client.query(
        `INSERT INTO employees (user_id, nombres, apellidos, cargo, telefono)
         VALUES ($1, 'Juan Carlos', 'Mendoza Torres', 'Ejecutivo Comercial', '+51 987 654 321')`,
        [comRows[0].id]
      );
      console.log(`✅ Comercial demo creado: ${comercialEmail} / ZGroup2025!`);
    }

    // ── 2b. CLIENTE + PROYECTO DEMO (Sprint 1) ────────────────────
    const { rows: comercialUser } = await client.query(`SELECT id FROM users WHERE email = $1`, [
      comercialEmail,
    ]);
    if (comercialUser.length) {
      const demoRuc = '20601234567';
      const { rows: exCl } = await client.query(`SELECT id FROM clients WHERE ruc = $1`, [demoRuc]);
      if (!exCl.length) {
        const { rows: cl } = await client.query(
          `INSERT INTO clients (razon_social, ruc, ciudad, contacto_email, created_by)
           VALUES ($1, $2, $3, $4, $5) RETURNING id`,
          ['Cliente Demo SAC', demoRuc, 'Lima', 'demo@cliente.pe', adminId]
        );
        await client.query(
          `INSERT INTO projects (nombre, odoo_ref, client_id, status, created_by)
           VALUES ($1, $2, $3, 'BORRADOR', $4)`,
          ['Proyecto Demo Cotización', 'ODOO-DEMO-001', cl[0].id, comercialUser[0].id]
        );
        console.log('✅ Cliente demo + proyecto demo (comercial)');
      }
    }

    // ── 3. CATÁLOGO ──────────────────────────────────────────────
    let totalItems = 0;
    let sortOrder  = 0;

    for (const [categoryName, items] of Object.entries(CATALOG)) {
      // Verificar si la categoría ya existe
      const { rows: existingCat } = await client.query(
        'SELECT id FROM catalog_categories WHERE nombre = $1', [categoryName]
      );

      let categoryId;
      if (existingCat.length === 0) {
        const { rows: catRows } = await client.query(
          `INSERT INTO catalog_categories (nombre, sort_order) VALUES ($1, $2) RETURNING id`,
          [categoryName, sortOrder++]
        );
        categoryId = catRows[0].id;
        console.log(`📁 Categoría creada: ${categoryName}`);
      } else {
        categoryId = existingCat[0].id;
        console.log(`ℹ️  Categoría ya existe: ${categoryName}`);
      }

      // Insertar ítems de la categoría
      let itemOrder = 0;
      for (const item of items) {
        const { rows: existingItem } = await client.query(
          'SELECT id FROM catalog_items WHERE codigo = $1', [item.codigo]
        );

        if (existingItem.length === 0) {
          await client.query(
            `INSERT INTO catalog_items
               (category_id, codigo, descripcion, unidad, tipo, unit_price, sort_order, created_by)
             VALUES ($1, $2, $3, $4, $5, $6, $7, $8)`,
            [categoryId, item.codigo, item.desc, item.und, item.tipo, item.precio, itemOrder++, adminId]
          );
          totalItems++;
        }
      }
    }

    console.log(`✅ Catálogo: ${totalItems} nuevos ítems creados`);

    await client.query('COMMIT');
    console.log('\n✅ Seed completado exitosamente!');
    console.log('─────────────────────────────────────');
    console.log('  Admin:      admin@zgroup.pe');
    console.log('  Comercial:  comercial@zgroup.pe');
    console.log('  Password:   ZGroup2025!');
    console.log('─────────────────────────────────────\n');

  } catch (err) {
    await client.query('ROLLBACK');
    console.error('❌ Seed error:', err.message);
    throw err;
  } finally {
    client.release();
    await pool.end();
  }
}

// Inicializar schema antes de seedear
initSchema()
  .then(() => seed())
  .catch((err) => {
    console.error('Fatal:', err);
    process.exit(1);
  });
