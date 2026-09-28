import { createHash, randomInt } from 'node:crypto';
import { and, desc, eq, gt } from 'drizzle-orm';
import { config } from '../config.js';
import { db } from '../db/client.js';
import { emailVerificationCodes } from '../db/schema.js';
import { sendVerificationCode } from '../lib/mail.js';

const MAX_ATTEMPTS = 5;
const RESEND_COOLDOWN_MS = 60_000;

function hashCode(code: string): string {
  return createHash('sha256').update(code).digest('hex');
}

function generateCode(): string {
  return String(randomInt(0, 1_000_000)).padStart(6, '0');
}

export async function issueAndSendVerificationCode(userId: string, email: string): Promise<void> {
  const [latest] = await db
    .select()
    .from(emailVerificationCodes)
    .where(eq(emailVerificationCodes.userId, userId))
    .orderBy(desc(emailVerificationCodes.createdAt))
    .limit(1);

  if (latest && Date.now() - latest.createdAt.getTime() < RESEND_COOLDOWN_MS) {
    const err = new Error('RESEND_TOO_SOON');
    throw err;
  }

  await db.delete(emailVerificationCodes).where(eq(emailVerificationCodes.userId, userId));

  const code = generateCode();
  const expiresAt = new Date(Date.now() + config.emailVerificationTtlMin * 60_000);
  await db.insert(emailVerificationCodes).values({
    userId,
    codeHash: hashCode(code),
    expiresAt,
  });

  await sendVerificationCode(email, code);
}

export type VerifyCodeResult = 'ok' | 'invalid' | 'expired' | 'too_many_attempts';

export async function verifyEmailCode(userId: string, code: string): Promise<VerifyCodeResult> {
  const [row] = await db
    .select()
    .from(emailVerificationCodes)
    .where(
      and(eq(emailVerificationCodes.userId, userId), gt(emailVerificationCodes.expiresAt, new Date())),
    )
    .orderBy(desc(emailVerificationCodes.createdAt))
    .limit(1);

  if (!row) return 'expired';
  if (row.attempts >= MAX_ATTEMPTS) return 'too_many_attempts';

  if (row.codeHash !== hashCode(code)) {
    await db
      .update(emailVerificationCodes)
      .set({ attempts: row.attempts + 1 })
      .where(eq(emailVerificationCodes.id, row.id));
    return 'invalid';
  }

  await db.delete(emailVerificationCodes).where(eq(emailVerificationCodes.userId, userId));
  return 'ok';
}

export async function clearVerificationCodes(userId: string): Promise<void> {
  await db.delete(emailVerificationCodes).where(eq(emailVerificationCodes.userId, userId));
}
