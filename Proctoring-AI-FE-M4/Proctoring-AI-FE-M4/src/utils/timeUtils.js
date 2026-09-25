export const formatTime = (seconds) => {
    const minutes = Math.floor(seconds / 60);
    const remainingSeconds = seconds % 60;
    return `${minutes.toString().padStart(2, '0')}:${remainingSeconds.toString().padStart(2, '0')}`;
};

const SERVER_TS_WITHOUT_TZ = /^\d{4}-\d{2}-\d{2}[T ]\d{2}:\d{2}:\d{2}(?:\.\d+)?$/;
const SERVER_TS_HAS_TZ = /(Z|[+-]\d{2}:\d{2})$/i;

const normalizeServerTimestamp = (value) => {
    if (typeof value !== 'string') {
        return value;
    }

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

export const parseServerDate = (value) => {
    if (value == null || value === '') {
        return null;
    }

    if (value instanceof Date) {
        return Number.isNaN(value.getTime()) ? null : value;
    }

    const normalized = normalizeServerTimestamp(value);
    const parsed = new Date(normalized);
    return Number.isNaN(parsed.getTime()) ? null : parsed;
};

export const toTimestampMs = (value) => {
    const parsed = parseServerDate(value);
    return parsed ? parsed.getTime() : 0;
};

export const formatServerDateTime = (
    value,
    locale = undefined,
    options = { dateStyle: 'medium', timeStyle: 'short' }
) => {
    const parsed = parseServerDate(value);
    if (!parsed) {
        return 'To be announced';
    }

    return new Intl.DateTimeFormat(locale, options).format(parsed);
};

export const formatServerTime = (
    value,
    locale = undefined,
    options = { hour: '2-digit', minute: '2-digit' }
) => {
    const parsed = parseServerDate(value);
    if (!parsed) {
        return 'N/A';
    }

    return new Intl.DateTimeFormat(locale, options).format(parsed);
};
