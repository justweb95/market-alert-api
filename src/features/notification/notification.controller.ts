import type { Request, Response } from "express";
import { randomBytes, scryptSync, timingSafeEqual } from "node:crypto";
import { prisma } from "../../db/prisma.js";
import { sendExpoPushNotification } from "./expoPush.service.js";
import { backfillMatchForAlert } from "./matcher.js";
import { FREE_BRONZE_CODE } from "../../lib/constants.js";
import { sendVerificationEmail } from "../../lib/email.service.js";
import { verifyGoogleIdToken } from "../../lib/googleAuth.js";

type PlanTier = "FREE" | "BRONZE" | "SILVER" | "GOLD";
type SubscriptionStatus = "TRIAL" | "ACTIVE" | "PAUSED" | "EXPIRED" | "CANCELLED";

type SubscriptionLite = {
  tier: PlanTier;
  status: SubscriptionStatus;
  productId: string | null;
  startedAt: Date;
  renewsAt: Date | null;
  pausedAt: Date | null;
  cancelledAt: Date | null;
};

function hasPaidAccess(subscription: SubscriptionLite | null): boolean {
  if (!subscription) return false;
  if (subscription.status === "ACTIVE") return true;

  if (subscription.status === "CANCELLED" && subscription.renewsAt) {
    return subscription.renewsAt.getTime() > Date.now();
  }

  return false;
}

type ProfileUserLite = {
  id: string;
  firstName: string;
  lastName: string;
  email: string;
  emailVerified: boolean;
  planTier: PlanTier;
  promoCodeUsed: string | null;
  promoRedeemedAt: Date | null;
  trialStartedAt: Date | null;
  subscription: SubscriptionLite | null;
};

const TRIAL_DAYS = 7;
const MAX_DEVICES_PER_USER = 2;
const TIER_ALERT_LIMIT: Record<PlanTier, number> = {
  FREE: 0,
  BRONZE: 3,
  SILVER: 6,
  GOLD: 10,
};

const PRICING_PLANS = [
  { tier: "BRONZE", alerts: 3, monthlyEur: 10 },
  { tier: "SILVER", alerts: 6, monthlyEur: 15 },
  { tier: "GOLD", alerts: 10, monthlyEur: 20 },
] as const;

function normalizePlatform(platform: unknown): "ANDROID" | "IOS" | "WEB" | null {
  if (typeof platform !== "string") return null;

  const normalized = platform.trim().toUpperCase();

  if (normalized === "ANDROID" || normalized === "ANDROID-EMULATOR") {
    return "ANDROID";
  }

  if (normalized === "IOS") {
    return "IOS";
  }

  if (normalized === "WEB") {
    return "WEB";
  }

  return null;
}

function getSingleString(value: unknown): string | null {
  return typeof value === "string" && value.trim() ? value.trim() : null;
}

function getOptionalInt(value: unknown): number | null {
  if (value === null || value === undefined || value === "") return null;
  const parsed = Number(value);
  if (!Number.isFinite(parsed)) return null;
  return Math.trunc(parsed);
}

function normalizeEmail(value: string): string {
  return value.trim().toLowerCase();
}

function hashPassword(password: string): string {
  const salt = randomBytes(16).toString("hex");
  const digest = scryptSync(password, salt, 64).toString("hex");
  return `${salt}:${digest}`;
}

function verifyPassword(password: string, hashed: string): boolean {
  const [salt, storedDigest] = hashed.split(":");
  if (!salt || !storedDigest) return false;

  const currentDigest = scryptSync(password, salt, 64).toString("hex");

  try {
    return timingSafeEqual(
      Buffer.from(storedDigest, "hex"),
      Buffer.from(currentDigest, "hex"),
    );
  } catch {
    return false;
  }
}

function getTierAlertLimit(tier: PlanTier): number {
  return TIER_ALERT_LIMIT[tier] ?? TIER_ALERT_LIMIT.FREE;
}

function computeTrialStatus(trialStartedAt: Date | null | undefined) {
  if (!trialStartedAt) {
    return { trialActive: true, trialDaysLeft: TRIAL_DAYS, trialExpiredAt: null as Date | null };
  }
  const expiredAt = new Date(trialStartedAt.getTime() + TRIAL_DAYS * 24 * 60 * 60 * 1000);
  const now = new Date();
  const trialActive = now < expiredAt;
  const trialDaysLeft = trialActive
    ? Math.ceil((expiredAt.getTime() - now.getTime()) / (24 * 60 * 60 * 1000))
    : 0;
  return { trialActive, trialDaysLeft, trialExpiredAt: expiredAt };
}

type DeviceWithPlan = {
  id: string;
  userId: string | null;
  trialStartedAt?: Date | null;
  user?: {
    planTier: PlanTier;
    promoCodeUsed: string | null;
    trialStartedAt: Date | null;
    subscription: SubscriptionLite | null;
  } | null;
};

