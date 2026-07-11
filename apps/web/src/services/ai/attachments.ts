/**
 * Anexos do chat (prompt.txt item 9): o usuário anexa arquivos (imagem,
 * áudio, vídeo…) na mensagem; o agente decide o que fazer com eles via a
 * tool import_attachment. Os arquivos ficam só na memória do client até o
 * agente importá-los para a biblioteca do projeto (nunca vão ao servidor).
 */

import { shortId } from "../../lib/short-id";

export interface AttachmentInfo {
  id: string;
  name: string;
  mimeType: string;
  sizeBytes: number;
}

const registry = new Map<string, File>();

export function registerAttachment(file: File): AttachmentInfo {
  const id = shortId("att", registry);
  registry.set(id, file);
  return {
    id,
    name: file.name,
    mimeType: file.type || "application/octet-stream",
    sizeBytes: file.size,
  };
}

export function getAttachment(id: string): File | undefined {
  return registry.get(id);
}

export function removeAttachment(id: string): void {
  registry.delete(id);
}

/** Descreve anexos para o texto da mensagem do usuário (o modelo lê isto). */
export function describeAttachments(infos: AttachmentInfo[]): string {
  if (infos.length === 0) return "";
  const lines = infos.map(
    (a) =>
      `- ${a.id}: ${a.name} (${a.mimeType}, ${(a.sizeBytes / 1048576).toFixed(1)}MB)`,
  );
  return `\n\n[Arquivos anexados pelo usuário — use a tool import_attachment para trazê-los ao projeto:\n${lines.join("\n")}]`;
}
