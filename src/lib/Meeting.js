import { format, getYear } from 'date-fns';
import { Format } from '$lib/Format';
import { ServiceBody } from '$lib/ServiceBody';
import { stringToDate } from '$lib/DateUtils';

export class Meeting {

    constructor(json) {
        this.bmlt_id = json.bmltId;
        this.name = json.name;
        this.day = json.day;
        this.service_body_bmlt_id = json.serviceBodyBmltId;
        this.venue_type = json.venueType;
        this.start_time = json.startTime;
        this.duration = json.duration;
        this.time_zone = json.timeZone;
        this.latitude = json.latitude;
        this.longitude = json.longitude;
        this.published = json.published;
        this.world_id = json.worldId;
        this.location_text = json.locationText;
        this.location_info = json.locationInfo;
	    this.location_street = json.locationStreet;
	    this.location_city_subsection = json.locationCitySubsection;
        this.location_neighborhood = json.locationNeighborhood;
        this.location_municipality = json.locationMunicipality;
        this.location_sub_province = json.locationSubProvince;
        this.location_province = json.locationProvince;
        this.location_postal_code_1 = json.locationPostalCode1;
        this.location_nation = json.locationNation;
        this.train_lines = json.trainLines;
        this.bus_lines = json.busLines;
        this.comments = json.comments;
        this.virtual_meeting_link = json.virtualMeetingLink;
        this.phone_meeting_number = json.phoneMeetingNumber;
        this.virtual_meeting_additional_info = json.virtualMeetingAdditionalInfo;
        this.format_bmlt_ids = json.formatBmltIds;
        this.naws_code_override = json.nawsCodeOverride;
        this.service_body = new ServiceBody(json.serviceBody);
        this.formats = json.formats.map(f => new Format(f));
        // If last_changed is null in the database, unfortunately the client side library returns the Unix Epoch (1/1/1970) instead.
        // This may end up as 12/31/1969 with a time zone conversion.  Check for this, and fix up if necessary.
        this.last_changed = getYear(json.lastChanged) <= 1970 ? null : json.lastChanged;
    }

    dayString() {
        const days = ['Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday'];
        return this.day ? days[this.day - 1] : '';
    }

    serviceBodyWorldId(serviceBodies) {
        if ( this.service_body_bmlt_id ) {
            for (let i = 0; i < serviceBodies.length; i++) {
                if ( this.service_body_bmlt_id == serviceBodies[i].bmlt_id ) {
                    return serviceBodies[i].world_id;
                }
            }
        }
        return '';
    }

    serviceBodyName(serviceBodies) {
        if ( this.service_body_bmlt_id ) {
            for (let i = 0; i < serviceBodies.length; i++) {
                if ( this.service_body_bmlt_id == serviceBodies[i].bmlt_id ) {
                    return serviceBodies[i].name;
                }
            }
        }
        return '';
    }

    // Return OPEN or CLOSED depending on whether it's an open or closed meeting.  This is stored as a format.  If not explicitly marked as OPEN,
    // this defaults to CLOSED.  This isn't totally correct, since actually this default behavior can be overridden by a variable in the server's
    // configuration (although I'm not sure whether anyone uses it).  Certainly it seems safer to err on the side of saying it's CLOSED.
    openOrClosed() {
        for (let i = 0; i < this.formats.length; i++) {
            if ( this.formats[i].world_id === 'OPEN') {
                return 'OPEN';
            }
        }
        return 'CLOSED';
    }

    wheelChairAccessible() {
        for (let i = 0; i < this.formats.length; i++) {
            if ( this.formats[i].world_id === 'WCHR') {
                return 'TRUE';
            }
        }
        return 'FALSE';
    }

    // Return an array of NAWS formats for this meeting.  There are a set of preferred formats, which are listed first if present, in the
    // given order.  Then add all other NAWS formats.  Pad with empty strings if necessary so that there are at least 5 items returned.
    nawsFormats() {
        const preferredFormats = ['VM', 'TC', 'HYBR', 'W', 'M', 'GL'];
        const skipTheseFormats = ['OPEN', 'CLOSED', 'WCHR'];
        const myNawsFormats = this.formats.map( f => f.world_id ).filter( id => id != null);
        let results = [];
        for (let i = 0; i < preferredFormats.length; i++) {
            if ( myNawsFormats.includes( preferredFormats[i] ) ) {
                results.push(preferredFormats[i]);
            }
        }
        for (let i = 0; i < myNawsFormats.length; i++) {
            if ( !preferredFormats.includes( myNawsFormats[i] ) && !skipTheseFormats.includes(myNawsFormats[i]) ) {
                results.push(myNawsFormats[i]);
            }
        }
        for (let i = results.length; i < 5; i++) {
            results.push('');
        }
       return results;
    }

    nonNawsFormats() {
        let results = [];
        for (let i = 0; i < this.formats.length; i++) {
            if ( !this.formats[i].world_id ) {
                results.push(this.formats[i].name);
            }
        }
        return results.join(', ');
    }

    locationInfoAndComments() {
        let results = [];
        if ( this.location_info ) {
            results.push( this.location_info );
        }
        if ( this.comments ) {
            results.push( this.comments );
        }
        return results.join(', ');
    }

    language() {
        for (let i = 0; i < this.formats.length; i++) {
            if ( this.formats[i].world_id === 'LANG' ) {
                return this.formats[i].key_string;
            }
        }
        return '';
    }

    lastChangedExcelFormat() {
        if ( this.last_changed ) {
            return format(this.last_changed, 'MM/dd/yyy');
        } else {
            return '';
        }
    }

}