/**
 * Limiti signala za jedan uredjaj/nalog.
 *
 * maxActive = broj signala koji istovremeno smeju da budu ukljuceni (plan).
 * maxTotal  = maxActive aktivnih + isto toliko sacuvanih "u rezervi" (pauzirani
 *             signali / nacrti). Pauziran signal NE zauzima aktivno mesto, pa
 *             korisnik moze da pauzira jedan i odmah napravi/ukljuci drugi, a
 *             prethodni ostaje sacuvan u bazi.
 */
function resolveAlertLimits(device: DeviceWithPlan): {
  maxActive: number;
  maxTotal: number;
} {
  const user = device.user ?? null;
  const planTier = (user?.planTier ?? "FREE") as PlanTier;
  const isDrugarskiActive = user?.promoCodeUsed === FREE_BRONZE_CODE;
  const trialStart = user?.trialStartedAt ?? device.trialStartedAt ?? null;
  const { trialActive } = computeTrialStatus(trialStart);
  const hasActiveSub = hasPaidAccess(user?.subscription ?? null);

  const maxActive = isDrugarskiActive
    ? 5
    : hasActiveSub
      ? getTierAlertLimit(planTier)
      : trialActive
        ? getTierAlertLimit("BRONZE")
        : 0;

  return { maxActive, maxTotal: maxActive * 2 };
}

/** Where filter koji hvata sve signale naloga (ili samo uredjaja ako nema naloga). */
function alertScopeWhere(device: { id: string; userId: string | null }) {
  return device.userId ? { device: { userId: device.userId } } : { deviceId: device.id };
}

async function countAlerts(device: { id: string; userId: string | null }): Promise<{
  total: number;
  active: number;
}> {
  const where = alertScopeWhere(device);
  const [total, active] = await Promise.all([
    prisma.alert.count({ where }),
    prisma.alert.count({ where: { ...where, isActive: true } }),
  ]);
  return { total, active };
}

async function freeUserDeviceSlot(
  userId: string,
  currentDeviceId: string,
): Promise<string | null> {
  const linkedDevices = await prisma.device.findMany({
    where: { userId },
    select: { id: true, lastSeenAt: true },
    orderBy: [{ lastSeenAt: "asc" }, { createdAt: "asc" }],
  });

  const alreadyLinked = linkedDevices.some((device) => device.id === currentDeviceId);
  if (alreadyLinked || linkedDevices.length < MAX_DEVICES_PER_USER) {
    return null;
  }

  const oldestDevice = linkedDevices[0];
  if (!oldestDevice) {
    return null;
  }

  await prisma.device.update({
    where: { id: oldestDevice.id },
    data: { userId: null },
  });

  return oldestDevice.id;
}

async function buildProfilePayload(deviceId: string) {
  const device = await prisma.device.findUnique({
    where: { id: deviceId },
    include: {
      user: {
        select: {
          id: true,
          firstName: true,
          lastName: true,
          email: true,
          emailVerified: true,
          planTier: true,
          promoCodeUsed: true,
          promoRedeemedAt: true,
          trialStartedAt: true,
          subscription: {
            select: {
              tier: true,
              status: true,
              productId: true,
              startedAt: true,
              renewsAt: true,
              pausedAt: true,
              cancelledAt: true,
            },
          },
        },
      },
    },
  });

  if (!device) return null;

  const user = (device.user as ProfileUserLite | null) ?? null;

  const planTier = (user?.planTier ?? "FREE") as PlanTier;
  const isDrugarskiActive = user?.promoCodeUsed === FREE_BRONZE_CODE;

  // Resolve trial start: prefer user-level (tied to email) over device-level
  const userTrialStartedAt = (device.user as { trialStartedAt?: Date | null } | null)?.trialStartedAt ?? null;
  const deviceTrialStartedAt = (device as { trialStartedAt?: Date | null }).trialStartedAt ?? null;
  const trialStartedAt = userTrialStartedAt ?? deviceTrialStartedAt;
  const { trialActive, trialDaysLeft, trialExpiredAt } = computeTrialStatus(trialStartedAt);

  const sub = ((device.user as { subscription?: SubscriptionLite | null } | null)?.subscription ?? null) as SubscriptionLite | null;
  const hasActiveSub = hasPaidAccess(sub);

  // Effective limit: drugarski > paid subscription > trial (Bronze-equivalent) > FREE (locked)
  const effectiveAlertLimit = isDrugarskiActive
    ? 5
    : hasActiveSub
      ? getTierAlertLimit(planTier)
      : trialActive
        ? getTierAlertLimit("BRONZE") // trial = 3 alerts (Bronze)
        : 0; // locked

  const isLocked = !trialActive && !isDrugarskiActive && !hasActiveSub;

  // signalCount = ukupno sacuvanih signala, activeSignalCount = ukljucenih.
  // Limit plana se odnosi na aktivne; isto toliko sme da stoji u rezervi
  // (pauzirani signali / nacrti).
  const { total: signalCount, active: activeSignalCount } = await countAlerts({
    id: device.id,
    userId: device.userId,
  });

  return {
    deviceId: device.id,
    user: user
      ? {
          id: user.id,
          firstName: user.firstName,
          lastName: user.lastName,
          email: user.email,
          emailVerified: user.emailVerified,
          planTier: user.planTier,
          promoCodeUsed: user.promoCodeUsed,
          promoRedeemedAt: user.promoRedeemedAt,
        }
      : null,
    planTier,
    alertLimit: effectiveAlertLimit,
    draftLimit: effectiveAlertLimit,
    totalAlertLimit: effectiveAlertLimit * 2,
    signalCount,
    activeSignalCount,
    pricingPlans: PRICING_PLANS,
    freeBronzeCode: FREE_BRONZE_CODE,
    trialActive,
    trialDaysLeft,
    trialExpiredAt: trialExpiredAt?.toISOString() ?? null,
    isLocked,
    subscription: sub
      ? {
          tier: sub.tier,
          status: sub.status,
          productId: sub.productId,
          startedAt: sub.startedAt.toISOString(),
          renewsAt: sub.renewsAt?.toISOString() ?? null,
          pausedAt: sub.pausedAt?.toISOString() ?? null,
        }
      : null,
  };
}

