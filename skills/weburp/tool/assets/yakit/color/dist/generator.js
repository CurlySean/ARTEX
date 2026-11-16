"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.yakitThemeColors = exports.blackBackgroundColor = exports.whiteBackgroundColor = void 0;
exports.resolveColorVariable = resolveColorVariable;
exports.generateColorScales = generateColorScales;
exports.generateRandomColorScales = generateRandomColorScales;
exports.getMixPercent = getMixPercent;
exports.generateSingleThemeColor = generateSingleThemeColor;
exports.generateAllThemeColors = generateAllThemeColors;
exports.whiteBackgroundColor = '#ffffff';
exports.blackBackgroundColor = '#171717';
const yakitLightMixSteps = new Map([
    [10, ['92%', 'light']],
    [20, ['88%', 'light']],
    [30, ['80%', 'light']],
    [40, ['55%', 'light']],
    [50, ['25%', 'light']],
    [60, ['10%', 'light']],
    [70, ['10%', 'dark']],
    [80, ['25%', 'dark']],
    [90, ['55%', 'dark']],
    [100, ['80%', 'dark']],
]);
const yakitDarkMixSteps = new Map([
    [10, ['92%', 'dark']],
    [20, ['80%', 'dark']],
    [30, ['70%', 'dark']],
    [40, ['55%', 'dark']],
    [50, ['30%', 'dark']],
    [60, ['10%', 'dark']],
    [70, ['5%', 'light']],
    [80, ['25%', 'light']],
    [90, ['55%', 'light']],
    [100, ['80%', 'light']],
]);
exports.yakitThemeColors = {
    Main: '#F17F30',
    Success: '#10B981',
    Warning: '#F59E0B',
    Error: '#EF4444',
    Neutral: '#ABB3C2',
    Purple: '#7B51F7',
    Magenta: '#D84ADB',
    Blue: '#2F87FF',
    'Lake-blue': '#18B5CB',
    Cyan: '#26D4EB',
    Green: '#41C484',
    Red: '#F36259',
    Orange: '#FFAE4E',
    Yellow: '#FFC905',
};
const parsePercent = (percent) => {
    if (typeof percent === 'string' && percent.endsWith('%')) {
        return parseFloat(percent) / 100;
    }
    return Number(percent);
};
function mixColors(color1, color2, weight) {
    function hexToRgb(hex) {
        let c = hex.replace('#', '');
        if (c.length === 3) {
            c = c
                .split('')
                .map((x) => x + x)
                .join('');
        }
        const bigint = parseInt(c, 16);
        return [(bigint >> 16) & 255, (bigint >> 8) & 255, bigint & 255];
    }
    function rgbToHex(rgb) {
        const hex = '#' +
            rgb
                .map((x) => {
                const h = x.toString(16);
                return h.length === 1 ? '0' + h : h;
            })
                .join('');
        return hex;
    }
    const c1 = hexToRgb(color1);
    const c2 = hexToRgb(color2);
    const w = parsePercent(weight);
    const mixed = [
        Math.round(c1[0] * w + c2[0] * (1 - w)),
        Math.round(c1[1] * w + c2[1] * (1 - w)),
        Math.round(c1[2] * w + c2[2] * (1 - w)),
    ];
    return rgbToHex(mixed);
}
const hexColorPattern = /^#[0-9a-f]{3}(?:[0-9a-f]{3})?$/i;
const colorNamePattern = /^[A-Za-z][A-Za-z0-9-]*$/;
const colorVariablePattern = /^--(?:Colors-Use-|yakit-colors-)[A-Za-z0-9_-]+$/;
const varFunctionPattern = /^var\(\s*(--[A-Za-z0-9_-]+)\s*\)$/;
const hexColorSpaceSize = 0x1000000;
function parseHexColor(value, label) {
    const hex = value.trim();
    if (!hexColorPattern.test(hex)) {
        throw new TypeError(`${label} must be a 3- or 6-digit hexadecimal color.`);
    }
    return hex;
}
function normalizeHexColor(value, label) {
    const hex = parseHexColor(value, label).slice(1).toLowerCase();
    return hex.length === 3
        ? hex
            .split('')
            .map((character) => character + character)
            .join('')
        : hex;
}
function formatHexColorNumber(value) {
    return value.toString(16).padStart(6, '0');
}
function readColorVariable(source, variableName) {
    var _a;
    if ('getPropertyValue' in source && typeof source.getPropertyValue === 'function') {
        return source.getPropertyValue(variableName);
    }
    return (_a = source[variableName]) !== null && _a !== void 0 ? _a : '';
}
function parseColorVariable(value) {
    var _a;
    const trimmed = value.trim();
    const variableName = trimmed.startsWith('var(') ? (_a = varFunctionPattern.exec(trimmed)) === null || _a === void 0 ? void 0 : _a[1] : trimmed;
    if (!variableName || !colorVariablePattern.test(variableName)) {
        throw new TypeError(`Invalid color variable: "${value}".`);
    }
    return variableName;
}
/** Resolves a Yakit CSS custom property to its final hexadecimal value. */
function resolveColorVariable(variableNameOrVar, source) {
    var _a;
    let variableName = parseColorVariable(variableNameOrVar);
    const visited = new Set();
    while (!visited.has(variableName)) {
        visited.add(variableName);
        const value = readColorVariable(source, variableName).trim();
        if (!value) {
            throw new TypeError(`Unknown color variable: "${variableName}".`);
        }
        if (hexColorPattern.test(value)) {
            return value;
        }
        const referencedVariable = (_a = varFunctionPattern.exec(value)) === null || _a === void 0 ? void 0 : _a[1];
        if (!referencedVariable || !colorVariablePattern.test(referencedVariable)) {
            throw new TypeError(`Color variable "${variableName}" does not resolve to a hexadecimal color.`);
        }
        variableName = referencedVariable;
    }
    throw new TypeError(`Circular color variable reference detected at "${variableName}".`);
}
function generateColorScale(name, color, mode) {
    const steps = mode === 'light' ? yakitLightMixSteps : yakitDarkMixSteps;
    const result = {};
    for (const [level, [percent, direction]] of steps) {
        const targetBg = direction === 'light' ? exports.whiteBackgroundColor : exports.blackBackgroundColor;
        result[`--yakit-colors-${name}-${level}`] = mixColors(targetBg, color, percent);
    }
    return result;
}
function generateColorScalesForMode(colors, mode) {
    const result = {};
    for (const entry of colors) {
        Object.assign(result, generateColorScale(entry.name, entry.hex, mode));
    }
    return result;
}
/** Generates light and dark Yakit color levels for each consumer-provided base color. */
function generateColorScales(colors) {
    const names = new Set();
    const normalizedColors = [];
    for (const entry of colors) {
        const name = entry.name.trim();
        if (!colorNamePattern.test(name)) {
            throw new TypeError(`Invalid color name: "${entry.name}".`);
        }
        if (names.has(name)) {
            throw new TypeError(`Duplicate color name: "${name}".`);
        }
        names.add(name);
        normalizedColors.push({ name, hex: parseHexColor(entry.hex, `Color "${name}"`) });
    }
    return {
        light: generateColorScalesForMode(normalizedColors, 'light'),
        dark: generateColorScalesForMode(normalizedColors, 'dark'),
    };
}
/** Generates random color scales from unique base colors while honoring exact exclusions. */
function generateRandomColorScales(excludedHexColors = [], generateColorsNum = 5) {
    if (!Number.isSafeInteger(generateColorsNum) || generateColorsNum < 0) {
        throw new RangeError('generateColorsNum must be a non-negative safe integer.');
    }
    const unavailable = new Set(excludedHexColors.map((hex, index) => normalizeHexColor(hex, `Excluded color at index ${index}`)));
    if (generateColorsNum > hexColorSpaceSize - unavailable.size) {
        throw new RangeError('Not enough unique hexadecimal colors are available.');
    }
    const colors = [];
    let nextSequentialColor = 0;
    for (let index = 0; index < generateColorsNum; index += 1) {
        let normalizedHex = '';
        for (let attempt = 0; attempt < 100 && !normalizedHex; attempt += 1) {
            const candidate = formatHexColorNumber(Math.floor(Math.random() * hexColorSpaceSize));
            if (!unavailable.has(candidate)) {
                normalizedHex = candidate;
            }
        }
        while (!normalizedHex && nextSequentialColor < hexColorSpaceSize) {
            const candidate = formatHexColorNumber(nextSequentialColor);
            nextSequentialColor += 1;
            if (!unavailable.has(candidate)) {
                normalizedHex = candidate;
            }
        }
        if (!normalizedHex) {
            throw new RangeError('Not enough unique hexadecimal colors are available.');
        }
        unavailable.add(normalizedHex);
        colors.push({ name: `Random-${index + 1}`, hex: `#${normalizedHex}` });
    }
    return generateColorScales(colors);
}
function getMixPercent(name, mode, level, defaultPercent) {
    if (name === 'Neutral' && mode === 'dark' && level === 10) {
        return '88%';
    }
    if (name === 'Neutral' && mode === 'light' && level === 20) {
        return '80%';
    }
    if (name === 'Neutral' && mode === 'light' && level === 30) {
        return '70%';
    }
    return defaultPercent;
}
function generateSingleThemeColor(name, mode = 'light', mainColorOverride) {
    let color = exports.yakitThemeColors[name];
    if (name === 'Neutral' && mode === 'dark') {
        color = '#B6C0D2';
    }
    else if (name === 'Yellow' && mode === 'dark') {
        color = '#FFD230';
    }
    else if (name === 'Neutral' && mode === 'light') {
        color = '#ABB3C2';
    }
    else if (name === 'Yellow' && mode === 'light') {
        color = '#FFC905';
    }
    else if (name === 'Purple' && mode === 'dark') {
        color = '#9B79FF';
    }
    else if (name === 'Purple' && mode === 'light') {
        color = '#7B51F7';
    }
    if (!color) {
        throw new Error(`Color "${name}" not found in yakitThemeColors.`);
    }
    if (name === 'Main' && mainColorOverride) {
        color = mainColorOverride;
    }
    const steps = mode === 'light' ? yakitLightMixSteps : yakitDarkMixSteps;
    const prefix = `--yakit-colors-${name}-`;
    const result = {};
    for (const [level, info] of steps.entries()) {
        const defaultPercent = info[0];
        const direction = info[1];
        const percent = getMixPercent(name, mode, level, defaultPercent);
        const targetBg = direction === 'light' ? exports.whiteBackgroundColor : exports.blackBackgroundColor;
        const mixedColor = mixColors(targetBg, color, percent);
        result[`${prefix}${level}`] = mixedColor;
    }
    if (name === 'Neutral') {
        if (mode === 'light') {
            result[`${prefix}0`] = exports.whiteBackgroundColor;
            result[`${prefix}110`] = exports.blackBackgroundColor;
        }
        else if (mode === 'dark') {
            result[`${prefix}0`] = exports.blackBackgroundColor;
            result[`${prefix}110`] = exports.whiteBackgroundColor;
        }
    }
    if (name === 'Main') {
        const baseLevel = 60;
        const baseColor = result[`${prefix}${baseLevel}`];
        if (baseColor) {
            const alphaHex = Math.round(0.08 * 255)
                .toString(16)
                .padStart(2, '0');
            result[`${prefix}0`] = `${baseColor}${alphaHex}`;
        }
    }
    return result;
}
function generateAllThemeColors(mode = 'light', mainColorOverride) {
    const allColors = {};
    for (const name in exports.yakitThemeColors) {
        Object.assign(allColors, generateSingleThemeColor(name, mode, name === 'Main' ? mainColorOverride : undefined));
    }
    return allColors;
}
//# sourceMappingURL=generator.js.map