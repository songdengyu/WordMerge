export const TEST_VITAL_NAMES = { hp: '生命', hunger: '饱食', water: '水分', temperature: '温度' } as const
export type TestVital = keyof typeof TEST_VITAL_NAMES
export type TestVitalCommand = { type: 'test-vital'; stat: TestVital; delta: -10 | 10 }

export const TEST_CURRENCY_NAMES = { gold: '金币', gems: '钻石' } as const
export type TestCurrency = keyof typeof TEST_CURRENCY_NAMES
export type TestCurrencyCommand = { type: 'test-currency'; currency: TestCurrency; delta: -10000 | 10000 }
