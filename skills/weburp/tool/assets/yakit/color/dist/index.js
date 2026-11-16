"use strict";
var __createBinding = (this && this.__createBinding) || (Object.create ? (function(o, m, k, k2) {
    if (k2 === undefined) k2 = k;
    var desc = Object.getOwnPropertyDescriptor(m, k);
    if (!desc || ("get" in desc ? !m.__esModule : desc.writable || desc.configurable)) {
      desc = { enumerable: true, get: function() { return m[k]; } };
    }
    Object.defineProperty(o, k2, desc);
}) : (function(o, m, k, k2) {
    if (k2 === undefined) k2 = k;
    o[k2] = m[k];
}));
var __exportStar = (this && this.__exportStar) || function(m, exports) {
    for (var p in m) if (p !== "default" && !Object.prototype.hasOwnProperty.call(exports, p)) __createBinding(exports, m, p);
};
Object.defineProperty(exports, "__esModule", { value: true });
exports.TAG_COLOR_NAMES = exports.SEMANTIC_COLOR_NAMES = exports.generateStatusSemanticColors = exports.generateTagSemanticColors = exports.generateSemanticColors = exports.generateBasicSemanticColors = exports.generateNeutralSemanticColors = exports.blackBackgroundColor = exports.whiteBackgroundColor = exports.yakitThemeColors = exports.getMixPercent = exports.generateSingleThemeColor = exports.generateAllThemeColors = exports.resolveMainColor = exports.resolveBrandThemeColor = exports.parseMainColor = exports.isBrandThemeName = exports.brandThemeColors = void 0;
exports.generateAllSemanticColors = generateAllSemanticColors;
exports.generateColors = generateColors;
exports.applyThemeColors = applyThemeColors;
const generator_1 = require("./generator");
Object.defineProperty(exports, "generateAllThemeColors", { enumerable: true, get: function () { return generator_1.generateAllThemeColors; } });
Object.defineProperty(exports, "generateSingleThemeColor", { enumerable: true, get: function () { return generator_1.generateSingleThemeColor; } });
Object.defineProperty(exports, "getMixPercent", { enumerable: true, get: function () { return generator_1.getMixPercent; } });
Object.defineProperty(exports, "yakitThemeColors", { enumerable: true, get: function () { return generator_1.yakitThemeColors; } });
Object.defineProperty(exports, "whiteBackgroundColor", { enumerable: true, get: function () { return generator_1.whiteBackgroundColor; } });
Object.defineProperty(exports, "blackBackgroundColor", { enumerable: true, get: function () { return generator_1.blackBackgroundColor; } });
const component_1 = require("./component");
Object.defineProperty(exports, "generateNeutralSemanticColors", { enumerable: true, get: function () { return component_1.generateNeutralSemanticColors; } });
Object.defineProperty(exports, "generateBasicSemanticColors", { enumerable: true, get: function () { return component_1.generateBasicSemanticColors; } });
Object.defineProperty(exports, "generateSemanticColors", { enumerable: true, get: function () { return component_1.generateSemanticColors; } });
Object.defineProperty(exports, "generateTagSemanticColors", { enumerable: true, get: function () { return component_1.generateTagSemanticColors; } });
Object.defineProperty(exports, "generateStatusSemanticColors", { enumerable: true, get: function () { return component_1.generateStatusSemanticColors; } });
const apply_theme_1 = require("./apply-theme");
__exportStar(require("./generator"), exports);
__exportStar(require("./component"), exports);
var themes_1 = require("./themes");
Object.defineProperty(exports, "brandThemeColors", { enumerable: true, get: function () { return themes_1.brandThemeColors; } });
Object.defineProperty(exports, "isBrandThemeName", { enumerable: true, get: function () { return themes_1.isBrandThemeName; } });
Object.defineProperty(exports, "parseMainColor", { enumerable: true, get: function () { return themes_1.parseMainColor; } });
Object.defineProperty(exports, "resolveBrandThemeColor", { enumerable: true, get: function () { return themes_1.resolveBrandThemeColor; } });
Object.defineProperty(exports, "resolveMainColor", { enumerable: true, get: function () { return themes_1.resolveMainColor; } });
const SEMANTIC_COLOR_NAMES = ['Main', 'Error', 'Warning', 'Success', 'Blue'];
exports.SEMANTIC_COLOR_NAMES = SEMANTIC_COLOR_NAMES;
const TAG_COLOR_NAMES = [
    'Purple',
    'Magenta',
    'Lake-blue',
    'Cyan',
    'Green',
    'Red',
    'Orange',
    'Yellow',
    'Grey',
];
exports.TAG_COLOR_NAMES = TAG_COLOR_NAMES;
function generateAllSemanticColors(mode = 'light') {
    const result = {};
    Object.assign(result, (0, component_1.generateNeutralSemanticColors)(mode));
    Object.assign(result, (0, component_1.generateBasicSemanticColors)(mode));
    Object.assign(result, (0, component_1.generateStatusSemanticColors)(mode));
    SEMANTIC_COLOR_NAMES.forEach((name) => {
        Object.assign(result, (0, component_1.generateSemanticColors)(name, mode));
    });
    TAG_COLOR_NAMES.forEach((name) => {
        Object.assign(result, (0, component_1.generateTagSemanticColors)(name, mode));
    });
    return result;
}
function generateColors(mode = 'light', mainColorOverride) {
    return {
        ...(0, generator_1.generateAllThemeColors)(mode, mainColorOverride),
        ...generateAllSemanticColors(mode),
    };
}
function applyThemeColors(mode, colors, target) {
    (0, apply_theme_1.applyThemeColors)(mode, colors, target);
}
//# sourceMappingURL=index.js.map