import './ProgramWeekMeter.css';

/// The active program's place in its run, under the program name: the current week and a slim
/// track filled by the days already passed. Days stay in the week checklist below, so the meter
/// carries no second count.
export function ProgramWeekMeter({ week, weeks, passedDays, totalDays }: {
  week: number;
  weeks: number;
  passedDays: number;
  totalDays: number;
}) {
  const fraction = totalDays > 0 ? Math.min(1, Math.max(0, passedDays / totalDays)) : 0;
  return <span className="program-week-meter">
    <span className="program-week-meter-label">Week <strong>{week}</strong> of {weeks}</span>
    {fraction > 0 && <span className="program-week-meter-track" role="progressbar" aria-label="Program progress"
      aria-valuemin={0} aria-valuemax={100} aria-valuenow={Math.round(fraction * 100)} aria-valuetext={`Week ${week} of ${weeks}`}>
      <span className="program-week-meter-fill" style={{ width: `${fraction * 100}%` }} />
    </span>}
  </span>;
}
