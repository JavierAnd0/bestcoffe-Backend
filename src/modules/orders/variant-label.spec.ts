import { variantLabel } from './variant-label';

describe('variantLabel', () => {
  it('café: peso y molido legibles', () => {
    expect(variantLabel({ sizeGrams: 340, grind: 'WHOLE_BEAN' })).toBe(
      '340 g · Grano',
    );
    expect(
      variantLabel({
        sizeGrams: 1000,
        grind: 'ESPRESSO',
        productType: 'BLEND',
      }),
    ).toBe('1 kg · Espresso');
  });

  it('accesorio: sin peso ni molido', () => {
    expect(
      variantLabel({
        sizeGrams: 300,
        grind: 'WHOLE_BEAN',
        productType: 'ACCESSORY',
      }),
    ).toBe('Accesorio');
  });
});