// POST /api/notifications/devices
export async function registerDevice(req: Request, res: Response) {
  const expoPushToken = getSingleString(req.body?.expoPushToken);
  const platform = req.body?.platform;
  const deviceId = getSingleString(req.body?.deviceId);
  const normalizedPlatform = normalizePlatform(platform);
  const firstName = getSingleString(req.body?.firstName);
  const lastName = getSingleString(req.body?.lastName);
  const email = getSingleString(req.body?.email);
  const password = getSingleString(req.body?.password);
  const googleIdToken = getSingleString(req.body?.googleIdToken);
  const hasAnyUserField = !!(firstName || lastName || email || password || googleIdToken);

  if (!expoPushToken || !normalizedPlatform) {
    return res
      .status(400)
      .json({ error: "Validni expoPushToken i platform su obavezni" });
  }

  // Tri nacina da se ova ruta pozove sa nalog-podacima: login (email+password),
  // registracija (ime+prezime+email+password), ili Google (googleIdToken sam).
  // Ime/prezime NISU obavezni ovde — provera ispod (kad se zna da li nalog vec
  // postoji) trazi ih samo ako se stvarno pravi nov nalog preko email/password puta,
  // da login ne bi morao da ih salje (i da ne bi slucajno prepisao postojece ime/
  // prezime praznim vrednostima, videti logiku ispod).
  if (hasAnyUserField && !googleIdToken && (!email || !password)) {
    return res.status(400).json({
      error: "Email i password su obavezni",
    });
  }

  if (password && password.length < 6) {
    return res.status(400).json({ error: "Password mora imati najmanje 6 karaktera" });
  }

  try {
    let resolvedUserId: string | null = null;
    let displacedDeviceId: string | null = null;

    if (googleIdToken) {
      let identity;
      try {
        identity = await verifyGoogleIdToken(googleIdToken);
      } catch (error) {
        console.error("[notification] Google token verification failed:", error);
        return res.status(401).json({ error: "Google prijava nije uspela. Pokusaj ponovo." });
      }

      const normalizedEmail = normalizeEmail(identity.email);
      const existingUser = await prisma.user.findFirst({
        where: { OR: [{ googleId: identity.googleId }, { email: normalizedEmail }] },
      });

      if (existingUser) {
        const updatedUser = existingUser.googleId
          ? existingUser
          : await prisma.user.update({
              where: { id: existingUser.id },
              data: { googleId: identity.googleId },
            });
        resolvedUserId = updatedUser.id;
      } else {
        const createdUser = await prisma.user.create({
          data: {
            firstName: identity.firstName || "Korisnik",
            lastName: identity.lastName || "",
            email: normalizedEmail,
            // Google korisnik nema lozinku — generise se nasumican, nikad korisniku
            // prikazan hash da polje ostane ne-null bez migracije passwordHash-a u
            // nullable. Nikad se ne koristi za login (googleId ima prioritet iznad).
            passwordHash: hashPassword(randomBytes(32).toString("hex")),
            googleId: identity.googleId,
            emailVerified: identity.emailVerified,
          },
        });
        resolvedUserId = createdUser.id;
      }
    } else if (hasAnyUserField && email && password) {
      const normalizedEmail = normalizeEmail(email);
      const existingUser = await prisma.user.findUnique({
        where: { email: normalizedEmail },
      });

      if (existingUser) {
        if (!verifyPassword(password, existingUser.passwordHash)) {
          return res.status(401).json({ error: "Pogresan email ili password" });
        }

        // LOGIN — ime/prezime menjamo samo ako su STVARNO poslati (npr. korisnik ih
        // je izmenio na "Korisnicki podaci" ekranu). Login ekran salje samo
        // email+password, pa ovde ne sme da prepise postojece ime/prezime praznim
        // vrednostima.
        const updateData: { firstName?: string; lastName?: string } = {};
        if (firstName) updateData.firstName = firstName;
        if (lastName) updateData.lastName = lastName;

        const updatedUser = Object.keys(updateData).length > 0
          ? await prisma.user.update({ where: { id: existingUser.id }, data: updateData })
          : existingUser;
        resolvedUserId = updatedUser.id;
      } else {
        // REGISTRACIJA — nov nalog stvarno zahteva ime i prezime.
        if (!firstName || !lastName) {
          return res.status(400).json({
            error: "Nalog sa ovim emailom ne postoji. Za registraciju su potrebni ime i prezime.",
          });
        }

        const emailVerifyToken = randomBytes(32).toString("hex");
        const createdUser = await prisma.user.create({
          data: {
            firstName,
            lastName,
            email: normalizedEmail,
            passwordHash: hashPassword(password),
            emailVerifyToken,
            emailVerifyTokenExpiresAt: new Date(Date.now() + 7 * 24 * 60 * 60 * 1000),
          },
        });
        resolvedUserId = createdUser.id;

        // Ne cekamo slanje mail-a — ako Gmail spori ili padne, registracija
        // naloga ne sme da se zaglavi/pukne zbog toga.
        void sendVerificationEmail({
          to: normalizedEmail,
          firstName,
          token: emailVerifyToken,
        });
      }
    }

    let device = null as Awaited<ReturnType<typeof prisma.device.create>> | null;

    if (deviceId) {
      const existingById = await prisma.device.findUnique({ where: { id: deviceId } });
      if (existingById) {
        device = await prisma.device.update({
          where: { id: deviceId },
          data: {
            expoPushToken,
            platform: normalizedPlatform,
            lastSeenAt: new Date(),
          },
        });
      }
    }

    if (!device) {
      const existingByToken = await prisma.device.findUnique({ where: { expoPushToken } });
      if (existingByToken) {
        device = await prisma.device.update({
          where: { id: existingByToken.id },
          data: {
            platform: normalizedPlatform,
            lastSeenAt: new Date(),
          },
        });
      }
    }

    if (!device) {
      device = await prisma.device.create({
        data: {
          expoPushToken,
          platform: normalizedPlatform,
          trialStartedAt: new Date(),
        },
      });
    }

    if (resolvedUserId && device) {
      displacedDeviceId = await freeUserDeviceSlot(resolvedUserId, device.id);

      if (device.userId !== resolvedUserId) {
        device = await prisma.device.update({
          where: { id: device.id },
          data: {
            userId: resolvedUserId,
            lastSeenAt: new Date(),
          },
        });
      }
    }

    const profile = await buildProfilePayload(device.id);
    return res.status(200).json({
      ...device,
      displacedDeviceId,
      maxDevicesPerUser: MAX_DEVICES_PER_USER,
      profile,
    });
  } catch (error) {
    const message = error instanceof Error ? error.message : "Nepoznata greska";
    console.error("[notification] registerDevice error:", message);
    return res.status(500).json({ error: "Greska pri registraciji uredjaja" });
  }
}

