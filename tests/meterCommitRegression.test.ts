import { describe, expect, it, vi } from 'vitest';
import { DomMeter } from '../src/slice3d/meter3d';

function meterHarness(): any {
  const meter = Object.create(DomMeter.prototype) as any;
  meter.ctx = { stat: 80, powerTarget: 0.9, isPutt: false };
  meter.lockedPower = 0.7;
  meter.lockedPowerBand = 'good';
  meter.cursor = 0;
  meter.dirSign = -1;
  meter.lastTs = 0;
  meter.hide = vi.fn(function (this: Record<string, any>) { this.state = 'hidden'; });
  meter.onActiveChange = null;
  meter.onBand = null;
  meter.onComplete = null;
  meter.onCancel = null;
  return meter;
}

describe('DomMeter committed swing cancellation regression', () => {
  it('preserves pre-power-lock cancel from the power sweep', () => {
    const meter = meterHarness();
    const cancel = vi.fn();
    meter.state = 'power';
    meter.cursor = 0;
    meter.dirSign = -1;
    meter.onCancel = cancel;
    meter.advance = vi.fn(function (this: Record<string, any>) { this.dirSign = 1; });

    meter.tick(123);

    expect(cancel).toHaveBeenCalledTimes(1);
    expect(meter.onComplete).toBeNull();
  });

  it('locking power moves to committed accuracy phase', () => {
    const meter = meterHarness();
    meter.state = 'power';
    meter.cursor = 0.72;
    meter.advance = vi.fn();
    meter.markerEl = { style: {} };
    meter.onBand = vi.fn();
    meter.onActiveChange = vi.fn();

    const consumed = meter.handleTap();

    expect(consumed).toBe(true);
    expect(meter.state).toBe('accuracy');
    expect(meter.lockedPower).toBe(0.72);
    expect(meter.dirSign).toBe(-1);
  });

  it('accuracy expiry executes a terrible miss instead of canceling', () => {
    const meter = meterHarness();
    const complete = vi.fn();
    const cancel = vi.fn();
    meter.state = 'accuracy';
    meter.cursor = 0;
    meter.onComplete = complete;
    meter.onCancel = cancel;
    meter.advance = vi.fn(function (this: Record<string, any>) { this.cursor = 0; });

    meter.tick(123);

    expect(cancel).not.toHaveBeenCalled();
    expect(complete).toHaveBeenCalledTimes(1);
    // cursor=0 is the far-LEFT end of the accuracy bar. Under the owner's meter
    // inversion (cursor-left → ball-right), that far-left expiry now maps to a
    // +1 (slice/right) terrible miss (was -1 before the flip).
    expect(complete.mock.calls[0][0]).toMatchObject({ accuracy: 1, accuracyQuality: 'miss' });
  });

  it('has no post-power-lock path back to idle aiming without a shot result', () => {
    const meter = meterHarness();
    const complete = vi.fn();
    const cancel = vi.fn();
    meter.state = 'accuracy';
    meter.cursor = 0;
    meter.onComplete = complete;
    meter.onCancel = cancel;
    meter.advance = vi.fn(function (this: Record<string, any>) { this.cursor = 0; });

    meter.tick(123);

    expect(meter.state).toBe('hidden');
    expect(cancel).not.toHaveBeenCalled();
    expect(complete).toHaveBeenCalledTimes(1);
  });
});
