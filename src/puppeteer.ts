import puppeteer from 'puppeteer-extra';
import RecaptchaPlugin from 'puppeteer-extra-plugin-recaptcha';
import StealthPlugin from 'puppeteer-extra-plugin-stealth';

// eklentileri kaydet
puppeteer.use(
  RecaptchaPlugin({
    provider: {
      id: '2captcha',
      token: process.env.TWOCAPTCHA_API_KEY!,
    },
    visualFeedback: true,
  })
);

puppeteer.use(StealthPlugin());

export { puppeteer };
