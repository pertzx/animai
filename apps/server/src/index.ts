import dns from "node:dns";
import express from "express";
import cors from "cors";
import mongoose from "mongoose";
import bcrypt from "bcryptjs";
import { config } from "./config.js";
import {
  AiProvider,
  CatalogItem,
  Plan,
  ProjectMeta,
  Setting,
  User,
  getBillingSettings,
  seedPlans,
} from "./models.js";
import {
  buildPublicUser,
  requireAdmin,
  requireAuth,
  signToken,
} from "./auth.js";
import { handleChat, handleCompact, handleSearch, handleUsage } from "./ai.js";
import { createCheckoutSession, handleWebhook } from "./billing.js";

const app = express();
app.use(cors({ origin: config.clientUrl }));

// Webhook precisa do body cru para validar a assinatura — antes do json().
app.post(
  "/api/billing/webhook",
  express.raw({ type: "application/json" }),
  handleWebhook,
);

app.use(express.json({ limit: "4mb" }));

// ── Auth (prd.txt §6.1) ─────────────────────────────────────────────
app.post("/api/auth/register", async (req, res) => {
  const { name, email, password } = req.body as {
    name?: string;
    email?: string;
    password?: string;
  };
  if (!name || !email || !password || password.length < 6) {
    res
      .status(400)
      .json({ error: "Informe nome, e-mail e senha (mínimo 6 caracteres)." });
    return;
  }
  const existing = await User.findOne({ email: email.toLowerCase() });
  if (existing) {
    res.status(409).json({ error: "E-mail já cadastrado." });
    return;
  }
  const isAdmin = config.adminEmails.includes(email.toLowerCase());
  const billing = await getBillingSettings();
  const user = await User.create({
    name,
    email: email.toLowerCase(),
    passwordHash: await bcrypt.hash(password, 10),
    role: isAdmin ? "admin" : "user",
    // Crédito único de cortesia (não renovável), configurável no admin.
    courtesyGrantedMicroUsd: Math.round(billing.courtesyUsd * 1_000_000),
  });
  const token = signToken({ userId: String(user._id), role: user.role });
  res.json({ token, user: await buildPublicUser(user) });
});

app.post("/api/auth/login", async (req, res) => {
  const { email, password } = req.body as { email?: string; password?: string };
  const user = email
    ? await User.findOne({ email: email.toLowerCase() })
    : null;
  if (!user || !password || !(await bcrypt.compare(password, user.passwordHash))) {
    res.status(401).json({ error: "E-mail ou senha inválidos." });
    return;
  }
  const token = signToken({ userId: String(user._id), role: user.role });
  res.json({ token, user: await buildPublicUser(user) });
});

app.get("/api/auth/me", requireAuth, async (req, res) => {
  const user = await User.findById(req.auth!.userId);
  if (!user) {
    res.status(404).json({ error: "Usuário não encontrado" });
    return;
  }
  res.json({ user: await buildPublicUser(user) });
});

// ── Catálogo público (itens publicados, sincronizado no login — prd.txt §5) ──
app.get("/api/catalog", requireAuth, async (_req, res) => {
  const items = await CatalogItem.find({ published: true }).sort({
    kind: 1,
    name: 1,
  });
  res.json({ items: items.map(catalogPublic) });
});

// ── Admin: CRUD do catálogo (prd.txt §5) ────────────────────────────
const catalogPublic = (i: InstanceType<typeof CatalogItem>) => ({
  id: String(i._id),
  kind: i.kind,
  name: i.name,
  description: i.description,
  payload: i.payload,
  published: i.published,
  premium: i.premium ?? false,
  builtin: i.builtin ?? false,
});

app.get("/api/admin/catalog", requireAuth, requireAdmin, async (_req, res) => {
  const items = await CatalogItem.find().sort({ kind: 1, name: 1 });
  res.json({ items: items.map(catalogPublic) });
});

app.post("/api/admin/catalog", requireAuth, requireAdmin, async (req, res) => {
  const { kind, name, description, payload, published, premium, builtin } =
    req.body ?? {};
  if (!kind || !name) {
    res.status(400).json({ error: "kind e name são obrigatórios" });
    return;
  }
  const item = await CatalogItem.create({
    kind,
    name,
    description: description ?? "",
    payload: payload ?? {},
    published: Boolean(published),
    premium: Boolean(premium),
    builtin: Boolean(builtin),
  });
  res.json({ item: catalogPublic(item) });
});

