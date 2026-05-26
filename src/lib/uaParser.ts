import { UAParser } from 'ua-parser-js';
import type { DeviceType } from '@/models/AuthSession';

export type ParsedUA = {
  browser: string;
  os: string;
  deviceType: DeviceType;
};

const mapDeviceType = (raw: string | undefined): DeviceType => {
  if (raw === 'mobile') return 'mobile';
  if (raw === 'tablet') return 'tablet';
  if (raw === undefined || raw === '') return 'desktop'; // UAParser leaves device.type empty for desktop
  return 'unknown';
};

export const parseUserAgent = (userAgent: string): ParsedUA => {
  if (!userAgent) {
    return { browser: 'Unknown', os: 'Unknown', deviceType: 'unknown' };
  }
  const parser = new UAParser(userAgent);
  const { browser, os, device } = parser.getResult();
  return {
    browser: [browser.name, browser.version].filter(Boolean).join(' ') || 'Unknown',
    os: [os.name, os.version].filter(Boolean).join(' ') || 'Unknown',
    deviceType: mapDeviceType(device.type),
  };
};
