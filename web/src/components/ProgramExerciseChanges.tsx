import type { FinishPlanEdit } from '../lib/finishPlanContract';
import './ProgramExerciseChanges.css';

export function ProgramExerciseChanges({ edits, fallback = [] }: { edits: FinishPlanEdit[]; fallback?: string[] }) {
  return <ul className="program-exercise-changes">
    {edits.map(({ name, changes, occurrences }, index) => <li key={`${index}-${name}`}>
      <strong>{name}</strong>
      <ul>{(changes ?? fallback).map(change => <li key={change}>{change}</li>)}</ul>
      {occurrences != null && <small>{occurrences} {occurrences === 1 ? 'occurrence' : 'occurrences'} updated</small>}
    </li>)}
  </ul>;
}
