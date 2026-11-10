# Changelog

## 1.5.1
- Project restructure: extension code moved to `extension/`, docs stay in the root.
- Fixed extension ID via `key` in the manifest (`ckfohpnjgmkddabiaaheleebdjjbmohn`).

## 1.5.0
- Author groups **Publics** / **Friends**: dropdown in Following/Followers dialog rows and in the post bar.
- **Hide publics** option removes posts by Publics authors from the feed.

## 1.4.0
- Removed blank space left by Instagram's virtualized feed for hidden posts.
- Auto-load: the feed keeps loading while fewer than two visible posts remain below the screen.
- Backfill of image names for posts hidden before 1.3.0 via Instagram's media info API.

## 1.3.0
- Images of hidden posts are no longer downloaded (declarativeNetRequest rules, `background.js`).

## 1.2.1
- Fixed feed stalling when hidden posts made the page too short to scroll.
- "Suggested for you" filter no longer hides the whole right sidebar.

## 1.2.0
- Hidden posts collapse to a strip with Expand / Collapse / Unhide.
- Option **Show hidden posts (collapsed)**; English UI.

## 1.1.0
- Hide individual posts, exact post and comment dates, play videos once.

## 1.0.0
- Following-only feed, suggested and sponsored posts hidden, on/off toggle.
