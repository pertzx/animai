/**
 * Documentação de capacidades por tipo de elemento (o "manual" do editor para
 * a IA). É a fonte única de verdade do que dá para criar e ajustar em cada
 * elemento e com qual tool — injetada no system prompt para o agente parar de
 * "ignorar" propriedades que existem.
 *
 * IMPORTANTE: mantenha esta doc em sincronia com as tools em `tools.ts`. Se uma
 * propriedade está aqui, a tool correspondente TEM que aceitá-la.
 */
export const ELEMENT_CAPABILITIES_DOC = `MANUAL DE ELEMENTOS — o que dá para fazer em cada tipo (e com qual tool). Coordenadas são normalizadas 0..1 (x: 0=esquerda,1=direita; y: 0=topo,1=base; 0.5,0.5=centro).

TEXTO  — criar: add_text · ajustar: update_element · apagar: delete_clip
  • conteúdo: text
  • posição: x, y (0..1) · scale · rotation (graus) · opacity (0..1)
  • fonte: fontSize (px) · fontFamily · bold (bool) · italic (bool)
  • cor: color (hex) · backgroundColor (hex, caixa atrás) · strokeColor + strokeWidth (contorno) · shadowColor + shadowBlur (sombra p/ legibilidade)
  • parágrafo: align (left|center|right) · letterSpacing (px) · lineHeight (ex.: 1.2) · textDecoration (underline|line-through|overline|none)
  • 3D: threeD (bool) + depth (ex.: 0.2) via update_element
  • animação: animationPreset (typewriter, fade, slide-up, slide-down, scale, bounce, pop, wave, glitch, flip, rainbow…)

VETOR / SVG  — criar: add_vector · ajustar: update_element · apagar: delete_clip
  • origem: presetId (ver list_vector_presets) OU svg (markup completo, viewBox 0 0 100 100)
  • posição: x, y (0..1) · scale · rotation · opacity
  • cor: color (hex) — PINTA o vetor inteiro (tint). Funciona em preset ou markup.

CLIPE DE VÍDEO/IMAGEM  — adicionar: add_clip · ajustar: update_element · apagar: delete_clip
  • no tempo: add_clip (omita startTimeSec para ENFILEIRAR após o último clipe) · move_clip · split_clip · trim_clip
  • no palco: x, y (0..1) · scale · rotation · opacity · borderRadius (via update_element)
  • velocidade: speed via update_element (1=normal, 2=2x, 0.5=lento)
  • mesclagem: blendMode via update_element (normal, multiply, screen, overlay, darken, lighten, soft-light, difference…)
  • áudio: adjust_audio (volume 0..2, fadeInSec, fadeOutSec, mutar track)
  • efeitos: apply_effect (brightness, contrast, saturation, hue, blur, sharpen, vignette, grain, temperature, tint, glow, chromaKey… a maioria aceita params {"intensity":0..1}) · remove_effect

LEGENDA  — add_captions (gera da transcrição) · apagar: delete_clip
TRANSIÇÃO — apply_transition entre 2 clipes ADJACENTES na mesma track (crossfade, dipToBlack, dipToWhite, wipe, slide, zoom, push)
CÂMERA/PARALLAX — apply_camera_move + set_element_depth

FONTES DISPONÍVEIS (use no fontFamily — escreva o nome exato):
  • Título/impacto: Bebas Neue, Anton, Oswald, Archivo Black, Montserrat, Poppins, Righteous, Bungee
  • Elegante/serifa: Playfair Display, DM Serif Display, Cinzel, Lora, Abril Fatface
  • Corpo/limpa: Inter, Roboto, Open Sans, Lato, DM Sans, Work Sans, Nunito, Lexend
  • Manuscrita/script: Pacifico, Lobster, Dancing Script, Great Vibes, Caveat
  • Divertida: Bangers, Fredoka One, Titan One
  PARES QUE FUNCIONAM (título + corpo): Anton + Inter · Bebas Neue + Work Sans · Playfair Display + Lato · Oswald + Nunito.

RECEITAS DE DESIGN (siga como um plano; adapte à marca):
  ANÚNCIO: 1) título display grande no topo (y~0.2, fonte de impacto, cor de destaque). 2) subtítulo/benefício (y~0.35, fonte limpa, cor contrastante). 3) CTA embaixo (y~0.82, com backgroundColor de destaque no texto = vira um "botão"). 4) 1 vetor relevante num canto (não no meio). Paleta: no máx. 3 cores, com contraste.
  INTRO/ABERTURA: título centralizado grande (y~0.45) com animationPreset (ex.: scale/pop) + subtítulo abaixo (y~0.58).
  LOWER-THIRD: faixa (add_vector, retângulo colorido) no rodapé + nome (y~0.8) + cargo menor abaixo.
  Obs.: o vídeo não tem cor de fundo global — para uma "base" colorida atrás de tudo, use um vetor retângulo grande (add_vector) como primeiro elemento.

REGRAS DE POSICIONAMENTO (para NUNCA sobrepor):
  • Ao criar texto/vetor, se você OMITIR x/y a tool escolhe sozinha um slot vertical LIVRE — prefira omitir a chutar o centro.
  • Se você DER x/y, use valores DIFERENTES dos outros elementos no mesmo tempo. O contexto marca overlap:true quando dois colidem — se aparecer, mova um com update_element.
  • Slots úteis: título y~0.2 · subtítulo y~0.35 · meio y~0.5 · rodapé y~0.82. Deixe margem ~0.06 das bordas.
  • Cores: contraste com o fundo; use 1 cor de destaque; não deixe tudo branco.`;
