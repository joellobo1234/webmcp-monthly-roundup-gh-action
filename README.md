# WebMCP Monthly Roundup Action

This repository contains a GitHub Action workflow that automatically generates a monthly newsletter roundup of activity in the [WebMCP](https://github.com/webmachinelearning/webmcp) repository.

## Features

- **Automated Summary**: Runs on the 1st of every month.
- **Activity Tracking**: Scans for created, closed, and merged PRs and Issues in the `webmachinelearning/webmcp` repository over the previous month.
- **Contributor Highlights**: Lists and links to everyone who contributed (authors, commenters, reviewers).
- **Discussions Integration**: Posts the generated roundup directly to the "Announcements" category of the Discussions tab in *this* repository.

## Setup

1. **Repository Permissions**:
   Ensure `GITHUB_TOKEN` has `discussions: write` permission. This is configured in the workflow `permissions` key, but ensure your repository "Settings > Actions > General > Workflow permissions" allows Read and Write permissions if default settings override this.

2. **Discussion Category**:
   Ensure your repository has a Discussion category named "Announcements". If not, the script defaults to the first available category.

## Manual Trigger

You can manually trigger the workflow from the "Actions" tab.
- **Date Override**: Optionally provide a date (formatted `YYYY-MM-DD`). The report will generate data for the month *prior* to this date. (e.g., inputting `2023-02-01` generates the report for January 2023).

## Local Development

To run the script locally:

1. Clone the repo.
2. `cd webmcp-newsletter`
3. `npm install`
4. Set required environment variables:
   ```bash
   export GITHUB_TOKEN=your_personal_access_token
   export GITHUB_REPOSITORY=your_username/your_repo_name
   ```
5. Run:
   ```bash
   npm start
   ```
   Or for a dry run (logs output without posting):
   ```bash
   export DRY_RUN=true
   npm start
   ```

## Workflow

The workflow is defined in `.github/workflows/monthly-webmcp-newsletter.yml`.
