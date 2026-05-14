jest.mock('../db', () => ({
  query: jest.fn(),
  getConnection: jest.fn(),
}));

const request = require('supertest');
const app = require('../app');

// All API routes require authentication. These tests verify that
// unauthenticated requests are rejected before any DB interaction.
describe('API access control — unauthenticated requests', () => {
  const jsonHeader = { Accept: 'application/json' };

  test('GET /api/tests returns 401', async () => {
    const res = await request(app).get('/api/tests').set(jsonHeader);
    expect(res.status).toBe(401);
    expect(res.body.message).toMatch(/not authenticated/i);
  });

  test('GET /api/trends returns 401', async () => {
    const res = await request(app).get('/api/trends').set(jsonHeader);
    expect(res.status).toBe(401);
  });

  test('GET /api/latest-markers returns 401', async () => {
    const res = await request(app).get('/api/latest-markers').set(jsonHeader);
    expect(res.status).toBe(401);
  });

  test('GET /api/profile returns 401', async () => {
    const res = await request(app).get('/api/profile').set(jsonHeader);
    expect(res.status).toBe(401);
  });

  test('PUT /api/profile returns 401', async () => {
    const res = await request(app).put('/api/profile').set(jsonHeader).send({});
    expect(res.status).toBe(401);
  });

  test('POST /api/tests/manual returns 401', async () => {
    const res = await request(app)
      .post('/api/tests/manual')
      .set(jsonHeader)
      .send({ testDate: '2024-01-01', markers: [{ marker_name: 'Iron', value: 12 }] });
    expect(res.status).toBe(401);
  });

  test('POST /api/tests/:testId/analyse returns 401', async () => {
    const res = await request(app).post('/api/tests/42/analyse').set(jsonHeader);
    expect(res.status).toBe(401);
  });

  test('GET /api/export returns 401', async () => {
    const res = await request(app).get('/api/export').set(jsonHeader);
    expect(res.status).toBe(401);
  });

  test('DELETE /api/account returns 401', async () => {
    const res = await request(app).delete('/api/account').set(jsonHeader);
    expect(res.status).toBe(401);
  });

  test('POST /upload returns 401', async () => {
    const res = await request(app).post('/upload').set(jsonHeader);
    expect(res.status).toBe(401);
  });
});

describe('Protected pages — unauthenticated redirect', () => {
  test('GET /dashboard redirects to /login', async () => {
    const res = await request(app).get('/dashboard');
    expect(res.status).toBe(302);
    expect(res.headers.location).toBe('/login');
  });

  test('GET /tests redirects to /login', async () => {
    const res = await request(app).get('/tests');
    expect(res.status).toBe(302);
    expect(res.headers.location).toBe('/login');
  });

  test('GET /trends redirects to /login', async () => {
    const res = await request(app).get('/trends');
    expect(res.status).toBe(302);
    expect(res.headers.location).toBe('/login');
  });
});
