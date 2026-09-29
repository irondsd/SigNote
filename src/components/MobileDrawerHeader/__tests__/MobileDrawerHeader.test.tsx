/** @jest-environment jsdom */

import '@testing-library/jest-dom';
import { fireEvent, render, screen } from '@testing-library/react';
import { MobileDrawerHeader } from '@/components/MobileDrawerHeader/MobileDrawerHeader';

jest.mock('@/components/Logo/Logo', () => ({ Logo: () => <span>SigNote</span> }));

it('opens the supplied navigation and lets it close the drawer', () => {
  render(
    <MobileDrawerHeader
      title="Documentation"
      renderNavigation={(close) => <button onClick={close}>Documentation link</button>}
    />,
  );

  expect(screen.getByTestId('mobile-header')).toHaveTextContent('Documentation');
  fireEvent.click(screen.getByRole('button', { name: 'Open menu' }));
  expect(screen.getByTestId('mobile-drawer')).toHaveClass('drawerOpen');
  expect(document.querySelector('[data-drawer-open="true"]')).toBeInTheDocument();

  fireEvent.click(screen.getByRole('button', { name: 'Documentation link' }));
  expect(screen.getByTestId('mobile-drawer')).not.toHaveClass('drawerOpen');
  expect(document.querySelector('[data-drawer-open="true"]')).not.toBeInTheDocument();
});
