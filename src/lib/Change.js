import { Meeting } from '$lib/Meeting';

export class Change {
    constructor(json) {
        this.event_type = json.event_type;  // should this be camel case to match javascript style?
        this.old_meeting = json.old_meeting ? new Meeting(json.old_meeting) : null;
        this.new_meeting = json.new_meeting ? new Meeting(json.new_meeting) : null;
        this.changed_fields = json.changed_fields;
    }
}
