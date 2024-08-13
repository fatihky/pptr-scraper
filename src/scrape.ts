import { HTTPResponse, Page } from 'puppeteer';
import { captchaSolver } from './captchaSolver';

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

const maxAttempts = 1;

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

export async function scrape(
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
