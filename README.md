# ChillSplit (Prototype)

Static, no-build prototype of a friendly cost-splitting app concept.

## Run

From this folder:

```bash
python3 -m http.server 5173
```

Then open `http://localhost:5173` in a browser.

## Notes

- Everything is stored locally in your browser via `localStorage`.
- Receipt OCR is optional and loads Tesseract.js from a CDN only if you click **Scan total**.

