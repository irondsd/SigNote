/** @jest-environment jsdom */
import '@testing-library/jest-dom';
import { render, screen, fireEvent } from '@testing-library/react';
import { SelfDestructPicker } from '../SelfDestructPicker';

type CommitPayload = { expiresAt: Date | null; burnAfterReading: boolean };

function renderPicker(overrides?: {
  expiresAt?: Date | null;
  burnAfterReading?: boolean;
  onCommit?: jest.Mock<void, [CommitPayload]>;
  onRemove?: jest.Mock<void, []>;
  onCancel?: jest.Mock<void, []>;
  onBack?: jest.Mock<void, []>;
}) {
  const onCommit: jest.Mock<void, [CommitPayload]> = overrides?.onCommit ?? jest.fn();
  const onRemove: jest.Mock<void, []> = overrides?.onRemove ?? jest.fn();
  const onCancel: jest.Mock<void, []> = overrides?.onCancel ?? jest.fn();
  const onBack: jest.Mock<void, []> = overrides?.onBack ?? jest.fn();
  render(
    <SelfDestructPicker
      expiresAt={overrides?.expiresAt ?? null}
      burnAfterReading={overrides?.burnAfterReading ?? false}
      onBack={onBack}
      onCommit={onCommit}
      onRemove={onRemove}
      onCancel={onCancel}
    />,
  );
  return { onCommit, onRemove, onCancel, onBack };
}

function getSetButton(): HTMLButtonElement {
  // The primary footer button reads "Set timer" or "Update timer".
  const byUpdate = screen.queryByRole('button', { name: /update timer/i });
  if (byUpdate) return byUpdate as HTMLButtonElement;
  return screen.getByRole('button', { name: /set timer/i }) as HTMLButtonElement;
}

describe('<SelfDestructPicker> — canCommit logic', () => {
  beforeEach(() => {
    jest.useFakeTimers();
    jest.setSystemTime(new Date('2026-05-24T12:00:00Z'));
  });
  afterEach(() => {
    jest.useRealTimers();
  });

  it('disables Save when nothing is selected and no timer was set', () => {
    renderPicker();
    expect(getSetButton()).toBeDisabled();
  });

  it('enables Save when a preset is selected', () => {
    renderPicker();
    fireEvent.click(screen.getByRole('button', { name: /1 hour/i }));
    expect(getSetButton()).not.toBeDisabled();
  });

  it('enables Save when burn is toggled on (from off)', () => {
    renderPicker();
    fireEvent.click(screen.getByRole('switch', { name: /burn after reading/i }));
    expect(getSetButton()).not.toBeDisabled();
  });

  it('enables Save when burn is toggled off (from on) — the regression case', () => {
    renderPicker({ burnAfterReading: true });
    // Initially burn=true and burn=true → no change → disabled
    expect(getSetButton()).toBeDisabled();
    fireEvent.click(screen.getByRole('switch', { name: /burn after reading/i }));
    expect(getSetButton()).not.toBeDisabled();
  });

  it('keeps Save disabled when nothing was set and nothing was changed', () => {
    renderPicker({ expiresAt: null, burnAfterReading: false });
    expect(getSetButton()).toBeDisabled();
  });
});

describe('<SelfDestructPicker> — commit payload', () => {
  beforeEach(() => {
    jest.useFakeTimers();
    jest.setSystemTime(new Date('2026-05-24T12:00:00Z'));
  });
  afterEach(() => {
    jest.useRealTimers();
  });

  it('commits a preset as expiresAt = now + preset, burn = false', () => {
    const { onCommit } = renderPicker();
    fireEvent.click(screen.getByRole('button', { name: /1 hour/i }));
    fireEvent.click(getSetButton());
    expect(onCommit).toHaveBeenCalledTimes(1);
    const payload = onCommit.mock.calls[0][0];
    expect(payload.burnAfterReading).toBe(false);
    expect(payload.expiresAt).toBeInstanceOf(Date);
    expect(payload.expiresAt!.getTime()).toBe(Date.now() + 60 * 60_000);
  });

  it('commits burn-after-reading with expiresAt = null', () => {
    const { onCommit } = renderPicker();
    fireEvent.click(screen.getByRole('switch', { name: /burn after reading/i }));
    fireEvent.click(getSetButton());
    expect(onCommit).toHaveBeenCalledWith({ expiresAt: null, burnAfterReading: true });
  });

  it('commits clearing payload when burn was on and user toggles it off', () => {
    const { onCommit } = renderPicker({ burnAfterReading: true });
    fireEvent.click(screen.getByRole('switch', { name: /burn after reading/i }));
    fireEvent.click(getSetButton());
    expect(onCommit).toHaveBeenCalledWith({ expiresAt: null, burnAfterReading: false });
  });

  it('preset overrides an initial burn=true (commits expiresAt, burn=false)', () => {
    const { onCommit } = renderPicker({ burnAfterReading: true });
    fireEvent.click(screen.getByRole('button', { name: /24 hours/i }));
    fireEvent.click(getSetButton());
    const payload = onCommit.mock.calls[0][0];
    expect(payload.burnAfterReading).toBe(false);
    expect(payload.expiresAt!.getTime()).toBe(Date.now() + 24 * 60 * 60_000);
  });
});

describe('<SelfDestructPicker> — armed banner', () => {
  it('does not render the Turn-off button when nothing is set', () => {
    renderPicker();
    expect(screen.queryByRole('button', { name: /turn off self-destruct/i })).toBeNull();
  });

  it('renders the Turn-off button when expiresAt is set', () => {
    renderPicker({ expiresAt: new Date(Date.now() + 60 * 60_000) });
    expect(screen.getByRole('button', { name: /turn off self-destruct/i })).toBeInTheDocument();
  });

  it('renders the Turn-off button when burnAfterReading is set', () => {
    renderPicker({ burnAfterReading: true });
    expect(screen.getByRole('button', { name: /turn off self-destruct/i })).toBeInTheDocument();
  });

  it('calls onRemove when Turn-off is clicked', () => {
    const { onRemove } = renderPicker({ burnAfterReading: true });
    fireEvent.click(screen.getByRole('button', { name: /turn off self-destruct/i }));
    expect(onRemove).toHaveBeenCalledTimes(1);
  });
});

describe('<SelfDestructPicker> — back / cancel', () => {
  it('calls onBack when the header back arrow is clicked', () => {
    const { onBack } = renderPicker();
    fireEvent.click(screen.getByRole('button', { name: /^back$/i }));
    expect(onBack).toHaveBeenCalledTimes(1);
  });

  it('calls onCancel when the footer Cancel is clicked', () => {
    const { onCancel } = renderPicker();
    fireEvent.click(screen.getByRole('button', { name: /cancel/i }));
    expect(onCancel).toHaveBeenCalledTimes(1);
  });
});
