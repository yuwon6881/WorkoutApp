// Typed numbers in the logger accept a comma or a point as the decimal mark, because Android
// keyboards in many locales offer only a comma. A value still being typed ("62." or "") is not
// an error; it simply has no number yet.

export type ParsedNumber = { value: number | null; complete: boolean };

export function parseTypedNumber(text: string, { decimals }: { decimals: number }): ParsedNumber | null {
  const trimmed = text.trim().replace(',', '.');
  if (trimmed === '') return { value: null, complete: true };
  const pattern = decimals > 0 ? /^\d{0,5}(?:\.\d*)?$/ : /^\d{0,5}$/;
  if (!pattern.test(trimmed) || trimmed === '.') return trimmed === '.' ? { value: null, complete: false } : null;
  const value = Number(trimmed);
  if (!Number.isFinite(value)) return null;
  const places = trimmed.split('.')[1]?.length ?? 0;
  if (places > decimals) return null;
  return { value, complete: !trimmed.endsWith('.') };
}

export function formatTypedNumber(value: number | null, decimals: number): string {
  if (value === null) return '';
  const rounded = Number(value.toFixed(decimals));
  return String(rounded);
}
