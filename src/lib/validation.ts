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
  googleIdToken: z.string().min(1).max(4096).optional(),
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
    ] as const),
  keywords: z
    .array(
      z
        .string()
        .min(1, 'Ključna reč ne može biti prazna')
        .max(100, 'Ključna reč je previše dugačka')
        .trim()
    )
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
  // Filteri za vozila - prazan niz znaci "nije bitno".
  fuelTypes: z
    .array(z.enum(["BENZIN", "DIZEL", "HIBRID", "ELEKTRO", "TNG", "CNG"] as const))
    .max(6)
    .optional(),
  bodyTypes: z
    .array(
      z.enum([
        "LIMUZINA",
        "HECBEK",
        "KARAVAN",
        "KOMBI",
        "SUV",
        "KUPE",
        "KABRIOLET",
        "MONOVOLUMEN",
        "PIKAP",
      ] as const),
    )
    .max(9)
    .optional(),
  motoTypes: z
    .array(
      z.enum([
        "NAKED",
        "SPORT",
        "CHOPPER",
        "ENDURO",
        "SKUTER",
        "TURING",
        "ATV",
        "KLASIK",
      ] as const),
    )
    .max(8)
    .optional(),
  regions: z
    .array(z.enum(["BEOGRAD", "VOJVODINA", "ZAPADNA", "ISTOCNA", "JUZNA", "KOSOVO"] as const))
    .max(6)
    .optional(),
  ccmFrom: z.number().int().positive('Kubikaža mora biti pozitivna').max(10000).nullish(),
  ccmTo: z.number().int().positive('Kubikaža mora biti pozitivna').max(10000).nullish(),
  isActive: z.boolean().default(true),
});

// Alert Update
// Sva ostala polja su opciona - controller zadrzava postojecu vrednost za ono
// sto klijent ne posalje. deviceId je OBAVEZAN: bez njega controller ne moze da
// proveri vlasnistvo, pa bi svako ko zna id signala mogao da ga izmeni.
export const updateAlertSchema = createAlertSchema.partial().extend({
  deviceId: z.string().min(1, 'Device ID je obavezno polje'),
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
    .regex(
      /^(?=.*[a-z])(?=.*[A-Z])(?=.*\d)/,
      'Lozinka mora sadržati mala slova, VELIKA SLOVA i brojeve'
    ),
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

// Export types for use in controllers
export type RegisterDeviceInput = z.infer<typeof registerDeviceSchema>;
export type CreateAlertInput = z.infer<typeof createAlertSchema>;
export type UpdateAlertInput = z.infer<typeof updateAlertSchema>;
export type RegisterUserInput = z.infer<typeof registerUserSchema>;
export type LoginInput = z.infer<typeof loginSchema>;
export type DeleteAlertsInput = z.infer<typeof deleteAlertsSchema>;
export type TriggerScraperInput = z.infer<typeof triggerScraperSchema>;
