import { describe, expect, it } from 'vitest';
import { SignJWT } from 'jose';
import { signSessionToken, verifySessionToken } from './jwt.js';

describe('session tokens', () => {
  it('round-trips claims through sign then verify', async () => {
    const token = await signSessionToken({
      userId: 'user-123',
      email: 'ada@example.com',
    });
    const claims = await verifySessionToken(token);
    expect(claims).toEqual({ userId: 'user-123', email: 'ada@example.com' });
  });

  it('returns null for a malformed token', async () => {
    expect(await verifySessionToken('not.a.jwt')).toBeNull();
    expect(await verifySessionToken('')).toBeNull();
  });

  it('rejects a token signed with a different secret', async () => {
    const foreign = new TextEncoder().encode('some-other-secret');
    const token = await new SignJWT({ email: 'ada@example.com' })
      .setProtectedHeader({ alg: 'HS256' })
      .setSubject('user-123')
      .setIssuer('triage98')
      .setIssuedAt()
      .setExpirationTime('1h')
      .sign(foreign);
    expect(await verifySessionToken(token)).toBeNull();
  });

  it('rejects an expired token', async () => {
    const token = await signSessionToken({
      userId: 'user-123',
      email: 'ada@example.com',
    });
    // Re-verify is fine now; craft an already-expired token to prove exp is enforced.
    const secret = new TextEncoder().encode(
      process.env.JWT_SECRET ?? 'dev-insecure-jwt-secret-change-me',
    );
    const expired = await new SignJWT({ email: 'ada@example.com' })
      .setProtectedHeader({ alg: 'HS256' })
      .setSubject('user-123')
      .setIssuer('triage98')
      .setIssuedAt(0)
      .setExpirationTime(1)
      .sign(secret);
    expect(await verifySessionToken(token)).not.toBeNull();
    expect(await verifySessionToken(expired)).toBeNull();
  });
});
