/**
 * Phone number validation and normalization utilities
 * Handles UK phone numbers, international numbers, and edge cases
 */

export interface PhoneValidationResult {
  isValid: boolean;
  normalized: string | null;
  type: 'mobile' | 'landline' | 'international' | 'invalid';
  original: string;
  issues: string[];
}

export interface EmailExtractionResult {
  phone: string | null;
  email: string | null;
}

/**
 * Extract email if it's mixed in the phone field
 * Examples: "hava@veredflowers.com/07973873113" -> { email: "hava@veredflowers.com", phone: "07973873113" }
 */
export function extractEmailFromPhone(input: string): EmailExtractionResult {
  if (!input || typeof input !== 'string') {
    return { phone: null, email: null };
  }

  const trimmed = input.trim();

  // Check if it contains an email pattern
  const emailRegex = /([a-zA-Z0-9._%+-]+@[a-zA-Z0-9.-]+\.[a-zA-Z]{2,})/;
  const emailMatch = trimmed.match(emailRegex);

  if (emailMatch) {
    const email = emailMatch[1];
    // Remove the email and any separators, leaving just the phone
    let phone = trimmed.replace(email, '').replace(/^[\/\-\s]+|[\/\-\s]+$/g, '').trim();

    return {
      email,
      phone: phone || null,
    };
  }

  return { phone: trimmed, email: null };
}

/**
 * Normalize a UK phone number to +44 format
 * Handles various input formats and cleans up invalid characters
 */
export function normalizePhoneNumber(input: string | null | undefined): PhoneValidationResult {
  const issues: string[] = [];

  if (!input || typeof input !== 'string') {
    return {
      isValid: false,
      normalized: null,
      type: 'invalid',
      original: input || '',
      issues: ['Empty or null input'],
    };
  }

  const original = input.trim();

  // Check for obviously invalid entries
  if (original === '0' || original === '00' || original.length < 5) {
    return {
      isValid: false,
      normalized: null,
      type: 'invalid',
      original,
      issues: ['Too short or placeholder value'],
    };
  }

  // Check if it starts with invalid characters
  if (original.startsWith('/') || original.startsWith('-')) {
    issues.push('Starts with invalid character');
  }

  // Strict cleaning: Remove EVERYTHING that is not a digit or a plus sign
  // But we want to preserve the structure if checking validity, so...
  // Actually, the previous regex was: /[\s\-\(\)\/]/g
  // We need to also remove letters.
  let cleaned = original.replace(/[^0-9+]/g, '');

  // If there are multiple plus signs, or plus in the middle, it's invalid
  if (cleaned.indexOf('+', 1) !== -1) {
    issues.push('Invalid + placement');
    return {
      isValid: false,
      normalized: null,
      type: 'invalid',
      original,
      issues
    };
  }

  // Handle international format with +
  if (cleaned.startsWith('+')) {
    // Already in international format
    if (cleaned.startsWith('+44')) {
      // UK number
      const withoutPrefix = cleaned.substring(3);
      // UK numbers (without +44) are typically 10 digits. Allow 9-11 range for flexibility.
      // 020 1234 5678 (10 digits)
      // 077 1234 5678 (10 digits)
      if (withoutPrefix.length >= 9 && withoutPrefix.length <= 11) {
        return {
          isValid: true,
          normalized: cleaned,
          type: withoutPrefix.startsWith('7') ? 'mobile' : 'landline',
          original,
          issues,
        };
      } else {
        issues.push(`UK number length invalid (found ${withoutPrefix.length}, expected 9-11)`);
        return {
          isValid: false,
          normalized: null,
          type: 'invalid',
          original,
          issues,
        };
      }
    } else {
      // Other international number
      // E.164 max length is 15 digits (including country code)
      // We allow up to 16 just in case, but strictly less than 20 for DB safety
      if (cleaned.length >= 10 && cleaned.length <= 16) {
        return {
          isValid: true,
          normalized: cleaned,
          type: 'international',
          original,
          issues,
        };
      } else {
        issues.push('International number length invalid (expected 10-16)');
        return {
          isValid: false,
          normalized: null,
          type: 'invalid',
          original,
          issues,
        };
      }
    }
  }

  // Handle 00 prefix (international format without +)
  if (cleaned.startsWith('00')) {
    const withPlus = '+' + cleaned.substring(2);
    return normalizePhoneNumber(withPlus);
  }

  // Handle UK numbers starting with 0
  if (cleaned.startsWith('0')) {
    // Remove leading 0 and add +44
    const withoutZero = cleaned.substring(1);

    if (withoutZero.length >= 9 && withoutZero.length <= 11) {
      const normalized = '+44' + withoutZero;
      const isMobile = withoutZero.startsWith('7');

      return {
        isValid: true,
        normalized,
        type: isMobile ? 'mobile' : 'landline',
        original,
        issues,
      };
    } else {
      issues.push(`UK number length invalid (found ${withoutZero.length}, expected 9-11)`);
      return {
        isValid: false,
        normalized: null,
        type: 'invalid',
        original,
        issues,
      };
    }
  }

  // Handle numbers that might be missing the leading 0
  // UK mobile numbers typically start with 7, landlines with 1, 2, 3, etc.
  if (cleaned.length >= 10 && /^[1-9]/.test(cleaned)) {
    const normalized = '+44' + cleaned;
    const isMobile = cleaned.startsWith('7');

    return {
      isValid: true,
      normalized,
      type: isMobile ? 'mobile' : 'landline',
      original,
      issues: [...issues, 'Missing leading 0, assumed UK number'],
    };
  }

  // If we get here, it's invalid
  issues.push('Unrecognized format');
  return {
    isValid: false,
    normalized: null,
    type: 'invalid',
    original,
    issues,
  };
}

/**
 * Process a phone field that might contain email or invalid data
 * Returns cleaned phone number and extracted email
 */
export function cleanPhoneField(input: string | null | undefined): {
  phone: string | null;
  email: string | null;
  validation: PhoneValidationResult;
} {
  if (!input) {
    return {
      phone: null,
      email: null,
      validation: {
        isValid: false,
        normalized: null,
        type: 'invalid',
        original: '',
        issues: ['Empty input'],
      },
    };
  }

  // First, extract any email
  const { phone: phoneOnly, email } = extractEmailFromPhone(input);

  // Then normalize the phone number
  const validation = normalizePhoneNumber(phoneOnly);

  return {
    phone: validation.normalized,
    email,
    validation,
  };
}

/**
 * Batch process multiple phone numbers
 */
export function batchCleanPhones(phones: (string | null | undefined)[]): Array<{
  index: number;
  original: string;
  phone: string | null;
  email: string | null;
  validation: PhoneValidationResult;
}> {
  return phones.map((phone, index) => {
    const result = cleanPhoneField(phone);
    return {
      index,
      original: phone || '',
      ...result,
    };
  });
}
