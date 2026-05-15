# DEPLOY.md

## How to get your Render Deploy Hook URL

1. Go to https://dashboard.render.com
2. Select your service: **search-spul-test**
3. Go to **Settings** tab
4. Scroll down to **Deploy Hook**
5. Click **Create Deploy Hook** (or copy the existing one)
6. Copy the full URL (it looks like `https://api.render.com/deploy/srv-xxxxxxxx?key=xxxxxxxxxxxxxxxx`)

## One-line curl command to trigger deploy

```bash
curl -X POST "https://api.render.com/deploy/srv-YOUR_SERVICE_ID?key=YOUR_DEPLOY_HOOK_KEY"
```

Replace with your actual URL from the dashboard.

## GitHub Actions auto-deploy on every push to main

Create file `.github/workflows/deploy.yml` with this content:

```yaml
name: Deploy to Render

on:
  push:
    branches: [ main ]

jobs:
  deploy:
    runs-on: ubuntu-latest
    steps:
      - name: Trigger Render Deploy
        run: |
          curl -X POST "https://api.render.com/deploy/srv-YOUR_SERVICE_ID?key=YOUR_DEPLOY_HOOK_KEY"
```

**Important:**
- Never commit your real deploy hook key to the repo.
- Store the key in GitHub Secrets as `RENDER_DEPLOY_HOOK` and reference it in the workflow.
- This makes every future `git push` to main automatically redeploy on Render with zero manual steps.

After adding the workflow, future Grok updates will trigger automatic deploys.