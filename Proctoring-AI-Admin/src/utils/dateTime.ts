const SERVER_TS_WITHOUT_TZ = /^\d{4}-\d{2}-\d{2}[T ]\d{2}:\d{2}:\d{2}(?:\.\d+)?$/;
const SERVER_TS_HAS_TZ = /(Z|[+-]\d{2}:\d{2})$/i;

const normalizeServerTimestamp = (value: string): string => {
  const trimmed = value.trim();
  if (!trimmed) {
    return '';
  }

  const normalized = trimmed.replace(' ', 'T');
  if (SERVER_TS_WITHOUT_TZ.test(normalized) && !SERVER_TS_HAS_TZ.test(normalized)) {
    return `${normalized}Z`;
  }

  return normalized;
};

export const parseServerDate = (
  value: string | number | Date | null | undefined
): Date | null => {
  if (value == null || value === '') {
    return null;
  }

  if (value instanceof Date) {
    return Number.isNaN(value.getTime()) ? null : value;
  }

  const normalized = typeof value === 'string' ? normalizeServerTimestamp(value) : value;
  const parsed = new Date(normalized);
  return Number.isNaN(parsed.getTime()) ? null : parsed;
};

export const toTimestampMs = (value: string | number | Date | null | undefined): number => {
  const parsed = parseServerDate(value);
  return parsed ? parsed.getTime() : 0;
};

export const formatServerDateTime = (
  value: string | number | Date | null | undefined,
  options: Intl.DateTimeFormatOptions = { dateStyle: 'medium', timeStyle: 'short' },
  locale?: string | string[]
): string => {
  const parsed = parseServerDate(value);
  if (!parsed) {
    return 'N/A';
  }

  return new Intl.DateTimeFormat(locale, options).format(parsed);
};

export const formatServerDate = (
  value: string | number | Date | null | undefined,
  locale?: string | string[]
): string => formatServerDateTime(value, { dateStyle: 'medium' }, locale);

export const formatServerTime = (
  value: string | number | Date | null | undefined,
  options: Intl.DateTimeFormatOptions = { hour: '2-digit', minute: '2-digit' },
  locale?: string | string[]
): string => formatServerDateTime(value, options, locale);
