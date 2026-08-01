/** Shared between /api/x/verify/start and /api/x/verify/confirm. */

/** Excludes visually-ambiguous characters (0/O, 1/I/l) for a code a human retypes. */
const CODE_ALPHABET = "23456789ABCDEFGHJKMNPQRSTUVWXYZ";
const CODE_LENGTH = 7;

export function generateVerificationCode(): string {
  const bytes = new Uint8Array(CODE_LENGTH);
  crypto.getRandomValues(bytes);
  let code = "";
  for (const byte of bytes) code += CODE_ALPHABET[byte % CODE_ALPHABET.length];
  return code;
}

/** Strips a leading "@" and surrounding whitespace from user-entered handles. */
export function normalizeUsername(input: string): string {
  return input.trim().replace(/^@/, "");
}

const USERNAME_PATTERN = /^[A-Za-z0-9_]{1,15}$/;

export function isValidUsername(username: string): boolean {
  return USERNAME_PATTERN.test(username);
}
