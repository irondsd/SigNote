/**
 * @jest-environment jsdom
 */
import { render } from '@testing-library/react';
import { useTheme } from 'next-themes';
import {
  THEME_COLOR_DARK,
  THEME_COLOR_LIGHT,
  THEME_COLOR_META_ATTR,
  THEME_STORAGE_KEY,
  themeColorFor,
  themeColorInitScript,
} from '@/config/themeColors';
import { applyThemeColor, ThemeColorMeta } from '../ThemeColorMeta';

jest.mock('next-themes', () => ({ useTheme: jest.fn() }));

const mockUseTheme = useTheme as jest.MockedFunction<typeof useTheme>;

/** The pair Next renders from `viewport.themeColor`, keyed on the OS preference. */
function renderNextTags() {
  document.head.innerHTML = `
    <meta name="theme-color" media="(prefers-color-scheme: light)" content="${THEME_COLOR_LIGHT}" />
    <meta name="theme-color" media="(prefers-color-scheme: dark)" content="${THEME_COLOR_DARK}" />
  `.trim();
}

function themeColorTags() {
  return Array.from(document.querySelectorAll('meta[name="theme-color"]')).map((tag) => ({
    content: tag.getAttribute('content'),
    media: tag.getAttribute('media'),
  }));
}

function appliedColor() {
  return document.querySelector(`meta[name="theme-color"][${THEME_COLOR_META_ATTR}]`)?.getAttribute('content');
}

function mockPrefersDark(dark: boolean) {
  Object.defineProperty(window, 'matchMedia', {
    writable: true,
    value: jest.fn().mockImplementation((query: string) => ({
      matches: query.includes('dark') ? dark : !dark,
      media: query,
      addEventListener: jest.fn(),
      removeEventListener: jest.fn(),
    })),
  });
}

beforeEach(() => {
  document.head.innerHTML = '';
  localStorage.clear();
  mockPrefersDark(false);
  mockUseTheme.mockReturnValue({ resolvedTheme: 'light' } as ReturnType<typeof useTheme>);
});

describe('themeColorFor', () => {
  it('follows the theme the app is rendering', () => {
    expect(themeColorFor('dark')).toBe(THEME_COLOR_DARK);
    expect(themeColorFor('light')).toBe(THEME_COLOR_LIGHT);
  });

  it('falls back to light when the theme is not resolved yet', () => {
    expect(themeColorFor(undefined)).toBe(THEME_COLOR_LIGHT);
  });
});

describe('applyThemeColor', () => {
  it('prepends a tag carrying no media, so it wins over the rendered pair', () => {
    renderNextTags();
    applyThemeColor(THEME_COLOR_DARK);

    expect(themeColorTags()[0]).toEqual({ content: THEME_COLOR_DARK, media: null });
  });

  it('leaves the tags React rendered alone', () => {
    renderNextTags();
    applyThemeColor(THEME_COLOR_DARK);

    expect(themeColorTags().slice(1)).toEqual([
      { content: THEME_COLOR_LIGHT, media: '(prefers-color-scheme: light)' },
      { content: THEME_COLOR_DARK, media: '(prefers-color-scheme: dark)' },
    ]);
  });

  it('reuses its own tag instead of stacking new ones', () => {
    applyThemeColor(THEME_COLOR_DARK);
    applyThemeColor(THEME_COLOR_LIGHT);

    expect(themeColorTags()).toEqual([{ content: THEME_COLOR_LIGHT, media: null }]);
  });
});

describe('<ThemeColorMeta />', () => {
  it('tracks the app theme even when it disagrees with the OS', () => {
    mockPrefersDark(false);
    mockUseTheme.mockReturnValue({ resolvedTheme: 'dark' } as ReturnType<typeof useTheme>);
    render(<ThemeColorMeta />);

    expect(appliedColor()).toBe(THEME_COLOR_DARK);
  });

  it('follows a switch back to light', () => {
    mockUseTheme.mockReturnValue({ resolvedTheme: 'light' } as ReturnType<typeof useTheme>);
    const { rerender } = render(<ThemeColorMeta />);

    mockUseTheme.mockReturnValue({ resolvedTheme: 'dark' } as ReturnType<typeof useTheme>);
    rerender(<ThemeColorMeta />);
    expect(appliedColor()).toBe(THEME_COLOR_DARK);

    mockUseTheme.mockReturnValue({ resolvedTheme: 'light' } as ReturnType<typeof useTheme>);
    rerender(<ThemeColorMeta />);
    expect(appliedColor()).toBe(THEME_COLOR_LIGHT);
  });

  it('writes nothing until the theme resolves', () => {
    mockUseTheme.mockReturnValue({ resolvedTheme: undefined } as ReturnType<typeof useTheme>);
    render(<ThemeColorMeta />);

    expect(appliedColor()).toBeUndefined();
  });
});

describe('themeColorInitScript', () => {
  it('uses the stored explicit choice over the OS preference', () => {
    localStorage.setItem(THEME_STORAGE_KEY, 'dark');
    mockPrefersDark(false);

    eval(themeColorInitScript);

    expect(themeColorTags()[0]).toEqual({ content: THEME_COLOR_DARK, media: null });
  });

  it('falls back to the OS preference on "system"', () => {
    localStorage.setItem(THEME_STORAGE_KEY, 'system');
    mockPrefersDark(true);

    eval(themeColorInitScript);

    expect(appliedColor()).toBe(THEME_COLOR_DARK);
  });

  it('honours an explicit light choice on a dark phone', () => {
    localStorage.setItem(THEME_STORAGE_KEY, 'light');
    mockPrefersDark(true);

    eval(themeColorInitScript);

    expect(appliedColor()).toBe(THEME_COLOR_LIGHT);
  });

  it('hands its tag over to the component rather than being duplicated', () => {
    localStorage.setItem(THEME_STORAGE_KEY, 'dark');
    mockPrefersDark(false);
    eval(themeColorInitScript);

    mockUseTheme.mockReturnValue({ resolvedTheme: 'dark' } as ReturnType<typeof useTheme>);
    render(<ThemeColorMeta />);

    expect(themeColorTags()).toEqual([{ content: THEME_COLOR_DARK, media: null }]);
  });
});
