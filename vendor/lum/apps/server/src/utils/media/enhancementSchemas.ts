import { z } from "zod";

export const enhancementCapabilitiesSchema = z.strictObject({
  maxInputBytes: z.number().int().positive().max(500000000),
  maxOutputBytes: z.number().int().positive().max(2000000000),
  maxWidth: z.number().int().positive().max(32000),
  maxHeight: z.number().int().positive().max(32000),
  maxPixels: z.number().int().positive().max(1024000000),
  dimensionMultiple: z.number().int().positive().max(32000).optional(),
  maxScale: z.number().finite().min(1).max(16),
  maxDuration: z.number().finite().positive().max(3600),
  minFps: z.number().finite().positive().max(240),
  maxFps: z.number().finite().positive().max(240),
  interpolation: z.array(z.enum(["none", "apollo"])).min(1).max(2),
  slowMotion: z.array(z.number().int().min(1).max(16)).min(1).max(16),
  audio: z.array(z.enum(["preserve", "mute"])).min(1).max(2),
}).refine(value => value.minFps <= value.maxFps);

export const enhancementOptionsSchema = z.strictObject({
  width: z.number().int().positive().max(32000),
  height: z.number().int().positive().max(32000),
  fps: z.number().finite().positive().max(240).optional(),
  interpolation: z.enum(["none", "apollo"]),
  slowMotion: z.number().int().min(1).max(16),
  audio: z.enum(["preserve", "mute"]),
});
export const enhancementQuoteSchema = z.strictObject({
  requestId: z.string().min(1).max(512),
  cost: z.strictObject({ min: z.number().finite().nonnegative(), max: z.number().finite().nonnegative(), unit: z.string().min(1).max(64) }).refine(value => value.min <= value.max),
  seconds: z.strictObject({ min: z.number().finite().nonnegative(), max: z.number().finite().nonnegative() }).refine(value => value.min <= value.max),
  expiresAt: z.number().finite().positive().optional(),
});

export const enhancementMetadataSchema = z.strictObject({
  sha256: z.string().regex(/^[a-f0-9]{64}$/), size: z.number().int().positive().max(2000000000),
  mimeType: z.enum(["video/mp4", "video/quicktime", "video/webm"]),
  width: z.number().int().positive().max(32000), height: z.number().int().positive().max(32000),
  duration: z.number().finite().positive().max(57600).optional(), fps: z.number().finite().positive().max(1000).optional(),
  audioDuration: z.number().finite().positive().max(57600).optional(),
  frameCount: z.number().int().positive().optional(), hasAudio: z.boolean(),
});
