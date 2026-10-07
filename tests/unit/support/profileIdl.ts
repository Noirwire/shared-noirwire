/**
 * What the profile program's IDL says of its three profile instructions, and
 * the errors it names: copied from `target/idl/noirwire_profile.json` of the
 * program's own repository, and copied again whenever the program changes.
 * Only what the tests hold the client to is here.
 */

export type IdlAccount = { name: string; signer?: true; writable?: true; address?: string };

export type IdlInstruction = {
  name: string;
  discriminator: number[];
  accounts: IdlAccount[];
  args: { name: string; type: string }[];
};

const PERMISSION_PROGRAM = "ACLseoPoyC3cBqoUtkbjZ4aDrkurZW86v19pXz2XQnp1";
const VAULT = "MagicVau1t999999999999999999999999999999999";
const MAGIC_PROGRAM = "Magic11111111111111111111111111111111111111";

export const PROFILE_IDL: { address: string; instructions: IdlInstruction[]; errors: string[] } = {
  address: "AiS6fT2x5XELHvZPrLfdzydC9xUazjS6r4z4bNDTqtHQ",
  instructions: [
    {
      name: "close_profile",
      discriminator: [167, 36, 181, 8, 136, 158, 46, 207],
      accounts: [
        { name: "owner", signer: true },
        { name: "sponsor", writable: true },
        { name: "profile", writable: true },
        { name: "permission", writable: true },
        { name: "permission_program", address: PERMISSION_PROGRAM },
        { name: "vault", writable: true, address: VAULT },
        { name: "magic_program", address: MAGIC_PROGRAM },
      ],
      args: [],
    },
    {
      name: "create_profile",
      discriminator: [225, 205, 234, 143, 17, 186, 50, 220],
      accounts: [
        { name: "gate", signer: true },
        { name: "owner", signer: true },
        { name: "sponsor", writable: true },
        { name: "profile", writable: true },
        { name: "permission", writable: true },
        { name: "permission_program", address: PERMISSION_PROGRAM },
        { name: "vault", writable: true, address: VAULT },
        { name: "magic_program", address: MAGIC_PROGRAM },
      ],
      args: [{ name: "data", type: "bytes" }],
    },
    {
      name: "write_profile",
      discriminator: [42, 24, 36, 43, 230, 170, 36, 247],
      accounts: [
        { name: "gate", signer: true },
        { name: "owner", signer: true },
        { name: "sponsor", writable: true },
        { name: "profile", writable: true },
        { name: "vault", writable: true, address: VAULT },
        { name: "magic_program", address: MAGIC_PROGRAM },
      ],
      args: [
        { name: "expected_revision", type: "u64" },
        { name: "data", type: "bytes" },
      ],
    },
  ],
  errors: [
    "NotUpgradeAuthority",
    "NotAdmin",
    "GateMissing",
    "Paused",
    "EmptyRecord",
    "RecordTooLarge",
    "InvalidSizeLimit",
    "ProfileExists",
    "ProfileMissing",
    "NotOwner",
    "StaleRevision",
    "UnknownLayout",
    "BelowRent",
    "Overflow",
    "NotNominee",
  ],
};
