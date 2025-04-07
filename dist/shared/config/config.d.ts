/**
 * @file Application configuration
 * Centralized configuration with validation
 */
import { z } from 'zod';
/**
 * Application configuration schema
 */
declare const AppConfigSchema: z.ZodObject<{
    port: z.ZodDefault<z.ZodNumber>;
    environment: z.ZodDefault<z.ZodEnum<["development", "test", "production"]>>;
    projectId: z.ZodOptional<z.ZodString>;
    instanceConnectionName: z.ZodOptional<z.ZodString>;
    database: z.ZodDefault<z.ZodObject<{
        user: z.ZodOptional<z.ZodString>;
        password: z.ZodOptional<z.ZodString>;
        name: z.ZodOptional<z.ZodString>;
        host: z.ZodDefault<z.ZodString>;
        port: z.ZodDefault<z.ZodNumber>;
        maxPool: z.ZodDefault<z.ZodNumber>;
        minPool: z.ZodDefault<z.ZodNumber>;
        idleTimeout: z.ZodDefault<z.ZodNumber>;
        connectionTimeout: z.ZodDefault<z.ZodNumber>;
    }, "strip", z.ZodTypeAny, {
        port: number;
        host: string;
        maxPool: number;
        minPool: number;
        idleTimeout: number;
        connectionTimeout: number;
        name?: string | undefined;
        user?: string | undefined;
        password?: string | undefined;
    }, {
        port?: number | undefined;
        name?: string | undefined;
        user?: string | undefined;
        password?: string | undefined;
        host?: string | undefined;
        maxPool?: number | undefined;
        minPool?: number | undefined;
        idleTimeout?: number | undefined;
        connectionTimeout?: number | undefined;
    }>>;
    pubsub: z.ZodDefault<z.ZodObject<{
        subscription: z.ZodOptional<z.ZodString>;
        dlqTopic: z.ZodOptional<z.ZodString>;
        emailImmediateTopic: z.ZodDefault<z.ZodString>;
        emailDailyTopic: z.ZodDefault<z.ZodString>;
        retry: z.ZodDefault<z.ZodObject<{
            maxRetries: z.ZodDefault<z.ZodNumber>;
            initialDelay: z.ZodDefault<z.ZodNumber>;
            maxDelay: z.ZodDefault<z.ZodNumber>;
            factor: z.ZodDefault<z.ZodNumber>;
        }, "strip", z.ZodTypeAny, {
            maxRetries: number;
            initialDelay: number;
            maxDelay: number;
            factor: number;
        }, {
            maxRetries?: number | undefined;
            initialDelay?: number | undefined;
            maxDelay?: number | undefined;
            factor?: number | undefined;
        }>>;
    }, "strip", z.ZodTypeAny, {
        emailImmediateTopic: string;
        emailDailyTopic: string;
        retry: {
            maxRetries: number;
            initialDelay: number;
            maxDelay: number;
            factor: number;
        };
        subscription?: string | undefined;
        dlqTopic?: string | undefined;
    }, {
        subscription?: string | undefined;
        dlqTopic?: string | undefined;
        emailImmediateTopic?: string | undefined;
        emailDailyTopic?: string | undefined;
        retry?: {
            maxRetries?: number | undefined;
            initialDelay?: number | undefined;
            maxDelay?: number | undefined;
            factor?: number | undefined;
        } | undefined;
    }>>;
    retry: z.ZodDefault<z.ZodObject<{
        database: z.ZodDefault<z.ZodObject<{
            maxRetries: z.ZodDefault<z.ZodNumber>;
            initialDelay: z.ZodDefault<z.ZodNumber>;
            maxDelay: z.ZodDefault<z.ZodNumber>;
            factor: z.ZodDefault<z.ZodNumber>;
        }, "strip", z.ZodTypeAny, {
            maxRetries: number;
            initialDelay: number;
            maxDelay: number;
            factor: number;
        }, {
            maxRetries?: number | undefined;
            initialDelay?: number | undefined;
            maxDelay?: number | undefined;
            factor?: number | undefined;
        }>>;
        pubsub: z.ZodDefault<z.ZodObject<{
            maxRetries: z.ZodDefault<z.ZodNumber>;
            initialDelay: z.ZodDefault<z.ZodNumber>;
            maxDelay: z.ZodDefault<z.ZodNumber>;
            factor: z.ZodDefault<z.ZodNumber>;
        }, "strip", z.ZodTypeAny, {
            maxRetries: number;
            initialDelay: number;
            maxDelay: number;
            factor: number;
        }, {
            maxRetries?: number | undefined;
            initialDelay?: number | undefined;
            maxDelay?: number | undefined;
            factor?: number | undefined;
        }>>;
    }, "strip", z.ZodTypeAny, {
        database: {
            maxRetries: number;
            initialDelay: number;
            maxDelay: number;
            factor: number;
        };
        pubsub: {
            maxRetries: number;
            initialDelay: number;
            maxDelay: number;
            factor: number;
        };
    }, {
        database?: {
            maxRetries?: number | undefined;
            initialDelay?: number | undefined;
            maxDelay?: number | undefined;
            factor?: number | undefined;
        } | undefined;
        pubsub?: {
            maxRetries?: number | undefined;
            initialDelay?: number | undefined;
            maxDelay?: number | undefined;
            factor?: number | undefined;
        } | undefined;
    }>>;
}, "strip", z.ZodTypeAny, {
    database: {
        port: number;
        host: string;
        maxPool: number;
        minPool: number;
        idleTimeout: number;
        connectionTimeout: number;
        name?: string | undefined;
        user?: string | undefined;
        password?: string | undefined;
    };
    pubsub: {
        emailImmediateTopic: string;
        emailDailyTopic: string;
        retry: {
            maxRetries: number;
            initialDelay: number;
            maxDelay: number;
            factor: number;
        };
        subscription?: string | undefined;
        dlqTopic?: string | undefined;
    };
    port: number;
    retry: {
        database: {
            maxRetries: number;
            initialDelay: number;
            maxDelay: number;
            factor: number;
        };
        pubsub: {
            maxRetries: number;
            initialDelay: number;
            maxDelay: number;
            factor: number;
        };
    };
    environment: "development" | "production" | "test";
    projectId?: string | undefined;
    instanceConnectionName?: string | undefined;
}, {
    database?: {
        port?: number | undefined;
        name?: string | undefined;
        user?: string | undefined;
        password?: string | undefined;
        host?: string | undefined;
        maxPool?: number | undefined;
        minPool?: number | undefined;
        idleTimeout?: number | undefined;
        connectionTimeout?: number | undefined;
    } | undefined;
    pubsub?: {
        subscription?: string | undefined;
        dlqTopic?: string | undefined;
        emailImmediateTopic?: string | undefined;
        emailDailyTopic?: string | undefined;
        retry?: {
            maxRetries?: number | undefined;
            initialDelay?: number | undefined;
            maxDelay?: number | undefined;
            factor?: number | undefined;
        } | undefined;
    } | undefined;
    port?: number | undefined;
    projectId?: string | undefined;
    retry?: {
        database?: {
            maxRetries?: number | undefined;
            initialDelay?: number | undefined;
            maxDelay?: number | undefined;
            factor?: number | undefined;
        } | undefined;
        pubsub?: {
            maxRetries?: number | undefined;
            initialDelay?: number | undefined;
            maxDelay?: number | undefined;
            factor?: number | undefined;
        } | undefined;
    } | undefined;
    environment?: "development" | "production" | "test" | undefined;
    instanceConnectionName?: string | undefined;
}>;
/**
 * Application configuration type
 */
export type AppConfig = z.infer<typeof AppConfigSchema>;
/**
 * Application configuration singleton
 */
export declare const config: {
    database: {
        port: number;
        host: string;
        maxPool: number;
        minPool: number;
        idleTimeout: number;
        connectionTimeout: number;
        name?: string | undefined;
        user?: string | undefined;
        password?: string | undefined;
    };
    pubsub: {
        emailImmediateTopic: string;
        emailDailyTopic: string;
        retry: {
            maxRetries: number;
            initialDelay: number;
            maxDelay: number;
            factor: number;
        };
        subscription?: string | undefined;
        dlqTopic?: string | undefined;
    };
    port: number;
    retry: {
        database: {
            maxRetries: number;
            initialDelay: number;
            maxDelay: number;
            factor: number;
        };
        pubsub: {
            maxRetries: number;
            initialDelay: number;
            maxDelay: number;
            factor: number;
        };
    };
    environment: "development" | "production" | "test";
    projectId?: string | undefined;
    instanceConnectionName?: string | undefined;
};
/**
 * Log the current configuration
 */
export declare function logConfig(): void;
export {};
