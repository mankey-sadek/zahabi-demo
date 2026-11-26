// Isolation test (NFR-21): two shops, each token only ever sees its own database.
// Run against a live server: API_URL=http://localhost:3000 npm test
import { test } from 'node:test';
import assert from 'node:assert/strict';

const API = (process.env.API_URL ?? 'http://localhost:3000') + '/api/v2';
const uniq = Date.now().toString(36);

async function call(path: string, body?: unknown, token?: string) {
  const res = await fetch(API + path, {
    method: body ? 'POST' : 'GET',
    headers: { 'content-type': 'application/json', ...(token ? { authorization: `Bearer ${token}` } : {}) },
    body: body ? JSON.stringify(body) : undefined,
  });
  return { status: res.status, body: await res.json() };
}

async function signup(slug: string, phone: string) {
  const r = await call('/tenants', { shopName: `محل ${slug}`, slug, ownerName: 'اختبار', phone, password: 'secret123' });
  assert.equal(r.status, 201, JSON.stringify(r.body));
  return r.body as { token: string; tenant: { dbName: string } };
}

test('each shop gets its own database and never sees another shop', async () => {
  const a = await signup(`iso-a-${uniq}`, `010${String(Date.now()).slice(-8)}`);
  const b = await signup(`iso-b-${uniq}`, `011${String(Date.now() + 1).slice(-8)}`);
  assert.notEqual(a.tenant.dbName, b.tenant.dbName);

  const added = await call('/items', { name: 'خاتم اختبار', karat: 21, weightG: 3, makingPerGEgp: 50 }, a.token);
  assert.equal(added.status, 201);

  const itemsA = (await call('/items', undefined, a.token)).body as unknown[];
  const itemsB = (await call('/items', undefined, b.token)).body as unknown[];
  assert.equal(itemsA.length, 1);
  assert.equal(itemsB.length, 0, 'shop B must not see shop A items');

  // Shop B cannot sell shop A's item: the id does not exist in B's database.
  const sell = await call('/pos/sell', { itemIds: [1] }, b.token);
  assert.equal(sell.status, 404);

  const meB = (await call('/me', undefined, b.token)).body as { connectedDatabase: string };
  assert.equal(meB.connectedDatabase, b.tenant.dbName);
});

test('a platform token cannot open shop data', async () => {
  const admin = await call('/admin/login', { user: process.env.PLATFORM_USER ?? 'admin', password: process.env.PLATFORM_PASSWORD ?? 'admin123' });
  const r = await call('/items', undefined, admin.body.token);
  assert.equal(r.status, 401);
});

test('a forged or missing token is refused', async () => {
  assert.equal((await call('/items')).status, 401);
  assert.equal((await call('/items', undefined, 'not-a-token')).status, 401);
});

test('one phone with two shops can log in to either one', async () => {
  const phone = `012${String(Date.now()).slice(-8)}`;
  const first = await signup(`multi-a-${uniq}`, phone);
  const second = await call('/tenants', { shopName: 'محل تاني', slug: `multi-b-${uniq}`, ownerName: 'اسم تاني', phone, password: 'secret123' });
  assert.equal(second.status, 201, JSON.stringify(second.body));
  assert.equal(second.body.existingAccount, true);
  assert.equal(second.body.user.name, 'اختبار', 'the existing owner name is kept');

  const login = await call('/auth/login', { phone, password: 'secret123' });
  assert.equal(login.status, 200);
  assert.equal(login.body.tenants.length, 2);

  const pickB = await call('/auth/login', { phone, password: 'secret123', tenantId: second.body.tenant.id });
  const meB = (await call('/me', undefined, pickB.body.token)).body as { connectedDatabase: string };
  assert.equal(meB.connectedDatabase, second.body.tenant.dbName);
  const meA = (await call('/me', undefined, login.body.token)).body as { connectedDatabase: string };
  assert.equal(meA.connectedDatabase, first.tenant.dbName);
});
