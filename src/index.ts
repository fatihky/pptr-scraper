import 'dotenv/config';

import express from 'express';
import { Server } from 'http';
import nodeCleanup from 'node-cleanup';
import { HTTPResponse, Page } from 'puppeteer';
import { captchaSolver } from './captchaSolver';
import { getBrowser, launchBrowser, pool } from './pool';

interface TurnstileConfiguration {
  method: 'turnstile';
  key: string;
  sitekey: string;
  pageurl: string;
  data: string;
  pagedata: string;
  action: 'managed';
  userAgent: string;
  json: 1;
}

// /scrape API ucundan dönülecek yanıt
interface ScrapeResult {
  status: number;
  url: string;
  durationMs: number;
  contentType: string;
  contentsBase64: string;
  headers: Record<string, string>;
}

const app = express();
const port = Number(process.env.PORT ?? '7000');

let server: Server | null = null;

function isCloudflareMitigateResponse(resp: HTTPResponse): boolean {
  return (
    resp.status() === 403 && resp.headers()['cf-mitigated'] === 'challenge'
  );
}

async function solveCloudflareTurnstile(page: Page) {
  const turnstileConfiguration: TurnstileConfiguration = await page.evaluate(
    () => (window as any).turnstileConfiguration
  );

  console.log('turnstile config:', turnstileConfiguration);

  const solution = await captchaSolver.turnstile(
    turnstileConfiguration.sitekey,
    turnstileConfiguration.pageurl,
    turnstileConfiguration
  );

  console.log('submit turnstile solution:', solution);

  await page.evaluate(
    (val) => (window as any).tsCallback?.(val),
    solution.data
  );

  await page.waitForNetworkIdle();
}

class MaxScrapeAttemptsExceededError extends Error {
  constructor(url: string) {
    super(
      `Max scrape attempts ${maxAttempts} exceeded while trying to scrape "${url}"`
    );
  }
}

const maxAttempts = 1;

async function scrape(
  page: Page,
  url: string,
  attempts = 1
): Promise<HTTPResponse | null> {
  if (attempts > maxAttempts) {
    throw new MaxScrapeAttemptsExceededError(url);
  }

  let resp = await page.goto(url, {
    timeout: 180000,
    waitUntil: 'networkidle0',
  });

  if (resp === null) {
    return null;
  }

  if (isCloudflareMitigateResponse(resp)) {
    console.log(
      'Cloudflare mitigated our browsing. Try to automatically pass.'
    );

    await solveCloudflareTurnstile(page);

    console.log('Try to scrape the same url again...');

    return await scrape(page, url, attempts + 1);
  }

  return resp;
}

app.get('/scrape', async (req, res) => {
  const { url } = req.query;

  console.log('Tara:', url);

  if (typeof url !== 'string') {
    return res
      .status(400)
      .json({ error: 'url parametresi zorunludur ve tek url verilmelidir.' });
  }

  let page: Page | null = null;

  try {
    const acquireStart = Date.now();

    page = await pool.acquire();

    res.set(
      'X-Puppeteer-Page-Pool-Acquire-Time-Ms',
      String(Date.now() - acquireStart)
    );

    const startTime = Date.now();

    await page.reload();

    const resp = await scrape(page, url);

    if (!resp) {
      res.json(500).json({ error: 'page.goto did not return any response' });

      return;
    }

    const headers = resp.headers();
    const contentType = headers['content-type'] ?? 'text/html';

    console.log('resp:', resp.status(), resp.statusText(), resp.headers());

    res.json({
      status: resp.status(),
      url: page.url(),
      durationMs: Date.now() - startTime,
      contentType: contentType.slice(0, contentType.indexOf(';')).trim(),
      contentsBase64: (await resp.buffer()).toString('base64'),
      headers: resp.headers() ?? {},
    } satisfies ScrapeResult);
  } catch (err) {
    console.error(
      'Scrape işlemi hata ile sonuçlandı:',
      err,
      err instanceof Error ? err.constructor : null
    );

    await page?.screenshot({
      path: `${Date.now()}-${new URL(url).host}-failed.screenshot.png`,
    });

    res.status(500).json({ error: (err as Error).message });
  } finally {
    if (page) {
      await pool.release(page);
    }
  }
});

async function main() {
  const host = process.env.HOST ?? '127.0.0.1';
  await launchBrowser();
  console.log('Browser launched...');

  server = app.listen(port, host);

  console.log(`server listening on http://${host}:${port}`);
}

main().catch((err) => {
  console.log('Main error:', err);

  process.exit(1);
});

nodeCleanup(() => {
  if (server) {
    console.log('Closing HTTP server...');

    server.close();
  }

  pool.clear().then(() => {
    const browser = getBrowser();

    if (browser) {
      console.log('Closing browser...');

      browser
        .close()
        .catch((err) => console.log('ERROR: Can not close browser:', err));
    }
  });
});
