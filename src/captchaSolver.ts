import { Solver } from '2captcha';

export const captchaSolver = new Solver(process.env.TWOCAPTCHA_API_KEY!);
