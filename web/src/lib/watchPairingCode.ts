const CODE_LENGTH = 8;

/// The watch's pairing code as the field shows it (ABCD-EFGH), from whatever was typed or pasted.
/// Separators are dropped before the length is capped, so a code pasted with spaces or a dash keeps
/// all eight characters.
export function formatPairingCode(input: string): string {
  const characters = input.replace(/[^a-z0-9]/gi, '').toUpperCase().slice(0, CODE_LENGTH);
  return characters.length > 4 ? `${characters.slice(0, 4)}-${characters.slice(4)}` : characters;
}

export const isCompletePairingCode = (code: string): boolean =>
  code.replace(/[^a-z0-9]/gi, '').length === CODE_LENGTH;
