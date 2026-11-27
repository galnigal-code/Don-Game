// Room codes: 4 letters, no I / L / O (they look like 1 / 1 / 0).
export const CODE_ALPHABET = 'ABCDEFGHJKMNPQRSTUVWXYZ';
export const CODE_LENGTH = 4;

export function generateCode(rng = Math.random) {
  let c = '';
  for (let i = 0; i < CODE_LENGTH; i++) c += CODE_ALPHABET[Math.floor(rng() * CODE_ALPHABET.length)];
  return c;
}
/** User input -> canonical code (upper case, only letters of the alphabet), or '' when it cannot be a code. */
export function normalizeCode(input) {
  const s = String(input ?? '').toUpperCase().replace(/[^A-Z]/g, '');
  return isValidCode(s) ? s : '';
}
export function isValidCode(c) {
  return typeof c === 'string' && c.length === CODE_LENGTH && [...c].every((ch) => CODE_ALPHABET.includes(ch));
}
