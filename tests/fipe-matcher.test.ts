import { describe, expect, it } from 'vitest';
import { isConfidentWithoutPrice, labelStartsWithModel, rankCandidates } from '../src/features/fipe/matcher';
import { extractFeatures, findBrandCode, tokenize } from '../src/features/fipe/normalize';
import type { FipeCandidate } from '../src/features/fipe/types';

/**
 * Real data captured on 2026-10-15: FIPE candidate lists (veiculos.fipe.org.br,
 * reference 338) and the version names Webmotors uses for the same model/year.
 */
const list = (entries: string[]): FipeCandidate[] =>
  entries.map((e) => {
    const [code, ...label] = e.split('=');
    return { code: code!, label: label.join('=') };
  });

const FIPE = {
  corollaFlex2021: list([
    '9300=Corolla ALTIS/A.Premiu. 2.0 Flex 16V Aut',
    '8839=Corolla GLi 2.0 16V Flex Aut.',
    '5194=Corolla XEi 2.0 Flex 16V Aut.',
  ]),
  corollaHybrid2021: list(['9984=Corolla Altis 1.8 16V Aut. (Híbrido)', '9985=Corolla Altis Prem. 1.8 Aut. (Híbrido)']),
  onix2022: list([
    '8988=ONIX HATCH 1.0 12V Flex 5p Mec.',
    '8889=ONIX HATCH 1.0 12V TB Flex 5p Aut.',
    '8949=ONIX HATCH LT 1.0 12V Flex 5p Mec.',
    '8890=ONIX HATCH LT 1.0 12V TB Flex 5p Aut.',
    '8891=ONIX HATCH LT 1.0 12V TB Flex 5p Mec.',
    '8892=ONIX HATCH LTZ 1.0 12V TB Flex 5p Aut.',
    '8893=ONIX HATCH LTZ 1.0 12V TB Flex 5p Mec.',
    '8894=ONIX HATCH PREM. 1.0 12V TB Flex 5p Aut.',
    '9211=ONIX HATCH RS 1.0 TB 12V Flex 5p Aut.',
    '9212=ONIX SD. P. PR. MIDNIGHT 1.0 TB Flex Aut',
    '8823=ONIX SED. Plus PREM. 1.0 12V TB Flex Aut',
    '8824=ONIX SEDAN Plus 1.0 12V TB Flex Aut.',
    '8950=ONIX SEDAN Plus LT 1.0 12V Flex 4p Mec.',
    '8825=ONIX SEDAN Plus LT 1.0 12V TB Flex Aut.',
    '8826=ONIX SEDAN Plus LT 1.0 12V TB Flex Mec.',
    '8827=ONIX SEDAN Plus LTZ 1.0 12V TB Flex Aut.',
    '8828=ONIX SEDAN Plus LTZ 1.0 12V TB Flex Mec.',
  ]),
  tcross2022: list([
    '10373=T-Cross 200 TSI 1.0 Flex 12V 5p Aut.',
    '10374=T-Cross Comfor. 200 TSI 1.0 Flex 5p Aut.',
    '10375=T-Cross Hig. 250 TSI 1.4 Flex 16V 5p Aut',
    '10376=T-Cross Sense 200 TSI 1.0 Flex 5p Aut.',
  ]),
  compassFlex2021: list([
    '7758=COMPASS LIMITED 2.0 4x2 Flex 16V Aut.',
    '7759=COMPASS LONGITUDE 2.0 4x2 Flex 16V Aut.',
    '7761=COMPASS SPORT 2.0 4x2 Flex 16V Aut.',
  ]),
  compassDiesel2021: list([
    '8039=COMPASS LIMITED 2.0 4x4 Diesel 16V Aut.',
    '7760=COMPASS LONGITUDE 2.0 4x4 Dies. 16V Aut.',
    '8663=COMPASS S 2.0 4x4 TB 16V Diesel Aut.',
    '7762=COMPASS TRAILHAWK 2.0 4x4 Dies. 16V Aut.',
  ]),
  strada2022: list([
    '9108=Strada Endurance 1.4 Flex 8V CD',
    '9109=Strada Endurance 1.4 Flex 8V CS Plus',
    '9110=Strada Freedom 1.3 Flex 8V CS Plus',
    '9111=Strada Freedom 1.3 Flex 8V CD',
    '9723=Strada Ranch 1.3 Flex 8V CD Aut.',
    '9112=Strada Volcano 1.3 Flex 8V CD',
    '9724=Strada Volcano 1.3 Flex 8V CD Aut.',
  ]),
  hb20_2021: list([
    '8849=HB20 Diamond 1.0 TB Flex 12V Aut.',
    '8850=HB20 Diamond Plus 1.0 TB Flex 12V Aut.',
    '8851=HB20 Evolution 1.0 Flex 12V Mec.',
    '8852=HB20 Evolution 1.0 TB Flex 12V Aut.',
    '8854=HB20 Sense 1.0 Flex 12V Mec.',
    '9008=HB20 Sport 1.0 TB Flex 12V Aut.',
    '8855=HB20 Vision 1.0 Flex 12V Mec.',
    '8856=HB20 Vision 1.6 Flex 16V Aut',
    '8857=HB20 Vision 1.6 Flex 16V Mec.',
  ]),
  civicFlex2020: list([
    '7692=Civic Sedan EX 2.0 Flex 16V Aut.4p',
    '7693=Civic Sedan EXL 2.0 Flex 16V Aut.4p',
    '8779=Civic Sedan LX 2.0 Flex 16V Aut. 4p',
    '7694=Civic Sedan SPORT 2.0 Flex 16V Aut.4p',
  ]),
  civicGas2020: list(['8281=Civic Coupe Si 1.5 TB 16V 208cv Mec. 2p', '7696=Civic Sedan TOURING 1.5 Turbo 16V Aut.4p']),
};

