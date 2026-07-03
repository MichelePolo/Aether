import { isLoopbackAddress } from '@/server/lib/net';

describe('isLoopbackAddress', () => {
  it('accepts IPv4 and IPv6 loopback', () => {
    expect(isLoopbackAddress('127.0.0.1')).toBe(true);
    expect(isLoopbackAddress('::1')).toBe(true);
    expect(isLoopbackAddress('::ffff:127.0.0.1')).toBe(true);
  });
  it('rejects LAN and undefined', () => {
    expect(isLoopbackAddress('192.168.1.20')).toBe(false);
    expect(isLoopbackAddress('10.0.0.5')).toBe(false);
    expect(isLoopbackAddress(undefined)).toBe(false);
  });
});
