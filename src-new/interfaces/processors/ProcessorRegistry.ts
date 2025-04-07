import { ProcessorService } from '../../domain/services/ProcessorService.js';
import { AppError, ErrorCode } from '../../domain/errors/AppError.js';

/**
 * Registry for managing and accessing message processors
 */
export class ProcessorRegistry {
  private processors: Map<string, ProcessorService> = new Map();

  /**
   * Registers a processor in the registry
   * @param processor The processor to register
   */
  registerProcessor(processor: ProcessorService): void {
    this.processors.set(processor.processorType, processor);
  }

  /**
   * Gets a processor by type
   * @param processorType The type of processor to retrieve
   * @returns The processor service
   */
  getProcessor(processorType: string): ProcessorService {
    const processor = this.processors.get(processorType);
    if (!processor) {
      throw new AppError(
        `Unknown processor type: ${processorType}`,
        ErrorCode.UNKNOWN_PROCESSOR_TYPE,
        { 
          availableProcessors: Array.from(this.processors.keys()).join(', ') 
        }
      );
    }
    return processor;
  }

  /**
   * Gets all registered processors
   * @returns Map of all processors
   */
  getAllProcessors(): Map<string, ProcessorService> {
    return this.processors;
  }

  /**
   * Checks if a processor type is registered
   * @param processorType The type to check
   * @returns True if the processor is registered
   */
  hasProcessor(processorType: string): boolean {
    return this.processors.has(processorType);
  }

  /**
   * Gets the names of all registered processors
   * @returns Array of processor names
   */
  getProcessorTypes(): string[] {
    return Array.from(this.processors.keys());
  }
}