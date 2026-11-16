"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.writeThemeCss = writeThemeCss;
exports.writeHashedThemeCss = writeHashedThemeCss;
const crypto_1 = require("crypto");
const fs_1 = require("fs");
const path_1 = require("path");
const css_generator_1 = require("./css-generator");
function writeFileIfChanged(output, content) {
    if ((0, fs_1.existsSync)(output) && (0, fs_1.readFileSync)(output, 'utf8') === content) {
        return false;
    }
    (0, fs_1.mkdirSync)((0, path_1.dirname)(output), { recursive: true });
    (0, fs_1.writeFileSync)(output, content, 'utf8');
    return true;
}
function writeThemeCss(options) {
    const output = (0, path_1.resolve)(options.output);
    const written = writeFileIfChanged(output, (0, css_generator_1.generateThemeCss)(options.mainColor));
    return { output, written };
}
function writeHashedThemeCss(options) {
    var _a;
    const requestedOutput = (0, path_1.resolve)(options.output);
    const css = (0, css_generator_1.generateThemeCss)(options.mainColor);
    const digest = (0, crypto_1.createHash)('sha256').update(css);
    const hash = digest.copy().digest('hex').slice(0, 12);
    const integrity = `sha256-${digest.digest('base64')}`;
    const extension = (0, path_1.extname)(requestedOutput) || '.css';
    const stem = (0, path_1.basename)(requestedOutput, (0, path_1.extname)(requestedOutput));
    const output = (0, path_1.join)((0, path_1.dirname)(requestedOutput), `${stem}.${hash}${extension}`);
    const manifest = (0, path_1.resolve)((_a = options.manifest) !== null && _a !== void 0 ? _a : (0, path_1.join)((0, path_1.dirname)(requestedOutput), `${stem}-manifest.json`));
    const manifestValue = {
        file: (0, path_1.basename)(output),
        integrity,
    };
    const manifestContent = `${JSON.stringify(manifestValue, null, 2)}\n`;
    const written = writeFileIfChanged(output, css);
    const manifestWritten = writeFileIfChanged(manifest, manifestContent);
    return { output, written, hash, integrity, manifest, manifestWritten };
}
//# sourceMappingURL=node.js.map