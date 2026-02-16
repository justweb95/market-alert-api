export function parsePowerKwHp(text: string): { powerKw: string; powerHp: string } {
  const clean = text.replace(/\s+/g, ' ').trim(); // "125kW (170KS)"
  const kw = clean.match(/(\d+)\s*kW/i)?.[1];
  const hp = clean.match(/(\d+)\s*KS/i)?.[1];
  return {
    powerKw: kw ? `${kw}kW` : '',
    powerHp: hp ? `${hp}KS` : '',
  };
}
