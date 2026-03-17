# ChillSplit (Prototype)

Static, no-build prototype of a friendly cost-splitting app concept.

## Run

From this folder:

```bash
python3 -m http.server 5173
```

Then open `http://localhost:5173` in a browser.

## iPhone (PWA)

1. Open the GitHub Pages URL in Safari.
2. Tap Share.
3. Tap **Add to Home Screen**.

Everything is stored on-device via `localStorage`, so closing the app should not wipe your data.

## Groups (Multi-Phone Sync)

Use the top-right ☰ Menu:

- **Groups**: create a group, join with a code, share an invite link (`...?join=CODE`), and (host-only) remove duplicate members.
- **Settings**: theme + chill toggles.

## Notes

- Everything is stored locally in your browser via `localStorage`.
- Receipt OCR is optional and loads Tesseract.js from a CDN only if you click **Scan total**.
