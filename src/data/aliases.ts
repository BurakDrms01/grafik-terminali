// TradingView'da alışılmış sembol adları (XAUUSD, US100, USOIL…) ve Türkçe aramalar (altın, gümüş, dolar…)
// Yahoo'da farklı adlarla geçtiği ya da hiç bulunmadığı için burada karşılıklarına eşlenir.
import { SYNTHETICS } from './synthetic.ts';
import { makeId, type SymbolDef } from './types.ts';

interface AliasDef {
  keys: string[];
  ticker: string;
  name: string;
  type: string;
  exchange: string;
}

const A = (keys: string, ticker: string, name: string, type: string, exchange = ''): AliasDef => ({
  keys: keys.split(' '),
  ticker,
  name,
  type,
  exchange,
});

const ALIASES: AliasDef[] = [
  A('GRAMALTIN ALTINGRAM GRAM GRAMALTINTL ALTINTL XAUTRYG HASALTIN', 'GRAMALTIN', SYNTHETICS.GRAMALTIN.name, 'Emtia', 'Hesaplanan'),
  A('GRAMGUMUS GUMUSGRAM GRAMGUMUSTL GUMUSTL XAGTRYG', 'GRAMGUMUS', SYNTHETICS.GRAMGUMUS.name, 'Emtia', 'Hesaplanan'),
  A('XAUTRY ONSTL ALTINONSTL ONSALTINTL', 'XAUTRY', SYNTHETICS.XAUTRY.name, 'Emtia', 'Hesaplanan'),
  A('XAGTRY GUMUSONSTL ONSGUMUSTL', 'XAGTRY', SYNTHETICS.XAGTRY.name, 'Emtia', 'Hesaplanan'),
  A('XAUUSD GOLD ALTIN ONSALTIN ALTINONS ONS XAU', 'GC=F', 'Altın ons (vadeli) · XAUUSD karşılığı', 'Vadeli', 'COMEX'),
  A('XAGUSD SILVER GUMUS GUMUSONS XAG', 'SI=F', 'Gümüş ons (vadeli) · XAGUSD karşılığı', 'Vadeli', 'COMEX'),
  A('XPTUSD PLATINUM PLATIN XPT', 'PL=F', 'Platin (vadeli) · XPTUSD karşılığı', 'Vadeli', 'NYMEX'),
  A('XPDUSD PALLADIUM PALADYUM XPD', 'PA=F', 'Paladyum (vadeli) · XPDUSD karşılığı', 'Vadeli', 'NYMEX'),
  A('COPPER BAKIR XCUUSD', 'HG=F', 'Bakır (vadeli)', 'Vadeli', 'COMEX'),
  A('USOIL WTI PETROL HAMPETROL CRUDE CRUDEOIL OIL', 'CL=F', 'Ham petrol WTI (vadeli) · USOIL karşılığı', 'Vadeli', 'NYMEX'),
  A('UKOIL BRENT BRENTPETROL', 'BZ=F', 'Brent petrol (vadeli) · UKOIL karşılığı', 'Vadeli', 'NYMEX'),
  A('NATGAS NGAS DOGALGAZ GAS', 'NG=F', 'Doğal gaz (vadeli)', 'Vadeli', 'NYMEX'),
  A('US30 DJI DOW DOWJONES', '^DJI', 'Dow Jones Sanayi · US30 karşılığı', 'Endeks', 'DJI'),
  A('US500 SPX500 SPX SP500 SNP500 GSPC', '^GSPC', 'S&P 500 · US500 karşılığı', 'Endeks', 'SNP'),
  A('NAS100 US100 NDX NASDAQ100 USTEC', '^NDX', 'Nasdaq 100 · NAS100 karşılığı', 'Endeks', 'Nasdaq'),
  A('IXIC NASDAQ NASDAQCOMPOSITE', '^IXIC', 'Nasdaq Bileşik', 'Endeks', 'Nasdaq'),
  A('US2000 RUT RUSSELL RUSSELL2000', '^RUT', 'Russell 2000', 'Endeks'),
  A('DXY USDX DOLARENDEKSI', 'DX-Y.NYB', 'ABD Dolar Endeksi (DXY)', 'Endeks', 'ICE'),
  A('VIX KORKUENDEKSI', '^VIX', 'Volatilite Endeksi (VIX)', 'Endeks', 'CBOE'),
  A('GER40 GER30 DAX DE40', '^GDAXI', 'DAX · GER40 karşılığı', 'Endeks', 'XETRA'),
  A('UK100 FTSE FTSE100', '^FTSE', 'FTSE 100 · UK100 karşılığı', 'Endeks', 'LSE'),
  A('FRA40 CAC CAC40', '^FCHI', 'CAC 40 · FRA40 karşılığı', 'Endeks', 'Paris'),
  A('JPN225 JP225 NIKKEI NIKKEI225', '^N225', 'Nikkei 225', 'Endeks', 'Osaka'),
  A('HK50 HSI HANGSENG', '^HSI', 'Hang Seng', 'Endeks', 'HKSE'),
  A('EU50 EUSTX50 STOXX50 SX5E', '^STOXX50E', 'Euro Stoxx 50', 'Endeks'),
  A('US10Y TNX TAHVIL10', '^TNX', 'ABD 10 yıllık tahvil faizi', 'Endeks', 'CBOE'),
  A('BIST100 XU100 BIST BORSA BORSAISTANBUL', 'XU100.IS', 'BIST 100', 'Endeks', 'Borsa İstanbul'),
  A('BIST30 XU030', 'XU030.IS', 'BIST 30', 'Endeks', 'Borsa İstanbul'),
  A('XBANK BISTBANKA BANKA', 'XBANK.IS', 'BIST Banka', 'Endeks', 'Borsa İstanbul'),
  A('DOLAR DOLARTL USDTL', 'USDTRY=X', 'Dolar / TL', 'Döviz'),
  A('EURO AVRO EUROTL EURTL', 'EURTRY=X', 'Euro / TL', 'Döviz'),
  A('STERLIN STERLINTL GBPTL', 'GBPTRY=X', 'Sterlin / TL', 'Döviz'),
];

