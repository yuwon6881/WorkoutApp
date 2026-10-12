import { describe, expect, it } from 'vitest';
import { computeAnchoredLayerStyle } from './useAnchoredLayer';

describe('computeAnchoredLayerStyle', () => {
  it('aligns an end-aligned menu below and flush with the trigger right edge in viewport coordinates', () => {
    const style = computeAnchoredLayerStyle({
      triggerRect: { top: 28, bottom: 68, left: 1030, right: 1070, width: 40 },
      originRect: { top: 0, left: 0, width: 220, height: 184 },
      offsetWidth: 220,
      offsetHeight: 184,
      scrollWidth: 220,
      scrollHeight: 184,
      viewportWidth: 1440,
      viewportHeight: 900,
      align: 'end',
      minWidth: 210,
      maxWidth: 280,
      maxHeight: 300,
      offset: 4
    });

    expect(style.position).toBe('fixed');
    expect(style.left).toBe('850px');
    expect(style.right).toBe('auto');
    expect(style.top).toBe('72px');
  });

  it('compensates when an enclosing dialog or transformed ancestor is the fixed-position containing block', () => {
    // Dialog sits at (310, 180) in a 1440x900 viewport; trigger is near the top-right of the dialog.
    const style = computeAnchoredLayerStyle({
      triggerRect: { top: 208, bottom: 248, left: 1030, right: 1070, width: 40 },
      originRect: { top: 180, left: 310, width: 220, height: 184 },
      offsetWidth: 220,
      offsetHeight: 184,
      scrollWidth: 220,
      scrollHeight: 184,
      viewportWidth: 1440,
      viewportHeight: 900,
      align: 'end',
      minWidth: 210,
      maxWidth: 280,
      maxHeight: 300,
      offset: 4
    });

    // 310 + 540 = 850 (right edge at 850 + 220 = 1070 === triggerRect.right)
    // 180 + 72 = 252 (=== triggerRect.bottom + 4)
    expect(style.left).toBe('540px');
    expect(style.top).toBe('72px');
  });

  it('compensates for ancestor scale transforms during dialog entrance animations', () => {
    const scale = 0.97;
    const style = computeAnchoredLayerStyle({
      triggerRect: { top: 208, bottom: 248, left: 1030, right: 1070, width: 40 },
      originRect: { top: 180, left: 310, width: 220 * scale, height: 184 * scale },
      offsetWidth: 220,
      offsetHeight: 184,
      scrollWidth: 220,
      scrollHeight: 184,
      viewportWidth: 1440,
      viewportHeight: 900,
      align: 'end',
      minWidth: 210,
      maxWidth: 280,
      maxHeight: 300,
      offset: 4
    });

    const renderedViewportLeft = 310 + Number.parseFloat(String(style.left)) * scale;
    const renderedViewportTop = 180 + Number.parseFloat(String(style.top)) * scale;
    expect(renderedViewportLeft + 220 * scale).toBeCloseTo(1070, 3);
    expect(renderedViewportTop).toBeCloseTo(252, 3);
  });

  it('flips above the trigger when there is insufficient room below and more room above', () => {
    const style = computeAnchoredLayerStyle({
      triggerRect: { top: 760, bottom: 804, left: 980, right: 1020, width: 40 },
      originRect: { top: 0, left: 0, width: 210, height: 180 },
      offsetWidth: 210,
      offsetHeight: 180,
      scrollWidth: 210,
      scrollHeight: 180,
      viewportWidth: 1280,
      viewportHeight: 840,
      align: 'end',
      minWidth: 210,
      maxWidth: 280,
      maxHeight: 300,
      offset: 4
    });

    expect(style.left).toBe('810px');
    expect(style.top).toBe('576px');
  });

  it('matches trigger width for standard select dropdowns and offsets for dialog containing blocks', () => {
    const style = computeAnchoredLayerStyle({
      triggerRect: { top: 340, bottom: 384, left: 420, right: 600, width: 180 },
      originRect: { top: 120, left: 260, width: 180, height: 160 },
      offsetWidth: 180,
      offsetHeight: 160,
      scrollWidth: 180,
      scrollHeight: 160,
      viewportWidth: 1280,
      viewportHeight: 800,
      matchTriggerWidth: true,
      minWidth: 120,
      maxWidth: 260,
      maxHeight: 260,
      offset: 5
    });

    expect(style.width).toBe('180px');
    expect(style.left).toBe('160px');
    expect(style.top).toBe('269px');
  });
});
