# pptr-scraper

pm2 ile şöyle çalıştırmak mümkün bu aracı:
`pm2 start --name pptr-scraper -x bash -- -c 'xvfb-run node dist/index.js'`

## AI Code Reviewers

This repository includes automated AI code review capabilities using both Gemini and Claude AI models.

### Gemini AI Code Reviewer

**Setup:**
1. Get a Gemini API key from [Google AI Studio](https://ai.google.dev/)
2. Add the API key as a GitHub secret named `GEMINI_API_KEY` in your repository settings
3. The workflow file `.github/workflows/gemini-code-review.yml` is already configured

**Usage:**
- Comment `/gemini-review` on any pull request to trigger the Gemini AI code review
- The review will analyze the code changes and provide suggestions as PR comments

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

**Note:** Both AI reviewers exclude documentation files (*.md, *.txt), configuration files (*.yml, *.yaml), and package-lock.json from review by default.
