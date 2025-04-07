/**
 * Represents a document match from subscription processing
 */
export interface DocumentMatch {
  id?: string;
  title: string;
  notification_title?: string;
  summary: string;
  links: {
    html?: string;
    pdf?: string;
  };
  metadata?: Record<string, unknown>;
  relevance_score?: number;
  publication_date?: string;
  document_type?: string;
  section?: string;
  bulletin_type?: string;
  issuing_body?: string;
  department?: string;
}

/**
 * Represents a match set from subscription processing
 */
export interface MatchSet {
  prompt: string;
  documents: DocumentMatch[];
}

/**
 * Represents the result of subscription processing
 */
export class SubscriptionResult {
  constructor(
    public readonly userId: string,
    public readonly subscriptionId: string,
    public readonly processorType: string,
    public readonly matches: MatchSet[],
    public readonly traceId: string,
    public readonly timestamp: Date = new Date()
  ) {}

  /**
   * Gets the total number of documents across all matches
   * @returns Total document count
   */
  getTotalDocumentCount(): number {
    return this.matches.reduce((count, match) => count + match.documents.length, 0);
  }

  /**
   * Gets a unique identifier for this processing result
   * @returns String identifier
   */
  getResultIdentifier(): string {
    return `${this.processorType}-${this.subscriptionId}-${this.traceId}`;
  }
}