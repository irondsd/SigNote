'use client';

import { useTheme } from 'next-themes';
import { Sun, Moon, Monitor } from 'lucide-react';
import { useEffect, useState } from 'react';
import styles from './ThemeToggle.module.scss';

export function ThemeToggle() {
  const { theme, setTheme } = useTheme();
  const [mounted, setMounted] = useState(false);

  useEffect(() => setMounted(true), []);

  if (!mounted) return <div className={styles.toggle} />;

  return (
    <div className={styles.toggle}>
      <button
        className={`${styles.btn} ${theme === 'light' ? styles.active : ''}`}
        onClick={() => setTheme('light')}
        title="Light theme"
      >
        <Sun size={15} />
      </button>
      <button
        className={`${styles.btn} ${theme === 'system' ? styles.active : ''}`}
        onClick={() => setTheme('system')}
        title="System theme"
      >
        <Monitor size={15} />
      </button>
      <button
        className={`${styles.btn} ${theme === 'dark' ? styles.active : ''}`}
        onClick={() => setTheme('dark')}
        title="Dark theme"
      >
        <Moon size={15} />
      </button>
    </div>
  );
}
