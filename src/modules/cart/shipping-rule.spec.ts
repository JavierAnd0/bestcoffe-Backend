import { resolveShippingRule } from './shipping-rule';

describe('resolveShippingRule', () => {
  it('usa los valores guardados por la tienda', () => {
    expect(
      resolveShippingRule({
        freeShippingThresholdCents: 45_000_00,
        shippingFlatCents: 9_000_00,
      }),
    ).toEqual({
      freeShippingThresholdCents: 45_000_00,
      shippingFlatCents: 9_000_00,
    });
  });

  it('sin valores (o inválidos) usa los de la plataforma', () => {
    const defaults = {
      freeShippingThresholdCents: 150_000_00,
      shippingFlatCents: 12_000_00,
    };
    expect(resolveShippingRule(null)).toEqual(defaults);
    expect(
      resolveShippingRule({
        freeShippingThresholdCents: '1',
        shippingFlatCents: -5,
      }),
    ).toEqual(defaults);
  });

  it('acepta envío gratis siempre (umbral 0) y tarifa 0', () => {
    expect(
      resolveShippingRule({
        freeShippingThresholdCents: 0,
        shippingFlatCents: 0,
      }),
    ).toEqual({ freeShippingThresholdCents: 0, shippingFlatCents: 0 });
  });
});
