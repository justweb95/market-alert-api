/**
 * Podela Srbije na 6 regiona + spisak opstina/gradova po regionu.
 *
 * Koristi se da se lokacija oglasa (grad iz scrape-ovanog oglasa) prevede u
 * region koji je korisnik cekirao na mapi. Prazan izbor regiona = cela Srbija.
 *
 * Izvor podele opstina po okruzima: Wikipedia "Municipalities and cities of
 * Serbia" (okruzi su grupisani u regione po zvanicnoj statistickoj podeli,
 * s tim da su Juzna i Istocna Srbija razdvojene u dva regiona).
 *
 * GENERISANO AUTOMATSKI - ne menjati rucno.
 */
export const REGION_CODES = ["BEOGRAD", "VOJVODINA", "ZAPADNA", "ISTOCNA", "JUZNA", "KOSOVO"];
export const REGION_LABELS = {
    BEOGRAD: "Beograd",
    VOJVODINA: "Vojvodina",
    ZAPADNA: "Sumadija i Zapadna Srbija",
    ISTOCNA: "Istocna Srbija",
    JUZNA: "Juzna Srbija",
    KOSOVO: "Kosovo i Metohija",
};
/** Gradovi/opstine po regionu (bez dijakritike, mala slova - vec normalizovano). */
export const REGION_CITIES = {
    BEOGRAD: [
        "barajevo", "batajnica", "belgrade", "beograd", "borca", "cukarica", "grocka", "krnjaca",
        "lazarevac", "mladenovac", "novi beograd", "obrenovac", "ostruznica", "padinska skela",
        "palilula", "rakovica", "ripanj", "savski venac", "sopot", "stari grad", "surcin", "umka",
        "vozdovac", "vracar", "zeleznik", "zemun", "zvezdara",
    ],
    VOJVODINA: [
        "ada", "alibunar", "apatin", "bac", "backa palanka", "backa topola", "backi petrovac",
        "banatsko novo selo", "becej", "bela crkva", "beocin", "coka", "futog", "indjija", "irig",
        "kac", "kanjiza", "kikinda", "kovacica", "kovin", "kula", "mali idjos", "nova crnja",
        "novi becej", "novi knezevac", "novi sad", "novi slankamen", "odzaci", "opovo", "pancevo",
        "pecinci", "petrovaradin", "plandiste", "ruma", "rumenka", "secanj", "senta", "sid",
        "sombor", "srbobran", "sremska mitrovica", "sremski karlovci", "stara pazova",
        "stepanovicevo", "subotica", "temerin", "titel", "veternik", "vrbas", "vrsac", "zabalj",
        "zitiste", "zrenjanin",
    ],
    ZAPADNA: [
        "aleksandrovac", "arandjelovac", "arilje", "bajina basta", "batocina", "bogatic", "brus",
        "cacak", "cajetina", "cicevac", "cuprija", "despotovac", "gornji milanovac", "guca",
        "ivanjica", "jagodina", "knic", "koceljeva", "kosjeric", "kragujevac", "kraljevo",
        "krupanj", "krusevac", "lajkovac", "lapovo", "ljig", "ljubovija", "loznica", "lucani",
        "mali zvornik", "mataruska banja", "mionica", "nova varos", "novi pazar", "osecina",
        "paracin", "pozega", "priboj", "prijepolje", "raca", "raska", "rekovac", "sabac",
        "sirogojno", "sjenica", "svilajnac", "topola", "trstenik", "tutin", "ub", "uzice",
        "valjevo", "varvarin", "vladimirci", "vrnjacka banja", "zlatibor",
    ],
    ISTOCNA: [
        "aleksinac", "babusnica", "bela palanka", "boljevac", "bor", "brza palanka", "dimitrovgrad",
        "doljevac", "donji milanovac", "gadzin han", "golubac", "kladovo", "knjazevac", "kucevo",
        "majdanpek", "malo crnice", "merosina", "negotin", "nis", "niska banja",
        "petrovac na mlavi", "pirot", "pozarevac", "razanj", "smederevo", "smederevska palanka",
        "sokobanja", "svrljig", "velika plana", "veliko gradiste", "zabari", "zagubica", "zajecar",
    ],
    JUZNA: [
        "blace", "bojnik", "bosilegrad", "bujanovac", "crna trava", "grdelica", "kursumlija",
        "lebane", "leskovac", "medvedja", "presevo", "prokuplje", "prolom banja", "surdulica",
        "trgoviste", "vladicin han", "vlasotince", "vranje", "vranjska banja", "zitoradja",
    ],
    KOSOVO: [
        "decani", "djakovica", "dragas", "glogovac", "gnjilane", "gracanica", "istok", "kacanik",
        "klina", "klokot", "kosovo polje", "kosovska kamenica", "kosovska mitrovica", "leposavic",
        "lipljan", "malisevo", "mamusa", "mitrovica", "novo brdo", "obilic", "orahovac", "partes",
        "pec", "podujevo", "pristina", "prizren", "ranilug", "srbica", "stimlje", "strpce",
        "suva reka", "urosevac", "vitina", "vucitrn", "zubin potok", "zvecan",
    ],
};
//# sourceMappingURL=regions.js.map