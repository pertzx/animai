import "dotenv/config";

const env = (name: string, fallback?: string): string => {
  const value = process.env[name] ?? fallback;
  if (value === undefined) {
    throw new Error(`Variável de ambiente obrigatória ausente: ${name}`);
  }
  return value;
};

export const config = {
  port: Number(process.env.PORT ?? 4000),
  mongodbUri: env("MONGODB_URI", "mongodb://localhost:27017/animai"),
  jwtSecret: env("JWT_SECRET", "animai-dev-secret-trocar-em-producao"),
  clientUrl: env("CLIENT_URL", "http://localhost:5173"),
  /** E-mails que recebem role admin automaticamente no registro. */
  adminEmails: (process.env.ADMIN_EMAILS ?? "")
    .split(",")
    .map((e) => e.trim().toLowerCase())
    .filter(Boolean),
  freeAiRequestsLimit: Number(process.env.FREE_AI_REQUESTS_LIMIT ?? 50),
  proAiRequestsLimit: Number(process.env.PRO_AI_REQUESTS_LIMIT ?? 2000),
  /** Limite de requisições/mês quando o usuário usa a própria API key. */
  byokRequestsPerMonth: Number(process.env.BYOK_REQUESTS_PER_MONTH ?? 3000),

  // Fallback de providers quando não há nenhum configurado no painel admin.
  openaiApiKey: process.env.OPENAI_API_KEY ?? "",
  nvidiaApiKey: process.env.NVIDIA_API_KEY ?? "",

  stripeSecretKey: process.env.STRIPE_SECRET_KEY ?? "",
  stripeWebhookSecret: process.env.STRIPE_WEBHOOK_SECRET ?? "",
  stripePriceIdPro: process.env.STRIPE_PRICE_ID_PRO ?? "",
} as const;
