<svelte:head>
  <title>Dijon Spreadsheet Query Builder</title>
</svelte:head>

<script>
  import { DateInput } from 'date-picker-svelte'
  let dijon_server = 'https://dijon.jrb.lol';
  let server_promise = fetch_servers();
  let snapshots_promise = fetch_snapshots();

  async function fetch_servers() {
    const response = await self.fetch(new URL('rootservers', dijon_server));
    if (response.ok) {
      return response.json();
    } else {
      throw new Error(servers);
    }
  }

  // for now just get all the snapshots; later we could just get the snapshots for the selected server
  async function fetch_snapshots() {
    const response = await self.fetch(new URL('snapshots', dijon_server));
    if (response.ok) {
      return response.json();
    } else {
      throw new Error(servers);
    }
  }

  let selected_server;

  // find the most recent snapshot (if any) that was retrieved on or before d for the currently selected server
  function find_snapshot(snapshots, d) {
    let result;
    if (snapshots) {
      for (let i = 0; i < snapshots.length; i++) {
        let s = snapshots[i];
        if (s.root_server_id == selected_server && new Date(s.date) <= d && (!result || new Date(result.date) < new Date(s.date) )) {
          result = s;
        }
      }
    }
    return result;
  }

  // get a displayable date string from a date d (which might be null)
  function get_date_string(d) {
    if (d) {
      return d.toDateString();
    } else {
      return 'none';
    }
  }

  // get a displayable date string from a shapshot
  function get_snapshot_date(s) {
    if (s) {
      return s.date;
    } else {
      return 'none';
    }
  }

  let start_date;
  let end_date;
  // I'd like to have variables defined here for start_snapshot and end_snapshot, not sure how to get at snapshots!
  // $: start_snapshot = find_snapshot(snapshots, start_date);
  // $: end_snapshot = find_snapshot(snapshots, end_date);

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
	{#await server_promise}
	  <p>...retrieving servers</p>
  {:then servers}
    <form>
      <select bind:value={selected_server}>
        {#each servers as server }
          <option value={server.id}>
            {server.name}
          </option>
        {/each}
      </select>
    </form>
  {:catch error}
    <p style="color: red">{error.message}</p>
  {/await}
</section>

<section>
	<h2>Start and End Dates:</h2>
	  Start: <DateInput bind:value={start_date} />
	  <p></p>
	  End: <DateInput bind:value={end_date} />
</section>

<section>
	<h2>Current Selection</h2>
	{#await snapshots_promise}
	  <p>...retrieving snapshots</p>
	{:then snapshots}
	  <p>selected server {selected_server ? selected_server : '[waiting...]'}</p>
	  <p>Start date: {get_date_string(start_date)}</p>
    <p>End date: {get_date_string(end_date)}</p>
    <p>closest snapshot to start date: {get_snapshot_date(find_snapshot(snapshots, start_date))}</p>
    <p>closest snapshot to end date: {get_snapshot_date(find_snapshot(snapshots, end_date))}</p>
	{:catch error}
    <p style="color: red">{error.message}</p>
	{/await}
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
