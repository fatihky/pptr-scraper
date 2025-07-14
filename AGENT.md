# pptr-scraper Agent Documentation

## Overview

pptr-scraper is a web scraping service that provides multiple scraping modes to handle different use cases. This document explains the different scraping modes and their implementation details.

## Scraping Modes

### 1. Normal Browser Mode (Default)
- **Usage**: Default mode when no special flags are set
- **Implementation**: Uses Puppeteer browser with full JavaScript support
- **Features**:
  - Full browser rendering
  - JavaScript execution
  - DOM manipulation
  - Browser features (cookies, localStorage, etc.)
  - Stealth mode capabilities
  - Proxy support
  - Infinite scroll support
  - Screenshot capabilities

### 2. No Browser Mode (`noBrowser=true`)
- **Usage**: `GET /scrape?url=https://example.com&noBrowser=true`
- **Implementation**: Uses direct `fetch()` call without browser
- **Reference**: [Line 104-119 in index.ts](src/index.ts#L104-L119)
- **Features**:
  - Simple HTTP request
  - No JavaScript execution
  - No DOM rendering
  - Faster performance
  - Lower resource usage
- **Limitations**:
  - Cannot use with `screenshot=true`
  - Cannot use with `disableJs=true` (mutually exclusive)
  - No browser features (cookies, localStorage, etc.)
  - Cannot handle SPA or JavaScript-dependent content

### 3. Disabled JavaScript Mode (`disableJs=true`)
- **Usage**: `GET /scrape?url=https://example.com&disableJs=true`
- **Implementation**: Uses Puppeteer browser but disables JavaScript execution
- **Reference**: [Line 154-157 in scrape.ts](src/scrape.ts#L154-L157)
- **Features**:
  - Browser rendering without JavaScript
  - DOM parsing
  - CSS rendering
  - Stealth mode capabilities
  - Proxy support
  - Screenshot capabilities
- **Limitations**:
  - Cannot use with `infiniteScroll=true` (requires JavaScript)
  - Cannot use with `noBrowser=true` (mutually exclusive)
  - May fail with Cloudflare challenges (requires JavaScript)
  - Pages requiring JavaScript for content loading may return incomplete results

## Parameter Validation

The service includes validation to prevent conflicting parameter combinations:

### Mutually Exclusive Parameters
- `noBrowser=true` + `disableJs=true`: These are different approaches to avoiding JavaScript
- `noBrowser=true` + `screenshot=true`: Screenshots require browser rendering
- `disableJs=true` + `infiniteScroll=true`: Infinite scroll requires JavaScript execution

### Validation Implementation
```typescript
// Validation checks in index.ts
if (noBrowser && disableJs) {
  res.status(400).json({ error: 'noBrowser ve disableJs birlikte kullanılamaz.' });
  return;
}

if (disableJs && infiniteScroll) {
  res.status(400).json({ error: 'disableJs ile infiniteScroll birlikte kullanılamaz.' });
  return;
}

if (noBrowser && screenshot) {
  res.status(400).json({ error: 'noBrowser ile screenshot birlikte kullanılamaz.' });
  return;
}
```

## Implementation Details

### No Browser Mode Implementation
When `noBrowser=true`, the service bypasses Puppeteer entirely and uses the native `fetch()` API:

```typescript
if (noBrowser) {
  const response = await fetch(url);
  const responseHeaders: Record<string, string> = {};
  
  response.headers.forEach((value, key) => {
    responseHeaders[key] = value;
  });
  
  const buf = Buffer.from(await response.bytes());
  
  resp = {
    status: response.status,
    statusText: response.statusText,
    finalUrl: response.url,
    headers: responseHeaders,
    body: buf.length > 0 ? buf : null,
  };
}
```

### Disabled JavaScript Mode Implementation
When `disableJs=true`, the service uses Puppeteer but disables JavaScript execution:

```typescript
// Disable JavaScript if requested
if (disableJs) {
  await page.setJavaScriptEnabled(false);
}
```

## Use Cases

### When to Use No Browser Mode
- Static HTML content
- API endpoints returning HTML
- Fast, lightweight scraping
- When JavaScript is not needed
- Server-side rendered content

### When to Use Disabled JavaScript Mode
- Content that loads without JavaScript but benefits from browser rendering
- CSS-heavy pages that need proper styling
- When you need screenshot capabilities
- When you need stealth mode features
- When you need to bypass basic bot detection

### When to Use Normal Browser Mode
- Single Page Applications (SPAs)
- JavaScript-dependent content
- Dynamic content loading
- Infinite scroll functionality
- Complex user interactions
- When you need full browser capabilities

## Performance Considerations

1. **No Browser Mode**: Fastest, lowest resource usage
2. **Disabled JavaScript Mode**: Medium performance, medium resource usage
3. **Normal Browser Mode**: Slowest, highest resource usage but most capable

## References

- Main scraping logic: [src/scrape.ts](src/scrape.ts)
- Parameter validation: [src/index.ts](src/index.ts#L75-L87)
- No browser implementation: [src/index.ts](src/index.ts#L103-L121)
- JavaScript disabling: [src/scrape.ts](src/scrape.ts#L154-L157)