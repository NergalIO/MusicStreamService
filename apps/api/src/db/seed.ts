import bcrypt from 'bcryptjs';
import { eq } from 'drizzle-orm';
import { assignPlan } from '../services/subscription.js';
import { db } from './client.js';
import { promoCodes, subscriptionPlans, users } from './schema.js';

const FREE_FEATURES = {
  max_offline_tracks: 0,
  offline_enabled: false,
  stream_quality: 'standard',
  external_sources_enabled: false,
  ads: false,
};

const PREMIUM_FEATURES = {
  max_offline_tracks: null,
  offline_enabled: true,
  stream_quality: 'high',
  external_sources_enabled: true,
  ads: false,
};

async function bootstrapAdmin() {
  const email = process.env.MSS_BOOTSTRAP_ADMIN_EMAIL?.trim();
  const password = process.env.MSS_BOOTSTRAP_ADMIN_PASSWORD?.trim();
  if (!email || !password) return;

  const existing = await db.select().from(users).where(eq(users.email, email)).limit(1);
  if (existing.length) {
    if (existing[0].role !== 'admin') {
      await db.update(users).set({ role: 'admin' }).where(eq(users.email, email));
      console.log('Promoted existing user to admin:', email);
    } else {
      console.log('Admin user already exists:', email);
    }
    return;
  }

  const passwordHash = await bcrypt.hash(password, 10);
  const [user] = await db
    .insert(users)
    .values({ email, passwordHash, role: 'admin' })
    .returning();
  await assignPlan(user.id, 'premium', 3650, 'bootstrap');
  console.log('Bootstrap admin created:', email);
}

async function seedPlans(): Promise<void> {
  const existing = await db.select().from(subscriptionPlans).limit(1);
  if (existing.length === 0) {
    const [free] = await db
      .insert(subscriptionPlans)
      .values({
        code: 'free',
        name: 'Free',
        priceDisplay: '0 ₽',
        featuresJson: FREE_FEATURES,
      })
      .returning();
    const [premium] = await db
      .insert(subscriptionPlans)
      .values({
        code: 'premium',
        name: 'Premium',
        priceDisplay: '299 ₽',
        featuresJson: PREMIUM_FEATURES,
      })
      .returning();
    await db.insert(promoCodes).values({
      code: 'PREMIUM30',
      planId: premium.id,
      durationDays: 30,
      maxUses: 1000,
    });
    console.log('Seeded plans', free.code, premium.code);
  } else {
    console.log('Plans already seeded');
  }
}

async function main() {
  await seedPlans();
  await bootstrapAdmin();
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