const CURRENCIES = new Set(
  'USD EUR GBP JPY CHF CAD AUD NZD TRY CNY CNH RUB SEK NOK DKK PLN ZAR MXN SGD HKD INR KRW BRL SAR AED HUF CZK ILS'.split(' '),
);

/** "Gümüş ", "xag/usd", "us-100" → "GUMUS", "XAGUSD", "US100" */
export function normalizeQuery(q: string): string {
  return q
    .toLocaleUpperCase('tr-TR')
    .replace(/İ/g, 'I')
    .replace(/Ş/g, 'S')
    .replace(/Ğ/g, 'G')
    .replace(/Ü/g, 'U')
    .replace(/Ö/g, 'O')
    .replace(/Ç/g, 'C')
    .replace(/[^A-Z0-9]/g, '');
}

function toDef(a: AliasDef): SymbolDef {
  return { id: makeId('YAHOO', a.ticker), source: 'YAHOO', ticker: a.ticker, name: a.name, exchange: a.exchange, type: a.type };
}

/** Sorguya karşılık gelen takma ad sembolleri: önce tam eşleşenler, sonra baştan eşleşenler. */
export function aliasMatches(query: string, limit = 5): SymbolDef[] {
  const q = normalizeQuery(query);
  if (!q) return [];
  const exact = ALIASES.filter((a) => a.keys.includes(q));
  const prefix = q.length >= 2 ? ALIASES.filter((a) => !exact.includes(a) && a.keys.some((k) => k.startsWith(q))) : [];
  const out = [...exact, ...prefix].map(toDef);
  // EURUSD, GBPJPY gibi altı harfli döviz çiftleri → Yahoo'daki "EURUSD=X"
  if (q.length === 6 && CURRENCIES.has(q.slice(0, 3)) && CURRENCIES.has(q.slice(3)) && q.slice(0, 3) !== q.slice(3)) {
    const ticker = `${q}=X`;
    if (!out.some((d) => d.ticker === ticker)) {
      out.unshift({ id: makeId('YAHOO', ticker), source: 'YAHOO', ticker, name: `${q.slice(0, 3)} / ${q.slice(3)}`, exchange: '', type: 'Döviz' });
    }
  }
  return out.slice(0, limit);
}

/** Arama boş dönerse doğrudan denenecek Yahoo sembolleri (BIST, ABD, döviz, vadeli). */
export function probeCandidates(query: string): string[] {
  const raw = query.trim().toUpperCase();
  if (!/^[A-Z0-9.^=-]{1,15}$/.test(raw)) return [];
  if (/[.^=]/.test(raw)) return [raw];
  return [`${raw}.IS`, raw, `${raw}=X`, `${raw}=F`];
}
