import type { UnsavedExercise } from './exerciseEditScope';

/// The day's unsaved exercise edits. A Map the editors write to as they always have, that also says
/// when the number of exercises holding edits changes, so the dialog can offer to save them together.
/// Typing into an exercise that already holds edits does not announce anything.
export class UnsavedExercises extends Map<string, UnsavedExercise> {
  constructor(private readonly onCountChange: (count: number) => void) {
    super();
  }

  override set(key: string, value: UnsavedExercise): this {
    const before = this.size;
    super.set(key, value);
    if (this.size !== before) this.onCountChange(this.size);
    return this;
  }

  override delete(key: string): boolean {
    const removed = super.delete(key);
    if (removed) this.onCountChange(this.size);
    return removed;
  }

  override clear(): void {
    const had = this.size > 0;
    super.clear();
    if (had) this.onCountChange(0);
  }
}