// POST /api/notifications/alerts
export async function createAlert(req: Request, res: Response) {
  const deviceId = getSingleString(req.body?.deviceId);
  const category = getSingleString(req.body?.category);
  const rawKeywords = Array.isArray(req.body?.keywords) ? req.body.keywords : [];
  const keywords = rawKeywords.filter(
    (keyword: unknown): keyword is string =>
      typeof keyword === "string" && keyword.trim().length > 0,
  );
  const rawPriceMax = Number(req.body?.priceMax);
  const priceMax = Number.isFinite(rawPriceMax) ? Math.round(rawPriceMax) : null;
  const locationText = getSingleString(req.body?.locationText) ?? "";
  const propertyTypeInput = getSingleString(req.body?.propertyType)?.toUpperCase() ?? null;
  const yearFrom = getOptionalInt(req.body?.yearFrom);
  const yearTo = getOptionalInt(req.body?.yearTo);
  const kmFrom = getOptionalInt(req.body?.kmFrom);
  const kmTo = getOptionalInt(req.body?.kmTo);

  const normalizedCategory = category?.toUpperCase() ?? null;
  const isAllCategory = normalizedCategory === "SVE";

  const allowedPropertyTypes = new Set(["STAN", "LOKAL", "PARCELA"]);
  const propertyType = propertyTypeInput && allowedPropertyTypes.has(propertyTypeInput)
    ? propertyTypeInput
    : null;

  if (!deviceId || !normalizedCategory) {
    return res
      .status(400)
      .json({ error: "deviceId i category su obavezni" });
  }

  if (!isAllCategory && (!priceMax || priceMax <= 0)) {
    return res.status(400).json({ error: "priceMax je obavezan i mora biti veci od 0" });
  }

  if (isAllCategory && keywords.length === 0) {
    return res.status(400).json({ error: "Za kategoriju SVE potrebno je uneti kljucne reci" });
  }

  if (normalizedCategory === "NEKRETNINE" && !propertyType) {
    return res.status(400).json({
      error: "Za nekretnine je obavezno izabrati tip: stan, lokal ili parcela/zemljiste",
    });
  }

  if (yearFrom !== null && yearTo !== null && yearFrom > yearTo) {
    return res.status(400).json({ error: "Godiste od ne moze biti vece od godista do" });
  }

  if (kmFrom !== null && kmTo !== null && kmFrom > kmTo) {
    return res.status(400).json({ error: "Kilometraza od ne moze biti veca od kilometraze do" });
  }

  const device = await prisma.device.findUnique({
    where: { id: deviceId },
    select: {
      id: true,
      userId: true,
      trialStartedAt: true,
      user: {
        select: {
          planTier: true,
          promoCodeUsed: true,
          trialStartedAt: true,
          subscription: {
            select: {
              tier: true,
              status: true,
              productId: true,
              startedAt: true,
              renewsAt: true,
              pausedAt: true,
              cancelledAt: true,
            },
          },
        },
      },
    },
  });

  if (!device) {
    return res.status(404).json({ error: "Uredjaj nije pronadjen" });
  }

  const { maxActive, maxTotal } = resolveAlertLimits(device as DeviceWithPlan);

  if (maxActive === 0) {
    return res.status(403).json({
      error: "Probni period je istekao. Kupi plan ili unesi promo kod.",
    });
  }

  // Signal se po defaultu pravi aktivan; klijent moze da posalje isActive:false
  // da bi ga sacuvao kao nacrt (rezervu) i kad su sva aktivna mesta zauzeta.
  const wantsActive = req.body?.isActive !== false;
  const { total: alertCount, active: activeCount } = await countAlerts(device);

  if (alertCount >= maxTotal) {
    return res.status(400).json({
      error: `Dostignut maksimalan broj signala (${maxActive} aktivnih + ${maxActive} u rezervi) za tvoj plan.`,
    });
  }

  if (wantsActive && activeCount >= maxActive) {
    return res.status(400).json({
      error: `Dostignut limit aktivnih signala (${maxActive}). Pauziraj neki postojeci signal ili sacuvaj ovaj kao nacrt.`,
    });
  }

  const alert = await prisma.alert.create({
    data: {
      deviceId,
      category: normalizedCategory,
      keywords: keywords ?? [],
      priceMax: isAllCategory ? 0 : (priceMax as number),
      locationText: locationText ?? "",
      propertyType: normalizedCategory === "NEKRETNINE" ? propertyType : null,
      yearFrom,
      yearTo,
      kmFrom,
      kmTo,
      isActive: wantsActive,
    },
  });

  res.status(201).json(alert);

  backfillMatchForAlert(alert.id).catch((error) => {
    console.error("[notification] Backfill match failed for alert", alert.id, error);
  });

  return;
}

