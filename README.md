# Playwright Contact Extractor

Prep for Lattitude UX testing using Playwright's browser automation testing.

This workspace includes a small extractor that visits websites and pulls Facebook, Instagram, and email addresses.

How to run

1. Populate `data/sites.json` with an array of site URLs (example file included).
2. Run the extractor directly (this executes the TypeScript script with tsx):

```bash
npx playwright test
```

Outputs will be appended to `output/contacts.csv` and `output/contacts.ndjson` (you can convert or rename as needed).


