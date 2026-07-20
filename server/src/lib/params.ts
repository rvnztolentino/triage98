import type { Request } from 'express';

/**
 * Reads a route parameter as a single string. Express types params as
 * `string | string[]` (wildcard segments can repeat), but every parameter this app
 * declares is a single segment — so take the first value and normalize the rest away
 * rather than sprinkling casts through the handlers.
 */
export function routeParam(req: Request, name: string): string {
  const value = req.params[name];
  if (Array.isArray(value)) return value[0] ?? '';
  return value ?? '';
}