// GET /api/notifications/alerts/:deviceId
export async function getAlerts(req: Request, res: Response) {
  const deviceId = getSingleString(req.params.deviceId);

  if (!deviceId) {
    return res.status(400).json({ error: "deviceId je obavezan" });
  }

  const device = await prisma.device.findUnique({
    where: { id: deviceId },
    select: { id: true, userId: true },
  });

  if (!device) {
    return res.status(404).json({ error: "Uredjaj nije pronadjen" });
  }

  const alerts = await prisma.alert.findMany({
    where: device.userId
      ? {
          device: {
            userId: device.userId,
          },
        }
      : { deviceId },
    orderBy: { createdAt: "desc" },
  });

  return res.status(200).json(alerts);
}

// PATCH /api/notifications/alerts/:id
// Izmena postojeceg signala. Namerno NE dira isActive (pauziran signal ostaje
// pauziran posle izmene) i NE proverava limit plana - broj signala se izmenom
// ne menja, pa korisnik moze da izmeni signal i kad je na maksimumu.
export async function updateAlert(req: Request, res: Response) {
  const id = getSingleString(req.params.id);

  if (!id) {
    return res.status(400).json({ error: "Alert ID je obavezan" });
  }

  const existing = await prisma.alert.findUnique({
    where: { id },
    include: { device: { select: { id: true, userId: true } } },
  });

  if (!existing) {
    return res.status(404).json({ error: "Signal nije pronadjen" });
  }

  // Provera vlasnistva: klijent salje deviceId sa kojeg menja signal. Signal
  // sme da menja isti uredjaj ili bilo koji uredjaj povezan sa istim nalogom
  // (isti princip kao getAlerts, koji vraca signale po nalogu).
  const requestDeviceId = getSingleString(req.body?.deviceId);
  if (requestDeviceId && requestDeviceId !== existing.deviceId) {
    const requestDevice = await prisma.device.findUnique({
      where: { id: requestDeviceId },
      select: { id: true, userId: true },
    });

    const sameUser =
      !!requestDevice?.userId && requestDevice.userId === existing.device.userId;

    if (!sameUser) {
      return res.status(403).json({ error: "Signal ne pripada ovom uredjaju" });
    }
  }

  // Polja koja klijent nije poslao zadrzavaju postojecu vrednost.
  const hasField = (key: string) =>
    Object.prototype.hasOwnProperty.call(req.body ?? {}, key) &&
    (req.body as Record<string, unknown>)[key] !== undefined;

  const categoryInput = getSingleString(req.body?.category)?.toUpperCase() ?? null;
  const normalizedCategory = categoryInput ?? existing.category;
  const isAllCategory = normalizedCategory === "SVE";

  const rawKeywords = Array.isArray(req.body?.keywords) ? req.body.keywords : null;
  const keywords = rawKeywords
    ? rawKeywords.filter(
        (keyword: unknown): keyword is string =>
          typeof keyword === "string" && keyword.trim().length > 0,
      )
    : existing.keywords;

  let priceMax: number | null = existing.priceMax;
  if (hasField("priceMax")) {
    const rawPriceMax = Number(req.body?.priceMax);
    priceMax = Number.isFinite(rawPriceMax) ? Math.round(rawPriceMax) : null;
  }

  const locationText = hasField("locationText")
    ? getSingleString(req.body?.locationText) ?? ""
    : existing.locationText;

  const allowedPropertyTypes = new Set(["STAN", "LOKAL", "PARCELA"]);
  let propertyType: string | null = existing.propertyType;
  if (hasField("propertyType")) {
    const propertyTypeInput = getSingleString(req.body?.propertyType)?.toUpperCase() ?? null;
    propertyType =
      propertyTypeInput && allowedPropertyTypes.has(propertyTypeInput)
        ? propertyTypeInput
        : null;
  }

  const yearFrom = hasField("yearFrom") ? getOptionalInt(req.body?.yearFrom) : existing.yearFrom;
  const yearTo = hasField("yearTo") ? getOptionalInt(req.body?.yearTo) : existing.yearTo;
  const kmFrom = hasField("kmFrom") ? getOptionalInt(req.body?.kmFrom) : existing.kmFrom;
  const kmTo = hasField("kmTo") ? getOptionalInt(req.body?.kmTo) : existing.kmTo;

  // Ista pravila validacije kao kod kreiranja signala.
  if (!isAllCategory && (!priceMax || priceMax <= 0)) {
    return res.status(400).json({ error: "priceMax je obavezan i mora biti veci od 0" });
  }

  if (isAllCategory && keywords.length === 0) {
    return res.status(400).json({ error: "Za kategoriju SVE potrebno je uneti kljucne reci" });
  }

  if (normalizedCategory === "NEKRETNINE" && !propertyType) {
    return res.status(400).json({
      error: "Za nekretnine je obavezno izabrati tip: stan, lokal ili parcela/zemljiste",
    });
  }

  if (yearFrom !== null && yearTo !== null && yearFrom > yearTo) {
    return res.status(400).json({ error: "Godiste od ne moze biti vece od godista do" });
  }

  if (kmFrom !== null && kmTo !== null && kmFrom > kmTo) {
    return res.status(400).json({ error: "Kilometraza od ne moze biti veca od kilometraze do" });
  }

  const updated = await prisma.alert.update({
    where: { id },
    data: {
      category: normalizedCategory,
      keywords,
      priceMax: isAllCategory ? 0 : (priceMax as number),
      locationText: locationText ?? "",
      propertyType: normalizedCategory === "NEKRETNINE" ? propertyType : null,
      yearFrom,
      yearTo,
      kmFrom,
      kmTo,
    },
  });

  res.status(200).json(updated);

  // Novi kriterijumi -> ponovo prodji kroz vec skinute oglase (NotificationLog
  // ima unique(alertId, listingId), pa nema duplih notifikacija).
  backfillMatchForAlert(updated.id).catch((error) => {
    console.error("[notification] Backfill match failed for alert", updated.id, error);
  });

  return;
}

