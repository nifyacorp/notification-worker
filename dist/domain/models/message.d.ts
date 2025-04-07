/**
 * @file Message domain model
 * Contains the core message types for processing notifications
 */
/**
 * ProcessorType enum for different message sources
 */
export declare enum ProcessorType {
    BOE = "boe",
    REAL_ESTATE = "real-estate",
    GENERIC = "generic"
}
/**
 * Document interface - base interface for all document types
 */
export interface Document {
    document_type: string;
    title: string;
    notification_title?: string;
    summary: string;
    relevance_score: number;
    links: {
        html: string;
        pdf?: string;
    };
    [key: string]: any;
}
/**
 * BOEDocument interface for BOE-specific documents
 */
export interface BOEDocument extends Document {
    document_type: 'boe_document';
    publication_date: string;
    section: string;
    bulletin_type: string;
    issuing_body?: string;
    department?: string;
    dates?: {
        publication_date: string;
        [key: string]: any;
    };
}
/**
 * RealEstateDocument interface for real estate listings
 */
export interface RealEstateDocument extends Document {
    document_type: 'real_estate_listing';
    price: number;
    location: {
        city: string;
        region: string;
        coordinates?: {
            lat: number;
            lng: number;
        };
    };
    property_type: string;
    size_sqm?: number;
    rooms?: number;
}
/**
 * Match interface for a single match with documents
 */
export interface Match {
    prompt: string;
    documents: Document[];
}
/**
 * ProcessorRequest interface for processing requests
 */
export interface ProcessorRequest {
    subscription_id: string;
    processing_id: string;
    user_id: string;
    prompts: string[];
    [key: string]: any;
}
/**
 * ProcessorResults interface for processing results
 */
export interface ProcessorResults {
    query_date: string;
    matches: Match[];
    [key: string]: any;
}
/**
 * ProcessorMetadata interface for processing metadata
 */
export interface ProcessorMetadata {
    processing_time_ms: number;
    total_matches: number;
    status: 'success' | 'error';
    error: string | null;
    [key: string]: any;
}
/**
 * ProcessorMessage interface - the main message format
 */
export interface ProcessorMessage {
    version: string;
    processor_type: ProcessorType | string;
    timestamp: string;
    trace_id: string;
    request: ProcessorRequest;
    results: ProcessorResults;
    metadata: ProcessorMetadata;
    context?: any;
}
/**
 * ValidationResult interface for message validation results
 */
export interface ValidationResult {
    data: ProcessorMessage;
    valid: boolean;
    errors: any | null;
    processorType: ProcessorType | string;
}
