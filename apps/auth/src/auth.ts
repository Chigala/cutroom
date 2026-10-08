/**
 * Cutroom accounts: Better Auth, with sign-in through Google and Apple only (no passwords, no emails to
 * send). People sign in in their own browser; the desktop app gets its own session afterwards
 * (desktop.ts) and sends it as a bearer token.
 */
import { type BetterAuthOptions, betterAuth } from "better-auth";
import { bearer } from "better-auth/plugins";
import { type AppleKeys, appleSecret, hasApple } from "./apple.ts";

interface RateLimit {
  limit(opts: { key: string }): Promise<{ success: boolean }>;
}

export interface Env extends AppleKeys {
  /** D1 in the Worker; any database Better Auth takes (node:sqlite in the tests). */
  readonly DB: BetterAuthOptions["database"];
  readonly BETTER_AUTH_SECRET: string;
  /** Where this Worker is reached (https://auth.example.com). Unset: wherever the request came in. */
  readonly AUTH_URL?: string;
  readonly GOOGLE_CLIENT_ID?: string;
  readonly GOOGLE_CLIENT_SECRET?: string;
  readonly PER_ADDRESS?: RateLimit;
}

export type Provider = "google" | "apple";

const DAY = 24 * 3600;

/** Apple's secret, or null: a key that won't load leaves Apple out, not every way in. */
async function apple(env: Env): Promise<string | null> {
  if (!hasApple(env)) return null;
  try {
    return await appleSecret(env);
  } catch (err) {
    console.error(`Sign in with Apple is off: its key won't load (${(err as Error).message})`);
    return null;
  }
}

export async function authOptions(env: Env, origin: string) {
  const appleKey = await apple(env);
  return {
    database: env.DB,
    baseURL: env.AUTH_URL || origin,
    secret: env.BETTER_AUTH_SECRET,
    socialProviders: {
      ...(env.GOOGLE_CLIENT_ID &&
        env.GOOGLE_CLIENT_SECRET && {
          google: {
            clientId: env.GOOGLE_CLIENT_ID,
            clientSecret: env.GOOGLE_CLIENT_SECRET,
            // Pick the account every time: a shared computer's browser may be signed in as someone else.
            prompt: "select_account" as const,
          },
        }),
      ...(appleKey && { apple: { clientId: env.APPLE_SERVICES_ID ?? "", clientSecret: appleKey } }),
    },
    // Apple answers with a POST from its own site.
    trustedOrigins: ["https://appleid.apple.com"],
    // Google's and Apple's own tokens aren't used, but they're kept: encrypted. (Accounts with the same
    // email link by Better Auth's default, only when the provider says the email is verified.)
    account: { encryptOAuthTokens: true },
    // Signed in for two months, kept going while the app is used.
    session: { expiresIn: 60 * DAY, updateAge: DAY },
    advanced: { ipAddress: { ipAddressHeaders: ["cf-connecting-ip"] } },
    telemetry: { enabled: false },
    plugins: [bearer()],
  } satisfies BetterAuthOptions;
}

/**
 * A Better Auth for one request. Not kept between requests: the Workers runtime won't let one request
 * wait on database work another one started (it hangs), and Better Auth opens its database lazily.
 */
export const authFor = async (env: Env, origin: string) => betterAuth(await authOptions(env, origin));
export type Auth = Awaited<ReturnType<typeof authFor>>;

/** The ways to sign in this Worker has working keys for. */
export const providersOf = (auth: Auth): Provider[] =>
  (["google", "apple"] as const).filter((p) => p in (auth.options.socialProviders ?? {}));
