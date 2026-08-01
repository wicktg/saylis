// Auto-generated from Foundry build artifacts. Do not hand-edit ABI/bytecode.
export const IMMUTABLE_LAUNCH_TOKEN_ABI = [
  {
    "type": "constructor",
    "inputs": [
      {
        "name": "name_",
        "type": "string",
        "internalType": "string"
      },
      {
        "name": "symbol_",
        "type": "string",
        "internalType": "string"
      },
      {
        "name": "decimals_",
        "type": "uint8",
        "internalType": "uint8"
      },
      {
        "name": "totalSupply_",
        "type": "uint256",
        "internalType": "uint256"
      },
      {
        "name": "curve",
        "type": "address",
        "internalType": "address"
      }
    ],
    "stateMutability": "nonpayable"
  },
  {
    "type": "function",
    "name": "allowance",
    "inputs": [
      {
        "name": "owner",
        "type": "address",
        "internalType": "address"
      },
      {
        "name": "spender",
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
    "name": "approve",
    "inputs": [
      {
        "name": "spender",
        "type": "address",
        "internalType": "address"
      },
      {
        "name": "value",
        "type": "uint256",
        "internalType": "uint256"
      }
    ],
    "outputs": [
      {
        "name": "",
        "type": "bool",
        "internalType": "bool"
      }
    ],
    "stateMutability": "nonpayable"
  },
  {
    "type": "function",
    "name": "balanceOf",
    "inputs": [
      {
        "name": "account",
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
    "name": "decimals",
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
    "name": "name",
    "inputs": [],
    "outputs": [
      {
        "name": "",
        "type": "string",
        "internalType": "string"
      }
    ],
    "stateMutability": "view"
  },
  {
    "type": "function",
    "name": "symbol",
    "inputs": [],
    "outputs": [
      {
        "name": "",
        "type": "string",
        "internalType": "string"
      }
    ],
    "stateMutability": "view"
  },
  {
    "type": "function",
    "name": "totalSupply",
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
    "name": "transfer",
    "inputs": [
      {
        "name": "to",
        "type": "address",
        "internalType": "address"
      },
      {
        "name": "value",
        "type": "uint256",
        "internalType": "uint256"
      }
    ],
    "outputs": [
      {
        "name": "",
        "type": "bool",
        "internalType": "bool"
      }
    ],
    "stateMutability": "nonpayable"
  },
  {
    "type": "function",
    "name": "transferFrom",
    "inputs": [
      {
        "name": "from",
        "type": "address",
        "internalType": "address"
      },
      {
        "name": "to",
        "type": "address",
        "internalType": "address"
      },
      {
        "name": "value",
        "type": "uint256",
        "internalType": "uint256"
      }
    ],
    "outputs": [
      {
        "name": "",
        "type": "bool",
        "internalType": "bool"
      }
    ],
    "stateMutability": "nonpayable"
  },
  {
    "type": "event",
    "name": "Approval",
    "inputs": [
      {
        "name": "owner",
        "type": "address",
        "indexed": true,
        "internalType": "address"
      },
      {
        "name": "spender",
        "type": "address",
        "indexed": true,
        "internalType": "address"
      },
      {
        "name": "value",
        "type": "uint256",
        "indexed": false,
        "internalType": "uint256"
      }
    ],
    "anonymous": false
  },
  {
    "type": "event",
    "name": "Transfer",
    "inputs": [
      {
        "name": "from",
        "type": "address",
        "indexed": true,
        "internalType": "address"
      },
      {
        "name": "to",
        "type": "address",
        "indexed": true,
        "internalType": "address"
      },
      {
        "name": "value",
        "type": "uint256",
        "indexed": false,
        "internalType": "uint256"
      }
    ],
    "anonymous": false
  },
  {
    "type": "error",
    "name": "ERC20InsufficientAllowance",
    "inputs": [
      {
        "name": "spender",
        "type": "address",
        "internalType": "address"
      },
      {
        "name": "allowance",
        "type": "uint256",
        "internalType": "uint256"
      },
      {
        "name": "needed",
        "type": "uint256",
        "internalType": "uint256"
      }
    ]
  },
  {
    "type": "error",
    "name": "ERC20InsufficientBalance",
    "inputs": [
      {
        "name": "sender",
        "type": "address",
        "internalType": "address"
      },
      {
        "name": "balance",
        "type": "uint256",
        "internalType": "uint256"
      },
      {
        "name": "needed",
        "type": "uint256",
        "internalType": "uint256"
      }
    ]
  },
  {
    "type": "error",
    "name": "ERC20InvalidApprover",
    "inputs": [
      {
        "name": "approver",
        "type": "address",
        "internalType": "address"
      }
    ]
  },
  {
    "type": "error",
    "name": "ERC20InvalidReceiver",
    "inputs": [
      {
        "name": "receiver",
        "type": "address",
        "internalType": "address"
      }
    ]
  },
  {
    "type": "error",
    "name": "ERC20InvalidSender",
    "inputs": [
      {
        "name": "sender",
        "type": "address",
        "internalType": "address"
      }
    ]
  },
  {
    "type": "error",
    "name": "ERC20InvalidSpender",
    "inputs": [
      {
        "name": "spender",
        "type": "address",
        "internalType": "address"
      }
    ]
  }
] as const;

export const IMMUTABLE_LAUNCH_TOKEN_BYTECODE = '0x60a06040523461047b57610b1f803803806100198161047f565b928339810160a08282031261047b5781516001600160401b03811161047b57816100449184016104a4565b602083015190916001600160401b03821161047b576100649184016104a4565b91604081015160ff8116810361047b5760608201516080909201516001600160a01b038116939084900361047b578051906001600160401b03821161037e5760035490600182811c92168015610471575b60208310146103605781601f849311610403575b50602090601f831160011461039d575f92610392575b50508160011b915f199060031b1c1916176003555b83516001600160401b03811161037e57600454600181811c91168015610374575b602082101461036057601f81116102fd575b50602094601f821160011461029a579481929394955f9261028f575b50508160011b915f199060031b1c1916176004555b82156102365781156101e157608052600254908082018092116101cd5760207fddf252ad1be2c89b69c2b068fc378daa952ba7f163c4a11628f55a4df523b3ef915f9360025584845283825260408420818154019055604051908152a360405161062990816104f682396080518161026f0152f35b634e487b7160e01b5f52601160045260245ffd5b60405162461bcd60e51b815260206004820152602760248201527f496d6d757461626c654c61756e6368546f6b656e3a207a65726f20746f74616c60448201526620737570706c7960c81b6064820152608490fd5b60405162461bcd60e51b815260206004820152602b60248201527f496d6d757461626c654c61756e6368546f6b656e3a206375727665206973207a60448201526a65726f206164647265737360a81b6064820152608490fd5b015190505f80610143565b601f1982169560045f52805f20915f5b8881106102e5575083600195969798106102cd575b505050811b01600455610158565b01515f1960f88460031b161c191690555f80806102bf565b919260206001819286850151815501940192016102aa565b60045f527f8a35acfbc15ff81a39ae7d344fd709f28e8600b4aa8c65c6b64bfe7fe36bd19b601f830160051c81019160208410610356575b601f0160051c01905b81811061034b5750610127565b5f815560010161033e565b9091508190610335565b634e487b7160e01b5f52602260045260245ffd5b90607f1690610115565b634e487b7160e01b5f52604160045260245ffd5b015190505f806100df565b60035f9081528281209350601f198516905b8181106103eb57509084600195949392106103d3575b505050811b016003556100f4565b01515f1960f88460031b161c191690555f80806103c5565b929360206001819287860151815501950193016103af565b60035f529091507fc2575a0e9e593c00f959f8c92f12db2869c3395a3b0502d05e2516446f71f85b601f840160051c81019160208510610467575b90601f859493920160051c01905b81811061045957506100c9565b5f815584935060010161044c565b909150819061043e565b91607f16916100b5565b5f80fd5b6040519190601f01601f191682016001600160401b0381118382101761037e57604052565b81601f8201121561047b578051906001600160401b03821161037e576104d3601f8301601f191660200161047f565b928284526020838301011161047b57815f9260208093018386015e830101529056fe6080806040526004361015610012575f80fd5b5f3560e01c90816306fdde031461041157508063095ea7b31461038f57806318160ddd1461037257806323b872dd14610293578063313ce5671461025657806370a082311461021f57806395d89b4114610104578063a9059cbb146100d35763dd62ed3e1461007f575f80fd5b346100cf5760403660031901126100cf5761009861050a565b6100a0610520565b6001600160a01b039182165f908152600160209081526040808320949093168252928352819020549051908152f35b5f80fd5b346100cf5760403660031901126100cf576100f96100ef61050a565b6024359033610536565b602060405160018152f35b346100cf575f3660031901126100cf576040515f6004548060011c90600181168015610215575b602083108114610201578285529081156101e55750600114610190575b50819003601f01601f191681019067ffffffffffffffff82118183101761017c57610178829182604052826104e0565b0390f35b634e487b7160e01b5f52604160045260245ffd5b905060045f527f8a35acfbc15ff81a39ae7d344fd709f28e8600b4aa8c65c6b64bfe7fe36bd19b5f905b8282106101cf57506020915082010182610148565b60018160209254838588010152019101906101ba565b90506020925060ff191682840152151560051b82010182610148565b634e487b7160e01b5f52602260045260245ffd5b91607f169161012b565b346100cf5760203660031901126100cf576001600160a01b0361024061050a565b165f525f602052602060405f2054604051908152f35b346100cf575f3660031901126100cf57602060405160ff7f0000000000000000000000000000000000000000000000000000000000000000168152f35b346100cf5760603660031901126100cf576102ac61050a565b6102b4610520565b6001600160a01b0382165f818152600160209081526040808320338452909152902054909260443592915f1981106102f2575b506100f99350610536565b838110610357578415610344573315610331576100f9945f52600160205260405f2060018060a01b0333165f526020528360405f2091039055846102e7565b634a1406b160e11b5f525f60045260245ffd5b63e602df0560e01b5f525f60045260245ffd5b8390637dc7a0d960e11b5f523360045260245260445260645ffd5b346100cf575f3660031901126100cf576020600254604051908152f35b346100cf5760403660031901126100cf576103a861050a565b602435903315610344576001600160a01b031690811561033157335f52600160205260405f20825f526020528060405f20556040519081527f8c5be1e5ebec7d5bd14f71427d1e84f3dd0314c0f7b2291e5b200ac8c7c3b92560203392a3602060405160018152f35b346100cf575f3660031901126100cf575f6003548060011c906001811680156104d6575b602083108114610201578285529081156101e557506001146104815750819003601f01601f191681019067ffffffffffffffff82118183101761017c57610178829182604052826104e0565b905060035f527fc2575a0e9e593c00f959f8c92f12db2869c3395a3b0502d05e2516446f71f85b5f905b8282106104c057506020915082010182610148565b60018160209254838588010152019101906104ab565b91607f1691610435565b602060409281835280519182918282860152018484015e5f828201840152601f01601f1916010190565b600435906001600160a01b03821682036100cf57565b602435906001600160a01b03821682036100cf57565b6001600160a01b03169081156105e0576001600160a01b03169182156105cd57815f525f60205260405f20548181106105b457817fddf252ad1be2c89b69c2b068fc378daa952ba7f163c4a11628f55a4df523b3ef92602092855f525f84520360405f2055845f525f825260405f20818154019055604051908152a3565b8263391434e360e21b5f5260045260245260445260645ffd5b63ec442f0560e01b5f525f60045260245ffd5b634b637e8f60e11b5f525f60045260245ffdfea26469706673582212209718da40842b79254678bf8fca2b849d2006d47079be5ac1dd72a21b028630af64736f6c634300081a0033' as `0x${string}`;
