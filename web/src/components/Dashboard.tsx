import { useState } from 'react';
import { ArrowDownLeft, ArrowRight, Check, ChevronLeft, ChevronRight, Dumbbell, FileText, Flame, Play, Target, TrendingUp } from 'lucide-react';
import type { Bootstrap, Session } from '../types';
import { duration, localDate, showVolume, weekDays } from '../lib/training';
import { Button } from './ui/Button';

export function Dashboard({ data, onStart, onHistory, onProgram, onImport, onSession, onResume }: {
  data: Bootstrap; onStart: (templateId: string) => void; onHistory: () => void; onProgram: () => void;
  onImport: () => void; onSession: (s: Session) => void; onResume: () => void;
}) {
  const [offset, setOffset] = useState(0);
  const days = weekDays(offset);
  const week = weekDays();
  const unit = data.preferences.unit;
  const history = data.history.sessions;
  const weekly = history.filter(s => {
    const at = Date.parse(s.startedAt);
    return at >= week[0].getTime() && at < week[6].getTime() + 86400000;
  });

  const program = data.activeProgram;
  const next = program?.days.find(w => w.id === program.nextTemplateId) ?? data.templates[0] ?? null;
  const nextName = next ? next.name : null;
  const nextFocus = next && 'focus' in next ? next.focus : null;
  const nextWeek = next?.week ?? 1;
  const nextExerciseCount = next && 'exerciseCount' in next ? next.exerciseCount : next?.exercises.length ?? 0;
  const nextSets = next && 'exerciseCount' in next ? null : next?.exercises.reduce((total, e) => total + e.sets.filter(s => !s.warmup).length, 0) ?? 0;
  const weeklyVolume = weekly.some(s => s.volumeKg !== null) ? weekly.reduce((total, s) => total + (s.volumeKg ?? 0), 0) : null;

  return <>
    <div className="page-heading">
      <div><div className="eyebrow">YOUR TRAINING, MOVING FORWARD</div><h1>Let’s get stronger<span className="accent">.</span></h1><p>Show up. Put in the work. See your progress.</p></div>
      <span className="date-label">{new Date().toLocaleDateString('en', { month: 'long', day: 'numeric', year: 'numeric' })}</span>
    </div>

    <section className="week-strip" aria-label="Training calendar">
      <div className="week-caption">
        <span><span className="status-dot" /> {offset === 0 ? 'This week' : days[0].toLocaleDateString('en', { month: 'short', day: 'numeric' })}</span>
        <div>
          <Button aria-label="Previous week" variant="tertiary" onClick={() => setOffset(o => o - 1)}><ChevronLeft size={17} /></Button>
          <Button aria-label="Next week" variant="tertiary" disabled={offset === 0} onClick={() => setOffset(o => o + 1)}><ChevronRight size={17} /></Button>
        </div>
      </div>
      <div className="week-days">{days.map(day => {
        const logged = history.some(s => localDate(s.startedAt) === localDate(day));
        const today = localDate(day) === localDate(Date.now());
        return <div key={day.toISOString()} className={`day ${today ? 'today' : ''}`} aria-label={`${day.toDateString()}${logged ? ', workout completed' : ''}${today ? ', today' : ''}`}>
          <span>{day.toLocaleDateString('en', { weekday: 'short' })}</span><strong>{day.getDate()}</strong>
          <span className="day-marker">{logged ? <Check size={12} /> : today ? <span className="status-dot" /> : '·'}</span>
        </div>;
      })}</div>
    </section>

    <div className="dashboard-grid">
      <div className="main-column">
        <section className="next-workout">
          <div className="hero-top">
            <span className="eyebrow"><span className="status-dot" /> {data.activeWorkout ? 'WORKOUT IN PROGRESS' : next ? 'UP NEXT' : 'GETTING STARTED'}</span>
            <span className="pill">{data.activeWorkout?.exercises.length ?? nextExerciseCount} exercises</span>
          </div>
          <div className="hero-content">
            <div>
              <h2>{data.activeWorkout?.name ?? nextName ?? 'Your next chapter'}</h2>
              <p>{data.activeWorkout ? 'In progress · pick up where you left off' : program ? `${program.name} · week ${nextWeek}` : next ? nextFocus : 'Import a program from a PDF, or build a workout by hand.'}</p>
              <div className="hero-facts">
                <span><Dumbbell size={15} />{data.activeWorkout ? data.activeWorkout.exercises.reduce((total, e) => total + e.sets.filter(s => !s.warmup).length, 0) : nextSets ?? nextExerciseCount} working sets</span>
                <span><Target size={15} />Build strength</span>
              </div>
            </div>
            <div className="hero-art" aria-hidden="true"><div className="orbit orbit-one" /><div className="orbit orbit-two" /><Dumbbell strokeWidth={1.1} /><span className="art-spark">+</span></div>
          </div>
          <div className="hero-bottom">
            <span>One set closer to your goals.</span>
            {data.activeWorkout
              ? <Button variant="primary" onClick={onResume}><Play size={17} fill="currentColor" />Resume workout<ArrowRight size={18} /></Button>
              : next
                ? <Button variant="primary" onClick={() => onStart(next.id)}><Play size={17} fill="currentColor" />Start workout<ArrowRight size={18} /></Button>
                : <Button variant="primary" onClick={onImport}><FileText size={17} />Import a program<ArrowRight size={18} /></Button>}
          </div>
        </section>

        <section>
          <div className="section-heading"><h2>Your training week</h2><span className="muted">Monday – Sunday</span></div>
          <div className="stats-grid">
            <div className="stat-card"><div className="stat-label"><Dumbbell size={17} /> Workouts</div><strong>{weekly.length}</strong><span className="muted">Completed this week</span>
              <div className="mini-progress">{[0, 1, 2, 3].map(i => <span key={i} className={i < weekly.length ? 'filled' : ''} />)}</div></div>
            <div className="stat-card"><div className="stat-label"><TrendingUp size={17} /> Total volume</div><strong>{showVolume(weeklyVolume, unit)}</strong><span className="muted">Across recorded loads</span></div>
            <div className="stat-card"><div className="stat-label"><Flame size={17} /> Working sets</div><strong>{weekly.reduce((total, s) => total + s.completedSets, 0)}<small> sets</small></strong><span className="muted">Every rep adds up</span></div>
          </div>
        </section>

        <section className="panel recent-panel">
          <div className="section-heading"><h2>Recent workouts</h2><Button variant="tertiary" onClick={onHistory}>View all <ArrowRight size={16} /></Button></div>
          {history.length ? history.slice(0, 3).map(session => <Button className="history-row" variant="tertiary" key={session.id} onClick={() => onSession(session)}>
            <span className="exercise-icon"><Dumbbell size={19} /></span>
            <span className="row-title"><strong>{session.name}</strong>
              <small>{new Date(session.startedAt).toLocaleDateString('en', { month: 'short', day: 'numeric' })} · {duration(session)} min · {session.completedSets} sets</small></span>
            <span>{showVolume(session.volumeKg, unit)}</span><ArrowRight size={16} />
          </Button>) : <div className="empty-inline">
            <span className="exercise-icon"><Dumbbell size={22} /></span>
            <div><h3>Your first workout starts the story</h3><p>Completed sessions and personal bests will show up here.</p></div>
            <ArrowDownLeft size={23} className="muted" />
          </div>}
        </section>
      </div>

      <aside className="side-column">
        <section className="panel program-card">
          <div className="section-heading"><h2>Your program</h2>{program && <span className="tiny-label">{program.weeks} WEEK{program.weeks === 1 ? '' : 'S'}</span>}</div>
          {program ? <>
            <div className="program-title"><span className="program-icon"><Dumbbell size={25} /></span><div><h3>{program.name}</h3>
              <p>{program.completedTemplateIds.length} of {program.days.length} workouts complete</p></div></div>
            <div className="routine-list">{program.days.slice(0, 5).map(workout => <Button variant="tertiary" disabled={workout.isRestDay}
              className={`routine-row ${workout.id === program.nextTemplateId ? 'next' : ''}`} key={workout.id} onClick={() => onStart(workout.id)}>
              <span className="routine-number">W{workout.phaseWeek}</span><span>{workout.name}</span>
              {workout.isRestDay ? <span className="tiny-label">REST DAY</span> : program.completedTemplateIds.includes(workout.id) ? <Check size={14} /> : workout.id === program.nextTemplateId ? <span className="tiny-label accent">UP NEXT</span> : <ChevronRight size={14} />}
            </Button>)}</div>
          </> : <div className="empty-inline"><span className="exercise-icon"><FileText size={20} /></span>
            <div><h3>No active program</h3><p>Import a training PDF and review it before it becomes a program.</p></div></div>}
          <Button className="full-width" onClick={onProgram}>Manage workouts <ArrowRight size={16} /></Button>
        </section>

        <section className="panel muscle-card">
          <div className="section-heading"><h2>Exercise library</h2><span className="tiny-label">{data.exercises.length} MOVEMENTS</span></div>
          {data.exercises.length
            ? <p>Your workouts can draw on {data.exercises.length} exercises, each with its own technique cue.</p>
            : <p>The shared library has not been loaded yet. Imported programs will keep their exercise names and wait to be mapped once it is.</p>}
          <div className="tip"><span><FileText size={15} /></span><p>{data.aiImportsRemaining} AI imports left today.</p></div>
        </section>
      </aside>
    </div>
  </>;
}
