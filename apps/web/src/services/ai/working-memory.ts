/**
 * Memória de trabalho do agente (auditoria §7/§11 — M3), versão in-context e
 * SEM chamadas de LLM extras.
 *
 * Guarda apenas os erros de tools do turno atual, para que o modelo os veja de
 * forma saliente na fase VALIDAR e se auto-corrija em vez de repetir o mesmo
 * erro ou desistir calado. É zerada no início de cada turno do usuário (não
 * vaza entre pedidos) e injetada compactada no system prompt.
 */

const MAX_ERRORS = 6;

let errors: string[] = [];

/** Zera a memória (chamado no início de cada turno). */
export function resetWorkingMemory(): void {
  errors = [];
}

/** Registra um erro de tool para o modelo corrigir. */
export function recordToolError(error: string): void {
  errors = [...errors, error].slice(-MAX_ERRORS);
}

/**
 * Bloco compacto para o system prompt. Retorna "" quando não há erros, para
 * não gastar tokens à toa.
 */
export function renderWorkingMemory(): string {
  if (errors.length === 0) return "";
  const list = errors.map((e) => `  - ${e}`).join("\n");
  return `\n<working_memory>\nErros de tools neste turno (diagnostique e corrija ANTES de finalizar; não repita o mesmo erro):\n${list}\n</working_memory>`;
}
