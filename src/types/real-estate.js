import { z } from 'zod';
import { CommonLinksSchema, CommonMetadataSchema, CommonRequestSchema } from './messages.js';

// Real Estate specific document schema
const RealEstateDocumentSchema = z.object({
  document_type: z.literal('real_estate_listing'),
  title: z.string(),
  summary: z.string(),
  relevance_score: z.number(),
  links: CommonLinksSchema,
  // Real Estate specific fields
  price: z.number(),
  location: z.object({
    city: z.string(),
    region: z.string(),
    coordinates: z.object({
      lat: z.number(),
      lng: z.number(),
    }).optional(),
  }),
  property_type: z.string(),
  size_sqm: z.number().optional(),
  rooms: z.number().optional(),
}).passthrough();

const RealEstateMatchSchema = z.object({
  prompt: z.string(),
  documents: z.array(RealEstateDocumentSchema),
});

export const RealEstateMessageSchema = z.object({
  version: z.string(),
  processor_type: z.literal('real-estate'),
  timestamp: z.string().datetime(),
  trace_id: z.string(),
  request: CommonRequestSchema,
  results: z.object({
    query_date: z.string(),
    matches: z.array(RealEstateMatchSchema),
  }),
  metadata: CommonMetadataSchema,
});