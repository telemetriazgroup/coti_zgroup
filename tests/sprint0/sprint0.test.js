/**
 * Sprint 0 — pruebas de integración API (requiere PostgreSQL + schema + seed).
 * Ejecutar: npm run seed && npm test
 * (dotenv se carga desde vitest.config setupFiles: tests/setup.js)
 */
const request = require('supertest');
const app = require('../../server/app');

function requireEnv() {
  if (!process.env.JWT_ACCESS_SECRET || !process.env.JWT_REFRESH_SECRET) {
    throw new Error('Configura JWT_ACCESS_SECRET y JWT_REFRESH_SECRET en .env (ver .env.example)');
  }
}

describe('Sprint 0 — health y auth', () => {
  beforeAll(() => {
    requireEnv();
  });

  it('GET /api/health devuelve success y status ok', async () => {
    const res = await request(app).get('/api/health').expect(200);
    expect(res.body.success).toBe(true);
    expect(res.body.data.status).toBe('ok');
  });

  it('POST /api/auth/login sin credenciales devuelve 400', async () => {
    const res = await request(app).post('/api/auth/login').send({}).expect(400);
    expect(res.body.success).toBe(false);
    expect(res.body.error.code).toBe('VALIDATION_ERROR');
  });

  it('POST /api/auth/login con contraseña incorrecta devuelve 401 y Credenciales incorrectas', async () => {
    const res = await request(app)
      .post('/api/auth/login')
      .send({ email: 'admin@zgroup.pe', password: 'incorrecta' })
      .expect(401);
    expect(res.body.success).toBe(false);
    expect(res.body.error.code).toBe('INVALID_CREDENTIALS');
    expect(res.body.error.message).toMatch(/Credenciales incorrectas/i);
  });

  it('POST /api/auth/login admin correcto devuelve accessToken y user', async () => {
    const res = await request(app)
      .post('/api/auth/login')
      .send({ email: 'admin@zgroup.pe', password: 'ZGroup2025!' })
      .expect(200);
    expect(res.body.success).toBe(true);
    expect(res.body.data.accessToken).toBeTruthy();
    expect(res.body.data.user.role).toBe('ADMIN');
  });

  it('GET /api/auth/session sin cookie devuelve 200 authenticated false', async () => {
    const res = await request(app).get('/api/auth/session').expect(200);
    expect(res.body.success).toBe(true);
    expect(res.body.data.authenticated).toBe(false);
  });

  it('POST /api/auth/refresh sin cookie devuelve 401', async () => {
    const res = await request(app).post('/api/auth/refresh').expect(401);
    expect(res.body.success).toBe(false);
  });

  it('GET /api/users sin token devuelve 401', async () => {
    const res = await request(app).get('/api/users').expect(401);
    expect(res.body.error.code).toBe('UNAUTHORIZED');
  });
});

describe('Sprint 0 — roles y sesión', () => {
  let adminToken;
  let comercialToken;

  beforeAll(async () => {
    requireEnv();
    const adminRes = await request(app)
      .post('/api/auth/login')
      .send({ email: 'admin@zgroup.pe', password: 'ZGroup2025!' });
    if (adminRes.status !== 200) {
      throw new Error('Login admin falló. Ejecuta: npm run seed');
    }
    adminToken = adminRes.body.data.accessToken;

    const comRes = await request(app)
      .post('/api/auth/login')
      .send({ email: 'comercial@zgroup.pe', password: 'ZGroup2025!' });
    if (comRes.status !== 200) {
      throw new Error('Login comercial falló. Ejecuta: npm run seed');
    }
    comercialToken = comRes.body.data.accessToken;
  });

  it('GET /api/users con rol COMERCIAL devuelve 403 FORBIDDEN', async () => {
    const res = await request(app)
      .get('/api/users')
      .set('Authorization', `Bearer ${comercialToken}`)
      .expect(403);
    expect(res.body.error.code).toBe('FORBIDDEN');
  });

  it('GET /api/users con rol ADMIN devuelve lista', async () => {
    const res = await request(app)
      .get('/api/users')
      .set('Authorization', `Bearer ${adminToken}`)
      .expect(200);
    expect(res.body.success).toBe(true);
    expect(Array.isArray(res.body.data)).toBe(true);
  });

  it('POST /api/auth/logout con token revoca sesión y responde success', async () => {
    const agent = request.agent(app);
    const login = await agent
      .post('/api/auth/login')
      .send({ email: 'admin@zgroup.pe', password: 'ZGroup2025!' });
    expect(login.status).toBe(200);

    const out = await agent
      .post('/api/auth/logout')
      .set('Authorization', `Bearer ${login.body.data.accessToken}`)
      .expect(200);
    expect(out.body.success).toBe(true);
  });
});
