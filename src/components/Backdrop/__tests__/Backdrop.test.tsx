/** @jest-environment jsdom */

import '@testing-library/jest-dom';
import { act, render, screen } from '@testing-library/react';
import { Backdrop } from '@/components/Backdrop/Backdrop';

class VisualViewportMock extends EventTarget {
  height = 700;
  offsetTop = 0;
}

const originalVisualViewport = window.visualViewport;
const originalInnerWidth = window.innerWidth;
const originalInnerHeight = window.innerHeight;

beforeEach(() => {
  Object.defineProperty(window, 'innerWidth', { configurable: true, value: 390 });
  Object.defineProperty(window, 'innerHeight', { configurable: true, value: 800 });
});

afterEach(() => {
  Object.defineProperty(window, 'visualViewport', { configurable: true, value: originalVisualViewport });
  Object.defineProperty(window, 'innerWidth', { configurable: true, value: originalInnerWidth });
  Object.defineProperty(window, 'innerHeight', { configurable: true, value: originalInnerHeight });
  document.body.style.overflow = '';
  document.body.inert = false;
});

it('pins the mobile backdrop to visualViewport changes', () => {
  const viewport = new VisualViewportMock();
  Object.defineProperty(window, 'visualViewport', { configurable: true, value: viewport });

  render(
    <Backdrop onClose={jest.fn()}>
      <div>Modal content</div>
    </Backdrop>,
  );

  const backdrop = screen.getByText('Modal content').parentElement!;
  expect(backdrop).toHaveStyle({ top: '0px', height: '700px', bottom: 'auto' });

  act(() => {
    viewport.height = 360;
    viewport.offsetTop = 24;
    viewport.dispatchEvent(new Event('resize'));
  });

  expect(backdrop).toHaveStyle({ top: '24px', height: '360px', bottom: 'auto' });
});

it('makes the background inert and restores its previous state on unmount', () => {
  const background = document.createElement('main');
  background.inert = false;
  document.body.appendChild(background);
  document.body.style.overflow = 'scroll';

  const view = render(
    <Backdrop onClose={jest.fn()}>
      <div>Modal content</div>
    </Backdrop>,
  );

  expect(background.inert).toBe(true);
  expect(document.body).toHaveStyle({ overflow: 'hidden' });

  view.unmount();

  expect(background.inert).toBe(false);
  expect(document.body).toHaveStyle({ overflow: 'scroll' });
  background.remove();
});
