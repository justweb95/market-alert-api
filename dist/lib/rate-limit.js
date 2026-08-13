import rateLimit, { ipKeyGenerator } from 'express-rate-limit';
/**
 * General rate limiter for all API calls
 * 100 requests per 15 minutes per IP
 */
export const generalLimiter = rateLimit({
    windowMs: 15 * 60 * 1000, // 15 minutes
    max: 100, // limit each IP to 100 requests per windowMs
    message: 'Previše zahteva, pokušajte kasnije',
    standardHeaders: true, // Return rate limit info in `RateLimit-*` headers
    legacyHeaders: false, // Disable `X-RateLimit-*` headers
    skip: (req) => {
        // Skip rate limiting for health checks
        if (req.path === '/health')
            return true;
        return false;
    },
});
/**
 * Strict rate limiter for device registration
 * 5 registrations per hour per IP (prevents abuse)
 */
export const deviceRegistrationLimiter = rateLimit({
    windowMs: 60 * 60 * 1000, // 1 hour
    max: 5, // 5 registrations per hour
    message: 'Previše pokušaja registracije, pokušajte kasnije',
    standardHeaders: true,
    legacyHeaders: false,
    keyGenerator: (req) => {
        // Rate limit by device ID if available, otherwise by IP
        return req.body?.deviceId || ipKeyGenerator(req.ip || 'unknown');
    },
});
/**
 * Alert creation limiter
 * 10 alerts per minute per device (prevents spam)
 */
export const createAlertLimiter = rateLimit({
    windowMs: 60 * 1000, // 1 minute
    max: 10, // 10 alerts per minute
    message: 'Previše signala, pokušajte kasnije',
    standardHeaders: true,
    legacyHeaders: false,
    keyGenerator: (req) => {
        // Rate limit by device ID
        return req.body?.deviceId || ipKeyGenerator(req.ip || 'unknown');
    },
});
/**
 * Promo code redemption limiter
 * 3 attempts per hour per device (prevents brute force)
 */
export const promoCodLimiter = rateLimit({
    windowMs: 60 * 60 * 1000, // 1 hour
    max: 3, // 3 attempts per hour
    message: 'Previše pokušaja, pokušajte kasnije',
    standardHeaders: true,
    legacyHeaders: false,
    keyGenerator: (req) => {
        return req.body?.deviceId || ipKeyGenerator(req.ip || 'unknown');
    },
});
/**
 * Scraper job trigger limiter (admin only)
 * 5 scrapes per minute (prevents resource exhaustion)
 */
export const scraperJobLimiter = rateLimit({
    windowMs: 60 * 1000, // 1 minute
    max: 5,
    message: 'Previše pokušaja pokretanja scraper-a',
    standardHeaders: true,
    legacyHeaders: false,
    keyGenerator: (req) => {
        // Rate limit by user/API key
        const key = Array.isArray(req.headers['x-api-key'])
            ? req.headers['x-api-key'][0]
            : req.headers['x-api-key'];
        const auth = Array.isArray(req.headers.authorization)
            ? req.headers.authorization[0]
            : req.headers.authorization;
        return (key || auth || ipKeyGenerator(req.ip || 'unknown'));
    },
});
/**
 * Test notification limiter
 * 5 per minute per device
 */
export const testNotificationLimiter = rateLimit({
    windowMs: 60 * 1000,
    max: 5,
    message: 'Previše test notifikacija, pokušajte kasnije',
    standardHeaders: true,
    legacyHeaders: false,
    keyGenerator: (req) => {
        return (req.body?.deviceId || req.query?.deviceId || ipKeyGenerator(req.ip || 'unknown'));
    },
});
/**
 * Statistics endpoint limiter
 * Keep admin endpoint responsive without allowing expensive burst traffic.
 */
export const statisticLimiter = rateLimit({
    windowMs: 60 * 1000,
    max: 30,
    message: 'Previše statistic zahteva, pokušajte kasnije',
    standardHeaders: true,
    legacyHeaders: false,
});
//# sourceMappingURL=rate-limit.js.map