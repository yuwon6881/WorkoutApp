import { describe, expect, it } from 'vitest';
import React from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { NextWorkoutHero } from './NextWorkoutHero';
import type { ProgramProgressDay } from '../types';
import { mockSession, mockBootstrap, mockTemplate, mockProgram, mockProgramDay } from './nextWorkoutHeroTestFixtures';

describe('NextWorkoutHero', () => {
  it('uses server hero details on a launch without templates or catalog', () => {
    const data = mockBootstrap({ templates: [], exercises: [], nextWorkout: {
      id: 'day-1', name: 'Push', focus: '', week: 1, position: 0, exerciseCount: 1
    }, workoutHero: { templateId: 'day-1', sessionId: null, sessionRevision: null,
      completedStandaloneName: null, workingSets: 3, muscles: [{ muscle: 'Chest', sets: 3 }] } });
    const html = renderToStaticMarkup(React.createElement(NextWorkoutHero, {
      data, onStart: () => {}, onResume: () => {}, onProgram: () => {}
    }));
    expect(html).toContain('3</strong> working sets');
    expect(html).toContain('Chest');
  });

  it('recognizes a finished standalone slot without loading templates', () => {
    const data = mockBootstrap({ templates: [], nextWorkout: null, workoutHero: {
      templateId: null, sessionId: null, sessionRevision: null, completedStandaloneName: 'Push', workingSets: null, muscles: []
    } });
    const html = renderToStaticMarkup(React.createElement(NextWorkoutHero, {
      data, onStart: () => {}, onResume: () => {}, onProgram: () => {}
    }));
    expect(html).toContain('Workout complete');
    expect(html).toContain('Push');
    expect(html).not.toContain('Get started');
  });
  it('renders active in-progress workout with static flame icon and factual set counts', () => {
    const activeWorkout = mockSession();
    const data = mockBootstrap({ activeWorkout });
    const html = renderToStaticMarkup(
      React.createElement(NextWorkoutHero, {
        data,
        onStart: () => {},
        onResume: () => {},
        onProgram: () => {}
      })
    );

    expect(html).toContain('In progress');
    expect(html).toContain('Push Day');
    expect(html).toContain('1</strong> of <strong>2</strong> sets done');
    expect(html).toContain('1</strong> exercises');
    expect(html).not.toContain('pulse-dot');
  });

  it('renders paused workout with paused-pill and static pause indicator, avoiding running pulse', () => {
    const activeWorkout = mockSession({
      pausedAt: '2026-10-10T10:30:00Z',
      exercises: []
    });
    const data = mockBootstrap({ activeWorkout });
    const html = renderToStaticMarkup(
      React.createElement(NextWorkoutHero, {
        data,
        onStart: () => {},
        onResume: () => {},
        onProgram: () => {}
      })
    );

    expect(html).toContain('Workout paused');
    expect(html).toContain('paused-pill');
    expect(html).not.toContain('pulse-dot');
  });

  it('handles fresh lightweight launch NextWorkoutSummary without eager templates or invented working sets', () => {
    const data = mockBootstrap({
      nextWorkout: {
        id: 'day-1',
        name: 'Upper Body Hypertrophy',
        focus: 'Chest & Back',
        week: 3,
        position: 0,
        exerciseCount: 6
      },
      templates: []
    });

    const html = renderToStaticMarkup(
      React.createElement(NextWorkoutHero, {
        data,
        onStart: () => {},
        onResume: () => {},
        onProgram: () => {}
      })
    );

    expect(html).toContain('Upper Body Hypertrophy');
    expect(html).toContain('6</strong> exercises');
    expect(html).toContain('Target: <strong>Chest &amp; Back</strong>');
    expect(html).not.toContain('working sets');
  });

  it('renders authoritative planned working sets when full template is available', () => {
    const data = mockBootstrap({
      nextWorkout: {
        id: 'day-1',
        name: 'Upper Body Hypertrophy',
        focus: 'Chest & Back',
        week: 3,
        position: 0,
        exerciseCount: 1
      },
      templates: [mockTemplate()]
    });

    const html = renderToStaticMarkup(
      React.createElement(NextWorkoutHero, {
        data,
        onStart: () => {},
        onResume: () => {},
        onProgram: () => {}
      })
    );

    expect(html).toContain('Upper Body Hypertrophy');
    expect(html).toContain('2</strong> working sets');
  });

  it('uses undated wording for rest days without claiming calendar date absence', () => {
    const restDay: ProgramProgressDay = {
      templateId: 't-rest',
      status: 'pending',
      isRestDay: true,
      position: 3
    };
    const completedDay: ProgramProgressDay = {
      templateId: 't-1',
      status: 'completed',
      isRestDay: false,
      position: 0
    };

    const data = mockBootstrap({
      nextWorkout: null,
      activeProgram: mockProgram({
        progress: {
          runId: 'run-1',
          currentWeek: 2,
          currentAttempt: 1,
          passedDays: 1,
          totalDays: 2,
          days: [completedDay, restDay]
        }
      })
    });

    const html = renderToStaticMarkup(
      React.createElement(NextWorkoutHero, {
        data,
        onStart: () => {},
        onResume: () => {},
        onProgram: () => {}
      })
    );

    expect(html).toContain('Rest day');
    expect(html).toContain('Scheduled rest. Training resumes with your next planned workout.');
    expect(html).not.toContain('No session planned for today');
  });

  it('renders completed week state when all workouts in the active program week are finished', () => {
    const days: ProgramProgressDay[] = [
      { templateId: 't-1', status: 'completed', isRestDay: false, position: 0 },
      { templateId: 't-2', status: 'completed', isRestDay: false, position: 1 },
      { templateId: 't-3', status: 'completed', isRestDay: false, position: 2 }
    ];

    const data = mockBootstrap({
      nextWorkout: null,
      activeProgram: mockProgram({
        progress: {
          runId: 'run-1',
          currentWeek: 2,
          currentAttempt: 1,
          passedDays: 3,
          totalDays: 3,
          days
        }
      })
    });

    const html = renderToStaticMarkup(
      React.createElement(NextWorkoutHero, {
        data,
        onStart: () => {},
        onResume: () => {},
        onProgram: () => {}
      })
    );

    expect(html).toContain('Week 2 complete');
    expect(html).toContain('Week 2 workouts complete');
    expect(html).toContain('All planned workouts completed for week 2.');
    expect(html).not.toContain('concluded');
  });

  it('renders concluded state distinguishing skips from completion when week has mixed completed and skipped sessions', () => {
    const days: ProgramProgressDay[] = [
      { templateId: 't-1', status: 'completed', isRestDay: false, position: 0 },
      { templateId: 't-2', status: 'completed', isRestDay: false, position: 1 },
      { templateId: 't-3', status: 'skipped', isRestDay: false, position: 2 }
    ];

    const data = mockBootstrap({
      nextWorkout: null,
      activeProgram: mockProgram({
        progress: {
          runId: 'run-1',
          currentWeek: 2,
          currentAttempt: 1,
          passedDays: 3,
          totalDays: 3,
          days
        }
      })
    });

    const html = renderToStaticMarkup(
      React.createElement(NextWorkoutHero, {
        data,
        onStart: () => {},
        onResume: () => {},
        onProgram: () => {}
      })
    );

    expect(html).toContain('Week 2 concluded');
    expect(html).toContain('Week 2 sessions concluded');
    expect(html).toContain('2 completed, 1 skipped');
    expect(html).not.toContain('workouts complete');
  });

  it('handles rest-only week without claiming workouts complete', () => {
    const days: ProgramProgressDay[] = [
      { templateId: 't-rest-1', status: 'completed', isRestDay: true, position: 0 },
      { templateId: 't-rest-2', status: 'pending', isRestDay: true, position: 1 }
    ];

    const data = mockBootstrap({
      nextWorkout: null,
      activeProgram: mockProgram({
        progress: {
          runId: 'run-1',
          currentWeek: 4,
          currentAttempt: 1,
          passedDays: 1,
          totalDays: 2,
          days
        }
      })
    });

    const html = renderToStaticMarkup(
      React.createElement(NextWorkoutHero, {
        data,
        onStart: () => {},
        onResume: () => {},
        onProgram: () => {}
      })
    );

    expect(html).toContain('Week 4 rest');
    expect(html).toContain('Scheduled rest week. Training resumes next week.');
    expect(html).not.toContain('workouts complete');
    expect(html).not.toContain('sessions concluded');
  });

  it('renders active program view schedule fallback when progress is missing/null', () => {
    const data = mockBootstrap({
      nextWorkout: null,
      activeProgram: mockProgram({
        name: 'Hypertrophy Phase 1',
        progress: null
      })
    });

    const html = renderToStaticMarkup(
      React.createElement(NextWorkoutHero, {
        data,
        onStart: () => {},
        onResume: () => {},
        onProgram: () => {}
      })
    );

    expect(html).toContain('Active program');
    expect(html).toContain('Hypertrophy Phase 1');
    expect(html).toContain('View program schedule');
    expect(html).not.toContain('Ready to train?');
    expect(html).not.toContain('Choose next program');
  });

  it('keeps an empty progress projection unknown rather than inventing a rest week', () => {
    const data = mockBootstrap({
      nextWorkout: null,
      activeProgram: mockProgram({
        progress: {
          runId: 'run-1', currentWeek: 2, currentAttempt: 1,
          passedDays: 0, totalDays: 3, days: []
        }
      })
    });
    const html = renderToStaticMarkup(React.createElement(NextWorkoutHero, {
      data, onStart: () => {}, onResume: () => {}, onProgram: () => {}
    }));
    expect(html).toContain('Active program');
    expect(html).toContain('View program schedule');
    expect(html).not.toContain('Scheduled rest week');
    expect(html).not.toContain('workouts complete');
  });

  it('scopes progress days to current week when program has multi-week day templates', () => {
    // Week 1 days: completed
    const w1Day1 = mockProgramDay({ id: 'w1-d1', week: 1, position: 0 });
    const w1Day2 = mockProgramDay({ id: 'w1-d2', week: 1, position: 1 });
    // Week 2 days: mixed (1 completed, 1 skipped)
    const w2Day1 = mockProgramDay({ id: 'w2-d1', week: 2, position: 0 });
    const w2Day2 = mockProgramDay({ id: 'w2-d2', week: 2, position: 1 });

    const progressDays: ProgramProgressDay[] = [
      { templateId: 'w1-d1', status: 'completed', isRestDay: false, position: 0 },
      { templateId: 'w1-d2', status: 'completed', isRestDay: false, position: 1 },
      { templateId: 'w2-d1', status: 'completed', isRestDay: false, position: 0 },
      { templateId: 'w2-d2', status: 'skipped', isRestDay: false, position: 1 }
    ];

    const data = mockBootstrap({
      nextWorkout: null,
      activeProgram: mockProgram({
        days: [w1Day1, w1Day2, w2Day1, w2Day2],
        progress: {
          runId: 'run-1',
          currentWeek: 2,
          currentAttempt: 1,
          passedDays: 4,
          totalDays: 4,
          days: progressDays
        }
      })
    });

    const html = renderToStaticMarkup(
      React.createElement(NextWorkoutHero, {
        data,
        onStart: () => {},
        onResume: () => {},
        onProgram: () => {}
      })
    );

    // Should evaluate ONLY week 2: 1 completed, 1 skipped
    expect(html).toContain('Week 2 concluded');
    expect(html).toContain('Week 2 sessions concluded');
    expect(html).toContain('1 completed, 1 skipped');
    // Should NOT include week 1's completed count (which would make it 3 completed)
    expect(html).not.toContain('3 completed');
  });

  it('renders empty library prompt only when there is no active program and no saved workouts', () => {
    const data = mockBootstrap({
      nextWorkout: null,
      activeProgram: null,
      templates: []
    });

    const html = renderToStaticMarkup(
      React.createElement(NextWorkoutHero, {
        data,
        onStart: () => {},
        onResume: () => {},
        onProgram: () => {}
      })
    );

    expect(html).toContain('Ready to train?');
    expect(html).toContain('Get started');
    expect(html).toContain('Explore workouts');
  });

  it('renders completed workout card with View workouts action when full templates are loaded with a completed standalone', () => {
    const completed = mockTemplate({
      id: 't-comp',
      programId: null,
      name: 'Codex Upper Body',
      active: true,
      activeCompletedAt: '2026-10-11T02:00:00Z'
    });

    const data = mockBootstrap({
      nextWorkout: null,
      templates: [completed]
    });

    const html = renderToStaticMarkup(
      React.createElement(NextWorkoutHero, {
        data,
        onStart: () => {},
        onResume: () => {},
        onProgram: () => {}
      })
    );

    expect(html).toContain('Workout complete');
    expect(html).toContain('Codex Upper Body');
    expect(html).toContain('View workouts');
    expect(html).toContain('Restart this workout or choose another from your library.');
  });

  it('does not invent completion on lightweight summaries when full templates are not yet loaded', () => {
    const data = mockBootstrap({
      nextWorkout: null,
      templates: []
    });

    const html = renderToStaticMarkup(
      React.createElement(NextWorkoutHero, {
        data,
        onStart: () => {},
        onResume: () => {},
        onProgram: () => {}
      })
    );

    expect(html).not.toContain('Workout complete');
    expect(html).toContain('Ready to train?');
    expect(html).toContain('Explore workouts');
  });
});

