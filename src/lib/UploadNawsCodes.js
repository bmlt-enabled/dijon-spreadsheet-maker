// upload a file of NAWS codes

import * as XLSX from 'xlsx';  // need to use the standard one rather than the fork for the read function
export async function uploadNawsCodes (file, selectedRootServer) {
    const data = await file.arrayBuffer();
    const workbook = XLSX.read(data);
    if (workbook.SheetNames.length != 1) {
        alert(`spreadsheet with NAWS codes must contain only one sheet -- found ${workbook.SheetNames.length} sheets`);
        return;
    }
    const rows = XLSX.utils.sheet_to_json(workbook.Sheets[workbook.SheetNames[0]]);
    let updates = [];
    // to use a row for an update, we need at least the Committee (world_id code) and bmlt_id; also the bmlt_id must be an integer
    for (let i = 0; i < rows.length; i++) {
        const r = rows[i];
        if ('Committee' in r && 'bmlt_id' in r && Number.isInteger(r.bmlt_id)) {
            updates.push({bmlt_id: r.bmlt_id, code: r.Committee});
        }
    }
    // batch update meeting NAWS codes here
    // temporarily add additional information to the alert with the specific updates
    let s = `uploaded ${updates.length} items; skipped ${rows.length - updates.length} items\n\nroot server id: ${selectedRootServer.id}\nUPDATES:\n`;
    for (let j = 0; j < updates.length; j++) {
        s += `bmlt_id: ${updates[j].bmlt_id} code: ${updates[j].code}\n`;
    }
    alert(s);
    return;
}
