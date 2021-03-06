const fs = require('fs-extra');
const fsu = require('fsu');
const path = require('path');
const React = require('react');
const opener = require('opener');
const dateFormat = require('dateformat');
const render = require('react-dom/server').renderToStaticMarkup;
const MainHTML = require('./main-html');
const pkg = require('../package.json');
const { getMergedOptions } = require('./options');

const distDir = path.join(__dirname, '..', 'dist');
const fileExtRegex = /\.[^.]*?$/;

/**
 * Saves a file
 *
 * @param {string} filename Name of file to save
 * @param {string} data Data to be saved
 * @param {boolean} overwrite Overwrite existing files (default: true)
 *
 * @return {Promise} Resolves with filename if successfully saved
 */
function saveFile(filename, data, overwrite) {
  if (overwrite) {
    return fs.outputFile(filename, data)
      .then(() => filename);
  } else {
    return new Promise((resolve, reject) => {
      fsu.writeFileUnique(
        filename.replace(fileExtRegex, '{_###}$&'),
        data,
        { force: true },
        (err, savedFile) => err === null ? resolve(savedFile) : reject(err)
      );
    });
  }
}

/**
 * Opens a file
 *
 * @param {string} filename Name of file to open
 *
 * @return {Promise} Resolves with filename if successfully opened
 */
function openFile(filename) {
  return new Promise((resolve, reject) => {
    opener(filename, null, err => err === null ? resolve(filename) : reject(err));
  });
}

/**
 * Synchronously loads a file with utf8 encoding
 *
 * @param {string} filename Name of file to load
 *
 * @return {string} File data as string
 */
function loadFile(filename) {
  return fs.readFileSync(filename, 'utf8');
}

/**
 * Get the dateformat format string based on the timestamp option
 *
 * @param {string|boolean} timestamp Timestamp option value
 *
 * @return {string} Valid dateformat format string
 */
function getTimestampFormat(timestamp) {
  switch (timestamp) {
  case '':
  case 'true':
  case true:
    return 'isoDateTime';
  default:
    return timestamp;
  }
}

/**
 * Construct the path/name of the HTML/JSON file to be saved
 *
 * @param {Object} reportOptions Options object
 * @param {string} reportOptions.reportDir Directory to save report to
 * @param {string} reportOptions.reportFilename Filename to save report to
 * @param {string} reportOptions.timestamp Timestamp format to be appended to the filename
 *
 * @return {string} Fully resolved path without extension
 */
