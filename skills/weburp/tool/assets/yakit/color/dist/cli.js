#!/usr/bin/env node
"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.parseCliOptions = parseCliOptions;
exports.runCli = runCli;
const node_1 = require("./node");
const USAGE = `Usage: yakit-color-css (--main <hex-color> | --theme <name>) --out <file> [--hashed]

Options:
  --main      Main theme color, for example "#1677ff"
  --theme     Preset brand theme: Main, Web, Gold, Memfit, or Irify
  --out       Output CSS file, for example "public/theme.css"
  --hashed    Add a content hash to the CSS filename and write a manifest
  --manifest  Custom manifest path (only with --hashed)
  --help      Show this help message`;
function readOptionValue(args, index, name) {
    const argument = args[index];
    const inlinePrefix = `${name}=`;
    if (argument.startsWith(inlinePrefix)) {
        return [argument.slice(inlinePrefix.length), index];
    }
    const value = args[index + 1];
    if (!value || value.startsWith('--')) {
        throw new Error(`Missing value for ${name}.`);
    }
    return [value, index + 1];
}
function parseCliOptions(args) {
    const options = { hashed: false, help: false };
    for (let index = 0; index < args.length; index += 1) {
        const argument = args[index];
        if (argument === '--help' || argument === '-h') {
            options.help = true;
        }
        else if (argument === '--hashed') {
            options.hashed = true;
        }
        else if (argument === '--main' || argument.startsWith('--main=')) {
            ;
            [options.mainColor, index] = readOptionValue(args, index, '--main');
        }
        else if (argument === '--theme' || argument.startsWith('--theme=')) {
            ;
            [options.theme, index] = readOptionValue(args, index, '--theme');
        }
        else if (argument === '--out' || argument.startsWith('--out=')) {
            ;
            [options.output, index] = readOptionValue(args, index, '--out');
        }
        else if (argument === '--manifest' || argument.startsWith('--manifest=')) {
            ;
            [options.manifest, index] = readOptionValue(args, index, '--manifest');
        }
        else {
            throw new Error(`Unknown argument "${argument}".`);
        }
    }
    return options;
}
function runCli(args, stdout = process.stdout, stderr = process.stderr) {
    var _a;
    try {
        const options = parseCliOptions(args);
        if (options.help) {
            stdout.write(`${USAGE}\n`);
            return 0;
        }
        if ((!options.mainColor && !options.theme) || (options.mainColor && options.theme)) {
            throw new Error('Provide exactly one of --main or --theme, and --out is required.');
        }
        if (!options.output) {
            throw new Error('--out is required.');
        }
        if (options.manifest && !options.hashed) {
            throw new Error('--manifest can only be used with --hashed.');
        }
        const mainColorOrTheme = (_a = options.theme) !== null && _a !== void 0 ? _a : options.mainColor;
        if (options.hashed) {
            const result = (0, node_1.writeHashedThemeCss)({
                mainColor: mainColorOrTheme,
                output: options.output,
                manifest: options.manifest,
            });
            stdout.write(`${result.written ? 'Generated' : 'Unchanged'} ${result.output}\n`);
            stdout.write(`${result.manifestWritten ? 'Generated' : 'Unchanged'} ${result.manifest}\n`);
        }
        else {
            const result = (0, node_1.writeThemeCss)({
                mainColor: mainColorOrTheme,
                output: options.output,
            });
            stdout.write(`${result.written ? 'Generated' : 'Unchanged'} ${result.output}\n`);
        }
        return 0;
    }
    catch (error) {
        const message = error instanceof Error ? error.message : String(error);
        stderr.write(`Error: ${message}\n\n${USAGE}\n`);
        return 1;
    }
}
if (require.main === module) {
    process.exitCode = runCli(process.argv.slice(2));
}
//# sourceMappingURL=cli.js.map