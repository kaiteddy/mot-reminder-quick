import { describe, expect, it } from "vitest";
import { 
  normalizePhoneNumber, 
  extractEmailFromPhone, 
  cleanPhoneField 
} from "./phoneUtils";

describe("extractEmailFromPhone", () => {
  it("extracts email and phone from mixed field", () => {
    const result = extractEmailFromPhone("hava@veredflowers.com/07973873113");
    expect(result.email).toBe("hava@veredflowers.com");
    expect(result.phone).toBe("07973873113");
  });

  it("extracts email with different separators", () => {
    const result = extractEmailFromPhone("test@example.com - 07123456789");
    expect(result.email).toBe("test@example.com");
    expect(result.phone).toBe("07123456789");
  });

  it("returns just phone when no email present", () => {
    const result = extractEmailFromPhone("07123456789");
    expect(result.email).toBeNull();
    expect(result.phone).toBe("07123456789");
  });

  it("handles null input", () => {
    const result = extractEmailFromPhone("");
    expect(result.email).toBeNull();
    expect(result.phone).toBeNull();
  });
});

describe("normalizePhoneNumber", () => {
  it("normalizes UK mobile number with leading 0", () => {
    const result = normalizePhoneNumber("07123456789");
    expect(result.isValid).toBe(true);
    expect(result.normalized).toBe("+447123456789");
    expect(result.type).toBe("mobile");
  });

  it("normalizes UK landline with leading 0", () => {
    const result = normalizePhoneNumber("02012345678");
    expect(result.isValid).toBe(true);
    expect(result.normalized).toBe("+442012345678");
    expect(result.type).toBe("landline");
  });

  it("handles phone with spaces and dashes", () => {
    const result = normalizePhoneNumber("07123-456-789");
    expect(result.isValid).toBe(true);
    expect(result.normalized).toBe("+447123456789");
  });

  it("handles phone with parentheses", () => {
    const result = normalizePhoneNumber("(01494)437081");
    expect(result.isValid).toBe(true);
    expect(result.normalized).toBe("+441494437081");
  });

  it("handles international format with +", () => {
    const result = normalizePhoneNumber("+447123456789");
    expect(result.isValid).toBe(true);
    expect(result.normalized).toBe("+447123456789");
    expect(result.type).toBe("mobile");
  });

  it("handles international format with 00 prefix", () => {
    const result = normalizePhoneNumber("00447123456789");
    expect(result.isValid).toBe(true);
    expect(result.normalized).toBe("+447123456789");
  });

  it("handles non-UK international numbers", () => {
    const result = normalizePhoneNumber("+35361446033");
    expect(result.isValid).toBe(true);
    expect(result.normalized).toBe("+35361446033");
    expect(result.type).toBe("international");
  });

  it("rejects invalid single digit", () => {
    const result = normalizePhoneNumber("0");
    expect(result.isValid).toBe(false);
    expect(result.normalized).toBeNull();
  });

  it("rejects number starting with slash", () => {
    const result = normalizePhoneNumber("/82027625");
    expect(result.isValid).toBe(false);
    expect(result.issues).toContain("Starts with invalid character");
  });

  it("rejects too short numbers", () => {
    const result = normalizePhoneNumber("0712");
    expect(result.isValid).toBe(false);
    expect(result.issues).toContain("Too short or placeholder value");
  });

  it("handles null input", () => {
    const result = normalizePhoneNumber(null);
    expect(result.isValid).toBe(false);
    expect(result.normalized).toBeNull();
  });

  it("handles undefined input", () => {
    const result = normalizePhoneNumber(undefined);
    expect(result.isValid).toBe(false);
    expect(result.normalized).toBeNull();
  });
});

describe("cleanPhoneField", () => {
  it("cleans phone with mixed email", () => {
    const result = cleanPhoneField("test@example.com/07123456789");
    expect(result.phone).toBe("+447123456789");
    expect(result.email).toBe("test@example.com");
    expect(result.validation.isValid).toBe(true);
  });

  it("cleans valid UK mobile", () => {
    const result = cleanPhoneField("07123456789");
    expect(result.phone).toBe("+447123456789");
    expect(result.email).toBeNull();
    expect(result.validation.isValid).toBe(true);
  });

  it("returns null for invalid phone", () => {
    const result = cleanPhoneField("0");
    expect(result.phone).toBeNull();
    expect(result.email).toBeNull();
    expect(result.validation.isValid).toBe(false);
  });

  it("handles phone with dashes", () => {
    const result = cleanPhoneField("0-7447666013");
    expect(result.phone).toBe("+447447666013");
    expect(result.validation.isValid).toBe(true);
  });

  it("handles landline with area code in parentheses", () => {
    const result = cleanPhoneField("(01494)437081");
    expect(result.phone).toBe("+441494437081");
    expect(result.validation.type).toBe("landline");
  });
});
