/**
 * Generated from contracts/out/BondingCurve.sol/BondingCurve.json.
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
        "name": "ethUsdPrice_",
        "type": "uint256",
        "internalType": "uint256"
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
    "name": "MAX_CREATOR_SHARE_BPS",
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
    "name": "MIN_CREATOR_SHARE_BPS",
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
    "name": "VOLUME_CAP_USD",
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
    "stateMutability": "view"
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
    "name": "ethUsdPrice",
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
    "name": "volumeCapWei",
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

export const BONDING_CURVE_BYTECODE = "0x61038080604052346105ca576101e08161326380380380916100218285610bfb565b8339810103126105ca578051906001600160a01b03821682036105ca57806020810151604082015161005560608401610c32565b9161006260808501610c32565b918460a081015160c082015160e08301516100806101008501610c32565b91610120850151936100c66101c06101806100ab6101606100a46101408c01610c32565b9a01610c32565b9d01519d6100bc6101a08201610c32565b6103605201610c32565b60017f9b779b17422d0df92223018b32b4d1fa46e071723d6817e2486d003becc55f0055986001600160a01b038e1615610baa578815610b56578715610b00576001600160a01b038b1615610aad576001600160a01b03811615610a50578115610a0c5783156109b7576001600160a01b038516156109635761012c861161091e576001600160a01b038716156108c0576101f48d1161086a578c159b8c8015610855575b156107fa576004988f806020916080526040519b8c809263313ce56760e01b825260018060a01b03165afa9a8b156105bf5760049b60209b5f916107dd575b5060a05260c05260e0526101008c90526001600160a01b0381166107d857508a5b61012052610140526101608190527172cb5bd86321e38cb6ce6682e800000000000461018052436101a0526101c052610280526102a0526102c0526001600160a01b03166102e081905260405163313ce56760e01b815292839182905afa9081156105bf575f916107a9575b50610300526103208190526001600160a01b031690816107315750505f5b610340526040516370a0823160e01b8152306004820152906020826024816001600160a01b0388165afa9182156105bf575f926106fd575b5081156106b8576040516318160ddd60e01b8152916020836004816001600160a01b0389165afa9283156105bf575f93610684575b506107d08302918315928481046107d01484171561060e57612710900494808502858104821485171561060e5761271090049586810180821161060e5784111561062b5761033493879361032f9383610200526102405284610220525f14610622575f5b61026052610c5f565b610c5f565b60015560fa820291820460fa14171561060e5761271090046101e0528061052e575b6040516125f69081610c6d82396080518181816103080152818161073201528181610bac0152818161144e01528181611dbd01528181611fa70152612170015260a051818181611a2c01528181611f1e01526121ba015260c0518181816110d30152818161193601528181611ccb01528181611ef301526122d4015260e05181818161118501528181611a8b01528181611cfc01528181611f4b015261230501526101005181611b6601526101205181818161050a01526112f6015261014051818181611641015261177301526101605181611356015261018051818181610352015261207a01526101a0518181816106a9015261110e01526101c051818181610688015261128401526101e05181818161078001526118c501526102005181818161122801526113eb0152610220518161198e01526102405181610454015261026051816118170152610280518181816115d50152818161245201526124dd01526102a05181818161139301526117b701526102c05181818161114801526123e401526102e0518181816119e401526120ff01526103005181818161049101526121f401526103205181818161091901528181610e1901526111be0152610340518181816107cc01528181610c47015261187f0152f35b6040519163a9059cbb60e01b5f5260018060a01b036103605116806004528260245260205f60448180865af160015f51148116156105ef575b84604052156105ce57803b156105ca57835f60449281958395634fdb9d9760e01b855260018060a01b0316600485015260248401525af180156105bf576105af575b80610356565b5f6105b991610bfb565b5f6105a9565b6040513d5f823e3d90fd5b5f80fd5b50635274afe760e01b5f9081526001600160a01b0391909116600452602490fd5b600181151661060557823b15153d151616610567565b843d5f823e3d90fd5b634e487b7160e01b5f52601160045260245ffd5b61036051610326565b60405162461bcd60e51b815260206004820152602b60248201527f426f6e64696e6743757276653a2062616c616e63652062656c6f77207265736560448201526a7276656420737570706c7960a81b6064820152608490fd5b9092506020813d6020116106b0575b816106a060209383610bfb565b810103126105ca5751915f6102c2565b3d9150610693565b60405162461bcd60e51b815260206004820152601f60248201527f426f6e64696e6743757276653a206e6f20746f6b656e7320746f2073656c6c006044820152606490fd5b9091506020813d602011610729575b8161071960209383610bfb565b810103126105ca5751905f61028d565b3d915061070c565b604051634a9fefc760e01b81526001600160a01b03909116600482015290602090829060249082905afa9081156105bf575f9161076f575b50610255565b90506020813d6020116107a1575b8161078a60209383610bfb565b810103126105ca5761079b90610c32565b5f610769565b3d915061077d565b6107cb915060203d6020116107d1575b6107c38183610bfb565b810190610c46565b5f610237565b503d6107b9565b6101cb565b6107f491508c3d8e116107d1576107c38183610bfb565b5f6101aa565b60405162461bcd60e51b815260206004820152602d60248201527f426f6e64696e6743757276653a20696e666f66692063616d706169676e20697360448201526c207a65726f206164647265737360981b6064820152608490fd5b50610360516001600160a01b0316151561016b565b60405162461bcd60e51b815260206004820152602860248201527f426f6e64696e6743757276653a20696e666f666920616c6c6f636174696f6e206044820152670e8dede40d0d2ced60c31b6064820152608490fd5b60405162461bcd60e51b815260206004820152603060248201527f426f6e64696e6743757276653a206574682f757364207072696365206665656460448201526f206973207a65726f206164647265737360801b6064820152608490fd5b60405162461bcd60e51b815260206004820152601f60248201527f426f6e64696e6743757276653a2073656c6c2074617820746f6f2068696768006044820152606490fd5b60405162461bcd60e51b815260206004820152602660248201527f426f6e64696e6743757276653a206d69677261746f72206973207a65726f206160448201526564647265737360d01b6064820152608490fd5b60405162461bcd60e51b815260206004820152602760248201527f426f6e64696e6743757276653a207a65726f2067726164756174696f6e2074686044820152661c995cda1bdb1960ca1b6064820152608490fd5b606460405162461bcd60e51b815260206004820152602060248201527f426f6e64696e6743757276653a207a65726f206574682f7573642070726963656044820152fd5b60405162461bcd60e51b815260206004820152602f60248201527f426f6e64696e6743757276653a2070726f746f636f6c2074726561737572792060448201526e6973207a65726f206164647265737360881b6064820152608490fd5b60405162461bcd60e51b815260206004820152602560248201527f426f6e64696e6743757276653a2063726561746f72206973207a65726f206164604482015264647265737360d81b6064820152608490fd5b60405162461bcd60e51b815260206004820152602860248201527f426f6e64696e6743757276653a207a65726f207669727475616c20746f6b656e604482015267207265736572766560c01b6064820152608490fd5b60405162461bcd60e51b815260206004820152602660248201527f426f6e64696e6743757276653a207a65726f207669727475616c20657468207260448201526565736572766560d01b6064820152608490fd5b60405162461bcd60e51b815260206004820152602360248201527f426f6e64696e6743757276653a20746f6b656e206973207a65726f206164647260448201526265737360e81b6064820152608490fd5b601f909101601f19168101906001600160401b03821190821017610c1e57604052565b634e487b7160e01b5f52604160045260245ffd5b51906001600160a01b03821682036105ca57565b908160209103126105ca575160ff811681036105ca5790565b9190820391821161060e5756fe6080806040526004361015610012575f80fd5b5f905f3560e01c90816278425414611b955750806302d05d3f14611b5157806306ac9fbe14611b3757806309f657c714611b1c57806320aead8b14611b015780632ab04c7b14611ae55780632e39757214611ac9578063320e81e414611aae578063343ee3b714611a74578063393d408114611a505780633b97e85614611a1357806342f6fb29146119cf578063466be955146119b15780634819f5d9146119775780634beb394c1461195957806352b86d2b1461191f578063552e6f761461190257806361a3c471146118e857806363a803e1146118ae57806368447c931461186a5780636e8cddea146110905780637332e48f14611846578063790ef025146118025780637aab2f69146117e65780637cd07e47146117a2578063803db96d1461175e5780638795cccb146116155780638aacc260146115f85780638b0bc501146115be5780638b176355146113795780639478ab8c1461133f57806398d5fdca146113255780639fa36cdc146112e1578063a3ba7e6314611268578063a4082f19146112c5578063a64190c4146112a7578063ad9c0c2e1461126d578063b6efaa7514611268578063b7cb1b131461124b578063b7e7923814611211578063b8f7cf25146111ed578063ba51e786146111a9578063bf333f2c146104d8578063cbcb31711461116b578063cffd129c14611131578063d00efb2f146110f7578063d62ccb3f146110ba578063d68f0cae14611095578063d78e419914611090578063d79875eb14610b3a578063d96a094a1461065e578063da7f8da614610642578063e1a4521814610625578063e1cd04b4146104dd578063e4bddb6f146104d8578063e6417ce8146104b5578063e647fe6b14610477578063e650bd0d1461043c578063e7c2b77214610419578063ec826e71146103f0578063f057850d146103d3578063f25b9caa146103b6578063f4dd415614610398578063f8ac60bd14610375578063fa96c32c1461033a5763fc0c546a146102f3575f80fd5b346103375780600319360112610337576040517f00000000000000000000000000000000000000000000000000000000000000006001600160a01b03168152602090f35b80fd5b503461033757806003193601126103375760206040517f00000000000000000000000000000000000000000000000000000000000000008152f35b5034610337578060031936011261033757602060ff600654166040519015158152f35b50346103375780600319360112610337576020600354604051908152f35b50346103375780600319360112610337576020604051610e108152f35b5034610337578060031936011261033757602060405161012c8152f35b5034610337578060031936011261033757604061040b6120ea565b825191825215156020820152f35b5034610337578060031936011261033757602060ff600254166040519015158152f35b503461033757806003193601126103375760206040517f00000000000000000000000000000000000000000000000000000000000000008152f35b5034610337578060031936011261033757602060405160ff7f0000000000000000000000000000000000000000000000000000000000000000168152f35b503461033757806003193601126103375760206104d0612075565b604051908152f35b611bee565b50346103375780600319360112610337576104f6612329565b6004549081156105d55780600455808080847f00000000000000000000000000000000000000000000000000000000000000005af1610533611e43565b501561057e576020907f5b3c42e6d289ed8fc272a51c0049c0eb46a1cb88c6a2e7f873b8e67d9ea0c72a82604051838152a160015f805160206125a183398151915255604051908152f35b60405162461bcd60e51b815260206004820152602960248201527f426f6e64696e6743757276653a2063726561746f7220666565207472616e7366604482015268195c8819985a5b195960ba1b6064820152608490fd5b60405162461bcd60e51b815260206004820152602260248201527f426f6e64696e6743757276653a206e6f2063726561746f722066656573206f77604482015261195960f21b6064820152608490fd5b503461033757806003193601126103375760206040516127108152f35b5034610337578060031936011261033757602060405160968152f35b50602036600319011261033757610673612329565b60ff60025416610b2b573415610ae6576106cd7f00000000000000000000000000000000000000000000000000000000000000007f0000000000000000000000000000000000000000000000000000000000000000611c8c565b80431115610ad0575060643402348104606403610abc5761271090046106f38134611d3a565b906106fd826122c0565b918215610a7757610712600435841015612030565b60015493848411610a1f576040516370a0823160e01b81523360048201527f000000000000000000000000000000000000000000000000000000000000000092906020816024816001600160a01b0388165afa8015610a1457869084906109da575b61077e9250611c8c565b7f0000000000000000000000000000000000000000000000000000000000000000908181116109c45750506127106107bd6107b7612075565b86611c79565b04956107c98786611d3a565b937f00000000000000000000000000000000000000000000000000000000000000006001600160a01b0316918783156109b057506101f489028981046101f4148a15171561099c579161083389809361082c61271061087b9704985b8a54611c8c565b8955611d3a565b60015561084b610843868c611d3a565b600454611c8c565b60045561085a87600554611c8c565b60055561086934600354611c8c565b600355610874612432565b3390612361565b81610917575b60208660017f6ea71ab1dc38cfdc7dbdbc30c7a18c0d7abf172f3007a3ba574a1231a8e9f3d28a896108fb8a60405134815287898201527f1cbc5ab135991bd2b6a4b034a04aa2aa086dac1371cb9b16b8b5e2ed6b036bed60403392a2604051938493846040919493926060820195825260208201520152565b0390a260015f805160206125a183398151915255604051908152f35b7f00000000000000000000000000000000000000000000000000000000000000006001600160a01b031690813b15610998579060248492604051948593849263733665e960e01b845260048401525af1801561098d57610978575b80610881565b610983828092611d72565b6103375780610972565b6040513d84823e3d90fd5b8380fd5b634e487b7160e01b86526011600452602486fd5b90916108338261087b9461082c8998610825565b63b93174c360e01b845260045260245250604490fd5b50506020813d602011610a0c575b816109f560209383611d72565b81010312610a08578561077e9151610774565b5f80fd5b3d91506109e8565b6040513d85823e3d90fd5b60405162461bcd60e51b815260206004820152602a60248201527f426f6e64696e6743757276653a20696e73756666696369656e7420746f6b656e604482015269206c697175696469747960b01b6064820152608490fd5b60405162461bcd60e51b815260206004820152601d60248201527f426f6e64696e6743757276653a207a65726f20746f6b656e73206f75740000006044820152606490fd5b634e487b7160e01b82526011600452602482fd5b631582260b60e11b825243600452602452604490fd5b60405162461bcd60e51b815260206004820152601960248201527f426f6e64696e6743757276653a207a65726f2065746820696e000000000000006044820152606490fd5b6369107eb960e01b8152600490fd5b5034610a08576040366003190112610a085760043590610b58612329565b60ff6002541661108157811561103c57610b7182611cb7565b908115610ff7575f5490818311610fa15760648302838104606403610ef6576040516370a0823160e01b8152336004820152612710909104947f00000000000000000000000000000000000000000000000000000000000000006001600160a01b03811692909190602081602481875afa8015610eba575f90610f6d575b610bfa9150876123e2565b94610c0e86610c098a8a611d3a565b611d3a565b96610c1d602435891015612030565b804710610f1957612710610c38610c32612075565b8b611c79565b0494610c44868b611d3a565b947f00000000000000000000000000000000000000000000000000000000000000006001600160a01b0316928315610f0a576101f48802908882046101f41489151715610ef657610cad81612710610cdf9404975b610ca58a600154611c8c565b600155611d3a565b5f55610cc56108438c610cc0898d611d3a565b611c8c565b600455610cd488600554611c8c565b600555600354611c8c565b600355604051906323b872dd60e01b5f5233600452306024528560445260205f60648180855af19060015f5114821615610ed7575b50906040525f60605215610ec55750610d3c5f8080808c335af1610d36611e43565b50611e82565b81610e10575b505095610dbc7f6ea71ab1dc38cfdc7dbdbc30c7a18c0d7abf172f3007a3ba574a1231a8e9f3d29392602098604051908152888a8201527fed7a144fad14804d5c249145e3e0e2b63a9eb455b76aee5bc92d711e9bba3e4a60403392a2604051938493846040919493926060820195825260208201520152565b0390a280610ddf575b5060015f805160206125a183398151915255604051908152f35b6040519081527fe40304e8c79e52e8dabbbff0946b9ca48cf1e0fb7b00509c79056802e15707ee833392a25f610dc5565b909791949392907f00000000000000000000000000000000000000000000000000000000000000006001600160a01b0316803b15610a085760245f926040519b8c93849263733665e960e01b845260048401525af1978815610eba57602098610e80575b81939495929850610d42565b7f6ea71ab1dc38cfdc7dbdbc30c7a18c0d7abf172f3007a3ba574a1231a8e9f3d2945090610eb15f610dbc93611d72565b5f945090610e74565b6040513d5f823e3d90fd5b635274afe760e01b5f5260045260245ffd5b6001821516610eed573b15153d1516165f610d14565b823d5f823e3d90fd5b634e487b7160e01b5f52601160045260245ffd5b80610cad610cdf925f97610c99565b60405162461bcd60e51b815260206004820152602660248201527f426f6e64696e6743757276653a20696e73756666696369656e74206574682062604482015265616c616e636560d01b6064820152608490fd5b506020813d602011610f99575b81610f8760209383611d72565b81010312610a0857610bfa9051610bef565b3d9150610f7a565b60405162461bcd60e51b815260206004820152602860248201527f426f6e64696e6743757276653a20696e73756666696369656e7420657468206c604482015267697175696469747960c01b6064820152608490fd5b60405162461bcd60e51b815260206004820152601a60248201527f426f6e64696e6743757276653a207a65726f20657468206f75740000000000006044820152606490fd5b60405162461bcd60e51b815260206004820152601c60248201527f426f6e64696e6743757276653a207a65726f20746f6b656e7320696e000000006044820152606490fd5b6369107eb960e01b5f5260045ffd5b611bb7565b34610a08575f366003190112610a085760206040516a084595161401484a0000008152f35b34610a08575f366003190112610a085760206104d05f547f0000000000000000000000000000000000000000000000000000000000000000611c8c565b34610a08575f366003190112610a085760206040517f00000000000000000000000000000000000000000000000000000000000000008152f35b34610a08575f366003190112610a085760206040517f00000000000000000000000000000000000000000000000000000000000000008152f35b34610a08575f366003190112610a085760206104d06001547f0000000000000000000000000000000000000000000000000000000000000000611c8c565b34610a08575f366003190112610a08576040517f00000000000000000000000000000000000000000000000000000000000000006001600160a01b03168152602090f35b34610a08575f366003190112610a0857602060405169d3c21bcecceda10000008152f35b34610a08575f366003190112610a085760206040517f00000000000000000000000000000000000000000000000000000000000000008152f35b34610a08575f366003190112610a08576020600154604051908152f35b611bd3565b34610a08575f366003190112610a085760206040517f00000000000000000000000000000000000000000000000000000000000000008152f35b34610a08576020366003190112610a085760206104d0600435611f6f565b34610a08575f366003190112610a085760206040516107d08152f35b34610a08575f366003190112610a08576040517f00000000000000000000000000000000000000000000000000000000000000006001600160a01b03168152602090f35b34610a08575f366003190112610a085760206104d0611ee6565b34610a08575f366003190112610a085760206040517f00000000000000000000000000000000000000000000000000000000000000008152f35b34610a08575f366003190112610a0857611391612329565b7f00000000000000000000000000000000000000000000000000000000000000006001600160a01b03811690338290036115795760ff6002541615611534576006549160ff83166114de57600160409360ff1916176006557f00000000000000000000000000000000000000000000000000000000000000009061141a60045460055490611c8c565b8047115f146114d0575f80808061143461147c9547611d3a565b81549080821083146114c7575080985b82805561147289827f0000000000000000000000000000000000000000000000000000000000000000612361565b5af1610d36611e43565b7fc83e5c883db9c9caa9555048adab1521496c459677c63a7539099c26fefe15c6848051858152846020820152a260015f805160206125a18339815191525582519182526020820152f35b90508098611444565b5061147c5f80808080611434565b60405162461bcd60e51b815260206004820152602860248201527f426f6e64696e6743757276653a206d6967726174696f6e20616c726561647920604482015267195e1958dd5d195960c21b6064820152608490fd5b60405162461bcd60e51b815260206004820152601b60248201527f426f6e64696e6743757276653a206e6f742067726164756174656400000000006044820152606490fd5b60405162461bcd60e51b815260206004820152601a60248201527f426f6e64696e6743757276653a206e6f74206d69677261746f720000000000006044820152606490fd5b34610a08575f366003190112610a085760206040517f00000000000000000000000000000000000000000000000000000000000000008152f35b34610a08575f366003190112610a08576020600454604051908152f35b34610a08575f366003190112610a085761162d612329565b600554801561170d575f6005555f808080847f00000000000000000000000000000000000000000000000000000000000000005af161166a611e43565b50156116b5576020907f951a86b0458e05dec69512ef305168520351a732ff2c01b3f0e3d19914e4227a82604051838152a160015f805160206125a183398151915255604051908152f35b60405162461bcd60e51b815260206004820152602a60248201527f426f6e64696e6743757276653a2070726f746f636f6c20666565207472616e7360448201526919995c8819985a5b195960b21b6064820152608490fd5b60405162461bcd60e51b815260206004820152602360248201527f426f6e64696e6743757276653a206e6f2070726f746f636f6c2066656573206f6044820152621dd95960ea1b6064820152608490fd5b34610a08575f366003190112610a08576040517f00000000000000000000000000000000000000000000000000000000000000006001600160a01b03168152602090f35b34610a08575f366003190112610a08576040517f00000000000000000000000000000000000000000000000000000000000000006001600160a01b03168152602090f35b34610a08575f366003190112610a085760206040516121348152f35b34610a08575f366003190112610a08576040517f00000000000000000000000000000000000000000000000000000000000000006001600160a01b03168152602090f35b34610a08575f366003190112610a08576020604051691fc3842bd1f071c000008152f35b34610a08575f366003190112610a08576040517f00000000000000000000000000000000000000000000000000000000000000006001600160a01b03168152602090f35b34610a08575f366003190112610a085760206040517f00000000000000000000000000000000000000000000000000000000000000008152f35b34610a08575f366003190112610a085760206104d0611da8565b34610a08575f366003190112610a08576020600554604051908152f35b34610a08575f366003190112610a085760206040517f00000000000000000000000000000000000000000000000000000000000000008152f35b34610a08576020366003190112610a085760206104d0600435611d47565b34610a08575f366003190112610a085760206040517f00000000000000000000000000000000000000000000000000000000000000008152f35b34610a08576020366003190112610a085760206104d0600435611cb7565b34610a08575f366003190112610a08576040517f00000000000000000000000000000000000000000000000000000000000000006001600160a01b03168152602090f35b34610a08575f366003190112610a0857602060405160ff7f0000000000000000000000000000000000000000000000000000000000000000168152f35b34610a08575f366003190112610a08576020604051693f870857a3e0e38000008152f35b34610a08575f366003190112610a085760206040517f00000000000000000000000000000000000000000000000000000000000000008152f35b34610a08575f366003190112610a0857602060405160c88152f35b34610a08575f366003190112610a08576020604051611d4c8152f35b34610a08575f366003190112610a085760205f54604051908152f35b34610a08575f366003190112610a0857602060405160328152f35b34610a08575f366003190112610a08576020604051604b8152f35b34610a08575f366003190112610a085760206104d0611c09565b34610a08575f366003190112610a08576040517f00000000000000000000000000000000000000000000000000000000000000006001600160a01b03168152602090f35b34610a08575f366003190112610a0857806969e10de76676d080000060209252f35b34610a08575f366003190112610a085760206040516101f48152f35b34610a08575f366003190112610a0857602060405160fa8152f35b34610a08575f366003190112610a0857602060405160648152f35b611c116120ea565b15611c7357691fc3842bd1f071c00000811115611c7357693f870857a3e0e3800000811115611c6d576969e10de76676d0800000811115611c675769d3c21bcecceda10000001015611c6257603290565b604b90565b50606490565b50609690565b5060c890565b81810292918115918404141715610ef657565b91908201809211610ef657565b8115611ca3570490565b634e487b7160e01b5f52601260045260245ffd5b8015611d3557611d3290611d2c611cef5f547f0000000000000000000000000000000000000000000000000000000000000000611c8c565b91611d2681611d206001547f0000000000000000000000000000000000000000000000000000000000000000611c8c565b94611c79565b92611c8c565b90611c99565b90565b505f90565b91908203918211610ef657565b8015611d355760648102818104606403610ef657611d3291612710611d6d920490611d3a565b6122c0565b90601f8019910116810190811067ffffffffffffffff821117611d9457604052565b634e487b7160e01b5f52604160045260245ffd5b6040516318160ddd60e01b81526020816004817f00000000000000000000000000000000000000000000000000000000000000006001600160a01b03165afa908115610eba575f91611e0f575b50611e0b61271091611e05611c09565b90611c79565b0490565b90506020813d602011611e3b575b81611e2a60209383611d72565b81010312610a085751611e0b611df5565b3d9150611e1d565b3d15611e7d573d9067ffffffffffffffff8211611d945760405191611e72601f8201601f191660200184611d72565b82523d5f602084013e565b606090565b15611e8957565b60405162461bcd60e51b815260206004820152602160248201527f426f6e64696e6743757276653a20657468207472616e73666572206661696c656044820152601960fa1b6064820152608490fd5b604d8111610ef657600a0a90565b611d32611f43611f175f547f0000000000000000000000000000000000000000000000000000000000000000611c8c565b611e0560ff7f000000000000000000000000000000000000000000000000000000000000000016611ed8565b611d2c6001547f0000000000000000000000000000000000000000000000000000000000000000611c8c565b611f7890611cb7565b8015611d355760648102818104606403610ef6576040516370a0823160e01b81523360048201526020816024817f00000000000000000000000000000000000000000000000000000000000000006001600160a01b03165afa908115610eba575f91611ffc575b5082612710611ff4610c0993611d32966123e2565b930490611d3a565b90506020813d602011612028575b8161201760209383611d72565b81010312610a085751611d32611fdf565b3d915061200a565b1561203757565b60405162461bcd60e51b8152602060048201526016602482015275426f6e64696e6743757276653a20736c69707061676560501b6044820152606490fd5b6003547f0000000000000000000000000000000000000000000000000000000000000000908181106120cd5750805b816103e802916103e8830403610ef6576120bd91611c99565b611d4c0180611d4c11610ef65790565b906120a4565b519069ffffffffffffffffffff82168203610a0857565b604051633fabe5a360e21b815260a0816004817f00000000000000000000000000000000000000000000000000000000000000006001600160a01b03165afa805f925f9261226a575b506121405750505f905f90565b5f82131561226257610e108101809111610ef657421161225b576040516318160ddd60e01b8152906020826004817f00000000000000000000000000000000000000000000000000000000000000006001600160a01b03165afa918215610eba575f92612225575b506121ec6121df61221f93611d2c60ff7f000000000000000000000000000000000000000000000000000000000000000016611ed8565b6121e7611ee6565b611c79565b9061221960ff7f000000000000000000000000000000000000000000000000000000000000000016611ed8565b91612502565b90600190565b91506020823d602011612253575b8161224060209383611d72565b81010312610a08579051906121ec6121a8565b3d9150612233565b505f905f90565b50505f905f90565b9250905060a0823d60a0116122b8575b8161228760a09383611d72565b81010312610a0857612298826120d3565b5060208201516122af6080606085015194016120d3565b5091905f612133565b3d915061227a565b8015611d3557611d3290611d2c6122f85f547f0000000000000000000000000000000000000000000000000000000000000000611c8c565b91611d26816121e76001547f0000000000000000000000000000000000000000000000000000000000000000611c8c565b60025f805160206125a183398151915254146123525760025f805160206125a183398151915255565b633ee5aeb560e01b5f5260045ffd5b916040519163a9059cbb60e01b5f5260018060a01b031660045260245260205f60448180865af19060015f51148216156123c1575b604052156123a15750565b635274afe760e01b5f9081526001600160a01b0391909116600452602490fd5b9060018115166123d957823b15153d15161690612396565b503d5f823e3d90fd5b7f000000000000000000000000000000000000000000000000000000000000000091821561242b57612412611da8565b10156124255761271091611e0b91611c79565b50505f90565b5050505f90565b60025460ff811680156124d8575b6124d55760ff191660011760025560fa7f0000000000000000000000000000000000000000000000000000000000000000818102918115918304141715610ef6576127107f72a089bf72f8bdb633c01144c6cf486e8b100097b06bd326948141b7bd827d8891046124b381600454611c8c565b6004555f546040805191825260208201929092524391810191909152606090a1565b50565b505f547f000000000000000000000000000000000000000000000000000000000000000011612440565b90915f198383099280830292838086109503948086039514612593578483111561257b5790829109815f0382168092046002816003021880820260020302808202600203028082026002030280820260020302808202600203028091026002030293600183805f03040190848311900302920304170290565b82634e487b715f52156003026011186020526024601cfd5b505090611d329250611c9956fe9b779b17422d0df92223018b32b4d1fa46e071723d6817e2486d003becc55f00a26469706673582212201b6307d61baab02ab372692f26a40d4af9092fb7c7d39ee3133e40dd9d80807464736f6c634300081a0033" as `0x${string}`;
