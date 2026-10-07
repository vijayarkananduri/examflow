# ExamFlow — Semester Studio

> A private, browser-first study studio that turns a messy semester into a clear next step.

**Live app:** [vijayarkananduri.github.io/examflow](https://vijayarkananduri.github.io/examflow/)

ExamFlow helps students import a syllabus, organize subjects and units, connect topics to exam dates, and follow a focused daily study plan. It keeps reading history and spaced-review progress on the device, so your semester work builds instead of resetting between exams.

ExamFlow is a browser-only study workspace for turning a full syllabus into a focused daily plan. Import syllabi, organize subjects → units → topics, plan around exams, log study sessions, and keep spaced-review history across the semester.

## What changed in the refresh

- Rebuilt the interface around a premium **ink, oat, citrus, and coral** visual system.
- Added stronger hierarchy, depth, calmer density, responsive cards, and touch-friendly controls.
- Preserved the existing local-first study planner and data model.
- Added accessible focus states, reduced-motion support, keyboard-friendly controls, and mobile navigation.
- Added GitHub Pages-ready relative asset paths, `.nojekyll`, metadata, Open Graph/Twitter tags, and an installable web manifest.
- Added `netlify.toml` so the same folder also deploys cleanly on Netlify.

## Publish on GitHub Pages

This is a static site with no build step.

1. Create or open a GitHub repository.
2. Upload the **contents of this folder** so `index.html` is at the repository root.
3. Open **Settings → Pages**.
4. Under **Build and deployment**, choose **Deploy from a branch**, select your default branch, and choose **/(root)**.
5. Save and wait for GitHub to publish the site.

The app uses hash navigation (`#dashboard`, `#syllabus`, etc.), so it works on project pages such as `https://username.github.io/repository/` without server rewrites.

## Publish on Netlify

Drag the extracted `examflow` folder into Netlify, or connect the repository. The included `netlify.toml` sets the publish directory to `.` and applies safe cache/security headers.

## Run locally

Because the app uses ES modules, serve the folder over HTTP rather than opening `index.html` directly:

```bash
python3 -m http.server 4173
```

Then open `http://localhost:4173`.

## Features

- Organizes a complete semester into subject → unit → topic structure.
- Extracts selectable text from PDFs locally in the browser.
- Optional provider API key support for syllabus parsing, timetable extraction, and practice questions.
- Creates a daily study plan based on topic status, exam proximity, review dates, time estimates, and real study pace.
- Tracks timer sessions, actual minutes, topic reads, status, streaks, revision dates, and insights.
- Builds exam timetables with subject, date, time, and covered-unit rows.
- Exports/imports a JSON backup for moving browsers or devices.
- Stores study data locally in the browser; there is no account or backend.

## Files

- `index.html` — app shell, accessibility landmarks, SEO/social metadata, and manifest link.
- `styles.css` — complete responsive visual system and component styling.
- `app.js` — local-first planner logic and interactions.
- `favicon.svg` — lightweight app icon.
- `manifest.webmanifest` — installable app metadata.
- `.nojekyll` — prevents GitHub Pages from filtering static assets.
- `netlify.toml`, `_headers`, `_redirects` — static host configuration.
- `wrangler.toml` — optional Cloudflare Pages configuration.

## Privacy note

Study data, history, settings, and any provider key are stored in `localStorage` on this device. AI requests go directly from the browser to the selected provider. Review imported syllabus and timetable data before saving it, and never use a personal API key on a shared computer.
