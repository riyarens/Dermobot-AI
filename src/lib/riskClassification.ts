import { regulatoryIngredients, toxicityCategories, type RegulatoryIngredient } from '../data/regulatoryIngredients'
import type { IngredientScreening } from './scanService'

type Finding = { category: string; name: string }

// These aliases cover common label forms and members of grouped entries in the lists.
const aliases: Record<string, string[]> = {
  'Chlorofluorocarbon propellants': ['cfc', 'cfc aerosol'],
  'Mercury compounds': ['mercury'],
  'Vinyl chloride in aerosols': ['vinyl chloride'],
  'Zirconium aerosol complexes': ['zirconium aerosol complex'],
  'Sunscreen active ingredients': ['oxybenzone', 'avobenzone', 'octinoxate', 'homosalate', 'octocrylene', 'octisalate', 'ensulizole'],
  'Coal-tar colors': ['coal tar dye', 'ci 11680', 'auramine'],
  'Mercury and mercury compounds': ['mercury'],
  'Lead and lead compounds': ['lead'],
  'Arsenic and compounds': ['arsenic'],
  'Cadmium and compounds': ['cadmium'],
  'Isopropyl-, isobutyl-, phenyl-, benzyl-, and pentylparabens': ['isopropylparaben', 'isobutylparaben', 'phenylparaben', 'benzylparaben', 'pentylparaben'],
  'Talc containing asbestos': ['asbestos in talc'],
  'Coal tars (crude and refined)': ['coal tar', 'coal tars'],
  'Yohimbine and salts': ['yohimbine'],
  'Urocanic acid and its ethyl ester': ['urocanic acid', 'ethyl urocanate'],
  'Barium salts (most forms)': ['barium salt', 'barium salts'],
  'Secondary alkyl- and alkanolamines': ['secondary alkylamine', 'secondary alkanolamine'],
  'Nitrocresols and alkali metal salts': ['nitrocresol', 'nitrocresols'],
  'Specified nickel compounds': ['nickel monoxide', 'dinickel trioxide', 'nickel dioxide', 'nickel sulphide', 'nickel sulfide', 'tetracarbonylnickel'],
  'Specified fragrance ingredients (Annex II refs. 423–450)': ['alanroot oil', 'benzyl cyanide', 'cyclamen alcohol', 'diethyl maleate', '3,4-dihydrocoumarin', '7-methylcoumarin', 'methyl trans-2-butenoate', '5-methyl-2,3-hexanedione', 'pentylidenecyclohexanone', 'dimethyl citraconate', 'pseudomethylionone', 'pseudoionone', 'diphenylamine', 'ethyl acrylate', 'fig leaf absolute', 'trans-2-heptenal', 'trans-2-hexenal acetals', 'hydroabietyl alcohol', '6-isopropyl-2-decahydronaphthalenol', '7-methoxycoumarin', 'anisylidene acetone', 'alpha-methylanisylideneacetone', '3,7-dimethyl-2-octen-1-ol', '4,6-dimethyl-8-tert-butylcoumarin', 'pseudo-isomethyl ionone', 'verbena oil'],
  'Methyl-, ethyl-, and propylparabens': ['methylparaben', 'ethylparaben', 'propylparaben'],
  'Butylparaben and propylparaben': ['butylparaben', 'propylparaben'],
  'Fragrance allergens: Linalool, Limonene, Geraniol, Citral, Coumarin, Citronellol, Eugenol, Alpha-Isomethyl Ionone': ['linalool', 'limonene', 'geraniol', 'citral', 'coumarin', 'citronellol', 'eugenol', 'alpha-isomethyl ionone'],
  'Hydroxyisohexyl 3-Cyclohexene Carboxaldehyde (Lyral)': ['lyral'],
  'Evernia prunastri (Oakmoss) and Evernia furfuracea (Tree Moss)': ['oakmoss', 'evernia prunastri', 'tree moss', 'evernia furfuracea'],
  'DMDM Hydantoin, Imidazolidinyl Urea, Quaternium-15, Bronopol': ['dmdm hydantoin', 'imidazolidinyl urea', 'quaternium 15', 'bronopol'],
  'Methylisothiazolinone (MIT) and Methylchloroisothiazolinone (MCI)': ['methylisothiazolinone', 'mit', 'methylchloroisothiazolinone', 'mci'],
  'Synthetic dyes (CI 15850, CI 19140, CI 17200, CI 42090)': ['ci 15850', 'ci 19140', 'ci 17200', 'ci 42090', 'red 7', 'yellow 5', 'red 33', 'blue 1'],
  'Parabens (methyl-, ethyl-, propyl-, butyl-, isobutylparaben)': ['methylparaben', 'ethylparaben', 'propylparaben', 'butylparaben', 'isobutylparaben'],
  'Phthalates (DBP, DEHP, DINP, DIDP, Diisobutyl Phthalate)': ['dbp', 'dibutyl phthalate', 'dehp', 'di 2 ethylhexyl phthalate', 'bis 2 ethylhexyl phthalate', 'dinp', 'diisononyl phthalate', 'didp', 'diisodecyl phthalate', 'diisobutyl phthalate'],
  'Benzophenones 1/2/3/4 (including Oxybenzone) and 4-MBC': ['benzophenone 1', 'benzophenone 2', 'benzophenone 3', 'benzophenone 4', 'oxybenzone', '4 mbc'],
  'Homosalate, Octinoxate, Octocrylene': ['homosalate', 'octinoxate', 'ethylhexyl methoxycinnamate', 'octocrylene'],
  'Triclosan and Triclocarban': ['triclosan', 'triclocarban'],
  'BHA (Butylated Hydroxyanisole)': ['bha', 'butylated hydroxyanisole'],
  'UV-328 and TPHP (Triphenyl Phosphate)': ['uv 328', 'tphp', 'triphenyl phosphate'],
  'Nonylphenol ethoxylates (NPEs)': ['nonylphenol ethoxylate', 'npe'],
  'Styrene/Acrylates Copolymer': ['styrene acrylates copolymer'],
  'Formaldehyde': ['formalin', 'methylene glycol'],
  'Coal tar dyes (e.g., CI 11680, Auramine)': ['coal tar dye', 'ci 11680', 'auramine'],
  'Mineral oil (untreated/mildly treated)': ['untreated mineral oil', 'mildly treated mineral oil'],
  'Cadmium compounds': ['cadmium'],
  'Chromium (VI) compounds': ['chromium vi', 'chromium 6'],
  'Arsenic compounds': ['arsenic'],
  'Acrylamide': ['acrylamide monomer'],
  'BHT (Butylated Hydroxytoluene)': ['butylated hydroxytoluene'],
  'Asbestos (in talc)': ['asbestos'],
  'Methylene chloride': ['dichloromethane'],
  'Diethanolamine (DEA)': ['diethanolamine', 'dea'],
  'Nitrosamines (from TEA/DEA)': ['nitrosamine'],
  'Polycyclic aromatic hydrocarbons (PAHs)': ['polycyclic aromatic hydrocarbon', 'pah'],
  'Toluene-2,4-diamine and toluene-2,6-diamine': ['toluene 2 4 diamine', 'toluene 2 6 diamine'],
  'o-Phenylenediamine and salts': ['o phenylenediamine', 'ortho phenylenediamine'],
  '1- and 2-Naphthylamine and salts': ['1 naphthylamine', '2 naphthylamine'],
  '2,4-Diaminoanisole and 2,5-Diaminoanisole': ['2 4 diaminoanisole', '2 5 diaminoanisole'],
  'Aniline and specified derivatives': ['aniline'],
  'Cobalt dichloride and cobalt sulphate': ['cobalt dichloride', 'cobalt chloride', 'cobalt sulfate', 'cobalt sulphate'],
  'Beryllium and compounds': ['beryllium'],
  'Phenolphthalein': ['phenolphthalein'],
  'Anthracene oil': ['anthracene oil'],
  'Phenoxyethanol': ['phenoxyethanol'],
  'Cobalt chloride': ['cobalt chloride'],
  'Nickel sulfate': ['nickel sulfate', 'nickel sulphate'],
  'PTBP formaldehyde resin': ['ptbp formaldehyde resin'],
  'Resorcinol': ['resorcinol'],
  'Hydroquinone': ['hydroquinone'],
  '4-tert-Butylphenol': ['4 tert butylphenol'],
}

