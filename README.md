# Dijon Spreadsheet Maker

Dijon is a system to help synchronize BMLT meeting data with the meeting database maintained by NAWS.  There is a server that periodically grabs a snapshot from each participating BMLT root server and that provides an API for accessing snapshots and changes between snapshots.  The goal is to grab one snapshot per day -- there might be missing days if something is down, but there should never be more than one snapshot per BMLT server per day.

The spreadsheet maker is a UI for the server.  It provides a web-based query builder for producing spreadsheets showing the meeting changes between selected dates for a given service body.  The user selects the server, the desired start and end dates, and the service body.  At that point the “generate spreadsheet” button will become active and can be pressed to generate and download a spreadsheet.  The available start and end dates are bounded by the dates of the first and last snapshots for the selected BMLT server.  The available service bodies for the changes spreadsheet are those that are stored for the end snapshot.  Finally, if a snapshot isn't available for the desired start or end date, the closest earlier one will be used, and a warning displayed.

## Development Mode

The spreadsheet maker is written using [SvelteKit](https://kit.svelte.dev/docs/introduction).  Clone this repo, connect to the project directory, and install dependencies with `npm install`.  Then this command will start a server on http://localhost:3000:

```bash
npm run dev

# or start the server and open the app in a new browser tab
npm run dev -- --open
```

## Building

To create a production version of your app:

```bash
npm run build
```

You can preview the production build with `npm run preview`.


## Publishing (GitHub)

To deploy to gh-pages branch:

```bash
npm run deploy
```
Access the deployed server at https://dijon.bmlt.dev/
