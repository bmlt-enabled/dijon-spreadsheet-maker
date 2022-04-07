// Utility function to convert a string from the server (representing a date) into an instance of javascript's Date class.
// Date strings will have the form "2022-12-31".  Arg can be null; if so return null.
export function makeDate (s) {
    if ( s ) {
        const ymd = s.split('-');
        return new Date(ymd[0], ymd[1]-1, ymd[2]);
    } else {
        return null;
    }
}
