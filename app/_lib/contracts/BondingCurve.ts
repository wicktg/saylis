/**
 * Generated from contracts/out/BondingCurve.sol/BondingCurve.json by
 * contracts/script/generate-frontend-artifacts.js. DO NOT HAND-EDIT —
 * re-run that script after any change to contracts/src/BondingCurve.sol.
 */
export const BONDING_CURVE_ABI = [
  {
    "type": "constructor",
    "inputs": [
      {
        "name": "token_",
        "type": "address",
        "internalType": "contract IERC20"
      },
      {
        "name": "virtualEthReserve_",
        "type": "uint256",
        "internalType": "uint256"
      },
      {
        "name": "virtualTokenReserve_",
        "type": "uint256",
        "internalType": "uint256"
      },
      {
        "name": "creator_",
        "type": "address",
        "internalType": "address"
      },
      {
        "name": "protocolTreasury_",
        "type": "address",
        "internalType": "address"
      },
      {
        "name": "delayBlocks_",
        "type": "uint256",
        "internalType": "uint256"
      },
      {
        "name": "graduationThreshold_",
        "type": "uint256",
        "internalType": "uint256"
      },
      {
        "name": "migrator_",
        "type": "address",
        "internalType": "address"
      },
      {
        "name": "sellTaxBps_",
        "type": "uint256",
        "internalType": "uint256"
      },
      {
        "name": "ethUsdPriceFeed_",
        "type": "address",
        "internalType": "address"
      },
      {
        "name": "creatorFeeRecipient_",
        "type": "address",
        "internalType": "address"
      },
      {
        "name": "infoFiBps_",
        "type": "uint256",
        "internalType": "uint256"
      },
      {
        "name": "infoFiCampaign_",
        "type": "address",
        "internalType": "address"
      },
      {
        "name": "referralVault_",
        "type": "address",
        "internalType": "address"
      }
    ],
    "stateMutability": "nonpayable"
  },
  {
    "type": "function",
    "name": "BPS_DENOMINATOR",
    "inputs": [],
    "outputs": [
      {
        "name": "",
        "type": "uint256",
        "internalType": "uint256"
      }
    ],
    "stateMutability": "view"
  },
  {
    "type": "function",
    "name": "CREATOR_SHARE_BPS",
    "inputs": [],
    "outputs": [
      {
        "name": "",
        "type": "uint256",
        "internalType": "uint256"
      }
    ],
    "stateMutability": "view"
  },
  {
    "type": "function",
    "name": "FEE_BPS",
    "inputs": [],
    "outputs": [
      {
        "name": "",
        "type": "uint256",
        "internalType": "uint256"
      }
    ],
    "stateMutability": "view"
  },
  {
    "type": "function",
    "name": "GRADUATION_BONUS_BPS",
    "inputs": [],
    "outputs": [
      {
        "name": "",
        "type": "uint256",
        "internalType": "uint256"
      }
    ],
    "stateMutability": "view"
  },
  {
    "type": "function",
    "name": "LIQUIDITY_RESERVE_BPS",
    "inputs": [],
    "outputs": [
      {
        "name": "",
        "type": "uint256",
        "internalType": "uint256"
      }
    ],
    "stateMutability": "view"
  },
  {
    "type": "function",
    "name": "MAX_INFOFI_BPS",
    "inputs": [],
    "outputs": [
      {
        "name": "",
        "type": "uint256",
        "internalType": "uint256"
      }
    ],
    "stateMutability": "view"
  },
  {
    "type": "function",
    "name": "MAX_SELL_TAX_BPS",
    "inputs": [],
    "outputs": [
      {
        "name": "",
        "type": "uint256",
        "internalType": "uint256"
      }
    ],
    "stateMutability": "view"
  },
  {
    "type": "function",
    "name": "MAX_WALLET_BPS",
    "inputs": [],
    "outputs": [
      {
        "name": "",
        "type": "uint256",
        "internalType": "uint256"
      }
    ],
    "stateMutability": "view"
  },
  {
    "type": "function",
    "name": "PRICE_STALENESS_THRESHOLD",
    "inputs": [],
    "outputs": [
      {
        "name": "",
        "type": "uint256",
        "internalType": "uint256"
      }
    ],
    "stateMutability": "view"
  },
  {
    "type": "function",
    "name": "REFERRAL_BPS",
    "inputs": [],
    "outputs": [
      {
        "name": "",
        "type": "uint256",
        "internalType": "uint256"
      }
    ],
    "stateMutability": "view"
  },
  {
    "type": "function",
    "name": "WHALE_TIER_1_BPS",
    "inputs": [],
    "outputs": [
      {
        "name": "",
        "type": "uint256",
        "internalType": "uint256"
      }
    ],
    "stateMutability": "view"
  },
  {
    "type": "function",
    "name": "WHALE_TIER_1_MCAP_USD",
    "inputs": [],
    "outputs": [
      {
        "name": "",
        "type": "uint256",
        "internalType": "uint256"
      }
    ],
    "stateMutability": "view"
  },
  {
    "type": "function",
    "name": "WHALE_TIER_2_BPS",
    "inputs": [],
    "outputs": [
      {
        "name": "",
        "type": "uint256",
        "internalType": "uint256"
      }
    ],
    "stateMutability": "view"
  },
  {
    "type": "function",
    "name": "WHALE_TIER_2_MCAP_USD",
    "inputs": [],
    "outputs": [
      {
        "name": "",
        "type": "uint256",
        "internalType": "uint256"
      }
    ],
    "stateMutability": "view"
  },
  {
    "type": "function",
    "name": "WHALE_TIER_3_BPS",
    "inputs": [],
    "outputs": [
      {
        "name": "",
        "type": "uint256",
        "internalType": "uint256"
      }
    ],
    "stateMutability": "view"
  },
  {
    "type": "function",
    "name": "WHALE_TIER_3_MCAP_USD",
    "inputs": [],
    "outputs": [
      {
        "name": "",
        "type": "uint256",
        "internalType": "uint256"
      }
    ],
    "stateMutability": "view"
  },
  {
    "type": "function",
    "name": "WHALE_TIER_4_BPS",
    "inputs": [],
    "outputs": [
      {
        "name": "",
        "type": "uint256",
        "internalType": "uint256"
      }
    ],
    "stateMutability": "view"
  },
  {
    "type": "function",
    "name": "WHALE_TIER_4_MCAP_USD",
    "inputs": [],
    "outputs": [
      {
        "name": "",
        "type": "uint256",
        "internalType": "uint256"
      }
    ],
    "stateMutability": "view"
  },
  {
    "type": "function",
    "name": "WHALE_TIER_5_BPS",
    "inputs": [],
    "outputs": [
      {
        "name": "",
        "type": "uint256",
        "internalType": "uint256"
      }
    ],
    "stateMutability": "view"
  },
  {
    "type": "function",
    "name": "buy",
    "inputs": [
      {
        "name": "minTokensOut",
        "type": "uint256",
        "internalType": "uint256"
      }
    ],
    "outputs": [
      {
        "name": "tokensOut",
        "type": "uint256",
        "internalType": "uint256"
      }
    ],
    "stateMutability": "payable"
  },
  {
    "type": "function",
    "name": "creator",
    "inputs": [],
    "outputs": [
      {
        "name": "",
        "type": "address",
        "internalType": "address"
      }
    ],
    "stateMutability": "view"
  },
  {
    "type": "function",
    "name": "creatorFeeRecipient",
    "inputs": [],
    "outputs": [
      {
        "name": "",
        "type": "address",
        "internalType": "address"
      }
    ],
    "stateMutability": "view"
  },
  {
    "type": "function",
    "name": "creatorFeesOwed",
    "inputs": [],
    "outputs": [
      {
        "name": "",
        "type": "uint256",
        "internalType": "uint256"
      }
    ],
    "stateMutability": "view"
  },
  {
    "type": "function",
    "name": "cumulativeVolume",
    "inputs": [],
    "outputs": [
      {
        "name": "",
        "type": "uint256",
        "internalType": "uint256"
      }
    ],
    "stateMutability": "view"
  },
  {
    "type": "function",
    "name": "currentCreatorFeeShareBps",
    "inputs": [],
    "outputs": [
      {
        "name": "",
        "type": "uint256",
        "internalType": "uint256"
      }
    ],
    "stateMutability": "pure"
  },
  {
    "type": "function",
    "name": "currentMarketCapUsd",
    "inputs": [],
    "outputs": [
      {
        "name": "mcapUsd18",
        "type": "uint256",
        "internalType": "uint256"
      },
      {
        "name": "valid",
        "type": "bool",
        "internalType": "bool"
      }
    ],
    "stateMutability": "view"
  },
  {
    "type": "function",
    "name": "currentWhaleThresholdBps",
    "inputs": [],
    "outputs": [
      {
        "name": "",
        "type": "uint256",
        "internalType": "uint256"
      }
    ],
    "stateMutability": "view"
  },
  {
    "type": "function",
    "name": "currentWhaleThresholdTokens",
    "inputs": [],
    "outputs": [
      {
        "name": "",
        "type": "uint256",
        "internalType": "uint256"
      }
    ],
    "stateMutability": "view"
  },
  {
    "type": "function",
    "name": "delayBlocks",
    "inputs": [],
    "outputs": [
      {
        "name": "",
        "type": "uint256",
        "internalType": "uint256"
      }
    ],
    "stateMutability": "view"
  },
  {
    "type": "function",
    "name": "ethReserve",
    "inputs": [],
    "outputs": [
      {
        "name": "",
        "type": "uint256",
        "internalType": "uint256"
      }
    ],
    "stateMutability": "view"
  },
  {
    "type": "function",
    "name": "ethUsdPriceFeed",
    "inputs": [],
    "outputs": [
      {
        "name": "",
        "type": "address",
        "internalType": "contract AggregatorV3Interface"
      }
    ],
    "stateMutability": "view"
  },
  {
    "type": "function",
    "name": "ethUsdPriceFeedDecimals",
    "inputs": [],
    "outputs": [
      {
        "name": "",
        "type": "uint8",
        "internalType": "uint8"
      }
    ],
    "stateMutability": "view"
  },
  {
    "type": "function",
    "name": "getPrice",
    "inputs": [],
    "outputs": [
      {
        "name": "",
        "type": "uint256",
        "internalType": "uint256"
      }
    ],
    "stateMutability": "view"
  },
  {
    "type": "function",
    "name": "graduated",
    "inputs": [],
    "outputs": [
      {
        "name": "",
        "type": "bool",
        "internalType": "bool"
      }
    ],
    "stateMutability": "view"
  },
  {
    "type": "function",
    "name": "graduationThreshold",
    "inputs": [],
    "outputs": [
      {
        "name": "",
        "type": "uint256",
        "internalType": "uint256"
      }
    ],
    "stateMutability": "view"
  },
  {
    "type": "function",
    "name": "infoFiBps",
    "inputs": [],
    "outputs": [
      {
        "name": "",
        "type": "uint256",
        "internalType": "uint256"
      }
    ],
    "stateMutability": "view"
  },
  {
    "type": "function",
    "name": "infoFiCampaign",
    "inputs": [],
    "outputs": [
      {
        "name": "",
        "type": "address",
        "internalType": "address"
      }
    ],
    "stateMutability": "view"
  },
  {
    "type": "function",
    "name": "infoFiReserveTokens",
    "inputs": [],
    "outputs": [
      {
        "name": "",
        "type": "uint256",
        "internalType": "uint256"
      }
    ],
    "stateMutability": "view"
  },
  {
    "type": "function",
    "name": "launchBlock",
    "inputs": [],
    "outputs": [
      {
        "name": "",
        "type": "uint256",
        "internalType": "uint256"
      }
    ],
    "stateMutability": "view"
  },
  {
    "type": "function",
    "name": "liquidityReserveTokens",
    "inputs": [],
    "outputs": [
      {
        "name": "",
        "type": "uint256",
        "internalType": "uint256"
      }
    ],
    "stateMutability": "view"
  },
  {
    "type": "function",
    "name": "maxWalletTokens",
    "inputs": [],
    "outputs": [
      {
        "name": "",
        "type": "uint256",
        "internalType": "uint256"
      }
    ],
    "stateMutability": "view"
  },
  {
    "type": "function",
    "name": "migrationExecuted",
    "inputs": [],
    "outputs": [
      {
        "name": "",
        "type": "bool",
        "internalType": "bool"
      }
    ],
    "stateMutability": "view"
  },
  {
    "type": "function",
    "name": "migrator",
    "inputs": [],
    "outputs": [
      {
        "name": "",
        "type": "address",
        "internalType": "address"
      }
    ],
    "stateMutability": "view"
  },
  {
    "type": "function",
    "name": "protocolFeesOwed",
    "inputs": [],
    "outputs": [
      {
        "name": "",
        "type": "uint256",
        "internalType": "uint256"
      }
    ],
    "stateMutability": "view"
  },
  {
    "type": "function",
    "name": "protocolTreasury",
    "inputs": [],
    "outputs": [
      {
        "name": "",
        "type": "address",
        "internalType": "address"
      }
    ],
    "stateMutability": "view"
  },
  {
    "type": "function",
    "name": "quoteBuy",
    "inputs": [
      {
        "name": "ethIn",
        "type": "uint256",
        "internalType": "uint256"
      }
    ],
    "outputs": [
      {
        "name": "tokensOut",
        "type": "uint256",
        "internalType": "uint256"
      }
    ],
    "stateMutability": "view"
  },
  {
    "type": "function",
    "name": "quoteSell",
    "inputs": [
      {
        "name": "tokenAmount",
        "type": "uint256",
        "internalType": "uint256"
      }
    ],
    "outputs": [
      {
        "name": "netEthOut",
        "type": "uint256",
        "internalType": "uint256"
      }
    ],
    "stateMutability": "view"
  },
  {
    "type": "function",
    "name": "quoteSellGross",
    "inputs": [
      {
        "name": "tokenAmount",
        "type": "uint256",
        "internalType": "uint256"
      }
    ],
    "outputs": [
      {
        "name": "",
        "type": "uint256",
        "internalType": "uint256"
      }
    ],
    "stateMutability": "view"
  },
  {
    "type": "function",
    "name": "realEthReserve",
    "inputs": [],
    "outputs": [
      {
        "name": "",
        "type": "uint256",
        "internalType": "uint256"
      }
    ],
    "stateMutability": "view"
  },
  {
    "type": "function",
    "name": "realTokenReserve",
    "inputs": [],
    "outputs": [
      {
        "name": "",
        "type": "uint256",
        "internalType": "uint256"
      }
    ],
    "stateMutability": "view"
  },
  {
    "type": "function",
    "name": "referralVault",
    "inputs": [],
    "outputs": [
      {
        "name": "",
        "type": "address",
        "internalType": "address"
      }
    ],
    "stateMutability": "view"
  },
  {
    "type": "function",
    "name": "referrer",
    "inputs": [],
    "outputs": [
      {
        "name": "",
        "type": "address",
        "internalType": "address"
      }
    ],
    "stateMutability": "view"
  },
  {
    "type": "function",
    "name": "sell",
    "inputs": [
      {
        "name": "tokenAmount",
        "type": "uint256",
        "internalType": "uint256"
      },
      {
        "name": "minEthOut",
        "type": "uint256",
        "internalType": "uint256"
      }
    ],
    "outputs": [
      {
        "name": "netEthOut",
        "type": "uint256",
        "internalType": "uint256"
      }
    ],
    "stateMutability": "nonpayable"
  },
  {
    "type": "function",
    "name": "sellTaxBps",
    "inputs": [],
    "outputs": [
      {
        "name": "",
        "type": "uint256",
        "internalType": "uint256"
      }
    ],
    "stateMutability": "view"
  },
  {
    "type": "function",
    "name": "token",
    "inputs": [],
    "outputs": [
      {
        "name": "",
        "type": "address",
        "internalType": "contract IERC20"
      }
    ],
    "stateMutability": "view"
  },
  {
    "type": "function",
    "name": "tokenDecimals",
    "inputs": [],
    "outputs": [
      {
        "name": "",
        "type": "uint8",
        "internalType": "uint8"
      }
    ],
    "stateMutability": "view"
  },
  {
    "type": "function",
    "name": "tokenReserve",
    "inputs": [],
    "outputs": [
      {
        "name": "",
        "type": "uint256",
        "internalType": "uint256"
      }
    ],
    "stateMutability": "view"
  },
  {
    "type": "function",
    "name": "virtualEthReserve",
    "inputs": [],
    "outputs": [
      {
        "name": "",
        "type": "uint256",
        "internalType": "uint256"
      }
    ],
    "stateMutability": "view"
  },
  {
    "type": "function",
    "name": "virtualTokenReserve",
    "inputs": [],
    "outputs": [
      {
        "name": "",
        "type": "uint256",
        "internalType": "uint256"
      }
    ],
    "stateMutability": "view"
  },
  {
    "type": "function",
    "name": "withdrawCreatorFees",
    "inputs": [],
    "outputs": [
      {
        "name": "amount",
        "type": "uint256",
        "internalType": "uint256"
      }
    ],
    "stateMutability": "nonpayable"
  },
  {
    "type": "function",
    "name": "withdrawForMigration",
    "inputs": [],
    "outputs": [
      {
        "name": "ethAmount",
        "type": "uint256",
        "internalType": "uint256"
      },
      {
        "name": "tokenAmount",
        "type": "uint256",
        "internalType": "uint256"
      }
    ],
    "stateMutability": "nonpayable"
  },
  {
    "type": "function",
    "name": "withdrawProtocolFees",
    "inputs": [],
    "outputs": [
      {
        "name": "amount",
        "type": "uint256",
        "internalType": "uint256"
      }
    ],
    "stateMutability": "nonpayable"
  },
  {
    "type": "event",
    "name": "Buy",
    "inputs": [
      {
        "name": "buyer",
        "type": "address",
        "indexed": true,
        "internalType": "address"
      },
      {
        "name": "ethIn",
        "type": "uint256",
        "indexed": false,
        "internalType": "uint256"
      },
      {
        "name": "tokensOut",
        "type": "uint256",
        "indexed": false,
        "internalType": "uint256"
      }
    ],
    "anonymous": false
  },
  {
    "type": "event",
    "name": "CreatorFeesWithdrawn",
    "inputs": [
      {
        "name": "amount",
        "type": "uint256",
        "indexed": false,
        "internalType": "uint256"
      }
    ],
    "anonymous": false
  },
  {
    "type": "event",
    "name": "FeeCollected",
    "inputs": [
      {
        "name": "isBuy",
        "type": "bool",
        "indexed": true,
        "internalType": "bool"
      },
      {
        "name": "feeAmount",
        "type": "uint256",
        "indexed": false,
        "internalType": "uint256"
      },
      {
        "name": "creatorFee",
        "type": "uint256",
        "indexed": false,
        "internalType": "uint256"
      },
      {
        "name": "protocolFee",
        "type": "uint256",
        "indexed": false,
        "internalType": "uint256"
      }
    ],
    "anonymous": false
  },
  {
    "type": "event",
    "name": "Graduated",
    "inputs": [
      {
        "name": "ethRaised",
        "type": "uint256",
        "indexed": false,
        "internalType": "uint256"
      },
      {
        "name": "bonusAmount",
        "type": "uint256",
        "indexed": false,
        "internalType": "uint256"
      },
      {
        "name": "blockNumber",
        "type": "uint256",
        "indexed": false,
        "internalType": "uint256"
      }
    ],
    "anonymous": false
  },
  {
    "type": "event",
    "name": "MigrationWithdrawn",
    "inputs": [
      {
        "name": "migrator",
        "type": "address",
        "indexed": true,
        "internalType": "address"
      },
      {
        "name": "ethAmount",
        "type": "uint256",
        "indexed": false,
        "internalType": "uint256"
      },
      {
        "name": "tokenAmount",
        "type": "uint256",
        "indexed": false,
        "internalType": "uint256"
      }
    ],
    "anonymous": false
  },
  {
    "type": "event",
    "name": "ProtocolFeesWithdrawn",
    "inputs": [
      {
        "name": "amount",
        "type": "uint256",
        "indexed": false,
        "internalType": "uint256"
      }
    ],
    "anonymous": false
  },
  {
    "type": "event",
    "name": "Sell",
    "inputs": [
      {
        "name": "seller",
        "type": "address",
        "indexed": true,
        "internalType": "address"
      },
      {
        "name": "tokensIn",
        "type": "uint256",
        "indexed": false,
        "internalType": "uint256"
      },
      {
        "name": "ethOut",
        "type": "uint256",
        "indexed": false,
        "internalType": "uint256"
      }
    ],
    "anonymous": false
  },
  {
    "type": "event",
    "name": "SellTaxCollected",
    "inputs": [
      {
        "name": "seller",
        "type": "address",
        "indexed": true,
        "internalType": "address"
      },
      {
        "name": "amount",
        "type": "uint256",
        "indexed": false,
        "internalType": "uint256"
      }
    ],
    "anonymous": false
  },
  {
    "type": "error",
    "name": "AntiSnipeDelayActive",
    "inputs": [
      {
        "name": "currentBlock",
        "type": "uint256",
        "internalType": "uint256"
      },
      {
        "name": "unlockBlock",
        "type": "uint256",
        "internalType": "uint256"
      }
    ]
  },
  {
    "type": "error",
    "name": "MaxWalletExceeded",
    "inputs": [
      {
        "name": "attemptedBalance",
        "type": "uint256",
        "internalType": "uint256"
      },
      {
        "name": "maxWalletTokens",
        "type": "uint256",
        "internalType": "uint256"
      }
    ]
  },
  {
    "type": "error",
    "name": "ReentrancyGuardReentrantCall",
    "inputs": []
  },
  {
    "type": "error",
    "name": "SafeERC20FailedOperation",
    "inputs": [
      {
        "name": "token",
        "type": "address",
        "internalType": "address"
      }
    ]
  },
  {
    "type": "error",
    "name": "TokenGraduated",
    "inputs": []
  }
] as const;

