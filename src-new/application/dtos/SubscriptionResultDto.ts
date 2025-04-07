/**
 * DTO for document information from subscription processing
 */
export interface DocumentDto {
  id?: string;
  title?: string;
  notification_title?: string;
  summary?: string;
  relevance_score?: number;
  document_type?: string;
  publication_date?: string;
  links?: {
    html?: string;
    pdf?: string;
  };
  section?: string;
  bulletin_type?: string;
  issuing_body?: string;
  department?: string;
  [key: string]: unknown;
}

/**
 * DTO for a match set from subscription processing
 */
export interface MatchDto {
  prompt?: string;
  documents?: DocumentDto[];
  [key: string]: unknown;
}

/**
 * Main subscription result DTO structure
 */
export interface SubscriptionResultDto {
  // Required fields
  processor_type: string;
  trace_id?: string;
  
  // Request context
  request?: {
    user_id?: string;
    subscription_id?: string;
    prompts?: string[];
    [key: string]: unknown;
  };
  
  // User and subscription IDs can be in multiple places
  user_id?: string;
  subscription_id?: string;
  context?: {
    user_id?: string;
    subscription_id?: string;
    [key: string]: unknown;
  };
  
  // Results data
  results?: {
    matches?: MatchDto[];
    results?: MatchDto[] | Array<{matches?: DocumentDto[]}>;
    [key: string]: unknown;
  };
  
  // Allow additional properties
  [key: string]: unknown;
}