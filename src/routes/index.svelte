<svelte:head>
    <title>Dijon Spreadsheet Query Builder</title>
</svelte:head>

<script>
    import { onMount } from 'svelte';
    import { DateInput } from 'date-picker-svelte'
    import { Change } from '$lib/Change';
    import { Format } from '$lib/Format';
    import { Meeting } from '$lib/Meeting';
    import { RootServer } from '$lib/RootServer';
    import { ServiceBody } from '$lib/ServiceBody';
    import { Snapshot } from '$lib/Snapshot';
    // import * as XLSX from 'xlsx/xlsx.mjs';
    // the open source version of SheetJS doesn't handle styling - use this fork instead:
    import * as XLSX from 'xlsx-js-style';

    const dijonBaseUrl = 'https://dijon.jrb.lol';
    const rootServersUrl = new URL('rootservers', dijonBaseUrl);
    const exportSpreadsheetHeaders = [
        'Committee',
        'CommitteeName',
        'AreaRegion',
        'ParentName',
        'Room',
        'Closed',
        'WheelChr',
        'Day',
        'Time',
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
        'Delete',
        'LastChanged',
        'Longitude',
        'Latitude',
        'TimeZone',
        'bmlt_id',
        'unpublished',
        'VirtualMeetingLink',
        'VirtualMeetingInfo',
        'PhoneMeetingNumber',
        'Language1',
        'Language2',
        'Language3',
        'Country'];
    // styles for export spreadsheet
    const headerStyle = {font: {bold: true}};
    const changedMeetingStyle = {fill: {fgColor: {rgb: "FF002B"}}};
    const newMeetingStyle = {fill: {fgColor: {rgb: "4D88FF"}}};
    const deletedMeetingStyle = {font: {strike: true}};
    let rootServers;
    let rootServersError;
    let snapshots;
    let snapshotsError;
    let selectedRootServer;
    let firstSnapshotDate;   // date of the first snapshot for the selected server
    let lastSnapshotDate;    // date of the last snapshot for the selected server
    let startDate;
    let endDate;
    let startSnapshot;
    let endSnapshot;
    let allServiceBodies;
    let serviceBodies;
    let selectedServiceBody;
    let serviceBodiesError;
    let selectFromOnlyZonesAndRegions = true;
    let changesError;

    onMount(() => {
        fetchRootServers();
    });

    $: selectedRootServer && snapshots && (firstSnapshotDate = findFirstSnapshot());
    $: selectedRootServer && snapshots && (lastSnapshotDate = findLastSnapshot());
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
        return Math.min(...snapshots.map( s => s.date));
    }

    function findLastSnapshot() {
        return Math.max(...snapshots.map( s => s.date));
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
    }

    async function fetchServiceBodies(server, snapshot) {
        if ( server && snapshot ) {
            const d = `${snapshot.date.getFullYear()}-${snapshot.date.getMonth()+1}-${snapshot.date.getDate()}`;
            const serviceBodiesUrl = new URL(`rootservers/${server.id}/snapshots/${d}/servicebodies`, dijonBaseUrl);
            const response = await fetch(serviceBodiesUrl);
            if (!response.ok) {
                serviceBodiesError = `Got ${response.status} status from ${url}.`
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
        let startDateStr = `${startDate.getFullYear()}-${startDate.getMonth()+1}-${startDate.getDate()}`;
        let endDateStr = `${endDate.getFullYear()}-${endDate.getMonth()+1}-${endDate.getDate()}`;
        let changesUrl = new URL(`rootservers/${selectedRootServer.id}/meetings/changes`, dijonBaseUrl);
        changesUrl.searchParams.append("start_date", startDateStr);
        changesUrl.searchParams.append("end_date", endDateStr);
        changesUrl.searchParams.append("service_body_bmlt_ids", selectedServiceBody.bmlt_id);
        const response = await fetch(changesUrl);
        if (!response.ok) {
            changesError = `Got ${response.status} status from ${url}.`
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
                    addMeetingData(ws, newRow);
                    styleEntireRow(ws, lastRow, newMeetingStyle);
                    break;
                case 'MeetingDeleted':
                    oldRow = getRowForMeeting(change.old_meeting, 'D');
                    addMeetingData(ws, oldRow);
                    styleEntireRow(ws, lastRow, deletedMeetingStyle);
                    break;
                case 'MeetingUpdated':
                    oldRow = getRowForMeeting(change.old_meeting);
                    newRow = getRowForMeeting(change.new_meeting);
                    addMeetingData(ws, newRow);
                    styleChangedCells(ws, lastRow, changedMeetingStyle, oldRow, newRow);
                    break;
                default:
                    console.log(`unknown event type: ${change.event_type}`);    // sometime: better error handling
            }
        }
        const workbook = XLSX.utils.book_new();
        XLSX.utils.book_append_sheet(workbook, ws, "Changes");
        const fileName = `BMLT_${selectedServiceBody.world_id}_changes_from_${startDateStr}_to_${endDateStr}.xlsx`;
        // use writeFile since writeFileXLSX isn't available in the xlsx-js-style fork
        XLSX.writeFile(workbook, fileName);
        alert('generated a spreadsheet!')
    }

    function addMeetingData(ws, row) {
        // change nulls to empty strings (nulls in the spreadsheet won't accept the style changes)
        const newRow = row.map( c => c === null ? '' : c);
        XLSX.utils.sheet_add_aoa(ws, [newRow], {origin: -1});
    }

    function getRowForMeeting(meeting, deleted = '') {
        let formats = meeting.nawsFormats();
        return [
            meeting.world_id,                              // Committee
            meeting.name,                                  // CommitteeName
            meeting.serviceBodyWorldId(allServiceBodies),  // AreaRegion
            meeting.serviceBodyName(allServiceBodies),     // ParentName
            meeting.nonNawsFormats(),                      // Room  this is actually non-NAWS formats, despite the column name
            meeting.openOrClosed(),                        // Closed
            meeting.wheelChairAccessible(),                // WheelChr
            meeting.dayString(),                           // Day
            meeting.start_time,                            // Time -- TODO fix the formatting (no seconds, colons etc)
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
            deleted,                                       // Delete
            '',                                            // LastChanged -- not available in current server data.  Omit this column?
            meeting.longitude,                             // Longitude
            meeting.latitude,                              // Latitude
            meeting.time_zone,                             // TimeZone
            meeting.bmlt_id,                               // bmlt_id
            meeting.published ? '' : '1',                  // unpublished
            meeting.virtual_meeting_link,                  // VirtualMeetingLink
            meeting.virtual_meeting_additional_info,       // VirtualMeetingInfo
            meeting.phone_meeting_number,                  // PhoneMeetingNumber
            meeting.language(),                            // Language1
            '',                                            // Language2 -- maybe omit since always empty?
            '',                                            // Language3 -- maybe omit since always empty?
            meeting.location_nation                        // Country
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
    {#if rootServers && snapshots && firstSnapshotDate && lastSnapshotDate}
        Start: <DateInput format="yyyy-MM-dd" placeholder="2021-12-31"
            min={new Date(firstSnapshotDate)} max={new Date(lastSnapshotDate)} bind:value={startDate} />
        <p></p>
        End: <DateInput format="yyyy-MM-dd" placeholder="2022-01-31"
        min={new Date(firstSnapshotDate)} max={new Date(lastSnapshotDate)} bind:value={endDate} />
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
        <p>first pick a server and end date</p>
    {/if}
</section>

<section>
    <p></p>
    <button on:click={generateSpreadsheet}>
        Generate spreadsheet
    </button>
</section>

<section>
    <h2>Current Selections (temporarily displayed for debugging)</h2>
    <p>Selected server: {selectedRootServer?.name ?? 'none'}<br/>
    Number of service bodies: {allServiceBodies?.length ?? 'none'}<br/>
    <!-- use toDateString() to show just date -->
    First snapshot date: {firstSnapshotDate ? (new Date(firstSnapshotDate)).toString() : 'none'}<br/>
    Last snapshot date: {lastSnapshotDate ? (new Date(lastSnapshotDate)).toString() : 'none'}<br/>
    Start date: {startDate?.toString() ?? 'none'}<br/>
    End date: {endDate?.toString() ?? 'none'}<br/>
    Selected service body: {selectedServiceBody?.name ?? 'none'}</p>
    {#if startDate}
        <p>closest snapshot to start date: {startSnapshot?.date ?? 'none'}</p>
    {/if}
    {#if endDate}
        <p>closest snapshot to end date: {endSnapshot?.date ?? 'none'}</p>
    {/if}

    {#if snapshots}
        <p>{snapshots.length} snapshots found for {selectedRootServer.name}</p>
    {:else if snapshotsError}
        <p style="color: red">{snapshotsError.message}</p>
    {:else}
        <p>snapshots: null</p>
    {/if}
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
