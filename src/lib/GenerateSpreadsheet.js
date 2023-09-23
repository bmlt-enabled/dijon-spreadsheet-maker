// export a function generateSpreadsheet that generates a spreadsheet of changes, new meetings, and deletions
// generateSpreadsheet returns null if successful, otherwise an error string

import * as XLSX from 'xlsx-js-style';  // the open source version of SheetJS doesn't handle styling - use this fork instead
import { Change } from '$lib/Change';
import { Meeting } from '$lib/Meeting';
import DijonApi from '$lib/DijonApi';
import { dateToFormattedString } from '$lib/DateUtils';

// styles for export spreadsheet
const headerStyle = {font: {bold: true}};
const changedMeetingStyle = {fill: {fgColor: {rgb: "FF002B"}}};
const newMeetingStyle = {fill: {fgColor: {rgb: "4D88FF"}}};
const deletedMeetingStyle = {font: {strike: true}};

export async function generateSpreadsheet(selectedRootServer, allServiceBodies, selectedServiceBody,
        startSnapshot, endSnapshot, showOriginalNawsCodes, includeExtraMeetings, excludeWorldIdUpdates) {
    let ws = XLSX.utils.aoa_to_sheet([exportSpreadsheetHeaders(showOriginalNawsCodes)]);
    styleEntireRow(ws, 0, headerStyle);

    const startSnapshotDateStr = dateToFormattedString(startSnapshot.date);
    const endSnapshotDateStr = dateToFormattedString(endSnapshot.date);

    let rawChanges;
    try {
        rawChanges = await DijonApi.listMeetingChanges(selectedRootServer.id, startSnapshot.date, endSnapshot.date, selectedServiceBody?.bmlt_id, excludeWorldIdUpdates);
    } catch (error) {
        return `Error fetching changes - got ${error.response.status} status`;
    }

    // Dictionaries to keep track of meetings with changes, indexed by world_id and bmlt_id respectively.  The keys
    // are the important part; the value will be true if a meeting with that world_id or bmlt_id was changed.
    // World IDs are converted to upper case when used as a key in worldIdsWithChanges so that for example G1234 matches g1234.
    const worldIdsWithChanges = {};
    const bmltIdsWithChanges = {};
    let lastRow = 0;
    for (let rawChange of rawChanges.events) {
        lastRow++;
        const oldMeeting = rawChange.oldMeeting ? new Meeting(rawChange.oldMeeting) : null;
        const newMeeting = rawChange.newMeeting ? new Meeting(rawChange.newMeeting) : null;
        let oldRow;
        let newRow;
        switch (rawChange.eventType) {
            case 'MeetingCreated':
                newRow = getRowForMeeting(newMeeting, allServiceBodies, showOriginalNawsCodes);
                addMeetingData(ws, newRow, lastRow, showOriginalNawsCodes);
                styleEntireRow(ws, lastRow, newMeetingStyle);
                if (newMeeting.world_id) {
                    worldIdsWithChanges[newMeeting.world_id.toUpperCase()] = true;
                }
                bmltIdsWithChanges[newMeeting.bmlt_id] = true;
                break;
            case 'MeetingDeleted':
                oldRow = getRowForMeeting(oldMeeting, allServiceBodies, showOriginalNawsCodes);
                addMeetingData(ws, oldRow, lastRow, showOriginalNawsCodes);
                styleEntireRow(ws, lastRow, deletedMeetingStyle);
                if (oldMeeting.world_id) {
                    worldIdsWithChanges[oldMeeting.world_id.toUpperCase()] = true;
                }
                // the old_meeting won't be in the current meetings
                break;
            case 'MeetingUpdated':
                oldRow = getRowForMeeting(oldMeeting, allServiceBodies, showOriginalNawsCodes);
                newRow = getRowForMeeting(newMeeting, allServiceBodies, showOriginalNawsCodes);
                addMeetingData(ws, newRow, lastRow, showOriginalNawsCodes);
                styleChangedCells(ws, lastRow, changedMeetingStyle, oldRow, newRow);
                // these will probably be the same for the old and new meetings, but add them both anyway to be safe
                if (oldMeeting.world_id) {
                    worldIdsWithChanges[oldMeeting.world_id.toUpperCase()] = true;
                }
                if (newMeeting.world_id) {
                    worldIdsWithChanges[newMeeting.world_id.toUpperCase()] = true;
                }
                bmltIdsWithChanges[oldMeeting.bmlt_id] = true;
                bmltIdsWithChanges[newMeeting.bmlt_id] = true;
                break;
            default:
                return `internal error in generateSpreadsheet -- unknown event type: ${rawChange.eventType}`;
        }
    }
    // If includeExtraMeetings is true, add other meetings to the spreadsheet with the same world_id as a changed meeting.
    // Ignore meetings with world_ids of 'x' or 'X'.
    if (includeExtraMeetings) {
        let rawMeetings;
        try {
            rawMeetings = await DijonApi.listSnapshotMeetings(selectedRootServer.id, endSnapshotDateStr, selectedServiceBody?.bmlt_id);
        } catch (error) {
            return `Error fetching extra meetings - got ${error.response.status} status`;
        }

        for (let rawMeeting of rawMeetings) {
            const meeting = new Meeting(rawMeeting);
            if (meeting.world_id && meeting.world_id.toUpperCase()!=='X' && meeting.world_id.toUpperCase() in worldIdsWithChanges && !(meeting.bmlt_id in bmltIdsWithChanges)) {
                lastRow++;
                const row = getRowForMeeting(meeting, allServiceBodies, showOriginalNawsCodes);
                addMeetingData(ws, row, lastRow, showOriginalNawsCodes);
            }
        }
    }
    const workbook = XLSX.utils.book_new();
    XLSX.utils.book_append_sheet(workbook, ws, "Changes");
    const fileName = `BMLT_${selectedServiceBody.world_id}_changes_from_${startSnapshotDateStr}_to_${endSnapshotDateStr}.xlsx`;
    // use writeFile since writeFileXLSX isn't available in the xlsx-js-style fork
    XLSX.writeFile(workbook, fileName);
    return null;
}

