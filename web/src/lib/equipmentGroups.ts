// Mirrors api/Domain/EquipmentGroups.cs. The server decides which group an exercise belongs to;
// the app only names the groups and chooses the most helpful way to enter each one's weights.
import type { Exercise } from '../types';
export type EquipmentGroup =
  | 'barbell' | 'dumbbell' | 'cable' | 'kettlebell' | 'medicine-ball';

type GroupInfo = { label: string; hint: string; perSide: boolean; preferList: boolean };

const groups: Record<EquipmentGroup, GroupInfo> = {
  // One set of plates serves barbells, EZ-bars, trap bars, Smith machines and plate-loaded machines.
  // Weight-stack machines have no group: each machine's stack differs, so they are set per exercise.
  barbell: { label: 'Plate-loaded', hint: 'Bars, plate-loaded machines, plate-held exercises and weighted bodyweight moves. Use the total change, or per side when loading both sides.', perSide: true, preferList: false },
  dumbbell: { label: 'Dumbbell', hint: 'The weight of one dumbbell.', perSide: false, preferList: true },
  cable: { label: 'Cable', hint: 'The pin weights on the stack.', perSide: false, preferList: true },
  kettlebell: { label: 'Kettlebell', hint: 'The kettlebells you have.', perSide: false, preferList: true },
  'medicine-ball': { label: 'Medicine ball', hint: 'The balls you have.', perSide: false, preferList: true }
};

export const equipmentGroups = Object.keys(groups) as EquipmentGroup[];

export const equipmentGroupInfo = (group: string): GroupInfo =>
  groups[group as EquipmentGroup] ?? { label: group, hint: '', perSide: false, preferList: false };

// Sharing plate defaults does not make a held plate or a dip belt a two-sided load.
export function canEnterPerSide(exercise: Pick<Exercise, 'equipment' | 'loadModel'>): boolean {
  return exercise.loadModel !== 'full_bodyweight'
    && ['barbell', 'ez-bar', 'trap bar', 'smith machine', 'plate-loaded machine']
      .includes(exercise.equipment.trim().toLowerCase());
}
