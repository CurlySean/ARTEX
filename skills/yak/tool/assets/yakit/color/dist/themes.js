"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.brandThemeColors = void 0;
exports.isBrandThemeName = isBrandThemeName;
exports.parseMainColor = parseMainColor;
exports.resolveBrandThemeColor = resolveBrandThemeColor;
exports.resolveMainColor = resolveMainColor;
exports.brandThemeColors = {
    Main: '#F17F30',
    Web: '#E76800',
    Gold: '#B49434',
    Memfit: {
        light: '#2E63B3',
        dark: '#5E9DEA',
    },
    Irify: {
        light: '#6A44A9',
        dark: '#B081FF',
    },
};
const HEX_COLOR_PATTERN = /^#(?:[\da-f]{3}|[\da-f]{6})$/i;
function isBrandThemeName(value) {
    return Object.prototype.hasOwnProperty.call(exports.brandThemeColors, value);
}
function parseMainColor(mainColor) {
    const normalized = mainColor.trim();
    if (!HEX_COLOR_PATTERN.test(normalized)) {
        throw new TypeError(`Invalid main color "${mainColor}". Expected a 3 or 6 digit hex color, for example "#1677ff".`);
    }
    return normalized;
}
function resolveBrandThemeColor(themeName, mode = 'light') {
    const config = exports.brandThemeColors[themeName];
    return typeof config === 'string' ? config : config[mode];
}
function resolveMainColor(mainColorOrTheme, mode = 'light') {
    const normalized = mainColorOrTheme.trim();
    if (isBrandThemeName(normalized)) {
        return resolveBrandThemeColor(normalized, mode);
    }
    return parseMainColor(normalized);
}
//# sourceMappingURL=themes.js.map