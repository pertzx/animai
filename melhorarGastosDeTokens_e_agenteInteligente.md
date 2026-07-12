Analisando o código que li:

- `buildSystemPrompt()` injeta **35 tool definitions** completas (cada uma com nome, descrição longa, parâmetros JSON Schema)
- Cada tool tem descrição detalhada em português + schema de parâmetros
- O backend `/api/ai/chat` envia essas 35 tools para o LLM a **cada requisição**
- O System Prompt tem ~2.000 caracteres de instruções
- O `project-context` mesmo vazio ainda serializa estrutura vazia (`[]`, `{}`)

**Por que 10.000 tokens num projeto zerado:**

| Componente | Tokens estimados |
|---|---|
| System Prompt (instruções) | ~800 |
| 35 Tool Definitions (schemas JSON) | ~6.000–7.000 |
| Project Context (vazio mas estruturado) | ~500–1.000 |
| Histórico de mensagens | ~200–500 |
| **TOTAL** | **~7.500–9.500** |

Isso confirma: **as tools são o maior culpado**, não os dados do projeto.

---

# PLANO PERFEITO: REDUZIR TOKENS + AGENTE INTELIGENTE

## FASE 1: REDUÇÃO DRÁSTICA DE TOKENS (1–2 dias)

### 1.1 Compactar Tool Definitions — economia: 60–70% das tools

**Arquivo:** `apps/web/src/services/ai/tools.ts`  
**Problema:** Cada tool tem descrição longa + schema JSON completo. 35 tools × ~200 tokens = 7.000 tokens.

**Solução:** Agrupar tools relacionadas em **tool groups** com sub-comandos.

```typescript
// ANTES (7.000+ tokens):
const AI_TOOLS = [
  { name: "split_clip", description: "Divide um clipe em dois...", parameters: {...} },
  { name: "trim_clip", description: "Ajusta os pontos de entrada...", parameters: {...} },
  { name: "move_clip", description: "Move um clipe para outro tempo...", parameters: {...} },
  { name: "delete_clip", description: "Remove um clipe...", parameters: {...} },
  { name: "delete_clips", description: "Remove vários clipes...", parameters: {...} },
  // ... 30 mais
];

// DEPOIS (~2.500 tokens):
const AI_TOOLS = [
  {
    name: "clip_edit",
    description: `Edita clipes na timeline. Ação: "split" | "trim" | "move" | "delete" | "delete_batch".`,
    parameters: {
      type: "object",
      properties: {
        action: { type: "string", enum: ["split", "trim", "move", "delete", "delete_batch"] },
        clipId: { type: "string" },
        // parâmetros condicionais por ação
        timeSec: { type: "number" },
        inPointSec: { type: "number" },
        outPointSec: { type: "number" },
        startTimeSec: { type: "number" },
        trackId: { type: "string" },
        clipIds: { type: "array", items: { type: "string" } },
      },
      required: ["action", "clipId"],
    },
  },
  {
    name: "timeline_query",
    description: `Consulta informações do projeto. Tipo: "state" | "transcript" | "insights" | "semantic" | "moments".`,
    parameters: {
      type: "object",
      properties: {
        type: { type: "string", enum: ["state", "transcript", "insights", "semantic", "moments"] },
        mediaId: { type: "string" },
        query: { type: "string" }, // para moments
      },
      required: ["type"],
    },
  },
  {
    name: "timeline_edit",
    description: `Edição automática da timeline. Ação: "cut_silences" | "add_captions" | "apply_template" | "apply_camera_move".`,
    parameters: {
      type: "object",
      properties: {
        action: { type: "string", enum: ["cut_silences", "add_captions", "apply_template", "apply_camera_move"] },
        mediaId: { type: "string" },
        keyframes: { type: "array" },
      },
      required: ["action"],
    },
  },
  {
    name: "media_manage",
    description: `Gerencia mídias e efeitos. Ação: "add_clip" | "import" | "apply_effect" | "remove_effect" | "adjust_audio" | "add_text" | "add_vector".`,
    parameters: {
      type: "object",
      properties: {
        action: { type: "string", enum: ["add_clip", "import", "apply_effect", "remove_effect", "adjust_audio", "add_text", "add_vector"] },
        // parâmetros condicionais
      },
      required: ["action"],
    },
  },
  {
    name: "asset_library",
    description: `Biblioteca de assets. Ação: "list_catalog" | "list_templates" | "list_vector_presets" | "list_components" | "insert_component" | "save_component".`,
    parameters: {
      type: "object",
      properties: {
        action: { type: "string", enum: ["list_catalog", "list_templates", "list_vector_presets", "list_components", "insert_component", "save_component"] },
      },
      required: ["action"],
    },
  },
  {
    name: "semantic_analysis",
    description: `Análise semântica de vídeo. Ação: "run" | "get_timeline" | "find_moments".`,
    parameters: {
      type: "object",
      properties: {
        action: { type: "string", enum: ["run", "get_timeline", "find_moments"] },
        mediaId: { type: "string" },
        query: { type: "string" },
        force: { type: "boolean" },
      },
      required: ["action"],
    },
  },
  {
    name: "web_search",
    description: "Pesquisa na web.",
    parameters: {
      type: "object",
      properties: { query: { type: "string" }, maxResults: { type: "number" } },
      required: ["query"],
    },
  },
];

// Total: 7 tools em vez de 35
// Economia: ~5.000 tokens por requisição
```

