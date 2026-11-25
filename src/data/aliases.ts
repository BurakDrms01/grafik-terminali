// TradingView'da alışılmış sembol adları (XAUUSD, US100, USOIL, ES1!…) ve Türkçe aramalar (altın, gümüş, dolar…)
// Yahoo'da farklı adlarla geçtiği ya da hiç bulunmadığı için burada karşılıklarına eşlenir.
import { SYNTHETICS } from './synthetic.ts';
import { makeId, type Source, type SymbolDef } from './types.ts';

interface AliasDef {
  keys: string[];
  source: Source;
  ticker: string;
  name: string;
  type: string;
  exchange: string;
}

const A = (keys: string, ticker: string, name: string, type: string, exchange = ''): AliasDef => ({
  keys: keys.split(' '),
  source: 'YAHOO',
  ticker,
  name,
  type,
  exchange,
});

/** Binance vadesiz (perpetual) emtia: 7/24 işlem görür, fiyatı spota çok yakındır (XAUUSD gibi). */
const P = (keys: string, ticker: string, name: string): AliasDef => ({
  keys: keys.split(' '),
  source: 'BINANCEF',
  ticker,
  name,
  type: 'Emtia',
  exchange: 'Binance vadesiz',
});

const BIST = (keys: string, ticker: string, name: string): AliasDef => A(keys, ticker, name, 'Endeks', 'Borsa İstanbul');

