/// Plain-language names for import review codes, and what the lifter can do about each. The
/// server's message stays the detailed explanation; this is the headline and the next step.

export type ImportIssueCopy = { title: string; hint: string };

const COPY: Record<string, ImportIssueCopy> = {
  program_week_gap: { title: 'Weeks are missing', hint: 'Some weeks the source document describes have no days in the draft.' },
  phase_week_gap: { title: 'Weeks are missing from a phase', hint: 'A phase skips weeks the source document describes.' },
  week_day_overflow: { title: 'A week has too many days', hint: 'Days from two weeks may have been placed in one.' },
  day_without_exercises: { title: 'A workout has no exercises', hint: 'Add its exercises, or delete the day.' },
  exercise_without_sets: { title: 'An exercise has no sets', hint: 'Add its sets, or delete the exercise.' },
  working_set_instruction_conflict: { title: 'The note and the set count disagree', hint: 'Edit the note or the number of sets so they match.' },
  effort_instruction_conflict: { title: 'The effort instructions disagree', hint: 'Choose the effort you will train at and edit the note or target.' },
  rep_technique_conflict: { title: 'The rep target and technique disagree', hint: 'Check the reps against the technique described in the note.' }
};

export function importIssueCopy(code: string, message: string): ImportIssueCopy {
  return COPY[code] ?? { title: fallbackTitle(message), hint: 'Open the related field and check it against your source document.' };
}

/// The first sentence of an unknown issue's message is its best headline.
function fallbackTitle(message: string): string {
  const sentence = message.split(/(?<=\.)\s/)[0]?.trim() ?? '';
  return sentence.length > 0 && sentence.length <= 90 ? sentence.replace(/\.$/, '') : 'Check this item';
}
