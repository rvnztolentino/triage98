import { SignJWT, jwtVerify, type JWTPayload } from 'jose';
import { env } from '../config/env.js';

// Stateless JWT sessions: the token carries the user id (sub) and email, signed with
// HMAC-SHA256 using JWT_SECRET. There is no server-side session store — verifying the
// signature is the session check. Kept behind this small module so the algorithm and
// claims live in one place.

const secret = new TextEncoder().encode(env.JWT_SECRET);
const ALG = 'HS256';
const ISSUER = 'triage98';

export interface SessionClaims {
  /** User id (JWT `sub`). */
  userId: string;
  email: string;
}

/** Signs a session token for the given user. Expiry comes from JWT_EXPIRES_IN. */
export async function signSessionToken(claims: SessionClaims): Promise<string> {
  return new SignJWT({ email: claims.email })
    .setProtectedHeader({ alg: ALG })
    .setSubject(claims.userId)
    .setIssuer(ISSUER)
    .setIssuedAt()
    .setExpirationTime(env.JWT_EXPIRES_IN)
    .sign(secret);
}

/**
 * Verifies a session token and returns its claims, or null if the token is missing,
 * malformed, expired, or signed with the wrong key. Never throws.
 */
export async function verifySessionToken(
  token: string,
): Promise<SessionClaims | null> {
  try {
    const { payload } = await jwtVerify(token, secret, {
      issuer: ISSUER,
      algorithms: [ALG],
    });
    return claimsFromPayload(payload);
  } catch {
    return null;
  }
}

function claimsFromPayload(payload: JWTPayload): SessionClaims | null {
  const userId = payload.sub;
  const email = payload.email;
  if (typeof userId !== 'string' || typeof email !== 'string') {
    return null;
  }
  return { userId, email };
}
