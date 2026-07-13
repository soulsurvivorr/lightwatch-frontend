#!/usr/bin/env node
// ============================================================
//  generate-ios-splash.js — LightWatch
//
//  WHY THIS EXISTS
//  ----------------
//  The iOS PWA white flash (item 2) is NOT something app-startup.js,
//  service-worker.js, or any in-page CSS/JS can fix. On iOS, the
//  launch screen is painted by the OS itself, before the page's own
//  HTML/CSS/JS ever runs — there is no "frame zero" hook available to
//  a web app. Android doesn't have this problem because Chrome
//  generates its splash live from manifest.json on every launch;
//  iOS Safari does NOT reliably do the same — it tries to auto-derive
//  one from the manifest, but this is flaky in practice and, worse,
//  gets CACHED at "Add to Home Screen" time. Anyone who added the
//  icon before background_color was set correctly (or just hit the
//  iOS auto-derivation being unreliable) is stuck seeing white until
//  they remove and re-add the icon — nothing server-side can push
//  that update to an already-installed icon.
//
//  The actual fix Apple documents: ship explicit
//  <link rel="apple-touch-startup-image"> tags, one per device class,
//  each matched with a `media` query. iOS reads these directly and
//  doesn't depend on the manifest-derivation path at all, so it's
//  deterministic instead of "usually works."
//
//  WHAT THIS SCRIPT DOES
//  ----------------------
//  Reads your existing logo (images/dev-logo.png) and composites it,
//  centered, onto a solid #1C1F26 background at every size in
//  DEVICE_SIZES below — matching manifest.json's background_color so
//  the splash and the cold-boot screen that follows it are visually
//  one continuous frame instead of two different colors flashing in
//  sequence. Outputs PNGs to images/splash/, and prints the exact
//  <link> tags to paste into index.html's <head>.
//
//  USAGE
//  -----
//    npm install sharp --save-dev
//    node generate-ios-splash.js [logoPath] [siteRoot]
//
//  Re-run whenever the logo changes. This only needs to live in
//  index.html — that's the only page in manifest.json's start_url,
//  so it's the only page iOS ever shows a launch screen for.
// ============================================================

const fs = require('fs');
const path = require('path');

let sharp;
try {
    sharp = require('sharp');
} catch {
    console.error('Missing dependency. Run: npm install sharp --save-dev');
    process.exit(1);
}

const logoPath = process.argv[2] || './images/dev-logo.png';
const siteRoot = process.argv[3] || '.';
const outDir = path.join(siteRoot, 'images', 'splash');

const BG_COLOR = '#1C1F26'; // must match manifest.json background_color

// Portrait CSS-pixel sizes × device pixel ratio, per Apple's documented
// splash screen matrix (covers current iPhones/iPads as of iOS 17/18;
// re-check https://developer.apple.com/design/human-interface-guidelines
// or a current splash-screen size table if new devices ship later).
const DEVICE_SIZES = [
    // [cssWidth, cssHeight, dpr, label]
    [430, 932, 3, 'iPhone 15 Pro Max / 14 Pro Max'],
    [393, 852, 3, 'iPhone 15 Pro / 15 / 14 Pro / 13 Pro'],
    [428, 926, 3, 'iPhone 14 Plus / 13 Pro Max / 12 Pro Max'],
    [390, 844, 3, 'iPhone 13 / 13 Pro / 12 / 12 Pro'],
    [375, 812, 3, 'iPhone 13 mini / 12 mini / X / XS / 11 Pro'],
    [414, 896, 3, 'iPhone 11 Pro Max / XS Max'],
    [414, 896, 2, 'iPhone 11 / XR'],
    [375, 667, 2, 'iPhone SE 2/3 gen / 8 / 7 / 6s'],
    [320, 568, 2, 'iPhone SE 1st gen / 5s'],
    [744, 1133, 2, 'iPad Mini / Air (portrait)'],
    [820, 1180, 2, 'iPad Air (10.9")'],
    [834, 1194, 2, 'iPad Pro 11"'],
    [1024, 1366, 2, 'iPad Pro 12.9"']
];

function escapeAttr(s) {
    return s.replace(/"/g, '&quot;');
}

async function run() {
    if (!fs.existsSync(logoPath)) {
        console.error(`Logo not found at ${logoPath}. Pass the path as the first argument.`);
        process.exit(1);
    }
    fs.mkdirSync(outDir, { recursive: true });

    const linkTags = [];

    for (const [cssW, cssH, dpr, label] of DEVICE_SIZES) {
        const w = cssW * dpr;
        const h = cssH * dpr;
        const fileName = `splash-${w}x${h}.png`;
        const outPath = path.join(outDir, fileName);

        // Logo mark sized to ~28% of the shorter edge, centered — matches
        // the proportions of the in-app launch overlay in auth.js so the
        // OS splash and the JS-driven splash that follows it read as the
        // same moment rather than two different sized marks.
        const markSize = Math.round(Math.min(w, h) * 0.28);
        const logoBuffer = await sharp(logoPath)
            .resize(markSize, markSize, { fit: 'contain' })
            .toBuffer();

        await sharp({
            create: {
                width: w,
                height: h,
                channels: 4,
                background: BG_COLOR
            }
        })
            .composite([{ input: logoBuffer, gravity: 'center' }])
            .png()
            .toFile(outPath);

        console.log(`Wrote ${outPath} (${label})`);

        linkTags.push(
            `<link rel="apple-touch-startup-image" href="/images/splash/${fileName}" ` +
            `media="(device-width: ${cssW}px) and (device-height: ${cssH}px) ` +
            `and (-webkit-device-pixel-ratio: ${dpr}) and (orientation: portrait)">`
        );
    }

    const snippetPath = path.join(siteRoot, 'ios-splash-link-tags.html');
    fs.writeFileSync(
        snippetPath,
        `<!-- Paste these into index.html's <head>, near the other apple-touch-icon tags. -->\n` +
        linkTags.map(t => escapeAttr(t)).join('\n') + '\n',
        'utf8'
    );

    console.log(`\nDone. ${DEVICE_SIZES.length} splash images written to ${outDir}`);
    console.log(`Link tags written to ${snippetPath} — paste them into index.html's <head>.`);
    console.log(`\nReminder: this only fixes NEW installs. Anyone who already added the icon`);
    console.log(`to their Home Screen needs to remove it and re-add it once — iOS caches the`);
    console.log(`launch config at add-time and there's no way to push an update to it remotely.`);
}

run();