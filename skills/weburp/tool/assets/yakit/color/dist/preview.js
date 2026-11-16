"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.darkColors = exports.lightColors = void 0;
exports.getColors = getColors;
exports.generateColors = generateColors;
exports.applyThemeColors = applyThemeColors;
const apply_theme_1 = require("./apply-theme");
const colors_1 = require("./precomputed/colors");
Object.defineProperty(exports, "darkColors", { enumerable: true, get: function () { return colors_1.darkColors; } });
Object.defineProperty(exports, "lightColors", { enumerable: true, get: function () { return colors_1.lightColors; } });
const colorsByMode = {
    light: colors_1.lightColors,
    dark: colors_1.darkColors,
};
/** Return pre-computed color variables for the given theme mode (zero runtime calculation). */
function getColors(mode = 'light') {
    return colorsByMode[mode];
}
/** Alias of {@link getColors} for drop-in replacement of the runtime `generateColors`. */
function generateColors(mode = 'light') {
    return getColors(mode);
}
function applyThemeColors(mode, colors = getColors(mode), target) {
    (0, apply_theme_1.applyThemeColors)(mode, colors, target);
}
//# sourceMappingURL=preview.js.map