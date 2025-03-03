import puppeteer from 'puppeteer-extra';
import RecaptchaPlugin from 'puppeteer-extra-plugin-recaptcha';
import StealthPlugin from 'puppeteer-extra-plugin-stealth';

const twoCaptchaApiKey = process.env.TWOCAPTCHA_API_KEY;

if (!twoCaptchaApiKey) {
  throw new Error('TWOCAPTCHA_API_KEY ortam değişkeni zorunludur');
}

// eklentileri kaydet
puppeteer.use(
  RecaptchaPlugin({
    provider: {
      id: '2captcha',
      token: twoCaptchaApiKey,
    },
    visualFeedback: true,
  }),
);

puppeteer.use(StealthPlugin());

export { puppeteer };
