//api/butterflies.js — uses Upstash Redis via HTTP (no SDK needed)

const KEY = 'grow_together:butterflies';

function getIP(req) {
  const fwd = req.headers['x-forwarded-for'];
  return (fwd ? fwd.split(',')[0].trim() : req.socket?.remoteAddress) || 'unknown';
}

function hashIP(ip) {
  return Buffer.from(ip).toString('base64').replace(/[^a-zA-Z0-9]/g, '').slice(0, 16);
}

function sanitizeColor(c) {
  return /^#[0-9a-fA-F]{6}$/.test(c) ? c : '#ffffff';
}

function sanitizeName(n) {
  return String(n || '').replace(/[^a-zA-Z0-9 '\-_]/g, '').slice(0, 24).trim();
}

function clamp(v, min, max) {
  return Math.max(min, Math.min(max, parseFloat(v) || 0));
}

// Upstash Redis REST API helper
async function redis(command, ...args) {
  const url = process.env.KV_REST_API_URL;
  const token = process.env.KV_REST_API_TOKEN;

  if (!url || !token) throw new Error('Upstash env vars not set');

  const res = await fetch(`${url}`, {
    method: 'POST',
    headers: {
      'Authorization': `Bearer ${token}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify([command, ...args]),
  });

  const data = await res.json();
  if (data.error) throw new Error(data.error);
  return data.result;
}

module.exports = async function handler(req, res) {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'GET, POST, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');
  if (req.method === 'OPTIONS') return res.status(200).end();

  const ipHash = hashIP(getIP(req));

  if (req.method === 'GET') {
    try {
      const raw = await redis('HGETALL', KEY);
      // HGETALL returns flat array [field, value, field, value, ...]
      const butterflies = [];
      let hasOwn = false;
      if (raw && Array.isArray(raw)) {
        for (let i = 0; i < raw.length; i += 2) {
          const field = raw[i];
          const value = raw[i + 1];
          if (field === ipHash) hasOwn = true;
          try { butterflies.push(JSON.parse(value)); } catch(e) {}
        }
      }
      return res.status(200).json({ butterflies, hasOwn });
    } catch (e) {
      return res.status(500).json({ error: e.message });
    }
  }

  if (req.method === 'POST') {
    try {
      const body = req.body || {};

      // Check if already exists
      const existing = await redis('HGET', KEY, ipHash);
      if (existing) return res.status(200).json({ ok: true, already: true });

      const butterfly = {
        id:            ipHash,
        color:         sanitizeColor(body.color),
        size:          clamp(body.size, 0.5, 2.5),
        antennaLength: clamp(body.antennaLength, 0.3, 2.5),
        name:          sanitizeName(body.name),
        createdAt:     Date.now(),
      };

      await redis('HSET', KEY, ipHash, JSON.stringify(butterfly));
      return res.status(200).json({ ok: true, butterfly });
    } catch (e) {
      return res.status(500).json({ error: e.message });
    }
  }

  return res.status(405).json({ error: 'Method not allowed' });
};
