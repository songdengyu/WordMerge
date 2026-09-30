export const TEST_VITAL_NAMES = { hp: '生命', hunger: '饱食', water: '水分', temperature: '温度' } as const
export type TestVital = keyof typeof TEST_VITAL_NAMES
export type TestVitalCommand = { type: 'test-vital'; stat: TestVital; delta: -10 | 10 }
