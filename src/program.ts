import { program } from 'commander';
import type { LaunchOptions } from 'puppeteer';
import { logger } from './logger';

// --no-headless dersek { headless: false } geliyor
// böylece tarayıcı görünür oluyor.
program
  .option('--no-headless', undefined, true)
  .option('--proxy <address>', 'Proxy address')
  .option('--max-tabs <count>', 'Maximum open tabs', '4')
  .option('--no-block-resources', 'Disable resource blocking', true)
  .parse();

const opts = program.opts<{
  headless: boolean;
  maxTabs: string;
  proxy: string | undefined;
  blockResources: boolean;
}>();

const puppeteerLaunchOptions: LaunchOptions = {
  headless: opts.headless,
  timeout: 180000,
  userDataDir: './userData',
  args: ['--no-sandbox'].concat(
    opts.proxy ? `--proxy-server=${opts.proxy}` : [],
  ),
};

logger.info('program options: %o', opts);
logger.info('puppeteer launch options: %o', puppeteerLaunchOptions);

export default { opts, puppeteerLaunchOptions };
