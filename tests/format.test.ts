import { describe, expect, it } from 'vitest';
import { vehicleName } from '../src/lib/format';

describe('vehicleName', () => {
  it.each([
    ['HONDA', 'Honda'],
    ['CIVIC', 'Civic'],
    ['LAND ROVER', 'Land Rover'],
    ['MERCEDES-BENZ', 'Mercedes-Benz'],
    ['BMW', 'BMW'],
    ['GWM', 'GWM'],
    ['BYD', 'BYD'],
    ['KIA', 'Kia'],
    ['JAC', 'JAC'],
    ['HR-V', 'HR-V'],
    ['T-CROSS', 'T-Cross'],
    ['X1', 'X1'],
    ['HB20', 'HB20'],
    ['C 180', 'C 180'],
    ['GLA', 'GLA'],
    ['KA', 'Ka'],
    ['UP!', 'Up!'],
    ['GOL', 'Gol'],
    ['RANGE ROVER EVOQUE', 'Range Rover Evoque'],
    ['Already Mixed', 'Already Mixed'],
  ])('%s → %s', (input, expected) => {
    expect(vehicleName(input)).toBe(expected);
  });
});
