import { eq } from 'drizzle-orm';
import type { FastifyInstance } from 'fastify';
import { activatePromoSchema, adminSubscriptionSchema, deviceRegisterSchema } from '@mss/shared';
import { db } from '../db/client.js';
import { promoCodes, subscriptionPlans, userDevices } from '../db/schema.js';
import { assignPlan, getActiveSubscription } from '../services/subscription.js';

export async function subscriptionRoutes(app: FastifyInstance) {
  app.get('/me/subscription', async (req) => {
    await app.authenticate(req);
    const sub = await getActiveSubscription(req.userId!);
    return sub;
  });

  app.post('/subscription/activate-promo', async (req, reply) => {
    await app.authenticate(req);
    const body = activatePromoSchema.parse(req.body);
    const [promo] = await db
      .select()
      .from(promoCodes)
      .where(eq(promoCodes.code, body.code))
      .limit(1);
    if (!promo) return reply.notFound('Invalid promo');
    if (promo.maxUses != null && promo.uses >= promo.maxUses) {
      return reply.badRequest('Promo exhausted');
    }
    const [plan] = await db
      .select()
      .from(subscriptionPlans)
      .where(eq(subscriptionPlans.id, promo.planId))
      .limit(1);
    if (!plan) return reply.notFound();
    await assignPlan(req.userId!, plan.code as 'free' | 'premium', promo.durationDays, 'promo');
    await db
      .update(promoCodes)
      .set({ uses: promo.uses + 1 })
      .where(eq(promoCodes.id, promo.id));
    return { ok: true, planCode: plan.code };
  });

  app.post('/devices/register', async (req) => {
    await app.authenticate(req);
    const body = deviceRegisterSchema.parse(req.body);
    await db
      .insert(userDevices)
      .values({
        userId: req.userId!,
        deviceId: body.deviceId,
        name: body.name,
        lastSeenAt: new Date(),
      })
      .onConflictDoUpdate({
        target: [userDevices.userId, userDevices.deviceId],
        set: { name: body.name, lastSeenAt: new Date() },
      });
    return { ok: true };
  });

  app.post('/admin/users/:id/subscription', async (req, reply) => {
    await app.authenticate(req);
    if (req.userRole !== 'admin') return reply.forbidden();
    const { id } = req.params as { id: string };
    const body = adminSubscriptionSchema.parse(req.body);
    await assignPlan(id, body.planCode, body.days, 'admin');
    return { ok: true };
  });
}
