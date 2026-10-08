import assert from 'node:assert/strict';
import type { AddressInfo } from 'node:net';
import { after, before, describe, it } from 'node:test';
import { pool } from '../src/db.js';
import { closeRealtime } from '../src/realtime.js';
import { bootstrap, createServer } from '../src/server.js';

const CUSTOMER = '9555000061';
let base = '';
let server: ReturnType<typeof createServer>;
let original: { details: object; address: string | null; phone: string | null; email: string | null; lat: number | null; lng: number | null };

async function call(method: string, path: string, token?: string, body?: unknown) {
  const res = await fetch(base + path, { method, headers: { 'content-type': 'application/json', ...(token ? { authorization: `Bearer ${token}` } : {}) }, body: body === undefined ? undefined : JSON.stringify(body) });
  const text = await res.text();
  return { status: res.status, body: text ? JSON.parse(text) : null };
}
async function login(phone: string) {
  const r = await call('POST', '/auth/dev-login', undefined, { phone, otp: '123456' });
  await call('POST', '/auth/session', r.body.token);
  return r.body.token as string;
}

describe('shop details', () => {
  let admin = '', cust = '';
  before(async () => {
    await bootstrap();
    server = createServer().listen(0);
    base = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
    const p = (await pool.query('select details from shop_profile where id = 1')).rows[0];
    const st = (await pool.query('select address, phone, email, latitude, longitude from store_settings where id = 1')).rows[0];
    original = { details: p.details, address: st.address, phone: st.phone, email: st.email, lat: st.latitude, lng: st.longitude };
    admin = await login('9000000001'); cust = await login(CUSTOMER);
  });
  after(async () => {
    await pool.query('update shop_profile set details = $1 where id = 1', [JSON.stringify(original.details)]);
    await pool.query('update store_settings set address = $1, phone = $2, email = $3, latitude = $4, longitude = $5 where id = 1', [original.address, original.phone, original.email, original.lat, original.lng]);
    await pool.query('delete from users where phone = $1', [CUSTOMER]);
    closeRealtime(); server.close();
    await pool.end();
  });

  it('lets only the admin edit the profile', async () => {
    assert.equal((await call('PUT', '/admin/shop', cust, {})).status, 403);
    assert.equal((await call('GET', '/admin/shop', cust)).status, 403);
    assert.equal((await call('PUT', '/admin/shop')).status, 401);
  });

  it('accepts a profile with nothing mandatory, and a full one', async () => {
    assert.equal((await call('PUT', '/admin/shop', admin, {})).status, 200);
    assert.equal((await call('PUT', '/admin/shop', admin, { name: '  Kamal Medical Hall ', tagline: '', licence: { gstin: '', pan: '' } })).body.details.name, 'Kamal Medical Hall');
    const full = await call('PUT', '/admin/shop', admin, {
      name: 'Kamal Medical Hall', about: 'Your family pharmacy since 1998.', ownerName: 'Kamal Jain', establishedYear: '1998',
      address: { line1: '12 Station Road', area: 'Vaishali Nagar', city: 'Ajmer', state: 'Rajasthan', pincode: '305001', landmark: 'Opp. Post Office' },
      latitude: 26.4499, longitude: 74.6399,
      phones: [{ label: 'Shop', number: '+91 98290 12345' }, { label: 'Pharmacist', number: '0145-2420000' }],
      whatsapp: '9829012345', email: 'care@kamalmedical.in', website: 'https://kamalmedical.in', hoursNote: 'Open on Sundays 10 AM to 2 PM',
      licence: { drugLicense1: 'RJ/AJM/20/1234', drugLicense2: 'RJ/AJM/21/1234', gstin: '08abcde1234f1z5', pan: 'abcde1234f', pharmacistName: 'R. Sharma', pharmacistRegNo: 'RJ-45678' },
      services: ['Home delivery', 'Cold-chain medicines'], paymentModes: ['Cash', 'UPI'],
      branches: [{ name: 'Kotra Branch', address: '5 Kotra Road', city: 'Ajmer', pincode: '305001', phone: '9829000001', mapsUrl: 'https://maps.google.com/?q=26.45,74.64' }],
    });
    assert.equal(full.status, 200);
    assert.equal(full.body.details.licence.gstin, '08ABCDE1234F1Z5', 'GST is tidied up');
    assert.equal(full.body.details.phones[0].number, '+919829012345');
    assert.equal(full.body.details.establishedYear, 1998);
  });

  it('shows customers everything except the PAN, and keeps the older settings in step', async () => {
    const pub = await call('GET', '/shop');
    assert.equal(pub.status, 200);
    assert.equal(pub.body.name, 'Kamal Medical Hall');
    assert.equal(pub.body.licence.gstin, '08ABCDE1234F1Z5');
    assert.equal(pub.body.licence.pan, undefined, 'PAN stays private');
    assert.equal(pub.body.branches.length, 1);
    assert.equal(typeof pub.body.isOpen, 'boolean');
    assert.equal((await call('GET', '/admin/shop', admin)).body.details.licence.pan, 'ABCDE1234F');
    const st = (await pool.query('select address, phone, email from store_settings where id = 1')).rows[0];
    assert.equal(st.address, '12 Station Road, Vaishali Nagar, Ajmer, Rajasthan 305001');
    assert.equal(st.phone, '+919829012345');
    assert.equal(st.email, 'care@kamalmedical.in');
    assert.equal((await call('GET', '/config')).body.store.phone, '+919829012345', 'the app\'s config reads the same number');
  });

  it('rejects values that are clearly wrong, but only when they are filled in', async () => {
    for (const bad of [{ licence: { gstin: '123' } }, { licence: { pan: 'nope' } }, { address: { pincode: '12' } }, { phones: [{ number: 'abc' }] }, { email: 'x' }, { website: 'kamal.in' }, { establishedYear: 1500 }, { branches: Array.from({ length: 21 }, () => ({})) }]) {
      const r = await call('PUT', '/admin/shop', admin, bad);
      assert.equal(r.status, 422, JSON.stringify(bad));
    }
  });
});
