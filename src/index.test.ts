import { describe, it, expect, beforeEach } from 'vitest';
import { Escrow, createEscrow, checkQuota, reserve, release } from '../src/index';

describe('Escrow', () => {
  let escrow: Escrow;
  beforeEach(() => { escrow = createEscrow(); });
  it('creates escrow', () => { expect(escrow).toBeDefined(); });
});

describe('checkQuota', () => {
  it('checks quota', () => {
    const result = checkQuota('agent-1', 100);
    expect(result.allowed).toBe(true);
  });
});
