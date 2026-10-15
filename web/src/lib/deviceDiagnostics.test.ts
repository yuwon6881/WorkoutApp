import { describe, expect, it } from 'vitest';
import { copyableDiagnostics, diagnosticLines, type DeviceInfo } from './deviceDiagnostics';
describe('local diagnostic redaction', () => {
  it('copies only capability and count fields, excluding identity and raw recovery errors', () => {
    const raw = { version: '1.0', build: 1234, channel: 'device-test', android: '16', sdk: 36, webview: '140',
      recoveryError: 'token=secret workout=Private workout', accountId: 'person@example.com', token: 'secret' };
    const copied = copyableDiagnostics([...diagnosticLines(raw as DeviceInfo, false, null),
      ['Account', 'person@example.com'], ['Food', 'Private food'], ['Pending edits', '3']]);
    expect(copied).toContain('Pending edits: 3');
    expect(copied).toContain('Recovery: unavailable');
    expect(copied).not.toMatch(/secret|person@|Private/);
    expect(copied).toContain('Last confirmed sync: Not recorded');
  });
});
