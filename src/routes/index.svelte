<svelte:head>
    <title>Dijon Spreadsheet Query Builder</title>
</svelte:head>

<script>
    import { onMount } from 'svelte';
    import { format } from 'date-fns';
    import { DateInput } from 'date-picker-svelte'
    import * as XLSX from 'xlsx-js-style';  // the open source version of SheetJS doesn't handle styling - use this fork instead
    import { Change } from '$lib/Change';
    import { Format } from '$lib/Format';
    import { Meeting } from '$lib/Meeting';
    import { RootServer } from '$lib/RootServer';
    import { ServiceBody } from '$lib/ServiceBody';
    import { Snapshot } from '$lib/Snapshot';
    import { makeDate } from '$lib/makeDate';

    const dijonBaseUrl = 'https://dijon.jrb.lol';
    const rootServersUrl = new URL('rootservers', dijonBaseUrl);
    let rootServers;
    let rootServersError;
    let selectedRootServer;
    let snapshots;         // all snapshots for the selected server
    let snapshotsError;
    let firstSnapshot;     // first snapshot for the selected server
    let lastSnapshot;      // last snapshot for the selected server
    let startDate;         // start date as selected from the calendar
    let endDate;           // end date as selected from the calendar
    let startSnapshot;     // closest available snapshot on or before startDate
    let endSnapshot;       // closest available snapshot on or before endDate
    let allServiceBodies;  // service bodies for the root server as of last snapshot date
    let serviceBodies;
    let selectedServiceBody;
    let serviceBodiesError;
    let selectFromOnlyZonesAndRegions = true;
    let changesError;

    // styles for export spreadsheet
    const headerStyle = {font: {bold: true}};
    const changedMeetingStyle = {fill: {fgColor: {rgb: "FF002B"}}};
    const newMeetingStyle = {fill: {fgColor: {rgb: "4D88FF"}}};
    const deletedMeetingStyle = {font: {strike: true}};

    onMount(() => {
        fetchRootServers();
    });

    $: selectedRootServer && snapshots && (firstSnapshot = findFirstSnapshot());
    $: selectedRootServer && snapshots && (lastSnapshot = findLastSnapshot());
    $: selectedRootServer && startDate && (startSnapshot = findSnapshot(startDate));
    $: selectedRootServer && endDate && (endSnapshot = findSnapshot(endDate));
    $: selectedRootServer && endSnapshot && fetchServiceBodies(selectedRootServer, endSnapshot);

    // This ought to work to keep serviceBodies up-to-date, but changing the selectFromOnlyZonesAndRegions checkbox doesn't
    // change the menu immediately.  So instead the code keeps serviceBodies updated imperatively.
    // $: allServiceBodies && (serviceBodies = filterServiceBodies(allServiceBodies));

    async function fetchRootServers() {
        const response = await fetch(rootServersUrl);
        if (!response.ok) {
            rootServersError = `Got ${response.status} status from ${url}.`
            return;
        }

        const _rootServers = [];
        for (let rawRootServer of await response.json()) {
            const rootServer = new RootServer(rawRootServer);
            _rootServers.push(rootServer);
        }

        rootServers = _rootServers;
    }

    async function fetchSnapshots() {
        if ( !selectedRootServer) {
            snapshotsError = 'no root server selected';
            return;
        }
        const snapshotsUrl = new URL(`rootservers/${selectedRootServer.id}/snapshots`, dijonBaseUrl);
        const response = await fetch(snapshotsUrl);
        if (!response.ok) {
            snapshotsError = `Got ${response.status} status from ${url}.`
            return;
        }

        const _snapshots = [];
        for (let rawSnapshot of await response.json()) {
            const snapshot = new Snapshot(rawSnapshot.root_server_id, rawSnapshot.date);
            _snapshots.push(snapshot);
        }

        snapshots = _snapshots;
    }

    function findFirstSnapshot() {
        let s = null;
        for ( let i = 0; i < snapshots.length; i++ ) {
            if ( !s || snapshots[i].date < s.date ) {
                s = snapshots[i];
            }
        }
        return s;
    }

    function findLastSnapshot() {
        let s = null;
        for ( let i = 0; i < snapshots.length; i++ ) {
            if ( !s || snapshots[i].date > s.date ) {
                s = snapshots[i];
            }
        }
        return s;
    }

    // bit of a hack -- function to call when the server selection changes (the reactive declarations ought to take care of this,
    // but don't seem to get invoked soon enough)
    function serverSelectionChanged() {
        fetchSnapshots();
        fetchServiceBodies(selectedRootServer, endSnapshot);
        // there may be a more graceful way to do this - anyway, the issue is that the first and last possible dates may have changed
        // when the server selection is changed, and so the startDate or endDate might be invalid.  Better would be to find out if
        // that date still works
        startDate = null;
        endDate = null;
        selectedServiceBody = null;
    }

    async function fetchServiceBodies(server, snapshot) {
        if ( server && snapshot ) {
            const serviceBodiesUrl = new URL(`rootservers/${server.id}/snapshots/${format(snapshot.date, 'yyyy-MM-dd')}/servicebodies`, dijonBaseUrl);
            const response = await fetch(serviceBodiesUrl);
            if (!response.ok) {
                serviceBodiesError = `Got ${response.status} status from ${serviceBodiesUrl}.`
                return;
            }
            const _allServiceBodies = [];
            for (let rawServiceBody of await response.json()) {
                const serviceBody = new ServiceBody(rawServiceBody);
                _allServiceBodies.push(serviceBody);
            }
            allServiceBodies = _allServiceBodies;
            serviceBodies = filterServiceBodies(allServiceBodies);
        } else {
            // server or snapshot is null -- so no service bodies yet
            serviceBodies = [];
        }
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

    // helper function to sort service bodies by type, and then by name
    function compareServiceBodies (a, b) {
        if (a.type == b.type) {
            if (a.name < b.name) {
                return -1;
            } else if (a.name > b.name) {
                return 1
            } else {
                return 0;
            }
        }
        if (a.type == 'ZF') {
            return -1;
        }
        if (b.type == 'ZF') {
            return 1;
        }
        if (a.type == 'RS') {
            return -1;
        }
        if (b.type == 'RS') {
            return 1;
        }
        if (a.type == 'AS') {
            return -1;
        }
        if (b.type == 'AS') {
            return 1;
        }
        // a and b have different types, but neither is a zone, region, or area.    At this point who cares -- just alphabetize by type
        if (a.type < b.type) {
            return -1;
        } else {
            return 1
        }
    }

    // perhaps only include zones and regions in the service body selection menu
    function filterServiceBodies(allServiceBodies) {
        let sbs = allServiceBodies;
        if (selectFromOnlyZonesAndRegions) {
            sbs = allServiceBodies.filter(s => s.type=='ZF' || s.type=='RS');
        }
        return sbs.sort(compareServiceBodies);
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
            changesError = `Got ${response.status} status from ${changesUrl}.`
            return;
        }
        const rawChanges = await response.json();
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
                    break;
                case 'MeetingDeleted':
                    oldRow = getRowForMeeting(change.old_meeting);
                    addMeetingData(ws, oldRow, lastRow);
                    styleEntireRow(ws, lastRow, deletedMeetingStyle);
                    break;
                case 'MeetingUpdated':
                    oldRow = getRowForMeeting(change.old_meeting);
                    newRow = getRowForMeeting(change.new_meeting);
                    addMeetingData(ws, newRow, lastRow);
                    styleChangedCells(ws, lastRow, changedMeetingStyle, oldRow, newRow);
                    break;
                default:
                    console.log(`unknown event type: ${change.event_type}`);    // sometime: better error handling
            }
        }
        const workbook = XLSX.utils.book_new();
        XLSX.utils.book_append_sheet(workbook, ws, "Changes");
        const fileName = `BMLT_${selectedServiceBody.world_id}_changes_from_${startSnapshotDateStr}_to_${endSnapshotDateStr}.xlsx`;
        // use writeFile since writeFileXLSX isn't available in the xlsx-js-style fork
        XLSX.writeFile(workbook, fileName);
        alert('generated a spreadsheet!')
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
    <h2>Server:</h2>
    {#if rootServers}
        <form>
            <select bind:value={selectedRootServer} on:change="{serverSelectionChanged}">
                <option disabled selected value> -- select a server -- </option>
                {#each rootServers as server }
                    <option value={server}>
                        {server.name}
                    </option>
                {/each}
            </select>
        </form>
    {:else if rootServersError}
        <p style="color: red">{rootServersError.message}</p>
    {:else}
        <p>...retrieving servers</p>
    {/if}
</section>

<section>
    <h2>Start and End Dates:</h2>
    {#if rootServers && snapshots && firstSnapshot && lastSnapshot}
        Start: <DateInput format="yyyy-MM-dd" placeholder={format(firstSnapshot.date, "yyy-MM-dd")}
            min={firstSnapshot.date} max={lastSnapshot.date} bind:value={startDate} />
        <p></p>
        End: <DateInput format="yyyy-MM-dd" placeholder={format(lastSnapshot.date, "yyy-MM-dd")}
            min={firstSnapshot.date} max={lastSnapshot.date} bind:value={endDate} />
    {:else}
    [first pick a server - that determines which snapshot dates are available]
    {/if}
</section>

<section>
    <h2>Service Body:</h2>
    {#if rootServers && allServiceBodies}
        <form>
            <select bind:value={selectedServiceBody}>
                <option disabled selected value> -- select a service body -- </option>
                {#each serviceBodies as serviceBody }
                    <option value={serviceBody}>
                        {serviceBody.name}
                    </option>
                {/each}
            </select>
        </form>
        <label>
            <input type=checkbox
                bind:checked={selectFromOnlyZonesAndRegions}
                on:change="{() => serviceBodies = filterServiceBodies(allServiceBodies)}">
            Only show zones and regions
        </label>
    {:else if serviceBodiesError}
        <p style="color: red">{serviceBodiesError.message}</p>
    {:else}
        <p>[first pick a server and end date - available service bodies are as of the snapshot for the end date]</p>
    {/if}
</section>

<section>
    <h2>Information for Current Selections</h2>
    Selected server: {selectedRootServer?.name ?? 'none'}<br/>
    Number of snapshots: {snapshots?.length ?? 'none'}<br/>
    First snapshot date: {firstSnapshot ? format(firstSnapshot.date, 'yyyy-MM-dd') : 'none'}<br/>
    Last snapshot date: {lastSnapshot ? format(lastSnapshot.date, 'yyyy-MM-dd') : 'none'}<br/>
    Number of service bodies as of end date: {allServiceBodies?.length ?? 'none'}<br/>
    Selected service body: {selectedServiceBody?.name ?? 'none'}<br/>
    Closest snapshot to start date: {startSnapshot ? format(startSnapshot.date, 'yyyy-MM-dd') : 'none'}<br/>
    Closest snapshot to end date: {endSnapshot ? format(endSnapshot.date, 'yyyy-MM-dd') : 'none'}<br/>
</section>

<section>
    <p></p>
    <button disabled={ !selectedRootServer || !startSnapshot || !endSnapshot || !selectedServiceBody } on:click={ generateSpreadsheet }>
        Generate spreadsheet
    </button>
</section>

<style>
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

</style>
