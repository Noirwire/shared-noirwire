/**
 * Real records written by the previous storage format (`noirwire.wallet.v8`),
 * captured from the code that produced them, so the upgrade path is tested
 * against what is actually sitting in people's browsers rather than against
 * something the current code made up.
 */

export const FIXTURE_PHRASE =
  "legal winner thank year wave sausage worth useful legal winner thank yellow".split(" ");

export const FIXTURE_PASSWORD = "correct-horse-battery";

/** A whole v8 wallet: the phrase encrypted, every address, label and activity entry in the clear. */
export const V8_WALLET_JSON =
  '{"createdAt":1750000000000,"vault":{"v":1,"kdf":"PBKDF2-SHA256","iterations":600000,"salt":"G7CtFZNv4M54s5X/v0mzaA==","iv":"7QH9KxDE55Lmkocg","ciphertext":"CgUr4O43Klst4rnRUMG8EV0R8UKG5MFnAJVW0j3/Uq4OwI7NRYISaFpgqXZhq8p9lqjX+jHbn6fP0wP/iuRoyNxn4e8KL9kMNc8NfyT5uniqJ/3l8CZ/pRJblw=="},"derivationScheme":"app","funding":{"address":"BLeUXTx9thHGT7VJUtF9vHEmfMDgW1nnKZ9UVer2CoLX","sol":1.5,"tokens":{"USDC":25}},"accounts":[{"id":"acc_fixture1","label":"Investing","address":"EdjcxP8MmXP4yRHguEVoH75kbXVfZNFXPgNfL9NqcXXK","derivationIndex":1,"createdAt":1750000000000,"archivedAt":null,"holdings":[{"symbol":"SOL","amount":0.2,"cost":30},{"symbol":"USDC","amount":10,"cost":10}]},{"id":"acc_fixture2","label":"Rainy day","address":"AFG4eoTGSCdNemYFQhhJBqT7tJwo3WdC4Raeq9SkXx7p","derivationIndex":2,"createdAt":1750000001000,"archivedAt":null,"holdings":[]}],"activity":[{"id":"act_fixture1","accountId":"acc_fixture1","at":1750000002000,"kind":"send","symbol":"USDC","amount":5,"usd":5,"counterparty":"EMcYx649Zj64Tk32Xg6c7eYkLyJ7y2qjpnrQVcqCvJKA"}],"watchlist":["NVDAx","SPYx"]}';

/**
 * A v8 vault of the same phrase whose password was used exactly as typed.
 * NFKC changes this one (full-width letters, a ligature, circled digits), so
 * it only opens if the typed form is tried.
 */
export const UNNORMALISED_PASSWORD = "\uff50\uff41\uff53\uff53 \ufb01re \u2460\u2461\u2462 horse";

export const UNNORMALISED_VAULT_JSON =
  '{"v":1,"kdf":"PBKDF2-SHA256","iterations":600000,"salt":"rysMq3BFa9WLw1lXseLHrQ==","iv":"vCVsb9hakzt33IA4","ciphertext":"MjN4cP3W7oUMql+8kanSe7MznkUeT1rFWaeg6XsQS0bHvyI9APj06MnBNESikhwpH8AuqSCPd23nP6ZNx/gIOJWVBc+KfIPnsMOFxhuDJF++tucR7RyTLoWN0A=="}';

/**
 * A current-format envelope sealed by the web app's own keystore, over a
 * record of `FIXTURE_PHRASE` whose addresses are the ones it derives. Its
 * password has a composed accent, so a decomposed spelling of it opens it
 * only through NFKC normalisation.
 */
export const WEB_ENVELOPE_PASSWORD = "café-orbit-lamp-quarry";

export const WEB_ENVELOPE_JSON =
  '{"v":2,"kdf":"PBKDF2-SHA256","iterations":600000,"salt":"qqoA0Gv9DNeUpaiEyu6m6Q==","iv":"AllZ4vyU9NeenItv","ciphertext":"WmYBynVX6Vl4Bk57FI+RE5LgeUeh+Ci73q+skxje7nI248S1jJL4yA/D5g4e1DT4DANNckGJVHxOpb7wvNj+u1rtCpDYmiuMenay9tSdPa3VraNEu9oMuVvypDf6bXW/bIx3kVoqqhM7xfePpdNsklo5p24LHLsc58jEmtQ4bqGwnC1hSp+bh7lRp71oa1XsgaObdlDBNctSQ9fpav+pIsRtoX/aBlImF4YqlgPvRMlS5A8S73YBPjxdH7SD6oeboudPENGS38EGFqmJt5CfmfFb4FbJYmIfIVbcLFZglJERnDQy3aQUsj/hv+84dwEvCRs7gimSlLHzj8gOAgJ36MQ8ugLLTgHzbyL+TZt0IsWPFeRgLC4BU8c+mhau4dh+ah1m5WR2xs+iiRk8Un7zq7IQD+wmxvgpyqjOilSOYnsQ8THEWEyvvp+hyOgUcnvStocPiu1tvmPvdTfIonFIryqC1Q2OTTWYKaIws7aH74gDT4YwbEB819dAbq/nggXHL83nPzR3/0JNLDWR3+cErbmgXz5sO+5KJrtsvHv7RCIKkGNMv/B/NMxat87Ie4uG/QPTpWMZ/UiEYmFYB4Yt+vK3wyqiMBLkafNLCfu9zT7u4hY3Ku4RD1HzI8YUAq2uM8zVjo5OtfCZMag6XFdARqiVyw=="}';
