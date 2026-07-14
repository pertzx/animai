import mongoose, { Schema, type InferSchemaType } from "mongoose";

const userSchema = new Schema(
  {
    name: { type: String, required: true },
    email: { type: String, required: true, unique: true, lowercase: true },
    passwordHash: { type: String, required: true },
    role: { type: String, enum: ["user", "admin"], default: "user" },
    /** Slug do plano (coleção Plan); "free" e "pro" são seed. */
    plan: { type: String, default: "free" },
    stripeCustomerId: { type: String, default: null },
    /** Caminho BYOK (API key própria do usuário): limite por requisições. */
    aiRequestsUsed: { type: Number, default: 0 },
    /** Início do período mensal (zera uso mensal de planos pagos). */
    aiPeriodStart: { type: Date, default: () => new Date() },
    /**
     * Billing por saldo (prompt.txt item 8) — valores em micro-USD inteiros
     * ($1 = 1_000_000) para evitar erro de float; NUNCA expostos ao client.
     */
    aiUsageMicroUsd: { type: Number, default: 0 },
    /** Crédito único de cortesia do plano free (não renova). */
    courtesyGrantedMicroUsd: { type: Number, default: 0 },
    courtesyUsedMicroUsd: { type: Number, default: 0 },
  },
  { timestamps: true },
);

/** Plano comercial criado no painel admin (prompt.txt itens 8 e 14). */
const planSchema = new Schema(
  {
    slug: { type: String, required: true, unique: true, lowercase: true },
    name: { type: String, required: true },
    stripePriceId: { type: String, default: "" },
    /** Orçamento mensal de IA em USD (custo calculado já com margem). */
    monthlyBudgetUsd: { type: Number, default: 0 },
    /** Features liberadas: chaves livres (ex.: premiumCatalog, export4k). */
    features: { type: Schema.Types.Mixed, default: {} },
    published: { type: Boolean, default: false },
  },
  { timestamps: true },
);

/** Configurações globais editáveis no admin (chave única "billing" etc.). */
const settingSchema = new Schema(
  {
    key: { type: String, required: true, unique: true },
    value: { type: Schema.Types.Mixed, default: {} },
  },
  { timestamps: true },
);

const catalogItemSchema = new Schema(
  {
    kind: {
      type: String,
      enum: ["effect", "transition", "animation", "template"],
      required: true,
    },
    name: { type: String, required: true },
    description: { type: String, default: "" },
    /** Payload interpretado pelo editor (tipo de efeito + params, primitivas do template, etc.) */
    payload: { type: Schema.Types.Mixed, default: {} },
    published: { type: Boolean, default: false },
    /** Item exclusivo de planos com a feature premiumCatalog. */
    premium: { type: Boolean, default: false },
    /** Importado do registry built-in do editor (payload.ref = "builtin:<id>"). */
    builtin: { type: Boolean, default: false },
  },
  { timestamps: true },
);

const aiProviderSchema = new Schema(
  {
    name: { type: String, required: true },
    baseUrl: { type: String, required: true },
    model: { type: String, required: true },
    apiKey: { type: String, required: true },
    enabled: { type: Boolean, default: true },
    isDefault: { type: Boolean, default: false },
    /** Custo real em USD por 1M de tokens (configurável no admin). */
    inputCostPerM: { type: Number, default: 0 },
    outputCostPerM: { type: Number, default: 0 },
  },
  { timestamps: true },
);

/** Metadados leves de projetos (o projeto em si fica na máquina do usuário, prd.txt §6.2). */
const projectMetaSchema = new Schema(
  {
    userId: { type: Schema.Types.ObjectId, ref: "User", required: true },
    projectId: { type: String, required: true },
    name: { type: String, required: true },
  },
  { timestamps: true },
);
projectMetaSchema.index({ userId: 1, projectId: 1 }, { unique: true });

