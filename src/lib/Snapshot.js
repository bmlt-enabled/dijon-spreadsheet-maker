import { stringToDate } from '$lib/DateUitls';

export class Snapshot {
    constructor(rootServerId, rawDate) {
        this.rootServerId = rootServerId;
        this.date = stringToDate(rawDate);
    }
}
