/**
 * Normalizacija teksta za pretragu/uparivanje oglasa.
 *
 * Cilj: korisnik dobija iste rezultate bez obzira da li kuca cirilicom ili
 * latinicom, sa ili bez dijakritike. "Чачак", "Cacak" i "Čačak" se svode na
 * isti oblik ("cacak"), pa se oglas i signal poklapaju u svim kombinacijama.
 */
/** Cirilica -> latinica + latinicna slova koja NFD ne rastavlja (dj/dz). */
const CHAR_MAP = {
    // cirilica (mala slova - ulaz se prvo prevodi u mala)
    а: "a", б: "b", в: "v", г: "g", д: "d", ђ: "dj", е: "e", ж: "z", з: "z",
    и: "i", ј: "j", к: "k", л: "l", љ: "lj", м: "m", н: "n", њ: "nj", о: "o",
    п: "p", р: "r", с: "s", т: "t", ћ: "c", у: "u", ф: "f", х: "h", ц: "c",
    ч: "c", џ: "dz", ш: "s",
    // ruska/makedonska slova koja se povremeno pojave u oglasima
    й: "j", ы: "i", э: "e", ю: "ju", я: "ja", щ: "sc", ъ: "", ь: "", ё: "e",
    ѓ: "dj", ќ: "c", ѕ: "dz", і: "i",
    // latinica: NFD razlaze c/s/z sa kvacicom, ali "đ" je zasebno slovo
    đ: "dj",
};
/**
 * Mala slova -> transliteracija -> uklanjanje dijakritike.
 * Interpunkcija i razmaci se NE diraju (pozivaoci sami dele tekst na reci).
 */
export function normalizeSearchText(value) {
    const lowered = String(value ?? "").toLowerCase();
    let transliterated = "";
    for (const char of lowered) {
        transliterated += CHAR_MAP[char] ?? char;
    }
    return transliterated
        .normalize("NFD")
        .replace(/[\u0300-\u036f]/g, "")
        .trim();
}
/**
 * Dodatno "labavo" svodjenje - samo za poredjenje KLJUCNIH RECI.
 *
 * Cirilica strana imena pise fonetski ("Октавија", "Цивик"), a oglasi ih pisu
 * u originalu ("Octavia", "Civic"). Cista transliteracija tu ne pomaze, pa se
 * obe strane svode na grublji oblik u kojem su c/k, w/v, y/i, x/ks i "ij"/"i"
 * izjednaceni.
 *
 * NAMERNO se ne koristi za prepoznavanje kategorije/goriva/karoserije - tamo
 * bi "cross" postalo "kross" i pokvarilo obrasce.
 */
export function loosenSearchText(value) {
    const substituted = normalizeSearchText(value)
        .replace(/x/g, "ks")
        .replace(/q/g, "k")
        .replace(/w/g, "v")
        .replace(/y/g, "i")
        .replace(/c/g, "k")
        .replace(/ij/g, "i")
        .replace(/j/g, "i");
    // Udvojena slova se svode na jedno ("Passat" i "Пасат" -> "pasat").
    let collapsed = "";
    for (const char of substituted) {
        if (char !== collapsed[collapsed.length - 1])
            collapsed += char;
    }
    return collapsed;
}
//# sourceMappingURL=text.js.map