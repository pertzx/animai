import type { MediaItem } from "@openreel/core";

export async function generateThumbnailFromBlob(
  blob: Blob,
  type: "video" | "audio" | "image",
): Promise<string | null> {
  // Só gera de um Blob real — `{}` da serialização faria createObjectURL lançar.
  if (!(blob instanceof Blob)) {
    return null;
  }
  if (type === "audio") {
    return null;
  }

  if (type === "image") {
    return URL.createObjectURL(blob);
  }

  return new Promise((resolve) => {
    const video = document.createElement("video");
    video.muted = true;
    video.playsInline = true;
    video.preload = "metadata";

    const cleanup = () => {
      URL.revokeObjectURL(video.src);
      video.remove();
    };

    video.onloadeddata = () => {
      video.currentTime = 0.1;
    };

    video.onseeked = () => {
      try {
        const canvas = document.createElement("canvas");
        canvas.width = Math.min(video.videoWidth, 320);
        canvas.height = Math.min(
          video.videoHeight,
          (320 / video.videoWidth) * video.videoHeight,
        );

        const ctx = canvas.getContext("2d");
        if (ctx) {
          ctx.drawImage(video, 0, 0, canvas.width, canvas.height);
          canvas.toBlob(
            (thumbBlob) => {
              cleanup();
              if (thumbBlob) {
                resolve(URL.createObjectURL(thumbBlob));
              } else {
                resolve(null);
              }
            },
            "image/jpeg",
            0.7,
          );
        } else {
          cleanup();
          resolve(null);
        }
      } catch {
        cleanup();
        resolve(null);
      }
    };

    video.onerror = () => {
      cleanup();
      resolve(null);
    };

    setTimeout(() => {
      cleanup();
      resolve(null);
    }, 5000);

    video.src = URL.createObjectURL(blob);
  });
}

export async function restoreMediaItem(
  item: MediaItem,
  storedBlob: Blob | undefined,
): Promise<MediaItem> {
  // IMPORTANTE: após salvar/carregar o projeto (JSON), item.blob vira `{}`
  // (a serialização de um File perde o binário) — que é "truthy" mas NÃO é um
  // Blob. Considere blob apenas o que é de fato um Blob, senão o thumbnail
  // tenta ler `{}` e o recovery quebra.
  const validStored = storedBlob instanceof Blob ? storedBlob : null;
  const validItemBlob = item.blob instanceof Blob ? item.blob : null;
  const blob = validStored || validItemBlob;

  if (!blob) {
    // Sem blob armazenado. Se guardamos só o handle do arquivo (import via
    // File System Access — prompt.txt #1), vira placeholder para o fluxo de
    // restauração por FileSystemFileHandle recuperá-lo do disco.
    if (item.sourceFile) {
      return { ...item, blob: null, isPlaceholder: true };
    }
    return { ...item, blob: null };
  }

  let thumbnailUrl = item.thumbnailUrl;

  if (!thumbnailUrl || thumbnailUrl.startsWith("blob:")) {
    thumbnailUrl = await generateThumbnailFromBlob(blob, item.type);
  }

  return {
    ...item,
    blob,
    thumbnailUrl,
    filmstripThumbnails: undefined,
  };
}