**Trade-off:** O modelo precisa saber que `clip_edit` com `action: "split"` faz o que `split_clip` fazia. Mas o System Prompt já ensina isso.

---

### 1.2 Lazy Tool Loading — só enviar tools relevantes

**Arquivo:** `apps/web/src/services/ai/agent.ts`  
**Função:** `streamChat()`

```typescript
// ANTES: envia TODAS as tools sempre
body: JSON.stringify({
  messages,
  tools: AI_TOOLS.map(t => ({ type: "function", function: { name: t.name, description: t.description, parameters: t.parameters } })),
})

// DEPOIS: só envia tools relevantes para a intenção detectada
function selectToolsForIntent(userMessage: string): AiToolDefinition[] {
  const msg = userMessage.toLowerCase();
  
  // Sempre inclui:
  const base = [getTool("timeline_query"), getTool("semantic_analysis")];
  
  if (msg.includes("corta") || msg.includes("divide") || msg.includes("move") || msg.includes("remove") || msg.includes("apaga")) {
    base.push(getTool("clip_edit"));
  }
  
  if (msg.includes("efeito") || msg.includes("transição") || msg.includes("texto") || msg.includes("áudio") || msg.includes("volume")) {
    base.push(getTool("media_manage"));
  }
  
  if (msg.includes("template") || msg.includes("componente") || msg.includes("catálogo")) {
    base.push(getTool("asset_library"));
  }
  
  if (msg.includes("silêncio") || msg.includes("legenda") || msg.includes("zoom") || msg.includes("câmera")) {
    base.push(getTool("timeline_edit"));
  }
  
  if (msg.includes("pesquisa") || msg.includes("busca") || msg.includes("internet")) {
    base.push(getTool("web_search"));
  }
  
  return base;
}

// Na chamada:
body: JSON.stringify({
  messages,
  tools: selectToolsForIntent(lastUserMessage).map(t => ({...})),
})
```

**Economia:** Projeto zerado + intenção simples ("oi") = **só 2–3 tools** = ~500–800 tokens de tools.

**Projeto zerado + "corta silêncios"** = ~4 tools = ~1.200 tokens.

---

### 1.3 System Prompt enxuto — separar instruções de referência

**Arquivo:** `apps/web/src/services/ai/agent.ts`  
**Função:** `buildSystemPrompt()`

```typescript
// ANTES (~800 tokens):
"Você é o assistente de edição de vídeo do AnimAI..."
+ 15 regras detalhadas
+ explicação de semantic timeline
+ explicação de editorState
+ etc.

// DEPOIS (~300 tokens):
const SYSTEM_PROMPT_CORE = `Você é o editor de vídeo IA do AnimAI.
Modos: PLANEJAR → EXECUTAR → VALIDAR → RESPONDER.
Regras: confira estado antes de editar; use tempos em segundos; valide resultados; não invente IDs.`;

// Referências (só incluídas quando necessário):
const REF_SEMANTIC = `Timeline Semântica: use get_timeline/find_moments para conteúdo visual.`;
const REF_EDITORSTATE = `editorState: clipsAtPlayhead = o que o usuário vê; selectedClips = seleção atual.`;

function buildSystemPrompt(summary: string, intent: string): string {
  let prompt = SYSTEM_PROMPT_CORE;
  
  // Só inclui referência de semantic se a intenção envolver análise de vídeo
  if (intentMatches(intent, ["vídeo", "cena", "rosto", "objeto", "momento", "silêncio"])) {
    prompt += "\n" + REF_SEMANTIC;
  }
  
  // Só inclui referência de editorState se a intenção envolver edição
  if (intentMatches(intent, ["clip", "corte", "move", "efeito", "timeline"])) {
    prompt += "\n" + REF_EDITORSTATE;
  }
  
  // Contexto do projeto (mínimo quando zerado):
  const context = getCurrentProjectContext();
  if (isProjectEmpty(context)) {
    prompt += "\nProjeto: vazio. Nenhuma mídia na timeline.";
  } else {
    prompt += "\n" + compactContext(context);
  }
  
  return prompt;
}
```

