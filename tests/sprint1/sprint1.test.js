/**
 * Sprint 1 — empleados, clientes, proyectos (requiere PostgreSQL + seed).
 */
const request = require('supertest');
const app = require('../../server/app');

function requireEnv() {
  if (!process.env.JWT_ACCESS_SECRET || !process.env.JWT_REFRESH_SECRET) {
    throw new Error('Configura JWT_ACCESS_SECRET y JWT_REFRESH_SECRET en .env');
  }
}

describe('Sprint 1 — employees & clients', () => {
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
    if (comRes.status !== 200) throw new Error('Login comercial falló');
    comercialToken = comRes.body.data.accessToken;
  });

  it('GET /api/employees/me devuelve employee para admin', async () => {
    const res = await request(app)
      .get('/api/employees/me')
      .set('Authorization', `Bearer ${adminToken}`)
      .expect(200);
    expect(res.body.success).toBe(true);
    expect(res.body.data.employee).toBeTruthy();
    expect(res.body.data.employee.nombres).toBeTruthy();
  });

  it('GET /api/clients devuelve lista con projectCount', async () => {
    const res = await request(app)
      .get('/api/clients')
      .set('Authorization', `Bearer ${comercialToken}`)
      .expect(200);
    expect(res.body.success).toBe(true);
    expect(Array.isArray(res.body.data)).toBe(true);
    const demo = res.body.data.find((c) => c.razonSocial === 'Cliente Demo SAC');
    if (demo) expect(demo.projectCount).toBeGreaterThanOrEqual(0);
  });

  it('POST /api/clients crea cliente (comercial)', async () => {
    const res = await request(app)
      .post('/api/clients')
      .set('Authorization', `Bearer ${comercialToken}`)
      .send({
        razonSocial: 'Cliente Test API Sprint1',
        ruc: '20999999999',
        ciudad: 'Lima',
      })
      .expect(201);
    expect(res.body.success).toBe(true);
    expect(res.body.data.razonSocial).toContain('Test API');
  });

  it('GET /api/users/viewers devuelve array (comercial)', async () => {
    const res = await request(app)
      .get('/api/users/viewers')
      .set('Authorization', `Bearer ${comercialToken}`)
      .expect(200);
    expect(res.body.success).toBe(true);
    expect(Array.isArray(res.body.data)).toBe(true);
  });

  it('GET /api/dashboard/summary devuelve KPIs', async () => {
    const res = await request(app)
      .get('/api/dashboard/summary')
      .set('Authorization', `Bearer ${comercialToken}`)
      .expect(200);
    expect(res.body.success).toBe(true);
    expect(typeof res.body.data.projectsActive).toBe('number');
    expect(typeof res.body.data.clientsTotal).toBe('number');
  });
});

describe('Sprint 1 — proyectos', () => {
  let adminToken;
  let comercialToken;

  beforeAll(async () => {
    requireEnv();
    const adminRes = await request(app)
      .post('/api/auth/login')
      .send({ email: 'admin@zgroup.pe', password: 'ZGroup2025!' });
    adminToken = adminRes.body.data.accessToken;

    const comRes = await request(app)
      .post('/api/auth/login')
      .send({ email: 'comercial@zgroup.pe', password: 'ZGroup2025!' });
    comercialToken = comRes.body.data.accessToken;
  });

  it('GET /api/projects lista proyectos para comercial', async () => {
    const res = await request(app)
      .get('/api/projects')
      .set('Authorization', `Bearer ${comercialToken}`)
      .expect(200);
    expect(res.body.success).toBe(true);
    expect(Array.isArray(res.body.data)).toBe(true);
  });

  it('POST /api/projects crea proyecto (comercial)', async () => {
    const res = await request(app)
      .post('/api/projects')
      .set('Authorization', `Bearer ${comercialToken}`)
      .send({
        nombre: 'Proyecto Test Sprint1',
        odooRef: 'TST-S1-001',
      })
      .expect(201);
    expect(res.body.success).toBe(true);
    expect(res.body.data.nombre).toBe('Proyecto Test Sprint1');
  });

  it('GET /api/projects admin incluye demo u otros proyectos', async () => {
    const res = await request(app)
      .get('/api/projects')
      .set('Authorization', `Bearer ${adminToken}`)
      .expect(200);
    expect(res.body.data.length).toBeGreaterThan(0);
  });
});
