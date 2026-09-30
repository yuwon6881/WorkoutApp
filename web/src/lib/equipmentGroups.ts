// Mirrors api/Domain/EquipmentGroups.cs. The server decides which group an exercise belongs to;
// the app only names the groups and chooses the most helpful way to enter each one's weights.
export type EquipmentGroup =
  | 'barbell' | 'dumbbell' | 'cable' | 'machine' | 'plate-loaded-machine' | 'weight-stack-machine'
  | 'smith-machine' | 'ez-bar' | 'trap-bar' | 'kettlebell' | 'plate' | 'medicine-ball' | 'added-load';

type GroupInfo = { label: string; hint: string; perSide: boolean; preferList: boolean };

const groups: Record<EquipmentGroup, GroupInfo> = {
  barbell: { label: 'Barbell', hint: 'Total bar load; enter the smallest plate per side if easier.', perSide: true, preferList: false },
  dumbbell: { label: 'Dumbbell', hint: 'The weight of one dumbbell.', perSide: false, preferList: true },
  cable: { label: 'Cable', hint: 'The pin weights on the stack.', perSide: false, preferList: true },
  machine: { label: 'Machine', hint: 'Machines not marked plate-loaded or weight-stack.', perSide: false, preferList: false },
  'plate-loaded-machine': { label: 'Plate-loaded machine', hint: 'Total plates loaded.', perSide: true, preferList: false },
  'weight-stack-machine': { label: 'Weight-stack machine', hint: 'The pin weights on the stack.', perSide: false, preferList: true },
  'smith-machine': { label: 'Smith machine', hint: 'Total bar load.', perSide: true, preferList: false },
  'ez-bar': { label: 'EZ-bar', hint: 'Total bar load.', perSide: true, preferList: false },
  'trap-bar': { label: 'Trap bar', hint: 'Total bar load.', perSide: true, preferList: false },
  kettlebell: { label: 'Kettlebell', hint: 'The kettlebells you have.', perSide: false, preferList: true },
  plate: { label: 'Plate', hint: 'Plate-held movements.', perSide: false, preferList: true },
  'medicine-ball': { label: 'Medicine ball', hint: 'The balls you have.', perSide: false, preferList: true },
  'added-load': { label: 'Added load', hint: 'Weight added to, or assistance taken off, bodyweight moves.', perSide: false, preferList: false }
};

export const equipmentGroups = Object.keys(groups) as EquipmentGroup[];

export const equipmentGroupInfo = (group: string): GroupInfo =>
  groups[group as EquipmentGroup] ?? { label: group, hint: '', perSide: false, preferList: false };