const CASES: Array<[keyof typeof FIPE, string, string, string]> = [
  ['corollaFlex2021', 'COROLLA', '2.0 VVT-IE FLEX XEI DIRECT SHIFT', '5194'],
  ['corollaFlex2021', 'COROLLA', '2.0 VVT-IE FLEX GLI DIRECT SHIFT', '8839'],
  ['corollaFlex2021', 'COROLLA', '2.0 VVT-IE FLEX ALTIS DIRECT SHIFT', '9300'],
  ['corollaHybrid2021', 'COROLLA', '1.8 VVT-I HYBRID FLEX ALTIS CVT', '9984'],
  ['corollaHybrid2021', 'COROLLA', '1.8 VVT-I HYBRID FLEX ALTIS PREMIUM CVT', '9985'],
  ['onix2022', 'ONIX', '1.0 FLEX LT MANUAL', '8949'],
  ['onix2022', 'ONIX', '1.0 FLEX PLUS LT MANUAL', '8950'],
  ['onix2022', 'ONIX', '1.0 TURBO FLEX PREMIER AUTOMÁTICO', '8894'],
  ['onix2022', 'ONIX', '1.0 TURBO FLEX PLUS LT AUTOMÁTICO', '8825'],
  ['onix2022', 'ONIX', '1.0 TURBO FLEX PLUS LTZ AUTOMÁTICO', '8827'],
  ['onix2022', 'ONIX', '1.0 FLEX MANUAL', '8988'],
  ['onix2022', 'ONIX', '1.0 TURBO FLEX AUTOMÁTICO', '8889'],
  ['onix2022', 'ONIX', '1.0 TURBO FLEX PLUS LTZ MANUAL', '8828'],
  ['onix2022', 'ONIX', '1.0 TURBO FLEX LTZ MANUAL', '8893'],
  ['onix2022', 'ONIX', '1.0 TURBO FLEX PLUS PREMIER AUTOMÁTICO', '8823'],
  ['onix2022', 'ONIX', '1.0 TURBO FLEX LTZ AUTOMÁTICO', '8892'],
  ['onix2022', 'ONIX', '1.0 TURBO FLEX LT MANUAL', '8891'],
  ['onix2022', 'ONIX', '1.0 TURBO FLEX LT AUTOMÁTICO', '8890'],
  ['onix2022', 'ONIX', '1.0 TURBO FLEX RS AUTOMÁTICO', '9211'],
  ['onix2022', 'ONIX', '1.0 TURBO FLEX PLUS AUTOMÁTICO', '8824'],
  ['onix2022', 'ONIX', '1.0 TURBO FLEX PLUS LT MANUAL', '8826'],
  ['tcross2022', 'T-CROSS', '1.4 250 TSI TOTAL FLEX HIGHLINE AUTOMÁTICO', '10375'],
  ['tcross2022', 'T-CROSS', '1.0 200 TSI TOTAL FLEX COMFORTLINE AUTOMÁTICO', '10374'],
  ['tcross2022', 'T-CROSS', '1.0 200 TSI TOTAL FLEX SENSE AUTOMÁTICO', '10376'],
  ['tcross2022', 'T-CROSS', '1.0 200 TSI TOTAL FLEX AUTOMÁTICO', '10373'],
  ['compassFlex2021', 'COMPASS', '2.0 16V FLEX LONGITUDE AUTOMÁTICO', '7759'],
  ['compassFlex2021', 'COMPASS', '2.0 16V FLEX LIMITED AUTOMÁTICO', '7758'],
  ['compassFlex2021', 'COMPASS', '2.0 16V FLEX SPORT AUTOMÁTICO', '7761'],
  ['compassDiesel2021', 'COMPASS', '2.0 16V DIESEL LIMITED 4X4 AUTOMÁTICO', '8039'],
  ['compassDiesel2021', 'COMPASS', '2.0 16V DIESEL LONGITUDE 4X4 AUTOMÁTICO', '7760'],
  ['compassDiesel2021', 'COMPASS', '2.0 16V DIESEL S 4X4 AUTOMÁTICO', '8663'],
  ['compassDiesel2021', 'COMPASS', '2.0 16V DIESEL TRAILHAWK 4X4 AUTOMÁTICO', '7762'],
  ['strada2022', 'STRADA', '1.4 FIRE FLEX ENDURANCE CS MANUAL', '9109'],
  ['strada2022', 'STRADA', '1.3 FIREFLY FLEX VOLCANO CD MANUAL', '9112'],
  ['strada2022', 'STRADA', '1.3 FIREFLY FLEX FREEDOM CS MANUAL', '9110'],
  ['strada2022', 'STRADA', '1.3 FIREFLY FLEX FREEDOM CD MANUAL', '9111'],
  ['strada2022', 'STRADA', '1.3 FIREFLY FLEX RANCH CD CVT', '9723'],
  ['strada2022', 'STRADA', '1.3 FIREFLY FLEX VOLCANO CD CVT', '9724'],
  ['strada2022', 'STRADA', '1.4 FIRE FLEX ENDURANCE CD MANUAL', '9108'],
  ['hb20_2021', 'HB20', '1.0 12V FLEX SENSE MANUAL', '8854'],
  ['hb20_2021', 'HB20', '1.0 12V FLEX EVOLUTION MANUAL', '8851'],
  ['hb20_2021', 'HB20', '1.0 12V FLEX VISION MANUAL', '8855'],
  ['hb20_2021', 'HB20', '1.0 TGDI FLEX SPORT AUTOMÁTICO', '9008'],
  ['hb20_2021', 'HB20', '1.6 16V FLEX VISION AUTOMÁTICO', '8856'],
  ['hb20_2021', 'HB20', '1.0 TGDI FLEX EVOLUTION AUTOMÁTICO', '8852'],
  ['hb20_2021', 'HB20', '1.0 TGDI FLEX DIAMOND AUTOMÁTICO', '8849'],
  ['hb20_2021', 'HB20', '1.0 TGDI FLEX DIAMOND PLUS AUTOMÁTICO', '8850'],
  ['hb20_2021', 'HB20', '1.6 16V FLEX VISION MANUAL', '8857'],
  ['civicFlex2020', 'CIVIC', '2.0 16V FLEXONE EXL 4P CVT', '7693'],
  ['civicFlex2020', 'CIVIC', '2.0 16V FLEXONE EX 4P CVT', '7692'],
  ['civicFlex2020', 'CIVIC', '2.0 16V FLEXONE SPORT 4P CVT', '7694'],
  ['civicFlex2020', 'CIVIC', '2.0 16V FLEXONE LX 4P CVT', '8779'],
  ['civicGas2020', 'CIVIC', '1.5 16V TURBO GASOLINA TOURING 4P CVT', '7696'],
];

