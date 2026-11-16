"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.isBrandThemeName = exports.brandThemeColors = exports.resolveBrandThemeColor = exports.resolveMainColor = exports.parseMainColor = void 0;
exports.generateThemeCss = generateThemeCss;
const index_1 = require("./index");
const themes_1 = require("./themes");
var themes_2 = require("./themes");
Object.defineProperty(exports, "parseMainColor", { enumerable: true, get: function () { return themes_2.parseMainColor; } });
Object.defineProperty(exports, "resolveMainColor", { enumerable: true, get: function () { return themes_2.resolveMainColor; } });
Object.defineProperty(exports, "resolveBrandThemeColor", { enumerable: true, get: function () { return themes_2.resolveBrandThemeColor; } });
Object.defineProperty(exports, "brandThemeColors", { enumerable: true, get: function () { return themes_2.brandThemeColors; } });
Object.defineProperty(exports, "isBrandThemeName", { enumerable: true, get: function () { return themes_2.isBrandThemeName; } });
function serializeVariables(selector, variables) {
    const declarations = Object.entries(variables)
        .map(([name, value]) => `  ${name}: ${value};`)
        .join('\n');
    return `${selector} {\n${declarations}\n}`;
}
function generateThemeCss(mainColorOrTheme) {
    const selectors = {
        light: ':root',
        dark: '[data-theme="dark"]',
    };
    return ['light', 'dark']
        .map((mode) => serializeVariables(selectors[mode], (0, index_1.generateColors)(mode, (0, themes_1.resolveMainColor)(mainColorOrTheme, mode))))
        .join('\n\n')
        .concat('\n');
}
//# sourceMappingURL=css-generator.js.map