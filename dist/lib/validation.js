import { z } from 'zod';
// Device Registration
// Napomena: deviceId je opciono — prva registracija novog uredjaja (svez install,
// jos ne postoji sacuvan ID) salje deviceId: null, i controller ga tada generise.
// expoPushToken prihvata i pravi Expo format i "mock:..." token (emulator/odbijena
// dozvola za notifikacije, vidi hooks/useDevice.ts getOrCreateMockPushToken) — obe
// putanje su namerno podrzane u aplikaciji, ne smeju biti blokirane ovde.
// firstName/lastName/email/password su opcioni na nivou scheme (registracija
// uredjaja bez naloga je validan tok), ALI moraju biti deklarisani ovde —
// inace ih Zod .object() cuti (default ponasanje: strip nepoznatih polja),
// pa nalog nikad ne bi bio kreiran iako klijent salje ispravne podatke.
export const registerDeviceSchema = z.object({
    expoPushToken: z.string().min(1, 'Push token je obavezna polja'),
    platform: z.enum(['IOS', 'ANDROID', 'WEB']),
    deviceId: z
        .string()
        .min(1, 'Device ID je obavezna polja')
        .max(255, 'Device ID je previše dugačak')
        .optional()
        .nullable(),
    firstName: z.string().min(1, 'Ime je obavezno').max(100).optional(),
    lastName: z.string().min(1, 'Prezime je obavezno').max(100).optional(),
    email: z.string().email('Email adresa nije validna').max(255).optional(),
    password: z.string().min(6, 'Password mora imati najmanje 6 karaktera').max(200).optional(),
});
// Alert Creation
export const createAlertSchema = z.object({
    deviceId: z.string().min(1, 'Device ID je obavezna polja'),
    category: z.enum([
        'AUTOMOBILI',
        'AUTO_DELOVI',
        'MOTORI',
        'MOTO_DELOVI',
        'MOTO_OPREMA',
        'TELEFONI',
        'RACUNARI',
        'BICIKLI',
        'NEKRETNINE',
        'SVE',
    ]),
    keywords: z
        .array(z
        .string()
        .min(1, 'Ključna reč ne može biti prazna')
        .max(100, 'Ključna reč je previše dugačka')
        .trim())
        .min(1, 'Najmanje jedna ključna reč je obavezna')
        .max(20, 'Maksimalno 20 ključnih reči'),
    priceMax: z
        .number()
        .positive('Cena mora biti pozitivna')
        .max(1000000, 'Cena je previše visoka')
        .nullish(),
    locationText: z
        .string()
        .max(255, 'Lokacija je previše dugačka')
        .optional(),
    propertyType: z
        .enum(['STAN', 'LOKAL', 'PARCELA'])
        .nullish(),
    yearFrom: z
        .number()
        .int()
        .min(1900, 'Godina mora biti >= 1900')
        .max(new Date().getFullYear(), 'Godina ne može biti u budućnosti')
        .nullish(),
    yearTo: z
        .number()
        .int()
        .min(1900, 'Godina mora biti >= 1900')
        .max(new Date().getFullYear() + 1, 'Godina je previše visoka')
        .nullish(),
    kmFrom: z
        .number()
        .int()
        .positive('Kilometraža mora biti pozitivna')
        .nullish(),
    kmTo: z
        .number()
        .int()
        .positive('Kilometraža mora biti pozitivna')
        .nullish(),
    isActive: z.boolean().default(true),
});
// Alert Update
export const updateAlertSchema = createAlertSchema.partial().omit({
    deviceId: true,
});
// Register User (optional, for future auth)
export const registerUserSchema = z.object({
    email: z
        .string()
        .email('Nevaljana email adresa'),
    firstName: z
        .string()
        .min(1, 'Ime je obavezna polja')
        .max(100, 'Ime je previše dugačko'),
    lastName: z
        .string()
        .min(1, 'Prezime je obavezna polja')
        .max(100, 'Prezime je previše dugačko'),
    password: z
        .string()
        .min(8, 'Lozinka mora imati najmanje 8 karaktera')
        .regex(/^(?=.*[a-z])(?=.*[A-Z])(?=.*\d)/, 'Lozinka mora sadržati mala slova, VELIKA SLOVA i brojeve'),
});
// Login (optional, for future auth)
export const loginSchema = z.object({
    email: z.string().email('Nevaljana email adresa'),
    password: z.string().min(1, 'Lozinka je obavezna polja'),
});
// Batch Delete Alerts
export const deleteAlertsSchema = z.object({
    alertIds: z
        .array(z.string().min(1))
        .min(1, 'Najmanje jedan alert ID je obavezna polja')
        .max(100, 'Maksimalno 100 alertsa'),
});
// Scraper Trigger (admin only)
export const triggerScraperSchema = z.object({
    sources: z
        .array(z.enum(['motodelovi', 'kp', 'pa']))
        .min(1, 'Najmanje jedan izvor je obavezna polja'),
    priority: z.enum(['low', 'normal', 'high']).default('normal'),
});
//# sourceMappingURL=validation.js.map