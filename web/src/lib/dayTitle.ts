/// The title to show beside a day's slot label. PDFs often print the slot inside the title
/// ("DAY 1 LOWER FOCUSED FULL BODY" in slot 1), which would read "Day 1 · Day 1 Lower…". The
/// repeated number is dropped for display only; the stored name stays as printed. A title numbered
/// differently from its slot keeps its number, because it says something the slot does not.
export function dayTitle(name: string | null | undefined, slot: number): string {
  const trimmed = name?.trim() ?? '';
  const match = /^day\s*(\d+)\s*(?:[:.\-–—·|]\s*)?(.*)$/i.exec(trimmed);
  if (!match || Number(match[1]) !== slot) return trimmed;
  return match[2].trim();
}

/// A title with nothing beyond a day number carries no name of its own.
export function isGenericDayTitle(title: string): boolean {
  return title.length === 0 || /^day\s*\d+$/i.test(title);
}
