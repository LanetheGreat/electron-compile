var path = require('path');
var electronCompile = require('@lanethegreat/electron-compile');

var packageJson = require('./package.json');
let initScript = path.resolve(__dirname, packageJson.originalMain);
electronCompile.init(__dirname, initScript);