function normalize(value: string) {
  return value.toLowerCase().replace(/[^a-z0-9]+/g, ' ').trim().replace(/\s+/g, ' ')
}

function containsTerm(ingredient: string, term: string) {
  const name = normalize(ingredient)
  const normalizedTerm = normalize(term)
  return normalizedTerm.length > 2 && (` ${name} `).includes(` ${normalizedTerm} `)
}

function matches(ingredient: string, item: RegulatoryIngredient) {
  return [item.name, ...(aliases[item.name] ?? [])].some((term) => containsTerm(ingredient, term))
}

function regulatoryFindings(ingredient: string): Finding[] {
  const findings: Finding[] = []
  for (const [region, lists] of Object.entries(regulatoryIngredients)) {
    for (const status of ['banned', 'restricted'] as const) {
      for (const item of lists[status]) {
        if (matches(ingredient, item)) findings.push({ category: `${region} ${status}`, name: item.name })
      }
    }
  }
  return findings
}

function toxicityFindings(ingredient: string, category: keyof typeof toxicityCategories): Finding[] {
  return toxicityCategories[category]
    .filter((item) => matches(ingredient, item))
    .map((item) => ({ category, name: item.name }))
}

export function applyRiskCategories(items: IngredientScreening[]): IngredientScreening[] {
  return items.map<IngredientScreening>((item) => {
    const regulatory = regulatoryFindings(item.ingredient)
    const carcinogens = toxicityFindings(item.ingredient, 'Carcinogens')
    const allergens = toxicityFindings(item.ingredient, 'Allergens')
    const endocrine = toxicityFindings(item.ingredient, 'Endocrine disruptors')
    const highFindings = [...regulatory, ...carcinogens]
    const mediumFindings = [...allergens, ...endocrine]

    if (highFindings.length) {
      const labels = [...new Set(highFindings.map((finding) => `${finding.category}: ${finding.name}`))]
      return {
        ...item,
        level: 'high',
        reason: `High risk: matched ${labels.join('; ')}. These lists identify serious hazard or regulatory concerns; actual product risk depends on the exact substance, concentration, and use.`,
      }
    }

    if (mediumFindings.length) {
      const labels = [...new Set(mediumFindings.map((finding) => `${finding.category}: ${finding.name}`))]
      return {
        ...item,
        level: 'medium',
        reason: `Medium risk: matched ${labels.join('; ')}. These may involve allergy/sensitization or endocrine-related concerns; actual risk depends on exposure and product use.`,
      }
    }

    return {
      ...item,
      level: 'low',
      reason: 'Low risk screen: no listed carcinogen, allergen, endocrine disruptor, or FDA/EU banned or restricted item was matched. No issue was flagged by these checks; this does not guarantee the product will cause no irritation or other reaction.',
    }
  })
}
