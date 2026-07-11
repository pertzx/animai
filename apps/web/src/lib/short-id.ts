/**
 * IDs curtos e memoráveis para entidades do projeto (prompt.txt item 13).
 *
 * A IA copia IDs em chamadas de tool; UUIDs longos causam erros de digitação
 * do modelo. Formato: `<prefixo>-<4 chars base36>` (ex.: clip-a7f2, media-k2x9).
 * Unicidade é garantida por retry contra o conjunto de IDs existentes do
 * projeto — barato, pois o estado inteiro vive em memória. IDs antigos (uuid)
 * continuam válidos: são strings opacas para todo o sistema.
 */

const ALPHABET = "abcdefghijklmnopqrstuvwxyz0123456789";

function randomSuffix(length: number): string {
  let out = "";
  for (let i = 0; i < length; i++) {
    out += ALPHABET[Math.floor(Math.random() * ALPHABET.length)];
  }
  return out;
}

/**
 * Gera um id `prefix-xxxx` que não colide com `existingIds`.
 * Aumenta o sufixo se o espaço estiver congestionado.
 */
export function shortId(
  prefix: string,
  existingIds?: ReadonlySet<string> | { has(id: string): boolean },
): string {
  for (let length = 4; length <= 10; length++) {
    for (let attempt = 0; attempt < 8; attempt++) {
      const id = `${prefix}-${randomSuffix(length)}`;
      if (!existingIds || !existingIds.has(id)) return id;
    }
  }
  // Espaço base36^10 esgotado é impossível na prática; fallback defensivo.
  return `${prefix}-${Date.now().toString(36)}${randomSuffix(4)}`;
}
