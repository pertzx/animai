# PLANO DE MIGRAÇÃO: AnimAI Agent → OpenAI Agents SDK

> **Objetivo:** Migrar o sistema agentico do AnimAI do código customizado para o OpenAI Agents SDK, resolvendo os dois problemas críticos:
> 1. **Consumo excessivo de tokens** (10.000 tokens num "oi" em projeto zerado)
> 2. **Agente "burro"** (sem planejamento, sem memória de trabalho, sem reflexão)
>
> **Escopo:** Apenas a camada agentica (`apps/web/src/services/ai/`). O Semantic Analyzer, project store, UI e backend permanecem inalterados.
> **Tempo estimado:** 3–4 dias de trabalho focado.
> **Plataformas alvo:** Desktop Web (Chrome/Edge), Desktop App WebView (Electron/Tauri), Android WebView.

---

## ÍNDICE

1. [Arquitetura Atual vs. Nova](#1-arquitetura-atual-vs-nova)
2. [Estrutura de Diretórios](#2-estrutura-de-diretórios)
3. [Fase 1: Instalação e Configuração](#3-fase-1-instalação-e-configuração)
4. [Fase 2: Refatoração das Tools](#4-fase-2-refatoração-das-tools)
5. [Fase 3: Implementação do Planner](#5-fase-3-implementação-do-planner)
6. [Fase 4: Implementação do Executor](#6-fase-4-implementação-do-executor)
7. [Fase 5: Implementação do Reflector](#7-fase-5-implementação-do-reflector)
8. [Fase 6: Orquestrador Principal](#8-fase-6-orquestrador-principal)
9. [Fase 7: Integração com UI e Backend](#9-fase-7-integração-com-ui-e-backend)
10. [Fase 8: Otimizações de Tokens](#10-fase-8-otimizações-de-tokens)
11. [Rollback e Fallback](#11-rollback-e-fallback)
12. [Checklist de Testes](#12-checklist-de-testes)

---

## 1. ARQUITETURA ATUAL VS. NOVA

### 1.1 Atual (Problemas)

```
┌─────────────────────────────────────────┐
│  AIGenTab.tsx (UI do chat)              │
└─────────────┬───────────────────────────┘
              │
┌─────────────▼───────────────────────────┐
│  agent.ts                               │
│  ├── buildSystemPrompt()                │
│  │   └── getCurrentProjectContext()    │
│  │       └── JSON.stringify(context)    │  ← 10K tokens!
│  ├── runAgentTurn()                     │
│  │   └── loop simples (max 12 iterações)│
│  │       └── streamChat()              │
│  │           └── /api/ai/chat (backend) │
│  └── executeAiTool()                    │
│      └── switch-case gigante (35 cases) │
│          └── muta project-store direto  │
└─────────────────────────────────────────┘
```

**Problemas:**
- 35 tools individuais = ~7.000 tokens de schema
- Contexto monolítico (JSON inteiro do projeto) a cada requisição
- Sem Planner: modelo responde imediatamente, sem decompor tarefas
- Sem Memória de Trabalho: não sabe "onde está" no processo
- Sem Reflexão: nunca revisa o próprio trabalho
- Sem Validação: tools aplicam mudanças sem verificar se deram certo

### 1.2 Nova (OpenAI Agents SDK)

```
┌─────────────────────────────────────────┐
│  AIGenTab.tsx (UI do chat)              │
│  (sem mudanças na API pública)          │
└─────────────┬───────────────────────────┘
              │
┌─────────────▼───────────────────────────┐
│  orchestrator.ts (novo)                 │
│  ├── detectIntent()                     │
│  ├── selectTools()                      │  ← lazy loading
│  ├── runPlanner()                       │  ← structured output
│  ├── runExecutor()                      │  ← com HITL
│  ├── runReflector()                     │  ← validação
│  └── generateResponse()                 │
└─────────────┬───────────────────────────┘
              │
┌─────────────▼───────────────────────────┐
│  agents/                                │
│  ├── planner.ts      (Agent)            │
│  ├── executor.ts     (Agent + Tools)    │
│  └── reflector.ts    (Agent)            │
├─────────────────────────────────────────┤
│  tools/                                 │
│  ├── index.ts        (registro)         │
│  ├── clip-edit.ts    (7 tools agrupadas)│
│  ├── timeline-query.ts                    │
│  ├── timeline-edit.ts                   │
│  ├── media-manage.ts                    │
│  ├── asset-library.ts                   │
│  ├── semantic-analysis.ts               │
│  └── web-search.ts                      │
├─────────────────────────────────────────┤
│  memory/                                │
│  ├── working-memory.ts (scratchpad)     │
│  └── context-engine.ts (filtragem)      │
└─────────────────────────────────────────┘
```

**Ganhos:**
- 7 tools agrupadas = ~2.500 tokens (economia 65%)
- Lazy tool loading = só envia tools relevantes (economia 80% no "oi")
- Planner com structured output = decompõe tarefas antes de executar
- Working Memory = sabe "onde está" e "o que falta"
- Reflector = revisa e valida antes de entregar
- HITL configurável = confirma ações destrutivas

---

## 2. ESTRUTURA DE DIRETÓRIOS

### 2.1 Antes

```
apps/web/src/services/ai/
├── agent.ts              ← 330 linhas, monolítico
├── tools.ts              ← 900+ linhas, switch-case gigante
├── chat-db.ts            ← OK, mantém
├── attachments.ts        ← OK, mantém
├── project-context.ts     ← OK, com modificações
├── insights-manager.ts   ← OK, mantém
├── transcription-manager.ts ← OK, mantém
├── audio-analysis.ts     ← OK, mantém
├── decode-audio.ts       ← OK, mantém
└── whisper.worker.ts     ← OK, mantém
```

### 2.2 Depois

```
apps/web/src/services/ai/
├── orchestrator.ts          ← NOVO: ponto de entrada único
├── agent.ts                 ← DEPRECATED (mantido por 1 sprint, depois remove)
├── tools.ts                 ← DEPRECATED (mantido por 1 sprint, depois remove)
│
├── agents/                  ← NOVO: diretório
│   ├── planner.ts           ← Agent de planejamento
│   ├── executor.ts          ← Agent de execução
│   └── reflector.ts         ← Agent de revisão
│
├── tools/                   ← NOVO: diretório
│   ├── index.ts             ← Registro e lazy loading
│   ├── clip-edit.ts         ← split/trim/move/delete
│   ├── timeline-query.ts    ← state/transcript/insights/semantic/moments
│   ├── timeline-edit.ts     ← cut_silences/add_captions/apply_template/camera
│   ├── media-manage.ts      ← add_clip/import/apply_effect/adjust_audio/text/vector
│   ├── asset-library.ts     ← catalog/templates/vector_presets/components
│   ├── semantic-analysis.ts ← run/get_timeline/find_moments
│   └── web-search.ts        ← pesquisa web
│
├── memory/                  ← NOVO: diretório
│   ├── working-memory.ts    ← scratchpad do agente
│   └── context-engine.ts    ← filtragem de contexto
│
├── chat-db.ts               ← OK, mantém
├── attachments.ts           ← OK, mantém
├── project-context.ts       ← MODIFICADO: lazy context
├── insights-manager.ts      ← OK, mantém
├── transcription-manager.ts ← OK, mantém
├── audio-analysis.ts        ← OK, mantém
├── decode-audio.ts          ← OK, mantém
└── whisper.worker.ts        ← OK, mantém
```

---

## 3. FASE 1: INSTALAÇÃO E CONFIGURAÇÃO

**Tempo:** 30 minutos
**Arquivos:** `package.json`, novo `apps/web/src/services/ai/config.ts`

### 3.1 Instalar dependências

```bash
cd apps/web
bun add @openai/agents zod
# ou: npm install @openai/agents zod
```

### 3.2 Configuração do SDK

**Arquivo:** `apps/web/src/services/ai/config.ts` (novo)

```typescript
/**
 * Configuração central do sistema agentico.
 * Isola parâmetros do SDK para fácil ajuste.
 */

import { AgentConfig } from "@openai/agents";

export const AGENT_CONFIG = {
  // Modelos por agente (pode usar diferentes modelos para diferentes tarefas)
  models: {
    planner: "gpt-4o-mini",      // Rápido e barato para planejamento
    executor: "gpt-4o",          // Capaz para execução de tools
    reflector: "gpt-4o-mini",    // Rápido para revisão
  },

  // Limites
  maxIterations: 12,
  maxPlannerSteps: 10,
  maxToolRetries: 3,

  // Contexto
  maxContextTokens: 4000,        // Limite artificial para forçar enxugamento
  compactThreshold: 8000,        // Quando compactar histórico

  // Modos de operação
  modes: {
    assistant: {        // Só sugere, não executa
      executeTools: false,
      confirmDestructive: true,
      showPlanning: true,
    },
    collaborative: {    // Executa mas confirma destrutivas
      executeTools: true,
      confirmDestructive: true,
      showPlanning: true,
    },
    autonomous: {       // Executa tudo (tarefas bem definidas)
      executeTools: true,
      confirmDestructive: false,
      showPlanning: false,
    },
  } as const,

  // Flags de feature
  features: {
    enablePlanner: true,
    enableReflector: true,
    enableWorkingMemory: true,
    enableLazyTools: true,
    enableContextFiltering: true,
  },
} as const;

export type AgentMode = keyof typeof AGENT_CONFIG.modes;
```

---

## 4. FASE 2: REFATORAÇÃO DAS TOOLS

**Tempo:** 4 horas
**Arquivos:** `apps/web/src/services/ai/tools/*.ts`

### 4.1 Princípio: Agrupamento

De 35 tools individuais para **7 tools agrupadas** por domínio. Cada tool aceita um campo `action` que determina o comportamento específico.

**Economia de tokens:** ~7.000 → ~2.500 (65% redução)

### 4.2 Tool: `clip_edit`

**Arquivo:** `apps/web/src/services/ai/tools/clip-edit.ts`

```typescript
import { tool } from "@openai/agents";
import { z } from "zod";
import { useProjectStore } from "@/stores/project-store";

export const clipEditTool = tool({
  name: "clip_edit",
  description: `Edita clipes na timeline do projeto.

Ações disponíveis:
- "split": divide um clipe em dois no tempo especificado
- "trim": ajusta os pontos de entrada/saída de um clipe
- "move": move um clipe para outro tempo e/ou track
- "delete": remove um clipe da timeline
- "delete_batch": remove múltiplos clipes de uma vez

Sempre use "get_timeline_state" antes para confirmar IDs e tempos atuais.`,

  parameters: z.object({
    action: z.enum(["split", "trim", "move", "delete", "delete_batch"]),
    clipId: z.string().describe("ID do clipe a ser editado (obrigatório para split/trim/move/delete)"),
    clipIds: z.array(z.string()).optional().describe("IDs dos clipes para delete_batch"),
    timeSec: z.number().optional().describe("Tempo em segundos para split (onde dividir)"),
    inPointSec: z.number().optional().describe("Novo ponto de entrada para trim"),
    outPointSec: z.number().optional().describe("Novo ponto de saída para trim"),
    startTimeSec: z.number().optional().describe("Novo tempo de início para move"),
    trackId: z.string().optional().describe("ID da track de destino para move"),
  }),

  execute: async (params) => {
    const project = useProjectStore.getState().project;

    switch (params.action) {
      case "split": {
        if (!params.timeSec) throw new Error("timeSec obrigatório para split");
        const result = splitClip(project, params.clipId, params.timeSec);
        return { ok: true, result: `Clip ${params.clipId} dividido em ${result.clipIds.join(", ")}` };
      }
      case "trim": {
        if (params.inPointSec === undefined || params.outPointSec === undefined) {
          throw new Error("inPointSec e outPointSec obrigatórios para trim");
        }
        trimClip(project, params.clipId, params.inPointSec, params.outPointSec);
        return { ok: true, result: `Clip ${params.clipId} ajustado: ${params.inPointSec}s → ${params.outPointSec}s` };
      }
      case "move": {
        if (params.startTimeSec === undefined) throw new Error("startTimeSec obrigatório para move");
        moveClip(project, params.clipId, params.startTimeSec, params.trackId);
        return { ok: true, result: `Clip ${params.clipId} movido para t=${params.startTimeSec}s` };
      }
      case "delete": {
        deleteClip(project, params.clipId);
        return { ok: true, result: `Clip ${params.clipId} removido` };
      }
      case "delete_batch": {
        if (!params.clipIds?.length) throw new Error("clipIds obrigatório para delete_batch");
        params.clipIds.forEach(id => deleteClip(project, id));
        return { ok: true, result: `${params.clipIds.length} clipes removidos` };
      }
    }
  },
});
```

### 4.3 Tool: `timeline_query`

**Arquivo:** `apps/web/src/services/ai/tools/timeline-query.ts`

```typescript
import { tool } from "@openai/agents";
import { z } from "zod";
import { useProjectStore } from "@/stores/project-store";

export const timelineQueryTool = tool({
  name: "timeline_query",
  description: `Consulta informações do projeto sem modificá-lo.

Tipos de consulta:
- "state": estado geral do projeto (tracks, clipes, duração)
- "transcript": transcrição completa de uma mídia
- "insights": análises de áudio (BPM, silêncios, energia)
- "semantic": timeline semântica (eventos detectados no vídeo)
- "moments": busca momentos específicos na timeline semântica

Use "state" antes de qualquer edição para confirmar IDs e tempos.`,

  parameters: z.object({
    type: z.enum(["state", "transcript", "insights", "semantic", "moments"]),
    mediaId: z.string().optional().describe("ID da mídia (para transcript/insights/semantic)"),
    query: z.string().optional().describe("Termo de busca (para moments: 'sorriso', 'silêncio', 'ação')"),
  }),

  execute: async (params) => {
    const project = useProjectStore.getState().project;

    switch (params.type) {
      case "state": {
        return {
          ok: true,
          result: {
            duration: project.duration,
            tracks: project.timeline.tracks.length,
            clips: project.timeline.tracks.flatMap(t => t.clips).length,
            media: project.mediaLibrary.items.length,
            selectedClips: useProjectStore.getState().editorState.selectedClips,
          },
        };
      }
      case "transcript": {
        if (!params.mediaId) throw new Error("mediaId obrigatório para transcript");
        const transcript = getTranscript(params.mediaId);
        return { ok: true, result: transcript };
      }
      case "insights": {
        if (!params.mediaId) throw new Error("mediaId obrigatório para insights");
        const insights = getMediaInsights(params.mediaId);
        return { ok: true, result: insights };
      }
      case "semantic": {
        if (!params.mediaId) throw new Error("mediaId obrigatório para semantic");
        const timeline = getSemanticTimeline(params.mediaId);
        return { ok: true, result: timeline };
      }
      case "moments": {
        if (!params.query) throw new Error("query obrigatório para moments");
        const moments = findMoments(params.query);
        return { ok: true, result: moments };
      }
    }
  },
});
```

### 4.4 Tool: `timeline_edit`

**Arquivo:** `apps/web/src/services/ai/tools/timeline-edit.ts`

```typescript
import { tool } from "@openai/agents";
import { z } from "zod";

export const timelineEditTool = tool({
  name: "timeline_edit",
  description: `Edição automática e em lote da timeline.

Ações:
- "cut_silences": detecta e remove silêncios longos automaticamente
- "add_captions": gera legendas a partir da transcrição
- "apply_template": aplica um template pré-definido ao projeto
- "apply_camera_move": aplica movimento de câmera (zoom/pan) a clipes

Ações destrutivas (cut_silences) requerem confirmação do usuário.`,

  parameters: z.object({
    action: z.enum(["cut_silences", "add_captions", "apply_template", "apply_camera_move"]),
    mediaId: z.string().optional().describe("ID da mídia alvo"),
    templateId: z.string().optional().describe("ID do template (para apply_template)"),
    keyframes: z.array(z.object({
      timeSec: z.number(),
      zoom: z.number().optional(),
      x: z.number().optional(),
      y: z.number().optional(),
    })).optional().describe("Keyframes para camera_move"),
  }),

  execute: async (params) => {
    // Implementação delega para funções existentes em tools.ts legado
    // ou para novas implementações
    switch (params.action) {
      case "cut_silences": return cutSilences(params.mediaId);
      case "add_captions": return addCaptions(params.mediaId);
      case "apply_template": return applyTemplate(params.templateId);
      case "apply_camera_move": return applyCameraMove(params.mediaId, params.keyframes);
    }
  },
});
```

### 4.5 Tool: `media_manage`

**Arquivo:** `apps/web/src/services/ai/tools/media-manage.ts`

```typescript
import { tool } from "@openai/agents";
import { z } from "zod";

export const mediaManageTool = tool({
  name: "media_manage",
  description: `Gerencia mídias, efeitos, áudio e elementos gráficos.

Ações:
- "add_clip": adiciona mídia à timeline como clipe
- "import": importa nova mídia do dispositivo
- "apply_effect": aplica efeito visual/áudio a um clipe
- "remove_effect": remove efeito de um clipe
- "adjust_audio": ajusta volume, fade, normalização
- "add_text": adiciona texto/título na timeline
- "add_vector": adiciona elemento vetorial (shape, arrow, icon)`,

  parameters: z.object({
    action: z.enum(["add_clip", "import", "apply_effect", "remove_effect", "adjust_audio", "add_text", "add_vector"]),
    mediaId: z.string().optional(),
    clipId: z.string().optional(),
    trackId: z.string().optional(),
    startTimeSec: z.number().optional(),
    effectType: z.string().optional(),
    text: z.string().optional(),
    // ... outros parâmetros condicionais
  }),

  execute: async (params) => {
    // Delegação para funções existentes
  },
});
```

### 4.6 Tool: `asset_library`

**Arquivo:** `apps/web/src/services/ai/tools/asset-library.ts`

```typescript
import { tool } from "@openai/agents";
import { z } from "zod";

export const assetLibraryTool = tool({
  name: "asset_library",
  description: `Acessa a biblioteca de assets do AnimAI.

Ações:
- "list_catalog": lista catálogos disponíveis (Unsplash, Pexels, etc.)
- "list_templates": lista templates de edição salvos
- "list_vector_presets": lista presets de elementos vetoriais
- "list_components": lista componentes reutilizáveis
- "insert_component": insere um componente na timeline
- "save_component": salva seleção atual como componente`,

  parameters: z.object({
    action: z.enum(["list_catalog", "list_templates", "list_vector_presets", "list_components", "insert_component", "save_component"]),
    componentId: z.string().optional(),
    name: z.string().optional(),
  }),

  execute: async (params) => {
    // Implementação
  },
});
```

### 4.7 Tool: `semantic_analysis`

**Arquivo:** `apps/web/src/services/ai/tools/semantic-analysis.ts`

```typescript
import { tool } from "@openai/agents";
import { z } from "zod";
import { runSemanticAnalysis, getSemanticTimeline, findMoments } from "@/services/semantic";

export const semanticAnalysisTool = tool({
  name: "semantic_analysis",
  description: `Análise semântica de vídeo (processamento local).

Ações:
- "run": executa análise semântica completa em uma mídia (LENTO, 30s–5min)
- "get_timeline": retorna timeline semântica já processada
- "find_moments": busca momentos específicos ("sorriso", "silêncio", "ação")

AVISO: "run" consome muita CPU/RAM. Só execute se necessário.`,

  parameters: z.object({
    action: z.enum(["run", "get_timeline", "find_moments"]),
    mediaId: z.string().describe("ID da mídia de vídeo"),
    query: z.string().optional().describe("Busca para find_moments"),
    force: z.boolean().optional().describe("Força re-análise mesmo se cache existir"),
  }),

  execute: async (params) => {
    switch (params.action) {
      case "run": {
        const result = await runSemanticAnalysis(params.mediaId, { force: params.force });
        return { ok: true, result: `Análise completa. ${result.events.length} eventos detectados.` };
      }
      case "get_timeline": {
        const timeline = getSemanticTimeline(params.mediaId);
        return { ok: true, result: timeline };
      }
      case "find_moments": {
        if (!params.query) throw new Error("query obrigatório para find_moments");
        const moments = findMoments(params.mediaId, params.query);
        return { ok: true, result: moments };
      }
    }
  },
});
```

### 4.8 Tool: `web_search`

**Arquivo:** `apps/web/src/services/ai/tools/web-search.ts`

```typescript
import { tool } from "@openai/agents";
import { z } from "zod";

export const webSearchTool = tool({
  name: "web_search",
  description: "Pesquisa informações na web.",

  parameters: z.object({
    query: z.string().describe("Termo de busca"),
    maxResults: z.number().optional().describe("Máximo de resultados (padrão: 3)"),
  }),

  execute: async (params) => {
    // Implementação existente
  },
});
```

### 4.9 Registro e Lazy Loading

**Arquivo:** `apps/web/src/services/ai/tools/index.ts`

```typescript
/**
 * Registro central de tools com lazy loading.
 * Só carrega as tools relevantes para a intenção do usuário.
 */

import { clipEditTool } from "./clip-edit";
import { timelineQueryTool } from "./timeline-query";
import { timelineEditTool } from "./timeline-edit";
import { mediaManageTool } from "./media-manage";
import { assetLibraryTool } from "./asset-library";
import { semanticAnalysisTool } from "./semantic-analysis";
import { webSearchTool } from "./web-search";

export const ALL_TOOLS = [
  clipEditTool,
  timelineQueryTool,
  timelineEditTool,
  mediaManageTool,
  assetLibraryTool,
  semanticAnalysisTool,
  webSearchTool,
] as const;

export type ToolName = typeof ALL_TOOLS[number]["name"];

/**
 * Seleciona tools relevantes baseado na intenção detectada.
 * Economiza tokens não enviando tools irrelevantes.
 */
export function selectToolsForIntent(userMessage: string): typeof ALL_TOOLS {
  const msg = userMessage.toLowerCase();
  const has = (...words: string[]) => words.some(w => msg.includes(w));

  // Sempre inclui: consulta básica e análise semântica
  const selected = [timelineQueryTool, semanticAnalysisTool];

  // Edição de clipes
  if (has("corta", "divide", "move", "remove", "apaga", "deleta", "split", "trim")) {
    selected.push(clipEditTool);
  }

  // Edição automática da timeline
  if (has("silêncio", "legenda", "zoom", "câmera", "template", "transição")) {
    selected.push(timelineEditTool);
  }

  // Efeitos, áudio, texto
  if (has("efeito", "transição", "texto", "áudio", "volume", "fade", "cor")) {
    selected.push(mediaManageTool);
  }

  // Biblioteca
  if (has("template", "componente", "catálogo", "preset", "asset")) {
    selected.push(assetLibraryTool);
  }

  // Pesquisa web
  if (has("pesquisa", "busca", "internet", "web", "google")) {
    selected.push(webSearchTool);
  }

  return selected;
}

/**
 * Para projetos vazios, só carrega tools essenciais.
 */
export function selectToolsForEmptyProject(): typeof ALL_TOOLS {
  return [timelineQueryTool, assetLibraryTool, webSearchTool];
}
```

---

## 5. FASE 3: IMPLEMENTAÇÃO DO PLANNER

**Tempo:** 1 dia
**Arquivos:** `apps/web/src/services/ai/agents/planner.ts`

### 5.1 Schema do Plano

```typescript
// apps/web/src/services/ai/agents/planner.ts

import { z } from "zod";
import { Agent } from "@openai/agents";
import { AGENT_CONFIG } from "../config";

export const PlanStepSchema = z.object({
  id: z.string().describe("Identificador único do passo (ex: '1', '2a')"),
  description: z.string().describe("Descrição do que este passo faz"),
  tool: z.string().describe("Nome da tool a ser usada"),
  params: z.record(z.any()).describe("Parâmetros para a tool"),
  validation: z.string().describe("Como verificar se este passo deu certo"),
  dependsOn: z.array(z.string()).optional().describe("IDs de passos que devem completar antes"),
});

export const PlanSchema = z.object({
  objective: z.string().describe("Resumo do objetivo do plano"),
  requiresUserInput: z.boolean().describe("Se true, o plano precisa de esclarecimento do usuário antes de executar"),
  userQuestion: z.string().optional().describe("Pergunta para o usuário se requiresUserInput for true"),
  steps: z.array(PlanStepSchema).describe("Passos do plano em ordem de execução"),
  estimatedTokens: z.number().optional().describe("Estimativa de tokens necessários"),
});

export type Plan = z.infer<typeof PlanSchema>;
```

### 5.2 Agent Planner

```typescript
export const plannerAgent = new Agent({
  name: "AnimAI Planner",
  model: AGENT_CONFIG.models.planner,
  instructions: `Você é o Planner do AnimAI, um editor de vídeo com IA.

## MISSÃO
Analisar o pedido do usuário e criar um plano de execução detalhado.

## REGRAS ABSOLUTAS
1. SEMPRE verifique o estado do projeto ANTES de propor edições
2. Divida tarefas complexas em passos simples e sequenciais
3. Cada passo deve usar UMA tool e ter parâmetros completos
4. Valide pré-condições: se uma tool precisa de dados que outra produz, use dependsOn
5. Se o pedido for ambíguo ou impossível, set requiresUserInput = true e pergunte
6. NUNCA invente IDs de clipes ou mídias — use "timeline_query" para descobrir

## FLUXO PADRÃO PARA EDIÇÃO
1. timeline_query(type: "state") → descobrir estado atual
2. [análise semântica se necessário] → semantic_analysis(action: "get_timeline")
3. [edições] → clip_edit, timeline_edit, media_manage
4. timeline_query(type: "state") → validar resultado

## EXEMPLOS DE BONS PLANOS

Pedido: "Corta os silêncios"
→ Passo 1: timeline_query(type: "state") — descobrir mídias
→ Passo 2: semantic_analysis(action: "run", mediaId: "...") — se não tiver análise
→ Passo 3: timeline_edit(action: "cut_silences", mediaId: "...")
→ Passo 4: timeline_query(type: "state") — validar

Pedido: "Dá zoom quando eu sorrio"
→ Passo 1: timeline_query(type: "state")
→ Passo 2: semantic_analysis(action: "find_moments", query: "sorriso")
→ Passo 3: Para cada momento: clip_edit(action: "split") + timeline_edit(action: "apply_camera_move")
→ Passo 4: timeline_query(type: "state") — validar

Responda em JSON seguindo o schema fornecido.`,

  outputType: PlanSchema,
});
```

---

## 6. FASE 4: IMPLEMENTAÇÃO DO EXECUTOR

**Tempo:** 1 dia
**Arquivos:** `apps/web/src/services/ai/agents/executor.ts`

### 6.1 Executor com Validação

```typescript
// apps/web/src/services/ai/agents/executor.ts

import { Agent } from "@openai/agents";
import { AGENT_CONFIG } from "../config";
import { ALL_TOOLS } from "../tools";

export const executorAgent = new Agent({
  name: "AnimAI Executor",
  model: AGENT_CONFIG.models.executor,
  instructions: `Você é o Executor do AnimAI.

## MISSÃO
Executar os passos do plano de forma precisa e segura.

## REGRAS
1. Execute UM passo por vez
2. Após cada execução, valide o resultado
3. Se uma tool falhar, analise o erro e tente corrigir (máx ${AGENT_CONFIG.maxToolRetries} tentativas)
4. Se não conseguir corrigir, reporte falha e pare
5. NUNCA execute ações destrutivas sem confirmação do usuário
6. Mantenha o usuário informado do progresso

## COMUNICAÇÃO
- Informe o que está fazendo antes de cada passo
- Reporte sucesso ou falha de forma clara
- Se precisar de confirmação, peça explicitamente`,

  tools: ALL_TOOLS,
});
```

### 6.2 Função de Execução com Retry

```typescript
// apps/web/src/services/ai/agents/executor.ts (continuação)

import { Plan, PlanStep } from "./planner";

export interface ExecutionResult {
  stepId: string;
  success: boolean;
  result: unknown;
  error?: string;
  retries: number;
}

export async function executePlan(
  plan: Plan,
  callbacks: {
    onStepStart: (step: PlanStep) => void;
    onStepEnd: (step: PlanStep, result: ExecutionResult) => void;
    onConfirmationNeeded: (step: PlanStep) => Promise<boolean>;
  },
  signal: AbortSignal
): Promise<ExecutionResult[]> {
  const results: ExecutionResult[] = [];

  for (const step of plan.steps) {
    if (signal.aborted) break;

    // Verificar dependências
    const depsOk = step.dependsOn?.every(depId =>
      results.find(r => r.stepId === depId)?.success
    ) ?? true;

    if (!depsOk) {
      results.push({
        stepId: step.id,
        success: false,
        result: null,
        error: `Dependências não satisfeitas: ${step.dependsOn?.join(", ")}`,
        retries: 0,
      });
      continue;
    }

    callbacks.onStepStart(step);

    // Verificar se é destrutivo e precisa de confirmação
    if (isDestructive(step.tool, step.params)) {
      const confirmed = await callbacks.onConfirmationNeeded(step);
      if (!confirmed) {
        results.push({
          stepId: step.id,
          success: false,
          result: null,
          error: "Cancelado pelo usuário",
          retries: 0,
        });
        continue;
      }
    }

    // Executar com retry
    let lastResult: ExecutionResult | null = null;
    for (let attempt = 0; attempt < AGENT_CONFIG.maxToolRetries; attempt++) {
      try {
        const result = await executeStep(step);
        lastResult = {
          stepId: step.id,
          success: true,
          result,
          retries: attempt,
        };
        break;
      } catch (error) {
        lastResult = {
          stepId: step.id,
          success: false,
          result: null,
          error: error instanceof Error ? error.message : String(error),
          retries: attempt,
        };
        if (attempt < AGENT_CONFIG.maxToolRetries - 1) {
          await sleep(1000 * (attempt + 1)); // Backoff exponencial
        }
      }
    }

    results.push(lastResult!);
    callbacks.onStepEnd(step, lastResult!);

    // Se falhou criticamente, parar
    if (!lastResult!.success && isCritical(step)) {
      break;
    }
  }

  return results;
}

function isDestructive(tool: string, params: Record<string, unknown>): boolean {
  if (tool === "clip_edit" && ["delete", "delete_batch"].includes(params.action as string)) return true;
  if (tool === "timeline_edit" && params.action === "cut_silences") return true;
  return false;
}

function isCritical(step: PlanStep): boolean {
  // Passos de consulta não são críticos
  return step.tool !== "timeline_query" && step.tool !== "semantic_analysis";
}

function sleep(ms: number): Promise<void> {
  return new Promise(resolve => setTimeout(resolve, ms));
}
```

---

## 7. FASE 5: IMPLEMENTAÇÃO DO REFLECTOR

**Tempo:** 4 horas
**Arquivos:** `apps/web/src/services/ai/agents/reflector.ts`

```typescript
// apps/web/src/services/ai/agents/reflector.ts

import { Agent } from "@openai/agents";
import { z } from "zod";
import { AGENT_CONFIG } from "../config";
import { Plan } from "./planner";
import { ExecutionResult } from "./executor";

export const ReflectionSchema = z.object({
  approved: z.boolean().describe("O resultado atende ao objetivo?"),
  issues: z.array(z.string()).describe("Problemas encontrados"),
  suggestions: z.array(z.string()).optional().describe("Sugestões de melhoria"),
  summary: z.string().describe("Resumo da revisão para o usuário"),
  needsFix: z.boolean().describe("Se true, o executor deve tentar corrigir"),
  fixPlan: z.array(z.object({
    stepId: z.string(),
    action: z.string(),
    reason: z.string(),
  })).optional(),
});

export type Reflection = z.infer<typeof ReflectionSchema>;

export const reflectorAgent = new Agent({
  name: "AnimAI Reflector",
  model: AGENT_CONFIG.models.reflector,
  instructions: `Você é o Reflector do AnimAI.

## MISSÃO
Revisar a execução de um plano e verificar se o objetivo foi atingido.

## REGRAS
1. Compare o estado final com o objetivo original
2. Identifique inconsistências ou erros
3. Se houver problemas, proponha correções específicas
4. Seja honesto: se algo falhou, admita
5. O resumo deve ser claro e útil para o usuário

## CRITÉRIOS DE APROVAÇÃO
- O estado do projeto reflete o pedido do usuário?
- Não há clipes órfãos ou estados inválidos?
- As durações e tempos fazem sentido?
- Não houve perda de dados?`,

  outputType: ReflectionSchema,
});

export async function reflectOnExecution(
  plan: Plan,
  executionResults: ExecutionResult[],
  finalState: unknown
): Promise<Reflection> {
  const reflectionPrompt = `
Plano original: ${plan.objective}
Passos executados: ${executionResults.length}
Sucessos: ${executionResults.filter(r => r.success).length}
Falhas: ${executionResults.filter(r => !r.success).length}

Detalhes da execução:
${executionResults.map(r => `
- Passo ${r.stepId}: ${r.success ? "✅" : "❌"} ${r.error || "OK"}
`).join("")}

Estado final do projeto:
${JSON.stringify(finalState, null, 2)}
`;

  // Chamar o agente reflector
  const result = await run(reflectorAgent, reflectionPrompt);
  return result.finalOutput as Reflection;
}
```

---

## 8. FASE 6: ORQUESTRADOR PRINCIPAL

**Tempo:** 1 dia
**Arquivos:** `apps/web/src/services/ai/orchestrator.ts`

### 8.1 Ponto de Entrada Único

```typescript
// apps/web/src/services/ai/orchestrator.ts

import { run } from "@openai/agents";
import { plannerAgent, Plan } from "./agents/planner";
import { executorAgent, executePlan, ExecutionResult } from "./agents/executor";
import { reflectorAgent, reflectOnExecution, Reflection } from "./agents/reflector";
import { selectToolsForIntent, selectToolsForEmptyProject } from "./tools";
import { getCurrentProjectContext, isProjectEmpty } from "./project-context";
import { AGENT_CONFIG, AgentMode } from "./config";
import { WorkingMemory, createWorkingMemory, updateWorkingMemory } from "./memory/working-memory";
import { buildLazyContext } from "./memory/context-engine";

export interface OrchestratorCallbacks {
  onTextDelta: (text: string) => void;
  onToolCall: (name: string, args: Record<string, unknown>) => void;
  onToolResult: (name: string, result: unknown) => void;
  onPlanCreated: (plan: Plan) => void;
  onStepStart: (stepId: string, description: string) => void;
  onStepEnd: (stepId: string, success: boolean) => void;
  onReflection: (reflection: Reflection) => void;
  onConfirmationNeeded: (description: string) => Promise<boolean>;
  onError: (error: Error) => void;
}

export interface OrchestratorOptions {
  mode: AgentMode;
  signal: AbortSignal;
}

/**
 * Ponto de entrada principal do sistema agentico.
 * Substitui runAgentTurn() do agent.ts legado.
 */
export async function runOrchestrator(
  userMessage: string,
  callbacks: OrchestratorCallbacks,
  options: OrchestratorOptions
): Promise<void> {
  const { mode, signal } = options;
  const config = AGENT_CONFIG.modes[mode];

  try {
    // 1. DETECTAR INTENÇÃO E SELECIONAR TOOLS
    const tools = isProjectEmpty()
      ? selectToolsForEmptyProject()
      : selectToolsForIntent(userMessage);

    callbacks.onTextDelta("🤔 Analisando seu pedido...

");

    // 2. CONSTRUIR CONTEXTO (lazy)
    const context = buildLazyContext(userMessage, getCurrentProjectContext());

    // 3. PLANNING (se habilitado)
    let plan: Plan;
    if (AGENT_CONFIG.features.enablePlanner) {
      const planResult = await run(plannerAgent, `
Pedido do usuário: "${userMessage}"

Contexto do projeto:
${JSON.stringify(context)}

Tools disponíveis: ${tools.map(t => t.name).join(", ")}
`);
      plan = planResult.finalOutput as Plan;
    } else {
      // Modo legado: plano de 1 passo
      plan = {
        objective: userMessage,
        requiresUserInput: false,
        steps: [{
          id: "1",
          description: "Executar pedido do usuário",
          tool: "timeline_query",
          params: { type: "state" },
          validation: "Estado obtido",
        }],
      };
    }

    callbacks.onPlanCreated(plan);

    // 4. VERIFICAR SE PRECISA DE INPUT DO USUÁRIO
    if (plan.requiresUserInput) {
      callbacks.onTextDelta(`❓ ${plan.userQuestion || "Preciso de mais informações."}
`);
      return;
    }

    if (config.showPlanning) {
      callbacks.onTextDelta(`📋 Plano: ${plan.objective}
`);
      callbacks.onTextDelta(`${plan.steps.length} passos:
`);
      plan.steps.forEach(s => callbacks.onTextDelta(`  ${s.id}. ${s.description}
`));
      callbacks.onTextDelta("
");
    }

    // 5. EXECUÇÃO (se habilitado)
    let executionResults: ExecutionResult[] = [];
    if (config.executeTools && plan.steps.length > 0) {
      executionResults = await executePlan(plan, {
        onStepStart: (step) => {
          callbacks.onStepStart(step.id, step.description);
          callbacks.onTextDelta(`▶️ ${step.description}... `);
        },
        onStepEnd: (step, result) => {
          callbacks.onStepEnd(step.id, result.success);
          callbacks.onTextDelta(result.success ? "✅
" : `❌ ${result.error}
`);
        },
        onConfirmationNeeded: async (step) => {
          return callbacks.onConfirmationNeeded(step.description);
        },
      }, signal);
    }

    // 6. REFLEXÃO (se habilitado e houve execução)
    let reflection: Reflection | null = null;
    if (AGENT_CONFIG.features.enableReflector && executionResults.length > 0) {
      callbacks.onTextDelta("
🔍 Revisando resultado...
");
      reflection = await reflectOnExecution(plan, executionResults, getCurrentProjectContext());
      callbacks.onReflection(reflection);

      if (!reflection.approved) {
        callbacks.onTextDelta(`
⚠️ ${reflection.summary}
`);
        if (reflection.needsFix && reflection.fixPlan) {
          callbacks.onTextDelta("
🔄 Tentando corrigir...
");
          // Executar plano de correção
        }
      }
    }

    // 7. RESPOSTA FINAL
    const finalResponse = await generateFinalResponse(userMessage, plan, executionResults, reflection);
    callbacks.onTextDelta(`
${finalResponse}`);

  } catch (error) {
    callbacks.onError(error instanceof Error ? error : new Error(String(error)));
    callbacks.onTextDelta("
❌ Ocorreu um erro inesperado. Tente novamente.");
  }
}

async function generateFinalResponse(
  userMessage: string,
  plan: Plan,
  results: ExecutionResult[],
  reflection: Reflection | null
): Promise<string> {
  const successCount = results.filter(r => r.success).length;
  const totalCount = results.length;

  if (totalCount === 0) {
    return "Entendido! Me avise se precisar de algo mais.";
  }

  if (successCount === totalCount) {
    if (reflection?.approved) {
      return `✅ Pronto! ${plan.objective} concluído com sucesso.`;
    }
    return `✅ Execução concluída. ${reflection?.summary || ""}`;
  }

  if (successCount === 0) {
    return `❌ Não consegui executar: ${results[0]?.error || "Erro desconhecido"}`;
  }

  return `⚠️ Concluído parcialmente (${successCount}/${totalCount} passos). ${reflection?.summary || ""}`;
}
```

---

## 9. FASE 7: INTEGRAÇÃO COM UI E BACKEND

**Tempo:** 4 horas
**Arquivos:** `apps/web/src/components/editor/AIGenTab.tsx`, `apps/web/src/services/ai/orchestrator.ts`

### 9.1 Adaptador para UI Legada

```typescript
// apps/web/src/services/ai/adapter.ts
// Adapta o novo orchestrator para a UI antiga (AIGenTab.tsx)

import { runOrchestrator, OrchestratorCallbacks } from "./orchestrator";
import { AgentRunCallbacks } from "./agent"; // tipo legado

/**
 * Adapta callbacks do formato legado para o novo orchestrator.
 * Permite migrar gradualmente sem reescrever AIGenTab.tsx.
 */
export function adaptCallbacks(
  legacyCallbacks: AgentRunCallbacks,
  mode: "collaborative" | "autonomous" = "collaborative"
): { callbacks: OrchestratorCallbacks; options: { mode: typeof mode; signal: AbortSignal } } {
  const controller = new AbortController();

  const callbacks: OrchestratorCallbacks = {
    onTextDelta: (text) => {
      legacyCallbacks.onTextDelta?.(text);
    },
    onToolCall: (name, args) => {
      legacyCallbacks.onToolCall?.(name, args);
    },
    onToolResult: (name, result) => {
      legacyCallbacks.onToolResult?.(name, result);
    },
    onPlanCreated: () => { /* novo, UI legada ignora */ },
    onStepStart: () => { /* novo, UI legada ignora */ },
    onStepEnd: () => { /* novo, UI legada ignora */ },
    onReflection: () => { /* novo, UI legada ignora */ },
    onConfirmationNeeded: async (description) => {
      // UI legada não tem confirmação granular
      // Pode ser implementado depois
      return true;
    },
    onError: (error) => {
      legacyCallbacks.onError?.(error);
    },
  };

  return {
    callbacks,
    options: {
      mode,
      signal: controller.signal,
    },
  };
}
```

### 9.2 Modificação em AIGenTab.tsx (mínima)

```typescript
// apps/web/src/components/editor/AIGenTab.tsx

// ANTES:
import { runAgentTurn, AgentRunCallbacks } from "@/services/ai/agent";

// DEPOIS:
import { runOrchestrator } from "@/services/ai/orchestrator";
import { adaptCallbacks } from "@/services/ai/adapter";

// Na função de envio de mensagem:
async function handleSend() {
  const userMessage = input.trim();
  if (!userMessage) return;

  // Salvar mensagem no histórico
  await addMessage(userMessage, "user");
  setInput("");
  setIsLoading(true);

  // NOVO: usar orchestrator em vez de runAgentTurn
  const { callbacks, options } = adaptCallbacks({
    onTextDelta: (text) => setStreamingText(prev => prev + text),
    onToolCall: (name, args) => console.log("Tool:", name, args),
    onToolResult: (name, result) => console.log("Result:", name, result),
    onError: (error) => console.error(error),
  }, "collaborative");

  await runOrchestrator(userMessage, callbacks, options);

  setIsLoading(false);
  setStreamingText("");
}
```

### 9.3 Backend (/api/ai/chat)

**Não precisa mudar.** O backend continua como proxy SSE para o LLM. O novo orchestrator chama o mesmo endpoint.

Se quiser otimizar, o backend pode ser modificado para:
- Suportar streaming de múltiplos agentes (Planner → Executor → Reflector)
- Cachear respostas do Planner para pedidos similares
- Mas isso é **fase 2**, não obrigatório agora.

---

## 10. FASE 8: OTIMIZAÇÕES DE TOKENS

**Tempo:** 2 horas
**Arquivos:** `apps/web/src/services/ai/memory/context-engine.ts`

### 10.1 Context Engine (Lazy Context)

```typescript
// apps/web/src/services/ai/memory/context-engine.ts

import { AiProjectContext } from "../project-context";

export interface LazyContext {
  // Sempre incluído (pequeno)
  core: {
    projectName: string;
    durationSec: number;
    width: number;
    height: number;
    frameRate: number;
    mediaCount: number;
    clipCount: number;
    isEmpty: boolean;
  };

  // Incluído sob demanda
  mediaDetails?: unknown[];
  transcripts?: unknown;
  insights?: unknown;
  semanticTimeline?: unknown;
  editorState?: unknown;
}

/**
 * Constrói contexto mínimo baseado na intenção do usuário.
 * Economiza tokens não incluindo dados irrelevantes.
 */
export function buildLazyContext(
  userMessage: string,
  fullContext: AiProjectContext | string
): LazyContext | string {
  // Se projeto está vazio, retorna string minimal (2 tokens!)
  if (fullContext === "PROJETO_VAZIO" || (typeof fullContext === "object" && fullContext.project?.durationSec === 0)) {
    return "PROJETO_VAZIO";
  }

  const ctx = fullContext as AiProjectContext;
  const msg = userMessage.toLowerCase();
  const has = (...words: string[]) => words.some(w => msg.includes(w));

  const lazy: LazyContext = {
    core: {
      projectName: ctx.project?.name || "Sem nome",
      durationSec: ctx.project?.durationSec || 0,
      width: ctx.project?.settings?.width || 1920,
      height: ctx.project?.settings?.height || 1080,
      frameRate: ctx.project?.settings?.frameRate || 30,
      mediaCount: ctx.media?.length || 0,
      clipCount: ctx.tracks?.flatMap((t: any) => t.clips).length || 0,
      isEmpty: false,
    },
  };

  // Só inclui detalhes de mídia se mencionada
  if (has("mídia", "vídeo", "clip", "imagem", "áudio", "som")) {
    lazy.mediaDetails = ctx.media?.map((m: any) => ({
      id: m.id,
      name: m.name,
      type: m.type,
      duration: m.file?.durationSec,
    }));
  }

  // Só inclui transcrições se mencionada
  if (has("fala", "transcrição", "legenda", "diálogo", "texto")) {
    lazy.transcripts = ctx.transcripts?.map((t: any) => ({
      mediaId: t.mediaId,
      mediaName: t.mediaName,
      language: t.language,
      segmentCount: t.segments?.length,
    }));
  }

  // Só inclui insights se mencionada
  if (has("áudio", "silêncio", "bpm", "música", "som")) {
    lazy.insights = ctx.media?.map((m: any) => ({
      id: m.id,
      hasAudioAnalysis: !!m.insights?.audio,
      hasOnScreenText: (m.insights?.onScreenText?.length ?? 0) > 0,
    }));
  }

  // Só inclui semantic timeline se mencionada
  if (has("cena", "rosto", "objeto", "momento", "análise", "semantic")) {
    lazy.semanticTimeline = ctx.media?.map((m: any) => ({
      id: m.id,
      eventCounts: m.semanticTimelineCounts,
    }));
  }

  // Só inclui editorState se edição
  if (has("edit", "move", "corta", "apaga", "adiciona", "timeline")) {
    lazy.editorState = {
      playheadSec: ctx.editorState?.playheadSec,
      selectedClips: ctx.editorState?.selectedClips,
      clipsAtPlayhead: ctx.editorState?.clipsAtPlayhead,
    };
  }

  return lazy;
}
```

### 10.2 Working Memory

```typescript
// apps/web/src/services/ai/memory/working-memory.ts

export interface WorkingMemory {
  currentPlanId: string | null;
  currentStepIndex: number;
  executedSteps: string[];
  failedSteps: string[];
  learnings: string[];
  userPreferences: Record<string, unknown>;
}

let workingMemory: WorkingMemory = {
  currentPlanId: null,
  currentStepIndex: 0,
  executedSteps: [],
  failedSteps: [],
  learnings: [],
  userPreferences: {},
};

export function createWorkingMemory(): WorkingMemory {
  return { ...workingMemory };
}

export function updateWorkingMemory(update: Partial<WorkingMemory>): void {
  workingMemory = { ...workingMemory, ...update };
}

export function getWorkingMemory(): WorkingMemory {
  return workingMemory;
}

export function addLearning(learning: string): void {
  workingMemory.learnings.push(learning);
  // Manter só as últimas 20 aprendizagens
  if (workingMemory.learnings.length > 20) {
    workingMemory.learnings = workingMemory.learnings.slice(-20);
  }
}

export function formatWorkingMemoryForPrompt(): string {
  const mem = workingMemory;
  return `
<working_memory>
Plano atual: ${mem.currentPlanId || "nenhum"}
Passo atual: ${mem.currentStepIndex}
Passos executados: ${mem.executedSteps.join(", ") || "nenhum"}
Passos falhos: ${mem.failedSteps.join(", ") || "nenhum"}
Aprendizados: ${mem.learnings.join("; ") || "nenhum"}
</working_memory>
`;
}
```

---

## 11. ROLLBACK E FALLBACK

### 11.1 Estratégia de Migração Segura

```
Sprint 1 (semana 1):
  ├── Criar toda a nova estrutura (agents/, tools/, memory/)
  ├── Manter agent.ts e tools.ts LEGADOS intactos
  ├── Criar orchestrator.ts que DELEGA para o novo sistema
  ├── AIGenTab.tsx usa orchestrator.ts
  └── Feature flag: usarNovoAgente = true/false

Sprint 2 (semana 2):
  ├── Testar intensivamente em Desktop Web
  ├── Testar em Desktop App WebView
  ├── Testar em Android WebView
  ├── Coletar métricas: tokens, tempo, qualidade
  └── Ajustar prompts e parâmetros

Sprint 3 (semana 3):
  ├── Se métricas forem boas: remover agent.ts e tools.ts legados
  ├── Se métricas forem ruins: investigar e ajustar
  └── Documentar aprendizados
```

### 11.2 Feature Flag

```typescript
// apps/web/src/services/ai/config.ts

export const FEATURE_FLAGS = {
  useNewAgent: true,  // false = usa agent.ts legado
};

// Em AIGenTab.tsx:
import { runAgentTurn } from "./agent"; // legado
import { runOrchestrator } from "./orchestrator"; // novo

async function handleSend() {
  if (FEATURE_FLAGS.useNewAgent) {
    await runOrchestrator(userMessage, callbacks, options);
  } else {
    await runAgentTurn(messages, callbacks, signal); // legado
  }
}
```

---

## 12. CHECKLIST DE TESTES

### 12.1 Testes de Tokens

| Cenário | Antes | Depois | Meta |
|---------|-------|--------|------|
| "Oi" (projeto vazio) | ~10.000 | ~1.500 | -85% |
| "Oi" (projeto médio) | ~30.000 | ~3.000 | -90% |
| "Corta silêncios" (precisa de insights) | ~35.000 | ~5.000 | -86% |
| "Faça vídeo de trem" (complexo, 5 iterações) | ~200.000 | ~25.000 | -88% |

### 12.2 Testes de Qualidade (Agente "Inteligente")

| Cenário | Comportamento Esperado |
|---------|----------------------|
| "Corta os silêncios" | 1. Consulta estado → 2. Verifica se tem análise → 3. Se não, roda análise → 4. Aplica corte → 5. Valida |
| "Dá zoom quando eu sorrio" | 1. Consulta estado → 2. Busca momentos "sorriso" → 3. Para cada momento: split + camera_move → 4. Valida |
| "Oi" | Responde normalmente, não gasta tokens em tools desnecessárias |
| "Deleta tudo" | Pede confirmação antes de executar (HITL) |
| "Faz um vídeo de trem" (projeto vazio) | 1. Detecta projeto vazio → 2. Sugere importar mídia → 3. Não tenta editar nada |

### 12.3 Testes de Plataforma

| Plataforma | Testar |
|------------|--------|
| Desktop Web (Chrome) | Funcionalidade completa, WebGPU se disponível |
| Desktop App (Electron/Tauri) | Mesmo que Desktop Web |
| Android WebView | Modo econômico, sem crash por OOM |

### 12.4 Testes de Regressão

| Funcionalidade | Verificar |
|----------------|-----------|
| Undo/Redo | Continua funcionando após edições do agente |
| Streaming de resposta | Texto aparece gradualmente |
| Cancelamento (AbortSignal) | Para imediatamente quando usuário cancela |
| Anexos | Imagens e vídeos continuam sendo enviados |
| Histórico de chat | Mensagens persistem no IndexedDB |

---

## RESUMO EXECUTIVO

| Fase | O que faz | Tempo | Arquivos |
|------|-----------|-------|----------|
| 1 | Instala SDK e configura | 30 min | `package.json`, `config.ts` |
| 2 | Refatora 35 tools → 7 agrupadas | 4h | `tools/*.ts` |
| 3 | Implementa Planner | 1 dia | `agents/planner.ts` |
| 4 | Implementa Executor | 1 dia | `agents/executor.ts` |
| 5 | Implementa Reflector | 4h | `agents/reflector.ts` |
| 6 | Cria Orchestrator principal | 1 dia | `orchestrator.ts` |
| 7 | Integra com UI e backend | 4h | `adapter.ts`, `AIGenTab.tsx` |
| 8 | Otimiza tokens (lazy context) | 2h | `memory/*.ts` |
| **Total** | | **~3–4 dias** | |

**Resultado esperado:**
- Tokens: de 10.000 para ~1.500 no "oi" (-85%)
- Qualidade: de "chatbot reativo" para "agente com planejamento e reflexão"
- Plataformas: Desktop Web, Desktop App, Android WebView
- Rollback: seguro via feature flag
