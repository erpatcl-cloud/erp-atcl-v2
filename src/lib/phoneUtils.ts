export interface PhoneValidationResult {
  valid: boolean;
  normalized: string;
  error?: string;
}

/**
 * Normalize Bangladesh mobile numbers for duplicate comparison across
 * new and legacy records (preserves leading zero as string).
 */
export function normalizeBDPhone(raw: string): string {
  const trimmed = String(raw || '').trim();
  const digitsOnly = trimmed.replace(/[\s\-()]/g, '');
  if (digitsOnly.startsWith('+8801') && digitsOnly.length === 14) {
    return digitsOnly.slice(3);
  }
  if (digitsOnly.startsWith('8801') && digitsOnly.length === 13) {
    return digitsOnly.slice(2);
  }
  return digitsOnly;
}

/**
 * Strict validation for Bangladesh 11-digit mobile numbers:
 * - Required
 * - Exactly 11 numeric digits
 * - Valid Bangladesh mobile prefix: 013, 014, 015, 016, 017, 018, 019
 */
export function validateBDPhone(
  raw: string,
  emptyMessage = 'Phone number is required.'
): PhoneValidationResult {
  const trimmed = String(raw || '').trim();
  if (!trimmed) {
    return { valid: false, normalized: '', error: emptyMessage };
  }
  if (!/^\d+$/.test(trimmed)) {
    return {
      valid: false,
      normalized: trimmed,
      error: 'Phone number must contain only digits (e.g., 01744883636).',
    };
  }
  if (trimmed.length < 11) {
    return {
      valid: false,
      normalized: trimmed,
      error: 'Phone number must contain exactly 11 digits.',
    };
  }
  if (trimmed.length > 11) {
    return {
      valid: false,
      normalized: trimmed,
      error: 'Phone number cannot exceed 11 digits.',
    };
  }
  if (!/^01[3-9]\d{8}$/.test(trimmed)) {
    return {
      valid: false,
      normalized: trimmed,
      error: 'Enter a valid Bangladesh mobile number starting with 01.',
    };
  }
  return { valid: true, normalized: trimmed };
}
