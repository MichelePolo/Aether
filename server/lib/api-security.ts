import { timingSafeEqual } from 'node:crypto';
import type { RequestHandler } from 'express';
import { isLoopbackAddress } from './net';

/** Browser requests must originate from this instance. Non-loopback clients
 * additionally require an explicitly configured bearer token (never in URLs). */
export function apiSecurity(opts: { allowedHosts?: string[]; token?: string } = {}): RequestHandler {
  const hosts = new Set(['localhost', '127.0.0.1', '[::1]', ...(opts.allowedHosts ?? [])]);
  return (req, res, next) => {
    const deny = (message: string) => { res.status(403).json({ error: { code: 'FORBIDDEN', message } }); };
    let url: URL;
    try { url = new URL(`http://${req.get('host') ?? ''}`); } catch { deny('Invalid Host'); return; }
    if (!hosts.has(url.hostname) || url.username || url.password) { deny('Host not allowed'); return; }
    const origin = req.get('origin');
    if (origin && origin !== `${req.protocol}://${url.host}`) { deny('Origin not allowed'); return; }
    if (req.get('sec-fetch-site') === 'cross-site') { deny('Cross-site request not allowed'); return; }
    if (!isLoopbackAddress(req.socket.remoteAddress)) {
      const provided = Buffer.from(req.get('authorization') ?? '');
      const expected = Buffer.from(`Bearer ${opts.token ?? ''}`);
      if (!opts.token || provided.length !== expected.length || !timingSafeEqual(provided, expected)) {
        deny('Remote API access requires AETHER_API_TOKEN'); return;
      }
    }
    res.setHeader('X-Content-Type-Options', 'nosniff');
    next();
  };
}