// PATCH /api/notifications/alerts/:id/toggle
export async function toggleAlert(req: Request, res: Response) {
  const id = getSingleString(req.params.id);

  if (!id) {
    return res.status(400).json({ error: "Alert ID je obavezan" });
  }

  const alert = await prisma.alert.findUnique({
    where: { id },
    include: {
      device: {
        select: {
          id: true,
          userId: true,
          trialStartedAt: true,
          user: {
            select: {
              planTier: true,
              promoCodeUsed: true,
              trialStartedAt: true,
              subscription: {
                select: {
                  tier: true,
                  status: true,
                  productId: true,
                  startedAt: true,
                  renewsAt: true,
                  pausedAt: true,
                  cancelledAt: true,
                },
              },
            },
          },
        },
      },
    },
  });
  if (!alert) return res.status(404).json({ error: "Alert nije pronadjen" });

  // Pauziranje je uvek dozvoljeno. Ukljucivanje sme samo ako ima slobodnog
  // aktivnog mesta - inace bi korisnik mogao da zaobidje limit plana tako sto
  // napravi signale kao nacrte pa ih sve ukljuci.
  if (!alert.isActive) {
    const { maxActive } = resolveAlertLimits(alert.device as DeviceWithPlan);

    if (maxActive === 0) {
      return res.status(403).json({
        error: "Probni period je istekao. Kupi plan ili unesi promo kod.",
      });
    }

    const { active } = await countAlerts(alert.device);
    if (active >= maxActive) {
      return res.status(400).json({
        error: `Dostignut limit aktivnih signala (${maxActive}). Pauziraj drugi signal pa ukljuci ovaj.`,
      });
    }
  }

  const updated = await prisma.alert.update({
    where: { id },
    data: { isActive: !alert.isActive },
  });

  return res.status(200).json(updated);
}

// DELETE /api/notifications/alerts/:id
export async function deleteAlert(req: Request, res: Response) {
  const id = getSingleString(req.params.id);

  if (!id) {
    return res.status(400).json({ error: "Alert ID je obavezan" });
  }

  await prisma.alert.delete({ where: { id } });

  return res.status(200).json({ ok: true });
}

