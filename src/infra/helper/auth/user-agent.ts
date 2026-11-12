export type DeviceKind = 'desktop' | 'mobile' | 'tablet' | 'unknown';

export interface ParsedUserAgent {
  device: DeviceKind;
  browser: string | null;
  os: string | null;
}

// Order matters: Edge and Opera also say Chrome, Chrome also says Safari
const BROWSERS: [RegExp, string][] = [
  [/\b(Edg|EdgA|EdgiOS)\//, 'Edge'],
  [/\bOPR\/|\bOpera\b/, 'Opera'],
  [/\bYaBrowser\//, 'Yandex Browser'],
  [/\bSamsungBrowser\//, 'Samsung Internet'],
  [/\b(Firefox|FxiOS)\//, 'Firefox'],
  [/\b(Chrome|CriOS)\//, 'Chrome'],
  [/\bSafari\//, 'Safari'],
];

const SYSTEMS: [RegExp, string][] = [
  [/\bWindows\b/, 'Windows'],
  [/\bAndroid\b/, 'Android'],
  [/\b(iPhone|iPad|iPod)\b/, 'iOS'],
  [/\bMac OS X\b|\bMacintosh\b/, 'macOS'],
  [/\bCrOS\b/, 'ChromeOS'],
  [/\bLinux\b/, 'Linux'],
];

const first = (table: [RegExp, string][], ua: string) =>
  table.find(([re]) => re.test(ua))?.[1] ?? null;

/** Coarse device, browser and OS from a User-Agent, enough to recognise one's own sessions. */
export function parseUserAgent(ua: string | null | undefined): ParsedUserAgent {
  const value = ua ?? '';
  if (!value) return { device: 'unknown', browser: null, os: null };
  const os = first(SYSTEMS, value);
  let device: DeviceKind = 'unknown';
  if (/\biPad\b|\bTablet\b/.test(value)) device = 'tablet';
  else if (/Android/.test(value) && !/Mobile/.test(value)) device = 'tablet';
  else if (/Mobile|iPhone|iPod|Android/.test(value)) device = 'mobile';
  else if (os) device = 'desktop';
  return { device, browser: first(BROWSERS, value), os };
}

/** Hides the host part of an address: `203.0.*.*` for IPv4, the first two groups for IPv6. */
export function maskIp(ip: string | null | undefined): string | null {
  if (!ip) return null;
  const v4 = ip.replace(/^::ffff:/i, '');
  if (/^\d{1,3}(\.\d{1,3}){3}$/.test(v4)) {
    const [a, b] = v4.split('.');
    return `${a}.${b}.*.*`;
  }
  if (ip.includes(':')) {
    const groups = ip.split(':').filter(Boolean);
    return groups.length ? `${groups.slice(0, 2).join(':')}:*` : null;
  }
  return null;
}
