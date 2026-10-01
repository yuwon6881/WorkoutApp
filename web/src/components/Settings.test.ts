import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it, vi } from 'vitest';
import type { Unit } from '../types';
import { defaultDevicePreferences } from '../lib/workoutDevicePreferences';

const controls = vi.hoisted(() => ({ unit: undefined as undefined | ((unit: Unit) => Promise<void>) }));
vi.mock('./ui/SegmentedControl', () => ({ SegmentedControl: (props: { label: string; onChange: (value: Unit) => Promise<void> }) => {
  if (props.label === 'Weight unit') controls.unit = props.onChange;
  return null;
} }));
vi.mock('../lib/push/firebaseMessaging', () => ({ getWorkoutPushDeviceId: () => null, deleteWorkoutPushToken: vi.fn() }));
vi.mock('../lib/api', () => ({ api: { refreshNutritionContext: vi.fn() } }));
vi.mock('./LoadIncrementSettings', () => ({ LoadIncrementSettings: () => null }));
vi.mock('./RestAlertSettings', () => ({ RestAlertSettings: () => null }));
vi.mock('./GoogleHealthSettings', () => ({ GoogleHealthSettings: () => null }));
vi.mock('./ConnectedApps', () => ({ ConnectedApps: () => null }));
vi.mock('./WatchPairingSettings', () => ({ WatchPairingSettings: () => null }));
vi.mock('./WorkoutFlowSettings', () => ({ WorkoutFlowSettings: () => null }));
vi.mock('./NativeBuildInfo', () => ({ NativeBuildInfo: () => null }));
import { SettingsView } from './Settings';

describe('weight unit switch', () => {
  it('refreshes exercise steps only after the new unit is saved', async () => {
    const events: string[] = [];
    let finishSave!: () => void;
    const onPreferences = vi.fn(() => new Promise<void>(resolve => { events.push('save started'); finishSave = () => { events.push('saved'); resolve(); }; }));
    const onCatalogChanged = vi.fn(async () => { events.push('reload'); });
    renderToStaticMarkup(createElement(SettingsView, {
      account: { id: 'account', displayName: 'Lifter' }, preferences: { unit: 'kg', theme: 'dark', restAlerts: true },
      devicePreferences: defaultDevicePreferences, onDevicePreferences: vi.fn(), onPreferences, notify: vi.fn(),
      onSignOut: vi.fn(), version: 'test', onCatalogChanged
    }));

    const switching = controls.unit!('lb');
    await Promise.resolve();
    expect(onPreferences).toHaveBeenCalledWith(expect.objectContaining({ unit: 'lb' }));
    expect(onCatalogChanged).not.toHaveBeenCalled();
    finishSave();
    await switching;
    expect(events).toEqual(['save started', 'saved', 'reload']);
  });
});