// Aynı ada birden çok karşılık varsa sırayla listelenir (ilki en yakın karşılık).
const ALIASES: AliasDef[] = [
  // Hesaplanan TL fiyatları
  A('GRAMALTIN ALTINGRAM GRAM GRAMALTINTL ALTINTL XAUTRYG HASALTIN', 'GRAMALTIN', SYNTHETICS.GRAMALTIN.name, 'Emtia', 'Hesaplanan'),
  A('GRAMGUMUS GUMUSGRAM GRAMGUMUSTL GUMUSTL XAGTRYG', 'GRAMGUMUS', SYNTHETICS.GRAMGUMUS.name, 'Emtia', 'Hesaplanan'),
  A('XAUTRY ONSTL ALTINONSTL ONSALTINTL', 'XAUTRY', SYNTHETICS.XAUTRY.name, 'Emtia', 'Hesaplanan'),
  A('XAGTRY GUMUSONSTL ONSGUMUSTL', 'XAGTRY', SYNTHETICS.XAGTRY.name, 'Emtia', 'Hesaplanan'),

  // Değerli metaller: spota yakın 7/24 fiyat (Binance) ve uzun geçmişli COMEX vadelisi (Yahoo)
  P('XAUUSD GOLD ALTIN ONSALTIN ALTINONS ONS XAU XAUUSDT XAUUSDTP SPOTALTIN', 'XAUUSDT', 'Altın ons / ABD doları · 7/24 (XAUUSD)'),
  A('XAUUSD GOLD ALTIN ONSALTIN ALTINONS ONS XAU GC1 ALTINVADELI', 'GC=F', 'Altın ons (COMEX vadeli) · uzun geçmiş', 'Vadeli', 'COMEX'),
  P('XAGUSD SILVER GUMUS GUMUSONS XAG XAGUSDT XAGUSDTP SPOTGUMUS', 'XAGUSDT', 'Gümüş ons / ABD doları · 7/24 (XAGUSD)'),
  A('XAGUSD SILVER GUMUS GUMUSONS XAG SI1 GUMUSVADELI', 'SI=F', 'Gümüş ons (COMEX vadeli) · uzun geçmiş', 'Vadeli', 'COMEX'),
  P('XPTUSD PLATINUM PLATIN XPT XPTUSDT XPTUSDTP', 'XPTUSDT', 'Platin / ABD doları · 7/24 (XPTUSD)'),
  A('XPTUSD PLATINUM PLATIN XPT PL1', 'PL=F', 'Platin (NYMEX vadeli) · uzun geçmiş', 'Vadeli', 'NYMEX'),
  P('XPDUSD PALLADIUM PALADYUM XPD XPDUSDT XPDUSDTP', 'XPDUSDT', 'Paladyum / ABD doları · 7/24 (XPDUSD)'),
  A('XPDUSD PALLADIUM PALADYUM XPD PA1', 'PA=F', 'Paladyum (NYMEX vadeli) · uzun geçmiş', 'Vadeli', 'NYMEX'),
  A('MGC MGC1 MIKROALTIN', 'MGC=F', 'Mikro altın (COMEX vadeli)', 'Vadeli', 'COMEX'),
  A('SIL1 MIKROGUMUS', 'SIL=F', 'Mikro gümüş (COMEX vadeli)', 'Vadeli', 'COMEX'),

  // Enerji ve sanayi metalleri
  A('USOIL WTI PETROL HAMPETROL CRUDE CRUDEOIL OIL XTIUSD CL1', 'CL=F', 'Ham petrol WTI (vadeli) · USOIL karşılığı', 'Vadeli', 'NYMEX'),
  P('USOIL WTI PETROL HAMPETROL CRUDE CRUDEOIL OIL XTIUSD CLUSDT', 'CLUSDT', 'Ham petrol WTI · 7/24 (Binance vadesiz)'),
  A('MCL MCL1', 'MCL=F', 'Mikro WTI petrol (vadeli)', 'Vadeli', 'NYMEX'),
  A('UKOIL BRENT BRENTPETROL XBRUSD BZ1', 'BZ=F', 'Brent petrol (vadeli) · UKOIL karşılığı', 'Vadeli', 'NYMEX'),
  P('UKOIL BRENT BRENTPETROL XBRUSD BZUSDT', 'BZUSDT', 'Brent petrol · 7/24 (Binance vadesiz)'),
  A('NATGAS NGAS DOGALGAZ GAS XNGUSD NG1', 'NG=F', 'Doğal gaz (vadeli)', 'Vadeli', 'NYMEX'),
  P('NATGAS NGAS DOGALGAZ GAS XNGUSD NATGASUSDT', 'NATGASUSDT', 'Doğal gaz · 7/24 (Binance vadesiz)'),
  A('GASOLINE RBOB BENZIN RB1', 'RB=F', 'Benzin RBOB (vadeli)', 'Vadeli', 'NYMEX'),
  A('HEATINGOIL ISITMAYAGI MAZOT HO1', 'HO=F', 'Isıtma yağı (vadeli)', 'Vadeli', 'NYMEX'),
  A('COPPER BAKIR XCUUSD HG1', 'HG=F', 'Bakır (vadeli)', 'Vadeli', 'COMEX'),
  P('COPPER BAKIR XCUUSD COPPERUSDT', 'COPPERUSDT', 'Bakır · 7/24 (Binance vadesiz)'),
  A('ALUMINUM ALUMINIUM ALUMINYUM ALI1', 'ALI=F', 'Alüminyum (vadeli)', 'Vadeli', 'COMEX'),

  // Tarım ve hayvancılık
  A('CORN MISIR ZC ZC1', 'ZC=F', 'Mısır (vadeli)', 'Vadeli', 'CBOT'),
  A('WHEAT BUGDAY ZW ZW1', 'ZW=F', 'Buğday (vadeli)', 'Vadeli', 'CBOT'),
  A('SOYBEAN SOYBEANS SOYA SOYAFASULYESI ZS ZS1', 'ZS=F', 'Soya fasulyesi (vadeli)', 'Vadeli', 'CBOT'),
  A('SOYBEANMEAL SOYAKUSPESI ZM ZM1', 'ZM=F', 'Soya küspesi (vadeli)', 'Vadeli', 'CBOT'),
  A('SOYBEANOIL SOYAYAGI ZL ZL1', 'ZL=F', 'Soya yağı (vadeli)', 'Vadeli', 'CBOT'),
  A('OATS YULAF ZO ZO1', 'ZO=F', 'Yulaf (vadeli)', 'Vadeli', 'CBOT'),
  A('COFFEE KAHVE KC1', 'KC=F', 'Kahve (vadeli)', 'Vadeli', 'ICE'),
  A('SUGAR SEKER SB1', 'SB=F', 'Şeker (vadeli)', 'Vadeli', 'ICE'),
  A('COCOA KAKAO CC1', 'CC=F', 'Kakao (vadeli)', 'Vadeli', 'ICE'),
  A('COTTON PAMUK CT1', 'CT=F', 'Pamuk (vadeli)', 'Vadeli', 'ICE'),
  A('ORANGEJUICE PORTAKAL PORTAKALSUYU OJ1', 'OJ=F', 'Portakal suyu (vadeli)', 'Vadeli', 'ICE'),
  A('CATTLE LIVECATTLE SIGIR CANLISIGIR LE1', 'LE=F', 'Canlı sığır (vadeli)', 'Vadeli', 'CME'),
  A('FEEDERCATTLE BESISIGIRI GF1', 'GF=F', 'Besi sığırı (vadeli)', 'Vadeli', 'CME'),
  A('HOGS LEANHOGS DOMUZ HE1', 'HE=F', 'Domuz (vadeli)', 'Vadeli', 'CME'),

  // ABD endeksleri ve endeks vadelileri
  A('US30 DJI DOW DOWJONES', '^DJI', 'Dow Jones Sanayi · US30 karşılığı', 'Endeks', 'DJI'),
  A('US500 SPX500 SPX SP500 SNP500 GSPC', '^GSPC', 'S&P 500 · US500 karşılığı', 'Endeks', 'SNP'),
  A('NAS100 US100 NDX NASDAQ100 USTEC', '^NDX', 'Nasdaq 100 · NAS100 karşılığı', 'Endeks', 'Nasdaq'),
  A('IXIC NASDAQ NASDAQCOMPOSITE', '^IXIC', 'Nasdaq Bileşik', 'Endeks', 'Nasdaq'),
  A('US2000 RUT RUSSELL RUSSELL2000', '^RUT', 'Russell 2000', 'Endeks'),
  A('RUI RUSSELL1000', '^RUI', 'Russell 1000', 'Endeks'),
  A('OEX SP100', '^OEX', 'S&P 100', 'Endeks', 'CBOE'),
  A('NYA NYSECOMPOSITE', '^NYA', 'NYSE Bileşik', 'Endeks', 'NYSE'),
  A('W5000 WILSHIRE WILSHIRE5000', '^W5000', 'Wilshire 5000', 'Endeks'),
  A('SOX PHLXSOX YARIILETKEN', '^SOX', 'PHLX Yarı İletken Endeksi', 'Endeks', 'Nasdaq'),
  A('DXY USDX DOLARENDEKSI DX1', 'DX-Y.NYB', 'ABD Dolar Endeksi (DXY)', 'Endeks', 'ICE'),
  A('VIX KORKUENDEKSI', '^VIX', 'Volatilite Endeksi (VIX)', 'Endeks', 'CBOE'),
  A('VIX9D', '^VIX9D', 'VIX 9 günlük', 'Endeks', 'CBOE'),
  A('ES ES1 SPXFUT SP500FUT EMINI', 'ES=F', 'S&P 500 E-mini (vadeli)', 'Vadeli', 'CME'),
  A('NQ NQ1 NASDAQFUT NAS100FUT', 'NQ=F', 'Nasdaq 100 E-mini (vadeli)', 'Vadeli', 'CME'),
  A('YM YM1 DOWFUT US30FUT', 'YM=F', 'Dow Jones mini (vadeli)', 'Vadeli', 'CBOT'),
  A('RTY RTY1 RUSSELLFUT', 'RTY=F', 'Russell 2000 E-mini (vadeli)', 'Vadeli', 'CME'),
  A('MES MES1', 'MES=F', 'Mikro S&P 500 (vadeli)', 'Vadeli', 'CME'),
  A('MNQ MNQ1', 'MNQ=F', 'Mikro Nasdaq 100 (vadeli)', 'Vadeli', 'CME'),
  A('MYM MYM1', 'MYM=F', 'Mikro Dow Jones (vadeli)', 'Vadeli', 'CBOT'),
  A('M2K M2K1', 'M2K=F', 'Mikro Russell 2000 (vadeli)', 'Vadeli', 'CME'),
  A('BTC1 CMEBTC BTCFUT', 'BTC=F', 'Bitcoin CME (vadeli)', 'Vadeli', 'CME'),
  A('ETH1 CMEETH ETHFUT', 'ETH=F', 'Ethereum CME (vadeli)', 'Vadeli', 'CME'),

  // ABD faizleri ve tahvil vadelileri
  A('US10Y TNX TAHVIL10 ABD10Y', '^TNX', 'ABD 10 yıllık tahvil faizi', 'Endeks', 'CBOE'),
  A('US02Y US2Y TAHVIL2 ABD2Y', '2YY=F', 'ABD 2 yıllık faiz (vadeli)', 'Vadeli', 'CBOT'),
  A('US05Y US5Y FVX TAHVIL5 ABD5Y', '^FVX', 'ABD 5 yıllık tahvil faizi', 'Endeks', 'CBOE'),
  A('US30Y TYX TAHVIL30 ABD30Y', '^TYX', 'ABD 30 yıllık tahvil faizi', 'Endeks', 'CBOE'),
  A('US03M US3M IRX', '^IRX', 'ABD 3 aylık bono faizi', 'Endeks', 'CBOE'),
  A('ZB ZB1 TBOND', 'ZB=F', 'ABD 30 yıllık tahvil (vadeli)', 'Vadeli', 'CBOT'),
  A('UB1 ULTRABOND', 'UB=F', 'ABD Ultra tahvil (vadeli)', 'Vadeli', 'CBOT'),
  A('ZN ZN1 TNOTE', 'ZN=F', 'ABD 10 yıllık T-Note (vadeli)', 'Vadeli', 'CBOT'),
  A('TN1 ULTRA10', 'TN=F', 'ABD Ultra 10 yıllık (vadeli)', 'Vadeli', 'CBOT'),
  A('ZF ZF1', 'ZF=F', 'ABD 5 yıllık T-Note (vadeli)', 'Vadeli', 'CBOT'),
  A('ZT ZT1', 'ZT=F', 'ABD 2 yıllık T-Note (vadeli)', 'Vadeli', 'CBOT'),

  // Döviz vadelileri (CME)
  A('6E 6E1', '6E=F', 'Euro (vadeli)', 'Vadeli', 'CME'),
  A('6B 6B1', '6B=F', 'İngiliz sterlini (vadeli)', 'Vadeli', 'CME'),
  A('6J 6J1', '6J=F', 'Japon yeni (vadeli)', 'Vadeli', 'CME'),
  A('6A 6A1', '6A=F', 'Avustralya doları (vadeli)', 'Vadeli', 'CME'),
  A('6C 6C1', '6C=F', 'Kanada doları (vadeli)', 'Vadeli', 'CME'),
  A('6S 6S1', '6S=F', 'İsviçre frangı (vadeli)', 'Vadeli', 'CME'),
  A('6N 6N1', '6N=F', 'Yeni Zelanda doları (vadeli)', 'Vadeli', 'CME'),
  A('6M 6M1', '6M=F', 'Meksika pesosu (vadeli)', 'Vadeli', 'CME'),

  // Dünya endeksleri
  A('GER40 GER30 DAX DE40 DE30 DAX40 GDAXI', '^GDAXI', 'DAX · GER40 karşılığı', 'Endeks', 'XETRA'),
  A('UK100 FTSE FTSE100', '^FTSE', 'FTSE 100 · UK100 karşılığı', 'Endeks', 'LSE'),
  A('FRA40 CAC CAC40', '^FCHI', 'CAC 40 · FRA40 karşılığı', 'Endeks', 'Paris'),
  A('EU50 EUSTX50 STOXX50 SX5E', '^STOXX50E', 'Euro Stoxx 50', 'Endeks'),
  A('STOXX600 SXXP', '^STOXX', 'STOXX Europe 600', 'Endeks'),
  A('EURONEXT100 N100', '^N100', 'Euronext 100', 'Endeks'),
  A('SMI SWI20 SSMI ISVICRE', '^SSMI', 'SMI (İsviçre)', 'Endeks', 'SIX'),
  A('IBEX IBEX35 ESP35 SPA35 ISPANYA', '^IBEX', 'IBEX 35 (İspanya)', 'Endeks', 'BME'),
  A('FTSEMIB ITA40 IT40 ITALYA', 'FTSEMIB.MI', 'FTSE MIB (İtalya)', 'Endeks', 'Milano'),
  A('AEX NETH25 NED25 HOLLANDA', '^AEX', 'AEX (Hollanda)', 'Endeks', 'Amsterdam'),
  A('JPN225 JP225 NIKKEI NIKKEI225 NI225 N225', '^N225', 'Nikkei 225', 'Endeks', 'Osaka'),
  A('HK50 HSI HANGSENG', '^HSI', 'Hang Seng', 'Endeks', 'HKSE'),
  A('HSCEI HSCE', '^HSCE', 'Hang Seng China Enterprises', 'Endeks', 'HKSE'),
  A('SSEC SHCOMP SHANGHAI SANGHAY', '000001.SS', 'Şanghay Bileşik', 'Endeks', 'Şanghay'),
  A('KOSPI KS11 GUNEYKORE', '^KS11', 'KOSPI (Güney Kore)', 'Endeks', 'KRX'),
  A('TAIEX TWII TAYVAN', '^TWII', 'TAIEX (Tayvan)', 'Endeks', 'TWSE'),
  A('AUS200 ASX200 XJO AXJO AVUSTRALYA', '^AXJO', 'S&P/ASX 200 (Avustralya)', 'Endeks', 'ASX'),
  A('NIFTY NIFTY50 NSEI HINDISTAN', '^NSEI', 'Nifty 50 (Hindistan)', 'Endeks', 'NSE'),
  A('SENSEX BSESN', '^BSESN', 'BSE Sensex (Hindistan)', 'Endeks', 'BSE'),
  A('STI SINGAPUR', '^STI', 'Straits Times (Singapur)', 'Endeks', 'SGX'),
  A('KLCI MALEZYA', '^KLSE', 'FTSE Bursa Malaysia KLCI', 'Endeks'),
  A('JKSE ENDONEZYA', '^JKSE', 'Jakarta Bileşik (Endonezya)', 'Endeks'),
  A('TSX GSPTSE SPTSX KANADA', '^GSPTSE', 'S&P/TSX (Kanada)', 'Endeks', 'TSX'),
  A('IBOV IBOVESPA BVSP BREZILYA', '^BVSP', 'Ibovespa (Brezilya)', 'Endeks', 'B3'),
  A('MXX MEKSIKA', '^MXX', 'IPC (Meksika)', 'Endeks', 'BMV'),

  // Borsa İstanbul endeksleri
  BIST('BIST100 XU100 BIST BORSA BORSAISTANBUL', 'XU100.IS', 'BIST 100'),
  BIST('BIST30 XU030', 'XU030.IS', 'BIST 30'),
  BIST('BIST50 XU050', 'XU050.IS', 'BIST 50'),
  BIST('BISTTUM XUTUM', 'XUTUM.IS', 'BIST Tüm'),
  BIST('XYUZO BIST10030', 'XYUZO.IS', 'BIST 100-30'),
  BIST('XBANA BISTANA', 'XBANA.IS', 'BIST Ana'),
  BIST('XBANK BISTBANKA BANKA', 'XBANK.IS', 'BIST Banka'),
  BIST('XUSIN BISTSINAI SINAI', 'XUSIN.IS', 'BIST Sınai'),
  BIST('XUMAL BISTMALI MALI', 'XUMAL.IS', 'BIST Mali'),
  BIST('XUHIZ BISTHIZMET HIZMETLER', 'XUHIZ.IS', 'BIST Hizmetler'),
  BIST('XUTEK BISTTEKNOLOJI TEKNOLOJI', 'XUTEK.IS', 'BIST Teknoloji'),
  BIST('XHOLD BISTHOLDING HOLDING', 'XHOLD.IS', 'BIST Holding ve Yatırım'),
  BIST('XKTUM KATILIM BISTKATILIM', 'XKTUM.IS', 'BIST Katılım Tüm'),
  BIST('XK100 KATILIM100', 'XK100.IS', 'BIST Katılım 100'),
  BIST('XK030 KATILIM30', 'XK030.IS', 'BIST Katılım 30'),
  BIST('XUSRD SURDURULEBILIRLIK', 'XUSRD.IS', 'BIST Sürdürülebilirlik'),
  BIST('XGMYO GYO GAYRIMENKUL', 'XGMYO.IS', 'BIST Gayrimenkul YO'),
  BIST('XELKT ELEKTRIK', 'XELKT.IS', 'BIST Elektrik'),
  BIST('XGIDA GIDA', 'XGIDA.IS', 'BIST Gıda İçecek'),
  BIST('XINSA INSAAT', 'XINSA.IS', 'BIST İnşaat'),
  BIST('XMANA METALANA', 'XMANA.IS', 'BIST Metal Ana'),
  BIST('XMESY METALESYA MAKINA', 'XMESY.IS', 'BIST Metal Eşya Makina'),
  BIST('XKMYA KIMYA', 'XKMYA.IS', 'BIST Kimya Petrol Plastik'),
  BIST('XTRZM TURIZM', 'XTRZM.IS', 'BIST Turizm'),
  BIST('XULAS ULASTIRMA', 'XULAS.IS', 'BIST Ulaştırma'),
  BIST('XSGRT SIGORTA', 'XSGRT.IS', 'BIST Sigorta'),
  BIST('XTAST TASTOPRAK', 'XTAST.IS', 'BIST Taş Toprak'),
  BIST('XILTM ILETISIM', 'XILTM.IS', 'BIST İletişim'),
  BIST('XMADN MADENCILIK', 'XMADN.IS', 'BIST Madencilik'),
  BIST('XBLSM BILISIM', 'XBLSM.IS', 'BIST Bilişim'),
  BIST('XSPOR SPOR', 'XSPOR.IS', 'BIST Spor'),
  BIST('XTCRT TICARET', 'XTCRT.IS', 'BIST Ticaret'),
  BIST('XTEKS TEKSTIL', 'XTEKS.IS', 'BIST Tekstil Deri'),
  BIST('XAKUR ARACIKURUM', 'XAKUR.IS', 'BIST Aracı Kurumlar'),
  BIST('XFINK FAKTORING', 'XFINK.IS', 'BIST Finansal Kiralama Faktoring'),

  // TL çiftleri
  A('DOLAR DOLARTL USDTL', 'USDTRY=X', 'Dolar / TL', 'Döviz'),
  A('EURO AVRO EUROTL EURTL', 'EURTRY=X', 'Euro / TL', 'Döviz'),
  A('STERLIN STERLINTL GBPTL', 'GBPTRY=X', 'Sterlin / TL', 'Döviz'),
  A('FRANK FRANKTL CHFTL', 'CHFTRY=X', 'İsviçre frangı / TL', 'Döviz'),
  A('YEN YENTL JPYTL', 'JPYTRY=X', 'Japon yeni / TL', 'Döviz'),
  A('DIRHEM DIRHEMTL AEDTL', 'AEDTRY=X', 'BAE dirhemi / TL', 'Döviz'),
  A('KANADADOLARI CADTL', 'CADTRY=X', 'Kanada doları / TL', 'Döviz'),
  A('AVUSTRALYADOLARI AUDTL', 'AUDTRY=X', 'Avustralya doları / TL', 'Döviz'),
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
  return { id: makeId(a.source, a.ticker), source: a.source, ticker: a.ticker, name: a.name, exchange: a.exchange, type: a.type };
}

/** Sorguya karşılık gelen takma ad sembolleri: önce tam eşleşenler, sonra baştan eşleşenler. */
export function aliasMatches(query: string, limit = 5): SymbolDef[] {
  const q = normalizeQuery(query);
  if (!q) return [];
  const exact = ALIASES.filter((a) => a.keys.includes(q));
  // Baştan eşleşme 3 harften itibaren: "AS" yazarken (ASELS) ilgisiz takma adlar araya girmesin.
  const prefix = q.length >= 3 ? ALIASES.filter((a) => !exact.includes(a) && a.keys.some((k) => k.startsWith(q))).slice(0, 3) : [];
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
