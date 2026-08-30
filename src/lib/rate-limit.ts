import rateLimit, { ipKeyGenerator } from 'express-rate-limit';
import type { Request } from 'express';

/**
 * General rate limiter for all API calls
 * 100 requests per 15 minutes per IP
 */
export const generalLimiter = rateLimit({
  windowMs: 15 * 60 * 1000, // 15 minutes
  max: 100, // limit each IP to 100 requests per windowMs
  message: { error: 'Previše zahteva, pokušajte kasnije' },
  standardHeaders: true, // Return rate limit info in `RateLimit-*` headers
  legacyHeaders: false, // Disable `X-RateLimit-*` headers
  skip: (req: Request) => {
    // Skip rate limiting for health checks
    if (req.path === '/health') return true;
    return false;
  },
});

/**
 * Limiter za POST /devices.
 *
 * VAZNO: ova ruta ne opsluzuje samo registraciju naloga - kroz nju idu i prijava
 * (email+password), Google prijava i anonimna registracija uredjaja pri svakoj
 * promeni push tokena. Zato je granica bila pogresno postavljena: 5 na sat je
 * znacilo da korisnik koji nekoliko puta pogresi lozinku vise ne moze da se
 * prijavi ni sa TACNOM lozinkom narednih sat vremena, a app je to prikazivao kao
 * gresku u kredencijalima.
 *
 * Kljuc: deviceId kad postoji, inace expoPushToken (jedinstven po instalaciji),
 * pa tek onda IP. Kljucanje po IP-u je losa poslednja opcija za mobilnu app -
 * mobilni operateri drze hiljade korisnika iza istog CGNAT IP-a, pa bi jedan
 * korisnik zakljucao sve ostale na toj mrezi. Ukupan obim po IP-u i dalje ogranicava
 * generalLimiter (100 zahteva / 15 min).
 */
export const deviceRegistrationLimiter = rateLimit({
  windowMs: 60 * 60 * 1000, // 1 sat
  max: 30,
  message: { error: 'Previše pokušaja prijave. Sačekaj malo pa probaj ponovo.' },
  standardHeaders: true,
  legacyHeaders: false,
  keyGenerator: (req: Request) => {
    const deviceId = req.body?.deviceId as string | undefined;
    const pushToken = req.body?.expoPushToken as string | undefined;
    return deviceId || pushToken || ipKeyGenerator(req.ip || 'unknown');
  },
});

/**
 * Alert creation limiter
 * 10 alerts per minute per device (prevents spam)
 */
export const createAlertLimiter = rateLimit({
  windowMs: 60 * 1000, // 1 minute
  max: 10, // 10 alerts per minute
  message: { error: 'Previše signala, pokušajte kasnije' },
  standardHeaders: true,
  legacyHeaders: false,
  keyGenerator: (req: Request) => {
    // Rate limit by device ID
    return (req.body?.deviceId as string) || ipKeyGenerator(req.ip || 'unknown');
  },
});

/**
 * Promo code redemption limiter
 * 3 attempts per hour per device (prevents brute force)
 */
export const promoCodLimiter = rateLimit({
  windowMs: 60 * 60 * 1000, // 1 hour
  max: 3, // 3 attempts per hour
  message: { error: 'Previše pokušaja, pokušajte kasnije' },
  standardHeaders: true,
  legacyHeaders: false,
  keyGenerator: (req: Request) => {
    return (req.body?.deviceId as string) || ipKeyGenerator(req.ip || 'unknown');
  },
});

/**
 * Scraper job trigger limiter (admin only)
 * 5 scrapes per minute (prevents resource exhaustion)
 */
export const scraperJobLimiter = rateLimit({
  windowMs: 60 * 1000, // 1 minute
  max: 5,
  message: { error: 'Previše pokušaja pokretanja scraper-a' },
  standardHeaders: true,
  legacyHeaders: false,
  keyGenerator: (req: Request) => {
    // Rate limit by user/API key
    const key = Array.isArray(req.headers['x-api-key']) 
      ? req.headers['x-api-key'][0] 
      : (req.headers['x-api-key'] as string);
    const auth = Array.isArray(req.headers.authorization)
      ? req.headers.authorization[0]
      : (req.headers.authorization as string);
    return (key || auth || ipKeyGenerator(req.ip || 'unknown')) as string;
  },
});

/**
 * Test notification limiter
 * 5 per minute per device
 */
export const testNotificationLimiter = rateLimit({
  windowMs: 60 * 1000,
  max: 5,
  message: { error: 'Previše test notifikacija, pokušajte kasnije' },
  standardHeaders: true,
  legacyHeaders: false,
  keyGenerator: (req: Request) => {
    return ((req.body?.deviceId as string) || (req.query?.deviceId as string) || ipKeyGenerator(req.ip || 'unknown')) as string;
  },
});

/**
 * Statistics endpoint limiter
 * Keep admin endpoint responsive without allowing expensive burst traffic.
 */
export const statisticLimiter = rateLimit({
  windowMs: 60 * 1000,
  max: 30,
  message: { error: 'Previše statistic zahteva, pokušajte kasnije' },
  standardHeaders: true,
  legacyHeaders: false,
});
