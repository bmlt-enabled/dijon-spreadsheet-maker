// export a function generateSpreadsheet that generates a spreadsheet of changes, new meetings, and deletions
// generateSpreadsheet returns null if successful, otherwise an error string

import { format } from 'date-fns';
import * as XLSX from 'xlsx-js-style';  // the open source version of SheetJS doesn't handle styling - use this fork instead
import { Change } from '$lib/Change';
import { Meeting } from '$lib/Meeting';

// styles for export spreadsheet
const headerStyle = {font: {bold: true}};
const changedMeetingStyle = {fill: {fgColor: {rgb: "FF002B"}}};
const newMeetingStyle = {fill: {fgColor: {rgb: "4D88FF"}}};
const deletedMeetingStyle = {font: {strike: true}};

export async function generateSpreadsheet(dijonBaseUrl, selectedRootServer, allServiceBodies, selectedServiceBody,
        startSnapshot, endSnapshot, showOriginalNawsCodes, includeExtraMeetings, excludeWorldIdUpdates) {
    let ws = XLSX.utils.aoa_to_sheet([exportSpreadsheetHeaders(showOriginalNawsCodes)]);
    styleEntireRow(ws, 0, headerStyle);
    // for the changesUrl,    need to wait until root server, service body, and dates are known
    const changesUrl = new URL(`rootservers/${selectedRootServer.id}/meetings/changes`, dijonBaseUrl);
    const nawsCodesUrl = new URL(`rootservers/${selectedRootServer.id}/meetings/nawscodes`, dijonBaseUrl);
    const startSnapshotDateStr = format(startSnapshot.date, 'yyyy-MM-dd');
    const endSnapshotDateStr = format(endSnapshot.date, 'yyyy-MM-dd');
    changesUrl.searchParams.append("start_date", startSnapshotDateStr);
    changesUrl.searchParams.append("end_date", endSnapshotDateStr);
    changesUrl.searchParams.append("service_body_bmlt_ids", selectedServiceBody.bmlt_id);
    changesUrl.searchParams.append("exclude_world_id_updates", excludeWorldIdUpdates);
    const changesResponse = await fetch(changesUrl);
    if (!changesResponse.ok) {
        return `Error fetching changes - got ${changesResponse.status} status from ${changesUrl}`;
    }
    const rawChanges = await changesResponse.json();
    const nawsCodesResponse = await fetch(nawsCodesUrl);
    if (!nawsCodesResponse.ok) {
        return `Error fetching NAWS codes - got ${nawsCodesResponse.status} status from ${nawsCodesUrl}`;
    }
    const rawNawsCodes = await nawsCodesResponse.json();
    let nawsCodeDict = {};
    for (let rawNawsCode of rawNawsCodes) {
        nawsCodeDict[rawNawsCode.bmlt_id] = rawNawsCode.code;
    }
    // Dictionaries to keep track of meetings with changes, indexed by world_id and bmlt_id respectively.  The keys
    // are the important part; the value will be true if a meeting with that world_id or bmlt_id was changed.
    const worldIdsWithChanges = {};
    const bmltIdsWithChanges = {};
    let lastRow = 0;
    for (let rawChange of rawChanges.events) {
        lastRow++;
        const change = new Change(rawChange);
        let oldRow;
        let newRow;
        switch (change.event_type) {
            case 'MeetingCreated':
                newRow = getRowForMeeting(change.new_meeting, allServiceBodies, nawsCodeDict, showOriginalNawsCodes);
                addMeetingData(ws, newRow, lastRow, showOriginalNawsCodes);
                styleEntireRow(ws, lastRow, newMeetingStyle);
                worldIdsWithChanges[change.new_meeting.world_id] = true;
                bmltIdsWithChanges[change.new_meeting.bmlt_id] = true;
                break;
            case 'MeetingDeleted':
                oldRow = getRowForMeeting(change.old_meeting, allServiceBodies, nawsCodeDict, showOriginalNawsCodes);
                addMeetingData(ws, oldRow, lastRow, showOriginalNawsCodes);
                styleEntireRow(ws, lastRow, deletedMeetingStyle);
                worldIdsWithChanges[change.old_meeting.world_id] = true;
                // the old_meeting won't be in the current meetings
                break;
            case 'MeetingUpdated':
                oldRow = getRowForMeeting(change.old_meeting, allServiceBodies, nawsCodeDict, showOriginalNawsCodes);
                newRow = getRowForMeeting(change.new_meeting, allServiceBodies, nawsCodeDict, showOriginalNawsCodes);
                addMeetingData(ws, newRow, lastRow, showOriginalNawsCodes);
                styleChangedCells(ws, lastRow, changedMeetingStyle, oldRow, newRow);
                // these will probably be the same for the old and new meetings, but add them both anyway to be safe
                worldIdsWithChanges[change.old_meeting.world_id] = true;
                worldIdsWithChanges[change.new_meeting.world_id] = true;
                bmltIdsWithChanges[change.old_meeting.bmlt_id] = true;
                bmltIdsWithChanges[change.new_meeting.bmlt_id] = true;
                break;
            default:
                return `internal error in generateSpreadsheet -- unknown event type: ${change.event_type}`;
        }
    }
    // If includeExtraMeetings is true, add other meetings to the spreadsheet with the same world_id as a changed meeting.
    if (includeExtraMeetings) {
        const meetingsUrl = new URL(`rootservers/${selectedRootServer.id}/snapshots/${endSnapshotDateStr}/meetings`, dijonBaseUrl);
        meetingsUrl.searchParams.append("service_body_bmlt_ids", selectedServiceBody.bmlt_id);
        const meetingsResponse = await fetch(meetingsUrl);
        if (!meetingsResponse.ok) {
            return `Error fetching extra meetings - got ${meetingsResponse.status} status from ${meetingsUrl}`;
        }
        const rawMeetings = await meetingsResponse.json();
        for (let rawMeeting of rawMeetings) {
            const meeting = new Meeting(rawMeeting);
            if (meeting.world_id && meeting.world_id in worldIdsWithChanges && !(meeting.bmlt_id in bmltIdsWithChanges)) {
                lastRow++;
                const row = getRowForMeeting(meeting, allServiceBodies, nawsCodeDict, showOriginalNawsCodes);
                addMeetingData(ws, row, lastRow);
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
function getRowForMeeting(meeting, allServiceBodies, nawsCodeDict, showOriginalNawsCodes) {
    const overridden = nawsCodeDict.hasOwnProperty(meeting.bmlt_id);
    const worldId = overridden ? nawsCodeDict[meeting.bmlt_id] : meeting.world_id;
    const original = overridden ? meeting.world_id : '';
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