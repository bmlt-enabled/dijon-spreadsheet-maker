import { stringToDate } from '$lib/DateUtils';

export class Snapshot {
    constructor(rootServerId, rawDate) {
        this.rootServerId = rootServerId;
        this.date = stringToDate(rawDate);
    }
}
