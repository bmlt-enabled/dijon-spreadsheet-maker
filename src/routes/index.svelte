<svelte:head>
  <title>Dijon Spreadsheet Query Builder</title>
</svelte:head>

<script>
  import { onMount } from 'svelte';
  import { DateInput } from 'date-picker-svelte'
  import { RootServer } from '$lib/RootServer';
  import { Snapshot } from '$lib/Snapshot';

  const dijonBaseUrl = 'https://dijon.jrb.lol';
  const rootServersUrl = new URL('rootservers', dijonBaseUrl);
  const snapshotsUrl = new URL('snapshots', dijonBaseUrl);
  let rootServers;
  let rootServersError;
  let snapshots;
  let snapshotsError;
  let selectedRootServer;
  let startDate;
  let endDate;
  let startSnapshot;
  let endSnapshot;

  onMount(() => {
    fetchRootServers();
    fetchSnapshots();
  });

  $: selectedRootServer && startDate && (startSnapshot = findSnapshot(startDate));
  $: selectedRootServer && endDate && (endSnapshot = findSnapshot(endDate));

  async function fetchRootServers() {
    const response = await fetch(rootServersUrl);
    if (!response.ok) {
      rootServersError = `Got ${response.status} status from ${url}.`
      return;
    }

    const _rootServers = [];
    for (let rawRootServer of await response.json()) {
      const rootServer = new RootServer(rawRootServer.id, rawRootServer.name, rawRootServer.url);
      _rootServers.push(rootServer);
    }

    rootServers = _rootServers;
  }

  async function fetchSnapshots() {
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
      <select bind:value={selectedRootServer}>
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
  {#if rootServers && snapshots}
	  <h2>Start and End Dates:</h2>
	  Start: <DateInput bind:value={startDate} />
	  <p></p>
	  End: <DateInput bind:value={endDate} />
  {/if}
</section>

<section>
	<h2>Current Selection</h2>
  {#if snapshots}
    <p>selected server {selectedRootServer?.name ?? '[waiting...]'}</p>
    <p>Start date: {startDate?.toDateString() ?? 'none'}</p>
    <p>End date: {endDate?.toDateString() ?? 'none'}</p>
    {#if startDate}
      <p>closest snapshot to start date: {startSnapshot?.date ?? 'none'}</p>
    {/if}
    {#if endDate}
      <p>closest snapshot to end date: {endSnapshot?.date ?? 'none'}</p>
    {/if}
  {:else if snapshotsError}
    <p style="color: red">{snapshotsError.message}</p>
  {:else}
    <p>...retrieving snapshots</p>
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
