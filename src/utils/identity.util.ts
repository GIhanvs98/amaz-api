/**
 * Identity Normalization Utilities
 * Generates deterministic identity keys for patients sharing contact phone numbers
 */

/**
 * Normalizes phone numbers by stripping formatting characters.
 * Ensures consistent format (e.g. "+94 77 123 4567" -> "0771234567" or standard digits)
 */
export function normalizePhone(phone: string): string {
  if (!phone) return "";
  let digits = phone.replace(/\D/g, "");
  // Standardize Sri Lankan phone numbers: replace leading 94 with 0
  if (digits.startsWith("94") && digits.length >= 11) {
    digits = "0" + digits.slice(2);
  }
  return digits;
}

/**
 * Normalizes full name by converting to lowercase, removing accents, and stripping non-alphanumerics.
 */
export function normalizeName(fullName: string): string {
  if (!fullName) return "";
  return fullName
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "") // remove diacritics
    .toLowerCase()
    .replace(/[^a-z0-9]/g, ""); // strip whitespace and punctuation
}

/**
 * Generates a unique, deterministic composite key for a patient.
 * E.g., fullName: "Kamal Gunawardena", phone: "071-234 5678" -> "kamalgunawardena_0712345678"
 */
export function generateIdentityKey(fullName: string, phone: string): string {
  const cleanName = normalizeName(fullName);
  const cleanPhone = normalizePhone(phone);
  if (!cleanName && !cleanPhone) {
    return "";
  }
  return `${cleanName}_${cleanPhone}`;
}
