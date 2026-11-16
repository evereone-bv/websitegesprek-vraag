// Instellingen van de vraagbaak. Geheimen komen alleen uit de omgeving (/etc/vraag/vraag.env), nooit uit de repo.
// Prijzen in dollar per miljoen tokens, Claude API (13 nov 2026, controleren bij elke modelwissel).
// Haiku 5.5: prompts tot 100.000 tokens; daarboven x5. Werkruimte vraagbaak staat op inference geo "us": x1,1.
export const PRIJZEN = {
  'claude-haiku-5-5': { invoer: 0.10, uitvoer: 0.50, cache_schrijf: 0.125, cache_lees: 0.01, grens: 100_000, boven_factor: 5 },
  'claude-sonnet-5-5': { invoer: 2.00, uitvoer: 10.00, cache_schrijf: 2.50, cache_lees: 0.10, grens: Infinity, boven_factor: 1 },
  // Besluit 467: Opus 5.5 als beoordelaar van de testset (platform.claude.com/docs/en/about-claude/pricing: $4/$20, cache $5/$0,20).
  'claude-opus-5-5': { invoer: 4.00, uitvoer: 20.00, cache_schrijf: 5.00, cache_lees: 0.20, grens: Infinity, boven_factor: 1 },
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
    // Besluit 467 (Raymond 15 nov 09:53: 'ik wil echt goede antwoorden'): Sonnet 5.5 voor bezoekers, Haiku als terugval.
    // De testset draait beide en kiest op kwaliteit (testModellen); vaste versies, geen alias.
    model: env.VRAAG_MODEL || 'claude-sonnet-5-5',
    testModellen: (env.VRAAG_TEST_MODELLEN || 'claude-sonnet-5-5,claude-haiku-5-5').split(',').map((m) => m.trim()).filter(Boolean),
    terugvalModel: env.VRAAG_TERUGVAL_MODEL ?? 'claude-haiku-5-5',
    // Besluit 447: nadenken 'low' (adaptief, effort low) of 'uit'; de volledige testset meet beide en kiest.
    denken: env.VRAAG_DENKEN || 'low',
    // Besluit 448: vaste beoordelaar voor de testset (ander, sterker model dan de vraagbaak; vast model en vaste opdracht).
    beoordelaarModel: env.VRAAG_BEOORDELAAR_MODEL || 'claude-opus-5-5', // sterker dan het model dat hij nakijkt (448, 467)
    inferenceGeo: 'us', // VB1 Juridisch: nooit 'global'
    herkomst: (env.VRAAG_HERKOMST || 'https://websitegesprek.nl').split(',').map((s) => s.trim()).filter(Boolean),
    dataMap: env.VRAAG_DATA_DIR || '/data',
    // Grenzen (ontwerp §7, besluit 399)
    maxVraagTekens: getal('VRAAG_MAX_TEKENS', 500),
    maxUitvoerTokens: getal('VRAAG_MAX_UITVOER', 1200),
    perTokenVragen: getal('VRAAG_PER_TOKEN', 20),
    tokenMinuten: getal('VRAAG_TOKEN_MINUTEN', 30),
    perIpUur: getal('VRAAG_PER_IP_UUR', 30),
    perIpDag: getal('VRAAG_PER_IP_DAG', 100),
    tokensPerIpUur: getal('VRAAG_TOKENS_PER_IP_UUR', 10),
    // Besluit 468 (kostenbeheer volgens OWASP LLM10 en gangbare praktijk): per bezoeker limieten (hieronder), een zuinige stand
    // vanaf 70% van het uur- of dagbudget of bij een kostenpiek (goedkoper, goedgekeurd model in plaats van uitzetten), een
    // harde grens als vangnet met een vriendelijke doorverwijzing, en de maandgrens bij Anthropic (Console) als laatste vangnet.
    plafondUurEuro: getal('VRAAG_PLAFOND_UUR', 10),
    plafondDagEuro: getal('VRAAG_PLAFOND_DAG', 30),
    zuinigVanaf: getal('VRAAG_ZUINIG_VANAF', 0.7),
    piekDrempelEuro: getal('VRAAG_PIEK_DREMPEL', 3),
    serverVragenPerUur: getal('VRAAG_SERVER_PER_UUR', 600),
    puzzelBits: getal('VRAAG_PUZZEL_BITS', 18), // ca. 1 s op een telefoon
    apiTimeoutMs: getal('VRAAG_API_TIMEOUT_MS', 24000), // 467: Sonnet plus één herstelpoging moet erin passen
    // Bewaren (VB5)
    registerDagen: 30,
    // Besluit 480: nachtelijke export naar rapportage. Alleen met adres, sleutel van 32 bytes én VRAAG_EXPORT=aan
    // (RV1: pas aan na de proefrun langs SiteGround en schriftelijk akkoord van Juridisch).
    rapportageUrl: env.VRAAG_RAPPORTAGE_URL || '',
    rapportageSleutel: env.VRAAG_RAPPORTAGE_SLEUTEL || '',
    exportAan: env.VRAAG_EXPORT === 'aan',
    cacheTtl: env.VRAAG_CACHE_TTL === '5m' ? '5m' : '1h', // besluit 461
    beheerSleutel: env.VRAAG_BEHEER_SLEUTEL || '', // voor /beheer/* (export, aan/uit); alleen lokaal op de server
    // Besluit 546.1 (blauw-groen): goedkeuringsbestand van de live versie (W1, alleen-lezen in de container), de stand van
    // de poort die deploy/wissel.sh bijhoudt, en de kostengrens per testrun (V13, W3; het wisselscript zet hem per run).
    goedkeuringPad: env.VRAAG_GOEDKEURING || '/goedkeuring.json',
    poortMap: env.VRAAG_POORT || '/poort',
    testPlafondEuro: getal('VRAAG_TEST_PLAFOND', 5),
  };
}

export function kostenDollar(model, usage = {}) {
  const p = PRIJZEN[model];
  if (!p) return 0;
  const invoer = usage.input_tokens || 0;
  const schrijf = usage.cache_creation_input_tokens || 0;
  // Besluit 461: schrijven in de cache van 1 uur kost 2x de invoerprijs (5 minuten: cache_schrijf, 1,25x).
  const schrijf1u = Math.min(schrijf, usage.cache_creation?.ephemeral_1h_input_tokens || 0);
  const lees = usage.cache_read_input_tokens || 0;
  const uit = usage.output_tokens || 0;
  const totaalPrompt = invoer + schrijf + lees;
  const f = (totaalPrompt > p.grens ? p.boven_factor : 1) * GEO_FACTOR;
  return f * (invoer * p.invoer + (schrijf - schrijf1u) * p.cache_schrijf + schrijf1u * p.invoer * 2 + lees * p.cache_lees + uit * p.uitvoer) / 1_000_000;
}
