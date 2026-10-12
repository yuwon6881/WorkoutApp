import { expect, it } from 'vitest';
import type { Bootstrap, Template } from '../types';
import { acknowledgeTemplate } from './templateAcknowledgement';

it('preserves the active standalone assignment after an unrelated library save', () => {
  const library = { id: 'library', week: 1, position: 0, exercises: [] } as unknown as Template;
  const active = { ...library, id: 'active', position: 1, active: true };
  const data = { templates: [library, active], activeProgram: null, nextWorkout: active } as unknown as Bootstrap;
  expect(acknowledgeTemplate(data, library.id, { ...library, name: 'Edited' }).nextWorkout?.id).toBe(active.id);
});

it('keeps a completed active standalone from falling back to a library routine', () => {
  const library = { id: 'library', week: 1, position: 0, exercises: [] } as unknown as Template;
  const active = { ...library, id: 'active', active: true, activeCompletedAt: '2026-10-12T00:00:00Z' };
  const data = { templates: [library, active], activeProgram: null, nextWorkout: null } as unknown as Bootstrap;
  expect(acknowledgeTemplate(data, library.id, library).nextWorkout).toBeNull();
});

it('publishes the authoritative saved routine and next action without replacing history or catalog', () => {
  const original = { id: 'first', week: 1, position: 0, name: 'Before', revision: 1, exercises: [] } as unknown as Template;
  const second = { ...original, id: 'second' };
  const data = { templates: [original, second], activeProgram: null, history: {}, exercises: [],
    navigationCounts: { templates: 2, programs: 0 } } as unknown as Bootstrap;
  const saved = { ...original, name: 'Server name', revision: 2 };
  const result = acknowledgeTemplate(data, saved.id, saved);
  expect(result.templates).toEqual([saved, second]);
  expect(result.nextWorkout?.name).toBe('Server name');
  expect(result.history).toBe(data.history);
  expect(result.exercises).toBe(data.exercises);
  const empty = acknowledgeTemplate(acknowledgeTemplate(result, saved.id, null), second.id, null);
  expect(empty.nextWorkout).toBeNull();
  expect(empty.navigationCounts?.templates).toBe(0);
});
