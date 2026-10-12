import type { DraftWorkout, Template } from '../types';
import { dayTemplateInput } from './activeSlot';

/** Keep failed and superseding edits until their revision-checked write succeeds. */
export class ProgramDayWrites {
  private templates = new Map<string, Template>();
  readonly pending = new Map<string, DraftWorkout>();
  private running: Promise<void> | null = null;
  private requests = new Map<string, { day: DraftWorkout; input: ReturnType<typeof dayTemplateInput> }>();

  constructor(private readonly save: (id: string, input: ReturnType<typeof dayTemplateInput>) => Promise<Template>,
    private readonly saved: (template: Template) => void) {}

  setTemplates(templates: Template[]) {
    this.templates = new Map(templates.map(template => [template.id, template]));
  }

  enqueue(days: DraftWorkout[]) {
    for (const day of days) this.pending.set(day.lineId, day);
  }

  flush(): Promise<void> {
    if (this.running) return this.running;
    this.running = this.drain().finally(() => { this.running = null; });
    return this.running;
  }

  private async drain() {
    while (this.pending.size > 0) {
      const [id, day] = this.pending.entries().next().value!;
      const template = this.templates.get(id);
      if (!template) throw new Error('This workout day is unavailable. Refresh the program and retry.');
      let request = this.requests.get(id);
      if (!request || request.day !== day) {
        request = { day, input: dayTemplateInput(day, template.revision) };
        this.requests.set(id, request);
      }
      const saved = await this.save(id, request.input);
      this.requests.delete(id);
      this.templates.set(id, saved);
      if (this.pending.get(id) === day) this.pending.delete(id);
      this.saved(saved);
    }
  }
}
