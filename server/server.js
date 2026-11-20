/* Optional backend: issues passes, sends SMS (Twilio), validates gate scans.
 * Run: npm install && npm start  → http://localhost:3000
 * Without Twilio env vars the SMS is logged to the console (demo-safe).
 */
'use strict';
const path = require('path');
const crypto = require('crypto');
const express = require('express');

const PORT = process.env.PORT || 3000;
const PUBLIC_URL = (process.env.PUBLIC_URL || `http://localhost:${PORT}`).replace(/\/$/, '');
const { TWILIO_ACCOUNT_SID, TWILIO_AUTH_TOKEN, TWILIO_FROM } = process.env;

let twilioClient = null;
if (TWILIO_ACCOUNT_SID && TWILIO_AUTH_TOKEN && TWILIO_FROM) {
  twilioClient = require('twilio')(TWILIO_ACCOUNT_SID, TWILIO_AUTH_TOKEN);
}

const app = express();
app.use(express.json({ limit: '10kb' }));
app.use(express.static(path.join(__dirname, '..', 'docs')));

/** In-memory store for the demo. Replace with a database in production. */
const passes = new Map();

/* naive per-IP rate limit: 10 registrations / minute */
const hits = new Map();
function rateLimit(req, res, next) {
  const now = Date.now();
  const arr = (hits.get(req.ip) || []).filter((t) => now - t < 60_000);
  if (arr.length >= 10) return res.status(429).json({ error: 'Too many requests, try again shortly.' });
  arr.push(now);
  hits.set(req.ip, arr);
  next();
}

const str = (v, max) => String(v ?? '').trim().slice(0, max);

app.get('/api/health', (_req, res) => res.json({ ok: true, sms: twilioClient ? 'twilio' : 'console' }));

app.post('/api/visitors', rateLimit, async (req, res) => {
  const b = req.body || {};
  const visitor = {
    purpose: str(b.purpose, 80),
    fullName: str(b.fullName, 80),
    company: str(b.company, 80),
    phone: str(b.phone, 16),
    email: str(b.email, 120),
    host: str(b.host, 80),
    idNumber: str(b.idNumber, 4),
    visitDate: str(b.visitDate, 10),
    vehicle: str(b.vehicle, 12),
  };
  if (!visitor.purpose || visitor.fullName.length < 2 || !visitor.host) return res.status(400).json({ error: 'Missing required fields.' });
  if (!/^\+\d{7,15}$/.test(visitor.phone)) return res.status(400).json({ error: 'Invalid phone number.' });
  if (!/^\d{4}-\d{2}-\d{2}$/.test(visitor.visitDate)) return res.status(400).json({ error: 'Invalid visit date.' });

  const id = 'VG' + crypto.randomBytes(3).toString('hex').toUpperCase();
  const token = crypto.randomBytes(12).toString('hex');
  const validUntil = new Date(visitor.visitDate + 'T23:59:59').toISOString();
  const code = `VG1.${id}.${token}`;
  passes.set(id, { id, token, visitor, validUntil, used: false });

  // SMS cannot embed an image, so we send a link that renders the QR (or use MMS/WhatsApp).
  const link = `${PUBLIC_URL}/pass.html?c=${encodeURIComponent(code)}`;
  const body = `Hi ${visitor.fullName.split(' ')[0]}, your visitor pass for ${visitor.visitDate} is ready: ${link}`;

  let sms = 'console';
  try {
    if (twilioClient) {
      await twilioClient.messages.create({ to: visitor.phone, from: TWILIO_FROM, body });
      sms = 'sent';
    } else {
      console.log(`[SMS → ${visitor.phone}] ${body}`);
    }
  } catch (err) {
    console.error('SMS failed:', err.message);
    sms = 'failed';
  }
  res.json({ id, code, validUntil, sms });
});

/** Called by the turnstile controller (or the simulator) with the scanned QR text. */
app.post('/api/gate/scan', (req, res) => {
  const [ver, id, token] = str(req.body && req.body.code, 100).split('.');
  const p = passes.get(id);
  const ok = p && ver === 'VG1' && p.token.length === (token || '').length &&
    crypto.timingSafeEqual(Buffer.from(p.token), Buffer.from(token));
  if (!ok) return res.json({ allowed: false, reason: 'Invalid pass' });
  if (new Date(p.validUntil) < new Date()) return res.json({ allowed: false, reason: 'Pass expired' });
  if (p.used) return res.json({ allowed: false, reason: 'Pass already used' });
  p.used = true;
  console.log(`[GATE] OPEN for ${p.visitor.fullName} (${id})`);
  res.json({ allowed: true, name: p.visitor.fullName, host: p.visitor.host });
});

app.listen(PORT, () => console.log(`Visitor gate demo on ${PUBLIC_URL} (SMS: ${twilioClient ? 'Twilio' : 'console'})`));
