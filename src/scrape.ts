import type { Logger } from 'pino';
import type { HTTPResponse, Page } from 'puppeteer';
import { captchaSolver } from './captchaSolver';

export interface ScrapeParams {
  page: Page;
  url: string;
  infiniteScroll?: boolean;
  waitForNetwork?: boolean;
  maxScrolls?: number;
  blockResources?: boolean;
}

export interface ScrapeResult {
  body: Buffer | null;
  headers: Record<string, string>;
  status: number;
  statusText: string;
  finalUrl: string;
}

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

async function solveCloudflareTurnstile(log: Logger, page: Page) {
  const turnstileConfiguration: TurnstileConfiguration = await page.evaluate(
    // biome-ignore lint/suspicious/noExplicitAny: bu sorunu aşmanın tek yolu böyle any kullanmak
    () => (window as any).turnstileConfiguration,
  );

  log.info('turnstile config: %o', turnstileConfiguration);

  const solution = await captchaSolver.turnstile(
    turnstileConfiguration.sitekey,
    turnstileConfiguration.pageurl,
    turnstileConfiguration,
  );

  log.info('submit turnstile solution: %o', solution);

  await page.evaluate(
    // biome-ignore lint/suspicious/noExplicitAny: bu sorunu aşmanın tek yolu böyle any kullanmak
    (val) => (window as any).tsCallback?.(val),
    solution.data,
  );

  await page.waitForNetworkIdle({ timeout: 300000 });
}

class MaxScrapeAttemptsExceededError extends Error {
  constructor(url: string) {
    super(
      `Max scrape attempts ${maxAttempts} exceeded while trying to scrape "${url}"`,
    );
  }
}

async function scrollToBottom(
  log: Logger,
  page: Page,
  opts?: { maxScrolls?: number },
) {
  const maxScrolls = opts?.maxScrolls ?? 20;
  let scrolls = 0;
  const scrollDelayMs = 800;
  let previousHeight = 0;
  const newItemsLoadTimeout = 20000;

  log.info('sayfayı en aşağı kadar kaydır');

  for (; scrolls < maxScrolls; scrolls++) {
    previousHeight = await page.evaluate(() => document.body.scrollHeight);

    // önce yukarı taşıyoruz scroll'u. bu sayede yeniden aşağı taşıdığımızda sonraki sayfa yüklenecek
    const coordinates = await page.evaluate(() => {
      const coordinates = {
        x: 0,
        y: Math.max(
          document.body.scrollHeight -
            document.documentElement.clientHeight -
            500,
          0,
        ),
        scrollHeight: document.body.scrollHeight,
        clientHeight: document.documentElement.clientHeight,
      };

      window.scrollTo(coordinates.x, coordinates.y);

      return coordinates;
    });

    log.info('Yukarı taşıma koordinatları: %o', coordinates);

    // scroll'u yukarı taşıdıktan sonra bir saniye kadar bekleyelim
    await new Promise((r) => setTimeout(r, 1000));

    // şimdi aşağı taşıyoruz sayfayı
    await page.evaluate(() => window.scrollTo(0, document.body.scrollHeight));

    // sayfaya yeni elemanların eklenmesini, sayfanın uzamasını bekliyoruz
    // bekleme süremizi de kısıtlıyoruz ki yeni bir şey eklenmezse biz hata
    // vermeden süreci sonlandıralım.
    const waitNewItemsUntil = Date.now() + newItemsLoadTimeout;

    await page.waitForFunction(
      (waitNewItemsUntil, previousHeight) =>
        Date.now() >= waitNewItemsUntil ||
        document.body.scrollHeight > previousHeight,
      { timeout: 60000, polling: 100 },
      waitNewItemsUntil,
      previousHeight,
    );

    const currentHeight = await page.evaluate(() => document.body.scrollHeight);

    // sayfa uzamadıysa scroll'u sonlandıralım.
    if (currentHeight === previousHeight) {
      log.info('sayfa kaydırması sonrası sayfanın yüksekliği değişmedi: %o', {
        currentHeight,
        previousHeight,
      });
      break;
    }

    // scroll sonrası bekliyoruz ki sitenin istek sınırlamalarına takılmayalım
    // kullanıcı sanki ürünleri inceliyormuş gibi beklemiş oluyor burada.
    await new Promise((r) => setTimeout(r, scrollDelayMs));
  }

  log.info('sayfa kaydırma bitti. kaydırma sayısı: %d', scrolls);
}

export async function scrape(
  log: Logger,
  { maxScrolls, page, url, infiniteScroll, waitForNetwork, blockResources = true }: ScrapeParams,
  attempts = 1,
): Promise<ScrapeResult | null> {
  if (attempts > maxAttempts) {
    throw new MaxScrapeAttemptsExceededError(url);
  }

  // Set up request interception if resource blocking is enabled
  if (blockResources) {
    // Remove all existing request listeners to avoid duplicates
    page.removeAllListeners('request');

    await page.setRequestInterception(true);

    const blockedResourceTypes = ['image', 'stylesheet', 'media', 'font'];

    page.on('request', (request) => {
      const resourceType = request.resourceType();

      if (blockedResourceTypes.includes(resourceType)) {
        log.debug('Blocking resource: %s (%s)', request.url(), resourceType);
        request.abort();
      } else {
        request.continue();
      }
    });

    log.info('Resource blocking enabled: blocking %o', blockedResourceTypes);
  } else {
    // If resource blocking is disabled, ensure request interception is off
    page.removeAllListeners('request');
    await page.setRequestInterception(false);
  }

  const resp = await page.goto(url, {
    timeout: 180000,
    waitUntil: waitForNetwork ? 'networkidle0' : undefined,
  });

  if (resp === null) {
    return null;
  }

  if (isCloudflareMitigateResponse(resp)) {
    log.info('Cloudflare mitigated our browsing. Try to automatically pass.');

    await solveCloudflareTurnstile(log, page);

    log.info('Try to scrape the same url again...');

    return await scrape(
      log,
      { page, url, infiniteScroll, waitForNetwork, maxScrolls, blockResources },
      attempts + 1,
    );
  }

  if (infiniteScroll) {
    await scrollToBottom(log, page, { maxScrolls });
  }

  if (waitForNetwork) {
    try {
      // iki dakikaya kadar bağlantıların kapanmasını bekle
      await page.waitForNetworkIdle({ timeout: 120000 });
    } catch {
      // ignore
    }
  }

  let body: Buffer<ArrayBufferLike> | null = null;

  try {
    body = infiniteScroll
      ? Buffer.from(await page.content())
      : await resp.buffer();
  } catch (err) {
    if (infiniteScroll) {
      throw err;
    }

    // bazı sayfalar not found dönüyor ama body boş geliyor.
    // bu durumda resp.buffer() hata veriyor. o yüzden infiniteScroll
    // durumu dışında body dönmüyoruz
  }

  return {
    // ekran kaydırılmışsa html içeriğini döndür
    body,
    headers: resp.headers(),
    status: resp.status(),
    statusText: resp.statusText(),
    finalUrl: page.url(),
  };
}
