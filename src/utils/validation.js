import { z } from 'zod';

const DocumentSchema = z.object({
  document_type: z.string(),
  title: z.string(),
  summary: z.string(),
  relevance_score: z.number(),
  links: z.object({
    html: z.string().url(),
    pdf: z.string().url().optional(),
  }),
}).passthrough();

const MatchSchema = z.object({
  prompt: z.string(),
  documents: z.array(DocumentSchema),
});

export const ProcessorMessageSchema = z.object({
  version: z.string(),
  processor_type: z.enum(['boe', 'real-estate']),
  timestamp: z.string().datetime(),
  trace_id: z.string(),
  request: z.object({
    subscription_id: z.string().uuid(),
    processing_id: z.string(),
    user_id: z.string().uuid(),
    prompts: z.array(z.string()),
  }),
  results: z.object({
    query_date: z.string(),
    matches: z.array(MatchSchema),
  }),
  metadata: z.object({
    processing_time_ms: z.number(),
    total_matches: z.number(),
    status: z.enum(['success', 'error']),
    error: z.string().nullable(),
  }),
});

export function validateMessage(message) {
  return ProcessorMessageSchema.parse(message);
}