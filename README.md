# Overdub — Installable MIDI Looper

This is a Progressive Web App (PWA). To get a real "Install" button on your
laptop and Android phone, it needs to be served over HTTPS (or localhost) —
a browser will not offer to install a page opened directly from a folder
(a `file://` link).

## Easiest option: GitHub Pages (free, ~5 minutes)

1. Create a free GitHub account if you don't have one: https://github.com/signup
2. Create a new repository (e.g. `overdub-app`), and set it to **Public**.
3. Upload all the files in this folder (`index.html`, `app.js`, `manifest.json`,
   `sw.js`, and the `icons` folder) to that repository — you can drag-and-drop
   them in the GitHub web UI ("Add file" → "Upload files").
4. Go to the repo's **Settings → Pages**, set the source branch to `main`
   (root folder), and save.
5. GitHub gives you a URL like `https://yourname.github.io/overdub-app/`.
   Open that link.

## Installing

**On your laptop (Chrome or Edge):**
- Open the GitHub Pages link.
- Click the install icon in the address bar (or menu → "Install Overdub…").
- It now opens as its own app window, no browser bar.

**On Android (Chrome):**
- Open the same link on your phone.
- Tap the ⋮ menu → "Add to Home screen" / "Install app".
- It appears as a normal app icon.

## Using it with the PSR-E363

- **Laptop:** connect the keyboard's USB port to the laptop. The app
  detects it automatically via Web MIDI (Chrome/Edge only — not Safari
  or Firefox).
- **Android:** you'll need a USB-OTG adapter/cable so the phone can see
  the keyboard as a MIDI device, then the same browser permission prompt
  applies.

## Alternative: test locally first (no GitHub needed)

From a terminal, inside this folder:

```
python3 -m http.server 8000
```

Then open `http://localhost:8000` in Chrome on the same laptop — install
works on localhost too. (Android won't be able to install over your LAN
without HTTPS, so GitHub Pages is the way to get it on your phone.)
