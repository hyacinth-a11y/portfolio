# Portfolio read-only API

`GET https://YOUR-SITE.vercel.app/api/portfolio`

Send your token in a header: `Authorization: Bearer YOUR_TOKEN` (or `x-api-key: YOUR_TOKEN`).
For tools that can't set headers, `?token=YOUR_TOKEN` also works (less private — it can show up in logs).

## Filters (optional)
| Parameter | Example | Meaning |
|---|---|---|
| `key` | `?key=POC-71` | one ticket |
| `status` | `?status=In Progress` | tickets in that column |
| `work_type` | `?work_type=project` | `workstream`, `project` or `subtask` |
| `priority` | `?priority=high` | `low`, `medium`, `high` or `highest` |
| `updated_since` | `?updated_since=2026-11-01` | changed on/after this date |
| `include` | `?include=board` | only `tickets`, only `board`, or both (default) |

## Response
```json
{
  "generated_at": "…", "key_prefix": "POC", "count": 111,
  "board": { "statuses": [...], "work_types": [...], "fields": [...], "checklist_templates": [...] },
  "tickets": [{
    "key": "POC-6", "title": "Chef Moses", "status": "Closed",
    "work_type": "project", "work_type_label": "Project Name", "priority": "high",
    "parent_key": "POC-22", "parent_title": "FastSaas Projects",
    "description_text": "…", "description_html": "…",
    "fields": { "SOW": "https://…", "Labels": ["aws"] },
    "checklists": [{ "title": "Project Onboarding Tracker", "done": 7, "total": 8, "items": [...] }],
    "created_at": "…", "updated_at": "…"
  }]
}
```

## Example
```bash
curl -H "Authorization: Bearer YOUR_TOKEN" "https://YOUR-SITE.vercel.app/api/portfolio?status=In%20Progress"
```
```js
const r = await fetch('https://YOUR-SITE.vercel.app/api/portfolio', { headers: { Authorization: 'Bearer ' + TOKEN } })
const { tickets } = await r.json()
```
