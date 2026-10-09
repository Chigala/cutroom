/**
 * Sign in with Apple's client secret: a JWT signed with the team's Sign in with Apple key, good for at most
 * six months. Made here from the key rather than pasted in, so it never expires on us; one per isolate,
 * remade a day before it runs out.
 */
import { importPKCS8, SignJWT } from "jose";

export interface AppleKeys {
  /** The Services ID: Apple's client id for signing in on the web. */
  readonly APPLE_SERVICES_ID?: string;
  readonly APPLE_TEAM_ID?: string;
  readonly APPLE_KEY_ID?: string;
  /** The .p8 key's contents (PEM; `\n` written out is fine, as a one-line secret). */
  readonly APPLE_PRIVATE_KEY?: string;
}

const LIFETIME = 30 * 24 * 3600;
const DAY = 24 * 3600;

let made: { id: string; secret: string; until: number } | null = null;

export const hasApple = (env: AppleKeys) =>
  Boolean(env.APPLE_SERVICES_ID && env.APPLE_TEAM_ID && env.APPLE_KEY_ID && env.APPLE_PRIVATE_KEY);

export async function appleSecret(env: AppleKeys, now = Date.now()): Promise<string> {
  const id = `${env.APPLE_TEAM_ID}:${env.APPLE_KEY_ID}:${env.APPLE_SERVICES_ID}`;
  if (made?.id === id && made.until > now) return made.secret;
  const key = await importPKCS8((env.APPLE_PRIVATE_KEY ?? "").replace(/\\n/g, "\n"), "ES256");
  const iat = Math.floor(now / 1000);
  const secret = await new SignJWT({})
    .setProtectedHeader({ alg: "ES256", kid: env.APPLE_KEY_ID ?? "" })
    .setIssuer(env.APPLE_TEAM_ID ?? "")
    .setSubject(env.APPLE_SERVICES_ID ?? "")
    .setAudience("https://appleid.apple.com")
    .setIssuedAt(iat)
    .setExpirationTime(iat + LIFETIME)
    .sign(key);
  made = { id, secret, until: (iat + LIFETIME - DAY) * 1000 };
  return secret;
}
