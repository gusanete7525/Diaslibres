// The selected language provides inspiration, not the visitor's location or nationality.
const MARKETS = {
  es: { countries: ['ES', 'MX', 'CO'], hotels: ['Granada, Spain', 'Oaxaca, Mexico', 'Cartagena, Colombia'], routes: [['MAD', 'AGP'], ['MAD', 'MEX'], ['MAD', 'BOG']] },
  fr: { countries: ['FR'], hotels: ['Colmar, France', 'Annecy, France', 'Nimes, France'], routes: [['CDG', 'NCE'], ['CDG', 'TLS'], ['CDG', 'AGP']] },
  en: { countries: ['GB', 'IE'], hotels: ['York, United Kingdom', 'Bath, United Kingdom', 'Galway, Ireland'], routes: [['LHR', 'EDI'], ['LHR', 'DUB'], ['LHR', 'OPO']] },
  de: { countries: ['DE', 'AT'], hotels: ['Leipzig, Germany', 'Nuremberg, Germany', 'Salzburg, Austria'], routes: [['FRA', 'BER'], ['FRA', 'VIE'], ['FRA', 'PMI']] },
  it: { countries: ['IT'], hotels: ['Bologna, Italy', 'Turin, Italy', 'Palermo, Italy'], routes: [['FCO', 'CTA'], ['FCO', 'BLQ'], ['MXP', 'NAP']] },
  pt: { countries: ['PT', 'BR'], hotels: ['Braga, Portugal', 'Coimbra, Portugal', 'Rio de Janeiro, Brazil'], routes: [['LIS', 'OPO'], ['LIS', 'FNC'], ['LIS', 'GIG']] },
  nl: { countries: ['NL', 'BE'], hotels: ['Delft, Netherlands', 'Utrecht, Netherlands', 'Ghent, Belgium'], routes: [['AMS', 'BCN'], ['AMS', 'OPO'], ['AMS', 'VLC']] },
};
export function promotionMarket(language = 'es') {
  const lang = Object.hasOwn(MARKETS, language) ? language : 'es';
  const m = MARKETS[lang];
  return { language: lang, countries: [...m.countries], hotels: [...m.hotels], routes: m.routes.map(r => [...r]) };
}
export function marketInfo(language) {
  const { language: lang, countries } = promotionMarket(language);
  return { language: lang, countries, basedOn: 'language' };
}