/** Importa built-ins do editor em lote (enviados pelo client admin). */
app.post(
  "/api/admin/catalog/import-builtins",
  requireAuth,
  requireAdmin,
  async (req, res) => {
    const { items } = req.body as {
      items?: Array<{
        kind: string;
        name: string;
        description?: string;
        payload?: Record<string, unknown>;
      }>;
    };
    if (!Array.isArray(items) || items.length === 0) {
      res.status(400).json({ error: "items é obrigatório" });
      return;
    }
    let created = 0;
    for (const item of items.slice(0, 200)) {
      const ref = (item.payload as { ref?: string } | undefined)?.ref;
      if (!ref) continue;
      const exists = await CatalogItem.findOne({ "payload.ref": ref });
      if (exists) continue;
      await CatalogItem.create({
        kind: item.kind,
        name: item.name,
        description: item.description ?? "",
        payload: item.payload ?? {},
        published: true,
        premium: false,
        builtin: true,
      });
      created++;
    }
    res.json({ created });
  },
);

app.put("/api/admin/catalog/:id", requireAuth, requireAdmin, async (req, res) => {
  const item = await CatalogItem.findByIdAndUpdate(req.params.id, req.body, {
    new: true,
  });
  if (!item) {
    res.status(404).json({ error: "Item não encontrado" });
    return;
  }
  res.json({ item: catalogPublic(item) });
});

app.delete(
  "/api/admin/catalog/:id",
  requireAuth,
  requireAdmin,
  async (req, res) => {
    await CatalogItem.findByIdAndDelete(req.params.id);
    res.json({ ok: true });
  },
);

// ── Admin: providers de IA (prd.txt §3.3 — iniciais Nvidia e OpenAI) ──
const providerPublic = (p: InstanceType<typeof AiProvider>) => ({
  id: String(p._id),
  name: p.name,
  baseUrl: p.baseUrl,
  model: p.model,
  enabled: p.enabled,
  isDefault: p.isDefault,
  // Custos reais por 1M tokens (só admins veem estas rotas).
  inputCostPerM: p.inputCostPerM ?? 0,
  outputCostPerM: p.outputCostPerM ?? 0,
  // A API key nunca volta ao client — nem para admins.
  hasApiKey: Boolean(p.apiKey),
});

app.get("/api/admin/providers", requireAuth, requireAdmin, async (_req, res) => {
  const providers = await AiProvider.find().sort({ isDefault: -1, name: 1 });
  res.json({ providers: providers.map(providerPublic) });
});

app.post("/api/admin/providers", requireAuth, requireAdmin, async (req, res) => {
  const {
    name,
    baseUrl,
    model,
    apiKey,
    enabled,
    isDefault,
    inputCostPerM,
    outputCostPerM,
  } = req.body ?? {};
  if (!name || !baseUrl || !model || !apiKey) {
    res
      .status(400)
      .json({ error: "name, baseUrl, model e apiKey são obrigatórios" });
    return;
  }
  if (isDefault) await AiProvider.updateMany({}, { isDefault: false });
  const provider = await AiProvider.create({
    name,
    baseUrl,
    model,
    apiKey,
    enabled: enabled ?? true,
    isDefault: Boolean(isDefault),
    inputCostPerM: Number(inputCostPerM ?? 0),
    outputCostPerM: Number(outputCostPerM ?? 0),
  });
  res.json({ provider: providerPublic(provider) });
});

app.put(
  "/api/admin/providers/:id",
  requireAuth,
  requireAdmin,
  async (req, res) => {
    const updates = { ...req.body } as Record<string, unknown>;
    if (updates.apiKey === "") delete updates.apiKey; // manter a key atual
    if (updates.isDefault) await AiProvider.updateMany({}, { isDefault: false });
    const provider = await AiProvider.findByIdAndUpdate(req.params.id, updates, {
      new: true,
    });
    if (!provider) {
      res.status(404).json({ error: "Provider não encontrado" });
      return;
    }
    res.json({ provider: providerPublic(provider) });
  },
);

