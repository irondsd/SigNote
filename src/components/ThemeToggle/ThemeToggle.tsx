'use client';

import { useTheme } from 'next-themes';
import { Sun, Moon, Monitor } from 'lucide-react';
import { Button } from '@/components/ui/button';
import styles from './ThemeToggle.module.scss';

export function ThemeToggle() {
  const { theme, setTheme } = useTheme();

  return (
    <div className={styles.toggle}>
      <Button
        variant="ghost"
        size="icon-xs"
        className={theme === 'light' ? 'bg-background text-foreground shadow-sm' : ''}
        onClick={() => setTheme('light')}
        title="Light theme"
      >
        <Sun size={15} />
      </Button>
      <Button
        variant="ghost"
        size="icon-xs"
        className={theme === 'system' ? 'bg-background text-foreground shadow-sm' : ''}
        onClick={() => setTheme('system')}
        title="System theme"
      >
        <Monitor size={15} />
      </Button>
      <Button
        variant="ghost"
        size="icon-xs"
        className={theme === 'dark' ? 'bg-background text-foreground shadow-sm' : ''}
        onClick={() => setTheme('dark')}
        title="Dark theme"
      >
        <Moon size={15} />
      </Button>
    </div>
  );
}
