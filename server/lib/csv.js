const fs = require('fs');
const path = require('path');

// Shared CSV helpers for the study-log writers.
//
// Every write here is synchronous on purpose. Express handlers run one at a
// time on a single thread, so an fs.*Sync call completes before the next
// request is dequeued and two concurrent flushes can never interleave inside a
// file. Converting these to fs.promises would introduce exactly the race this
// avoids — don't.

function escape(value) {
    const s = value === null || value === undefined ? '' : String(value);
    return /[,"\n\r]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
}

function toLine(headers, row) {
    return headers.map((h) => escape(row[h])).join(',');
}

// Full CSV parse: fields may contain commas, escaped quotes, and newlines
// (transcript text and JSON detail columns do), so line-splitting is not safe.
function parseCsv(text) {
    const records = [];
    let row = [];
    let field = '';
    let quoted = false;

    for (let i = 0; i < text.length; i += 1) {
        const c = text[i];
        if (quoted) {
            if (c === '"') {
                if (text[i + 1] === '"') { field += '"'; i += 1; }
                else quoted = false;
            } else field += c;
            continue;
        }
        if (c === '"') quoted = true;
        else if (c === ',') { row.push(field); field = ''; }
        else if (c === '\n') { row.push(field); records.push(row); row = []; field = ''; }
        else if (c !== '\r') field += c;
    }
    if (field !== '' || row.length) { row.push(field); records.push(row); }
    return records.filter((r) => r.length > 1 || (r[0] ?? '').trim() !== '');
}

// Rewrites a file whose on-disk header no longer matches `headers`, remapping
// every existing row by column NAME. Without this, changing a header list would
// keep the old header line while writing new rows in the new column order, so
// values would silently land under the wrong columns.
//
// Columns that were removed are dropped; columns that were added come out blank
// for historical rows. Returns true when a migration happened.
function migrateHeaderIfNeeded(filePath, headers) {
    if (!fs.existsSync(filePath)) return false;
    const text = fs.readFileSync(filePath, 'utf8');
    if (!text.trim()) return false;

    const records = parseCsv(text);
    if (records.length === 0) return false;

    const oldHeader = records[0];
    if (oldHeader.length === headers.length && oldHeader.every((h, i) => h === headers[i])) {
        return false;
    }

    const remapped = records.slice(1).map((cells) => {
        const obj = {};
        oldHeader.forEach((name, i) => { obj[name] = cells[i] ?? ''; });
        return toLine(headers, obj);
    });

    fs.writeFileSync(filePath, headers.join(',') + '\n' + (remapped.length ? remapped.join('\n') + '\n' : ''));
    console.log(`[csv] migrated header of ${path.basename(filePath)} (${oldHeader.length} -> ${headers.length} columns, ${remapped.length} rows remapped)`);
    return true;
}

// Appends rows, writing the header line first if the file does not exist yet.
function appendRows(filePath, headers, rows) {
    if (!rows || rows.length === 0) return 0;
    fs.mkdirSync(path.dirname(filePath), { recursive: true });
    migrateHeaderIfNeeded(filePath, headers);

    const lines = rows.map((r) => toLine(headers, r));
    const needsHeader = !fs.existsSync(filePath);
    const chunk = (needsHeader ? headers.join(',') + '\n' : '') + lines.join('\n') + '\n';
    fs.appendFileSync(filePath, chunk);
    return rows.length;
}

// Read-modify-write a single row identified by keyColumn. Used for the session
// metadata file, where a row is written at session start and completed at
// session end — an append would leave two half-rows per session instead of one.
function upsertRow(filePath, headers, row, keyColumn) {
    fs.mkdirSync(path.dirname(filePath), { recursive: true });

    const key = String(row[keyColumn] ?? '');
    const newLine = toLine(headers, row);

    if (!fs.existsSync(filePath)) {
        fs.writeFileSync(filePath, headers.join(',') + '\n' + newLine + '\n');
        return 'created';
    }

    // Bring the file onto the current column list first. Previously this kept
    // the file's own (possibly stale) header while writing new rows in the new
    // column order, which silently shifted values into the wrong columns.
    migrateHeaderIfNeeded(filePath, headers);

    const existing = fs.readFileSync(filePath, 'utf8').split('\n');
    const header = existing[0];
    const body = existing.slice(1).filter((l) => l.trim());

    const keyIdx = headers.indexOf(keyColumn);
    const escapedKey = escape(key);
    let replaced = false;

    const nextBody = body.map((line) => {
        if (replaced || keyIdx < 0) return line;
        // Key values are ids (no commas/quotes), so a plain split is safe here.
        if (line.split(',')[keyIdx] !== escapedKey) return line;
        replaced = true;
        return newLine;
    });

    if (!replaced) nextBody.push(newLine);
    fs.writeFileSync(filePath, header + '\n' + nextBody.join('\n') + '\n');
    return replaced ? 'updated' : 'appended';
}

// Concatenates CSVs that share a header, dropping all but the first header.
// The caller supplies the header row it wants on the combined output.
function concatBodies(files) {
    const bodies = [];
    for (const f of files) {
        const content = fs.readFileSync(f, 'utf8');
        const newlineIdx = content.indexOf('\n');
        if (newlineIdx === -1) continue;
        const body = content.slice(newlineIdx + 1);
        if (body.trim()) bodies.push(body.endsWith('\n') ? body : body + '\n');
    }
    return bodies.join('');
}

module.exports = { escape, appendRows, upsertRow, concatBodies };
