import type { DevicePreferences } from '../lib/workoutRecovery';
import { SettingRow } from './ui/SettingRow';
import { Switch } from './ui/Switch';

/// How the active workout moves between exercises after a set is logged. These are per device:
/// a phone held mid-set wants the jump, a tablet propped across the room may not.
export function WorkoutFlowSettings({ devicePreferences, onDevicePreferences }: {
  devicePreferences: DevicePreferences;
  onDevicePreferences: (preferences: DevicePreferences) => void;
}) {
  return (
    <>
      <SettingRow
        label={<strong>Move to the next exercise automatically</strong>}
        description="Advance after completing all sets on this device."
        descriptionId="auto-advance-description"
      >
        <Switch
          label="Move to the next exercise automatically"
          describedBy="auto-advance-description"
          checked={devicePreferences.autoAdvance}
          onChange={autoAdvance => onDevicePreferences({ ...devicePreferences, autoAdvance })}
        />
      </SettingRow>

      <SettingRow
        label={<strong>Jump to the superset partner</strong>}
        description="After each superset set, go to the linked exercise on this device."
        descriptionId="superset-advance-description"
      >
        <Switch
          label="Jump to the superset partner"
          describedBy="superset-advance-description"
          checked={devicePreferences.supersetAdvance}
          onChange={supersetAdvance => onDevicePreferences({ ...devicePreferences, supersetAdvance })}
        />
      </SettingRow>
    </>
  );
}
