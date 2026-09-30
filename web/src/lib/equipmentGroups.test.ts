import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { canEnterPerSide, equipmentGroupInfo, equipmentGroups } from './equipmentGroups';

describe('equipment groups', () => {
  it('names every group the server resolves, and no others', () => {
    const source = readFileSync(new URL('../../../api/Domain/EquipmentGroups.cs', import.meta.url), 'utf8');
    const serverKeys = [...source.matchAll(/public const string \w+ = "([a-z-]+)";/g)].map(match => match[1]);
    expect([...equipmentGroups].sort()).toEqual([...serverKeys].sort());
  });

  it('offers per-side entry only where plates load both sides', () => {
    expect(equipmentGroupInfo('barbell').perSide).toBe(true);
    expect(equipmentGroupInfo('cable').perSide).toBe(false);
    expect(equipmentGroupInfo('cable').preferList).toBe(true);
  });

  it('gives machines no shared group', () => {
    expect(equipmentGroups).not.toContain('machine');
    expect(equipmentGroupInfo('barbell').label).toBe('Plate-loaded');
  });

  it('keeps weighted bodyweight and held plates in total-load entry', () => {
    expect(equipmentGroups).not.toContain('plate');
    expect(equipmentGroups).not.toContain('added-load');
    expect(canEnterPerSide({ equipment: 'Plate', loadModel: 'external' })).toBe(false);
    expect(canEnterPerSide({ equipment: 'Bodyweight', loadModel: 'full_bodyweight' })).toBe(false);
    expect(canEnterPerSide({ equipment: 'Machine', loadModel: 'full_bodyweight' })).toBe(false);
    expect(canEnterPerSide({ equipment: 'Barbell', loadModel: 'external' })).toBe(true);
    expect(canEnterPerSide({ equipment: 'Plate-Loaded Machine', loadModel: 'external' })).toBe(true);
  });
});
