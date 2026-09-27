/// Plain-language names for import review codes, and what the lifter can do about each. The
/// server's message stays the detailed explanation; this is the headline and the next step.

/// `read`: the pages may not have been read as printed, so the import stops and the PDF is
/// the thing to check. `source`: the document disagrees with itself and review settles it.
/// `value`: a printed value needs a look in the editor.
export type ImportIssueKind = 'read' | 'source' | 'value';

export type ImportIssueCopy = { title: string; hint: string; kind: ImportIssueKind };

const COPY: Record<string, ImportIssueCopy> = {
  program_week_gap: { kind: 'read', title: 'Weeks are missing', hint: 'Some weeks the PDF prints were not found in the read.' },
  phase_week_gap: { kind: 'read', title: 'Weeks are missing from a phase', hint: 'A phase skips weeks the PDF prints.' },
  week_day_overflow: { kind: 'read', title: 'A week has too many days', hint: 'Days from two weeks may have been read into one.' },
  printed_schedule_mismatch: { kind: 'read', title: 'The schedule does not line up', hint: 'The printed weekly schedule and the workouts read from the tables disagree.' },
  day_outside_section_weeks: { kind: 'read', title: 'A day landed in the wrong week', hint: 'A workout was read into a week its pages do not cover.' },
  day_without_exercises: { kind: 'read', title: 'A workout has no exercises', hint: 'Its table could not be read.' },
  day_exercises_trimmed: { kind: 'read', title: 'Extra exercises were removed', hint: 'More exercises were read than the page prints.' },
  exercise_sets_trimmed: { kind: 'read', title: 'Extra sets were removed', hint: 'More sets were read than the table prints.' },
  exercise_without_sets: { kind: 'read', title: 'An exercise has no sets', hint: 'Its row could not be read.' },
  exercise_not_in_source: { kind: 'read', title: 'An exercise is not on its page', hint: 'Delete it if the PDF does not list it.' },
  exercise_repeated_beyond_source: { kind: 'read', title: 'An exercise appears too often', hint: 'It was read more times than the pages print it.' },
  rpe_unread: { kind: 'value', title: 'An effort target could not be read', hint: 'Fill in or clear the RPE/RIR the PDF prints for this set.' },
  rest_unread: { kind: 'value', title: 'A rest time could not be read', hint: 'Fill in or clear the rest time the PDF prints for this set.' },
  working_set_instruction_conflict: { kind: 'source', title: 'The note and the set count disagree', hint: 'Edit the note or the number of sets so they match.' },
  effort_instruction_conflict: { kind: 'source', title: 'The effort instructions disagree', hint: 'Choose the effort you will train at and edit the note or target.' },
  rep_technique_conflict: { kind: 'source', title: 'The rep target and technique disagree', hint: 'Check the reps against the technique described in the note.' }
};

export function importIssueCopy(code: string, message: string): ImportIssueCopy {
  return COPY[code] ?? { kind: 'value', title: fallbackTitle(message), hint: 'Open the related field and check it against the PDF.' };
}

/// The first sentence of an unknown issue's message is its best headline.
function fallbackTitle(message: string): string {
  const sentence = message.split(/(?<=\.)\s/)[0]?.trim() ?? '';
  return sentence.length > 0 && sentence.length <= 90 ? sentence.replace(/\.$/, '') : 'Check this item';
}

/// Steps for an import that stopped, most useful first. A page the read doubted is checked first;
/// a re-saved copy of the PDF often reads cleanly when its text layer was the problem.
export function importFailureSteps(sourcePage: number | null | undefined): string[] {
  return [
    sourcePage ? `Open page ${sourcePage} of the PDF and check that its text can be selected and the table prints normally.` : 'Check that the PDF’s pages have selectable text and complete tables.',
    'Re-save or export the PDF (for example “Print to PDF”) and import the new copy.',
    'If the PDF itself is incomplete or inconsistent, you can still build the program by hand in the program editor.'
  ];
}