/** Compartilhamento público de projeto (prd.txt §6.2 — link compartilhável). */
const shareSchema = new Schema(
  {
    shareId: { type: String, required: true, unique: true },
    userId: { type: Schema.Types.ObjectId, ref: "User", required: true },
    filename: { type: String, required: true },
    size: { type: Number, required: true },
    /** Timestamp ms — o link expira após este momento. */
    expiresAt: { type: Number, required: true },
    /** URL de download no nosso próprio server (blob local ou R2-compatible). */
    downloadPath: { type: String, required: true },
  },
  { timestamps: true },
);
shareSchema.index({ userId: 1, createdAt: -1 });

/** Template community (uploaded by users, browsable by all). */
const cloudTemplateSchema = new Schema(
  {
    templateId: { type: String, required: true, unique: true },
    userId: { type: Schema.Types.ObjectId, ref: "User", required: true },
    author: { type: String, default: "Anonymous" },
    name: { type: String, required: true },
    description: { type: String, default: "" },
    /** Template payload — same shape as @openreel/core Template. */
    payload: { type: Schema.Types.Mixed, required: true },
    scriptable: { type: Boolean, default: false },
    published: { type: Boolean, default: false },
    premium: { type: Boolean, default: false },
  },
  { timestamps: true },
);
cloudTemplateSchema.index({ published: 1, createdAt: -1 });

/** Highlight extractions — stored so the AI can use them in context. */
const shareHighlightSchema = new Schema(
  {
    shareId: { type: String, required: true },
    userId: { type: Schema.Types.ObjectId, ref: "User", required: true },
    start: { type: Number, required: true },
    end: { type: Number, required: true },
    score: { type: Number, required: true },
    title: { type: String, default: "" },
    reason: { type: String, default: "" },
  },
  { timestamps: true },
);
shareHighlightSchema.index({ shareId: 1 });

export type UserDoc = InferSchemaType<typeof userSchema>;
export type CatalogItemDoc = InferSchemaType<typeof catalogItemSchema>;
export type AiProviderDoc = InferSchemaType<typeof aiProviderSchema>;

export const User = mongoose.model("User", userSchema);
export const CatalogItem = mongoose.model("CatalogItem", catalogItemSchema);
export const AiProvider = mongoose.model("AiProvider", aiProviderSchema);
export const ProjectMeta = mongoose.model("ProjectMeta", projectMetaSchema);
export const Plan = mongoose.model("Plan", planSchema);
export const Setting = mongoose.model("Setting", settingSchema);
export const Share = mongoose.model("Share", shareSchema);
export const CloudTemplate = mongoose.model("CloudTemplate", cloudTemplateSchema);
export const ShareHighlight = mongoose.model("ShareHighlight", shareHighlightSchema);

export interface BillingSettings {
  /** Multiplicador de margem: custoCalculado = custoReal × multiplier. */
  marginMultiplier: number;
  /** Crédito único de cortesia (USD) concedido no registro do plano free. */
  courtesyUsd: number;
}

export const DEFAULT_BILLING: BillingSettings = {
  marginMultiplier: 2,
  courtesyUsd: 0.5,
};

export async function getBillingSettings(): Promise<BillingSettings> {
  const doc = await Setting.findOne({ key: "billing" });
  return { ...DEFAULT_BILLING, ...((doc?.value as Partial<BillingSettings>) ?? {}) };
}

/** Garante os planos base (free/pro) na primeira subida. */
export async function seedPlans(): Promise<void> {
  const count = await Plan.countDocuments();
  if (count > 0) return;
  await Plan.create([
    {
      slug: "free",
      name: "Free",
      monthlyBudgetUsd: 0,
      features: { assistant: true },
      published: true,
    },
    {
      slug: "pro",
      name: "Pro",
      monthlyBudgetUsd: 10,
      features: { assistant: true, premiumCatalog: true, export4k: true, components: true },
      published: true,
    },
  ]);
}
