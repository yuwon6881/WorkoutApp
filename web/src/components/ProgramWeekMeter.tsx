import './ProgramWeekMeter.css';

/// The active program's place in its run, under the program name: the current week, then a slim
/// track filled by the days of that week already passed. The track is captioned with its own count
/// ("3 of 6 days") because beside "Week 1 of 8" alone it read as progress through the program.
export function ProgramWeekMeter({ week, weeks, passedDays, totalDays }: {
  week: number;
  weeks: number;
  passedDays: number;
  totalDays: number;
}) {
  const passed = Math.min(totalDays, Math.max(0, passedDays));
  const fraction = totalDays > 0 ? passed / totalDays : 0;
  const days = `${passed} of ${totalDays} ${totalDays === 1 ? 'day' : 'days'}`;
  return <span className="program-week-meter">
    <span className="program-week-meter-label">Week <strong>{week}</strong> of {weeks}</span>
    {totalDays > 0 && <span className="program-week-meter-days">
      <span className="program-week-meter-track" role="progressbar" aria-label="Days passed this week"
        aria-valuemin={0} aria-valuemax={100} aria-valuenow={Math.round(fraction * 100)} aria-valuetext={`${days} passed this week`}>
        <span className="program-week-meter-fill" style={{ width: `${fraction * 100}%` }} />
      </span>
      <span className="program-week-meter-count" aria-hidden="true">{days} this week</span>
    </span>}
  </span>;
}
