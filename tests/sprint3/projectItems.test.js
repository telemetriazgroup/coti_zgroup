/**
 * Sprint 3 — ítems de presupuesto (project_items).
 */
const request = require('supertest');
const app = require('../../server/app');

function requireEnv() {
  if (!process.env.JWT_ACCESS_SECRET || !process.env.JWT_REFRESH_SECRET) {
    throw new Error('Configura JWT_ACCESS_SECRET y JWT_REFRESH_SECRET en .env');
  }
}

describe('Sprint 3 — project items', () => {
  let comercialToken;
  let projectId;
  let catalogItemId;

  beforeAll(async () => {
    requireEnv();
    const comRes = await request(app)
      .post('/api/auth/login')
      .send({ email: 'comercial@zgroup.pe', password: 'ZGroup2025!' });
    if (comRes.status !== 200) throw new Error('Login comercial falló. Ejecuta: npm run seed');
    comercialToken = comRes.body.data.accessToken;

    const list = await request(app)
      .get('/api/projects')
      .set('Authorization', `Bearer ${comercialToken}`)
      .expect(200);
    const demo = list.body.data.find((p) => p.nombre && p.nombre.includes('Demo'));
    if (!demo) throw new Error('No hay proyecto demo en BD');
    projectId = demo.id;

    const cat = await request(app)
      .get('/api/catalog')
      .set('Authorization', `Bearer ${comercialToken}`)
      .expect(200);
    const te = cat.body.data.items.find((i) => i.codigo === 'TE-001');
    if (!te) throw new Error('Catálogo sin TE-001');
    catalogItemId = te.id;
  });

  it('GET /api/projects/:id/items devuelve items y totales', async () => {
    const res = await request(app)
      .get(`/api/projects/${projectId}/items`)
      .set('Authorization', `Bearer ${comercialToken}`)
      .expect(200);
    expect(res.body.success).toBe(true);
    expect(Array.isArray(res.body.data.items)).toBe(true);
    expect(res.body.data.totals).toBeDefined();
    expect(res.body.data.totals).toHaveProperty('lista');
  });

  it('POST agrega ítem de catálogo; segundo POST con mismo precio fusiona cantidad', async () => {
    await request(app)
      .delete(`/api/projects/${projectId}/items`)
      .set('Authorization', `Bearer ${comercialToken}`)
      .expect(200);

    const r1 = await request(app)
      .post(`/api/projects/${projectId}/items`)
      .set('Authorization', `Bearer ${comercialToken}`)
      .send({ catalogItemId, qty: 1 })
      .expect(201);
    expect(r1.body.data.items.length).toBe(1);
    expect(Number(r1.body.data.items[0].qty)).toBe(1);

    const r2 = await request(app)
      .post(`/api/projects/${projectId}/items`)
      .set('Authorization', `Bearer ${comercialToken}`)
      .send({ catalogItemId, qty: 2 })
      .expect(200);
    expect(r2.body.data.merged).toBe(true);
    expect(r2.body.data.items.length).toBe(1);
    expect(Number(r2.body.data.items[0].qty)).toBe(3);
  });

  it('primer ítem pasa proyecto BORRADOR a EN_SEGUIMIENTO', async () => {
    await request(app)
      .delete(`/api/projects/${projectId}/items`)
      .set('Authorization', `Bearer ${comercialToken}`)
      .expect(200);

    const p0 = await request(app)
      .put(`/api/projects/${projectId}`)
      .set('Authorization', `Bearer ${comercialToken}`)
      .send({ status: 'BORRADOR' })
      .expect(200);
    expect(p0.body.data.status).toBe('BORRADOR');

    const r = await request(app)
      .post(`/api/projects/${projectId}/items`)
      .set('Authorization', `Bearer ${comercialToken}`)
      .send({ catalogItemId, qty: 1 })
      .expect(201);
    expect(r.body.data.projectStatus).toBe('EN_SEGUIMIENTO');

    const p1 = await request(app)
      .get(`/api/projects/${projectId}`)
      .set('Authorization', `Bearer ${comercialToken}`)
      .expect(200);
    expect(p1.body.data.status).toBe('EN_SEGUIMIENTO');
  });
});
