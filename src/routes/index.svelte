<svelte:head>
    <title>Dijon Spreadsheet Query Builder</title>
    <link rel='stylesheet' href='css/vendor.css'>
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

    const dijonBaseUrl = 'https://dijon-api.bmlt.dev/';
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
        rootServers = _rootServers.sort( (a,b) => a.name.localeCompare(b.name) );
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
<header>
    <h1 class="site-title">BMLT - DSQB</h1>
</header>
<div class="wrapper" style="background-image: url(' ');">
        <div class="inner">
<section>
    <h2> Dijon Spreadsheet Query Builder</h2>
</section>

<section>
    {#if rootServers}
        <form>
            <div class="form-wrapper">
                <select class="selectionMenu" bind:value={selectedRootServer} on:change="{serverSelectionChanged}">
                    <option disabled selected value> -- select a server -- </option>
                    {#each rootServers as server }
                        <option value={server}>
                            {server.name}
                        </option>
                    {/each}
                </select>
            </div>
        </form>
    {:else if rootServersError}
        <p style="color: red">Error trying to fetch root servers</p>
    {:else}
        <p>...retrieving servers</p>
    {/if}
        
    <div class="form-group">
        <div class="form-wrapper">
            <label for="" class="selectionLabel">Start Date:</label>
            {#if rootServers && snapshots && firstSnapshot && lastSnapshot}
                <DateInput format="yyyy-MM-dd" placeholder={format(firstSnapshot.date, "yyy-MM-dd")}
                    min={firstSnapshot.date} max={lastSnapshot.date} bind:value={rawStartDate} />
            {:else}
                [select a server for available snapshot dates]
            {/if}
        </div>
        <div class="form-wrapper">
            <label for="" class="selectionLabel">End Date:</label>
            {#if rootServers && snapshots && firstSnapshot && lastSnapshot}
                <DateInput format="yyyy-MM-dd" placeholder={format(lastSnapshot.date, "yyy-MM-dd")}
                    min={firstSnapshot.date} max={lastSnapshot.date} bind:value={rawEndDate} />
            {/if}
        </div>
    </div>
    
    <label for="service-body-selection-menu" class="selectionLabel">Service Body:</label>
    {#if rootServers && allServiceBodies}
        <form>
            <div class="form-wrapper">
                <select name="service-body-selection-menu" class="selectionMenu" bind:value={selectedServiceBody}>
                    {#each serviceBodies as serviceBody }
                        <option value={serviceBody}>
                            {serviceBody.name}
                        </option>
                    {/each}
                </select>
            </div>
        </form>
    {:else if serviceBodiesError}
        <p style="color: red">Error trying to fetch service bodies</p>
    {:else}
        [select a server and end date for available service bodies]
    {/if}
    <div class="checkbox">
        <label for="">
            <input disabled={!rootServers || !allServiceBodies || serviceBodiesError} type="checkbox" class="checkbox"
                bind:checked={selectFromOnlyZonesAndRegions}
                on:change="{() => serviceBodies = sortAndFilterServiceBodies(allServiceBodies)}">Only show zones and regions
            <span class="checkmark"></span>
        </label>
    </div>
    <div class="checkbox">
        <label for="" class="selectionLabel">
            <input type="checkbox" class="checkbox" bind:checked={includeExtraMeetings}><span class="bold">Extra Meetings:</span> Include all meetings with the same world_id as one with changes
            <span class="checkmark"></span>
        </label>
    </div>
    
</section>

<section>
    <h2>Information for Current Selections</h2>
    <div class="info-group">
        <div class="info-wrapper">
            <div>Selected server:</div>
            <div class="informationItem">{selectedRootServer?.name ?? 'none'}</div>
        </div>
        <div class="info-wrapper">
            <div>Number of snapshots:</div>
            <div class="informationItem">{snapshots?.length ?? '?'}</div>
        </div>
        <div class="info-wrapper">
            <div>Date of first snapshot:</div>
            <div class="informationItem">{firstSnapshot ? format(firstSnapshot.date, 'yyyy-MM-dd') : '?'}</div>
        </div>
        <div class="info-wrapper">
            <div>Date of most recent snapshot:</div>
            <div class="informationItem">{lastSnapshot ? format(lastSnapshot.date, 'yyyy-MM-dd') : '?'}</div>
        </div>
        <div class="info-wrapper">
            <div>Start date:</div>
            <div class="informationItem">{startDate ? format(startDate, 'yyyy-MM-dd') : '?'}</div>
        </div>
        <div class="info-wrapper">
            <div>End date:</div>
            <div class="informationItem">{endDate ? format(endDate, 'yyyy-MM-dd') : '?'}</div>
        </div>
        <div class="info-wrapper">
            <div>Closest snapshot for start date:</div>
            <div class="informationItem">{startSnapshot ? format(startSnapshot.date, 'yyyy-MM-dd') : '?'}</div>
        </div>
        <div class="info-wrapper">
            <div>Closest snapshot for end date:</div>
            <div class="informationItem">{endSnapshot ? format(endSnapshot.date, 'yyyy-MM-dd') : '?'}</div>
        </div>
        <div class="info-wrapper">
            <div> Number of service bodies as of end date:</div>
            <div class="informationItem">{allServiceBodies?.length ?? '?'}</div>
        </div>
        <div class="info-wrapper">
            <div>Selected service body:</div>
            <div class="informationItem">{selectedServiceBody?.name ?? 'none'}</div>
        </div>
        <div class="info-wrapper">
            <div>Include extra meetings:</div>
            <div class="informationItem">{includeExtraMeetings}</div>
        </div>
    </div>
</section>

<section>
    <h2>Errors and Warnings</h2>
    <div class="info-group">
        <div class="info-wrapper">
            {#if errors.length==0 && warnings.length==0}
                    <td>- none -</td>
            {/if}
            {#each errors as e}
                <div class="error_text">
                    {e}
                </div>
            {/each}
            {#each warnings as w}
                <div class="warn_text">
                    {w}
                </div>
            {/each}
        </div>
    </div>
</section>

<section>
    <p></p>
    <button disabled={ !selectedRootServer || !startSnapshot || !endSnapshot || !selectedServiceBody || dateSelectionError }
            on:click={ generateSpreadsheet }>
        Generate spreadsheet
    </button>
</section>
</div>
    </div>
<style>
    :global(body) {
        --date-input-width: 20em;
        font-size: 1.15rem;
        margin: 0;
    }

    header {
        background: #3809a9;
        padding-top: 1.5rem;
        padding-bottom: 1.5rem;
    }

    .site-title {
        font-size: 3rem;
        color: #fff;
        margin-left: 7rem;
    }

    section {
        display: flex;
        flex-direction: column;
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

    .bold {
        font-weight: 700;
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

    .wrapper {
        min-height: 100vh;
        background-size: cover;
        background-repeat: no-repeat;
        display: flex;
        align-items: center; 
    }

    .inner {
        max-width: 1050px;
        margin: auto;
        padding-top: 68px;
        padding-bottom: 48px;
        background: url(mustard-jar.jpg);
        background-size: 25%;
        background-repeat: no-repeat;
        background-position: center right;
        width: 850px;
    }

    .inner h3 {
        text-transform: uppercase;
        font-size: 22px;
        font-family: "Muli-Bold";
        text-align: center;
        margin-bottom: 32px;
        color: #333;
        letter-spacing: 2px; 
    }

    form {
        width: 50%;
    }

    .form-group {
        display: flex; 
    }

    .form-group .form-wrapper {
        width: 50%; 
    }

    .form-group .form-wrapper:first-child {
        margin-right: 20px; 
    }

    .form-wrapper {
        margin-bottom: 17px; 
    }

    .form-wrapper label {
        margin-bottom: 9px;
        display: block; 
    }

    .form-control {
        border: 1px solid #ccc;
        display: block;
        width: 100%;
        height: 40px;
        padding: 0 20px;
        border-radius: 20px;
        font-family: "Muli-Bold";
        background: none; 
    }

    .form-control:focus {
        border: 1px solid #ae3c33; 
    }

    :global(.date-time-field input) {
        height: 2rem;
        font-size: 1rem;
    }

    select {
        -moz-appearance: none;
        -webkit-appearance: none;
        cursor: pointer;
        padding-left: 5px; 
        height: 2rem;
        text-transform: capitalize;
        font-size: 1rem;
    }

    select option[value=""][disabled] {
        display: none; 
    }

    button {
        border: none;
        width: 152px;
        height: 40px;
        margin: auto;
        margin-top: 29px;
        cursor: pointer;
        display: flex;
        align-items: center;
        justify-content: center;
        padding: 0;
        background: #3809a9;
        font-size: 13px;
        color: #fff;
        text-transform: uppercase;
        font-family: "Muli-SemiBold";
        border-radius: 20px;
        overflow: hidden;
        -webkit-transform: perspective(1px) translateZ(0);
        transform: perspective(1px) translateZ(0);
        box-shadow: 0 0 1px rgba(0, 0, 0, 0);
        position: relative;
        -webkit-transition-property: color;
        transition-property: color;
        -webkit-transition-duration: 0.5s;
        transition-duration: 0.5s; 
    }

    button:disabled {
        background: gray;
    }

    button:before {
        content: "";
        position: absolute;
        z-index: -1;
        top: 0;
        left: 0;
        right: 0;
        bottom: 0;
        background: rgb(9 169 156 / 69%);
        -webkit-transform: scaleX(0);
        transform: scaleX(0);
        -webkit-transform-origin: 0 50%;
        transform-origin: 0 50%;
        -webkit-transition-property: transform;
        transition-property: transform;
        -webkit-transition-duration: 0.5s;
        transition-duration: 0.5s;
        -webkit-transition-timing-function: ease-out;
        transition-timing-function: ease-out; 
    }

    button:hover:before {
        -webkit-transform: scaleX(1);
        transform: scaleX(1);
        -webkit-transition-timing-function: cubic-bezier(0.52, 1.64, 0.37, 0.66);
        transition-timing-function: cubic-bezier(0.52, 1.64, 0.37, 0.66); 
    }

    .checkbox {
        position: relative; 
    }

    .checkbox label {
        padding-left: 22px;
        cursor: pointer; 
    }

    .checkbox input {
        position: absolute;
        opacity: 0;
        cursor: pointer;
        left: 0; 
        z-index: 1;
    }

    .checkbox input:checked ~ .checkmark:after {
        display: block; 
    }

    .checkmark {
        position: absolute;
        top: 50%;
        left: 0;
        transform: translateY(-50%);
        height: 12px;
        width: 13px;
        border-radius: 2px;
        background-color: #3809a9;
        border: 2px solid #3809a9;
        /*font-family: Material-Design-Iconic-Font;*/
        color: #000;
        font-size: 10px;
        font-weight: bolder; 
    }

    .checkmark:after {
        position: absolute;
        top: -14%;
        left: 50%;
        transform: translate(-50%, -50%);
        display: none;
        content: '';
        left: 3px;
        width: 5px;
        height: 10px;
        border: solid #fff;
        border-width: 0 3px 3px 0;
        -webkit-transform: rotate(45deg);
        -ms-transform: rotate(45deg);
        transform: rotate(45deg);
    }

    .checkbox:disabled ~ .checkmark {
        background: gray;
        border-color: gray;
    }

    .info-group {
        display: flex;
        flex-direction: column;
        row-gap: 0.5rem;
    }

    .info-wrapper {
        display: flex;
        column-gap: 2rem;
    }

    .info-wrapper div {
        font-size: 1.15rem;
    }

    .info-wrapper div:first-child {
        width: 15rem;
    }

    .informationItem {
        text-transform: capitalize;
    }


    @media (max-width: 991px) {
      .inner {
        min-width: 768px; } }
        @media (max-width: 767px) {
          .inner {
            min-width: auto;
            background: none;
            padding-top: 0;
            padding-bottom: 0; }

            form {
                width: 100%;
                padding-right: 15px;
                padding-left: 15px; } }

</style>