describe('rankCandidates — real Webmotors ↔ FIPE pairs', () => {
  it.each(CASES)('%s · %s %s → %s', (pool, model, version, expected) => {
    const ranked = rankCandidates({ model, version }, FIPE[pool]);
    expect(ranked[0]?.code).toBe(expected);
  });

  it('reaches ≥ 95% top-1 accuracy on the table', () => {
    const hits = CASES.filter(([pool, model, version, expected]) => rankCandidates({ model, version }, FIPE[pool])[0]?.code === expected);
    expect(hits.length / CASES.length).toBeGreaterThanOrEqual(0.95);
  });

  it('drops technical conflicts (gearbox, cab)', () => {
    const ranked = rankCandidates({ model: 'STRADA', version: '1.3 FIREFLY FLEX VOLCANO CD MANUAL' }, FIPE.strada2022);
    expect(ranked.map((r) => r.code)).not.toContain('9724');
    expect(ranked.map((r) => r.code)).not.toContain('9110');
  });

  it('uses structured attributes when the text has no gearbox', () => {
    const ranked = rankCandidates(
      { model: 'COROLLA', version: '2.0 XEI', attrs: { transmission: 'Automática', engine: '2.0' } },
      FIPE.corollaFlex2021,
    );
    expect(ranked[0]?.code).toBe('5194');
  });
});

