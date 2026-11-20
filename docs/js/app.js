/* Visitor check-in + turnstile demo
 * Works standalone (localStorage "backend") or against ../server (Express API).
 */
(() => {
  'use strict';

  const STORE_KEY = 'vg_passes_v1';
  const GATE_OPEN_MS = 4000;
  const $ = (sel) => document.querySelector(sel);

  /* ---------- helpers ---------- */
  const randomHex = (bytes) =>
    Array.from(crypto.getRandomValues(new Uint8Array(bytes)), (b) => b.toString(16).padStart(2, '0')).join('');
  const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
  const todayISO = () => new Date().toISOString().slice(0, 10);
  const fmtTime = (d = new Date()) => d.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit', second: '2-digit' });

  function makeQrSvg(text) {
    const qr = qrcode(0, 'M');
    qr.addData(text);
    qr.make();
    return qr.createSvgTag({ cellSize: 4, margin: 0, scalable: true });
  }

  /* ---------- storage-backed demo "server" ---------- */
  const local = {
    load() {
      try { return JSON.parse(localStorage.getItem(STORE_KEY)) || {}; } catch { return {}; }
    },
    save(db) {
      try { localStorage.setItem(STORE_KEY, JSON.stringify(db)); } catch { /* private mode */ }
    },
    memory: {},
    async createPass(visitor) {
      const db = Object.assign(this.memory, this.load());
      const id = 'VG' + randomHex(3).toUpperCase();
      const token = randomHex(12);
      const validUntil = new Date(visitor.visitDate + 'T23:59:59').toISOString();
      db[id] = { id, token, visitor, validUntil, used: false, createdAt: new Date().toISOString() };
      this.memory = db;
      this.save(db);
      return { id, code: `VG1.${id}.${token}`, validUntil, sms: 'simulated' };
    },
    async scan(code) {
      const db = Object.assign(this.memory, this.load());
      const [ver, id, token] = String(code).trim().split('.');
      const p = db[id];
      if (ver !== 'VG1' || !p || p.token !== token) return { allowed: false, reason: 'Invalid pass' };
      if (new Date(p.validUntil) < new Date()) return { allowed: false, reason: 'Pass expired' };
      if (p.used) return { allowed: false, reason: 'Pass already used' };
      p.used = true;
      this.memory = db;
      this.save(db);
      return { allowed: true, name: p.visitor.fullName, host: p.visitor.host };
    },
  };

  /* ---------- real API (optional) ---------- */
  const remote = {
    async health() {
      try {
        const r = await fetch('/api/health', { cache: 'no-store' });
        return r.ok && (await r.json()).ok === true;
      } catch { return false; }
    },
    async createPass(visitor) {
      const r = await fetch('/api/visitors', {
        method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(visitor),
      });
      const data = await r.json().catch(() => ({}));
      if (!r.ok) throw new Error(data.error || 'Server error');
      return data;
    },
    async scan(code) {
      const r = await fetch('/api/gate/scan', {
        method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ code }),
      });
      return r.json();
    },
  };

  let backend = local;

  /* ---------- form ---------- */
  const form = $('#visitorForm');
  const purposeEl = $('#purpose');
  $('#visitDate').min = todayISO();
  $('#visitDate').value = todayISO();

  purposeEl.addEventListener('change', () => {
    const other = purposeEl.value === 'Other';
    $('#otherWrap').hidden = !other;
    if (!other) $('#otherPurpose').value = '';
  });

  function setError(name, msg) {
    const el = document.querySelector(`.error[data-for="${name}"]`);
    if (!el) return;
    el.textContent = msg || '';
    const field = el.closest('.field');
    if (field) field.classList.toggle('invalid', !!msg);
  }

  function validate() {
    let ok = true;
    const fail = (n, m) => { setError(n, m); ok = false; };
    ['purpose', 'otherPurpose', 'fullName', 'phone', 'email', 'host', 'visitDate', 'consent'].forEach((n) => setError(n, ''));

    if (!purposeEl.value) fail('purpose', 'Please choose a purpose.');
    if (purposeEl.value === 'Other' && !$('#otherPurpose').value.trim()) fail('otherPurpose', 'Please describe your purpose.');
    if ($('#fullName').value.trim().length < 2) fail('fullName', 'Enter your full name.');

    const digits = $('#phone').value.replace(/[\s\-()]/g, '');
    if (!/^\d{6,12}$/.test(digits)) fail('phone', 'Enter a valid phone number (digits only).');

    const email = $('#email').value.trim();
    if (email && !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) fail('email', 'Enter a valid email address.');
    if (!$('#host').value.trim()) fail('host', 'Who are you visiting?');
    if (!$('#visitDate').value || $('#visitDate').value < todayISO()) fail('visitDate', 'Pick today or a future date.');
    if (!$('#consent').checked) fail('consent', 'Consent is required to issue a pass.');
    return ok;
  }

  function collect() {
    const digits = $('#phone').value.replace(/[\s\-()]/g, '').replace(/^0+/, '');
    return {
      purpose: purposeEl.value === 'Other' ? $('#otherPurpose').value.trim() : purposeEl.value,
      fullName: $('#fullName').value.trim(),
      company: $('#company').value.trim(),
      phone: '+' + $('#countryCode').value + digits,
      email: $('#email').value.trim(),
      host: $('#host').value.trim(),
      idNumber: $('#idNumber').value.trim(),
      visitDate: $('#visitDate').value,
      vehicle: $('#vehicle').value.trim().toUpperCase(),
    };
  }

  /* ---------- phone preview ---------- */
  function showSending() {
    $('#phoneEmpty').hidden = true;
    $('#phoneMsg').hidden = true;
    $('#phoneSending').hidden = false;
  }
  function showMessage(visitor, pass) {
    $('#phoneSending').hidden = true;
    $('#phoneMsg').hidden = false;
    $('#smsText').textContent =
      `Hi ${visitor.fullName.split(' ')[0]}, your visitor pass for ${visitor.visitDate} is ready. ` +
      `Show this QR at the turnstile. Host: ${visitor.host}.`;
    $('#qrBox').innerHTML = makeQrSvg(pass.code);
    const until = new Date(pass.validUntil).toLocaleString([], { dateStyle: 'medium', timeStyle: 'short' });
    $('#smsMeta').textContent = `To ${visitor.phone} · ${fmtTime()} · valid until ${until}`;
  }

  form.addEventListener('submit', async (e) => {
    e.preventDefault();
    if (!validate()) {
      const first = form.querySelector('.invalid input, .invalid select');
      if (first) first.focus();
      return;
    }
    const btn = $('#submitBtn');
    btn.disabled = true;
    btn.textContent = 'Sending…';
    const visitor = collect();
    showSending();
    try {
      const [pass] = await Promise.all([backend.createPass(visitor), sleep(900)]);
      showMessage(visitor, pass);
      $('#scanInput').value = pass.code;
      setGate('locked', 'LOCKED');
      logLine(`Pass ${pass.id} issued to ${visitor.fullName}`, '');
      if (pass.sms === 'failed') alert('Pass created, but the SMS could not be delivered. Please contact reception.');
    } catch (err) {
      $('#phoneSending').hidden = true;
      $('#phoneEmpty').hidden = false;
      alert('Could not issue pass: ' + err.message);
    } finally {
      btn.disabled = false;
      btn.textContent = 'Submit & send QR to my phone';
    }
  });

  /* ---------- turnstile ---------- */
  const gate = $('#gate');
  let relockTimer = null;

  function setGate(state, label) {
    gate.className = 'gate ' + state;
    $('#gateLabel').textContent = label;
  }
  function logLine(text, cls) {
    const ul = $('#gateLog');
    const first = ul.querySelector('.muted');
    if (first) first.remove();
    const li = document.createElement('li');
    const t = document.createElement('span');
    t.textContent = fmtTime() + ' · ';
    const m = document.createElement('span');
    if (cls) m.className = cls;
    m.textContent = text;
    li.append(t, m);
    ul.prepend(li);
  }

  $('#scanBtn').addEventListener('click', async () => {
    const code = $('#scanInput').value.trim();
    if (!code) { logLine('Nothing to scan', 'bad'); return; }
    clearTimeout(relockTimer);
    setGate('scanning', 'SCANNING…');
    await sleep(500);
    let res;
    try { res = await backend.scan(code); } catch { res = { allowed: false, reason: 'Gate offline' }; }

    if (res.allowed) {
      setGate('open', 'OPEN — WELCOME');
      logLine(`Access granted: ${res.name} → ${res.host}`, 'ok');
      relockTimer = setTimeout(() => setGate('locked', 'LOCKED'), GATE_OPEN_MS);
    } else {
      setGate('denied', 'DENIED');
      logLine(`Access denied: ${res.reason}`, 'bad');
      relockTimer = setTimeout(() => setGate('locked', 'LOCKED'), 2000);
    }
  });

  /* ---------- boot ---------- */
  (async () => {
    const badge = $('#modeBadge');
    if (location.protocol.startsWith('http') && (await remote.health())) {
      backend = remote;
      badge.textContent = 'Live API mode';
      badge.classList.add('live');
    } else {
      badge.textContent = 'Demo mode (no server)';
    }
  })();
})();
