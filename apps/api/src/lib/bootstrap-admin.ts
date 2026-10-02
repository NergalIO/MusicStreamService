import bcrypt from 'bcryptjs';
import { eq } from 'drizzle-orm';
import { db } from '../db/client.js';
import { users } from '../db/schema.js';
import { assignPlan } from '../services/subscription.js';

/** Создаёт или повышает админа из MSS_BOOTSTRAP_ADMIN_EMAIL / PASSWORD. */
export async function bootstrapAdmin(): Promise<string | null> {
  const email = process.env.MSS_BOOTSTRAP_ADMIN_EMAIL?.trim();
  const password = process.env.MSS_BOOTSTRAP_ADMIN_PASSWORD?.trim();
  if (!email || !password) return null;

  const existing = await db.select().from(users).where(eq(users.email, email)).limit(1);
  if (existing.length) {
    const patch: { role?: string; emailVerifiedAt?: Date } = {};
    if (existing[0].role !== 'admin') patch.role = 'admin';
    if (!existing[0].emailVerifiedAt) patch.emailVerifiedAt = new Date();
    if (Object.keys(patch).length) {
      await db.update(users).set(patch).where(eq(users.email, email));
      return `updated:${email}`;
    }
    return `exists:${email}`;
  }

  const passwordHash = await bcrypt.hash(password, 10);
  const [user] = await db
    .insert(users)
    .values({ email, passwordHash, role: 'admin', emailVerifiedAt: new Date() })
    .returning();
  await assignPlan(user.id, 'premium', 3650, 'bootstrap');
  return `created:${email}`;
}
