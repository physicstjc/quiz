const { onRequest } = require('firebase-functions/v2/https');
const logger = require('firebase-functions/logger');
const admin = require('firebase-admin');

admin.initializeApp();

const ALLOWED_ORIGIN_PATTERN = /^https?:\/\/.+/;

function json(res, status, payload) {
  res.status(status).set('Content-Type', 'application/json').send(JSON.stringify(payload));
}

function getCorsOrigin(req) {
  const origin = req.get('origin') || '';
  if (ALLOWED_ORIGIN_PATTERN.test(origin)) return origin;
  return '*';
}

async function verifyBearerToken(req) {
  const authHeader = req.get('authorization') || '';
  if (!authHeader.startsWith('Bearer ')) {
    throw new Error('Missing Bearer token');
  }
  const idToken = authHeader.slice('Bearer '.length);
  return admin.auth().verifyIdToken(idToken);
}

exports.sendAttemptReport = onRequest({
  region: 'us-central1',
  timeoutSeconds: 60,
  memory: '256MiB'
}, async (req, res) => {
  const corsOrigin = getCorsOrigin(req);
  res.set('Access-Control-Allow-Origin', corsOrigin);
  res.set('Vary', 'Origin');
  res.set('Access-Control-Allow-Methods', 'POST, OPTIONS');
  res.set('Access-Control-Allow-Headers', 'Content-Type, Authorization');

  if (req.method === 'OPTIONS') {
    res.status(204).send('');
    return;
  }

  if (req.method !== 'POST') {
    json(res, 405, { error: 'Method not allowed' });
    return;
  }

  try {
    const decoded = await verifyBearerToken(req);
    const body = req.body || {};

    const toEmail = String(body.toEmail || '').trim().toLowerCase();
    const subject = String(body.subject || '').trim();
    const text = String(body.text || '').trim();

    if (!toEmail || !subject || !text) {
      json(res, 400, { error: 'Missing required fields: toEmail, subject, text' });
      return;
    }

    // Prevent abuse: only allow sending to the authenticated user email.
    const tokenEmail = String(decoded.email || '').trim().toLowerCase();
    if (!tokenEmail || tokenEmail !== toEmail) {
      json(res, 403, { error: 'toEmail must match authenticated user email' });
      return;
    }

    const resendApiKey = process.env.RESEND_API_KEY;
    const fromEmail = process.env.FROM_EMAIL || 'Quiz Platform <noreply@example.com>';

    if (!resendApiKey) {
      logger.error('RESEND_API_KEY env var is not set');
      json(res, 500, { error: 'Email service is not configured on the server.' });
      return;
    }

    const response = await fetch('https://api.resend.com/emails', {
      method: 'POST',
      headers: {
        'Authorization': `Bearer ${resendApiKey}`,
        'Content-Type': 'application/json'
      },
      body: JSON.stringify({
        from: fromEmail,
        to: [toEmail],
        subject,
        text
      })
    });

    const payload = await response.json();
    if (!response.ok) {
      logger.error('Resend API error', payload);
      json(res, 502, { error: payload?.message || 'Failed to send email.' });
      return;
    }

    json(res, 200, { ok: true, id: payload?.id || null });
  } catch (err) {
    logger.error('sendAttemptReport failed', err);
    const message = err?.message || 'Internal server error';
    json(res, 500, { error: message });
  }
});
