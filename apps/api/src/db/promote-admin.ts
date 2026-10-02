import { eq, sql } from 'drizzle-orm';
import { db, pool } from './client.js';
import { users } from './schema.js';
import { assignPlan, getActiveSubscription } from '../services/subscription.js';

async function main(): Promise<void> {
  const email = (process.argv[2] || process.env.PROMOTE_ADMIN_EMAIL || '').trim();
  if (!email) {
    console.error('Usage: pnpm db:promote-admin -- user@example.com');
    process.exitCode = 1;
    return;
  }

  const [user] = await db
    .select()
    .from(users)
    .where(sql`lower(${users.email}) = lower(${email})`)
    .limit(1);

  if (!user) {
    console.error(`Пользователь не найден: ${email}`);
    process.exitCode = 1;
    return;
  }

  const patch: { role?: string; emailVerifiedAt?: Date } = {};
  if (user.role !== 'admin') patch.role = 'admin';
  if (!user.emailVerifiedAt) patch.emailVerifiedAt = new Date();
  if (Object.keys(patch).length) {
    await db.update(users).set(patch).where(eq(users.id, user.id));
  }

  const sub = await getActiveSubscription(user.id);
  if (sub?.planCode !== 'premium') {
    await assignPlan(user.id, 'premium', 3650, 'promote-admin');
  }

  console.log(`Админ: ${user.email} (${user.id})`);
  if (patch.role) console.log('роль → admin');
  else console.log('роль уже admin');
  if (patch.emailVerifiedAt) console.log('почта подтверждена');
  if (sub?.planCode !== 'premium') console.log('подписка → premium');
  console.log('Войдите в панель заново — старый токен без роли admin.');
}

main()
  .catch((e) => {
    console.error(e);
    process.exit(1);
  })
  .finally(() => pool.end());
