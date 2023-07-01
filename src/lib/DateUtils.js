// Some utility functions for dates.  All times are represented as UTC in the spreadsheet maker,
// except (annoyingly) dates fed to and returned from the Date Picker.

// Convert a string from the server (representing a date) into an instance of javascript's Date class.
// Date strings will have the form "2022-12-31".  Arg can be null; if so return null.
export function formattedStringToDate (s) {
    if ( s ) {
        const ymd = s.split('-');
        return new Date(Date.UTC(ymd[0], ymd[1]-1, ymd[2]));
    } else {
        return null;
    }
}

// take a date and return it as a string in the format used by the server: YYYY-MM-DD
export function dateToFormattedString (date) {
    const y = date.getUTCFullYear().toString();
    const m = ('0' + (date.getUTCMonth()+1).toString()).slice(-2);
    const d = ('0' + date.getUTCDate().toString()).slice(-2);
    return y + '-' + m + '-' + d;
}

// take an instance of Date returned by the calendar widget and return a date that is midnight UTC for that same day, month, and year
export function calendarDatetoUtcDate(date) {
    return new Date(Date.UTC(date.getFullYear(), date.getMonth(), date.getDate()));
}

// Take an instance of Date relative to UTC, and turn it into a date suitable for a min or max for the calendar widget.
// For example, suppose the date is 2023-06-01.  This is represented as the Javascript date for 2023-06-01 at midnight UTC.
// Suppose also the local time zone is Pacific time, so UTC - 7 hours (given daylight savings time in June).  Return the
// Javascript Date for 2023-06-01 at 7am UTC, which in local time will be midnight 2023-06-01.
export function utcDateToCalendarDate(date) {
    return new Date(date.valueOf() + date.getTimezoneOffset() * 60 * 1000);
}
