# DeskCue — Task Planner

A static, mobile-friendly task website for the DeskCue Box project. It uses GitHub Pages for hosting and Supabase Authentication + the `public.task_lists` table for storage. No build tools or terminal commands are needed.

## 1) Configure Supabase

1. Open your Supabase project.
2. Find **Project URL** and **Publishable key** in Project Settings → API Keys (or the project's Connect dialog).
3. Open `config.js` and replace:
   - `PASTE_YOUR_SUPABASE_PROJECT_URL_HERE`
   - `PASTE_YOUR_SUPABASE_PUBLISHABLE_KEY_HERE`
4. Save the file.

Use the publishable key (`sb_publishable_...`) or legacy `anon` key only. **Never put a `secret` or `service_role` key in this website.** Browser-exposed keys are normal for Supabase client apps; the row-level security (RLS) policies protect the data.

The SQL table expected by this app is the `public.task_lists` table created earlier, with columns `user_id` (UUID), `tasks` (JSONB) and `updated_at` (timestamp), plus RLS policies allowing authenticated users to access only their own row.

## 2) Create your account

- Either use **Authentication → Users → Add user** in Supabase to create your login, or use **Create an account** on the website.
- If email confirmation is enabled, confirm the signup email before signing in.
- If using email confirmations, add your GitHub Pages URL to Authentication → URL Configuration → Redirect URLs after publishing. Use the exact deployed URL, for example `https://YOUR-USERNAME.github.io/YOUR-REPOSITORY/`.

## 3) Publish with GitHub Pages

1. Download and extract `deskcue-web.zip` on your computer.
2. Sign in to GitHub and create a new repository, e.g. `deskcue-web`. For the simplest free GitHub Pages setup, make the repository **Public**.
3. Open the new repository → **Add file → Upload files**. Upload the files inside the extracted folder (`index.html`, `styles.css`, `config.js`, `app.js`, and this `README.md`) to the repository's top/root level, not inside another nested folder. Commit the upload.
4. Open repository **Settings → Pages**.
5. Under **Build and deployment**, choose **Deploy from a branch**, select branch `main` and folder `/(root)`, then click **Save**.
6. Wait for the Pages deployment to finish; GitHub will display your website URL on the Pages settings page.
7. In Supabase → Authentication → URL Configuration, set the Site URL to that deployed URL and add the same URL under Redirect URLs if needed.

Official guide: https://docs.github.com/en/pages/getting-started-with-github-pages/creating-a-github-pages-site

## 4) What the website saves

Each signed-in account gets one row in `task_lists`, and `tasks` is a JSON array. Every task uses these fields to remain compatible with the DeskCue ESP32 firmware model:

```json
{
  "id": 1,
  "title": "Study Physics",
  "daily": true,
  "startMinute": 1080,
  "startEpoch": 0,
  "durationMinutes": 30,
  "untilNext": false,
  "enabled": true
}
```

- `startMinute` = minutes after midnight for a daily task.
- `startEpoch` = Unix timestamp in seconds for a one-time task.
- `untilNext` = let the next scheduled task determine the end time.
- `enabled` = whether the reminder is active.

## Important: ESP32 cloud sync is the next step

This first version connects the website to Supabase. The ESP32 has **not** been connected to the cloud in this package yet. Because this table is restricted to an authenticated user's row, we should next add a safe device-sync method rather than placing any secret/service-role key in the ESP32 firmware. The device should store synced tasks locally so reminders continue when Wi-Fi is unavailable.

## Troubleshooting

- **Setup notice stays visible:** verify that both values in `config.js` were replaced and the changed file was committed to GitHub.
- **Invalid API key:** use the project's publishable key or legacy anon key, not a secret/service-role key.
- **Permission / RLS error:** verify you are signed in, the SQL ran successfully, and `task_lists` is exposed through the Supabase Data API.
- **Signup tells you to check email:** this is expected when email confirmation is enabled.
