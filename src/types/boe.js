import { z } from 'zod';
import { CommonLinksSchema, CommonMetadataSchema, CommonRequestSchema } from './messages.js';

// BOE-specific document schema
const BOEDocumentSchema = z.object({
  document_type: z.literal('boe_document'),
  title: z.string(),
  summary: z.string(),
  relevance_score: z.number(),
  links: CommonLinksSchema,
  // BOE-specific fields
  publication_date: z.string().datetime(),
  section: z.string(),
  bulletin_type: z.string(),
}).passthrough();

const BOEMatchSchema = z.object({
  prompt: z.string(),
  documents: z.array(BOEDocumentSchema),
});

export const BOEMessageSchema = z.object({
  version: z.string(),
  processor_type: z.literal('boe'),
  timestamp: z.string().datetime(),
  trace_id: z.string(),
  request: CommonRequestSchema,
  results: z.object({
    query_date: z.string(),
    matches: z.array(BOEMatchSchema),
  }),
  metadata: CommonMetadataSchema,
});