describe('NextWorkoutHero rest day action', () => {
  const restProgress = (days: ProgramProgressDay[]) => mockProgram({
    progress: { runId: 'run-1', currentWeek: 2, currentAttempt: 1, passedDays: 0, totalDays: days.length, days }
  });
  const render = (data: ReturnType<typeof mockBootstrap>, onChanged?: () => Promise<void>) => renderToStaticMarkup(
    React.createElement(NextWorkoutHero, { data, onStart: () => {}, onResume: () => {}, onProgram: () => {}, onChanged })
  );
  const rest: ProgramProgressDay = { templateId: 't-rest', status: 'pending', isRestDay: true, position: 3 };
  const done: ProgramProgressDay = { templateId: 't-1', status: 'completed', isRestDay: false, position: 0 };

  it('offers to pass a pending rest day beside the schedule link', () => {
    const html = render(mockBootstrap({ nextWorkout: null, activeProgram: restProgress([done, rest]) }), async () => {});
    expect(html).toContain('Pass rest day');
    expect(html).toContain('View program schedule');
  });

  it('offers it for a rest-only week and for the next day being a rest day', () => {
    const only = render(mockBootstrap({ nextWorkout: null, activeProgram: restProgress([rest]) }), async () => {});
    expect(only).toContain('Week 2 rest');
    expect(only).toContain('Pass rest day');
    const next = render(mockBootstrap({
      nextWorkout: { id: 't-rest', name: 'Rest', focus: '', week: 2, position: 3, exerciseCount: 0, isRestDay: true } as never,
      activeProgram: restProgress([done, rest])
    }), async () => {});
    expect(next).toContain('Pass rest day');
  });

  it('offers nothing to change when the program cannot refresh, is inactive, or has no pending rest day', () => {
    const data = mockBootstrap({ nextWorkout: null, activeProgram: restProgress([done, rest]) });
    expect(render(data)).not.toContain('Pass rest day');
    const inactive = mockBootstrap({ nextWorkout: null, activeProgram: { ...restProgress([done, rest]), active: false } });
    expect(render(inactive, async () => {})).not.toContain('Pass rest day');
  });
});
