/** @jest-environment jsdom */
import '@testing-library/jest-dom';
import { act, fireEvent, render, screen } from '@testing-library/react';
import { Dropdown } from '../Dropdown';

beforeAll(() => {
  // Radix positions the panel with floating-ui, which observes element sizes.
  global.ResizeObserver ??= class {
    observe() {}
    unobserve() {}
    disconnect() {}
  };
});

beforeEach(() => jest.useFakeTimers());
afterEach(() => jest.useRealTimers());

/** A press as the browser delivers it: pointerdown, then the click. */
function press(el: Element) {
  fireEvent.pointerDown(el);
  act(() => jest.runAllTimers());
  fireEvent.click(el);
}

function renderDropdown(props: Partial<React.ComponentProps<typeof Dropdown>> = {}) {
  return render(
    // The note modal stops click propagation so a click inside it doesn't reach
    // the backdrop. Radix's own dismissal gives up on exactly that.
    <div onClick={(e) => e.stopPropagation()}>
      <p>note content</p>
      <Dropdown trigger={<button type="button">open</button>} {...props}>
        {props.children ?? <button type="button">item</button>}
      </Dropdown>
    </div>,
  );
}

describe('<Dropdown>', () => {
  it('opens and closes from its trigger', () => {
    renderDropdown();
    press(screen.getByText('open'));
    expect(screen.getByText('item')).toBeInTheDocument();
    press(screen.getByText('open'));
    expect(screen.queryByText('item')).not.toBeInTheDocument();
  });

  it('closes on a press outside, even inside an element that stops click propagation', () => {
    renderDropdown();
    press(screen.getByText('open'));
    press(screen.getByText('note content'));
    expect(screen.queryByText('item')).not.toBeInTheDocument();
  });

  it('stays open on a press inside the panel', () => {
    renderDropdown();
    press(screen.getByText('open'));
    press(screen.getByText('item'));
    expect(screen.getByText('item')).toBeInTheDocument();
  });

  it('closes on Escape', () => {
    renderDropdown();
    press(screen.getByText('open'));
    fireEvent.keyDown(document.activeElement ?? document.body, { key: 'Escape' });
    expect(screen.queryByText('item')).not.toBeInTheDocument();
  });

  it('hands render-function content a close callback', () => {
    renderDropdown({
      children: (close) => (
        <button type="button" onClick={close}>
          pick
        </button>
      ),
    });
    press(screen.getByText('open'));
    press(screen.getByText('pick'));
    expect(screen.queryByText('pick')).not.toBeInTheDocument();
  });

  it('reports an outside dismissal once when controlled', () => {
    const onOpenChange = jest.fn();
    renderDropdown({ open: true, onOpenChange });
    press(screen.getByText('note content'));
    expect(onOpenChange).toHaveBeenCalledTimes(1);
    expect(onOpenChange).toHaveBeenCalledWith(false);
  });
});
