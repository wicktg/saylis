/**
 * Generated from contracts/out/InfoFiCampaign.sol/InfoFiCampaign.json.
 */
export const INFO_FI_CAMPAIGN_ABI = [
  {
    "type": "constructor",
    "inputs": [
      {
        "name": "team_",
        "type": "address",
        "internalType": "address"
      },
      {
        "name": "mcapThresholdUsd18_",
        "type": "uint256",
        "internalType": "uint256"
      },
      {
        "name": "sustainedDuration_",
        "type": "uint64",
        "internalType": "uint64"
      },
      {
        "name": "uniswapFactory_",
        "type": "address",
        "internalType": "address"
      },
      {
        "name": "weth9_",
        "type": "address",
        "internalType": "address"
      },
      {
        "name": "poolFee_",
        "type": "uint24",
        "internalType": "uint24"
      },
      {
        "name": "ethUsdPriceFeed_",
        "type": "address",
        "internalType": "address"
      },
      {
        "name": "graduationOnly_",
        "type": "bool",
        "internalType": "bool"
      }
    ],
    "stateMutability": "nonpayable"
  },
  {
    "type": "function",
    "name": "ABANDON_PERIOD",
    "inputs": [],
    "outputs": [
      {
        "name": "",
        "type": "uint64",
        "internalType": "uint64"
      }
    ],
    "stateMutability": "view"
  },
  {
    "type": "function",
    "name": "BURN_ADDRESS",
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
    "name": "CAMPAIGN_WINDOW",
    "inputs": [],
    "outputs": [
      {
        "name": "",
        "type": "uint64",
        "internalType": "uint64"
      }
    ],
    "stateMutability": "view"
  },
  {
    "type": "function",
    "name": "CLAIM_WINDOW",
    "inputs": [],
    "outputs": [
      {
        "name": "",
        "type": "uint64",
        "internalType": "uint64"
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
    "name": "TWAP_PERIOD",
    "inputs": [],
    "outputs": [
      {
        "name": "",
        "type": "uint32",
        "internalType": "uint32"
      }
    ],
    "stateMutability": "view"
  },
  {
    "type": "function",
    "name": "burnUnclaimed",
    "inputs": [
      {
        "name": "token",
        "type": "address",
        "internalType": "address"
      }
    ],
    "outputs": [
      {
        "name": "burned",
        "type": "uint256",
        "internalType": "uint256"
      }
    ],
    "stateMutability": "nonpayable"
  },
  {
    "type": "function",
    "name": "campaigns",
    "inputs": [
      {
        "name": "token",
        "type": "address",
        "internalType": "address"
      }
    ],
    "outputs": [
      {
        "name": "state",
        "type": "uint8",
        "internalType": "enum InfoFiCampaign.State"
      },
      {
        "name": "curve",
        "type": "address",
        "internalType": "address"
      },
      {
        "name": "owner",
        "type": "address",
        "internalType": "address"
      },
      {
        "name": "isExternal",
        "type": "bool",
        "internalType": "bool"
      },
      {
        "name": "allocation",
        "type": "uint256",
        "internalType": "uint256"
      },
      {
        "name": "claimed",
        "type": "uint256",
        "internalType": "uint256"
      },
      {
        "name": "registeredAt",
        "type": "uint64",
        "internalType": "uint64"
      },
      {
        "name": "aboveSince",
        "type": "uint64",
        "internalType": "uint64"
      },
      {
        "name": "openedAt",
        "type": "uint64",
        "internalType": "uint64"
      },
      {
        "name": "windowEnds",
        "type": "uint64",
        "internalType": "uint64"
      },
      {
        "name": "claimDeadline",
        "type": "uint64",
        "internalType": "uint64"
      },
      {
        "name": "merkleRoot",
        "type": "bytes32",
        "internalType": "bytes32"
      }
    ],
    "stateMutability": "view"
  },
  {
    "type": "function",
    "name": "claim",
    "inputs": [
      {
        "name": "token",
        "type": "address",
        "internalType": "address"
      },
      {
        "name": "amount",
        "type": "uint256",
        "internalType": "uint256"
      },
      {
        "name": "proof",
        "type": "bytes32[]",
        "internalType": "bytes32[]"
      }
    ],
    "outputs": [
      {
        "name": "claimedAmount",
        "type": "uint256",
        "internalType": "uint256"
      }
    ],
    "stateMutability": "nonpayable"
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
    "name": "getCampaign",
    "inputs": [
      {
        "name": "token",
        "type": "address",
        "internalType": "address"
      }
    ],
    "outputs": [
      {
        "name": "",
        "type": "tuple",
        "internalType": "struct InfoFiCampaign.Campaign",
        "components": [
          {
            "name": "state",
            "type": "uint8",
            "internalType": "enum InfoFiCampaign.State"
          },
          {
            "name": "curve",
            "type": "address",
            "internalType": "address"
          },
          {
            "name": "owner",
            "type": "address",
            "internalType": "address"
          },
          {
            "name": "isExternal",
            "type": "bool",
            "internalType": "bool"
          },
          {
            "name": "allocation",
            "type": "uint256",
            "internalType": "uint256"
          },
          {
            "name": "claimed",
            "type": "uint256",
            "internalType": "uint256"
          },
          {
            "name": "registeredAt",
            "type": "uint64",
            "internalType": "uint64"
          },
          {
            "name": "aboveSince",
            "type": "uint64",
            "internalType": "uint64"
          },
          {
            "name": "openedAt",
            "type": "uint64",
            "internalType": "uint64"
          },
          {
            "name": "windowEnds",
            "type": "uint64",
            "internalType": "uint64"
          },
          {
            "name": "claimDeadline",
            "type": "uint64",
            "internalType": "uint64"
          },
          {
            "name": "merkleRoot",
            "type": "bytes32",
            "internalType": "bytes32"
          }
        ]
      }
    ],
    "stateMutability": "view"
  },
  {
    "type": "function",
    "name": "graduationOnly",
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
    "name": "hasClaimed",
    "inputs": [
      {
        "name": "token",
        "type": "address",
        "internalType": "address"
      },
      {
        "name": "account",
        "type": "address",
        "internalType": "address"
      }
    ],
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
    "name": "markEligible",
    "inputs": [
      {
        "name": "token",
        "type": "address",
        "internalType": "address"
      }
    ],
    "outputs": [],
    "stateMutability": "nonpayable"
  },
  {
    "type": "function",
    "name": "marketCapUsd",
    "inputs": [
      {
        "name": "token",
        "type": "address",
        "internalType": "address"
      }
    ],
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
    "name": "mcapThresholdUsd18",
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
    "name": "openCampaign",
    "inputs": [
      {
        "name": "token",
        "type": "address",
        "internalType": "address"
      }
    ],
    "outputs": [],
    "stateMutability": "nonpayable"
  },
  {
    "type": "function",
    "name": "poolFee",
    "inputs": [],
    "outputs": [
      {
        "name": "",
        "type": "uint24",
        "internalType": "uint24"
      }
    ],
    "stateMutability": "view"
  },
  {
    "type": "function",
    "name": "primePoolOracle",
    "inputs": [
      {
        "name": "token",
        "type": "address",
        "internalType": "address"
      }
    ],
    "outputs": [],
    "stateMutability": "nonpayable"
  },
  {
    "type": "function",
    "name": "publishResults",
    "inputs": [
      {
        "name": "token",
        "type": "address",
        "internalType": "address"
      },
      {
        "name": "merkleRoot",
        "type": "bytes32",
        "internalType": "bytes32"
      }
    ],
    "outputs": [],
    "stateMutability": "nonpayable"
  },
  {
    "type": "function",
    "name": "qualifiesAt",
    "inputs": [
      {
        "name": "token",
        "type": "address",
        "internalType": "address"
      }
    ],
    "outputs": [
      {
        "name": "",
        "type": "uint64",
        "internalType": "uint64"
      }
    ],
    "stateMutability": "view"
  },
  {
    "type": "function",
    "name": "recordMarketCap",
    "inputs": [
      {
        "name": "token",
        "type": "address",
        "internalType": "address"
      }
    ],
    "outputs": [
      {
        "name": "eligible",
        "type": "bool",
        "internalType": "bool"
      }
    ],
    "stateMutability": "nonpayable"
  },
  {
    "type": "function",
    "name": "registerAllocation",
    "inputs": [
      {
        "name": "token",
        "type": "address",
        "internalType": "address"
      },
      {
        "name": "amount",
        "type": "uint256",
        "internalType": "uint256"
      }
    ],
    "outputs": [],
    "stateMutability": "nonpayable"
  },
  {
    "type": "function",
    "name": "registerExternalPool",
    "inputs": [
      {
        "name": "token",
        "type": "address",
        "internalType": "address"
      },
      {
        "name": "amount",
        "type": "uint256",
        "internalType": "uint256"
      },
      {
        "name": "curve",
        "type": "address",
        "internalType": "address"
      }
    ],
    "outputs": [
      {
        "name": "registered",
        "type": "uint256",
        "internalType": "uint256"
      }
    ],
    "stateMutability": "nonpayable"
  },
  {
    "type": "function",
    "name": "remaining",
    "inputs": [
      {
        "name": "token",
        "type": "address",
        "internalType": "address"
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
    "name": "sustainedDuration",
    "inputs": [],
    "outputs": [
      {
        "name": "",
        "type": "uint64",
        "internalType": "uint64"
      }
    ],
    "stateMutability": "view"
  },
  {
    "type": "function",
    "name": "team",
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
    "name": "uniswapFactory",
    "inputs": [],
    "outputs": [
      {
        "name": "",
        "type": "address",
        "internalType": "contract IUniswapV3Factory"
      }
    ],
    "stateMutability": "view"
  },
  {
    "type": "function",
    "name": "weth9",
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
    "type": "event",
    "name": "AllocationRegistered",
    "inputs": [
      {
        "name": "token",
        "type": "address",
        "indexed": true,
        "internalType": "address"
      },
      {
        "name": "curve",
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
    "type": "event",
    "name": "Burned",
    "inputs": [
      {
        "name": "token",
        "type": "address",
        "indexed": true,
        "internalType": "address"
      },
      {
        "name": "amount",
        "type": "uint256",
        "indexed": false,
        "internalType": "uint256"
      },
      {
        "name": "fromState",
        "type": "uint8",
        "indexed": false,
        "internalType": "enum InfoFiCampaign.State"
      }
    ],
    "anonymous": false
  },
  {
    "type": "event",
    "name": "CampaignEligible",
    "inputs": [
      {
        "name": "token",
        "type": "address",
        "indexed": true,
        "internalType": "address"
      },
      {
        "name": "mcapUsd18",
        "type": "uint256",
        "indexed": false,
        "internalType": "uint256"
      },
      {
        "name": "aboveSince",
        "type": "uint64",
        "indexed": false,
        "internalType": "uint64"
      },
      {
        "name": "qualifiedAt",
        "type": "uint64",
        "indexed": false,
        "internalType": "uint64"
      }
    ],
    "anonymous": false
  },
  {
    "type": "event",
    "name": "CampaignOpened",
    "inputs": [
      {
        "name": "token",
        "type": "address",
        "indexed": true,
        "internalType": "address"
      },
      {
        "name": "allocation",
        "type": "uint256",
        "indexed": false,
        "internalType": "uint256"
      },
      {
        "name": "openedAt",
        "type": "uint64",
        "indexed": false,
        "internalType": "uint64"
      },
      {
        "name": "windowEnds",
        "type": "uint64",
        "indexed": false,
        "internalType": "uint64"
      }
    ],
    "anonymous": false
  },
  {
    "type": "event",
    "name": "Claimed",
    "inputs": [
      {
        "name": "token",
        "type": "address",
        "indexed": true,
        "internalType": "address"
      },
      {
        "name": "account",
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
    "type": "event",
    "name": "ExternalPoolRegistered",
    "inputs": [
      {
        "name": "token",
        "type": "address",
        "indexed": true,
        "internalType": "address"
      },
      {
        "name": "owner",
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
    "type": "event",
    "name": "MarketCapRecorded",
    "inputs": [
      {
        "name": "token",
        "type": "address",
        "indexed": true,
        "internalType": "address"
      },
      {
        "name": "mcapUsd18",
        "type": "uint256",
        "indexed": false,
        "internalType": "uint256"
      },
      {
        "name": "aboveSince",
        "type": "uint64",
        "indexed": false,
        "internalType": "uint64"
      }
    ],
    "anonymous": false
  },
  {
    "type": "event",
    "name": "ResultsPublished",
    "inputs": [
      {
        "name": "token",
        "type": "address",
        "indexed": true,
        "internalType": "address"
      },
      {
        "name": "merkleRoot",
        "type": "bytes32",
        "indexed": false,
        "internalType": "bytes32"
      },
      {
        "name": "claimDeadline",
        "type": "uint64",
        "indexed": false,
        "internalType": "uint64"
      }
    ],
    "anonymous": false
  },
  {
    "type": "error",
    "name": "AllocationNotReceived",
    "inputs": [
      {
        "name": "expected",
        "type": "uint256",
        "internalType": "uint256"
      },
      {
        "name": "received",
        "type": "uint256",
        "internalType": "uint256"
      }
    ]
  },
  {
    "type": "error",
    "name": "AlreadyClaimed",
    "inputs": [
      {
        "name": "token",
        "type": "address",
        "internalType": "address"
      },
      {
        "name": "account",
        "type": "address",
        "internalType": "address"
      }
    ]
  },
  {
    "type": "error",
    "name": "AlreadyRegistered",
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
    "name": "CampaignWindowStillOpen",
    "inputs": [
      {
        "name": "token",
        "type": "address",
        "internalType": "address"
      },
      {
        "name": "windowEnds",
        "type": "uint64",
        "internalType": "uint64"
      }
    ]
  },
  {
    "type": "error",
    "name": "ClaimExceedsPool",
    "inputs": [
      {
        "name": "requested",
        "type": "uint256",
        "internalType": "uint256"
      },
      {
        "name": "remaining",
        "type": "uint256",
        "internalType": "uint256"
      }
    ]
  },
  {
    "type": "error",
    "name": "ClaimWindowClosed",
    "inputs": [
      {
        "name": "token",
        "type": "address",
        "internalType": "address"
      },
      {
        "name": "deadline",
        "type": "uint64",
        "internalType": "uint64"
      }
    ]
  },
  {
    "type": "error",
    "name": "ClaimWindowStillOpen",
    "inputs": [
      {
        "name": "token",
        "type": "address",
        "internalType": "address"
      },
      {
        "name": "deadline",
        "type": "uint64",
        "internalType": "uint64"
      }
    ]
  },
  {
    "type": "error",
    "name": "CurveTokenMismatch",
    "inputs": [
      {
        "name": "expected",
        "type": "address",
        "internalType": "address"
      },
      {
        "name": "actual",
        "type": "address",
        "internalType": "address"
      }
    ]
  },
  {
    "type": "error",
    "name": "EmptyRoot",
    "inputs": []
  },
  {
    "type": "error",
    "name": "ExternalPoolNotPokeable",
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
    "name": "InvalidProof",
    "inputs": []
  },
  {
    "type": "error",
    "name": "NotAbandonedYet",
    "inputs": [
      {
        "name": "token",
        "type": "address",
        "internalType": "address"
      },
      {
        "name": "burnableAt",
        "type": "uint64",
        "internalType": "uint64"
      }
    ]
  },
  {
    "type": "error",
    "name": "NotEligibleYet",
    "inputs": [
      {
        "name": "token",
        "type": "address",
        "internalType": "address"
      },
      {
        "name": "aboveSince",
        "type": "uint64",
        "internalType": "uint64"
      },
      {
        "name": "requiredUntil",
        "type": "uint64",
        "internalType": "uint64"
      }
    ]
  },
  {
    "type": "error",
    "name": "NotExternalPool",
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
    "name": "NotTeam",
    "inputs": []
  },
  {
    "type": "error",
    "name": "PriceUnavailable",
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
    "name": "TickOutOfBounds",
    "inputs": [
      {
        "name": "tick",
        "type": "int24",
        "internalType": "int24"
      }
    ]
  },
  {
    "type": "error",
    "name": "WrongState",
    "inputs": [
      {
        "name": "token",
        "type": "address",
        "internalType": "address"
      },
      {
        "name": "expected",
        "type": "uint8",
        "internalType": "enum InfoFiCampaign.State"
      },
      {
        "name": "actual",
        "type": "uint8",
        "internalType": "enum InfoFiCampaign.State"
      }
    ]
  },
  {
    "type": "error",
    "name": "ZeroAddress",
    "inputs": []
  },
  {
    "type": "error",
    "name": "ZeroAllocation",
    "inputs": []
  }
] as const;

export const INFO_FI_CAMPAIGN_BYTECODE = "0x6101a080604052346102485761010081612db080380380916100218285610347565b833981010312610248576100348161037e565b602082015160408301516001600160401b0381169391929190848103610248576100606060830161037e565b61006c6080840161037e565b9060a08401519262ffffff841684036102485760e061008d60c0870161037e565b9501519788151589036102485760017f9b779b17422d0df92223018b32b4d1fa46e071723d6817e2486d003becc55f00556001600160a01b038716158015610336575b8015610325575b8015610314575b6103055787156102b4571561025f5760049660209660805260a05260c05260018060a01b031661010052610120526101405260018060a01b031680610160526040519283809263313ce56760e01b82525afa908115610254575f91610214575b506101805260e052604051612a1d9081610393823960805181818161029d015281816104890152818161093101526116f6015260a0518181816101f40152611a7d015260c051818181610849015281816109c10152611ace015260e0518181816104440152611a3b01526101005181818161088301528181610ea50152611ed3015261012051818181610c0001528181610e490152611e77015261014051818181610e74015281816114170152611ea2015261016051818181610fbd01526128d90152610180518181816101b8015261293f0152f35b90506020813d60201161024c575b8161022f60209383610347565b81010312610248575160ff81168103610248575f61013e565b5f80fd5b3d9150610222565b6040513d5f823e3d90fd5b60405162461bcd60e51b815260206004820152602760248201527f496e666f466943616d706169676e3a207a65726f207375737461696e656420646044820152663ab930ba34b7b760c91b6064820152608490fd5b60405162461bcd60e51b815260206004820152602360248201527f496e666f466943616d706169676e3a207a65726f206d636170207468726573686044820152621bdb1960ea1b6064820152608490fd5b63d92e233d60e01b5f5260045ffd5b506001600160a01b038616156100de565b506001600160a01b038416156100d7565b506001600160a01b038316156100d0565b601f909101601f19168101906001600160401b0382119082101761036a57604052565b634e487b7160e01b5f52604160045260245ffd5b51906001600160a01b03821682036102485756fe60806040526004361015610011575f80fd5b5f803560e01c806209929b146116db578062685a301461143b578063089fe6aa146113fc57806309940605146113cb5780631601d0b5146112de5780633d13f87414610fec57806342f6fb2914610fa85780634566501914610f8b5780634642bdb014610e105780634fdb9d9714610c5d578063502d282414610c2f57806350879c1c14610bea578063731301cf14610a085780637ca25184146109eb57806381930cec1461096057806385f2aef21461091b57806389266f60146108b25780638bdb2afa1461086d5780638e89ba07146108295780639133d9b2146105cb5780639beed3d6146104695780639ef2aede1461042c5780639f34fc801461040e578063a877439d14610281578063b399b0bc14610236578063bf4dc24214610217578063c8b27dcc146101dc578063e647fe6b1461019e578063f25b9caa146101815763fccc281314610162575f80fd5b3461017e578060031936011261017e57602060405161dead8152f35b80fd5b503461017e578060031936011261017e576020604051610e108152f35b503461017e578060031936011261017e57602060405160ff7f0000000000000000000000000000000000000000000000000000000000000000168152f35b503461017e578060031936011261017e5760206040517f00000000000000000000000000000000000000000000000000000000000000008152f35b503461017e578060031936011261017e5760206040516301e133808152f35b503461017e57602036600319011261017e57602090610279906040906001600160a01b036102626117ec565b168152808452206003600282015491015490611985565b604051908152f35b503461017e57602036600319011261017e5761029b6117ec565b7f00000000000000000000000000000000000000000000000000000000000000006001600160a01b031633036103ff576001600160a01b0316808252602082905260408220805460ff1660068110156103eb57600281036103ca57506001600160401b03421690600360ff198254161781556004810190815462093a8084016001600160401b0381116103b6576fffffffffffffffffffffffffffffffff9091164260801b67ffffffffffffffff60801b161760c091821b6001600160c01b0319161792839055600290910154604080519182526001600160401b03909416602082015291901c918101919091527f8bc0cb1cb310194955926d90209fe837c905cef10aa386f1a61961b032e1c5109080606081010390a280f35b634e487b7160e01b87526011600452602487fd5b836103e960649285631c40f77160e11b84526004526002602452611802565bfd5b634e487b7160e01b84526021600452602484fd5b633a7cfa5d60e21b8252600482fd5b503461017e578060031936011261017e57602060405162278d008152f35b503461017e578060031936011261017e5760206040517f000000000000000000000000000000000000000000000000000000000000000015158152f35b503461017e57604036600319011261017e576104836117ec565b602435907f00000000000000000000000000000000000000000000000000000000000000006001600160a01b031633036105bc576001600160a01b0316808352602083905260408320805491929160ff1660068110156105a857600381036105895750600481015460c01c80421061057257508115610563577f5e8074f8651ff944f0342bff27119e45620a6c165d7855f6fc2c48e983f17600916001600160401b0360409260056105368342166119b1565b91600460ff198254161781558460068201550182821683198254161790558351928352166020820152a280f35b6329e7276760e11b8452600484fd5b6313a9f84360e01b85526004849052602452604484fd5b846103e960649286631c40f77160e11b84526004526003602452611802565b634e487b7160e01b85526021600452602485fd5b633a7cfa5d60e21b8352600483fd5b503461017e57602036600319011261017e576105e56117ec565b6105ed611dac565b6001600160a01b0316808252602082905260408220805460ff16929091906006841015806108155784158015610809575b6107ea576107d65760048403610745576001600160401b036005840154168042111561073057505b6002830180549061065d6003860192835490611985565b855460ff1916600517909555549055826106c5575b507fede8d7ee61ffbb3791a8c93a629fdbcb966aa492b2566297a1ffceafb17faada60406020946106ab82519186835287830190611810565ba260015f805160206129c883398151915255604051908152f35b60405163a9059cbb60e01b825261dead600452602484905260208260448180875af190600183511482161561070e575b60405261067257602491635274afe760e01b8252600452fd5b90600181151661072657833b15153d151616906106f5565b50903d90823e3d90fd5b604492633058ea1960e01b8352600452602452fd5b60038403610789576001600160401b03610765600485015460c01c6119b1565b16804211156107745750610646565b6044926358519a8760e01b8352600452602452fd5b6301e133806001600160401b03600485015416016001600160401b0381116107c2576001600160401b0316804211156107745750610646565b634e487b7160e01b82526011600452602482fd5b634e487b7160e01b81526021600452602490fd5b506103e984606493631c40f77160e11b84526004526001602452611802565b5050806005851461061e565b634e487b7160e01b82526021600452602482fd5b503461017e578060031936011261017e5760206040516001600160401b037f0000000000000000000000000000000000000000000000000000000000000000168152f35b503461017e578060031936011261017e576040517f00000000000000000000000000000000000000000000000000000000000000006001600160a01b03168152602090f35b503461017e57604036600319011261017e576108cc6117ec565b60243591906001600160a01b0383168303610917579060409160018060a01b031681526001602052209060018060a01b03165f52602052602060ff60405f2054166040519015158152f35b5080fd5b503461017e578060031936011261017e576040517f00000000000000000000000000000000000000000000000000000000000000006001600160a01b03168152602090f35b503461017e57602036600319011261017e576020906001600160a01b036109856117ec565b1681528082526001600160401b03600460408320015460401c1680155f146109ba57505b6001600160401b0360405191168152f35b6109e691507f0000000000000000000000000000000000000000000000000000000000000000906119d1565b6109a9565b503461017e578060031936011261017e5760206040516107088152f35b503461017e57602036600319011261017e57610a226117ec565b81610160604051610a328161181d565b8281528260208201528260408201528260608201528260808201528260a08201528260c08201528260e0820152826101008201528261012082015282610140820152015260018060a01b03168152806020526040812060405190610a958261181d565b805460ff81169360068510156107d657508383526020830190600160a01b600190039060081c16815260018201549060408401600160a01b6001900383168152606085019260a01c60ff161515835260028401549260808601938452600385015460a0870190815260048601549460c08801926001600160401b038716845260e08901948760401c6001600160401b031686526101008a01968860801c6001600160401b031688526101208b019860c01c895260058a01546001600160401b0316996101408c019a8b52600601549a610160019a8b526040519b8c610b7991611810565b516001600160a01b0390811660208d015290511660408b015251151560608a01525160808901525160a0880152516001600160401b0390811660c08801529051811660e087015290518116610100860152905181166101208501529051166101408301525161016082015261018090f35b503461017e578060031936011261017e576040517f00000000000000000000000000000000000000000000000000000000000000006001600160a01b03168152602090f35b503461017e57602036600319011261017e576020610c53610c4e6117ec565b6119f1565b6040519015158152f35b503461017e57604036600319011261017e57610c776117ec565b60243590610c83611dac565b6001600160a01b03168015610e01578115610df257808352826020526040832060ff81541660068110156105a857610dde576040516370a0823160e01b8152306004820152602081602481865afa908115610dd3578591610d9d575b50838110610d86575080546001600160a81b0319163360081b610100600160a81b03161760011781556004906001810180546001600160a01b03191633908117909155600282018590559101805467ffffffffffffffff1916426001600160401b0316179055604051928352917f7e87c92822ff93353d622b81c58116ee3260745aedb92b2cbade210ad4c1b77690602090a360015f805160206129c88339815191525580f35b6362ffd0af60e11b85526004849052602452604484fd5b90506020813d602011610dcb575b81610db86020938361184d565b81010312610dc757515f610cdf565b5f80fd5b3d9150610dab565b6040513d87823e3d90fd5b6345ed80e960e01b84526004829052602484fd5b63ba0d87b560e01b8352600483fd5b63d92e233d60e01b8352600483fd5b5034610dc7576020366003190112610dc757610e2a6117ec565b604051630b4c774160e11b81526001600160a01b0380831660048301527f000000000000000000000000000000000000000000000000000000000000000016602482015262ffffff7f0000000000000000000000000000000000000000000000000000000000000000166044820152602081806064810103817f00000000000000000000000000000000000000000000000000000000000000006001600160a01b03165afa908115610f31575f91610f5c575b506001600160a01b0316908115610f3c5750803b15610dc7575f80916024604051809481936332148f6760e01b8352604060048401525af18015610f3157610f23575080f35b610f2f91505f9061184d565b005b6040513d5f823e3d90fd5b638fd228af60e01b5f9081526001600160a01b0391909116600452602490fd5b610f7e915060203d602011610f84575b610f76818361184d565b810190611992565b5f610edd565b503d610f6c565b34610dc7575f366003190112610dc757602060405162093a808152f35b34610dc7575f366003190112610dc7576040517f00000000000000000000000000000000000000000000000000000000000000006001600160a01b03168152602090f35b34610dc7576060366003190112610dc7576110056117ec565b604435906024356001600160401b038311610dc75736602384011215610dc7578260040135916001600160401b038311610dc7573660248460051b86010111610dc757611050611dac565b60018060a01b0316805f525f60205260405f209160ff83541660068110156112ca57600481036112aa57506001600160401b0360058401541680421161129457505f82815260016020908152604080832033845290915290205460ff1661127d576040516020810190338252826040820152604081526110d160608261184d565b51902060405160208101918252602081526110ed60408261184d565b5190209260068101545f945b8686101561113a5760248660051b89010135908181105f14611129575f52602052600160405f205b9501946110f9565b905f52602052600160405f20611121565b0361126e5761115460036002830154920191825490611985565b8083116112585750825f52600160205260405f2060018060a01b0333165f5260205260405f20600160ff19825416179055805490828201809211611244575560405163a9059cbb60e01b5f52336004528160245260205f60448180875af19060015f5114821615611223575b6040521561121057602091604051908282527ff7a40077ff7a04c7e61f6f26fb13774259ddf1b6bce9ecf26a8276cdd3992683843393a360015f805160206129c883398151915255604051908152f35b50635274afe760e01b5f5260045260245ffd5b90600181151661123b57833b15153d151616906111c0565b503d5f823e3d90fd5b634e487b7160e01b5f52601160045260245ffd5b8263c3d4256960e01b5f5260045260245260445ffd5b6309bde33960e01b5f5260045ffd5b506305b695bd60e51b5f526004523360245260445ffd5b8263c8adc32960e01b5f5260045260245260445ffd5b631c40f77160e11b5f5260048381526024526112c590611802565b60645ffd5b634e487b7160e01b5f52602160045260245ffd5b34610dc7576020366003190112610dc7576001600160a01b036112ff6117ec565b165f525f60205261018060405f208054906001810154906002810154600382015460048301549160ff60066001600160401b03600587015416950154956040519761134c89848316611810565b60018060a01b039060081c16602089015260018060a01b038116604089015260a01c1615156060870152608086015260a08501526001600160401b03811660c08501526001600160401b038160401c1660e08501526001600160401b038160801c1661010085015260c01c610120840152610140830152610160820152f35b34610dc7576020366003190112610dc75760406113ee6113e96117ec565b61187b565b825191825215156020820152f35b34610dc7575f366003190112610dc757602060405162ffffff7f0000000000000000000000000000000000000000000000000000000000000000168152f35b34610dc7576060366003190112610dc7576114546117ec565b60443590602435906001600160a01b03831690818403610dc757611476611dac565b6001600160a01b03169081156116cc5782156116bd578015801561162a575b825f525f60205260405f209460ff86541660068110156112ca57611617576040516370a0823160e01b8152306004820152602081602481885afa908115610f31575f916115e5575b508581106115cf575085546001600160a81b03191660089190911b610100600160a81b031617600117855560209460049160018201805460ff60a01b1933166001600160a81b03199091161760a09290921b60ff60a01b169190911790556002810185905501805467ffffffffffffffff1916426001600160401b031617905560405183815282907f7e87c92822ff93353d622b81c58116ee3260745aedb92b2cbade210ad4c1b776908690a3604051908282527f5fcea03e72749f7edca0280f1c1490bef69a6519661216705d5e0b2e55f967f9843393a360015f805160206129c883398151915255604051908152f35b856362ffd0af60e11b5f5260045260245260445ffd5b90506020813d60201161160f575b816116006020938361184d565b81010312610dc75751876114dd565b3d91506115f3565b836345ed80e960e01b5f5260045260245ffd5b604051637e062a3560e11b8152602081600481865afa908115610f31575f9161167b575b506001600160a01b03168381036116655750611495565b83631707f48960e01b5f5260045260245260445ffd5b90506020813d6020116116b5575b816116966020938361184d565b81010312610dc757516001600160a01b0381168103610dc7578661164e565b3d9150611689565b63ba0d87b560e01b5f5260045ffd5b63d92e233d60e01b5f5260045ffd5b34610dc7576020366003190112610dc7576116f46117ec565b7f00000000000000000000000000000000000000000000000000000000000000006001600160a01b031633036117dd576001600160a01b03165f818152602081905260409020805460ff1660068110156112ca57600181036117c0575060ff600182015460a01c16156117ad57600260ff198254161790557f8131945fa2d842c68bc56805d226137db320755edb5f56b6ed63330113232f3560606040515f81525f60208201526001600160401b0342166040820152a2005b5063ce57d8c560e01b5f5260045260245ffd5b631c40f77160e11b5f52600483905260016024526112c590611802565b633a7cfa5d60e21b5f5260045ffd5b600435906001600160a01b0382168203610dc757565b60068110156112ca57604452565b9060068210156112ca5752565b61018081019081106001600160401b0382111761183957604052565b634e487b7160e01b5f52604160045260245ffd5b90601f801991011681019081106001600160401b0382111761183957604052565b51908115158203610dc757565b6001600160a01b038082165f9081526020819052604090205460081c169190821561197d576040516373e15bb960e11b8152602081600481875afa908115610f31575f91611943575b50156118d9576118d5919250611e58565b9091565b506040805163ec826e7160e01b815292839060049082905afa918215610f31575f905f9361190657509190565b9250506040823d60401161193b575b816119226040938361184d565b81010312610dc75761193860208351930161186e565b90565b3d9150611915565b90506020813d602011611975575b8161195e6020938361184d565b81010312610dc75761196f9061186e565b5f6118c4565b3d9150611951565b505f91508190565b9190820391821161124457565b90816020910312610dc757516001600160a01b0381168103610dc75790565b6001600160401b0362278d00911601906001600160401b03821161124457565b906001600160401b03809116911601906001600160401b03821161124457565b60018060a01b03811690815f525f60205260405f2080549060ff821692600684101590816112ca576001851493841580611d9e575b611d815760ff600185015460a01c16611d6e577f0000000000000000000000000000000000000000000000000000000000000000611c5f5750611a689061187b565b92909215611c4c576001600160401b034216937f00000000000000000000000000000000000000000000000000000000000000008410611bd95760048201926001600160401b03845460401c1615611b7f575b611af36001600160401b03855460401c167f0000000000000000000000000000000000000000000000000000000000000000906119d1565b906112ca5781611b6b575b50611b0f5750505050600291501490565b8054600260ff1990911617905554604080519283526001600160401b0391811c821660208401529216918101919091527f8131945fa2d842c68bc56805d226137db320755edb5f56b6ed63330113232f359150606090a2600190565b6001600160401b039150168410155f611afe565b835467ffffffffffffffff60401b1916604087901b67ffffffffffffffff60401b16178455877f4f918a47e57db55b3d48774b0d25285e5ef80239aacd3c77b5e4066d83127c5760408051888152896020820152a2611abb565b5060049194959350016001600160401b03815460401c16611c02575b5050506112ca5760021490565b805467ffffffffffffffff60401b19169055604080519182525f60208301527f4f918a47e57db55b3d48774b0d25285e5ef80239aacd3c77b5e4066d83127c5791a25f8080611bf5565b85638fd228af60e01b5f5260045260245ffd5b6040516373e15bb960e11b8152939550919291602091508290600490829060081c6001600160a01b03165afa908115610f31575f91611d34575b5015611d2c576112ca57611cae575050600190565b805460ff19166002178155600401805467ffffffffffffffff60401b191642604081901b67ffffffffffffffff60401b16919091179091557f8131945fa2d842c68bc56805d226137db320755edb5f56b6ed63330113232f35906060906001600160401b0316604051905f82528060208301526040820152a2600190565b505050505f90565b90506020813d602011611d66575b81611d4f6020938361184d565b81010312610dc757611d609061186e565b5f611c99565b3d9150611d42565b86633e91441960e21b5f5260045260245ffd5b631c40f77160e11b5f52600487905260016024526112c586611802565b505f92506002861415611a26565b60025f805160206129c88339815191525414611dd55760025f805160206129c883398151915255565b633ee5aeb560e01b5f5260045ffd5b6001600160401b0381116118395760051b60200190565b805115611e085760200190565b634e487b7160e01b5f52603260045260245ffd5b805160011015611e085760400190565b604d811161124457600a0a90565b8115611e44570490565b634e487b7160e01b5f52601260045260245ffd5b604051630b4c774160e11b81526001600160a01b0380831660048301527f000000000000000000000000000000000000000000000000000000000000000016602482015262ffffff7f0000000000000000000000000000000000000000000000000000000000000000166044820152602081806064810103817f00000000000000000000000000000000000000000000000000000000000000006001600160a01b03165afa908115610f31575f91612678575b506001600160a01b031690811561267057604051611f2a60608261184d565b6002815260208101906040368337610708611f4482611dfb565b525f611f4f82611e1c565b5260405163883bdbfd60e01b815260206004820152905160248201819052909182916044830191905f5b8181106126515750505090805f920381865afa5f9181612537575b50611fa2575050505f905f90565b611fb8611fae82611e1c565b5160060b91611dfb565b5160060b9003667fffffffffffff198112667fffffffffffff8213176112445760060b610708810560020b905f81129081612526575b50612513575b60020b5f81121561250d57805f03905b620d89e882116124fb5760018216156124e9576001600160881b036ffffcb933bd6fad37aa2d162d1a5940015b1691600281166124cd575b600481166124b1575b60088116612495575b60108116612479575b6020811661245d575b60408116612441575b60808116612425575b6101008116612409575b61020081166123ed575b61040081166123d1575b61080081166123b5575b6110008116612399575b612000811661237d575b6140008116612361575b6180008116612345575b620100008116612329575b62020000811661230e575b6204000081166122f3575b62080000166122da575b5f126122cc575b61211f9063ffffffff81166122c4575f905b60201c60ff91909116016001600160a01b031680612697565b60405163313ce56760e01b8152916001600160a01b0316602083600481845afa928315610f31575f93612286575b506040516318160ddd60e01b815292602084600481855afa938415610f31575f94612251575b5060ff61218b91169361218585611e2c565b90611e3a565b93841561224657602060049160405192838092630dfe168160e01b82525afa908115610f31575f91612227575b506001600160a01b031603612211576121d36121d992611e2c565b90612697565b6121e16128c4565b9190911561220857828102928184041490151715611244576122029161279a565b90600190565b5050505f905f90565b61221d61222292611e2c565b6126f6565b6121d9565b612240915060203d602011610f8457610f76818361184d565b5f6121b8565b50505050505f905f90565b9093506020813d60201161227e575b8161226d6020938361184d565b81010312610dc757519260ff612173565b3d9150612260565b9092506020813d6020116122bc575b816122a26020938361184d565b81010312610dc7575160ff81168103610dc757915f61214d565b3d9150612295565b600190612106565b8015611e44575f19046120f4565b6b048a170391f7dc42444e8fa290910260801c906120ed565b6d2216e584f5fa1ea926041bedfe9890920260801c916120e3565b916e5d6af8dedb81196699c329225ee6040260801c916120d8565b916f09aa508b5b7a84e1c677de54f3e99bc90260801c916120cd565b916f31be135f97d08fd981231505542fcfa60260801c916120c2565b916f70d869a156d2a1b890bb3df62baf32f70260801c916120b8565b916fa9f746462d870fdf8a65dc1f90e061e50260801c916120ae565b916fd097f3bdfd2022b8845ad8f792aa58250260801c916120a4565b916fe7159475a2c29b7443b29c7fa6e889d90260801c9161209a565b916ff3392b0822b70005940c7a398e4b70f30260801c91612090565b916ff987a7253ac413176f2b074cf7815e540260801c91612086565b916ffcbe86c7900a88aedcffc83b479aa3a40260801c9161207c565b916ffe5dee046a99a2a811c461f1969c30530260801c91612072565b916fff2ea16466c96a3843ec78b326b528610260801c91612069565b916fff973b41fa98c081472e6896dfb254c00260801c91612060565b916fffcb9843d60f6159c9db58835c9266440260801c91612057565b916fffe5caca7e10e4e61c3624eaa0941cd00260801c9161204e565b916ffff2e50f5f656932ef12357cf3c7fdcc0260801c91612045565b916ffff97272373d413259a46990580e213a0260801c9161203c565b6001600160881b03600160801b612031565b635aaafcdd60e01b5f5260045260245ffd5b80612004565b627fffff198114611244575f1901611ff4565b61070891500760060b15155f611fee565b9091503d805f833e612549818361184d565b8101604082820312610dc75781516001600160401b038111610dc75782019181601f84011215610dc757825161257e81611de4565b9361258c604051958661184d565b81855260208086019260051b82010190848211610dc757602001915b818310612637575050506020810151906001600160401b038211610dc757019080601f83011215610dc7578151916020806125e285611de4565b6125ef604051918261184d565b858152019360051b820101918211610dc757602001915b81831061261757505050905f611f94565b82516001600160a01b0381168103610dc757815260209283019201612606565b82518060060b8103610dc7578152602092830192016125a8565b825163ffffffff16845285945060209384019390920191600101611f79565b50505f905f90565b612691915060203d602011610f8457610f76818361184d565b5f611f0b565b5f91905f1982820991808202938480851094039380850394146126ec57600160601b8410156126da5750600160601b910990828211900360a01b910360601c1790565b634e487b71905260116020526024601cfd5b5050505060601c90565b5f1981600160601b09918160601b9182808510940393808503941461278e5783821115612776578190600160601b09815f0382168092046002816003021880820260020302808202600203028082026002030280820260020302808202600203028091026002030293600183805f03040190848311900302920304170290565b50634e487b715f52156003026011186020526024601cfd5b50906119389250611e3a565b9091905f905f19848209908481029283808410930392808403931461280b5782670de0b6b3a764000011156126da57507faccb18165bd6fe31ae1cf318dc5b51eee0e1ba569b88cd74c1773b91fac106699394670de0b6b3a7640000910990828211900360ee1b910360121c170290565b505050670de0b6b3a76400009192500490565b5f19670de0b6b3a7640000820991670de0b6b3a764000082029182808510940393808503941461278e578382111561277657670de0b6b3a7640000829109815f0382168092046002816003021880820260020302808202600203028082026002030280820260020302808202600203028091026002030293600183805f03040190848311900302920304170290565b519069ffffffffffffffffffff82168203610dc757565b604051633fabe5a360e21b815260a0816004817f00000000000000000000000000000000000000000000000000000000000000006001600160a01b03165afa805f925f92612971575b5061291a5750505f905f90565b5f82131561267057610e10810180911161124457421161296a576122029061296460ff7f000000000000000000000000000000000000000000000000000000000000000016611e2c565b9061281e565b505f905f90565b9250905060a0823d60a0116129bf575b8161298e60a0938361184d565b81010312610dc75761299f826128ad565b5060208201516129b66080606085015194016128ad565b5091905f61290d565b3d915061298156fe9b779b17422d0df92223018b32b4d1fa46e071723d6817e2486d003becc55f00a2646970667358221220a9d829a44aed400b308a584c647d267a6ba3c9860719763355d01c97cc4d967c64736f6c634300081a0033" as `0x${string}`;