**Economia:** ~500 tokens no System Prompt base.

---

### 1.4 Project Context mínimo quando vazio

**Arquivo:** `apps/web/src/services/ai/project-context.ts`  
**Função:** `getCurrentProjectContext()`

```typescript
// ANTES: mesmo vazio, serializa toda a estrutura
{
  schemaVersion: 1,
  project: { id, name, settings, durationSec: 0 },
  media: [],
  tracks: [],
  textClips: [],
  subtitles: [],
  transcripts: [],
  editorState: { playheadSec: 0, clipsAtPlayhead: [], selectedClips: [], recentActions: [] }
}

// DEPOIS: detecta vazio e retorna string minimal
export function getCurrentProjectContext(): AiProjectContext | string {
  const project = useProjectStore.getState().project;
  
  const isEmpty = 
    project.mediaLibrary.items.length === 0 &&
    project.timeline.tracks.every(t => t.clips.length === 0);
  
  if (isEmpty) {
    return "PROJETO_VAZIO"; // 2 tokens!
  }
  
  return buildProjectContext(project);
}
```

**Economia:** De ~500 tokens (estrutura vazia) para **2 tokens**.

---

## RESUMO DA FASE 1: Economia de Tokens

| Otimização | Tokens antes | Tokens depois | Economia |
|---|---|---|---|
| Tool grouping (35 → 7 tools) | ~7.000 | ~2.500 | ~4.500 |
| Lazy tool loading (7 → 2–4) | ~2.500 | ~500–1.500 | ~1.000 |
| System Prompt enxuto | ~800 | ~300 | ~500 |
| Contexto vazio minimal | ~500 | ~2 | ~498 |
| **TOTAL (projeto zerado + "oi")** | **~10.800** | **~1.300** | **~88%** |
| **TOTAL (projeto zerado + edição)** | **~11.500** | **~2.500** | **~78%** |

---

## FASE 2: AGENTE INTELIGENTE (3–5 dias)

### 2.1 Planner explícito com raciocínio estruturado

**Arquivo:** novo `apps/web/src/services/ai/planner.ts`

```typescript
export interface Plan {
  objective: string;
  steps: PlanStep[];
  requiresUserInput: boolean;
}

export interface PlanStep {
  id: string;
  description: string;
  tool: string;
  params: Record<string, unknown>;
  validation: string;
}

export async function createPlan(
  userRequest: string,
  context: string | AiProjectContext
): Promise<Plan> {
  // Chama LLM com prompt de planejamento ESPECÍFICO
  const planningPrompt = `Você é o Planner do AnimAI. Analise o pedido e crie um plano.
  
Regras:
1. SEMPRE verifique o estado do projeto antes de editar
2. Divida tarefas complexas em passos simples
3. Valide pré-condições de cada passo
4. Se ambíguo, peça esclarecimento

Pedido: "${userRequest}"
Estado: ${context}

Responda em JSON:
{
  "objective": "resumo do objetivo",
  "requiresUserInput": false,
  "steps": [
    { "id": "1", "description": "...", "tool": "timeline_query", "params": {"type":"state"}, "validation": "projeto tem mídias" }
  ]
}`;

  const response = await fetchPlanning(planningPrompt);
  return JSON.parse(response);
}
```

**Modificação em `agent.ts`:**

```typescript
export async function runAgentTurn(
  messages: LlmMessage[],
  callbacks: AgentRunCallbacks,
  signal: AbortSignal,
): Promise<void> {
  const lastUserMessage = messages.filter(m => m.role === "user").pop()?.content ?? "";
  
  // 1. PLANNING (nova etapa)
  const plan = await createPlan(lastUserMessage, getCurrentProjectContext());
  
  if (plan.requiresUserInput) {
    callbacks.onTextDelta("Preciso de mais informação: " + plan.objective);
    return;
  }
  
  callbacks.onPlanCreated?.(plan);
  
  // 2. EXECUTION seguindo o plano
  for (const step of plan.steps) {
    if (signal.aborted) return;
    
    // Valida pré-condições
    if (!await validatePrecondition(step, getCurrentProjectContext())) {
      callbacks.onTextDelta(`⚠️ Não posso executar: ${step.validation}`);
      continue;
    }
    
    callbacks.onStepStart?.(step);
    
    // Executa a tool
    const result = await executeAiTool(step.tool, step.params);
    
    // Valida pós-condição
    if (!await validatePostcondition(step, result)) {
      callbacks.onTextDelta(`⚠️ Resultado inesperado em "${step.description}". Tentando corrigir...`);
      // Retry ou escalação
      continue;
    }
    
    callbacks.onStepEnd?.(step, result);
  }
  
  // 3. REFLECTION (nova etapa)
  const reflection = await reflectOnExecution(plan, getCurrentProjectContext());
  if (reflection.issues.length > 0) {
    callbacks.onTextDelta(`\n🔍 Revisão: ${reflection.summary}`);
  }
  
  // 4. RESPONSE
  const finalResponse = await generateResponse(plan, reflection);
  callbacks.onTextDelta(finalResponse);
}
```

