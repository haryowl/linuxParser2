/**
 * Format a Date/ISO value as YYYY-MM-DD HH:mm:ss in a fixed IANA timezone.
 * Defaults to Asia/Jakarta so Data SM preview (browser) and export (server)
 * stay aligned regardless of the host TZ.
 */
function formatDateTimeYmdHms(value, timeZone = process.env.DISPLAY_TIMEZONE || 'Asia/Jakarta') {
    if (value == null || value === '') {
        return '';
    }
    const date = value instanceof Date ? value : new Date(value);
    if (Number.isNaN(date.getTime())) {
        return '';
    }

    const parts = new Intl.DateTimeFormat('en-GB', {
        timeZone,
        year: 'numeric',
        month: '2-digit',
        day: '2-digit',
        hour: '2-digit',
        minute: '2-digit',
        second: '2-digit',
        hour12: false
    }).formatToParts(date);

    const get = (type) => parts.find((part) => part.type === type)?.value || '';
    return `${get('year')}-${get('month')}-${get('day')} ${get('hour')}:${get('minute')}:${get('second')}`;
}

/** Empty string for null/undefined only — preserves numeric 0. */
function cellValue(value) {
    return value === null || value === undefined ? '' : value;
}

module.exports = {
    formatDateTimeYmdHms,
    cellValue
};
