import { describe, it, expect } from 'vitest';
import { Escrow } from '../src/index';

describe('Escrow', () => {
  it('creates escrow', () => {
    const escrow = new Escrow();
    expect(escrow).toBeDefined();
  });
});
