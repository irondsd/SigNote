/** @jest-environment jsdom */

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

const mockedUseTheme = jest.mocked(useTheme);

/** The pair Next renders from `viewport.themeColor`, keyed on the OS preference. */
function seedRenderedMetaTags() {
  document.head.innerHTML = `
    <meta charset="utf-8" />
    <meta name="theme-color" media="(prefers-color-scheme: light)" content="${THEME_COLOR_LIGHT}" />
    <meta name="theme-color" media="(prefers-color-scheme: dark)" content="${THEME_COLOR_DARK}" />
  `;
}

function themeColorTags() {
  return Array.from(document.querySelectorAll('meta[name="theme-color"]')).map((tag) => ({
    content: tag.getAttribute('content'),
    media: tag.getAttribute('media'),
  }));
}

function appliedColor() {
  return document
    .querySelector(`meta[name="theme-color"][${THEME_COLOR_META_ATTR}]`)
    ?.getAttribute('content');
}

function mockPrefersDark(matches: boolean) {
  window.matchMedia = jest.fn().mockReturnValue({ matches }) as unknown as typeof window.matchMedia;
}

beforeEach(() => {
  document.head.innerHTML = '';
  localStorage.clear();
});

describe('themeColorFor', () => {
  it('maps the resolved theme onto the header surface', () => {
    expect(themeColorFor('dark')).toBe(THEME_COLOR_DARK);
    expect(themeColorFor('light')).toBe(THEME_COLOR_LIGHT);
  });

  it('falls back to light when the theme is not resolved yet', () => {
    expect(themeColorFor(undefined)).toBe(THEME_COLOR_LIGHT);
  });
});

describe('applyThemeColor', () => {
  it('wins over the rendered tags by prepending one that matches any preference', () => {
    seedRenderedMetaTags();
    applyThemeColor(THEME_COLOR_DARK);

    expect(themeColorTags()[0]).toEqual({ content: THEME_COLOR_DARK, media: null });
  });

  it('leaves the rendered tags untouched, so React keeps owning them', () => {
    seedRenderedMetaTags();
    applyThemeColor(THEME_COLOR_DARK);

    expect(themeColorTags().slice(1)).toEqual([
      { content: THEME_COLOR_LIGHT, media: '(prefers-color-scheme: light)' },
      { content: THEME_COLOR_DARK, media: '(prefers-color-scheme: dark)' },
    ]);
  });

  it('reuses its own tag instead of stacking one per theme change', () => {
    applyThemeColor(THEME_COLOR_DARK);
    applyThemeColor(THEME_COLOR_LIGHT);

    expect(themeColorTags()).toEqual([{ content: THEME_COLOR_LIGHT, media: null }]);
  });
});

describe('<ThemeColorMeta />', () => {
  it('follows the in-app theme rather than the OS preference', () => {
    seedRenderedMetaTags();
    mockedUseTheme.mockReturnValue({ resolvedTheme: 'dark' } as ReturnType<typeof useTheme>);

    render(<ThemeColorMeta />);

    expect(appliedColor()).toBe(THEME_COLOR_DARK);
  });

  it('leaves the rendered tags to decide until the theme resolves', () => {
    seedRenderedMetaTags();
    mockedUseTheme.mockReturnValue({ resolvedTheme: undefined } as ReturnType<typeof useTheme>);

    render(<ThemeColorMeta />);

    expect(appliedColor()).toBeUndefined();
  });
});

describe('themeColorInitScript', () => {
  it('paints the stored theme before hydration, overriding a lighter OS preference', () => {
    seedRenderedMetaTags();
    localStorage.setItem(THEME_STORAGE_KEY, 'dark');
    mockPrefersDark(false);

    eval(themeColorInitScript);

    expect(themeColorTags()[0]).toEqual({ content: THEME_COLOR_DARK, media: null });
  });

  it('falls back to the OS preference when the theme follows the system', () => {
    seedRenderedMetaTags();
    localStorage.setItem(THEME_STORAGE_KEY, 'system');
    mockPrefersDark(true);

    eval(themeColorInitScript);

    expect(appliedColor()).toBe(THEME_COLOR_DARK);
  });

  it('is picked up by the effect rather than duplicated', () => {
    seedRenderedMetaTags();
    localStorage.setItem(THEME_STORAGE_KEY, 'dark');
    mockPrefersDark(false);
    eval(themeColorInitScript);

    mockedUseTheme.mockReturnValue({ resolvedTheme: 'light' } as ReturnType<typeof useTheme>);
    render(<ThemeColorMeta />);

    expect(themeColorTags().filter((tag) => tag.media === null)).toEqual([
      { content: THEME_COLOR_LIGHT, media: null },
    ]);
  });
});
