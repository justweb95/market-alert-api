import { OAuth2Client } from "google-auth-library";

// Web Client ID iz Google Cloud Console (OAuth consent screen) — koristi se i kao
// "audience" pri verifikaciji ID tokena. Mobilna app koristi @react-native-google-signin
// koji, iako je login sa Android uredjaja, i dalje trazi ID token izdat za Web klijenta
// (standardni obrazac te biblioteke — Android OAuth klijent u Google Cloud-u postoji
// samo da Google prepozna app+SHA1 potpis kombinaciju, sam token nosi Web client ID kao
// audience).
const GOOGLE_WEB_CLIENT_ID = process.env.GOOGLE_WEB_CLIENT_ID;

let client: OAuth2Client | null = null;
function getClient(): OAuth2Client {
  if (!client) {
    client = new OAuth2Client(GOOGLE_WEB_CLIENT_ID);
  }
  return client;
}

export type GoogleIdentity = {
  googleId: string;
  email: string;
  emailVerified: boolean;
  firstName: string;
  lastName: string;
};

/**
 * Verifikuje Google ID token (JWT potpisan od strane Google-a) i vraca proverene
 * podatke o korisniku. Baca gresku ako token nije validan/istekao/pogresan audience —
 * poziv NIKAD ne sme da nastavi kao da je korisnik autentifikovan bez ovoga.
 */
export async function verifyGoogleIdToken(idToken: string): Promise<GoogleIdentity> {
  if (!GOOGLE_WEB_CLIENT_ID) {
    throw new Error("GOOGLE_WEB_CLIENT_ID nije podesen na serveru");
  }

  const ticket = await getClient().verifyIdToken({
    idToken,
    audience: GOOGLE_WEB_CLIENT_ID,
  });

  const payload = ticket.getPayload();
  if (!payload || !payload.sub || !payload.email) {
    throw new Error("Google token ne sadrzi ocekivane podatke");
  }

  return {
    googleId: payload.sub,
    email: payload.email,
    emailVerified: payload.email_verified ?? false,
    firstName: payload.given_name ?? "",
    lastName: payload.family_name ?? "",
  };
}
