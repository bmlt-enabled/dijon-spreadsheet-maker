<svelte:head>
    <title>Dijon Spreadsheet Query Builder</title>
</svelte:head>

<script>
    import { onMount } from 'svelte';
    import { format, isEqual, isBefore } from 'date-fns';
    import { DateInput } from 'date-picker-svelte'
    import * as XLSX from 'xlsx-js-style';  // the open source version of SheetJS doesn't handle styling - use this fork instead
    import { Change } from '$lib/Change';
    import { Format } from '$lib/Format';
    import { Meeting } from '$lib/Meeting';
    import { RootServer } from '$lib/RootServer';
    import { ServiceBody } from '$lib/ServiceBody';
    import { Snapshot } from '$lib/Snapshot';
    import { makePureDate } from '$lib/DateUitls';

    const dijonBaseUrl = 'https://dijon-api.bmlt.io/';
    const rootServersUrl = new URL('rootservers', dijonBaseUrl);
    let rootServers;
    let selectedRootServer;
    let snapshots;         // all snapshots for the selected server
    let firstSnapshot;     // first snapshot for the selected server
    let lastSnapshot;      // last snapshot for the selected server
    let rawStartDate;      // start date as selected from the calendar
    let startDate;         // start date with time set to the default (midnight in current time zone)
    let rawEndDate;        // end date as selected from the calendar
    let endDate;           // end date with time set to the default (midnight in current time zone)
    let startSnapshot;     // closest available snapshot on or before startDate
    let endSnapshot;       // closest available snapshot on or before endDate
    let allServiceBodies;  // service bodies for the root server as of last snapshot date
    let selectFromOnlyZonesAndRegions = true;
    let serviceBodies;     // service bodies to show in menu
    let selectedServiceBody;
    let includeExtraMeetings = true;
    let excludeWorldIdUpdates = true;

    // errors -- these will be either null if no error, or a descriptive string
    let rootServersError = null;            // error retrieving the list of root servers
    let snapshotsError = null;              // error retrieving the snapshots from the selected root server
    let serviceBodiesError = null;          // error retrieving the service bodies from the selected snapshot
    let dateSelectionError = null;          // error if the start snapshot date isn't before the end snapshot date
    let changesError = null;                // error retrieving the set of changed meetings
    let meetingsError = null;               // error retrieving all the meetings (used if includeExtraMeetings is true)
    // warnings
    let missingStartSnapshotWarning = null; // warning if there isn't a snapshot exactly on the startDate
    let missingEndSnapshotWarning = null;   // warning if there isn't a snapshot exactly on the endDate
    // arrays of all non-null errors and warnings;
    let errors = [];
    let warnings = [];

    // styles for export spreadsheet
    const headerStyle = {font: {bold: true}};
    const changedMeetingStyle = {fill: {fgColor: {rgb: "FF002B"}}};
    const newMeetingStyle = {fill: {fgColor: {rgb: "4D88FF"}}};
    const deletedMeetingStyle = {font: {strike: true}};

    onMount(() => {
        fetchRootServers();
    });

    $: rawStartDate && (startDate = makePureDate(rawStartDate));
    $: rawEndDate && (endDate = makePureDate(rawEndDate));
    $: selectedRootServer && startDate && (startSnapshot = findSnapshot(startDate));
    $: selectedRootServer && endDate && (endSnapshot = findSnapshot(endDate));
    $: selectedRootServer && endSnapshot && fetchServiceBodies(selectedRootServer, endSnapshot);
    $: selectedRootServer && startSnapshot && endSnapshot && (dateSelectionError = isBefore(startSnapshot.date, endSnapshot.date) ? null :
        'Error: start snapshot must be before end snapshot');
    $: selectedRootServer && startDate && startSnapshot && (missingStartSnapshotWarning = isEqual(startSnapshot.date,startDate) ? null :
        `Warning: couldn't find a snapshot on the exact start date -- using one from ${format(startSnapshot.date, 'yyyy-MM-dd')} instead`);
    $: selectedRootServer && endDate && endSnapshot && (missingEndSnapshotWarning = isEqual(endSnapshot.date,endDate) ? null :
        `Warning: couldn't find a snapshot on the exact end date -- using one from ${format(endSnapshot.date, 'yyyy-MM-dd')} instead`);
    $: errors = concatErrorsOrWarnings(rootServersError, snapshotsError, serviceBodiesError, dateSelectionError, changesError, meetingsError);
    $: warnings = concatErrorsOrWarnings(missingStartSnapshotWarning, missingEndSnapshotWarning);

    // This ought to work to keep serviceBodies up-to-date, but changing the selectFromOnlyZonesAndRegions checkbox doesn't
    // change the menu immediately.  So instead the code keeps serviceBodies updated imperatively.
    // $: allServiceBodies && (serviceBodies = filterServiceBodies(allServiceBodies));

    function concatErrorsOrWarnings(...strs) {
        return strs.filter(s => s!==null);
    }

    async function fetchRootServers() {
        const response = await fetch(rootServersUrl);
        if (!response.ok) {
            rootServersError = `Error fetching root servers - got ${response.status} status from ${rootServersUrl}`
            return;
        }
        rootServersError =  null;
        const _rootServers = [];
        for (let rawRootServer of await response.json()) {
            const rootServer = new RootServer(rawRootServer);
            _rootServers.push(rootServer);
        }
        // hack - put servers whose name starts with '[do not use yet]' at the end of the list
        rootServers = _rootServers.sort( (a,b) => a.name.replace('[do not use yet]', 'ZZZZ').localeCompare(b.name.replace('[do not use yet]', 'ZZZZ')) );
    }

    async function fetchSnapshots() {
        if ( !selectedRootServer) {
            snapshotsError = 'No root server selected - unable to get snapshots';
            return;
        }
        const snapshotsUrl = new URL(`rootservers/${selectedRootServer.id}/snapshots`, dijonBaseUrl);
        const response = await fetch(snapshotsUrl);
        if (!response.ok) {
            snapshotsError = `Error fetching snapshots - got ${response.status} status from ${snapshotsUrl}`
            return;
        }
        snapshotsError = null;
        const _snapshots = [];
        for (let rawSnapshot of await response.json()) {
            const snapshot = new Snapshot(rawSnapshot.root_server_id, rawSnapshot.date);
            _snapshots.push(snapshot);
        }
        snapshots = _snapshots;
        // find the first and last snapshot
        firstSnapshot = lastSnapshot = snapshots[0];
        for ( let i = 1; i < snapshots.length; i++ ) {
            if (snapshots[i].date < firstSnapshot.date) {
                firstSnapshot = snapshots[i];
            }
            if (snapshots[i].date > lastSnapshot.date) {
                lastSnapshot = snapshots[i];
            }
        }
        // If there is already a start or end date selected, check if it is still valid for the snapshots.  (This arises if the user has already
        // selected a server and dates, and then selects a different server.)  If the selected start or end date is no longer valid, set it to null
        // so that there is no longer a selected date.  If it is still valid, find the new start and end snaphots.  This avoids erasing the dates if
        // it's not necessary.
        if (startDate) {
            if (startDate < firstSnapshot.date || startDate > lastSnapshot.date) {
                rawStartDate = null;
                startDate = null;
            } else {
                startSnapshot = findSnapshot(startDate);
            }
        }
        if (endDate) {
            if (endDate < firstSnapshot.date || endDate > lastSnapshot.date) {
                rawEndDate = null;
                endDate = null;
            } else {
                endSnapshot = findSnapshot(endDate);
            }
        }
    }

    // bit of a hack -- function to call when the server selection changes (the reactive declarations ought to take care of this,
    // but don't seem to get invoked soon enough)
    function serverSelectionChanged() {
        fetchSnapshots();
        fetchServiceBodies(selectedRootServer, endSnapshot);
    }

    async function fetchServiceBodies(server, snapshot) {
        if ( server && snapshot ) {
            const serviceBodiesUrl = new URL(`rootservers/${server.id}/snapshots/${format(snapshot.date, 'yyyy-MM-dd')}/servicebodies`, dijonBaseUrl);
            const response = await fetch(serviceBodiesUrl);
            if (!response.ok) {
                serviceBodiesError = `Error fetching service bodies - got ${response.status} status from ${serviceBodiesUrl}`
                return;
            }
            serviceBodiesError = null;
            const _allServiceBodies = [];
            for (let rawServiceBody of await response.json()) {
                const serviceBody = new ServiceBody(rawServiceBody);
                _allServiceBodies.push(serviceBody);
            }
            allServiceBodies = _allServiceBodies;
            serviceBodies = sortAndFilterServiceBodies(allServiceBodies);
        } else {
            // server or snapshot is null -- so no service bodies yet
            serviceBodies = [];
        }
        selectedServiceBody = null;
    }


    // find the most recent snapshot (if any) that was retrieved on or before d for the currently selected server
    function findSnapshot(desiredDate) {
        let result;

        for (let snapshot of snapshots ?? []) {
            if (snapshot.rootServerId !== selectedRootServer.id) {
                continue;
            }

            if (snapshot.date > desiredDate) {
                continue;
            }

            if (!result) {
                result = snapshot;
                continue;
            }

            if (snapshot.date <= result.date) {
                continue;
            }

            result = snapshot;
        }

        return result;
    }

    // perhaps only include zones and regions in the service body selection menu
    function sortAndFilterServiceBodies(allServiceBodies) {
        let sbs = allServiceBodies;
        if (selectFromOnlyZonesAndRegions) {
            sbs = allServiceBodies.filter(s => s.type=='ZF' || s.type=='RS');
        }
        return sbs.sort( (a,b) => a.name.localeCompare(b.name) );
    }

    async function generateSpreadsheet() {
        let ws = XLSX.utils.aoa_to_sheet([exportSpreadsheetHeaders]);
        styleEntireRow(ws, 0, headerStyle);
        // for the changesUrl,    need to wait until root server, service body, and dates are known
        const changesUrl = new URL(`rootservers/${selectedRootServer.id}/meetings/changes`, dijonBaseUrl);
        const startSnapshotDateStr = format(startSnapshot.date, 'yyyy-MM-dd');
        const endSnapshotDateStr = format(endSnapshot.date, 'yyyy-MM-dd');
        changesUrl.searchParams.append("start_date", startSnapshotDateStr);
        changesUrl.searchParams.append("end_date", endSnapshotDateStr);
        changesUrl.searchParams.append("service_body_bmlt_ids", selectedServiceBody.bmlt_id);
        changesUrl.searchParams.append("exclude_world_id_updates", excludeWorldIdUpdates);
        const response = await fetch(changesUrl);
        if (!response.ok) {
            changesError = `Error fetching changes - got ${response.status} status from ${changesUrl}`;
            return;
        }
        changesError = null;
        const rawChanges = await response.json();
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
                    newRow = getRowForMeeting(change.new_meeting);
                    addMeetingData(ws, newRow, lastRow);
                    styleEntireRow(ws, lastRow, newMeetingStyle);
                    worldIdsWithChanges[change.new_meeting.world_id] = true;
                    bmltIdsWithChanges[change.new_meeting.bmlt_id] = true;
                    break;
                case 'MeetingDeleted':
                    oldRow = getRowForMeeting(change.old_meeting);
                    addMeetingData(ws, oldRow, lastRow);
                    styleEntireRow(ws, lastRow, deletedMeetingStyle);
                    worldIdsWithChanges[change.old_meeting.world_id] = true;
                    // the old_meeting won't be in the current meetings
                    break;
                case 'MeetingUpdated':
                    oldRow = getRowForMeeting(change.old_meeting);
                    newRow = getRowForMeeting(change.new_meeting);
                    addMeetingData(ws, newRow, lastRow);
                    styleChangedCells(ws, lastRow, changedMeetingStyle, oldRow, newRow);
                    // these will probably be the same for the old and new meetings, but add them both anyway to be safe
                    worldIdsWithChanges[change.old_meeting.world_id] = true;
                    worldIdsWithChanges[change.new_meeting.world_id] = true;
                    bmltIdsWithChanges[change.old_meeting.bmlt_id] = true;
                    bmltIdsWithChanges[change.new_meeting.bmlt_id] = true;
                    break;
                default:
                    console.log(`unknown event type: ${change.event_type}`);    // sometime: better error handling
            }
        }
        // If includeExtraMeetings is true, add other meetings to the spreadsheet with the same world_id as a changed meeting.
        if (includeExtraMeetings) {
            const meetingsUrl = new URL(`rootservers/${selectedRootServer.id}/snapshots/${endSnapshotDateStr}/meetings`, dijonBaseUrl);
            meetingsUrl.searchParams.append("service_body_bmlt_ids", selectedServiceBody.bmlt_id);
            const response2 = await fetch(meetingsUrl);
            if (!response2.ok) {
                meetingsError = `Error fetching extra meetings - got ${response2.status} status from ${meetingsUrl}`;
                return;
            }
            meetingsError = null;
            const rawMeetings = await response2.json();
            for (let rawMeeting of rawMeetings) {
                const meeting = new Meeting(rawMeeting);
                if (meeting.world_id && meeting.world_id in worldIdsWithChanges && !(meeting.bmlt_id in bmltIdsWithChanges)) {
                    lastRow++;
                    const row = getRowForMeeting(meeting);
                    addMeetingData(ws, row, lastRow);
                }
            }
        }
        const workbook = XLSX.utils.book_new();
        XLSX.utils.book_append_sheet(workbook, ws, "Changes");
        const fileName = `BMLT_${selectedServiceBody.world_id}_changes_from_${startSnapshotDateStr}_to_${endSnapshotDateStr}.xlsx`;
        // use writeFile since writeFileXLSX isn't available in the xlsx-js-style fork
        XLSX.writeFile(workbook, fileName);
    }

    function addMeetingData(ws, row, rowIndex) {
        // change nulls to empty strings (nulls in the spreadsheet won't accept the style changes)
        const newRow = row.map( c => c === null ? '' : c);
        XLSX.utils.sheet_add_aoa(ws, [newRow], {origin: -1});
        // fix the format on the LastChanged column to be a date -- all others can remain general format
        // (Excel didn't like having an empty value with a date format, hence the check)
        const lastChangedCol = exportSpreadsheetHeaders.indexOf('LastChanged');
        if ( row[lastChangedCol] ) {
            const cell_ref = XLSX.utils.encode_cell({c: exportSpreadsheetHeaders.indexOf('LastChanged'), r: rowIndex});
            ws[cell_ref].t = 'd';
        }
    }

    // if you change the headers below, make sure to also change the return value in the getRowForMeeting function
    const exportSpreadsheetHeaders = [
        'Committee',
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
    ];

    // if you change the return value in the getRowForMeeting function, be sure to also change exportSpreadsheetHeaders
    function getRowForMeeting(meeting) {
        let formats = meeting.nawsFormats();
        return [
            meeting.world_id,                              // Committee
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
        ];
    }

    // apply a style to every cell in the given row
    function styleEntireRow(ws, row, style) {
        for (let i = 0; i < exportSpreadsheetHeaders.length; i++) {
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

</script>

<section>
    <h1>
        <div class="mustard">
            <picture>
                <img src="mustard-jar.jpg" alt="Photo of a jar of Dijon mustard" />
            </picture>
        </div>
    </h1>

    <h1> Dijon Spreadsheet Query Builder</h1>
</section>

<section>
    <table>
        <tr>
            <td class="selectionLabel">Server:</td>
            <td>
                {#if rootServers}
                    <form>
                        <select class="selectionMenu" bind:value={selectedRootServer} on:change="{serverSelectionChanged}">
                            <option disabled selected value> -- select a server -- </option>
                            {#each rootServers as server }
                                <option value={server}>
                                    {server.name}
                                </option>
                            {/each}
                        </select>
                    </form>
                {:else if rootServersError}
                    <p style="color: red">Error trying to fetch root servers</p>
                {:else}
                    <p>...retrieving servers</p>
                {/if}
            </td>
        </tr>
        <tr>
            <td class="selectionLabel">Start Date:</td>
            <td>
                {#if rootServers && snapshots && firstSnapshot && lastSnapshot}
                    <DateInput format="yyyy-MM-dd" placeholder={format(firstSnapshot.date, "yyy-MM-dd")}
                        min={firstSnapshot.date} max={lastSnapshot.date} bind:value={rawStartDate} />
                {:else}
                    [select a server for available snapshot dates]
                {/if}
            </td>
        </tr>
        <tr>
            <td class="selectionLabel">End Date:</td>
            <td>
                {#if rootServers && snapshots && firstSnapshot && lastSnapshot}
                    <DateInput format="yyyy-MM-dd" placeholder={format(lastSnapshot.date, "yyy-MM-dd")}
                        min={firstSnapshot.date} max={lastSnapshot.date} bind:value={rawEndDate} />
                {/if}
            </td>
        </tr>
        <tr>
            <td class="selectionLabel">Service Body:</td>
            <td>
                {#if rootServers && allServiceBodies}
                    <form>
                        <select class="selectionMenu" bind:value={selectedServiceBody}>
                            {#each serviceBodies as serviceBody }
                                <option value={serviceBody}>
                                    {serviceBody.name}
                                </option>
                            {/each}
                        </select>
                    </form>
                {:else if serviceBodiesError}
                    <p style="color: red">Error trying to fetch service bodies</p>
                {:else}
                    [select a server and end date for available service bodies]
                {/if}
            </td>
        </tr>
        <tr>
            <td></td>
            <td>
                <label>
                    <input disabled={!rootServers || !allServiceBodies || serviceBodiesError} type=checkbox
                        bind:checked={selectFromOnlyZonesAndRegions}
                        on:change="{() => serviceBodies = sortAndFilterServiceBodies(allServiceBodies)}">
                    Only show zones and regions
                </label>
            </td>
        </tr>
        <tr>
            <td class="selectionLabel">Extra Meetings:</td>
            <td>
                <label>
                    <input type=checkbox bind:checked={includeExtraMeetings}>
                    Include all meetings with the same World ID as one with changes
                </label>
            </td>
        </tr>
        <tr>
            <td class="selectionLabel">World ID changes:</td>
            <td>
                <label>
                    <input type=checkbox bind:checked={excludeWorldIdUpdates}>
                    Exclude meetings when the only change is to the World ID
                </label>
            </td>
        </tr>
    </table>
</section>

<section>
    <h2>Information for Current Selections</h2>
    <table>
        <tr>
            <td>Selected server:</td>
            <td class="informationItem">{selectedRootServer?.name ?? 'none'}</td>
        </tr>
        <tr>
            <td>Number of snapshots:</td>
            <td class="informationItem">{snapshots?.length ?? '?'}</td>
        </tr>
        <tr>
            <td>Date of first snapshot:</td>
            <td class="informationItem">{firstSnapshot ? format(firstSnapshot.date, 'yyyy-MM-dd') : '?'}</td>
        </tr>
        <tr>
            <td>Date of most recent snapshot:</td>
            <td class="informationItem">{lastSnapshot ? format(lastSnapshot.date, 'yyyy-MM-dd') : '?'}</td>
        </tr>
        <tr>
            <td>Start date:</td>
            <td class="informationItem">{startDate ? format(startDate, 'yyyy-MM-dd') : '?'}</td>
        </tr>
        <tr>
            <td>End date:</td>
            <td class="informationItem">{endDate ? format(endDate, 'yyyy-MM-dd') : '?'}</td>
        </tr>
        <tr>
            <td>Closest snapshot for start date:</td>
            <td class="informationItem">{startSnapshot ? format(startSnapshot.date, 'yyyy-MM-dd') : '?'}</td>
        </tr>
        <tr>
            <td>Closest snapshot for end date:</td>
            <td class="informationItem">{endSnapshot ? format(endSnapshot.date, 'yyyy-MM-dd') : '?'}</td>
        </tr>
        <tr>
            <td> Number of service bodies as of end date:</td>
            <td class="informationItem">{allServiceBodies?.length ?? '?'}</td>
        </tr>
        <tr>
            <td>Selected service body:</td>
            <td class="informationItem">{selectedServiceBody?.name ?? 'none'}</td>
        </tr>
        <tr>
            <td>Include extra meetings:</td>
            <td class="informationItem">{includeExtraMeetings}</td>
        </tr>
        <tr>
            <td>Exclude changes to just the World ID:</td>
            <td class="informationItem">{excludeWorldIdUpdates}</td>
        </tr>
    </table>
</section>

<section>
    <h2>Errors and Warnings</h2>
    <table>
        {#if errors.length==0 && warnings.length==0}
            <tr>
                <td>- none -</td>
            </tr>
        {/if}
        {#each errors as e}
            <tr class="error_text">
                <td>{e}</td>
            </tr>
        {/each}
        {#each warnings as w}
            <tr class="warn_text">
                <td>{w}</td>
            </tr>
        {/each}
    </table>
</section>

<section>
    <p></p>
    <button disabled={ !selectedRootServer || !startSnapshot || !endSnapshot || !selectedServiceBody || dateSelectionError }
            on:click={ generateSpreadsheet }>
        Generate spreadsheet
    </button>
</section>

<style>
    :global(body) {
        --date-input-width: 28em;
    }

    section {
        display: flex;
        flex-direction: column;
        justify-content: center;
        align-items: center;
        flex: 1;
    }


    .mustard img {
                display: block;
                margin-left: auto;
                margin-right: auto;
                width: 10%;
    }

    .selectionMenu {
        min-width: 28em;
    }

    .selectionLabel {
        text-align: left;
        font-weight: bold;
    }

    .informationItem {
        text-align: left;
        min-width: 28em;
    }

    .error_text {
        font-size: 18px;
        text-align: left;
        background-color: #E00000;
        color: white;
        border-radius: 3px;
    }

    .warn_text {
        font-size: 18px;
        text-align: left;
        border: 1px solid black;
        background-color: yellow;
        color: black;
        border-radius: 3px;
    }

</style>
