/**
 * Application logs must never make a request fail.
 *
 * BetterStack's transport is currently failing TLS verification in the production
 * runtime. `@logtail/next` then hides the originating application error behind
 * its own transport failure, which is especially unsafe for payment webhooks.
 * Keep structured details in Vercel's native logs until the BetterStack endpoint
 * is repaired; Vercel log retention remains our operational source of truth.
 */
export const log = console;
