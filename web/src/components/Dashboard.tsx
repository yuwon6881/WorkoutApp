import { useEffect, useState } from 'react';
import { ArrowRight, Check, ChevronLeft, ChevronRight, Dumbbell, FileText, Play } from 'lucide-react';
import type { Bootstrap, Session, WorkoutTrainingSummary } from '../types';
import { api } from '../lib/api';
import { localDate, weekDays } from '../lib/training';
import { Button } from './ui/Button';
import { Modal } from './ui/Modal';

export function Dashboard({ data, onStart, onProgram, onImport, onResume, onSession }: {
  data: Bootstrap; onStart: (templateId: string) => void; onHistory: () => void; onProgram: () => void;
  onImport: () => void; onSession: (s: Session) => void; onResume: () => void;
}) {
  const [offset, setOffset] = useState(0);
  const days = weekDays(offset);
  const history = data.history.sessions;
  const [calendar, setCalendar] = useState<WorkoutTrainingSummary[]>([]);
  const [calendarError, setCalendarError] = useState('');
  const [selectedDay, setSelectedDay] = useState<Date | null>(null);
  const [selectedDayError, setSelectedDayError] = useState('');
  const localDay = (day: Date) => `${day.getFullYear()}-${String(day.getMonth() + 1).padStart(2, '0')}-${String(day.getDate()).padStart(2, '0')}`;

  useEffect(() => {
    const from = localDay(days[0]); const to = localDay(days[6]);
    const controller = new AbortController();
    api.schedule(from, to, controller.signal).then(next => { setCalendar(next); setCalendarError(''); }).catch(() => { if (!controller.signal.aborted) setCalendarError('Calendar could not be refreshed.'); });
    return () => controller.abort();
  }, [offset]);

  const program = data.activeProgram;
  const next = program?.days.find(w => w.id === program.nextTemplateId) ?? data.templates[0] ?? null;
  const nextName = next ? next.name : null;
  const nextFocus = next && 'focus' in next ? next.focus : null;
  const nextWeek = next?.week ?? 1;
  const nextExerciseCount = next && 'exerciseCount' in next ? next.exerciseCount : next?.exercises.length ?? 0;
  const nextSets = next && 'exerciseCount' in next ? null : next?.exercises.reduce((total, e) => total + e.sets.filter(s => !s.warmup).length, 0) ?? 0;
  return <>
    <div className="page-heading">
      <h1>Overview</h1>
      <span className="date-label">{new Date().toLocaleDateString('en', { month: 'long', day: 'numeric', year: 'numeric' })}</span>
    </div>

    <section className="week-strip" aria-label="Training calendar">
      <div className="week-caption">
        <span><span className="status-dot" /> {offset === 0 ? 'This week' : days[0].toLocaleDateString('en', { month: 'short', day: 'numeric' })}</span>
        <div>
          <Button aria-label="Previous week" variant="tertiary" onClick={() => setOffset(o => o - 1)}><ChevronLeft size={17} /></Button>
          {offset !== 0 && <Button aria-label="Return to this week" variant="tertiary" onClick={() => setOffset(0)}>Today</Button>}
          <Button aria-label="Next week" variant="tertiary" onClick={() => setOffset(o => o + 1)}><ChevronRight size={17} /></Button>
        </div>
      </div>
      <div className="week-days">{days.map(day => {
        const entries = calendar.filter(item => item.localDate === localDay(day));
        const fallbackLogged = history.some(s => localDate(s.startedAt) === localDate(day));
        const status = entries.some(e => e.status === 'in_progress') ? 'in_progress' : entries.some(e => e.status === 'completed' || e.status === 'completed_early' || e.status === 'completed_late') ? (entries.some(e => e.status === 'completed_early' || e.status === 'completed_late') ? 'completed_shifted' : 'completed') : entries.some(e => e.status === 'missed') ? 'missed' : entries.some(e => e.status === 'skipped') ? 'skipped' : entries.some(e => e.status === 'scheduled') ? 'scheduled' : fallbackLogged ? 'completed' : 'rest';
        const today = localDate(day) === localDate(Date.now());
        const label = status === 'completed' ? 'workout completed' : status === 'completed_shifted' ? 'workout completed on a different day' : status === 'scheduled' ? 'workout scheduled' : status === 'missed' ? 'workout missed' : status === 'skipped' ? 'workout skipped' : status === 'in_progress' ? 'workout in progress' : 'rest day';
        return <Button presentation="plain" key={day.toISOString()} className={`day day-${status} ${today ? 'today' : ''}`} aria-label={`${day.toDateString()}, ${label}${today ? ', today' : ''}`} onClick={() => { setSelectedDay(day); setSelectedDayError(''); }}>
          <span>{day.toLocaleDateString('en', { weekday: 'short' })}</span><strong>{day.getDate()}</strong>
          <span className="day-marker">{status === 'completed' ? <Check size={12} /> : status === 'completed_shifted' ? '↔' : status === 'scheduled' ? '○' : status === 'missed' ? '!' : status === 'skipped' ? '–' : status === 'in_progress' ? '…' : today ? <span className="status-dot" /> : '·'}</span>
        </Button>;
      })}</div>
      <div className="calendar-legend" aria-label="Calendar status legend"><span><i className="legend-dot scheduled" />Scheduled</span><span><i className="legend-dot completed" />Completed</span><span><i className="legend-dot shifted" />Early/late</span><span><i className="legend-dot missed" />Missed</span><span><i className="legend-dot skipped" />Skipped</span><span><i className="legend-dot in-progress" />In progress</span></div>
      {calendarError && <p className="muted calendar-error">{calendarError}</p>}
    </section>

    <div className="dashboard-grid">
      <div className="main-column">
        <section className="next-workout">
          <div className="hero-top">
            <span className="eyebrow"><span className="status-dot" /> {data.activeWorkout?.active ? 'Workout in progress' : next ? 'Up next' : 'No workout selected'}</span>
            <span className="pill">{data.activeWorkout?.active ? data.activeWorkout.exercises.length : nextExerciseCount} exercises</span>
          </div>
          <div className="hero-content">
            <div>
              <h2>{data.activeWorkout?.active ? data.activeWorkout.name : nextName ?? 'Choose a workout'}</h2>
              <p>{data.activeWorkout?.active ? 'In progress · pick up where you left off' : program ? `${program.name} · week ${nextWeek}` : next ? nextFocus : 'Import a program from a PDF, or build a workout by hand.'}</p>
              <div className="hero-facts">
                <span><Dumbbell size={15} />{data.activeWorkout?.active ? data.activeWorkout.exercises.reduce((total, e) => total + e.sets.filter(s => !s.warmup).length, 0) : nextSets !== null ? nextSets : '—'} working sets</span>
              </div>
            </div>
          </div>
          <div className="hero-bottom">
            {data.activeWorkout?.active
              ? <Button variant="primary" onClick={onResume}><Play size={17} fill="currentColor" />Resume workout<ArrowRight size={18} /></Button>
              : next
                ? <Button variant="primary" onClick={() => onStart(next.id)}><Play size={17} fill="currentColor" />Start workout<ArrowRight size={18} /></Button>
                : <Button variant="primary" onClick={onImport}><FileText size={17} />Import a program<ArrowRight size={18} /></Button>}
          </div>
        </section>

      </div>

      <aside className="side-column">
        <section className="panel program-card">
          <div className="section-heading"><h2>Your program</h2>{program && <span className="tiny-label">{program.weeks} {program.weeks === 1 ? 'week' : 'weeks'}</span>}</div>
          {program ? <>
            <div className="program-title"><span className="program-icon"><Dumbbell size={25} /></span><div><h3>{program.name}</h3>
              <p>{program.completedTemplateIds.length} of {program.days.filter(day => !day.isRestDay).length} workouts complete</p></div></div>
            {program.phases?.find(phase => !phase.complete) && <p className="muted overview-phase">Current phase: {program.phases.find(phase => !phase.complete)?.name}</p>}
          </> : <div className="empty-inline"><span className="exercise-icon"><FileText size={20} /></span>
            <div><h3>No active program</h3><p>Import a training PDF and review it before it becomes a program.</p></div></div>}
          <Button className="full-width" onClick={onProgram}>Manage workouts <ArrowRight size={16} /></Button>
        </section>

      </aside>
    </div>
    {selectedDay && <CalendarDayModal day={selectedDay} entries={calendar.filter(item => item.localDate === localDay(selectedDay))}
      onClose={() => setSelectedDay(null)} onSession={async id => { try { const session = await api.getWorkout(id); setSelectedDay(null); onSession(session); } catch { setSelectedDayError('This workout could not be opened.'); } }} error={selectedDayError} />}
  </>;
}

function CalendarDayModal({ day, entries, onClose, onSession, error }: { day: Date; entries: WorkoutTrainingSummary[]; onClose: () => void; onSession: (id: string) => Promise<void>; error: string }) {
  return <Modal title={day.toLocaleDateString('en', { weekday: 'long', month: 'long', day: 'numeric' })} onClose={onClose}>
    <div className="modal-body calendar-day-details">
      {entries.length ? entries.map(entry => <div className="calendar-entry" key={entry.id}>
        <div><strong>{entry.workoutName}</strong><span className="muted">{entry.status.replace('_', ' ')}{entry.actualDate && entry.actualDate !== entry.localDate ? ` · actual ${entry.actualDate}` : ''}</span></div>
        {entry.id.startsWith('session:') && <Button variant="tertiary" onClick={() => void onSession(entry.id.slice('session:'.length))}>Open workout <ArrowRight size={15} /></Button>}
      </div>) : <p className="muted">No scheduled or completed workout recorded for this day.</p>}
      {error && <div className="error-text" role="alert">{error}</div>}
    </div>
  </Modal>;
}
