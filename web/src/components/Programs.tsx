import { useMemo, useState } from 'react';
import { ArrowRight, CheckCircle2, Dumbbell, FileText, Plus, Trash2, Zap } from 'lucide-react';
import type { Bootstrap, Exercise, Template } from '../types';
import { api } from '../lib/api';
import { createEmptyProgramDraft } from '../lib/importDraftWeeks';
import { slotItemId, type SlotItem } from '../lib/activeSlot';
import { Button } from './ui/Button';
import { MenuButton, MenuItem } from './ui/MenuButton';
import { WorkoutEditorModal, type WorkoutDraft } from './WorkoutEditorModal';
import { ProgramBuilderPage } from './ProgramBuilderPage';
import { RoutineCard } from './RoutineCard';
import { ActiveProgramCard, type SlotCardActions } from './ActiveProgramCard';
import { ActiveTemplateCard } from './ActiveTemplateCard';
import { LibraryProgramCard } from './LibraryProgramCard';
import { ActiveSlotDropZone, SlotConfirmDialog, SlotDragGhost } from './WorkoutSlotZones';
import { useWorkoutSlotDrag } from './useWorkoutSlotDrag';
import { useWorkoutSlotActions } from './useWorkoutSlotActions';
import './WorkoutSlot.css';
import './Programs.css';

