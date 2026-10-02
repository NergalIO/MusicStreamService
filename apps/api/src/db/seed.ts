import { bootstrapAdmin } from '../lib/bootstrap-admin.js';
import { db } from './client.js';
import { promoCodes, subscriptionPlans } from './schema.js';

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
  const boot = await bootstrapAdmin();
  if (boot) console.log('Bootstrap admin', boot);
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
