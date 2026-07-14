/** Normalize a US/NANP phone to +1XXXXXXXXXX for storage. One character of formatting
 * ("8436977747" vs "+18436977747") once minted a duplicate deal for a merchant already
 * at Application Sent — phone IDENTITY is the digits, so every write site stores one
 * canonical form. Unparseable input passes through untouched (never destroy what a
 * human typed). */
export function normalizePhoneForStorage(raw: string): string {
  const digits = raw.replace(/\D/g, "");
  if (digits.length === 10) return `+1${digits}`;
  if (digits.length === 11 && digits.startsWith("1")) return `+${digits}`;
  return raw.trim();
}