export const BONDING_CURVE_BYTECODE =
  "0x6103408060405234610565576101c0816130ad80380380916100218285610b44565b833981010312610565578051906001600160a01b03821680830361056557816020810151604082015161005660608401610b7b565b9161006360808501610b7b565b918460a081015160c082015161007b60e08401610b7b565b90610100840151926100c16101a06101606100a661014061009f6101208b01610b7b565b9901610b7b565b9c01519d6100b76101808201610b7b565b6103205201610b7b565b9760017f9b779b17422d0df92223018b32b4d1fa46e071723d6817e2486d003becc55f00558b15610af3578715610a9f578615610a49576001600160a01b038a16156109f6576001600160a01b03811615610999578215610944576001600160a01b038416156108f05761012c85116108ab576001600160a01b0386161561084d576101f48d116107f7578c159a8b80156107e2575b15610787576004978f8e6020916080526040519a8b809263313ce56760e01b82525afa998a1561055a5760049a60209a5f9161076a575b5060a05260c05260e0526101008b90526001600160a01b0381166107655750895b61012052610140524361016052610180526102405261026052610280526001600160a01b03166102a081905260405163313ce56760e01b815292839182905afa90811561055a575f91610736575b506102c0526102e08190526001600160a01b031690816106be5750505f5b610300526040516370a0823160e01b815230600482015290602082602481865afa91821561055a575f9261068a575b508115610645576040516318160ddd60e01b815291602083600481875afa92831561055a575f93610611575b506107d08302918315928481046107d01484171561059b57612710900495808502858104821485171561059b5761271090049687810180821161059b578411156105b8576102e89388936102e393836101c05261020052846101e0525f146105af575f5b61022052610ba8565b610ba8565b60015560fa820291820460fa14171561059b5761271090046101a052816104c7575b6040516124f79081610bb682396080518181816102dc015281816106c601528181610b2d0152818161136601528181611cb901528181611ea30152612024015260a05181818161194401528181611e1a015261206e015260c05181818161101d0152818161183201528181611bc701528181611def01526121b1015260e0518181816110d7015281816119a301528181611bf801528181611e4701526121e201526101005181611a6201526101205181818161049d0152611248015261014051818181611559015261168b01526101605181818161063c015261106001526101805181818161061b01526111d601526101a05181818161071401526117c101526101c05181818161117a015261130301526101e0518161188a015261020051816103ed015261022051816117130152610240518181816114ed0152818161235301526123de0152610260518181816112ab01526116cf01526102805181818161109a01526122c101526102a0518181816118fc0152611f9d01526102c05181818161042a01526120a801526102e05181818161089a01528181610d88015261111001526103005181818161074c01528181610bb3015261177b0152f35b60405163a9059cbb60e01b5f908152610320516001600160a01b03166004819052602485905291949060209060448180855af19060015f511482161561057c575b50846040521561056957803b1561056557835f60449281958395634fdb9d9760e01b8552600485015260248401525af1801561055a5761054a575b808061030a565b5f61055491610b44565b5f610543565b6040513d5f823e3d90fd5b5f80fd5b50635274afe760e01b5f5260045260245ffd5b6001821516610592573b15153d1516165f610508565b853d5f823e3d90fd5b634e487b7160e01b5f52601160045260245ffd5b610320516102da565b60405162461bcd60e51b815260206004820152602b60248201527f426f6e64696e6743757276653a2062616c616e63652062656c6f77207265736560448201526a7276656420737570706c7960a81b6064820152608490fd5b9092506020813d60201161063d575b8161062d60209383610b44565b810103126105655751915f610276565b3d9150610620565b60405162461bcd60e51b815260206004820152601f60248201527f426f6e64696e6743757276653a206e6f20746f6b656e7320746f2073656c6c006044820152606490fd5b9091506020813d6020116106b6575b816106a660209383610b44565b810103126105655751905f61024a565b3d9150610699565b604051634a9fefc760e01b81526001600160a01b03909116600482015290602090829060249082905afa90811561055a575f916106fc575b5061021b565b90506020813d60201161072e575b8161071760209383610b44565b810103126105655761072890610b7b565b5f6106f6565b3d915061070a565b610758915060203d60201161075e575b6107508183610b44565b810190610b8f565b5f6101fd565b503d610746565b6101af565b61078191508b3d8d1161075e576107508183610b44565b5f61018e565b60405162461bcd60e51b815260206004820152602d60248201527f426f6e64696e6743757276653a20696e666f66692063616d706169676e20697360448201526c207a65726f206164647265737360981b6064820152608490fd5b50610320516001600160a01b03161515610157565b60405162461bcd60e51b815260206004820152602860248201527f426f6e64696e6743757276653a20696e666f666920616c6c6f636174696f6e206044820152670e8dede40d0d2ced60c31b6064820152608490fd5b60405162461bcd60e51b815260206004820152603060248201527f426f6e64696e6743757276653a206574682f757364207072696365206665656460448201526f206973207a65726f206164647265737360801b6064820152608490fd5b60405162461bcd60e51b815260206004820152601f60248201527f426f6e64696e6743757276653a2073656c6c2074617820746f6f2068696768006044820152606490fd5b60405162461bcd60e51b815260206004820152602660248201527f426f6e64696e6743757276653a206d69677261746f72206973207a65726f206160448201526564647265737360d01b6064820152608490fd5b60405162461bcd60e51b815260206004820152602760248201527f426f6e64696e6743757276653a207a65726f2067726164756174696f6e2074686044820152661c995cda1bdb1960ca1b6064820152608490fd5b60405162461bcd60e51b815260206004820152602f60248201527f426f6e64696e6743757276653a2070726f746f636f6c2074726561737572792060448201526e6973207a65726f206164647265737360881b6064820152608490fd5b60405162461bcd60e51b815260206004820152602560248201527f426f6e64696e6743757276653a2063726561746f72206973207a65726f206164604482015264647265737360d81b6064820152608490fd5b60405162461bcd60e51b815260206004820152602860248201527f426f6e64696e6743757276653a207a65726f207669727475616c20746f6b656e604482015267207265736572766560c01b6064820152608490fd5b60405162461bcd60e51b815260206004820152602660248201527f426f6e64696e6743757276653a207a65726f207669727475616c20657468207260448201526565736572766560d01b6064820152608490fd5b60405162461bcd60e51b815260206004820152602360248201527f426f6e64696e6743757276653a20746f6b656e206973207a65726f206164647260448201526265737360e81b6064820152608490fd5b601f909101601f19168101906001600160401b03821190821017610b6757604052565b634e487b7160e01b5f52604160045260245ffd5b51906001600160a01b038216820361056557565b90816020910312610565575160ff811681036105655790565b9190820391821161059b5756fe6080806040526004361015610012575f80fd5b5f905f3560e01c90816278425414611a915750806302d05d3f14611a4d57806306ac9fbe14611a3357806309f657c714611a1857806320aead8b146119fd5780632ab04c7b146119e1578063320e81e4146119c6578063343ee3b71461198c578063393d4081146119685780633b97e8561461192b57806342f6fb29146118e7578063466be955146118c9578063479dfd7b146118ad5780634819f5d9146118735780634beb394c1461185557806352b86d2b1461181b578063552e6f76146117fe57806361a3c471146117e457806363a803e1146117aa57806368447c93146117665780636e8cddea14610fff5780637332e48f14611742578063790ef025146116fe5780637cd07e47146116ba578063803db96d146116765780638795cccb1461152d5780638aacc260146115105780638b0bc501146114d65780638b1763551461129157806398d5fdca146112775780639fa36cdc14611233578063a3ba7e63146111ba578063a4082f1914611217578063a64190c4146111f9578063ad9c0c2e146111bf578063b6efaa75146111ba578063b7cb1b131461119d578063b7e7923814611163578063b8f7cf251461113f578063ba51e786146110fb578063bf333f2c1461046b578063cbcb3171146110bd578063cffd129c14611083578063d00efb2f14611049578063d62ccb3f14611004578063d78e419914610fff578063d79875eb14610abb578063d96a094a146105f1578063da7f8da6146105d5578063e1a45218146105b8578063e1cd04b414610470578063e4bddb6f1461046b578063e6417ce81461044e578063e647fe6b14610410578063e650bd0d146103d5578063e7c2b772146103b2578063ec826e7114610389578063f057850d1461036c578063f25b9caa1461034f578063f4dd415614610331578063f8ac60bd1461030e5763fc0c546a146102c7575f80fd5b3461030b578060031936011261030b576040517f00000000000000000000000000000000000000000000000000000000000000006001600160a01b03168152602090f35b80fd5b503461030b578060031936011261030b57602060ff600654166040519015158152f35b503461030b578060031936011261030b576020600354604051908152f35b503461030b578060031936011261030b576020604051610e108152f35b503461030b578060031936011261030b57602060405161012c8152f35b503461030b578060031936011261030b5760406103a4611f88565b825191825215156020820152f35b503461030b578060031936011261030b57602060ff600254166040519015158152f35b503461030b578060031936011261030b5760206040517f00000000000000000000000000000000000000000000000000000000000000008152f35b503461030b578060031936011261030b57602060405160ff7f0000000000000000000000000000000000000000000000000000000000000000168152f35b503461030b578060031936011261030b576020604051611d4c8152f35b611aea565b503461030b578060031936011261030b57610489612206565b6004549081156105685780600455808080847f00000000000000000000000000000000000000000000000000000000000000005af16104c6611d3f565b5015610511576020907f5b3c42e6d289ed8fc272a51c0049c0eb46a1cb88c6a2e7f873b8e67d9ea0c72a82604051838152a160015f805160206124a283398151915255604051908152f35b60405162461bcd60e51b815260206004820152602960248201527f426f6e64696e6743757276653a2063726561746f7220666565207472616e7366604482015268195c8819985a5b195960ba1b6064820152608490fd5b60405162461bcd60e51b815260206004820152602260248201527f426f6e64696e6743757276653a206e6f2063726561746f722066656573206f77604482015261195960f21b6064820152608490fd5b503461030b578060031936011261030b5760206040516127108152f35b503461030b578060031936011261030b57602060405160968152f35b50602036600319011261030b57610606612206565b60ff60025416610aac573415610a67576106607f00000000000000000000000000000000000000000000000000000000000000007f0000000000000000000000000000000000000000000000000000000000000000611b88565b80431115610a51575060643402348104606403610a3d576127109004906106878234611c36565b916106918361219d565b9182156109f8576106a6600435841015611f2c565b600154908184116109a0576040516370a0823160e01b81523360048201527f000000000000000000000000000000000000000000000000000000000000000095906020816024816001600160a01b038b165afa8015610995578690849061095b575b6107129250611b88565b7f0000000000000000000000000000000000000000000000000000000000000000908181116109455750506107468461230f565b909690937f00000000000000000000000000000000000000000000000000000000000000006001600160a01b0316919087831561093157506101f489028981046101f4148a15171561091d57916107b48980936107ad6127106107fc9704985b8a54611b88565b8955611c36565b6001556107cc6107c4868c611c36565b600454611b88565b6004556107db87600554611b88565b6005556107ea34600354611b88565b6003556107f5612333565b339061223e565b81610898575b60208660017f6ea71ab1dc38cfdc7dbdbc30c7a18c0d7abf172f3007a3ba574a1231a8e9f3d28a8961087c8a60405134815287898201527f1cbc5ab135991bd2b6a4b034a04aa2aa086dac1371cb9b16b8b5e2ed6b036bed60403392a2604051938493846040919493926060820195825260208201520152565b0390a260015f805160206124a283398151915255604051908152f35b7f00000000000000000000000000000000000000000000000000000000000000006001600160a01b031690813b15610919579060248492604051948593849263733665e960e01b845260048401525af1801561090e576108f9575b80610802565b610904828092611c6e565b61030b57806108f3565b6040513d84823e3d90fd5b8380fd5b634e487b7160e01b86526011600452602486fd5b90916107b4826107fc946107ad89986107a6565b63b93174c360e01b845260045260245250604490fd5b50506020813d60201161098d575b8161097660209383611c6e565b8101031261098957856107129151610708565b5f80fd5b3d9150610969565b6040513d85823e3d90fd5b60405162461bcd60e51b815260206004820152602a60248201527f426f6e64696e6743757276653a20696e73756666696369656e7420746f6b656e604482015269206c697175696469747960b01b6064820152608490fd5b60405162461bcd60e51b815260206004820152601d60248201527f426f6e64696e6743757276653a207a65726f20746f6b656e73206f75740000006044820152606490fd5b634e487b7160e01b82526011600452602482fd5b631582260b60e11b825243600452602452604490fd5b60405162461bcd60e51b815260206004820152601960248201527f426f6e64696e6743757276653a207a65726f2065746820696e000000000000006044820152606490fd5b6369107eb960e01b8152600490fd5b50346109895760403660031901126109895760043590610ad9612206565b60ff60025416610ff0578115610fab57610af282611bb3565b908115610f66575f5490818311610f105760648302838104606403610e65576040516370a0823160e01b8152336004820152612710909104947f0000000000000000000000000000000000000000000000000000000000000000916001600160a01b0383169190602081602481865afa8015610e29575f90610edc575b610b7a9150876122bf565b94610b8e86610b898a8a611c36565b611c36565b96610b9d602435891015611f2c565b804710610e8857610bad8961230f565b909590947f00000000000000000000000000000000000000000000000000000000000000006001600160a01b0316929091908315610e79576101f48802908882046101f41489151715610e6557610c1c81612710610c4e9404975b610c148a600154611b88565b600155611c36565b5f55610c346107c48c610c2f898d611c36565b611b88565b600455610c4388600554611b88565b600555600354611b88565b600355604051906323b872dd60e01b5f5233600452306024528560445260205f60648180855af19060015f5114821615610e46575b50906040525f60605215610e345750610cab5f8080808c335af1610ca5611d3f565b50611d7e565b81610d7f575b505095610d2b7f6ea71ab1dc38cfdc7dbdbc30c7a18c0d7abf172f3007a3ba574a1231a8e9f3d29392602098604051908152888a8201527fed7a144fad14804d5c249145e3e0e2b63a9eb455b76aee5bc92d711e9bba3e4a60403392a2604051938493846040919493926060820195825260208201520152565b0390a280610d4e575b5060015f805160206124a283398151915255604051908152f35b6040519081527fe40304e8c79e52e8dabbbff0946b9ca48cf1e0fb7b00509c79056802e15707ee833392a25f610d34565b909791949392907f00000000000000000000000000000000000000000000000000000000000000006001600160a01b0316803b156109895760245f926040519b8c93849263733665e960e01b845260048401525af1978815610e2957602098610def575b81939495929850610cb1565b7f6ea71ab1dc38cfdc7dbdbc30c7a18c0d7abf172f3007a3ba574a1231a8e9f3d2945090610e205f610d2b93611c6e565b5f945090610de3565b6040513d5f823e3d90fd5b635274afe760e01b5f5260045260245ffd5b6001821516610e5c573b15153d1516165f610c83565b823d5f823e3d90fd5b634e487b7160e01b5f52601160045260245ffd5b80610c1c610c4e925f97610c08565b60405162461bcd60e51b815260206004820152602660248201527f426f6e64696e6743757276653a20696e73756666696369656e74206574682062604482015265616c616e636560d01b6064820152608490fd5b506020813d602011610f08575b81610ef660209383611c6e565b8101031261098957610b7a9051610b6f565b3d9150610ee9565b60405162461bcd60e51b815260206004820152602860248201527f426f6e64696e6743757276653a20696e73756666696369656e7420657468206c604482015267697175696469747960c01b6064820152608490fd5b60405162461bcd60e51b815260206004820152601a60248201527f426f6e64696e6743757276653a207a65726f20657468206f75740000000000006044820152606490fd5b60405162461bcd60e51b815260206004820152601c60248201527f426f6e64696e6743757276653a207a65726f20746f6b656e7320696e000000006044820152606490fd5b6369107eb960e01b5f5260045ffd5b611ab3565b34610989575f3660031901126109895760206110415f547f0000000000000000000000000000000000000000000000000000000000000000611b88565b604051908152f35b34610989575f3660031901126109895760206040517f00000000000000000000000000000000000000000000000000000000000000008152f35b34610989575f3660031901126109895760206040517f00000000000000000000000000000000000000000000000000000000000000008152f35b34610989575f3660031901126109895760206110416001547f0000000000000000000000000000000000000000000000000000000000000000611b88565b34610989575f366003190112610989576040517f00000000000000000000000000000000000000000000000000000000000000006001600160a01b03168152602090f35b34610989575f36600319011261098957602060405169d3c21bcecceda10000008152f35b34610989575f3660031901126109895760206040517f00000000000000000000000000000000000000000000000000000000000000008152f35b34610989575f366003190112610989576020600154604051908152f35b611acf565b34610989575f3660031901126109895760206040517f00000000000000000000000000000000000000000000000000000000000000008152f35b34610989576020366003190112610989576020611041600435611e6b565b34610989575f3660031901126109895760206040516107d08152f35b34610989575f366003190112610989576040517f00000000000000000000000000000000000000000000000000000000000000006001600160a01b03168152602090f35b34610989575f366003190112610989576020611041611de2565b34610989575f366003190112610989576112a9612206565b7f00000000000000000000000000000000000000000000000000000000000000006001600160a01b03811690338290036114915760ff600254161561144c576006549160ff83166113f657600160409360ff1916176006557f00000000000000000000000000000000000000000000000000000000000000009061133260045460055490611b88565b8047115f146113e8575f80808061134c6113949547611c36565b81549080821083146113df575080985b82805561138a89827f000000000000000000000000000000000000000000000000000000000000000061223e565b5af1610ca5611d3f565b7fc83e5c883db9c9caa9555048adab1521496c459677c63a7539099c26fefe15c6848051858152846020820152a260015f805160206124a28339815191525582519182526020820152f35b9050809861135c565b506113945f8080808061134c565b60405162461bcd60e51b815260206004820152602860248201527f426f6e64696e6743757276653a206d6967726174696f6e20616c726561647920604482015267195e1958dd5d195960c21b6064820152608490fd5b60405162461bcd60e51b815260206004820152601b60248201527f426f6e64696e6743757276653a206e6f742067726164756174656400000000006044820152606490fd5b60405162461bcd60e51b815260206004820152601a60248201527f426f6e64696e6743757276653a206e6f74206d69677261746f720000000000006044820152606490fd5b34610989575f3660031901126109895760206040517f00000000000000000000000000000000000000000000000000000000000000008152f35b34610989575f366003190112610989576020600454604051908152f35b34610989575f36600319011261098957611545612206565b6005548015611625575f6005555f808080847f00000000000000000000000000000000000000000000000000000000000000005af1611582611d3f565b50156115cd576020907f951a86b0458e05dec69512ef305168520351a732ff2c01b3f0e3d19914e4227a82604051838152a160015f805160206124a283398151915255604051908152f35b60405162461bcd60e51b815260206004820152602a60248201527f426f6e64696e6743757276653a2070726f746f636f6c20666565207472616e7360448201526919995c8819985a5b195960b21b6064820152608490fd5b60405162461bcd60e51b815260206004820152602360248201527f426f6e64696e6743757276653a206e6f2070726f746f636f6c2066656573206f6044820152621dd95960ea1b6064820152608490fd5b34610989575f366003190112610989576040517f00000000000000000000000000000000000000000000000000000000000000006001600160a01b03168152602090f35b34610989575f366003190112610989576040517f00000000000000000000000000000000000000000000000000000000000000006001600160a01b03168152602090f35b34610989575f366003190112610989576040517f00000000000000000000000000000000000000000000000000000000000000006001600160a01b03168152602090f35b34610989575f366003190112610989576020604051691fc3842bd1f071c000008152f35b34610989575f366003190112610989576040517f00000000000000000000000000000000000000000000000000000000000000006001600160a01b03168152602090f35b34610989575f3660031901126109895760206040517f00000000000000000000000000000000000000000000000000000000000000008152f35b34610989575f366003190112610989576020611041611ca4565b34610989575f366003190112610989576020600554604051908152f35b34610989575f3660031901126109895760206040517f00000000000000000000000000000000000000000000000000000000000000008152f35b34610989576020366003190112610989576020611041600435611c43565b34610989575f3660031901126109895760206040517f00000000000000000000000000000000000000000000000000000000000000008152f35b34610989575f366003190112610989576020604051611d4c8152f35b34610989576020366003190112610989576020611041600435611bb3565b34610989575f366003190112610989576040517f00000000000000000000000000000000000000000000000000000000000000006001600160a01b03168152602090f35b34610989575f36600319011261098957602060405160ff7f0000000000000000000000000000000000000000000000000000000000000000168152f35b34610989575f366003190112610989576020604051693f870857a3e0e38000008152f35b34610989575f3660031901126109895760206040517f00000000000000000000000000000000000000000000000000000000000000008152f35b34610989575f36600319011261098957602060405160c88152f35b34610989575f3660031901126109895760205f54604051908152f35b34610989575f36600319011261098957602060405160328152f35b34610989575f366003190112610989576020604051604b8152f35b34610989575f366003190112610989576020611041611b05565b34610989575f366003190112610989576040517f00000000000000000000000000000000000000000000000000000000000000006001600160a01b03168152602090f35b34610989575f36600319011261098957806969e10de76676d080000060209252f35b34610989575f3660031901126109895760206040516101f48152f35b34610989575f36600319011261098957602060405160fa8152f35b34610989575f36600319011261098957602060405160648152f35b611b0d611f88565b15611b6f57691fc3842bd1f071c00000811115611b6f57693f870857a3e0e3800000811115611b69576969e10de76676d0800000811115611b635769d3c21bcecceda10000001015611b5e57603290565b604b90565b50606490565b50609690565b5060c890565b81810292918115918404141715610e6557565b91908201809211610e6557565b8115611b9f570490565b634e487b7160e01b5f52601260045260245ffd5b8015611c3157611c2e90611c28611beb5f547f0000000000000000000000000000000000000000000000000000000000000000611b88565b91611c2281611c1c6001547f0000000000000000000000000000000000000000000000000000000000000000611b88565b94611b75565b92611b88565b90611b95565b90565b505f90565b91908203918211610e6557565b8015611c315760648102818104606403610e6557611c2e91612710611c69920490611c36565b61219d565b90601f8019910116810190811067ffffffffffffffff821117611c9057604052565b634e487b7160e01b5f52604160045260245ffd5b6040516318160ddd60e01b81526020816004817f00000000000000000000000000000000000000000000000000000000000000006001600160a01b03165afa908115610e29575f91611d0b575b50611d0761271091611d01611b05565b90611b75565b0490565b90506020813d602011611d37575b81611d2660209383611c6e565b810103126109895751611d07611cf1565b3d9150611d19565b3d15611d79573d9067ffffffffffffffff8211611c905760405191611d6e601f8201601f191660200184611c6e565b82523d5f602084013e565b606090565b15611d8557565b60405162461bcd60e51b815260206004820152602160248201527f426f6e64696e6743757276653a20657468207472616e73666572206661696c656044820152601960fa1b6064820152608490fd5b604d8111610e6557600a0a90565b611c2e611e3f611e135f547f0000000000000000000000000000000000000000000000000000000000000000611b88565b611d0160ff7f000000000000000000000000000000000000000000000000000000000000000016611dd4565b611c286001547f0000000000000000000000000000000000000000000000000000000000000000611b88565b611e7490611bb3565b8015611c315760648102818104606403610e65576040516370a0823160e01b81523360048201526020816024817f00000000000000000000000000000000000000000000000000000000000000006001600160a01b03165afa908115610e29575f91611ef8575b5082612710611ef0610b8993611c2e966122bf565b930490611c36565b90506020813d602011611f24575b81611f1360209383611c6e565b810103126109895751611c2e611edb565b3d9150611f06565b15611f3357565b60405162461bcd60e51b8152602060048201526016602482015275426f6e64696e6743757276653a20736c69707061676560501b6044820152606490fd5b519069ffffffffffffffffffff8216820361098957565b604051633fabe5a360e21b815260a0816004817f00000000000000000000000000000000000000000000000000000000000000006001600160a01b03165afa905f8092805f935f92612142575b50611fe457505050505f905f90565b5f84131561213857821591821561211e575b505061211657610e108101809111610e6557421161210f576040516318160ddd60e01b8152906020826004817f00000000000000000000000000000000000000000000000000000000000000006001600160a01b03165afa918215610e29575f926120d9575b506120a06120936120d393611c2860ff7f000000000000000000000000000000000000000000000000000000000000000016611dd4565b61209b611de2565b611b75565b906120cd60ff7f000000000000000000000000000000000000000000000000000000000000000016611dd4565b91612403565b90600190565b91506020823d602011612107575b816120f460209383611c6e565b81010312610989579051906120a061205c565b3d91506120e7565b505f905f90565b50505f905f90565b69ffffffffffffffffffff91925081169116105f80611ff6565b505050505f905f90565b94509250505060a0823d60a011612195575b8161216160a09383611c6e565b810103126109895761217282611f71565b9060208301519061218a608060608601519501611f71565b92919392905f611fd5565b3d9150612154565b8015611c3157611c2e90611c286121d55f547f0000000000000000000000000000000000000000000000000000000000000000611b88565b91611c228161209b6001547f0000000000000000000000000000000000000000000000000000000000000000611b88565b60025f805160206124a2833981519152541461222f5760025f805160206124a283398151915255565b633ee5aeb560e01b5f5260045ffd5b916040519163a9059cbb60e01b5f5260018060a01b031660045260245260205f60448180865af19060015f511482161561229e575b6040521561227e5750565b635274afe760e01b5f9081526001600160a01b0391909116600452602490fd5b9060018115166122b657823b15153d15161690612273565b503d5f823e3d90fd5b7f0000000000000000000000000000000000000000000000000000000000000000918215612308576122ef611ca4565b10156123025761271091611d0791611b75565b50505f90565b5050505f90565b90611d4c8202828104611d4c1483151715610e6557612710611c2e91048093611c36565b60025460ff811680156123d9575b6123d65760ff191660011760025560fa7f0000000000000000000000000000000000000000000000000000000000000000818102918115918304141715610e65576127107f72a089bf72f8bdb633c01144c6cf486e8b100097b06bd326948141b7bd827d8891046123b481600454611b88565b6004555f546040805191825260208201929092524391810191909152606090a1565b50565b505f547f000000000000000000000000000000000000000000000000000000000000000011612341565b90915f198383099280830292838086109503948086039514612494578483111561247c5790829109815f0382168092046002816003021880820260020302808202600203028082026002030280820260020302808202600203028091026002030293600183805f03040190848311900302920304170290565b82634e487b715f52156003026011186020526024601cfd5b505090611c2e9250611b9556fe9b779b17422d0df92223018b32b4d1fa46e071723d6817e2486d003becc55f00a2646970667358221220160af699088336c01752040def132e3643945af1785efa326be7ec85a19ca6bd64736f6c634300081a0033" as const;
