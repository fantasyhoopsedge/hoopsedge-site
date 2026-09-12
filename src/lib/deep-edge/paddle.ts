import "server-only";
import { Environment, LogLevel, Paddle } from "@paddle/paddle-node-sdk";
import { paddleEnvironment } from "./season-pass";

/**
 * Server-side Paddle client for this deployment's environment, or null when it
 * isn't configured to take payments (NEXT_PUBLIC_PADDLE_ENV or PADDLE_API_KEY
 * missing).
 *
 * Also null when a sandbox key meets production or a non-sandbox key meets
 * sandbox. Sandbox keys carry a pdl_sdbx_ prefix, and a mismatch would
 * otherwise surface as an opaque authentication error on the first call — or
 * as checkouts created in one environment while passes are counted in the
 * other.
 */
export function getPaddle(): Paddle | null {
  const environment = paddleEnvironment();
  const apiKey = process.env.PADDLE_API_KEY;
  if (!environment || !apiKey) return null;

  const isSandboxKey = apiKey.startsWith("pdl_sdbx_");
  if (isSandboxKey !== (environment === "sandbox")) {
    console.error(`[deep-edge/paddle] PADDLE_API_KEY does not match NEXT_PUBLIC_PADDLE_ENV=${environment}.`);
    return null;
  }

  return new Paddle(apiKey, {
    environment: environment === "production" ? Environment.production : Environment.sandbox,
    logLevel: LogLevel.error,
  });
}
