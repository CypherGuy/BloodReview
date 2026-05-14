jest.mock('../db', () => ({
  query: jest.fn(),
  getConnection: jest.fn(),
}));

const request = require('supertest');
const app = require('../app');

describe('POST /signup — input validation', () => {
  test('returns 400 when both fields are missing', async () => {
    const res = await request(app).post('/signup').send({});
    expect(res.status).toBe(400);
    expect(res.body.message).toMatch(/required/i);
  });

  test('returns 400 when username is missing', async () => {
    const res = await request(app).post('/signup').send({ password: 'securepass' });
    expect(res.status).toBe(400);
    expect(res.body.message).toMatch(/required/i);
  });

  test('returns 400 when password is missing', async () => {
    const res = await request(app).post('/signup').send({ username: 'alice' });
    expect(res.status).toBe(400);
    expect(res.body.message).toMatch(/required/i);
  });

  test('returns 400 when username is shorter than 3 characters', async () => {
    const res = await request(app).post('/signup').send({ username: 'ab', password: 'securepass' });
    expect(res.status).toBe(400);
    expect(res.body.message).toMatch(/3 characters/i);
  });

  test('returns 400 when password is shorter than 8 characters', async () => {
    const res = await request(app).post('/signup').send({ username: 'alice', password: 'short' });
    expect(res.status).toBe(400);
    expect(res.body.message).toMatch(/8 characters/i);
  });
});

describe('POST /login — input validation', () => {
  test('returns 400 when both fields are missing', async () => {
    const res = await request(app).post('/login').send({});
    expect(res.status).toBe(400);
    expect(res.body.message).toMatch(/required/i);
  });

  test('returns 400 when username is missing', async () => {
    const res = await request(app).post('/login').send({ password: 'securepass' });
    expect(res.status).toBe(400);
    expect(res.body.message).toMatch(/required/i);
  });

  test('returns 400 when password is missing', async () => {
    const res = await request(app).post('/login').send({ username: 'alice' });
    expect(res.status).toBe(400);
    expect(res.body.message).toMatch(/required/i);
  });
});
