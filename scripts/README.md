# The Big Box feed bridge

`big-box-feed.gs` runs in Apps Script and moves scanned documents from the
folders you scan into, into the GTD app's Big Box.

## Why a script

The app holds Drive's `drive.file` scope: it can only see files it created
itself. It cannot look inside the folder the Drive scanner saves to, and the
scope that could — `drive.readonly` — can read every file in the account and
needs Google's verification. Re-uploading each scan through the app's own
credentials makes the document app-created, so the narrow scope keeps working
and you keep the Drive scanner's crop, rotate and deshadow, which is the thing
that makes a photographed letter readable.

The script carries no API key and makes no decisions. Naming, summarising,
dating and tagging happen in the app, where the tag vocabulary lives and can be
edited.

## Setting it up

1. In the app, open **Big Box** and set it up. Create any extra boxes you want
   and give each one its categories and tags.
2. Put a long random string in the app's environment as `BOX_INGEST_SECRET`
   (Vercel → Settings → Environment Variables), and redeploy.
   ```
   node -e "console.log(require('crypto').randomBytes(32).toString('base64url'))"
   ```
3. Create a standalone Apps Script project at <https://script.google.com> and
   paste in `big-box-feed.gs`.
4. Project Settings → Script Properties, add:
   - `APP_ORIGIN` — e.g. `https://gtd-web-ten.vercel.app`, no trailing slash
   - `BOX_INGEST_SECRET` — the same value as the app's
5. Edit `FOLDERS` at the top of the script: one entry per scan folder, with the
   name of the box it feeds. The folder id is the last part of its Drive URL.
6. Run `testConnection` once. A `400 No filename` is the *good* answer — it
   means the request was authenticated and understood, and only the payload was
   deliberately empty. A `401` means the secret doesn't match.
7. Run `processFeedFolders` by hand and check the log, then Triggers → add a
   time-driven trigger on `processFeedFolders`, hourly.

## What happens to the original

`AFTER_INGEST` at the top of the script:

- `'move'` (default) puts it in a `Filed` subfolder of the scan folder. Nothing
  is ever deleted, at the cost of two copies in Drive.
- `'trash'` sends it to Drive's bin, which holds it for 30 days.

Start on `move`. Switch once you've watched it work for a week.

## Replacing the old script

The previous `processFeedFolders` set a Drive description and renamed the file
in place. If it is still on a trigger, **turn that trigger off** — otherwise
both scripts will process the same folder and the old one will rename files out
from under this one. Documents already processed by the old script are still
ordinary files and will be ingested normally, description and all; the app
re-reads them and stores its own summary and tags.
