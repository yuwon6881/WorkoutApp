// Mirrors api/Domain/EquipmentGroups.cs. The server decides which group an exercise belongs to;
// the app only names the groups and chooses the most helpful way to enter each one's weights.
export type EquipmentGroup =
  | 'barbell' | 'dumbbell' | 'cable' | 'kettlebell' | 'plate' | 'medicine-ball' | 'added-load';

type GroupInfo = { label: string; hint: string; perSide: boolean; preferList: boolean };

const groups: Record<EquipmentGroup, GroupInfo> = {
  // One set of plates serves barbells, EZ-bars, trap bars, Smith machines and plate-loaded machines.
  // Weight-stack machines have no group: each machine's stack differs, so they are set per exercise.
  barbell: { label: 'Plate-loaded', hint: 'Barbells, EZ-bars, trap bars, Smith machines and plate-loaded machines. Enter the smallest plate you add per side.', perSide: true, preferList: false },
  dumbbell: { label: 'Dumbbell', hint: 'The weight of one dumbbell.', perSide: false, preferList: true },
  cable: { label: 'Cable', hint: 'The pin weights on the stack.', perSide: false, preferList: true },
  kettlebell: { label: 'Kettlebell', hint: 'The kettlebells you have.', perSide: false, preferList: true },
  plate: { label: 'Plate', hint: 'Plate-held movements.', perSide: false, preferList: true },
  'medicine-ball': { label: 'Medicine ball', hint: 'The balls you have.', perSide: false, preferList: true },
  'added-load': { label: 'Added load', hint: 'Weight added to, or assistance taken off, bodyweight moves.', perSide: false, preferList: false }
};

export const equipmentGroups = Object.keys(groups) as EquipmentGroup[];

export const equipmentGroupInfo = (group: string): GroupInfo =>
  groups[group as EquipmentGroup] ?? { label: group, hint: '', perSide: false, preferList: false };
