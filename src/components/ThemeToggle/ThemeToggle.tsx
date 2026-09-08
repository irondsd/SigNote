'use client';

import { useTheme } from 'next-themes';
import { Sun, Moon, Monitor } from 'lucide-react';
import { Button } from '@/components/ui/button';
import s from './ThemeToggle.module.scss';

export function ThemeToggle() {
  const { theme, setTheme } = useTheme();

  return (
    <div className={s.toggle}>
      <Button
        variant="ghost"
        size="icon-md"
        className={theme === 'light' ? s.selected : ''}
        onClick={() => setTheme('light')}
        title="Light theme"
        aria-label="Use light theme"
        aria-pressed={theme === 'light'}
        data-testid="light-theme-btn"
      >
        <Sun size={15} />
      </Button>
      <Button
        variant="ghost"
        size="icon-md"
        className={theme === 'system' ? s.selected : ''}
        onClick={() => setTheme('system')}
        title="System theme"
        aria-label="Use system theme"
        aria-pressed={theme === 'system'}
        data-testid="system-theme-btn"
      >
        <Monitor size={15} />
      </Button>
      <Button
        variant="ghost"
        size="icon-md"
        className={theme === 'dark' ? s.selected : ''}
        onClick={() => setTheme('dark')}
        title="Dark theme"
        aria-label="Use dark theme"
        aria-pressed={theme === 'dark'}
        data-testid="dark-theme-btn"
      >
        <Moon size={15} />
      </Button>
    </div>
  );
}
