<svelte:head>
    <title>Dijon Spreadsheet Query Builder</title>
</svelte:head>

<script>
    import { onMount } from 'svelte';
    import { format, isEqual, isBefore } from 'date-fns';
    import { DateInput } from 'date-picker-svelte';
    import { Server } from '$lib/Server';
    import { ServiceBody } from '$lib/ServiceBody'; 
    import { Snapshot } from '$lib/Snapshot';
    import { makePureDate } from '$lib/DateUtils';
    import { generateSpreadsheet } from '$lib/GenerateSpreadsheet';
    import { uploadNawsCodes } from '$lib/UploadNawsCodes';
    import DijonApi from '$lib/DijonApi';

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
    let showOriginalNawsCodes = false;
    let includeExtraMeetings = true;
    let excludeWorldIdUpdates = true;

    // errors -- these will be either null if no error, or a descriptive string
    let rootServersError = null;            // error retrieving the list of root servers
    let snapshotsError = null;              // error retrieving the snapshots from the selected root server
    let serviceBodiesError = null;          // error retrieving the service bodies from the selected snapshot
    let dateSelectionError = null;          // error if the start snapshot date isn't before the end snapshot date
    let generateSpreadsheetError = null;    // error from the generateSpreadsheet function, or null if it worked ok
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

    // variables for NAWS code upload
    let username = 'dijon';
    let password;
    let selectedRootServerForUpload;
    let nawsCodesFile;

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
    $: errors = concatErrorsOrWarnings(rootServersError, snapshotsError, serviceBodiesError, dateSelectionError, generateSpreadsheetError);
    $: warnings = concatErrorsOrWarnings(missingStartSnapshotWarning, missingEndSnapshotWarning);

    // This ought to work to keep serviceBodies up-to-date, but changing the selectFromOnlyZonesAndRegions checkbox doesn't
    // change the menu immediately.  So instead the code keeps serviceBodies updated imperatively.
    // $: allServiceBodies && (serviceBodies = filterServiceBodies(allServiceBodies));

    function concatErrorsOrWarnings(...strs) {
        return strs.filter(s => s!==null);
    }

    async function fetchRootServers() {
        rootServersError =  null;
        try {
            const servers = await DijonApi.listRootServers();
            rootServers = servers.map(s => new Server(s));
            // move servers whose names start with '[' to end of list
            rootServers.sort((a,b) => a.sortName().localeCompare(b.sortName()));
        } catch (error) {
            rootServersError = `Error fetching root servers - got ${error.response.status}`;
        }
    }

    async function fetchSnapshots() {
        snapshotsError = null;

        if ( !selectedRootServer) {
            snapshotsError = 'No root server selected - unable to get snapshots';
            return;
        }

        const _snapshots = [];
        try {
            for (const snapshot of await DijonApi.listRootServerSnapshots(selectedRootServer.id)) {
                _snapshots.push(new Snapshot(snapshot.rootServerId, format(snapshot.date, 'yyyy-MM-dd')));
            };
        } catch (error) {
            snapshotsError = `Error fetching snapshots - got ${error.response.status}`;
            return;
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
            let rawServiceBodies;
            try {
                rawServiceBodies = await DijonApi.listSnapshotServiceBodies(server.id, format(snapshot.date, 'yyyy-MM-dd'));
            } catch (error) {
                serviceBodiesError = `Error fetching service bodies - got ${error.response.status}`
                return;
            }
            serviceBodiesError = null;
            const _allServiceBodies = [];
            for (let rawServiceBody of rawServiceBodies) {
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

    async function callGenerateSpreadsheet() {
        generateSpreadsheetError = await generateSpreadsheet(selectedRootServer, allServiceBodies, selectedServiceBody,
            startSnapshot, endSnapshot, showOriginalNawsCodes, includeExtraMeetings, excludeWorldIdUpdates);
    }

    async function callUploadNawsCodes() {
        const file = document.getElementById('naws_codes_file').files[0];
        try {
            const token = await DijonApi.createToken(username, password);
            DijonApi.token = token;
        } catch (error) {
            if (error.response.status === 401) {
                alert('invalid username or password');
                return;
            } else {
                alert('unknown error trying to authenticate with the server');
                return;
            }
        }
        let response = await uploadNawsCodes(file, selectedRootServerForUpload);
        alert(response);
        // leave the username and password
        // also leave the current server selection set though (could go the other way on this decision)
        // unset current NAWS code file selection (it seems weird to leave it enabled, so that you could trivially upload the same codes again)
        nawsCodesFile =  null;
        document.getElementById("naws_codes_file").value = "";
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
            <td class="inputLabel">Server:</td>
            <td>
                {#if rootServers}
                    <form>
                        <select class="selectionMenu" bind:value={selectedRootServer} on:change="{serverSelectionChanged}">
                            <option disabled selected value> -- select a server -- </option>
                            {#each rootServers as server }
                                <option value={server}>
                                    {server.menuName()}
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
            <td class="inputLabel">Start Date:</td>
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
            <td class="inputLabel">End Date:</td>
            <td>
                {#if rootServers && snapshots && firstSnapshot && lastSnapshot}
                    <DateInput format="yyyy-MM-dd" placeholder={format(lastSnapshot.date, "yyy-MM-dd")}
                        min={firstSnapshot.date} max={lastSnapshot.date} bind:value={rawEndDate} />
                {/if}
            </td>
        </tr>
        <tr>
            <td class="inputLabel">Service Body:</td>
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
            <td></td>
            <td>
                <label>
                    <input type=checkbox bind:checked={showOriginalNawsCodes}>
                    Include original NAWS codes in spreadsheet as well as overrides
                </label>
            </td>
        </tr>
        <tr>
            <td class="inputLabel">Extra Meetings:</td>
            <td>
                <label>
                    <input type=checkbox bind:checked={includeExtraMeetings}>
                    Include all meetings with the same World ID as one with changes
                </label>
            </td>
        </tr>
        <tr>
            <td class="inputLabel">World ID changes:</td>
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
            <td>Include original NAWS codes:</td>
            <td class="informationItem">{showOriginalNawsCodes}</td>
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
            on:click={ callGenerateSpreadsheet }>
        Generate spreadsheet
    </button>
    <p></p>
</section>

<section>
    <hr class="thick">
    <h2>NAWS Codes Upload</h2>
</section>

<section>
    <table>
        <tr>
            <td class="inputLabel">Username:&nbsp;</td>
            <td>
                <form>
                    <input type="text" id="username" name="username" bind:value={username}>
                </form>
            </td>
        </tr>
        <tr>
            <td class="inputLabel">Password:&nbsp;</td>
            <td>
                <form>
                    <input type="password" id="password" name="password" bind:value={password}>
                </form>
            </td>
        </tr>
        <tr>
            <td class="inputLabel">Server:</td>
            <td>
                {#if rootServers}
                    <form>
                        <select class="selectionMenu" bind:value={selectedRootServerForUpload}>
                            <option disabled selected value> -- select a server -- </option>
                            {#each rootServers as serverForUpload }
                                <option value={serverForUpload}>
                                    {serverForUpload.menuName()}
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
            <td class="inputLabel">Spreadsheet:&nbsp;</td>
            <td>
                <form>
                    <input type="file" id="naws_codes_file" name="naws_codes_file" accept=".xlsx,.xls,.csv" bind:value={nawsCodesFile}>
                </form>
            </td>
        </tr>
    </table>
    <p></p>
</section>

<section>
    <div>
        <button disabled={ !username || !password || !nawsCodesFile || !selectedRootServerForUpload } on:click={callUploadNawsCodes}>
            Upload spreadsheet to override NAWS codes for selected server
        </button>
        <p></p>
    </div>
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

    .inputLabel {
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

    hr.thick {
        border: 3px solid green;
        border-radius: 5px;
        width: 90%;
    }

</style>
