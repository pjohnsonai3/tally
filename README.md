# Tally

Project + resource scheduling for architecture firms. Timesheets, phase planning, and a Gantt timeline.

Single self-contained `index.html` — no build step, no server. Data lives in Supabase.

## Hosting on GitHub Pages

1. Create a new repo (e.g. `tally`).
2. Upload the contents of this folder to the repo root.
3. Settings → Pages → Source: **Deploy from a branch** → `main` / `(root)` → Save.
4. Live in ~1 minute at `https://<user>.github.io/tally/`.

## Updating

Replace `index.html` with a newly exported build and commit. Pages redeploys automatically.
Hard-refresh (Cmd-Shift-R) if you still see the old version.

## Before sharing the link

- **Supabase keys are visible in the file.** That's expected for the publishable/anon key,
  but it means Row Level Security must be enabled on `claire_state` — otherwise anyone
  with the URL can read and write the whole table.
- **No login gate yet.** Anyone with the link can edit. Add Supabase email/magic-link auth
  if the data shouldn't be open.
