# Project Portfolio

A personal, Jira-style board for tracking every project you've onboarded.

- **Board** with drag-and-drop between status columns (and reordering within a column)
- **Customizable statuses** — add, rename, recolor, reorder, delete
- **Tickets** with title, description, comments, and **custom fields**: short text, paragraph, link, date, number, dropdown, multi-select/labels, checkbox
- **Checklists** with reusable **templates** (optionally auto-added to every new ticket)
- **CSV import** built for Jira exports (handles repeated Comment/Labels columns, Jira date formats, creates missing statuses and fields)
- **CSV export** for backups
- Private login via Supabase; row-level security keeps every row tied to your account

Stack: React + Vite, Supabase (Postgres + Auth), hosted on Vercel.

👉 **To deploy, follow [DEPLOY.md](DEPLOY.md).**

`samples/sample-jira-export.csv` is a small Jira-style file you can use to try the importer.
