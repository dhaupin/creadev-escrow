/**
 * @creadev.org/escrow
 *
 * Budget tracking, holds, approvals, circuit breakers.
 *
 * EXAMPLES:
 * ```typescript
 * import { Escrow } from '@creadev.org/escrow';
 *
 * const escrow = new Escrow();
 * escrow.canSpend('agent-1', 100);
 * ```
 * ============================================================================
 */

import { CircuitBreaker } from '@creadev.org/qos/retry';
import type { CircuitBreakerOptions } from '@creadev.org/qos/retry';

// ============================================================================
// CONFIG
// ============================================================================

export interface EscrowOptions {
  /** Default budget per agent (default: 1000) */
  defaultBudget?: number;
  /** Per-agent budgets */
  perAgentBudget?: Record<string, number>;
  /** Credit mode (default: false) */
  creditMode?: boolean;
  /** Hold timeout ms (default: 300000) */
  holdTimeout?: number;
  /** Max holds (default: 100) */
  maxHolds?: number;
  /** Operations requiring approval */
  approvalRequired?: string[];
  /** Circuit threshold (default: 5) */
  circuitThreshold?: number;
  /** Circuit timeout ms (default: 60000) */
  circuitTimeout?: number;
  /** Default quota (default: 1000) */
  defaultQuota?: number;
  /** Quota window ms (default: 3600000) */
  quotaWindow?: number;
}

export interface ExecuteContext {
  agentId: string;
  operation: string;
  cost: number;
  service?: string;
}

export interface HoldCondition {
  until: string | (() => boolean);
}

// ============================================================================
// ESCROW
// ============================================================================

export class Escrow {
  private options: Required<EscrowOptions>;
  private budgets: Map<string, number>;
  private holds: Map<string, HoldCondition>;
  private approvals: Map<string, { op: string; approved: boolean; timestamp: number }>;
  private quotas: Map<string, { used: number; windowStart: number }>;
  private breakers: Map<string, CircuitBreaker>;
  private costs: Record<string, number>;
  private startTime: number;

  constructor(options: EscrowOptions = {}) {
    this.options = {
      defaultBudget: options.defaultBudget || 1000,
      perAgentBudget: options.perAgentBudget || {},
      creditMode: options.creditMode || false,
      holdTimeout: options.holdTimeout || 300000,
      maxHolds: options.maxHolds || 100,
      approvalRequired: options.approvalRequired || ['delete', 'admin', 'write:critical'],
      circuitThreshold: options.circuitThreshold || 5,
      circuitTimeout: options.circuitTimeout || 60000,
      defaultQuota: options.defaultQuota || 1000,
      quotaWindow: options.quotaWindow || 3600000,
    };

    this.budgets = new Map();
    this.holds = new Map();
    this.approvals = new Map();
    this.quotas = new Map();
    this.breakers = new Map();
    this.costs = { read: 1, write: 5, delete: 10, admin: 50, 'default': 1 };
    this.startTime = Date.now();
  }

  // ---------------------------------------------------------------------------
  // BUDGET
  // ---------------------------------------------------------------------------

  /** Get budget for agent */
  getBudget(agentId: string): number {
    const saved = this.budgets.get(agentId);
    if (saved !== undefined) return saved;
    return this.options.perAgentBudget[agentId] ?? this.options.defaultBudget;
  }

  /** Set budget for agent */
  setBudget(agentId: string, amount: number): void {
    this.budgets.set(agentId, amount);
  }

  /** Can spend amount? */
  canSpend(agentId: string, amount: number): boolean {
    return this.getBudget(agentId) >= amount;
  }

  /** Spend amount */
  spend(agentId: string, amount: number): boolean {
    if (!this.canSpend(agentId, amount)) return false;
    const current = this.getBudget(agentId);
    this.setBudget(agentId, current - amount);
    return true;
  }

  // ---------------------------------------------------------------------------
  // HOLDS
  // ---------------------------------------------------------------------------

  /** Add hold */
  hold(id: string, condition: HoldCondition): void {
    if (this.holds.size >= this.options.maxHolds) {
      throw new Error('Max holds exceeded');
    }
    this.holds.set(id, condition);
  }

  /** Release hold */
  releaseHold(id: string): boolean {
    return this.holds.delete(id);
  }

