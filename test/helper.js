// Setup Enzyme Adapter
const enzyme = require('enzyme');
const Adapter = require('enzyme-adapter-react-16');

enzyme.configure({ adapter: new Adapter() });

// Setup path lookups
const path = require('path');
require('app-module-path').addPath(__dirname);
require('app-module-path').addPath(path.join(__dirname, '..', 'src'));

// CSS Modules Runtime
const cssHook = require('css-modules-require-hook');

cssHook({
  generateScopedName: '[name]-[local]'
});

// Setup browser environment
const exposedProperties = [ 'window', 'navigator', 'document' ];

global.document = require('jsdom').jsdom('<body></body>');

global.window = document.defaultView;
Object.keys(document.defaultView).forEach(property => {
  if (typeof global[property] === 'undefined') {
    exposedProperties.push(property);
    global[property] = document.defaultView[property];
  }
});
global.navigator = { userAgent: 'node.js' };
