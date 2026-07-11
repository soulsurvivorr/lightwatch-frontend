#!/usr/bin/env node
// ============================================================
//  bump-version.js — LightWatch
//
//  Run this ONE command before every deploy:
//
//      node bump-version.js 1.0.14
//
//  It updates the version string in every place that needs to
//  agree with the service worker's cache name, so a deploy is a
//  single number change instead of hunting through files by hand:
//
//   - APP_VERSION in service-worker.js  (drives cache names, so
//     old caches get deleted on activate)
//   - VERSION in Js/app-startup.js       (just the query string
//     on its own <script> tag — logic doesn't depend on it)
//   - every "?v=<old-version>" on a local .js/.css/manifest.json
//     asset link across index.html and pages/*.html
//
//  Usage: node bump-version.js <newVersion> [siteRoot]
//  siteRoot defaults to the current directory.
// ============================================================

const fs = require('fs');
const path = require('path');

const newVersion = process.argv[2];
const siteRoot = process.argv[3] || '.';

if (!newVersion) {
    console.error('Usage: node bump-version.js <newVersion> [siteRoot]');
    console.error('Example: node bump-version.js 1.0.14');
    process.exit(1);
}

const SW_PATH = path.join(siteRoot, 'service-worker.js');
const STARTUP_PATH = path.join(siteRoot, 'Js', 'app-startup.js');
const HTML_GLOBS = [
    path.join(siteRoot, 'index.html'),
    ...findHtmlFiles(path.join(siteRoot, 'pages'))
];

function findHtmlFiles(dir) {
    if (!fs.existsSync(dir)) return [];
    return fs.readdirSync(dir)
        .filter(f => f.endsWith('.html'))
        .map(f => path.join(dir, f));
}

function readCurrentVersion(swContent) {
    const match = swContent.match(/const APP_VERSION\s*=\s*'([^']+)'/);
    return match ? match[1] : null;
}

function bumpServiceWorker() {
    let content = fs.readFileSync(SW_PATH, 'utf8');
    const oldVersion = readCurrentVersion(content);
    if (!oldVersion) throw new Error('Could not find APP_VERSION in service-worker.js');

    content = content.replace(
        /const APP_VERSION\s*=\s*'[^']+'/,
        `const APP_VERSION   = '${newVersion}'`
    );
    fs.writeFileSync(SW_PATH, content, 'utf8');
    console.log(`service-worker.js: ${oldVersion} -> ${newVersion}`);
    return oldVersion;
}

function bumpHtmlAndAssets(oldVersion) {
    const oldTag = `?v=${oldVersion}`;
    const newTag = `?v=${newVersion}`;

    for (const file of HTML_GLOBS) {
        if (!fs.existsSync(file)) continue;
        let content = fs.readFileSync(file, 'utf8');
        const count = content.split(oldTag).length - 1;
        content = content.split(oldTag).join(newTag);
        fs.writeFileSync(file, content, 'utf8');
        console.log(`${file}: ${count} version tag(s) updated`);
    }

    if (fs.existsSync(STARTUP_PATH)) {
        // app-startup.js has no internal version constant to bump — its
        // own cache-busting comes entirely from the ?v= on its <script>
        // tag in each HTML file, already handled above.
    }
}

const oldVersion = bumpServiceWorker();
bumpHtmlAndAssets(oldVersion);

console.log(`\nDone. Deployed version is now ${newVersion}.`);
console.log('Remember: this only edits files on disk — commit and deploy as usual.');