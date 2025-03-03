import { program } from 'commander';
import type { LaunchOptions } from 'puppeteer';

// --no-headless dersek { headless: false } geliyor
// böylece tarayıcı görünür oluyor.
program
  .option('--no-headless', undefined, true)
  .option('--proxy <address>', 'Proxy address')
  .option('--max-tabs <count>', 'Maximum open tabs', '2')
  .parse();

const opts = program.opts<{
  headless: boolean;
  maxTabs: string;
  proxy: string | undefined;
}>();

const puppeteerLaunchOptions: LaunchOptions = {
  headless: opts.headless,
  timeout: 180000,
  userDataDir: './userData',
  args: ['--no-sandbox'].concat(
    opts.proxy ? `--proxy-server=${opts.proxy}` : [],
  ),
};

console.log('program options:', opts);
console.log('puppeteer launch options:', puppeteerLaunchOptions);

export default { opts, puppeteerLaunchOptions };
