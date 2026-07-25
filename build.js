const fs = require('fs');
const path = require('path');

const files = [
  'constants.js',
  'math.js',
  'game-state.js',
  'shaders.js',
  'whisper.js',
  'sprites.js',
  'world.js',
  'storage.js',
  'actions.js',
  'input.js',
  'game.js',
  'main.js'
];

let bundleContent = '(function(){\n"use strict";\n';

for (const file of files) {
  const filePath = path.join(__dirname, 'js', file);
  let code = fs.readFileSync(filePath, 'utf8');
  
  // Strip import statements
  code = code.replace(/^\s*import\s+[\s\S]*?;/gm, '');
  
  // Strip export keywords
  code = code.replace(/^\s*export\s+function\s+/gm, 'function ');
  code = code.replace(/^\s*export\s+const\s+/gm, 'const ');
  code = code.replace(/^\s*export\s+let\s+/gm, 'let ');
  code = code.replace(/^\s*export\s+var\s+/gm, 'var ');
  code = code.replace(/^\s*export\s+\{[\s\S]*?\};/gm, '');
  
  bundleContent += `\n/* --- ${file} --- */\n` + code + '\n';
}

bundleContent += '\n})();\n';

fs.writeFileSync(path.join(__dirname, 'js', 'bundle.js'), bundleContent, 'utf8');
console.log('Successfully bundled into js/bundle.js');
