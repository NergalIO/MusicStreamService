import { and, desc, eq, gt, or, isNull } from 'drizzle-orm';
import type { PlanFeatures, UserSubscriptionDto } from '@mss/shared';
import { db } from '../db/client.js';
import { subscriptionPlans, userSubscriptions } from '../db/schema.js';

export async function getActiveSubscription(userId: string): Promise<UserSubscriptionDto | null> {
  const rows = await db
    .select({
      planCode: subscriptionPlans.code,
      planName: subscriptionPlans.name,
      status: userSubscriptions.status,
      endsAt: userSubscriptions.endsAt,
      features: subscriptionPlans.featuresJson,
    })
    .from(userSubscriptions)
    .innerJoin(subscriptionPlans, eq(userSubscriptions.planId, subscriptionPlans.id))
    .where(
      and(
        eq(userSubscriptions.userId, userId),
        eq(userSubscriptions.status, 'active'),
        or(isNull(userSubscriptions.endsAt), gt(userSubscriptions.endsAt, new Date())),
      ),
    )
    .orderBy(desc(userSubscriptions.startsAt))
    .limit(1);

  if (rows.length === 0) {
    const [freePlan] = await db
      .select()
      .from(subscriptionPlans)
      .where(eq(subscriptionPlans.code, 'free'))
      .limit(1);
    if (!freePlan) return null;
    return {
      planCode: freePlan.code,
      planName: freePlan.name,
      status: 'active',
      endsAt: null,
      features: freePlan.featuresJson as PlanFeatures,
    };
  }
  const r = rows[0];
  return {
    planCode: r.planCode,
    planName: r.planName,
    status: r.status,
    endsAt: r.endsAt?.toISOString() ?? null,
    features: r.features as PlanFeatures,
  };
}

export async function assignPlan(
  userId: string,
  planCode: 'free' | 'premium',
  days: number,
  source: string,
): Promise<void> {
  const [plan] = await db
    .select()
    .from(subscriptionPlans)
    .where(eq(subscriptionPlans.code, planCode))
    .limit(1);
  if (!plan) throw new Error('Plan not found');
  const endsAt = new Date();
  endsAt.setDate(endsAt.getDate() + days);
  await db.insert(userSubscriptions).values({
    userId,
    planId: plan.id,
    status: 'active',
    startsAt: new Date(),
    endsAt,
    source,
  });
}
