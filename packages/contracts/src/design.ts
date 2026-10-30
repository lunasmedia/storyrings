import { z } from 'zod';

/**
 * A story designed in the dashboard's studio: a background and layers (text, shapes, stickers)
 * on a 1080 × 1920 canvas. The studio renders it to the story's image, which is what every SDK
 * shows; the design is kept so the story can be edited again.
 */
export const DESIGN_WIDTH = 1080;
export const DESIGN_HEIGHT = 1920;
export const DESIGN_MAX_LAYERS = 30;
export const DESIGN_TEXT_MAX = 300;

export const designFonts = ['sans', 'serif', 'display', 'mono'] as const;
export type DesignFont = (typeof designFonts)[number];

const color = z.string().regex(/^#[0-9a-fA-F]{6}$/, 'A colour like #ff3366');
const layerId = z.string().min(1).max(40);
/** Positions may sit partly off the canvas while being placed. */
const coord = z.number().min(-2000).max(4000);

const layerBase = {
  id: layerId,
  /** Centre of the layer on the canvas. */
  x: coord,
  y: coord,
  /** Degrees, clockwise. */
  rotation: z.number().min(-180).max(180).default(0),
  opacity: z.number().min(0).max(1).default(1),
};

export const textLayerSchema = z.object({
  ...layerBase,
  kind: z.literal('text'),
  text: z.string().max(DESIGN_TEXT_MAX),
  font: z.enum(designFonts),
  /** Font size in canvas pixels. */
  size: z.number().min(16).max(320),
  weight: z.union([z.literal(400), z.literal(700), z.literal(900)]),
  color,
  align: z.enum(['left', 'center', 'right']),
  /** Lines wrap at this width. */
  width: z.number().min(80).max(DESIGN_WIDTH),
  /** A box behind the text, or none. */
  background: color.nullable(),
});

export const shapeLayerSchema = z.object({
  ...layerBase,
  kind: z.literal('shape'),
  shape: z.enum(['rect', 'ellipse']),
  width: z.number().min(8).max(4000),
  height: z.number().min(8).max(4000),
  fill: color,
  /** Corner radius for rectangles. */
  radius: z.number().min(0).max(2000),
});

export const stickerLayerSchema = z.object({
  ...layerBase,
  kind: z.literal('sticker'),
  /** An emoji. */
  emoji: z.string().min(1).max(16),
  size: z.number().min(24).max(1000),
});

/**
 * Interactive stickers. They are not part of the story's image: each SDK draws them over it
 * (at the same place, scaled with the image) so people can tap, vote and drag. Sizes inside
 * them are in units of width / 600 (spec/README.md, "Interactions").
 */
export const interactionKinds = ['poll', 'quiz', 'slider', 'link', 'countdown'] as const;
export type InteractionKind = (typeof interactionKinds)[number];
export const INTERACTION_MIN_WIDTH = 300;
export const INTERACTION_QUESTION_MAX = 80;
export const INTERACTION_OPTION_MAX = 40;
export const INTERACTION_DEFAULT_ACCENT = '#c2255c';

const interactionBase = {
  id: layerId,
  x: coord,
  y: coord,
  /** Interactive stickers aren't rotated. */
  rotation: z.literal(0).default(0),
  opacity: z.literal(1).default(1),
  width: z.number().min(INTERACTION_MIN_WIDTH).max(DESIGN_WIDTH),
  /** Colour of results, the slider's fill, the link's text and the countdown's title. */
  accent: color,
};
const question = z.string().max(INTERACTION_QUESTION_MAX);
const options = z.array(z.string().trim().min(1).max(INTERACTION_OPTION_MAX)).min(2).max(4);

export const pollLayerSchema = z.object({
  ...interactionBase,
  kind: z.literal('poll'),
  question,
  options,
});
export const quizLayerSchema = z.object({
  ...interactionBase,
  kind: z.literal('quiz'),
  question,
  options,
  /** Index of the right answer. */
  correct: z.number().int().min(0).max(3),
});
export const sliderLayerSchema = z.object({
  ...interactionBase,
  kind: z.literal('slider'),
  question,
  emoji: z.string().min(1).max(16),
});
export const linkLayerSchema = z.object({
  ...interactionBase,
  kind: z.literal('link'),
  label: z.string().trim().min(1).max(30),
  /** Same rules as the story button: https, or one of the app's deep-link schemes. */
  url: z.string().max(2000),
});
export const countdownLayerSchema = z.object({
  ...interactionBase,
  kind: z.literal('countdown'),
  title: z.string().max(40),
  endsAt: z.string().datetime(),
});

export const designLayerSchema = z
  .discriminatedUnion('kind', [
    textLayerSchema,
    shapeLayerSchema,
    stickerLayerSchema,
    pollLayerSchema,
    quizLayerSchema,
    sliderLayerSchema,
    linkLayerSchema,
    countdownLayerSchema,
  ])
  .refine((l) => l.kind !== 'quiz' || l.correct < l.options.length, {
    message: 'The right answer must be one of the options',
    path: ['correct'],
  });

const backgroundInput = z.discriminatedUnion('kind', [
  z.object({ kind: z.literal('color'), color }),
  z.object({
    kind: z.literal('gradient'),
    from: color,
    to: color,
    /** CSS angle: 0 = bottom to top, 90 = left to right, 180 = top to bottom. */
    angle: z.number().min(0).max(360),
  }),
  z.object({
    kind: z.literal('image'),
    /** An uploaded image of this app. */
    mediaId: z.string().uuid(),
    fit: z.enum(['cover', 'contain']),
    /** Darkens the photo so text reads on it (0 = none). */
    dim: z.number().min(0).max(0.85),
    /** Behind a "contain" photo. */
    color,
  }),
  z.object({
    kind: z.literal('video'),
    /**
     * The story's own video (its `mediaId`): text, shapes and stickers go over it. They're saved
     * as a transparent overlay image (`overlayMediaId`) the SDKs draw over the video.
     */
    mediaId: z.string().uuid(),
    fit: z.enum(['cover', 'contain']),
    /** Darkens the video so text reads on it (0 = none). */
    dim: z.number().min(0).max(0.85),
    /** Behind a "contain" video. */
    color,
  }),
]);

export const storyDesignInput = z.object({
  version: z.literal(1),
  background: backgroundInput,
  layers: z
    .array(designLayerSchema)
    .max(DESIGN_MAX_LAYERS)
    // One of each interactive sticker per story: one poll, one quiz, one slider, one link, one countdown.
    .refine(
      (layers) => {
        const kinds = layers
          .map((l) => l.kind)
          .filter((k) => (interactionKinds as readonly string[]).includes(k));
        return new Set(kinds).size === kinds.length;
      },
      {
        message:
          'A story can have only one of each interactive sticker. Remove the existing one to add another.',
      },
    ),
});
export type StoryDesignInput = z.input<typeof storyDesignInput>;

export type DesignLayer = z.infer<typeof designLayerSchema>;
export type TextLayer = z.infer<typeof textLayerSchema>;
export type ShapeLayer = z.infer<typeof shapeLayerSchema>;
export type StickerLayer = z.infer<typeof stickerLayerSchema>;
export type PollLayer = z.infer<typeof pollLayerSchema>;
export type QuizLayer = z.infer<typeof quizLayerSchema>;
export type SliderLayer = z.infer<typeof sliderLayerSchema>;
export type LinkLayer = z.infer<typeof linkLayerSchema>;
export type CountdownLayer = z.infer<typeof countdownLayerSchema>;
export type InteractionLayer = PollLayer | QuizLayer | SliderLayer | LinkLayer | CountdownLayer;

export const isInteraction = (l: DesignLayer): l is InteractionLayer =>
  (interactionKinds as readonly string[]).includes(l.kind);
export type DesignBackgroundInput = z.infer<typeof backgroundInput>;

/** A design as the API returns it: photo and video backgrounds carry their URL. */
export type DesignBackground =
  | Exclude<DesignBackgroundInput, { kind: 'image' | 'video' }>
  | (Extract<DesignBackgroundInput, { kind: 'image' }> & { url: string })
  | (Extract<DesignBackgroundInput, { kind: 'video' }> & { url: string });

export interface StoryDesign {
  version: 1;
  background: DesignBackground;
  layers: DesignLayer[];
}
