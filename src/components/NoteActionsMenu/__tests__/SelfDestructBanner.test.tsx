/** @jest-environment jsdom */
import '@testing-library/jest-dom';
import { render, screen, act } from '@testing-library/react';
import { SelfDestructBanner } from '../SelfDestructBanner';

describe('<SelfDestructBanner>', () => {
  beforeEach(() => {
    jest.useFakeTimers();
    jest.setSystemTime(new Date('2026-05-24T12:00:00Z'));
  });
  afterEach(() => {
    jest.useRealTimers();
  });

  it('renders nothing when there is no expiry and burn is off', () => {
    const { container } = render(<SelfDestructBanner expiresAt={null} burnAfterReading={false} />);
    expect(container).toBeEmptyDOMElement();
  });

  it('renders "after closing" copy when burn is on with no expiry', () => {
    render(<SelfDestructBanner expiresAt={null} burnAfterReading />);
    expect(screen.getByTestId('self-destruct-banner')).toHaveTextContent(/self-destructs after closing/i);
  });

  it('renders remaining time when expiresAt is set', () => {
    const target = new Date(Date.now() + 30 * 60_000); // +30m
    render(<SelfDestructBanner expiresAt={target} burnAfterReading={false} />);
    expect(screen.getByTestId('self-destruct-banner')).toHaveTextContent(/self-destructs in 30m/i);
  });

  it('prefers expiry copy when both expiresAt and burn are set', () => {
    const target = new Date(Date.now() + 60 * 60_000); // +1h
    render(<SelfDestructBanner expiresAt={target} burnAfterReading />);
    expect(screen.getByTestId('self-destruct-banner')).toHaveTextContent(/self-destructs in 1h/i);
    expect(screen.getByTestId('self-destruct-banner')).not.toHaveTextContent(/after closing/i);
  });

  it('re-renders as time passes (interval tick)', () => {
    const target = new Date(Date.now() + 5 * 60_000); // +5m
    render(<SelfDestructBanner expiresAt={target} burnAfterReading={false} />);
    expect(screen.getByTestId('self-destruct-banner')).toHaveTextContent(/5m/);

    act(() => {
      jest.advanceTimersByTime(2 * 60_000); // +2m of wall time
    });
    expect(screen.getByTestId('self-destruct-banner')).toHaveTextContent(/3m/);
  });

  it('passes through className', () => {
    render(<SelfDestructBanner expiresAt={null} burnAfterReading className="extra-class" />);
    expect(screen.getByTestId('self-destruct-banner')).toHaveClass('extra-class');
  });
});
