/// Caps a program name to `max` characters (default 36), appending an ellipsis ('…')
/// if the name exceeds `max`. Blank, null, or undefined names return an empty string.
export function capProgramName(name: string | null | undefined, max = 36): string {
  if (!name) return '';
  const trimmed = name.trim();
  if (trimmed.length <= max) return trimmed;
  return `${trimmed.slice(0, max)}…`;
}