// POST /api/notifications/test
export async function sendTestNotification(req: Request, res: Response) {
  const deviceId = getSingleString(req.body?.deviceId);
  let createdNotificationId: string | null = null;

  if (!deviceId) {
    return res.status(400).json({ error: "deviceId je obavezan" });
  }

  const device = await prisma.device.findUnique({
    where: { id: deviceId },
  });

  if (!device) {
    return res.status(404).json({ error: "Uredjaj nije pronadjen" });
  }

  try {
    const notification = await prisma.notification.create({
      data: {
        deviceId,
        title: "Test notifikacija",
        body: "Push notifikacije rade i u background-u.",
        data: { url: "https://www.kupujemprodajem.com/" },
        status: "PENDING",
      },
    });
    createdNotificationId = notification.id;

    await sendExpoPushNotification({
      to: device.expoPushToken,
      title: notification.title,
      body: notification.body,
      data: {
        url: "https://www.kupujemprodajem.com/",
        notificationId: notification.id,
      },
    });

    const sentNotification = await prisma.notification.update({
      where: { id: notification.id },
      data: {
        status: "SENT",
        sentAt: new Date(),
        failedAt: null,
        lastError: null,
      },
    });

    console.log("[notification] Test notification sent for device:", deviceId);

    return res.status(200).json({
      ok: true,
      message: "Test notifikacija poslata",
      notification: sentNotification,
    });
  } catch (error) {
    const message = error instanceof Error ? error.message : "Nepoznata greska";
    console.error("[notification] Test notification error:", message);

    if (createdNotificationId) {
      await prisma.notification.update({
        where: { id: createdNotificationId },
        data: {
          status: "FAILED",
          retries: { increment: 1 },
          failedAt: new Date(),
          lastError: message,
        },
      });
    }

    return res.status(500).json({ error: message });
  }
}

// GET /api/notifications/pending/:deviceId
export async function getPendingNotifications(req: Request, res: Response) {
  const deviceId = getSingleString(req.params.deviceId);

  if (!deviceId) {
    return res.status(400).json({ error: "deviceId je obavezan" });
  }

  try {
    const device = await prisma.device.findUnique({
      where: { id: deviceId },
      select: { id: true },
    });

    if (!device) {
      return res.status(404).json({ error: "Uredjaj nije pronadjen" });
    }

    const notifications = await prisma.notification.findMany({
      where: {
        deviceId,
        status: {
          in: ["PENDING", "SENT"],
        },
      },
      orderBy: { createdAt: "desc" },
      take: 50,
    });

    console.log(
      `[notification] Retrieved ${notifications.length} pending notifications for device:`,
      deviceId,
    );

    return res.status(200).json(notifications);
  } catch (error) {
    const message = error instanceof Error ? error.message : "Nepoznata greska";
    console.error("[notification] Error getting pending notifications:", message);
    return res.status(500).json({ error: message });
  }
}

// PATCH /api/notifications/:id/seen
export async function markNotificationAsSeen(req: Request, res: Response) {
  const id = getSingleString(req.params.id);

  if (!id) {
    return res.status(400).json({ error: "Notification ID je obavezan" });
  }

  try {
    const updated = await prisma.notification.update({
      where: { id },
      data: {
        status: "SEEN",
        seenAt: new Date(),
      },
    });

    console.log("[notification] Marked as seen:", id);

    return res.status(200).json(updated);
  } catch (error) {
    const message = error instanceof Error ? error.message : "Nepoznata greska";
    console.error("[notification] Error marking as seen:", message);
    return res.status(500).json({ error: message });
  }
}

// GET /api/notifications/profile/:deviceId
export async function getProfile(req: Request, res: Response) {
  const deviceId = getSingleString(req.params.deviceId);
  if (!deviceId) {
    return res.status(400).json({ error: "deviceId je obavezan" });
  }

  const profile = await buildProfilePayload(deviceId);
  if (!profile) {
    return res.status(404).json({ error: "Uredjaj nije pronadjen" });
  }

  return res.status(200).json(profile);
}