app.delete(
  "/api/admin/providers/:id",
  requireAuth,
  requireAdmin,
  async (req, res) => {
    await AiProvider.findByIdAndDelete(req.params.id);
    res.json({ ok: true });
  },
);

// ── Admin: planos (prompt.txt itens 8 e 14) ─────────────────────────
const planPublic = (p: InstanceType<typeof Plan>) => ({
  id: String(p._id),
  slug: p.slug,
  name: p.name,
  stripePriceId: p.stripePriceId,
  monthlyBudgetUsd: p.monthlyBudgetUsd,
  features: p.features ?? {},
  published: p.published,
});

app.get("/api/admin/plans", requireAuth, requireAdmin, async (_req, res) => {
  const plans = await Plan.find().sort({ monthlyBudgetUsd: 1 });
  res.json({ plans: plans.map(planPublic) });
});

app.post("/api/admin/plans", requireAuth, requireAdmin, async (req, res) => {
  const { slug, name, stripePriceId, monthlyBudgetUsd, features, published } =
    req.body ?? {};
  if (!slug || !name) {
    res.status(400).json({ error: "slug e name são obrigatórios" });
    return;
  }
  const existing = await Plan.findOne({ slug: String(slug).toLowerCase() });
  if (existing) {
    res.status(409).json({ error: "Já existe um plano com esse slug" });
    return;
  }
  const plan = await Plan.create({
    slug: String(slug).toLowerCase(),
    name,
    stripePriceId: stripePriceId ?? "",
    monthlyBudgetUsd: Number(monthlyBudgetUsd ?? 0),
    features: features ?? {},
    published: Boolean(published),
  });
  res.json({ plan: planPublic(plan) });
});

app.put("/api/admin/plans/:id", requireAuth, requireAdmin, async (req, res) => {
  const updates = { ...req.body } as Record<string, unknown>;
  delete updates.slug; // slug é a chave de vínculo com usuários — imutável
  const plan = await Plan.findByIdAndUpdate(req.params.id, updates, {
    new: true,
  });
  if (!plan) {
    res.status(404).json({ error: "Plano não encontrado" });
    return;
  }
  res.json({ plan: planPublic(plan) });
});

app.delete(
  "/api/admin/plans/:id",
  requireAuth,
  requireAdmin,
  async (req, res) => {
    const plan = await Plan.findById(req.params.id);
    if (!plan) {
      res.status(404).json({ error: "Plano não encontrado" });
      return;
    }
    if (plan.slug === "free") {
      res.status(400).json({ error: "O plano free não pode ser removido" });
      return;
    }
    const inUse = await User.countDocuments({ plan: plan.slug });
    if (inUse > 0) {
      res.status(400).json({
        error: `${inUse} usuário(s) ainda estão neste plano — migre-os antes.`,
      });
      return;
    }
    await plan.deleteOne();
    res.json({ ok: true });
  },
);

/** Planos publicados (público autenticado — para tela de upgrade/landing). */
app.get("/api/plans", async (_req, res) => {
  const plans = await Plan.find({ published: true }).sort({
    monthlyBudgetUsd: 1,
  });
  res.json({
    plans: plans.map((p) => ({
      slug: p.slug,
      name: p.name,
      features: p.features ?? {},
      hasCheckout: Boolean(p.stripePriceId),
    })),
  });
});

// ── Admin: configurações de billing (margem e cortesia) ─────────────
app.get(
  "/api/admin/billing-settings",
  requireAuth,
  requireAdmin,
  async (_req, res) => {
    res.json({ settings: await getBillingSettings() });
  },
);

app.put(
  "/api/admin/billing-settings",
  requireAuth,
  requireAdmin,
  async (req, res) => {
    const { marginMultiplier, courtesyUsd } = req.body ?? {};
    const current = await getBillingSettings();
    const next = {
      marginMultiplier: Number(marginMultiplier ?? current.marginMultiplier),
      courtesyUsd: Number(courtesyUsd ?? current.courtesyUsd),
    };
    if (next.marginMultiplier < 1) {
      res.status(400).json({ error: "marginMultiplier deve ser ≥ 1" });
      return;
    }
    await Setting.findOneAndUpdate(
      { key: "billing" },
      { value: next },
      { upsert: true },
    );
    res.json({ settings: next });
  },
);

