# Turnstile Visitor Demo

Client demo: a visitor registers on a web form, a **QR pass is "sent" to their phone instantly**, and scanning it at the **turnstile** opens the gate.

```
Visitor form  ──►  Pass issued (token)  ──►  SMS / QR on phone  ──►  Gate scan  ──►  Turnstile opens
```

## Live preview link (GitHub Pages)

1. Upload this whole folder to a GitHub repository (drag and drop, or `git push`).
2. In the repo: **Settings → Pages → Build and deployment → Source: Deploy from a branch → Branch: `main`, folder: `/docs` → Save**.
   (Root also works: a redirect `index.html` at the top level forwards to `docs/`.)
3. After about a minute the preview is live at `https://<your-username>.github.io/<repo-name>/` — share that link.

The preview runs in demo mode (simulated SMS and gate), since GitHub Pages hosts static files only. Live SMS needs the Node server below.

## Quick start (no install, demo mode)

Open `docs/index.html` in a browser (or run `npm run static` and visit http://localhost:8080).

1. Fill in the form (purpose, name, contact number, host, date, consent) and press **Submit**.
2. The phone mock-up shows the SMS with the QR code. The pass code is pre-filled in the scanner box.
3. Press **Scan at gate**: the turnstile opens. Scan again to show *Pass already used*; edit the code to show *Invalid pass*.

In this mode the SMS and gate are simulated; passes live in the browser's `localStorage`.

## Live mode (real SMS)

```bash
npm install
npm start                      # http://localhost:3000  (badge turns green: "Live API mode")
```

Without credentials the SMS text is printed in the server console. For real SMS:

```bash
export TWILIO_ACCOUNT_SID=ACxxxxxxxx
export TWILIO_AUTH_TOKEN=xxxxxxxx
export TWILIO_FROM=+1555xxxxxxx
export PUBLIC_URL=https://your-domain.example   # must be reachable from the visitor's phone
npm start
```

SMS cannot embed images, so the message carries a link to `pass.html`, which renders the QR. (MMS or WhatsApp can attach the image directly if preferred.)

## API

| Method | Path | Purpose |
|---|---|---|
| POST | `/api/visitors` | Validate form data, create a single-use pass, send SMS. Returns `{ id, code, validUntil, sms }` |
| POST | `/api/gate/scan` | Body `{ code }`. Returns `{ allowed, name?, host?, reason? }` |
| GET | `/api/health` | Mode check used by the UI |

QR payload format: `VG1.<passId>.<token>`.

## Connecting a real turnstile

The gate controller (or a small bridge on-site) reads the QR from the scanner and calls `POST /api/gate/scan`. If `allowed` is `true`, trigger the controller's relay / dry contact (or its vendor API) to release the turnstile for one passage. Hardware integration depends on the controller model.

## Before production

- Replace the in-memory store with a database; keep passes single-use and expiring.
- Serve over HTTPS, add authentication for reception/admin views and CAPTCHA on the public form.
- Review consent text and data-retention rules for visitor personal data.
- Add host notification (email/Teams) and an audit trail.

## Structure

```
docs/          index.html, pass.html, css/style.css, js/app.js, js/qrcode.js (MIT, qrcode-generator)
server/        server.js (Express + optional Twilio)
```
