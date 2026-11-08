/// Pure helpers for the AI-assisted import: checks that can be made before a file leaves the
/// device, how a rejection is described, and the text a user pastes back to the assistant.

/// Must match the server's request cap (`ExternalImportEnvelope.MaxBytes`); the server still
/// enforces it, this only avoids sending a file that is certain to be refused.
export const MAX_EXTERNAL_IMPORT_BYTES = 8 * 1024 * 1024;

export type ExternalImportFieldError = { path: string; message: string };

export type ExternalImportPrompt = { version: string; prompt: string };

/// The size rules shared by a chosen file and pasted text.
function checkSize(size: number, what: string): string | null {
  if (size === 0) return `That ${what} is empty. Ask your AI assistant to produce the JSON again.`;
  if (size > MAX_EXTERNAL_IMPORT_BYTES) return `That ${what} is larger than 8 MB. Ask your AI assistant to split the program or drop unneeded text.`;
  return null;
}

/// Returns what is wrong with the chosen file, or null when it may be sent.
export function checkExternalImportFile(file: { name: string; size: number }): string | null {
  if (!/\.json$/i.test(file.name)) return 'Choose the JSON file your AI assistant produced (a file ending in .json).';
  return checkSize(file.size, 'file');
}

/// Returns what is wrong with pasted JSON text, or null when it may be sent.
export function checkExternalImportText(text: string): string | null {
  return checkSize(text.trim() === '' ? 0 : new TextEncoder().encode(text).length, 'text');
}

/// Keeps only well-formed entries from an untrusted error payload.
export function readFieldErrors(payload: unknown): ExternalImportFieldError[] {
  if (!payload || typeof payload !== 'object' || !('errors' in payload) || !Array.isArray(payload.errors)) return [];
  return payload.errors.flatMap((item: unknown) => {
    if (!item || typeof item !== 'object') return [];
    const { path, message } = item as Record<string, unknown>;
    return typeof path === 'string' && typeof message === 'string' ? [{ path, message }] : [];
  });
}

/// A problem about the file as a whole (not valid JSON, wrong version) has no field to point at.
const isWholeFile = (path: string) => path === '' || path === '$';

export type FailureView = {
  /// The one sentence shown first.
  headline: string;
  /// Problems that name a field; empty when the headline already says everything.
  items: ExternalImportFieldError[];
};

/// How a rejection is shown: a single whole-file problem is just its sentence, anything else is a
/// short headline over the list of located problems.
export function describeFailure(failure: { message: string; errors: readonly ExternalImportFieldError[] }): FailureView {
  const { errors } = failure;
  if (errors.length === 0) return { headline: failure.message, items: [] };
  if (errors.length === 1 && isWholeFile(errors[0].path)) return { headline: errors[0].message, items: [] };
  const count = errors.length === 1 ? 'one change' : `${errors.length} changes`;
  return { headline: `That file needs ${count} before it can be imported.`, items: [...errors] };
}

/// Where the server says a file stops being JSON, shown from the user's own text. It is worked out on this
/// device from text the user already has, and only the one line is displayed.
export type ParseExcerpt = { line: number; column: number; snippet: string; caret: number };

const EXCERPT_WIDTH = 100;
const LINE_BREAK = /\r\n|\n|\r/;

/// Finds the line a "near line N, column M" message points at. The server counts the column in UTF-8
/// bytes, so the line is walked the same way. Returns null when the message names no position or the text
/// has no such line.
export function locateParseError(message: string, text: string): ParseExcerpt | null {
  const match = /near line (\d+), column (\d+)/.exec(message);
  if (!match) return null;
  const line = Number(match[1]);
  const column = Number(match[2]);
  const source = text.replace(/^﻿/, '').split(LINE_BREAK)[line - 1];
  if (source === undefined) return null;
  const encoder = new TextEncoder();
  let index = 0;
  for (let bytes = 0; index < source.length && bytes < column - 1; index++) bytes += encoder.encode(source[index]).length;
  const start = Math.max(0, index - EXCERPT_WIDTH / 2);
  const end = Math.min(source.length, start + EXCERPT_WIDTH);
  const lead = start > 0 ? '…' : '';
  const snippet = lead + source.slice(start, end) + (end < source.length ? '…' : '');
  return { line, column, snippet, caret: lead.length + (index - start) };
}

/// A paste-ready request for the assistant. It names every problem with its location and asks for
/// the whole corrected file, so the user never has to explain the format themselves.
export function correctionRequest(errors: readonly ExternalImportFieldError[], promptVersion?: string, excerpt?: ParseExcerpt | null): string {
  const lines = errors.map((error, index) => `${index + 1}. ${isWholeFile(error.path) ? 'The whole file' : error.path} - ${error.message}`);
  return [
    'WorkoutApp could not import the JSON file you gave me. Please fix these problems against the original document and send the complete corrected JSON file again (not just the changed parts)'
      + (promptVersion ? `, still following the ${promptVersion} format instructions.` : '.'),
    '',
    ...lines,
    ...(excerpt ? ['', `The problem is near line ${excerpt.line}, column ${excerpt.column}, which reads: ${excerpt.snippet}`] : []),
    '',
    'If a value is not in the document, leave it out or mark it uncertain instead of guessing.'
  ].join('\n');
}
