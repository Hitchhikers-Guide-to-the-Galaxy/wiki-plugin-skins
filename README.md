# wiki-plugin-skins

> The page is the truth; the skin is a lens.

The Skin Switcher for federated wiki. Every skin reads the same lineup of page-json and draws it its own way.

- `client/skin-kit.js` — the Skin Contract in code: **Read** (`onLineup`, `fetchPage`), **Render** (`renderPage`, `renderItem`, `markdown`), **Return** (`returnAction`, journaled edits only), plus `mountSwitcher` and `wear`.
- `client/skin-switcher.js` — puts the "Skin" dropdown in the classic footer. Load it from the farm's client layer.
- `client/wear.html` — hosts a guest skin in a sandboxed iframe; the guest reads through the host and must ask before writing.
- `skins` item — buttons for every installed skin.

## Making a skin

A skin is a plugin named `wiki-plugin-skin-<id>` whose `client/` folder holds `skin.html` and `skin.json`:

```json
{ "id": "triptych", "label": "Triptych", "entry": "skin.html", "trust": "guest", "about": "Three pages side by side." }
```

`skin.html` loads `/plugins/skins/skin-kit.js` and calls `SkinKit.onLineup(draw)`. The lineup travels in the URL hash (`#/view/a/site.org/b`), so switching skins keeps your pages. See `wiki-plugin-skin-triptych` and http://skin.fedwiki.club/view/skin-switcher.