// PATCH /api/notifications/profile/:deviceId
export async function updateProfile(req: Request, res: Response) {
  const deviceId = getSingleString(req.params.deviceId);
  const firstName = getSingleString(req.body?.firstName);
  const lastName = getSingleString(req.body?.lastName);
  const email = getSingleString(req.body?.email);
  const password = getSingleString(req.body?.password);

  if (!deviceId) {
    return res.status(400).json({ error: "deviceId je obavezan" });
  }

  if (password && password.length < 6) {
    return res.status(400).json({ error: "Password mora imati najmanje 6 karaktera" });
  }

  const device = await prisma.device.findUnique({
    where: { id: deviceId },
    select: {
      id: true,
      userId: true,
      trialStartedAt: true,
      user: true,
    },
  });

  if (!device) {
    return res.status(404).json({ error: "Uredjaj nije pronadjen" });
  }

  let userId = device.userId;

  if (!device.userId) {
    if (!firstName || !lastName || !email || !password) {
      return res.status(400).json({
        error: "Za kreiranje profila potrebni su ime, prezime, email i password",
      });
    }

    const normalizedEmail = normalizeEmail(email);
    const existing = await prisma.user.findUnique({ where: { email: normalizedEmail } });
    if (existing) {
      if (!verifyPassword(password, existing.passwordHash)) {
        return res.status(401).json({ error: "Pogresan email ili password" });
      }

      const linked = await prisma.device.update({
        where: { id: deviceId },
        data: { userId: existing.id },
      });
      userId = linked.userId;
    } else {
      // New user: inherit the device's trialStartedAt so reinstall doesn't reset trial
      const created = await prisma.user.create({
        data: {
          firstName,
          lastName,
          email: normalizedEmail,
          passwordHash: hashPassword(password),
          trialStartedAt: ((device as { trialStartedAt?: Date | null }).trialStartedAt ?? new Date()),
        },
      });
      const linked = await prisma.device.update({
        where: { id: deviceId },
        data: { userId: created.id },
      });
      userId = linked.userId;
    }
  } else {
    const data: {
      firstName?: string;
      lastName?: string;
      email?: string;
      passwordHash?: string;
    } = {};

    if (firstName) data.firstName = firstName;
    if (lastName) data.lastName = lastName;
    if (email) data.email = normalizeEmail(email);
    if (password) data.passwordHash = hashPassword(password);

    if (Object.keys(data).length > 0) {
      if (data.email) {
        const emailOwner = await prisma.user.findUnique({ where: { email: data.email } });
        if (emailOwner && emailOwner.id !== device.userId) {
          return res.status(409).json({ error: "Email je vec zauzet" });
        }
      }

      await prisma.user.update({ where: { id: device.userId }, data });
    }
  }

  if (!userId) {
    return res.status(500).json({ error: "Profil nije moguce povezati sa uredjajem" });
  }

  const profile = await buildProfilePayload(deviceId);
  return res.status(200).json(profile);
}

// POST /api/notifications/promo/redeem
export async function redeemPromoCode(req: Request, res: Response) {
  const deviceId = getSingleString(req.body?.deviceId);
  const code = getSingleString(req.body?.code);

  if (!deviceId || !code) {
    return res.status(400).json({ error: "deviceId i code su obavezni" });
  }

  const device = await prisma.device.findUnique({
    where: { id: deviceId },
    include: { user: true },
  });

  if (!device) {
    return res.status(404).json({ error: "Uredjaj nije pronadjen" });
  }

  if (!device.userId) {
    return res.status(400).json({ error: "Prvo sacuvaj korisnicki profil" });
  }

  if (code.trim().toUpperCase() !== FREE_BRONZE_CODE) {
    return res.status(400).json({ error: "Promo kod nije validan" });
  }

  await prisma.user.update({
    where: { id: device.userId },
    data: {
      planTier: "FREE",
      promoCodeUsed: FREE_BRONZE_CODE,
      promoRedeemedAt: new Date(),
    },
  });

  const profile = await buildProfilePayload(deviceId);
  return res.status(200).json(profile);
}

// POST /api/notifications/promo/cancel
export async function cancelPromoCode(req: Request, res: Response) {
  const deviceId = getSingleString(req.body?.deviceId);

  if (!deviceId) {
    return res.status(400).json({ error: "deviceId je obavezan" });
  }

  const device = await prisma.device.findUnique({
    where: { id: deviceId },
    include: { user: true },
  });

  if (!device) {
    return res.status(404).json({ error: "Uredjaj nije pronadjen" });
  }

  if (!device.userId) {
    return res.status(400).json({ error: "Nalog nije povezan sa uredjajem" });
  }

  await prisma.user.update({
    where: { id: device.userId },
    data: {
      promoCodeUsed: null,
      promoRedeemedAt: null,
    },
  });

  const profile = await buildProfilePayload(deviceId);
  return res.status(200).json(profile);
}

// GET /api/notifications/verify-email?token=...
// Korisnik klikne link iz mail-a — ne zahteva deviceId/auth, token je dovoljan
// dokaz da je link stigao na tu email adresu.
export async function verifyEmail(req: Request, res: Response) {
  const token = getSingleString(req.query.token);

  if (!token) {
    return res.status(400).send("Nedostaje token za verifikaciju.");
  }

  const user = await prisma.user.findUnique({ where: { emailVerifyToken: token } });

  if (!user) {
    return res.status(400).send("Link za verifikaciju nije validan ili je vec iskoriscen.");
  }

  if (user.emailVerifyTokenExpiresAt && user.emailVerifyTokenExpiresAt.getTime() < Date.now()) {
    return res.status(400).send("Link za verifikaciju je istekao. Zatrazi novi iz aplikacije.");
  }

  await prisma.user.update({
    where: { id: user.id },
    data: {
      emailVerified: true,
      emailVerifyToken: null,
      emailVerifyTokenExpiresAt: null,
    },
  });

  return res
    .status(200)
    .send("Email adresa je uspesno potvrdjena. Mozes da se vratis u aplikaciju.");
}
