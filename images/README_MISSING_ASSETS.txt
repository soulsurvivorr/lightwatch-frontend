The original site's image assets (dev-logo.png, areas.png, light-on.png,
light-off.png, fb_prompt_code_img.png, etc.) were never part of the
uploaded files for this migration, so they aren't included here.

Copy your existing /images and /icons folders from the old site into
these two folders (same filenames — no renaming needed, all paths in
index.html/CSS already point at images/... and icons/... relative to
this project root). Also carry over manifest.json and service-worker.js
from the old site root, referenced by index.html and
js/components/analytics.js respectively.

Delete this file once the real assets are in place.
