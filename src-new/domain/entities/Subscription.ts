/**
 * Represents a user subscription for content monitoring
 */
export class Subscription {
  constructor(
    public readonly id: string,
    public readonly userId: string,
    public readonly name: string,
    public readonly type: string,
    public readonly status: 'active' | 'inactive' | 'deleted',
    public readonly metadata: Record<string, unknown>,
    public readonly createdAt: Date,
    public readonly updatedAt: Date
  ) {}

  /**
   * Checks if this subscription is active
   * @returns Boolean indicating if subscription is active
   */
  isActive(): boolean {
    return this.status === 'active';
  }

  /**
   * Gets the subscription type (processor type)
   * @returns The processor type for this subscription
   */
  getProcessorType(): string {
    return this.type;
  }
}