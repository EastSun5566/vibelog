# Getting Started

VibeLog 0.5 is an invite-only hosted editor. You need a public HackMD profile with at least one published note.

## Writer flow

1. Register with the shared beta code, a permanent username, and a password.
2. Enter your public HackMD username.
3. Wait for the first Astro draft and open the live preview.
4. Describe a visual direction, such as “a quiet editorial journal with warm paper colors.”
5. Switch between any saved theme revisions.
6. Publish to `<username>.<APP_ORIGIN hostname>`.

Only notes that HackMD exposes as public and published are imported. Duplicate slugs, invalid dates, and an empty public profile stop the sync without replacing the last working draft.

## Theme safety

The AI receives the blog title, description, author, current theme, and your design request. It does not receive article bodies. It returns one `propose_theme` tool call containing:

- one of three presets: minimal, editorial, or notebook
- light or dark appearance
- six semantic colors
- allowlisted system font stacks
- fixed typography, width, density, and radius scales

VibeLog rejects unknown fields, remote fonts, arbitrary CSS, unsafe values, and colors that fail WCAG text/link contrast. A failed proposal never changes the active revision.

There is no password recovery in the self-contained beta. Keep your password safe; signed-in users can change it from the editor.