function addMeetingData(ws, row, rowIndex, showOriginalNawsCodes) {
    // change nulls to empty strings (nulls in the spreadsheet won't accept the style changes)
    const newRow = row.map( c => c === null ? '' : c);
    XLSX.utils.sheet_add_aoa(ws, [newRow], {origin: -1});
    // fix the format on the LastChanged column to be a date -- all others can remain general format
    // (Excel didn't like having an empty value with a date format, hence the check)
    const lastChangedCol = exportSpreadsheetHeaders(showOriginalNawsCodes).indexOf('LastChanged');
    if ( row[lastChangedCol] ) {
        const cell_ref = XLSX.utils.encode_cell({c: exportSpreadsheetHeaders(showOriginalNawsCodes).indexOf('LastChanged'), r: rowIndex});
        ws[cell_ref].t = 'd';
    }
}

// if you change the headers below, make sure to also change the return value in the getRowForMeeting function
function exportSpreadsheetHeaders(showOriginalNawsCodes) {
    const committees = showOriginalNawsCodes ? ['Committee', 'Original'] : ['Committee'];
    return  committees.concat([
        'CommitteeName',
        'AreaRegion',
        'ParentName',
        'Day',
        'Time',
        'Room',
        'Closed',
        'WheelChr',
        'Place',
        'Address',
        'City',
        'LocBorough',
        'State',
        'Zip',
        'Directions',
        'Format1',
        'Format2',
        'Format3',
        'Format4',
        'Format5',
        'Language1',
        'Language2',
        'Language3',
        'unpublished',
        'VirtualMeetingLink',
        'VirtualMeetingInfo',
        'PhoneMeetingNumber',
        'Country',
        'LastChanged',
        'Longitude',
        'Latitude',
        'TimeZone',
        'bmlt_id',
    ]);
}

// if you change the return value in the getRowForMeeting function, be sure to also change exportSpreadsheetHeaders
function getRowForMeeting(meeting, allServiceBodies, showOriginalNawsCodes) {
    const worldId = meeting.naws_code_override ?? meeting.world_id;
    const original = meeting.naws_code_override ? meeting.world_id : '';
    const worldIdCols = showOriginalNawsCodes ? [worldId, original] : [worldId];
    const formats = meeting.nawsFormats();
    return worldIdCols.concat([
        // first column or two are Committee and maybe Original
        meeting.name,                                  // CommitteeName
        meeting.serviceBodyWorldId(allServiceBodies),  // AreaRegion
        meeting.serviceBodyName(allServiceBodies),     // ParentName
        meeting.dayString(),                           // Day
        meeting.start_time,                            // Time -- TODO fix the formatting (no seconds, colons etc)
        meeting.nonNawsFormats(),                      // Room  this is actually non-NAWS formats, despite the column name
        meeting.openOrClosed(),                        // Closed
        meeting.wheelChairAccessible(),                // WheelChr
        meeting.location_text,                         // Place
        meeting.location_street,                       // Address
        meeting.location_municipality,                 // City
        meeting.location_neighborhood,                 // LocBorough
        meeting.location_province,                     // State
        meeting.location_postal_code_1,                // Zip
        meeting.locationInfoAndComments(),             // Directions
        formats[0],                                    // Format1
        formats[1],                                    // Format2
        formats[2],                                    // Format3
        formats[3],                                    // Format4
        formats[4],                                    // Format5
        meeting.language(),                            // Language1
        '',                                            // Language2 -- maybe omit since always empty?
        '',                                            // Language3 -- maybe omit since always empty?
        meeting.published ? '' : '1',                  // unpublished
        meeting.virtual_meeting_link,                  // VirtualMeetingLink
        meeting.virtual_meeting_additional_info,       // VirtualMeetingInfo
        meeting.phone_meeting_number,                  // PhoneMeetingNumber
        meeting.location_nation,                       // Country
        meeting.lastChangedExcelFormat(),              // LastChanged
        meeting.longitude,                             // Longitude
        meeting.latitude,                              // Latitude
        meeting.time_zone,                             // TimeZone
        meeting.bmlt_id,                               // bmlt_id
    ]);
}

// apply a style to every cell in the given row
function styleEntireRow(ws, row, style) {
    for (let i = 0; i < exportSpreadsheetHeaders().length; i++) {
        let cell_ref = XLSX.utils.encode_cell({c: i, r: row});
        ws[cell_ref].s = style;
    }
}

function styleChangedCells(ws, row, style, oldRow, newRow) {
    for (let i = 0; i < newRow.length; i++) {
        if ( oldRow[i] != newRow[i] ) {
            let cell_ref = XLSX.utils.encode_cell({c: i, r: row});
            ws[cell_ref].s = style;
        }
    }
}
