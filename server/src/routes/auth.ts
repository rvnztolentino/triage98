import { Router } from 'express';
import { loginSchema, registerSchema } from '../auth/schemas.js';
import {
  createUser,
  getUserAuthByEmail,
  roleForEmail,
} from '../auth/service.js';
import { assertCleanDisplayName } from '../lib/display-name.js';
import {
  DUMMY_PASSWORD_HASH,
  hashPassword,
  verifyPassword,
} from '../lib/password.js';
import { signSessionToken } from '../lib/jwt.js';
import { parseBody } from '../lib/validate.js';
import { UnauthorizedError } from '../lib/errors.js';
import { requireAuth } from '../middleware/authenticate.js';
import { ipKey, rateLimit } from '../middleware/rate-limit.js';
import type { AppUser } from '../auth/types.js';

const router = Router();

async function issueSession(
  user: AppUser,
): Promise<{ token: string; user: AppUser }> {
  const token = await signSessionToken({ userId: user.id, email: user.email });
  return { token, user };
}

// Pre-auth endpoints are throttled per IP: enough headroom for real use, tight enough
// to blunt credential stuffing and mass registration.
const loginLimiter = rateLimit({
  name: 'auth:login',
  limit: 10,
  windowSeconds: 60,
  key: ipKey,
});
const registerLimiter = rateLimit({
  name: 'auth:register',
  limit: 5,
  windowSeconds: 60 * 60,
  key: ipKey,
});

// POST /auth/register — create an account and return a session token.
router.post('/register', registerLimiter, async (req, res) => {
  const input = parseBody(registerSchema, req.body);
  const displayName = assertCleanDisplayName(input.displayName);
  const passwordHash = await hashPassword(input.password);
  const user = await createUser({
    email: input.email,
    passwordHash,
    displayName,
    role: roleForEmail(input.email),
  });
  res.status(201).json(await issueSession(user));
});

// POST /auth/login — verify credentials and return a session token.
router.post('/login', loginLimiter, async (req, res) => {
  const input = parseBody(loginSchema, req.body);
  const found = await getUserAuthByEmail(input.email);
  const ok = await verifyPassword(
    input.password,
    found?.passwordHash ?? DUMMY_PASSWORD_HASH,
  );
  if (!found || !ok) {
    // One generic message for both unknown email and wrong password.
    throw new UnauthorizedError('Invalid email or password.');
  }
  res.json(await issueSession(found.user));
});

// GET /auth/me — the current user, from the Bearer token.
router.get('/me', requireAuth, (req, res) => {
  res.json({ user: req.user });
});

export default router;
