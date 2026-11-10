# Ig Optimizer

Chrome extension (Manifest V3) that turns the Instagram web feed into a quiet, friends-first feed.

> Vibe-coded project: built iteratively with Claude. See [CLAUDE.md](CLAUDE.md) for the AI working guide.

## Features

| Feature | What it does | Popup toggle |
|---|---|---|
| Following only | Opens the home feed as `/?variant=following` and hides "Suggested for you" / sponsored posts | Following only |
| Exact dates | Shows the full date and time of every post (decoded from the post shortcode) and comment | Exact dates |
| Play videos once | Stops Instagram from looping videos; a manual click still replays | Play videos once |
| Author groups | Assign an author to **Publics** or **Friends** from the Following/Followers list or from the post bar | — |
| Hide publics | Removes all posts by authors in the Publics group from the feed | Hide publics |
| Hide posts | **Hide** button on each post; hidden posts collapse to a strip with **Expand** / **Unhide** | Show hidden posts (collapsed) |
| No image download for hidden posts | Images of hidden posts are blocked at the network level | — |
| Auto-load | Keeps loading the feed while fewer than two visible posts are left below the screen | — |

## Install (unpacked)

1. Open `chrome://extensions` and turn on **Developer mode**.
2. Click **Load unpacked** and select the `extension` folder.
3. After code changes, click **Reload** on the extension card and refresh the Instagram tab.

## Files

```
extension/          Everything Chrome loads (zip this folder for the Web Store)
  manifest.json     MV3 manifest
  content.js        All page logic (runs on instagram.com at document_start)
  content.css       Hiding / collapsing / date / bar styles
  background.js     Service worker: declarativeNetRequest rules that block hidden posts' images
  popup.html/js     Settings popup
  icon*.png         Icons
README.md           This file
CLAUDE.md           AI working guide
CHANGELOG.md        Version history
```

## Data

Stored only in the local Chrome profile, nothing is sent anywhere except Instagram's own API (see CLAUDE.md).
