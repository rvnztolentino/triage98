import { defineConfig } from 'vitest/config';

// Restrict test collection to the TypeScript sources. Without this, a prior
// `npm run build` leaves compiled `dist/**/*.test.js` files that Vitest's default
// glob would also pick up, running every suite twice against stale output.
export default defineConfig({
  test: {
    include: ['src/**/*.test.ts'],
  },
});
