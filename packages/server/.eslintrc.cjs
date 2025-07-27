module.exports = {
  extends: ['@pokedex/eslint-config'],
  rules: {
    // Server-specific rules
    '@typescript-eslint/no-explicit-any': 'error',
  },
};
