/**
 * Stripe: assinatura mensal Pro via Checkout + webhooks (prd.txt §6.3).
 * Sem STRIPE_SECRET_KEY configurada, os endpoints respondem 503 (dev local).
 */

import type { Request, Response } from "express";
import Stripe from "stripe";
import { config } from "./config.js";
import { Plan, User } from "./models.js";

const stripe = config.stripeSecretKey
  ? new Stripe(config.stripeSecretKey)
  : null;

export async function createCheckoutSession(
  req: Request,
  res: Response,
): Promise<void> {
  if (!stripe) {
    res
      .status(503)
      .json({ error: "Stripe não configurado (defina STRIPE_SECRET_KEY)." });
    return;
  }
  const user = await User.findById(req.auth!.userId);
  if (!user) {
    res.status(404).json({ error: "Usuário não encontrado" });
    return;
  }

  // Plano vem do CRUD do admin (prompt.txt item 14); fallback: primeiro pago.
  const { planSlug } = req.body as { planSlug?: string };
  const plan = planSlug
    ? await Plan.findOne({ slug: planSlug, published: true })
    : await Plan.findOne({
        published: true,
        stripePriceId: { $ne: "" },
      }).sort({ monthlyBudgetUsd: 1 });
  if (!plan?.stripePriceId) {
    res.status(400).json({
      error:
        "Plano indisponível para assinatura (sem price_id configurado no admin).",
    });
    return;
  }

  const session = await stripe.checkout.sessions.create({
    mode: "subscription",
    line_items: [{ price: plan.stripePriceId, quantity: 1 }],
    success_url: `${config.clientUrl}/#/editor?billing=success`,
    cancel_url: `${config.clientUrl}/#/editor?billing=cancelled`,
    customer_email: user.stripeCustomerId ? undefined : user.email,
    customer: user.stripeCustomerId ?? undefined,
    metadata: { userId: String(user._id), planSlug: plan.slug },
  });

  res.json({ url: session.url });
}

/** Webhook Stripe — precisa do body RAW (registrado antes do express.json). */
export async function handleWebhook(req: Request, res: Response): Promise<void> {
  if (!stripe || !config.stripeWebhookSecret) {
    res.status(503).send("Stripe não configurado");
    return;
  }

  let event: Stripe.Event;
  try {
    event = stripe.webhooks.constructEvent(
      req.body as Buffer,
      req.headers["stripe-signature"] as string,
      config.stripeWebhookSecret,
    );
  } catch (err) {
    res
      .status(400)
      .send(`Assinatura inválida: ${err instanceof Error ? err.message : err}`);
    return;
  }

  switch (event.type) {
    case "checkout.session.completed": {
      const session = event.data.object;
      const userId = session.metadata?.userId;
      const planSlug = session.metadata?.planSlug ?? "pro";
      if (userId) {
        await User.findByIdAndUpdate(userId, {
          plan: planSlug,
          stripeCustomerId: String(session.customer ?? ""),
          aiRequestsUsed: 0,
          aiUsageMicroUsd: 0,
          aiPeriodStart: new Date(),
        });
      }
      break;
    }
    case "customer.subscription.deleted": {
      const subscription = event.data.object;
      await User.findOneAndUpdate(
        { stripeCustomerId: String(subscription.customer) },
        { plan: "free" },
      );
      break;
    }
    default:
      break;
  }

  res.json({ received: true });
}