---

### 2.2 Memória de trabalho (Scratchpad)

**Arquivo:** novo `apps/web/src/services/ai/working-memory.ts`

```typescript
interface WorkingMemory {
  currentPlan: Plan | null;
  currentStep: number;
  executedSteps: ExecutedStep[];
  errors: ErrorRecord[];
  learnings: string[];
}

// Persistido na sessão (não no histórico de mensagens)
let workingMemory: WorkingMemory = {
  currentPlan: null,
  currentStep: 0,
  executedSteps: [],
  errors: [],
  learnings: [],
};

export function updateWorkingMemory(update: Partial<WorkingMemory>): void {
  workingMemory = { ...workingMemory, ...update };
}

export function getWorkingMemory(): WorkingMemory {
  return workingMemory;
}

// Incluído no contexto do LLM como:
// <working_memory>
// Plano atual: cortar silêncios e aplicar zoom em sorrisos
// Passo: 2/5
// Erros anteriores: get_transcript falhou (ainda processando)
// Aprendizados: usuário prefere zoom suave (zoom 1.2, não 2.0)
// </working_memory>
```

---

### 2.3 Reflexão e validação

**Arquivo:** novo `apps/web/src/services/ai/reflector.ts`

```typescript
export async function reflectOnExecution(
  plan: Plan,
  finalState: ProjectContext
): Promise<ReflectionResult> {
  const reflectionPrompt = `Você é o Reflector do AnimAI. Revise a execução:
  
Plano: ${JSON.stringify(plan)}
Estado final: ${JSON.stringify(finalState)}

Verifique:
1. O objetivo foi atingido?
2. Há inconsistências no estado?
3. Algo poderia ser melhorado?
4. Devo informar o usuário sobre algum problema?

Responda em JSON.`;

  const response = await fetchReflection(reflectionPrompt);
  return JSON.parse(response);
}
```

---

### 2.4 Modos de operação

**Arquivo:** `apps/web/src/services/ai/agent.ts`

```typescript
export type AgentMode = "assistant" | "collaborative" | "autonomous";

export interface AgentRunOptions {
  mode: AgentMode;
  maxIterations: number;
  confirmDestructive: boolean;
}

// Modo Assistant: só sugere, não executa
// Modo Collaborative: executa mas confirma ações destrutivas
// Modo Autonomous: executa tudo (para tarefas bem definidas)
```

---

## PLANO DE IMPLEMENTAÇÃO PRIORIZADO

| # | Item | Tempo | Impacto Tokens | Impacto Inteligência | Arquivos |
|---|------|-------|---------------|---------------------|----------|
| 1 | **Tool Grouping** (35→7) | 4h | 🔥🔥🔥🔥🔥 -70% | 🔥🔥 Médio | `tools.ts` |
| 2 | **Lazy Tool Loading** | 2h | 🔥🔥🔥🔥🔥 -80% no "oi" | 🔥🔥 Médio | `agent.ts` |
| 3 | **Contexto vazio minimal** | 30min | 🔥🔥🔥 -50% vazio | — | `project-context.ts` |
| 4 | **System Prompt enxuto** | 1h | 🔥🔥🔥 -40% | 🔥🔥 Médio | `agent.ts` |
| 5 | **Planner explícito** | 1 dia | — | 🔥🔥🔥🔥🔥 Alto | novo `planner.ts` |
| 6 | **Working Memory** | 4h | — | 🔥🔥🔥🔥 Alto | novo `working-memory.ts` |
| 7 | **Reflector/Validator** | 1 dia | — | 🔥🔥🔥🔥 Alto | novo `reflector.ts` |
| 8 | **Modos de operação** | 2h | — | 🔥🔥🔥 Médio | `agent.ts` |


**Resultado esperado:**
- "Oi" em projeto zerado: de **10.000 tokens** para **~1.000–1.500 tokens**
- "Faça vídeo de trem": de **100.000 tokens** para **~15.000–20.000 tokens**
- Qualidade: de "chatbot com tools" para **"agente com planejamento, memória e reflexão"**