import { Solver } from '2captcha';

const twoCaptchaApiKey = process.env.TWOCAPTCHA_API_KEY;

if (!twoCaptchaApiKey) {
  throw new Error('TWOCAPTCHA_API_KEY ortam değişkeni zorunludur');
}

export const captchaSolver = new Solver(twoCaptchaApiKey);