export function Programs({ data, exercises, onStart, onImport, onChanged, onTemplateSaved, onTemplateDeleted }: {
  data: Bootstrap; exercises: Exercise[]; onStart: (templateId: string) => void; onImport: () => void; onChanged: () => Promise<void>;
  onTemplateSaved?: (template: Template) => void;
  onTemplateDeleted?: (id: string) => void;
}) {
  const [draft, setDraft] = useState<WorkoutDraft | null>(null);
  const [busy, setBusy] = useState(false);
  const [building, setBuilding] = useState(false);

  const rawActiveProgram = data.programs.find(program => program.active) ?? null;
  const rawActiveTemplate = data.templates.find(template => template.active) ?? null;
  const holder = useMemo<SlotItem | null>(() => rawActiveProgram ? { kind: 'program', program: rawActiveProgram }
    : rawActiveTemplate ? { kind: 'template', template: rawActiveTemplate } : null, [rawActiveProgram, rawActiveTemplate]);
  const slot = useWorkoutSlotActions({ holder, onChanged, onTemplateDeleted });
  const { drag, handlers } = useWorkoutSlotDrag(slot.drop);

  const activeProgram = useMemo(() => {
    if (slot.optimistic?.type === 'set-active') {
      return slot.optimistic.item.kind === 'program' ? slot.optimistic.item.program : null;
    }
    if (slot.optimistic?.type === 'set-library' && holder?.kind === 'program') {
      return null;
    }
    return rawActiveProgram;
  }, [slot.optimistic, rawActiveProgram, holder]);

  const activeTemplate = useMemo(() => {
    if (slot.optimistic?.type === 'set-active') {
      return slot.optimistic.item.kind === 'template' ? slot.optimistic.item.template : null;
    }
    if (slot.optimistic?.type === 'set-library' && holder?.kind === 'template') {
      return null;
    }
    return rawActiveTemplate;
  }, [slot.optimistic, rawActiveTemplate, holder]);

  const displayHolder = useMemo<SlotItem | null>(() => activeProgram ? { kind: 'program', program: activeProgram }
    : activeTemplate ? { kind: 'template', template: activeTemplate } : null, [activeProgram, activeTemplate]);

  const open = (template?: Template) => {
    setDraft(template
      ? { id: template.id, name: template.name, focus: template.focus, revision: template.revision, exercises: structuredClone(template.exercises), canRestore: template.canRestore, isLegacyBaseline: template.isLegacyBaseline }
      : { id: null, name: '', focus: '', revision: null, exercises: [] });
  };

  async function save(savedDraft: WorkoutDraft) {
    setBusy(true);
    const input = {
      name: savedDraft.name.trim(), focus: savedDraft.focus.trim(), note: null, revision: savedDraft.revision, idempotencyId: crypto.randomUUID(),
      exercises: savedDraft.exercises.map(e => ({ exerciseId: e.exerciseId, sourceName: e.sourceName || e.name, note: e.note || null, sets: e.sets,
        sequenceGroup: e.sequenceGroup || null, substitutions: e.substitutions ?? [], sourcePage: e.sourcePage ?? null,
        slotKey: e.slotKey ?? null, restSeconds: e.restSeconds ?? null, demoUrl: e.demoUrl ?? null,
        demoLinks: e.demoLinks ?? null }))
    };
    try {
      const saved = savedDraft.id ? await api.updateTemplate(savedDraft.id, input) : await api.createTemplate(input);
      onTemplateSaved?.(saved);
      setDraft(null);
      if (!onTemplateSaved) void onChanged();
    } finally { setBusy(false); }
  }

  async function remove(id: string) {
    setBusy(true);
    try { await api.deleteTemplate(id); onTemplateDeleted?.(id); setDraft(null); if (!onTemplateDeleted) void onChanged(); }
    finally { setBusy(false); }
  }

  if (building) {
    return <ProgramBuilderPage initialDraft={createEmptyProgramDraft()} exercises={exercises}
      onBack={() => setBuilding(false)}
      onCreated={async () => { await onChanged(); }} />;
  }

  const hasActiveWorkout = Boolean(data.activeWorkout?.active);

  const libraryPrograms = useMemo(() => {
    let list = data.programs.filter(program => !program.active);
    if (slot.optimistic?.type === 'set-active' && slot.optimistic.item.kind === 'program') {
      const activeId = slot.optimistic.item.program.id;
      list = list.filter(p => p.id !== activeId);
      if (holder?.kind === 'program' && holder.program.id !== activeId) {
        list = [holder.program, ...list];
      }
    } else if (slot.optimistic?.type === 'set-library' && slot.optimistic.item.kind === 'program') {
      const returning = slot.optimistic.item.program;
      if (!list.some(p => p.id === returning.id)) {
        list = [returning, ...list];
      }
    }
    return list;
  }, [data.programs, slot.optimistic, holder]);

  const libraryTemplates = useMemo(() => {
    let list = data.templates.filter(template => !template.active);
    if (slot.optimistic?.type === 'set-active' && slot.optimistic.item.kind === 'template') {
      const activeId = slot.optimistic.item.template.id;
      list = list.filter(t => t.id !== activeId);
      if (holder?.kind === 'template' && holder.template.id !== activeId) {
        list = [holder.template, ...list];
      }
    } else if (slot.optimistic?.type === 'set-library' && slot.optimistic.item.kind === 'template') {
      const returning = slot.optimistic.item.template;
      if (!list.some(t => t.id === returning.id)) {
        list = [returning, ...list];
      }
    }
    return list;
  }, [data.templates, slot.optimistic, holder]);

  const libraryCount = libraryPrograms.length + libraryTemplates.length;
  const readyImport = data.imports.find(view => view.status === 'ready' && !view.error);
  const movingId = slot.confirmation?.movingId ?? null;
  const draggingId = drag ? slotItemId(drag.item) : null;
  const cardActions = (item: SlotItem): SlotCardActions => ({
    busy: slot.busy,
    onMoveToLibrary: () => slot.moveToLibrary(item),
    onRestart: () => slot.restart(item),
    onDelete: () => slot.remove(item)
  });
  const dragProps = (item: SlotItem, from: 'active' | 'library') => ({
    ...handlers(item, from),
    'data-slot-dragging': draggingId === slotItemId(item) ? 'true' : undefined
  });

  return <>
    <div className="page-heading">
      <h1 data-page-heading tabIndex={-1}>Workouts</h1>
      <div className="heading-actions">
        <MenuButton label="Add a workout or program" text="New" variant="primary" icon={<Plus size={17} />}>
          <MenuItem onClick={() => open()}><Dumbbell size={14} />New workout</MenuItem>
          <MenuItem onClick={() => setBuilding(true)}><Plus size={14} />New program</MenuItem>
          <MenuItem onClick={onImport} disabled={hasActiveWorkout}><FileText size={14} />Import a PDF program</MenuItem>
        </MenuButton>
      </div>
    </div>
    {hasActiveWorkout && <p className="program-week-note">Finish or discard the active workout before importing a program.</p>}

    {readyImport && !hasActiveWorkout && (
      <section className="panel ready-import-card" role="status">
        <div className="ready-import-info">
          <span className="ready-import-badge"><CheckCircle2 size={16} /> Import ready to review</span>
          <h3>{readyImport.fileName || 'Imported PDF Program'}</h3>
          <p>Your program has finished processing. Review the extracted schedule and exercises to accept it into your library.</p>
        </div>
        <Button variant="primary" onClick={onImport}>
          Review program <ArrowRight size={16} />
        </Button>
      </section>
    )}

    {slot.error && <div className="error-banner" role="alert"><span>{slot.error}</span></div>}

    <section className="program-section">
      <div className="section-heading"><h2>Active workout</h2></div>
      <ActiveSlotDropZone over={drag?.overZone === 'active' && drag.from === 'library'} occupied={Boolean(displayHolder)}
        hasLibrary={libraryCount > 0} onNewWorkout={() => open()} onImport={onImport}>
        {displayHolder?.kind === 'program' && <ActiveProgramCard program={displayHolder.program} exercises={exercises} onStart={onStart} onChanged={onChanged}
          hasActiveWorkout={hasActiveWorkout} actions={cardActions(displayHolder)} dragProps={dragProps(displayHolder, 'active')}
          moving={movingId === displayHolder.program.id} />}
        {displayHolder?.kind === 'template' && <ActiveTemplateCard template={displayHolder.template} onStart={() => onStart(displayHolder.template.id)}
          onEdit={() => open(displayHolder.template)} hasActiveWorkout={hasActiveWorkout} actions={cardActions(displayHolder)}
          dragProps={dragProps(displayHolder, 'active')} moving={movingId === displayHolder.template.id} />}
      </ActiveSlotDropZone>
    </section>

    <section className={`program-section slot-library-zone ${drag?.overZone === 'library' && drag.from === 'active' ? 'slot-zone-over' : ''}`}
      data-slot-zone="library">
      <div className="section-heading"><h2>Workout library</h2>
        <span className="muted">{libraryCount} saved</span></div>
      {drag?.from === 'active' && <p className="slot-library-hint" role="status">Drop here to move it back to your library</p>}
      {libraryPrograms.length > 0 && <div className="slot-library-list">
        {libraryPrograms.map(program => {
          const item: SlotItem = { kind: 'program', program };
          return <LibraryProgramCard key={program.id} program={program} exercises={exercises} busy={slot.busy}
            onActivate={() => slot.activate(item)} onDelete={() => slot.remove(item)} dragProps={dragProps(item, 'library')} />;
        })}
      </div>}
      {libraryTemplates.length ? <div className="program-grid">{libraryTemplates.map(template => {
        const item: SlotItem = { kind: 'template', template };
        return <RoutineCard key={template.id} template={template} exercises={exercises} onEdit={() => open(template)}
          onStart={() => onStart(template.id)} dragProps={dragProps(item, 'library')}
          menu={<MenuButton label={`Actions for ${template.name}`} triggerClassName="slot-card-menu-trigger" portal>
            <MenuItem disabled={slot.busy} onClick={() => slot.activate(item)}><Zap size={14} />Make active</MenuItem>
            <MenuItem destructive disabled={slot.busy} onClick={() => slot.remove(item)}><Trash2 size={14} />Delete workout</MenuItem>
          </MenuButton>} />;
      })}</div>
        : libraryPrograms.length === 0 && <section className="panel"><div className="empty-message"><Dumbbell size={30} /><h3>{holder ? 'Nothing else in your library' : 'Your library is empty'}</h3>
          <p>{exercises.length ? 'Build a workout or a program by hand, or import one from a PDF.' : 'The exercise library is still empty, so a workout cannot be built yet. Importing a PDF will still create a reviewable draft.'}</p></div></section>}
    </section>

    {drag && <SlotDragGhost drag={drag} />}
    {slot.confirmation && <SlotConfirmDialog confirmation={slot.confirmation} onCancel={slot.cancel} onConfirm={slot.confirm} />}
    {draft && <WorkoutEditorModal initialDraft={draft} exercises={exercises} busy={busy} onSave={save} onDelete={remove} onClose={() => setDraft(null)} />}
  </>;
}
