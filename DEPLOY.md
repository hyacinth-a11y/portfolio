# Deploying Project Portfolio — step by step

No coding needed. You'll click through three free websites: **Supabase** (database + login), **GitHub** (stores the code), **Vercel** (hosts the site). Plan on about 20–30 minutes.

> Button names on these sites change from time to time. If something isn't exactly where described, look for the closest match.

---

## Part 1 — Set up the database (Supabase)

**Step 1. Create a Supabase account and project**
1. Go to **https://supabase.com** → **Start your project** → sign up (signing in with GitHub is easiest).
2. Click **New project**.
3. Fill in:
   - **Name:** `portfolio-board`
   - **Database password:** click *Generate a password* and save it somewhere safe (you won't need it day-to-day).
   - **Region:** pick the one closest to you (e.g. *Southeast Asia (Singapore)*).
4. Click **Create new project** and wait ~2 minutes until the dashboard finishes loading.

**Step 2. Create the tables**
1. In the left sidebar, click **SQL Editor** (the `>_` icon).
2. Click **+ New query**.
3. Open the file `supabase/schema.sql` from this project, copy **everything**, and paste it into the editor.
4. Click **Run** (bottom right). You should see **"Success. No rows returned."**

**Step 3. Turn off email confirmation (so you can log in right away)**
1. Left sidebar → **Authentication** → **Sign In / Providers** (on some versions: *Providers → Email*).
2. Find **Confirm email** and switch it **OFF** → **Save**.
3. Leave **Allow new users to sign up** **ON** for now — you'll turn it off in Step 9.

**Step 4. Copy your two keys**
1. Left sidebar → **Project Settings** (gear icon) → **Data API** / **API Keys**.
2. Copy these into a notepad:
   - **Project URL** — looks like `https://abcdxyz.supabase.co`
   - **anon public key** (a long string starting with `eyJ…`) — newer projects may show a **Publishable key** starting with `sb_publishable_…` instead; either works.
   
   ⚠️ Do **not** use the `service_role` / secret key.

---

## Part 2 — Put the code on GitHub

**Step 5. Upload the project**
1. Go to **https://github.com** and sign up / sign in.
2. Click **+** (top right) → **New repository**.
   - **Name:** `portfolio-board`
   - Choose **Private**
   - Click **Create repository**.
3. On the empty repo page, click the link **uploading an existing file**.
4. Unzip `portfolio-board.zip` on your computer. Open the unzipped `portfolio-board` folder, select **everything inside it** (`src`, `supabase`, `index.html`, `package.json`, etc.) and drag it into the GitHub upload box.
   - Tip: on Mac, press `Cmd+Shift+.` in Finder to also show hidden files like `.gitignore` — nice to include but not required.
5. Click **Commit changes**.

Check: the repo's main page should list `package.json` and `index.html` at the top level (not inside another folder).

---

## Part 3 — Put the site online (Vercel)

**Step 6. Deploy**
1. Go to **https://vercel.com** → **Sign Up** → **Continue with GitHub**.
2. Click **Add New… → Project**.
3. Find `portfolio-board` in the list and click **Import** (if it's missing, click *Adjust GitHub App Permissions* and give Vercel access to that repo).
4. **Framework Preset** should say **Vite** automatically. Leave build settings as they are.
5. Open **Environment Variables** and add two:

   | Key | Value |
   |---|---|
   | `VITE_SUPABASE_URL` | your Project URL from Step 4 |
   | `VITE_SUPABASE_ANON_KEY` | your anon / publishable key from Step 4 |

6. Click **Deploy** and wait ~1 minute. 🎉 Click the preview to open your site. Your address will look like `https://portfolio-board-xxxx.vercel.app`.

**Step 7. Tell Supabase your site address**
1. Supabase → **Authentication** → **URL Configuration**.
2. Set **Site URL** to your Vercel address → **Save**.

---

## Part 4 — Create your login and lock it

**Step 8. Create your account**
1. Open your Vercel site. You'll see a sign-in box (if it says **"Demo mode"** at the top, the keys in Step 6 are missing — see Troubleshooting).
2. Click **First time? Create your account**, enter your email and a password, and click **Create account**.
3. Sign in with the same email and password. You'll see a board with *To Do / In Progress / Done*.

**Step 9. Stop anyone else from signing up** (important)
1. Supabase → **Authentication** → **Sign In / Providers**.
2. Switch **Allow new users to sign up** **OFF** → **Save**.

Now only your account can get in, and the database only ever shows rows that belong to you.

---

## Part 5 — Bring over your Jira data

**Step 10. Export from Jira**
1. In Jira, open **Filters → View all issues** (Jira Cloud may call it *Search work items*).
2. Switch to **Advanced / JQL** and type `project = YOURKEY ORDER BY key ASC` (replace `YOURKEY` with your space key, e.g. `ONB`).
3. Click **Export → Export CSV (all fields)**. "All fields" is the one that includes comments.
4. Jira exports at most **1,000** issues per file. If you have more, export in batches, e.g. `project = ONB AND key <= ONB-1000`, then `key > ONB-1000 AND key <= ONB-2000`, and so on.

**Step 11. Import**
1. In your app, click **Import CSV** → choose the file.
2. Review the mapping table. The app guesses for you:
   - *Summary* → **Title**, *Description* → **Description**, *Status* → **Status** (missing statuses are created as new columns)
   - every *Comment* column → **Comments** (keeps the original dates)
   - *Created* → the ticket's created date
   - *Issue key* → a new **Jira Key** field
   - *Labels* → a multi-select field; links → link fields; dates → date fields
   - empty columns and Jira internal IDs → **Skip**
3. Change anything you like: skip columns, rename new fields, change their type, or point a column at a field you already made.
4. Click **Import**. Repeat for each batch file — choose **Existing field** in the mapping for the batches after the first, so you don't get duplicate fields.

**Step 12. Make it yours**
- **Settings → Statuses:** rename, recolor, reorder or delete columns.
- **Settings → Fields:** add fields (short text, paragraph, link, date, number, dropdown, multi-select, checkbox) and tick **Show on card** for the ones you want visible on the board.
- **Settings → Checklist templates:** create e.g. *Client onboarding*. Tick **Auto-add to new tickets** to drop it into every new ticket, or add it on demand from **+ Add checklist** inside a ticket. Any checklist in a ticket can also be turned into a template with **Save as template**.
- **Settings → Export:** download everything as a CSV backup anytime.

---

## Updating the app later
Edit a file on GitHub (pencil icon → **Commit changes**) or upload a new version. Vercel redeploys automatically within a minute. Your data lives in Supabase and is not affected.

## Troubleshooting

| What you see | Fix |
|---|---|
| Yellow **"Demo mode"** badge on the live site | The environment variables are missing or misspelled. Vercel → your project → **Settings → Environment Variables**: check both names exactly, then **Deployments → ⋯ → Redeploy**. |
| "relation … does not exist" / "Something went wrong" after login | Step 2 wasn't run. Run `supabase/schema.sql` in the SQL Editor. |
| "Email not confirmed" | Turn off **Confirm email** (Step 3), or click the link in the confirmation email. |
| "Signups not allowed" when creating your account | You did Step 9 before Step 8. Turn signups back on, create your account, turn them off again. |
| Vercel build fails | Make sure `package.json` is at the top of the GitHub repo, not inside a sub-folder. |
| Free Supabase project "paused" | Free projects pause after ~1 week with no activity. Open the Supabase dashboard and click **Restore**. Your data is kept. |

## Try it on your computer first (optional)
If you have Node.js installed: open a terminal in the project folder and run `npm install` then `npm run dev`. Without keys, it runs in **Demo mode** (data stays in that browser). To use your real database locally, copy `.env.example` to `.env.local` and fill in the two values.
