import nodemailer from "nodemailer";
// Koristi isti Gmail nalog/App Password kao kontakt forma na landing-u
// (CONTACT_GMAIL_USER/CONTACT_GMAIL_APP_PASSWORD) — jedan mail nalog za oba
// svrhe, bez novog eksternog servisa.
let transporter = null;
function getTransporter() {
    const user = process.env.CONTACT_GMAIL_USER;
    const pass = process.env.CONTACT_GMAIL_APP_PASSWORD;
    if (!user || !pass)
        return null;
    if (!transporter) {
        transporter = nodemailer.createTransport({
            service: "gmail",
            auth: { user, pass },
        });
    }
    return transporter;
}
export async function sendVerificationEmail(params) {
    const t = getTransporter();
    if (!t) {
        console.warn("[email] CONTACT_GMAIL_USER/CONTACT_GMAIL_APP_PASSWORD nisu podeseni — verifikacioni email nije poslat");
        return;
    }
    const baseUrl = process.env.PUBLIC_APP_URL ?? "https://api.lovacnaoglase.rs";
    const verifyUrl = `${baseUrl}/api/notifications/verify-email?token=${encodeURIComponent(params.token)}`;
    try {
        await t.sendMail({
            from: `"Lovac na Oglase" <${process.env.CONTACT_GMAIL_USER}>`,
            to: params.to,
            subject: "Potvrdi svoju email adresu — Lovac na Oglase",
            text: `Zdravo ${params.firstName},\n\nPotvrdi svoju email adresu klikom na link ispod:\n${verifyUrl}\n\nAko nisi ti napravio ovaj nalog, slobodno ignorisi ovaj email.\n\nLovac na Oglase`,
            html: `<p>Zdravo ${params.firstName},</p><p>Potvrdi svoju email adresu klikom na dugme ispod:</p><p><a href="${verifyUrl}" style="background:#D7F20D;color:#0D1117;padding:12px 24px;border-radius:24px;text-decoration:none;font-weight:bold;display:inline-block;">Potvrdi email</a></p><p>Ili kopiraj link: ${verifyUrl}</p><p>Ako nisi ti napravio ovaj nalog, slobodno ignorisi ovaj email.</p><p>Lovac na Oglase</p>`,
        });
    }
    catch (error) {
        // Slanje maila nikad ne sme da obori registraciju naloga — samo logujemo.
        console.error("[email] Slanje verifikacionog mail-a nije uspelo:", error);
    }
}
//# sourceMappingURL=email.service.js.map