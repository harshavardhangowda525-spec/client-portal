import { withDb, SYSTEM, type Actor, audit } from "./core";
import { hashPassword, randomToken, sha256, verifyPassword } from "@/lib/crypto";
import { AppError } from "@/lib/errors";

export const SESSION_TTL_DAYS = 14;
const MAX_FAILED_PER_EMAIL = 5;
const MAX_FAILED_PER_IP = 25;
const WINDOW_MINUTES = 15;

// Precomputed hash so unknown emails take the same time as wrong passwords.
let dummyHash: Promise<string> | null = null;

export function validatePasswordStrength(pw: string): string | null {
  if (pw.length < 10) return "Password must be at least 10 characters.";
  if (pw.length > 200) return "Password is too long.";
  if (!/[A-Za-z]/.test(pw) || !/[0-9]/.test(pw)) return "Password must contain letters and numbers.";
  return null;
}

export async function createSession(userId: string, ip?: string | null, ua?: string | null) {
  const token = randomToken();
  const expires = new Date(Date.now() + SESSION_TTL_DAYS * 86400_000);
  await withDb(SYSTEM, async (tx) => {
    await tx`insert into sessions (user_id, token_hash, expires_at, ip, user_agent)
             values (${userId}, ${sha256(token)}, ${expires}, ${ip ?? null}, ${ua?.slice(0, 300) ?? null})`;
    await tx`update users set last_login_at = now() where id = ${userId}`;
    await tx`delete from sessions where user_id = ${userId} and expires_at < now()`;
  });
  return { token, expires };
}

export async function login(emailRaw: string, password: string, ip?: string | null, ua?: string | null) {
  const email = emailRaw.trim().toLowerCase();
  const user = await withDb(SYSTEM, async (tx) => {
    const [{ by_email }] = await tx<{ by_email: number }[]>`
      select count(*)::int as by_email from login_attempts
      where lower(email) = ${email} and not success and created_at > now() - make_interval(mins => ${WINDOW_MINUTES})`;
    const [{ by_ip }] = ip
      ? await tx<{ by_ip: number }[]>`select count(*)::int as by_ip from login_attempts
          where ip = ${ip} and not success and created_at > now() - make_interval(mins => ${WINDOW_MINUTES})`
      : [{ by_ip: 0 }];
    if (by_email >= MAX_FAILED_PER_EMAIL || by_ip >= MAX_FAILED_PER_IP) {
      throw new AppError("Too many failed attempts. Please wait 15 minutes and try again.", "rate_limited");
    }
    const [u] = await tx<{ id: string; role: string; disabled_at: Date | null; password_hash: string | null; revoked: Date | null }[]>`
      select u.id, u.role, u.disabled_at, c.password_hash, cp.portal_access_revoked_at as revoked
      from users u
      left join user_credentials c on c.user_id = u.id
      left join client_profiles cp on cp.id = u.client_id
      where lower(u.email) = ${email}`;
    return u ?? null;
  });

  dummyHash ??= hashPassword("timing-equaliser-password-1");
  const ok = user?.password_hash ? await verifyPassword(password, user.password_hash) : (await verifyPassword(password, await dummyHash), false);
  const allowed = ok && user && !user.disabled_at && !user.revoked;

  await withDb(SYSTEM, (tx) => tx`insert into login_attempts (email, ip, success) values (${email}, ${ip ?? null}, ${!!allowed})`);
  if (!allowed || !user) {
    if (ok && user && (user.disabled_at || user.revoked)) {
      throw new AppError("Portal access for this account has been disabled. Please contact Infinity Web & Apps.", "forbidden");
    }
    throw new AppError("Incorrect email or password.", "unauthenticated");
  }
  const session = await createSession(user.id, ip, ua);
  return { ...session, role: user.role as Actor["role"] };
}

export async function actorFromToken(token: string | undefined | null): Promise<Actor | null> {
  if (!token || token.length > 200) return null;
  return withDb(SYSTEM, async (tx) => {
    const [row] = await tx<(Actor & { session_id: string; last_seen_at: Date })[]>`
      select s.id as session_id, s.last_seen_at, u.id as "userId", u.role, u.client_id as "clientId", u.name, u.email
      from sessions s
      join users u on u.id = s.user_id
      left join client_profiles cp on cp.id = u.client_id
      where s.token_hash = ${sha256(token)} and s.expires_at > now()
        and u.disabled_at is null and cp.portal_access_revoked_at is null`;
    if (!row) return null;
    if (Date.now() - new Date(row.last_seen_at).getTime() > 5 * 60_000) {
      await tx`update sessions set last_seen_at = now() where id = ${row.session_id}`;
    }
    return { userId: row.userId, role: row.role, clientId: row.clientId, name: row.name, email: row.email };
  });
}

export async function logout(token: string | undefined | null) {
  if (!token) return;
  await withDb(SYSTEM, (tx) => tx`delete from sessions where token_hash = ${sha256(token)}`);
}

export async function changePassword(actor: Actor, current: string, next: string) {
  const weak = validatePasswordStrength(next);
  if (weak) throw new AppError(weak);
  await withDb(SYSTEM, async (tx) => {
    const [c] = await tx<{ password_hash: string }[]>`select password_hash from user_credentials where user_id = ${actor.userId}`;
    if (!c || !(await verifyPassword(current, c.password_hash))) throw new AppError("Current password is incorrect.");
    await tx`update user_credentials set password_hash = ${await hashPassword(next)}, updated_at = now() where user_id = ${actor.userId}`;
    await audit(tx, null, "user.password_changed", "user", actor.userId, null, { by: actor.userId });
  });
}

/** Create an admin account. Only callable from the setup CLI or the token-guarded /setup page. */
export async function createAdmin(name: string, emailRaw: string, password: string) {
  const email = emailRaw.trim().toLowerCase();
  const weak = validatePasswordStrength(password);
  if (weak) throw new AppError(weak);
  if (!/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(email)) throw new AppError("Enter a valid email address.");
  return withDb(SYSTEM, async (tx) => {
    const [exists] = await tx`select 1 from users where lower(email) = ${email}`;
    if (exists) throw new AppError("A user with this email already exists.", "conflict");
    const [u] = await tx<{ id: string }[]>`insert into users (email, name, role) values (${email}, ${name.trim()}, 'admin') returning id`;
    await tx`insert into user_credentials (user_id, password_hash) values (${u.id}, ${await hashPassword(password)})`;
    await audit(tx, null, "admin.created", "user", u.id, null, { email });
    return u.id;
  });
}

export async function adminCount(): Promise<number> {
  return withDb(SYSTEM, async (tx) => {
    const [r] = await tx<{ n: number }[]>`select count(*)::int as n from users where role = 'admin'`;
    return r.n;
  });
}