  /** Check hold */
  isHeld(id: string): boolean {
    const condition = this.holds.get(id);
    if (!condition) return false;
    
    if (typeof condition.until === 'function') {
      return !condition.until();
    }
    // String condition - check if met
    return true; // Simplified for string conditions
  }

  // ---------------------------------------------------------------------------
  // APPROVALS
  // ---------------------------------------------------------------------------

  /** Request approval */
  requestApproval(op: string, reason: string): string {
    const id = self.crypto?.randomUUID?.() || Math.random().toString(36).slice(2) + Date.now().toString(36);
    this.approvals.set(id, { op, approved: false, timestamp: Date.now() });
    return id;
  }

  /** Approve */
  approve(id: string): boolean {
    const approval = this.approvals.get(id);
    if (!approval) return false;
    approval.approved = true;
    return true;
  }

  /** Check if approved */
  isApproved(id: string): boolean {
    const approval = this.approvals.get(id);
    return approval?.approved ?? false;
  }

  // ---------------------------------------------------------------------------
  // QUOTA
  // ---------------------------------------------------------------------------

  /** Check quota */
  canUseQuota(key: string): boolean {
    const quota = this.quotas.get(key);
    if (!quota) return true;
    
    const now = Date.now();
    if (now - quota.windowStart > this.options.quotaWindow) {
      // Reset window
      this.quotas.set(key, { used: 0, windowStart: now });
      return true;
    }
    
    return quota.used < this.options.defaultQuota;
  }

  /** Use quota */
  useQuota(key: string, amount = 1): boolean {
    if (!this.canUseQuota(key)) return false;
    
    const quota = this.quotas.get(key) || { used: 0, windowStart: Date.now() };
    quota.used += amount;
    this.quotas.set(key, quota);
    return true;
  }

  // ---------------------------------------------------------------------------
  // CIRCUIT BREAKER
  // ---------------------------------------------------------------------------

  /** Get/create breaker for service */
  private _getBreaker(service: string): CircuitBreaker {
    let breaker = this.breakers.get(service);
    if (!breaker) {
      breaker = new CircuitBreaker({
        failureThreshold: this.options.circuitThreshold,
        resetTimeoutMs: this.options.circuitTimeout,
      });
      this.breakers.set(service, breaker);
    }
    return breaker;
  }

  /** Circuit open? */
  isOpen(service: string): boolean {
    return this._getBreaker(service).status === 'open';
  }

  // ---------------------------------------------------------------------------
  // EXECUTE
  // ---------------------------------------------------------------------------

  /** Get cost for operation */
  private _getCost(operation: string): number {
    return this.costs[operation] ?? this.costs['default'];
  }

  /** Execute with budget/approval checks */
  beforeExecute(ctx: ExecuteContext): { allowed: boolean; reason?: string } {
    const { agentId, operation, cost = this._getCost(operation), service } = ctx;

    // Check budget
    if (!this.canSpend(agentId, cost)) {
      return { allowed: false, reason: 'Insufficient budget' };
    }

    // Check approval required
    if (this.options.approvalRequired.includes(operation)) {
      return { allowed: false, reason: `Approval required for: ${operation}` };
    }

    // Check quota
    if (!this.canUseQuota(operation)) {
      return { allowed: false, reason: 'Quota exceeded' };
    }

    // Check circuit
    if (service && this.isOpen(service)) {
      return { allowed: false, reason: `Circuit open for: ${service}` };
    }

    return { allowed: true };
  }

  /** Execute operation with escrow */
  async execute<T>(
    ctx: ExecuteContext,
    fn: () => Promise<T>
  ): Promise<T> {
    const check = this.beforeExecute(ctx);
    if (!check.allowed) {
      throw new Error(check.reason);
    }

    // Spend budget
    this.spend(ctx.agentId, ctx.cost);
    
    // Use quota
    this.useQuota(ctx.operation);

    try {
      return await fn();
    } catch (e) {
      // Mark circuit failure
      if (ctx.service) {
        this._getBreaker(ctx.service).execute(() => { throw e; }).catch(() => {});
      }
      throw e;
    }
  }

  // ---------------------------------------------------------------------------
  // STATUS
  // ---------------------------------------------------------------------------

  getStatus() {
    return {
      budgets: this.budgets.size,
      holds: this.holds.size,
      approvals: this.approvals.size,
      quotas: this.quotas.size,
      uptime: Date.now() - this.startTime,
    };
  }
}