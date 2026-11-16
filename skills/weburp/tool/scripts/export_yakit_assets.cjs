// 将固定版本配色转换为静态 CSS；浏览器运行时不访问 CDN。
const fs = require('node:fs');
const path = require('node:path');
const root = path.join(__dirname, '../assets/yakit');
const {getColors} = require(path.join(root, 'color/dist/preview.js'));
const css = ['light', 'dark'].map(theme => {
  const values = Object.entries(getColors(theme)).map(([key,value]) => '  ' + key + ': ' + value + ';').join('\n');
  return ':root[data-theme="' + theme + '"] {\n' + values + '\n}';
}).join('\n');
fs.writeFileSync(path.join(root, 'theme.css'), '/* @yakit-libs/color 1.4.1; MIT */\n' + css + '\n');
console.log('已生成原版浅色/深色主题');
const vm = require('node:vm');
const definitions = {};
const escape = value => String(value).replace(/&/g,'&amp;').replace(/"/g,'&quot;').replace(/</g,'&lt;');
const t = {createElement(tag, attrs, ...children) {
  if (typeof tag === 'function') return tag(attrs || {});
  const attributes = Object.entries(attrs || {}).filter(([k,v]) => v != null && !['children','style','key','ref'].includes(k))
    .map(([k,v]) => ' ' + (k === 'className' ? 'class' : ['viewBox','preserveAspectRatio','gradientUnits','clipPathUnits'].includes(k) ? k : k.replace(/[A-Z]/g, m => '-' + m.toLowerCase())) + '="' + escape(v) + '"').join('');
  return '<' + tag + attributes + '>' + children.flat(Infinity).filter(v => v != null).join('') + '</' + tag + '>';
}};
let source = fs.readFileSync(path.join(root,'icons-source/dist/index-CS16Uqfu.js'),'utf8');
source = source.replace(/^import .*;\r?$/gm,'').replace(/export \{[\s\S]*$/,'');
vm.runInNewContext(source,{o(svg,name){definitions[name] = svg; return svg;}, t, c:()=>'weburp-icon'},{timeout:5000});
const names = ['ClockOutlined','ChevronDownOutlined','ChevronLeftOutlined','ChevronRightOutlined','CogOutlined','CodeOutlined','TerminalOutlined','SearchOutlined','RefreshOutlined','PlusOutlined','XOutlined','DocumentDuplicateOutlined','ArrowsExpandOutlined','SwitchHorizontalOutlined','QuestionMarkCircleOutlined','HomeOutlined','SunOutlined','MoonOutlined','DownloadOutlined','UploadOutlined','DotsHorizontalOutlined','ViewGridOutlined','MenuOutlined','LinkOutlined','FolderOutlined'];
const icons = {};
for(const name of names) {
  if (!definitions[name]) continue;
  icons[name] = definitions[name]({width:16,height:16,'aria-hidden':'true',focusable:'false'});
}
for (const name of ['ClockOutlined','ChevronDownOutlined','CogOutlined','CodeOutlined','TerminalOutlined']) {
  if (!icons[name]) throw new Error('缺少原版图标：'+name);
}
fs.writeFileSync(path.join(root,'icons.js'),'/* @yakit-libs/yakit-ui-icons 0.2.9; MIT */\nwindow.YakitIcons = ' + JSON.stringify(icons) + ';\n');
console.log('已导出原版 SVG 图标：'+Object.keys(icons).join(', '));
