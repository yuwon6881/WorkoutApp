import { Fragment, useMemo } from 'react';
import { ArrowRight, Pencil } from 'lucide-react';
import type { Exercise, Template } from '../types';
import { getWorkoutMuscles } from '../lib/muscles';
import { showReps, showSetCount } from '../lib/training';
import { Button } from './ui/Button';
import './RoutineCard.css';

const LISTED_EXERCISES = 4;

/// A saved workout in the library: what it trains, what is in it, and one action to start it.
export function RoutineCard({ template, exercises, onEdit, onStart }: {
  template: Template; exercises: Exercise[]; onEdit: () => void; onStart: () => void;
}) {
  const muscles = useMemo(() => getWorkoutMuscles(template.exercises, exercises), [template.exercises, exercises]);
  const setCount = template.exercises.reduce((total, exercise) => total + exercise.sets.filter(set => !set.warmup).length, 0);
  const exerciseCount = template.exercises.length;
  const meta = [
    template.focus.trim(),
    `${exerciseCount} exercise${exerciseCount === 1 ? '' : 's'}`,
    showSetCount(setCount)
  ].filter(Boolean);
  const hidden = exerciseCount - LISTED_EXERCISES;

  return <section className="panel routine-card">
    <div className="routine-card-head">
      <div className="routine-card-title">
        <h2>{template.name}</h2>
        <p className="routine-card-meta">{meta.map((part, i) => <Fragment key={part}>{i > 0 && ' · '}<span>{part}</span></Fragment>)}</p>
      </div>
      <Button variant="tertiary" className="routine-card-edit" aria-label={`Edit ${template.name}`} onClick={onEdit}><Pencil size={17} /></Button>
    </div>
    {muscles.length > 0 && <div className="day-muscles-row" aria-label="Targeted muscles">
      {muscles.slice(0, 5).map(m => <span key={m} className="muscle-chip">{m}</span>)}
      {muscles.length > 5 && <span className="muscle-chip muscle-chip-overflow" title={muscles.slice(5).join(', ')}>+{muscles.length - 5}</span>}
    </div>}
    <ol className="routine-card-exercises">
      {template.exercises.slice(0, LISTED_EXERCISES).map(e => <li key={e.id}>
        <span>{e.name}</span>
        <small>{e.sets.length} × {showReps(e.sets[0])}</small>
      </li>)}
      {hidden > 0 && <li className="routine-card-more"><span>+{hidden} more</span></li>}
    </ol>
    <Button className="full-width routine-card-start" onClick={onStart}>Start workout<ArrowRight size={17} /></Button>
  </section>;
}
