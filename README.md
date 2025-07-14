# pptr-scraper

pm2 ile şöyle çalıştırmak mümkün bu aracı:
`pm2 start --name pptr-scraper -x bash -- -c 'xvfb-run node dist/index.js'`

## AI Code Reviewers

This repository includes automated AI code review capabilities using both Gemini and Claude AI models.

### Gemini Code Assist for GitHub (Official)

**Setup:**
1. Install the [Gemini Code Assist GitHub App](https://github.com/apps/gemini-code-assist) to your repository
2. No additional configuration or secrets required - works automatically once installed

**Usage:**
- The official Gemini Code Assist automatically reviews pull requests
- Provides intelligent code suggestions and analysis directly in PR comments
- No manual trigger commands needed

### Claude AI Code Reviewer

**Setup:**
1. Install the [Claude GitHub app](https://github.com/apps/claude) to your repository
2. Add authentication secrets to your repository (choose one):
   - `ANTHROPIC_API_KEY` for API key authentication
   - `CLAUDE_CODE_OAUTH_TOKEN` for OAuth (generate with `claude setup-token`)
3. The workflow file `.github/workflows/claude-code-review.yml` is already configured

**Usage:**
- Comment `/claude-review` on any pull request to trigger the Claude AI code review
- The review will analyze the code changes and provide suggestions as PR comments

**Note:** The Claude AI reviewer excludes documentation files (*.md, *.txt), configuration files (*.yml, *.yaml), and package-lock.json from review by default. The official Gemini Code Assist handles file filtering automatically based on relevance.
