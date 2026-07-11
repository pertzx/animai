import type { NextFunction, Request, Response } from "express";
import jwt from "jsonwebtoken";
import { config } from "./config.js";
import { Plan, User } from "./models.js";

export interface AuthPayload {
  userId: string;
  role: "user" | "admin";
}

declare global {
  // eslint-disable-next-line @typescript-eslint/no-namespace
  namespace Express {
    interface Request {
      auth?: AuthPayload;
    }
  }
}

export function signToken(payload: AuthPayload): string {
  return jwt.sign(payload, config.jwtSecret, { expiresIn: "30d" });
}

export function requireAuth(
  req: Request,
  res: Response,
  next: NextFunction,
): void {
  const header = req.headers.authorization;
  const token = header?.startsWith("Bearer ") ? header.slice(7) : null;
  if (!token) {
    res.status(401).json({ error: "Não autenticado" });
    return;
  }
  try {
    req.auth = jwt.verify(token, config.jwtSecret) as AuthPayload;
    next();
  } catch {
    res.status(401).json({ error: "Token inválido ou expirado" });
  }
}

export function requireAdmin(
  req: Request,
  res: Response,
  next: NextFunction,
): void {
  if (req.auth?.role !== "admin") {
    res.status(403).json({ error: "Apenas administradores" });
    return;
  }
  next();
}

const MICRO = 1_000_000;

/**
 * Representação pública do usuário. NUNCA expõe valores em USD — o saldo de
 * IA aparece só como percentual restante (prompt.txt item 8).
 */
export async function buildPublicUser(user: {
  _id: unknown;
  email: string;
  name: string;
  role: string;
  plan: string;
  aiRequestsUsed: number;
  aiUsageMicroUsd?: number;
  courtesyGrantedMicroUsd?: number;
  courtesyUsedMicroUsd?: number;
}) {
  const plan = await Plan.findOne({ slug: user.plan });
  const monthlyBudgetMicro = Math.round((plan?.monthlyBudgetUsd ?? 0) * MICRO);

  let aiBalancePercent: number;
  let balanceKind: "monthly" | "courtesy";
  if (monthlyBudgetMicro > 0) {
    balanceKind = "monthly";
    aiBalancePercent = Math.max(
      0,
      Math.round(
        (1 - (user.aiUsageMicroUsd ?? 0) / monthlyBudgetMicro) * 100,
      ),
    );
  } else {
    balanceKind = "courtesy";
    const granted = user.courtesyGrantedMicroUsd ?? 0;
    const used = user.courtesyUsedMicroUsd ?? 0;
    aiBalancePercent =
      granted > 0 ? Math.max(0, Math.round((1 - used / granted) * 100)) : 0;
  }

  return {
    id: String(user._id),
    email: user.email,
    name: user.name,
    role: user.role,
    plan: user.plan,
    planName: plan?.name ?? user.plan,
    planFeatures: (plan?.features as Record<string, boolean>) ?? {},
    /** % de saldo de IA restante (0–100). O valor em USD nunca sai da API. */
    aiBalancePercent,
    balanceKind,
    /** Caminho BYOK (API própria): contagem de requisições. */
    byokRequestsUsed: user.aiRequestsUsed,
    byokRequestsLimit: config.byokRequestsPerMonth,
  };
}

/** Vira o período mensal: zera uso do orçamento mensal e requisições BYOK. */
export async function rolloverAiPeriod(userId: string): Promise<void> {
  const user = await User.findById(userId);
  if (!user) return;
  const started = user.aiPeriodStart ?? new Date(0);
  const monthMs = 30 * 24 * 60 * 60 * 1000;
  if (Date.now() - started.getTime() > monthMs) {
    user.aiRequestsUsed = 0;
    user.aiUsageMicroUsd = 0; // cortesia NÃO zera: é crédito único
    user.aiPeriodStart = new Date();
    await user.save();
  }
}
