"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.applyThemeColors = applyThemeColors;
function applyThemeColors(mode, colors, target = document.documentElement) {
    target.setAttribute('data-theme', mode);
    Object.entries(colors).forEach(([key, value]) => {
        target.style.setProperty(key, value);
    });
}
//# sourceMappingURL=apply-theme.js.map