// ── Admin: usuários ─────────────────────────────────────────────────
// O admin vê a lista completa e pode trocar o plano de qualquer usuário.
// Como é uma rota de admin, os valores de uso em USD são expostos aqui
// (a restrição "cliente nunca vê USD" vale para o próprio usuário).
const MICRO = 1_000_000;

const adminUserView = (
  u: InstanceType<typeof User>,
  budgetByPlan: Map<string, number>,
) => {
  const monthlyBudget = budgetByPlan.get(u.plan) ?? 0;
  const usageUsd = (u.aiUsageMicroUsd ?? 0) / MICRO;
  const courtesyGranted = (u.courtesyGrantedMicroUsd ?? 0) / MICRO;
  const courtesyUsed = (u.courtesyUsedMicroUsd ?? 0) / MICRO;
  return {
    id: String(u._id),
    name: u.name,
    email: u.email,
    role: u.role,
    plan: u.plan,
    createdAt: (u as unknown as { createdAt?: Date }).createdAt ?? null,
    // Uso real em USD (visível só para admins).
    aiUsageUsd: Math.round(usageUsd * 10000) / 10000,
    monthlyBudgetUsd: monthlyBudget,
    courtesyGrantedUsd: Math.round(courtesyGranted * 10000) / 10000,
    courtesyUsedUsd: Math.round(courtesyUsed * 10000) / 10000,
    byokRequestsUsed: u.aiRequestsUsed ?? 0,
  };
};

app.get("/api/admin/users", requireAuth, requireAdmin, async (req, res) => {
  const search = String(req.query.search ?? "").trim().toLowerCase();
  const filter = search
    ? {
        $or: [
          { email: { $regex: search, $options: "i" } },
          { name: { $regex: search, $options: "i" } },
        ],
      }
    : {};
  const [users, plans] = await Promise.all([
    User.find(filter).sort({ createdAt: -1 }).limit(500),
    Plan.find(),
  ]);
  const budgetByPlan = new Map(
    plans.map((p) => [p.slug, p.monthlyBudgetUsd ?? 0]),
  );
  res.json({ users: users.map((u) => adminUserView(u, budgetByPlan)) });
});

app.put("/api/admin/users/:id", requireAuth, requireAdmin, async (req, res) => {
  if (!mongoose.isValidObjectId(req.params.id)) {
    res.status(400).json({ error: "id de usuário inválido" });
    return;
  }
  const { plan, role, resetUsage } = req.body as {
    plan?: string;
    role?: "user" | "admin";
    resetUsage?: boolean;
  };
  const updates: Record<string, unknown> = {};

  if (plan !== undefined) {
    const target = await Plan.findOne({ slug: plan });
    if (!target) {
      res.status(400).json({ error: `Plano "${plan}" não existe.` });
      return;
    }
    updates.plan = plan;
    // Trocar de plano zera o consumo do período atual.
    updates.aiUsageMicroUsd = 0;
    updates.aiPeriodStart = new Date();
  }
  if (role === "user" || role === "admin") {
    // Um admin não pode rebaixar a si mesmo (evita ficar sem admin).
    if (req.params.id === req.auth!.userId && role !== "admin") {
      res.status(400).json({ error: "Você não pode remover seu próprio admin." });
      return;
    }
    updates.role = role;
  }
  if (resetUsage) {
    updates.aiUsageMicroUsd = 0;
    updates.courtesyUsedMicroUsd = 0;
    updates.aiRequestsUsed = 0;
    updates.aiPeriodStart = new Date();
  }

  const user = await User.findByIdAndUpdate(req.params.id, updates, {
    new: true,
  });
  if (!user) {
    res.status(404).json({ error: "Usuário não encontrado" });
    return;
  }
  const plans = await Plan.find();
  const budgetByPlan = new Map(
    plans.map((p) => [p.slug, p.monthlyBudgetUsd ?? 0]),
  );
  res.json({ user: adminUserView(user, budgetByPlan) });
});

