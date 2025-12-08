#!/usr/bin/env node
// Copies lua/CodeBridge.lua into a destination path (file) in a consumer repo.
// Usage: node tools/copy-lua-client.js ../my-game/src/ReplicatedStorage/CodeBridge/CodeBridge.lua

const fs = require('fs');
const path = require('path');

const src = path.resolve(__dirname, '..', 'lua', 'CodeBridge.lua');
const dest = process.argv[2];

if (!dest) {
  console.error('Usage: node tools/copy-lua-client.js <dest-path>');
  process.exit(1);
}

if (!fs.existsSync(src)) {
  console.error('Source client not found at', src);
  process.exit(1);
}

const destDir = path.dirname(dest);
fs.mkdirSync(destDir, { recursive: true });
fs.copyFileSync(src, dest);
console.log(`Copied Lua client to ${dest}`);
