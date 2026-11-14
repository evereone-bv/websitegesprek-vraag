// Instellingen van de vraagbaak. Geheimen komen alleen uit de omgeving (/etc/vraag/vraag.env), nooit uit de repo.
// Prijzen in dollar per miljoen tokens, Claude API (13 nov 2026, controleren bij elke modelwissel).
// Haiku 5.5: prompts tot 100.000 tokens; daarboven x5. Werkruimte vraagbaak staat op inference geo "us": x1,1.
export const PRIJZEN = {
  'claude-haiku-5-5': { invoer: 0.10, uitvoer: 0.50, cache_schrijf: 0.125, cache_lees: 0.01, grens: 100_000, boven_factor: 5 },
  'claude-sonnet-5-5': { invoer: 2.00, uitvoer: 10.00, cache_schrijf: 2.50, cache_lees: 0.10, grens: Infinity, boven_factor: 1 },
};
export const GEO_FACTOR = 1.1;
export const DOLLAR_NAAR_EURO = 0.95; // ruwe omrekening voor de plafonds in euro

export function laadConfig(env = process.env) {
  const getal = (n, d) => (env[n] !== undefined && env[n] !== '' && Number.isFinite(Number(env[n])) ? Number(env[n]) : d);
  return {
    // Aan/uit (besluit 400): 'auto' (standaard) = aan zodra het blok op websitegesprek.nl data-aan="1" heeft
    // én de volledige testset voor dit model en deze instructie is geslaagd. '0' = altijd uit, '1' = handmatig aan.
    // Besluit 409: microfoonknop voor bezoekers pas aan na akkoord Juridisch (VRAAG_SPRAAK=1). Voorlezen staat altijd aan.
    spraak: env.VRAAG_SPRAAK === '1',
    modus: env.VRAAG_ACTIEF === '1' ? 'aan' : env.VRAAG_ACTIEF === '0' ? 'uit' : 'auto',
    get actief() { return this.modus !== 'uit'; },
    siteUrl: env.VRAAG_SITE_URL || 'https://websitegesprek.nl/',
    apiSleutel: env.ANTHROPIC_API_KEY || '',
    apiBasis: env.VRAAG_API_BASIS || 'https://api.anthropic.com',
    model: env.VRAAG_MODEL || 'claude-haiku-5-5', // testset beslist (399); vaste versie, geen alias
    terugvalModel: env.VRAAG_TERUGVAL_MODEL || '',
    inferenceGeo: 'us', // VB1 Juridisch: nooit 'global'
    herkomst: (env.VRAAG_HERKOMST || 'https://websitegesprek.nl').split(',').map((s) => s.trim()).filter(Boolean),
    dataMap: env.VRAAG_DATA_DIR || '/data',
    // Grenzen (ontwerp §7, besluit 399)
    maxVraagTekens: getal('VRAAG_MAX_TEKENS', 500),
    maxUitvoerTokens: getal('VRAAG_MAX_UITVOER', 600),
    perTokenVragen: getal('VRAAG_PER_TOKEN', 20),
    tokenMinuten: getal('VRAAG_TOKEN_MINUTEN', 30),
    perIpUur: getal('VRAAG_PER_IP_UUR', 30),
    perIpDag: getal('VRAAG_PER_IP_DAG', 100),
    tokensPerIpUur: getal('VRAAG_TOKENS_PER_IP_UUR', 10),
    plafondUurEuro: getal('VRAAG_PLAFOND_UUR', 2),
    plafondDagEuro: getal('VRAAG_PLAFOND_DAG', 8),
    serverVragenPerUur: getal('VRAAG_SERVER_PER_UUR', 600),
    puzzelBits: getal('VRAAG_PUZZEL_BITS', 18), // ca. 1 s op een telefoon
    apiTimeoutMs: getal('VRAAG_API_TIMEOUT_MS', 11000),
    // Bewaren (VB5)
    registerDagen: 30,
    // Rapportage (hartslag/alarm/export), komt in een volgende versie
    rapportageUrl: env.VRAAG_RAPPORTAGE_URL || '',
    rapportageSleutel: env.VRAAG_RAPPORTAGE_SLEUTEL || '',
    beheerSleutel: env.VRAAG_BEHEER_SLEUTEL || '', // voor /beheer/* (export, aan/uit); alleen lokaal op de server
  };
}

export function kostenDollar(model, usage = {}) {
  const p = PRIJZEN[model];
  if (!p) return 0;
  const invoer = usage.input_tokens || 0;
  const schrijf = usage.cache_creation_input_tokens || 0;
  const lees = usage.cache_read_input_tokens || 0;
  const uit = usage.output_tokens || 0;
  const totaalPrompt = invoer + schrijf + lees;
  const f = (totaalPrompt > p.grens ? p.boven_factor : 1) * GEO_FACTOR;
  return f * (invoer * p.invoer + schrijf * p.cache_schrijf + lees * p.cache_lees + uit * p.uitvoer) / 1_000_000;
}