describe('model prefix and brand lookup', () => {
  it('matches the model at a token boundary', () => {
    expect(labelStartsWithModel(tokenize('Gol (novo) 1.0 Mi Total Flex 8V 2p'), 'GOL')).toBe(1);
    expect(labelStartsWithModel(tokenize('Golf Comfortline 1.4 TSI'), 'GOL')).toBe(0);
    // Hyphens split words, so the model spans two label tokens.
    expect(labelStartsWithModel(tokenize('C-180 Avantgarde 1.6 Turbo'), 'C 180')).toBe(2);
    expect(labelStartsWithModel(tokenize('T-Cross Sense 200 TSI'), 'T-CROSS')).toBe(2);
    expect(labelStartsWithModel(tokenize('HR-V EXL 1.8 16V Flex Aut.'), 'HR-V')).toBe(2);
  });

  it('reads "TYPE-R" and "TYPE R" as the same trim', () => {
    const [best] = rankCandidates({ model: 'CIVIC', version: '2.0 DI VTEC TURBO GASOLINA TYPE R MANUAL' }, [
      { code: '10727', label: 'Civic Type-R 2.0 Turbo 16V' },
      { code: '1', label: 'Civic Sedan Touring 1.5 Turbo 16V Aut.' },
    ]);
    expect(best?.code).toBe('10727');
    expect(best?.score).toBeGreaterThan(0.6);
  });

  it('maps Webmotors brands to FIPE brand codes', () => {
    const brands = [
      { code: '23', name: 'GM - Chevrolet' },
      { code: '59', name: 'VW - VolksWagen' },
      { code: '31', name: 'Kia Motors' },
      { code: '25', name: 'Honda' },
      { code: '13', name: 'Citroën' },
    ];
    expect(findBrandCode('CHEVROLET', brands)).toBe('23');
    expect(findBrandCode('VOLKSWAGEN', brands)).toBe('59');
    expect(findBrandCode('KIA', brands)).toBe('31');
    expect(findBrandCode('HONDA', brands)).toBe('25');
    expect(findBrandCode('CITROËN', brands)).toBe('13');
    expect(findBrandCode('TESLA', brands)).toBeUndefined();
  });

  it('detects fuel, gearbox and turbo', () => {
    expect(extractFeatures('1.8 VVT-I HYBRID FLEX ALTIS CVT')).toMatchObject({ fuel: 6, transmission: 'AUT', displacement: '1.8' });
    expect(extractFeatures('2.0 16V DIESEL S 4X4 AUTOMÁTICO')).toMatchObject({ fuel: 3, drive: '4X4' });
    expect(extractFeatures('1.0 TGDI FLEX SPORT AUTOMÁTICO').turbo).toBe(true);
    expect(extractFeatures('COMPASS LONGITUDE 2.0 4x4 Dies. 16V Aut.')).toMatchObject({ fuel: 3, transmission: 'AUT' });
  });

  it('is only confident without a price check when one candidate clearly wins', () => {
    expect(isConfidentWithoutPrice(rankCandidates({ model: 'COMPASS', version: '2.0 16V DIESEL TRAILHAWK 4X4 AUTOMÁTICO' }, FIPE.compassDiesel2021))).toBe(true);
    expect(isConfidentWithoutPrice(rankCandidates({ model: 'ONIX', version: '1.0 FLEX MANUAL' }, FIPE.onix2022))).toBe(false);
  });
});
