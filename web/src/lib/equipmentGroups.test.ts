import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { equipmentGroupInfo, equipmentGroups } from './equipmentGroups';

describe('equipment groups', () => {
  it('names every group the server resolves, and no others', () => {
    const source = readFileSync(new URL('../../../api/Domain/EquipmentGroups.cs', import.meta.url), 'utf8');
    const serverKeys = [...source.matchAll(/public const string \w+ = "([a-z-]+)";/g)].map(match => match[1]);
    expect([...equipmentGroups].sort()).toEqual([...serverKeys].sort());
  });

  it('offers per-side entry only where plates load both sides', () => {
    expect(equipmentGroupInfo('barbell').perSide).toBe(true);
    expect(equipmentGroupInfo('plate-loaded-machine').perSide).toBe(true);
    expect(equipmentGroupInfo('cable').perSide).toBe(false);
    expect(equipmentGroupInfo('weight-stack-machine').preferList).toBe(true);
  });
});
