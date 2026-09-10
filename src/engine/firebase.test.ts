import { describe, it, expect } from 'vitest';
import { isAjiadoDomain } from './firebase';

describe('isAjiadoDomain', () => {
  it('should accept valid @ajiado.co.jp emails', () => {
    expect(isAjiadoDomain('user@ajiado.co.jp')).toBe(true);
    expect(isAjiadoDomain('TANAKA@AJIADO.CO.JP')).toBe(true);
    expect(isAjiadoDomain('first.last@ajiado.co.jp')).toBe(true);
  });

  it('should reject non-@ajiado.co.jp emails', () => {
    expect(isAjiadoDomain('user@gmail.com')).toBe(false);
    expect(isAjiadoDomain('user@ajiado.co.jp.evil.com')).toBe(false);
    expect(isAjiadoDomain('ajiado.co.jp@gmail.com')).toBe(false);
    expect(isAjiadoDomain('user@othercompany.com')).toBe(false);
  });

  it('should reject empty or null inputs', () => {
    expect(isAjiadoDomain(null)).toBe(false);
    expect(isAjiadoDomain(undefined)).toBe(false);
    expect(isAjiadoDomain('')).toBe(false);
  });
});
