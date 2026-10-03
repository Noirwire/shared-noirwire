import { ExtensionType, MintLayout, TOKEN_2022_PROGRAM_ID } from "@solana/spl-token";
import { Keypair, PublicKey, type AccountInfo } from "@solana/web3.js";

/** Where a Token-2022 mint's extensions start: the base account length plus the account-type byte. */
const EXTENSIONS_OFFSET = 166;
const ACCOUNT_TYPE_MINT = 1;

const AUTHORITY = Keypair.generate().publicKey;

function extension(type: ExtensionType, data: Buffer): Buffer {
  const header = Buffer.alloc(4);
  header.writeUInt16LE(type, 0);
  header.writeUInt16LE(data.length, 2);
  return Buffer.concat([header, data]);
}

function scaledUi(multiplier: number, scheduledAt: number, scheduled: number): Buffer {
  const data = Buffer.alloc(56);
  AUTHORITY.toBuffer().copy(data, 0);
  data.writeDoubleLE(multiplier, 32);
  data.writeBigInt64LE(BigInt(scheduledAt), 40);
  data.writeDoubleLE(scheduled, 48);
  return data;
}

export type MintOptions = {
  owner?: PublicKey;
  decimals?: number;
  defaultState?: number;
  paused?: boolean;
  hookProgram?: PublicKey;
  multiplier?: [current: number, scheduledAt: number, scheduled: number];
  /** Extra extensions by type, for the ones the profile does not accept. */
  extra?: ExtensionType[];
};

/**
 * A Token-2022 mint account as the chain returns it, carrying the extension
 * set every listed stock has unless an option says otherwise.
 */
export function mintAccount(options: MintOptions = {}): AccountInfo<Buffer> {
  const base = Buffer.alloc(EXTENSIONS_OFFSET);
  MintLayout.encode(
    {
      mintAuthorityOption: 1,
      mintAuthority: AUTHORITY,
      supply: 1_000_000n,
      decimals: options.decimals ?? 8,
      isInitialized: true,
      freezeAuthorityOption: 1,
      freezeAuthority: AUTHORITY,
    },
    base,
  );
  base[EXTENSIONS_OFFSET - 1] = ACCOUNT_TYPE_MINT;
  const data = Buffer.concat([
    base,
    extension(ExtensionType.PermanentDelegate, AUTHORITY.toBuffer()),
    extension(ExtensionType.DefaultAccountState, Buffer.from([options.defaultState ?? 1])),
    extension(ExtensionType.ScaledUiAmountConfig, scaledUi(...(options.multiplier ?? [1, 0, 1]))),
    extension(
      ExtensionType.PausableConfig,
      Buffer.concat([AUTHORITY.toBuffer(), Buffer.from([options.paused ? 1 : 0])]),
    ),
    extension(
      ExtensionType.TransferHook,
      Buffer.concat([AUTHORITY.toBuffer(), (options.hookProgram ?? PublicKey.default).toBuffer()]),
    ),
    ...(options.extra ?? []).map((type) => extension(type, Buffer.alloc(8))),
  ]);
  return {
    data,
    owner: options.owner ?? TOKEN_2022_PROGRAM_ID,
    lamports: 1,
    executable: false,
  };
}
