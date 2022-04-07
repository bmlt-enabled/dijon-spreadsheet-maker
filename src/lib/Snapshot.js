import { makeDate } from '$lib/makeDate';

export class Snapshot {
    constructor(rootServerId, rawDate) {
        this.rootServerId = rootServerId;
        this.date = makeDate(rawDate);
    }
}