function getFilename({ reportDir, reportFilename = 'mochawesome', timestamp }) {
  let ts = '';
  if (timestamp !== false && timestamp !== 'false') {
    const format = getTimestampFormat(timestamp);
    ts = `_${dateFormat(new Date(), format)}`
      // replace commas, spaces or comma-space combinations with underscores
      .replace(/(,\s*)|,|\s+/g, '_')
      // replace forward and back slashes with hyphens
      .replace(/\\|\//g, '-')
      // remove colons
      .replace(/:/g, '');
  }
  const filename = `${reportFilename.replace(fileExtRegex, '')}${ts}`;
  return path.resolve(process.cwd(), reportDir, filename);
}

/**
 * Get report options by extending base options
 * with user provided options
 *
 * @param {Object} opts Report options
 *
 * @return {Object} User options merged with default options
 */
function getOptions(opts) {
  const mergedOptions = getMergedOptions(opts || {});

  // For saving JSON from mochawesome reporter
  if (mergedOptions.saveJson) {
    mergedOptions.jsonFile = `${getFilename(mergedOptions)}.json`;
  }

  mergedOptions.htmlFile = `${getFilename(mergedOptions)}.html`;
  return mergedOptions;
}

/**
 * Get the report assets for inline use
 *
 * @return {Object} Object with styles and scripts as strings
 */
function getAssets() {
  return {
    styles: loadFile(path.join(distDir, 'app.inline.css')),
    scripts: loadFile(path.join(distDir, 'app.js'))
  };
}

/**
 * Determine if assets should be copied following below logic:
 * - Assets folder does not exist -> copy assets
 * - Assets folder exists -> load the css asset to inspect the banner
 * - Error loading css file -> copy assets
 * - Read the package version from the css asset
 * - Asset version is not found -> copy assets
 * - Asset version differs from current version -> copy assets
 *
 * @param {string} assetsDir Directory where assets should be saved
 *
 * @return {boolean} Should assets be copied
 */
function _shouldCopyAssets(assetsDir) {
  if (!fs.existsSync(assetsDir)) {
    return true;
  }

  try {
    const appCss = loadFile(path.join(assetsDir, 'app.css'));
    const appCssVersion = /\d+\.\d+\.\d+/.exec(appCss);
    if (!appCssVersion || appCssVersion[0] !== pkg.version) {
      return true;
    }
  } catch (e) {
    return true;
  }

  return false;
}

/**
 * Copy the report assets to the report dir, ignoring inline assets
 *
 * @param {Object} opts Report options
 */
function copyAssets({ assetsDir }) {
  if (_shouldCopyAssets(assetsDir)) {
    fs.copySync(distDir, assetsDir, {
      filter: src => !/inline/.test(src)
    });
  }
}

/**
 * Renders the main report React component
 *
 * @param {Object} data JSON test data
 * @param {Object} reportOptions Report options
 * @param {string} styles Inline stylesheet
 * @param {string} scripts Inline script
 *
 * @return {string} Rendered HTML string
 */
function renderHtml(data, reportOptions, styles, scripts) {
  const { reportDir, assetsDir } = reportOptions;
  const relativeAssetsDir = path.relative(reportDir, assetsDir);
  return render(React.createElement(MainHTML, {
    assetsDir: relativeAssetsDir,
    data,
    options: reportOptions,
    styles,
    scripts
  }));
}


/**
 * Prepare options, assets, and html for saving
 *
 * @param {string} reportData JSON test data
 * @param {Object} opts Report options
 *
 * @return {Object} Prepared data for saving
 */
function prepare(reportData, opts) {
  // Stringify the data if needed
  let data = reportData;
  if (typeof data === 'object') {
    data = JSON.stringify(reportData);
  }

  // Get the options
  const reportOptions = getOptions(opts);

  let assets = {};
  // If options.inlineAssets is true, get the
  // styles and scripts as strings
  if (!reportOptions.dev) {
    if (reportOptions.inlineAssets) {
      assets = getAssets(reportOptions);
    } else {
    // Otherwise copy the files to the assets dir
      copyAssets(reportOptions);
    }
  }

  // Render basic template to string
  const { styles, scripts } = assets;
  const html = `<!doctype html>\n${renderHtml(data, reportOptions, styles, scripts)}`;
  return { html, reportOptions };
}

/**
 * Create the report
 *
 * @param {string} data JSON test data
 * @param {Object} opts Report options
 *
 * @return {Promise} Resolves if report was created successfully
 */
function create(data, opts) {
  const { html, reportOptions } = prepare(data, opts);
  const {
    saveJson,
    saveHtml,
    autoOpen,
    overwrite,
    jsonFile,
    htmlFile
  } = reportOptions;

  const savePromises = [];

  savePromises.push(saveHtml !== false
    ? saveFile(htmlFile, html, overwrite)
      .then(savedHtml => (autoOpen && openFile(savedHtml)) || savedHtml)
    : null);

  savePromises.push(saveJson
    ? saveFile(jsonFile, JSON.stringify(data, null, 2), overwrite)
    : null);

  return Promise.all(savePromises);
}

/**
 * Create the report synchronously
 *
 * @param {string} data JSON test data
 * @param {Object} opts Report options
 *
 */
function createSync(data, opts) {
  const { html, reportOptions } = prepare(data, opts);
  const { autoOpen, htmlFile } = reportOptions;
  fs.outputFileSync(htmlFile, html);
  if (autoOpen) opener(htmlFile);
}

/**
 * Expose functions
 *
 */
module.exports = { create, createSync };
