/**
 * Sprint 2 — catálogo API (PostgreSQL + seed; Redis opcional).
 */
const request = require('supertest');
const app = require('../../server/app');

function requireEnv() {
  if (!process.env.JWT_ACCESS_SECRET || !process.env.JWT_REFRESH_SECRET) {
    throw new Error('Configura JWT_ACCESS_SECRET y JWT_REFRESH_SECRET en .env');
  }
}

describe('Sprint 2 — catálogo', () => {
  let adminToken;
  let comercialToken;

  beforeAll(async () => {
    requireEnv();
    const adminRes = await request(app)
      .post('/api/auth/login')
      .send({ email: 'admin@zgroup.pe', password: 'ZGroup2025!' });
    if (adminRes.status !== 200) throw new Error('Login admin falló. Ejecuta: npm run seed');
    adminToken = adminRes.body.data.accessToken;

    const comRes = await request(app)
      .post('/api/auth/login')
      .send({ email: 'comercial@zgroup.pe', password: 'ZGroup2025!' });
    comercialToken = comRes.body.data.accessToken;
  });

  it('GET /api/catalog devuelve categories e items', async () => {
    const res = await request(app)
      .get('/api/catalog')
      .set('Authorization', `Bearer ${comercialToken}`)
      .expect(200);
    expect(res.body.success).toBe(true);
    expect(Array.isArray(res.body.data.categories)).toBe(true);
    expect(Array.isArray(res.body.data.items)).toBe(true);
    expect(res.body.data.items.length).toBeGreaterThan(0);
  });

  it('POST /api/catalog/categories sin rol ADMIN devuelve 403', async () => {
    const res = await request(app)
      .post('/api/catalog/categories')
      .set('Authorization', `Bearer ${comercialToken}`)
      .send({ nombre: 'Test Cat API' })
      .expect(403);
    expect(res.body.success).toBe(false);
  });

  it('POST /api/catalog/categories crea categoría (ADMIN)', async () => {
    const res = await request(app)
      .post('/api/catalog/categories')
      .set('Authorization', `Bearer ${adminToken}`)
      .send({ nombre: `Cat Test ${Date.now()}`, active: true })
      .expect(201);
    expect(res.body.success).toBe(true);
    expect(res.body.data.nombre).toBeTruthy();
  });
});
