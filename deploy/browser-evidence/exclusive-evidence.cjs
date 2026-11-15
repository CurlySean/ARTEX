// The pinned MCP release overwrites binary evidence when two callers reuse a name.
// O_EXCL atomically makes an existing screenshot an error, including across sessions.
const fs = require('node:fs');
const bundle = require.resolve('playwright-core/package.json').replace(/package\.json$/, 'lib/coreBundle.js');
const code = fs.readFileSync(bundle, 'utf8');
const original = 'await import_fs52.default.promises.writeFile(resolvedFile.fileName, data);';
if (code.split(original).length !== 2)
    throw new Error('Unexpected Playwright evidence writer');
fs.writeFileSync(bundle, code.replace(original, 'await import_fs52.default.promises.writeFile(resolvedFile.fileName, data, { flag: "wx" });'));
