/**
 * IDs curtos e memoráveis (`clip-a7f2`, `media-k2x9`) para entidades que a IA
 * do AnimAI referencia em tool calls — UUIDs longos induzem o modelo a errar.
 * Unicidade por retry contra os IDs existentes; IDs antigos (uuid) seguem
 * válidos por serem strings opacas.
 */

const ALPHABET = "abcdefghijklmnopqrstuvwxyz0123456789";

function randomSuffix(length: number): string {
  let out = "";
  for (let i = 0; i < length; i++) {
    out += ALPHABET[Math.floor(Math.random() * ALPHABET.length)];
  }
  return out;
}

export function shortId(
  prefix: string,
  existingIds?: { has(id: string): boolean },
): string {
  for (let length = 4; length <= 10; length++) {
    for (let attempt = 0; attempt < 8; attempt++) {
      const id = `${prefix}-${randomSuffix(length)}`;
      if (!existingIds || !existingIds.has(id)) return id;
    }
  }
  return `${prefix}-${Date.now().toString(36)}${randomSuffix(4)}`;
}

/** Conjunto com todos os IDs de clipes de uma timeline (p/ anti-colisão). */
export function collectClipIds(timeline: {
  tracks: ReadonlyArray<{ clips: ReadonlyArray<{ id: string }> }>;
}): Set<string> {
  const ids = new Set<string>();
  for (const track of timeline.tracks) {
    for (const clip of track.clips) ids.add(clip.id);
  }
  return ids;
}
