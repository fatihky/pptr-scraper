# AGENTS.md

## Build/Lint/Test Commands

- **Build:** `pnpm run build` - Compiles TypeScript to `./dist`
- **Lint:** `pnpm run lint` - Runs Biome linter with auto-fix
- **Format:** `pnpm run format` - Runs Biome formatter
- **Start:** `pnpm run start` - Runs compiled server with pino-pretty logging
- **Dev:** `pnpm run dev` - Runs uncompiled TypeScript with nodemon (ignores userData dir)
- **Test:** No tests currently defined

**Single command to run all checks:**
```bash
pnpm run lint && pnpm run format && pnpm run build
```

## Code Style Guidelines

### Formatting
- Use Biome as the single source of truth for formatting
- Indent style: spaces (not tabs)
- Quote style: single quotes in JavaScript files
- Prettier config exists but Biome overrides it

### Imports
- Use absolute paths from `src/` (e.g., `import { logger } from './logger'`)
- Node built-ins use `node:` prefix (e.g., `import assert from 'node:assert'`)
- Type imports use `type` keyword (e.g., `import type { Page } from 'puppeteer'`)
- Organize imports automatically via Biome assist

### TypeScript
- Strict mode enabled (`"strict": true`)
- ES2016 library target
- Modules: ES modules with `esModuleInterop: true`
- No explicit `any` - use proper types or `unknown` with error guards
- Interface declarations before implementations (see `scrape.ts:5-19`)

### Naming Conventions
- Functions/variables: camelCase (e.g., `scrapeQuerySchema`, `maxScrolls`)
- Types/Interfaces: PascalCase (e.g., `ScrapeResult`, `TurnstileConfiguration`)
- Constants: UPPER_SNAKE_CASE (e.g., `maxAttempts`)
- Files: lowercase with hyphens or camelCase

### Error Handling
- Use try/catch with specific error guards: `err instanceof Error ? err.message : String(err)`
- Logger.error format: `logger.error('message %s %o', error, context)`
- Never silent failures - log and re-throw or return fallback
- Use custom Error subclasses for domain-specific errors (see `MaxScrapeAttemptsExceededError`)

### Browser/Puppeteer Patterns
- Use connection pool pattern for pages (generic-pool in `pool.ts`)
- Always clean up resources in `finally` blocks or nodeCleanup handlers
- Browser launch errors handled with retry logic (max 5 attempts in `pool.ts:36`)
- Resource blocking enabled by default (`--no-block-resources` flag disables)

### Logging
- Use pino structured logging via `logger.child({})`
- Log bindings added via `log.setBindings({ key: value })`
- Turkish log messages allowed (project appears to be Turkish-language)
- Never include secrets in logs

### API Guidelines
- Use express-async-handler for async route handlers
- Validate inputs with Zod schemas before processing
- Always return proper HTTP status codes (400 for validation, 500 for server errors)
- Response headers cleaned of newlines (see `cleanHeaders` in `index.ts:28`)
