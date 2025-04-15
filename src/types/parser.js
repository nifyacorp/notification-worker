import { z } from 'zod';

/**
 * Common type definitions for all parsers
 */

// Common schema components
export const CommonLinksSchema = z.object({
  html: z.string().url().optional(),
  pdf: z.string().url().optional(),
}).passthrough();

// Common metadata for all messages
export const CommonMetadataSchema = z.object({
  processing_time_ms: z.number().optional(),
  total_items_processed: z.number().optional(),
  status: z.enum(['success', 'error', 'partial']).optional(),
  error: z.string().nullable().optional(),
}).passthrough();

// Match schema for individual documents/results
export const MatchSchema = z.object({
  document_type: z.string().optional(),
  title: z.string(),
  notification_title: z.string().optional(),
  summary: z.string().optional(),
  issuing_body: z.string().optional(),
  relevance_score: z.number().optional(),
  links: CommonLinksSchema.optional(),
}).passthrough();

// Query result structure
export const QueryResultSchema = z.object({
  prompt: z.string(),
  matches: z.array(MatchSchema),
  metadata: z.object({
    processing_time_ms: z.number().optional(),
    model_used: z.string().optional(),
    token_usage: z.object({
      input_tokens: z.number().optional(),
      output_tokens: z.number().optional(),
      total_tokens: z.number().optional(),
    }).optional(),
  }).optional(),
}).passthrough();

// Request schema with user and subscription IDs
export const RequestSchema = z.object({
  user_id: z.string(),
  subscription_id: z.string(),
  texts: z.array(z.string()).optional(),
}).passthrough();

// Results schema with query date and results
export const ResultsSchema = z.object({
  query_date: z.string().optional(),
  results: z.array(QueryResultSchema),
  boe_info: z.object({
    issue_number: z.string().optional(),
    publication_date: z.string().optional(),
    source_url: z.string().optional(),
  }).optional(),
}).passthrough();

// Main message schema
export const MessageSchema = z.object({
  trace_id: z.string(),
  request: RequestSchema,
  results: ResultsSchema,
  metadata: CommonMetadataSchema.optional(),
}).passthrough(); 