// ── Metadados leves de projetos (prd.txt §6.2) ──────────────────────
app.get("/api/projects", requireAuth, async (req, res) => {
  const projects = await ProjectMeta.find({ userId: req.auth!.userId }).sort({
    updatedAt: -1,
  });
  res.json({
    projects: projects.map((p) => ({
      projectId: p.projectId,
      name: p.name,
      updatedAt: p.updatedAt,
    })),
  });
});

app.put("/api/projects/:projectId", requireAuth, async (req, res) => {
  const { name } = req.body as { name?: string };
  await ProjectMeta.findOneAndUpdate(
    { userId: req.auth!.userId, projectId: req.params.projectId },
    { name: name ?? "Sem nome" },
    { upsert: true },
  );
  res.json({ ok: true });
});

// ── IA (proxy + compactação + uso) ──────────────────────────────────
app.post("/api/ai/chat", requireAuth, handleChat);
app.post("/api/ai/compact", requireAuth, handleCompact);
app.post("/api/ai/search", requireAuth, handleSearch);
app.get("/api/ai/usage", requireAuth, handleUsage);

// ── Billing ─────────────────────────────────────────────────────────
app.post("/api/billing/checkout", requireAuth, createCheckoutSession);

app.get("/api/health", (_req, res) => res.json({ ok: true }));

async function connectDb(): Promise<void> {
  try {
    await mongoose.connect(config.mongodbUri, {
      serverSelectionTimeoutMS: 8000,
    });
    console.log(`[animai-server] MongoDB conectado: ${config.mongodbUri}`);
  } catch (err) {
    // Alguns DNS locais (provedor/roteador) recusam consultas SRV, que o
    // mongodb+srv:// exige. Nesse caso, refaz a resolução via DNS público.
    if (
      config.mongodbUri.startsWith("mongodb+srv://") &&
      /querySrv|ESERVFAIL|ECONNREFUSED|ENOTFOUND/.test(String(err))
    ) {
      console.warn(
        "[animai-server] DNS local não resolveu o registro SRV do Atlas — tentando com DNS público (8.8.8.8 / 1.1.1.1)…",
      );
      dns.setServers(["8.8.8.8", "1.1.1.1"]);
      try {
        await mongoose.connect(config.mongodbUri, {
          serverSelectionTimeoutMS: 10000,
        });
        console.log(
          "[animai-server] MongoDB Atlas conectado (via DNS público).",
        );
        return;
      } catch (retryErr) {
        console.warn(
          `[animai-server] Retentativa com DNS público também falhou: ${retryErr instanceof Error ? retryErr.message : retryErr}`,
        );
      }
    }
    // Dev sem MongoDB instalado: sobe um Mongo em memória (dados voláteis).
    console.warn(
      `[animai-server] MongoDB indisponível em ${config.mongodbUri} — usando mongodb-memory-server (SOMENTE DEV; dados são perdidos ao reiniciar).`,
    );
    const { MongoMemoryServer } = await import("mongodb-memory-server");
    const memoryServer = await MongoMemoryServer.create();
    await mongoose.connect(memoryServer.getUri("animai"));
    console.log("[animai-server] Mongo em memória pronto.");
  }
}

// Middleware de erro do Express: captura throws síncronos e erros passados
// via next(err), respondendo 500 em vez de deixar a conexão pendurada.
app.use(
  (
    err: unknown,
    _req: express.Request,
    res: express.Response,
    _next: express.NextFunction,
  ) => {
    console.error("[animai-server] erro na rota:", err);
    if (!res.headersSent) {
      res.status(500).json({ error: "Erro interno do servidor" });
    }
  },
);

// Rede de segurança: uma única requisição malformada (ex.: CastError de
// ObjectId inválido num handler async) nunca deve derrubar o processo todo.
process.on("unhandledRejection", (reason) => {
  console.error("[animai-server] unhandledRejection (ignorado):", reason);
});
process.on("uncaughtException", (err) => {
  console.error("[animai-server] uncaughtException (ignorado):", err);
});

async function main() {
  await connectDb();
  await seedPlans();
  app.listen(config.port, () => {
    console.log(`[animai-server] ouvindo em http://localhost:${config.port}`);
  });
}

main().catch((err) => {
  console.error("[animai-server] falha ao iniciar:", err);
  process.exit(1);
});
