import { expect, it, vi } from 'vitest';
import type { DraftWorkout, Template } from '../types';
import { ProgramDayWrites } from './programDayWrites';

const template = (id: string): Template => ({ id, revision: 1 } as Template);
const day = (lineId: string): DraftWorkout => ({ lineId, name: lineId, exercises: [], week: 1 } as unknown as DraftWorkout);

it('retries only unsaved days after a partial program save', async () => {
  const saved = vi.fn();
  const save = vi.fn().mockResolvedValueOnce({ ...template('a'), revision: 2 })
    .mockRejectedValueOnce(new Error('Offline')).mockResolvedValueOnce({ ...template('b'), revision: 2 });
  const writes = new ProgramDayWrites(save, saved);
  writes.setTemplates([template('a'), template('b')]);
  writes.enqueue([day('a'), day('b')]);
  await expect(writes.flush()).rejects.toThrow('Offline');
  expect([...writes.pending.keys()]).toEqual(['b']);
  await writes.flush();
  expect(save.mock.calls[2][1]).toBe(save.mock.calls[1][1]);
  expect(save.mock.calls.map(call => call[0])).toEqual(['a', 'b', 'b']);
  expect(writes.pending.size).toBe(0);
});

it('serializes an edit received during a save using the returned revision', async () => {
  let finish!: (value: Template) => void;
  const save = vi.fn().mockImplementationOnce(() => new Promise<Template>(resolve => { finish = resolve; }))
    .mockResolvedValueOnce({ ...template('a'), revision: 3 });
  const writes = new ProgramDayWrites(save, () => {});
  writes.setTemplates([template('a')]);
  writes.enqueue([day('a')]);
  const first = writes.flush();
  writes.enqueue([{ ...day('a'), name: 'Updated' }]);
  const second = writes.flush();
  finish({ ...template('a'), revision: 2 });
  await Promise.all([first, second]);
  expect(save).toHaveBeenCalledTimes(2);
  expect(save.mock.calls[1][1].revision).toBe(2);
  expect(writes.pending.size).toBe(0);
});
