/// A set prints a percentage load such as "75%", "80-85%" or "82.5-87.5% 1RM".
export const isPercentLoad = (loadText: string | null | undefined, notes?: string | null): boolean => {
  if (/percentage of top set/i.test(notes ?? '')) return false;
  const match = /^\s*(\d+(?:\.\d+)?)(?:\s*[-–]\s*(\d+(?:\.\d+)?))?\s*%\s*(?:1\s*RM)?\s*$/i.exec(loadText ?? '');
  if (!match) return false;
  const low = Number(match[1]);
  const high = match[2] ? Number(match[2]) : low;
  return low >= 10 && high <= 125 && high >= low;
};

/// Keep the printed percentage visible even when a suggested weight is already filled in.
export function percentagePrescription(loadText: string | null | undefined, notes?: string | null): string | null {
  const text = loadText?.trim();
  if (!text || !/\d\s*%/.test(text)) return null;
  if (/percentage of top set/i.test(notes ?? '') && /^\s*\d+(?:\.\d+)?(?:\s*[-–]\s*\d+(?:\.\d+)?)?\s*%\s*$/i.test(text)) {
    return `${text} of top set`;
  }
  if (isPercentLoad(text, notes) && !/1\s*rm/i.test(text)) return `${text} 1RM`;
  return text;
}
