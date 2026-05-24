import type { Config } from 'jest';

const config: Config = {
  preset: 'ts-jest',
  testEnvironment: 'node',
  roots: ['<rootDir>/src'],
  moduleNameMapper: {
    '^@/(.*)$': '<rootDir>/src/$1',
    // Stub CSS/SCSS module imports so component tests can load .tsx files.
    '\\.(css|scss|sass)$': '<rootDir>/src/test/styleStub.ts',
  },
};

export default config;
