import { useState, useEffect, useCallback } from "react";

export const breakpoints = {
  xs: 375,
  sm: 600,
  md: 900,
  lg: 1200,
  xl: 1440,
} as const;

type Breakpoints = keyof typeof breakpoints;

export const getCurrentBreakpoint = (width: number): Breakpoints => {
  const breakpointEntries = Object.entries(breakpoints);

  for (let i = 0; i < breakpointEntries.length; i++) {
    const [breakpoint, breakpointValue] = breakpointEntries[i];
    const nextBreakpointValue = breakpointEntries[i + 1]?.[1];

    if (
      width >= breakpointValue &&
      (width < nextBreakpointValue || !nextBreakpointValue)
    ) {
      return breakpoint as Breakpoints;
    }
  }

  // If width is smaller than the smallest breakpoint, return the smallest breakpoint
  return "xs";
};

function iOS() {
  return [
    "iPad Simulator",
    "iPhone Simulator",
    "iPod Simulator",
    "iPad",
    "iPhone",
    "iPod",
  ].includes(navigator.platform);
}

const getMedia = () => {
  const width =
    window.innerWidth ||
    document.documentElement.clientWidth ||
    document.body.clientWidth;
  const isIOS = iOS();

  const currentBreakpoint = getCurrentBreakpoint(width);

  return {
    isMobile: width < breakpoints.md,
    isIOS,
    breakpoint: currentBreakpoint,
  };
};

export const useDevice = () => {
  const [state, setState] = useState({
    isMobile: false,
    isIOS: false,
    breakpoint: "xl" as Breakpoints,
  });

  const [isHydrated, setIsHydrated] = useState(false);

  const handleResize = useCallback(() => {
    const media = getMedia();

    if (
      media.isMobile !== state.isMobile ||
      media.breakpoint !== state.breakpoint
    ) {
      setState(media);
    }
  }, [state]);

  useEffect(() => {
    // Set hydrated flag first
    // eslint-disable-next-line react-hooks/set-state-in-effect
    setIsHydrated(true);

    handleResize();
    window.addEventListener("resize", handleResize);

    return () => {
      window.removeEventListener("resize", handleResize);
    };
  }, [handleResize]);

  return { ...state, isHydrated };
};
