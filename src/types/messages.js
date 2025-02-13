import { z } from 'zod';

// Common schemas shared across processors
export const CommonLinksSchema = z.object({
  html: z.string().url(),
  pdf: z.string().url().optional(),
});

export const CommonMetadataSchema = z.object({
  processing_time_ms: z.number(),
  total_matches: z.number(),
  status: z.enum(['success', 'error']),
  error: z.string().nullable(),
});

export const CommonRequestSchema = z.object({
  subscription_id: z.string().uuid(),
  processing_id: z.string(),
  user_id: z.string().uuid(),
  prompts: z.array(z.string()),
});