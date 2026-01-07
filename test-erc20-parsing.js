#!/usr/bin/env node
/**
 * Test script to debug ERC20 transfer parsing for Sepolia transaction
 * Transaction: 0x980bf6b1f57d1479c5be1bb46bdb4bda1c7874a8a3dd26815e56695257729994
 */

const txHash = '0x980bf6b1f57d1479c5be1bb46bdb4bda1c7874a8a3dd26815e56695257729994';

// Transaction receipt data (from Etherscan API)
const receipt = {
  "logs": [
    {
      "address": "0x1c7d4b196cb0c7b01d743fbc6116a902379c7238",
      "topics": [
        "0xddf252ad1be2c89b69c2b068fc378daa952ba7f163c4a11628f55a4df523b3ef",
        "0x0000000000000000000000007dbed7af42fc2505ae0d50ac9f40459fb0ff2eb7",
        "0x000000000000000000000000c7dcbf135f088da2a4bec3fab5c21c30735166c8"
      ],
      "data": "0x00000000000000000000000000000000000000000000000000000000000186a0",
      "logIndex": "0x7f"
    },
    {
      "address": "0x1c7d4b196cb0c7b01d743fbc6116a902379c7238",
      "topics": [
        "0xddf252ad1be2c89b69c2b068fc378daa952ba7f163c4a11628f55a4df523b3ef",
        "0x0000000000000000000000007dbed7af42fc2505ae0d50ac9f40459fb0ff2eb7",
        "0x000000000000000000000000ed3f3f5974599f6455b06bb566c267cc64a6f1d1"
      ],
      "data": "0x000000000000000000000000000000000000000000000000000000000000012c",
      "logIndex": "0x80"
    },
    {
      "address": "0x1c7d4b196cb0c7b01d743fbc6116a902379c7238",
      "topics": [
        "0xddf252ad1be2c89b69c2b068fc378daa952ba7f163c4a11628f55a4df523b3ef",
        "0x0000000000000000000000007dbed7af42fc2505ae0d50ac9f40459fb0ff2eb7",
        "0x0000000000000000000000009b17b793a2ab1f7234ddb599f8ad5b1b7f3e39de"
      ],
      "data": "0x0000000000000000000000000000000000000000000000000000000000018574",
      "logIndex": "0x81"
    }
  ]
};

console.log('\n=== Transaction Analysis ===');
console.log(`TX Hash: ${txHash}`);
console.log(`\n=== ERC20 Transfer Events Found ===`);

const TRANSFER_EVENT_TOPIC = '0xddf252ad1be2c89b69c2b068fc378daa952ba7f163c4a11628f55a4df523b3ef';

const transfers = [];
for (const log of receipt.logs) {
  if (log.topics && log.topics[0] === TRANSFER_EVENT_TOPIC) {
    const from = '0x' + log.topics[1].slice(26); // Remove padding
    const to = '0x' + log.topics[2].slice(26);   // Remove padding
    const value = log.data;
    const valueDec = BigInt(value);

    transfers.push({
      tokenAddress: log.address,
      from,
      to,
      value,
      valueDec: valueDec.toString(),
      logIndex: parseInt(log.logIndex, 16)
    });
  }
}

console.log(`\nFound ${transfers.length} ERC20 Transfer events:\n`);

transfers.forEach((transfer, index) => {
  console.log(`Transfer #${index}:`);
  console.log(`  Token: ${transfer.tokenAddress}`);
  console.log(`  From: ${transfer.from}`);
  console.log(`  To: ${transfer.to}`);
  console.log(`  Value (raw): ${transfer.value}`);
  console.log(`  Value (decimal): ${transfer.valueDec}`);
  console.log(`  Value (USDC, 6 decimals): ${(Number(transfer.valueDec) / 1e6).toFixed(6)}`);
  console.log(`  Log Index: ${transfer.logIndex}`);
  console.log('');
});

// Now test what getERC20TransfersByTxHash() would return
console.log('\n=== Expected EtherscanAPI.getERC20TransfersByTxHash() Output ===\n');
console.log(JSON.stringify(transfers, null, 2));

// Identify the broker contract from the transaction
const brokerContract = '0x7dBEd7Af42Fc2505AE0d50ac9F40459Fb0FF2eb7'.toLowerCase();
const sepoliaBrokerFromEnv = '0x4c164aF901b7cDc1864c91E3aB873E5cF8dce808'.toLowerCase();

console.log('\n=== Broker Contract Analysis ===');
console.log(`Broker (from tx "from" addresses): ${brokerContract}`);
console.log(`Broker (from .env SEPOLIA_BROKER_ADDRESS): ${sepoliaBrokerFromEnv}`);

// Filter transfers FROM broker
console.log('\n=== Filtering Logic Test ===');
transfers.forEach((transfer, index) => {
  const fromLower = transfer.from.toLowerCase();
  console.log(`\nTransfer #${index}:`);
  console.log(`  From: ${transfer.from}`);
  console.log(`  From (lowercase): ${fromLower}`);
  console.log(`  Matches brokerContract (${brokerContract})? ${fromLower === brokerContract}`);
  console.log(`  Matches sepoliaBrokerFromEnv (${sepoliaBrokerFromEnv})? ${fromLower === sepoliaBrokerFromEnv}`);
});

const brokerTransfersWrong = transfers.filter(tx => tx.from.toLowerCase() === brokerContract);
const brokerTransfersCorrect = transfers.filter(tx => tx.from.toLowerCase() === sepoliaBrokerFromEnv);

console.log('\n=== ISSUE IDENTIFIED ===');
console.log(`\nUsing WRONG broker address (${brokerContract}): ${brokerTransfersWrong.length} transfers`);
console.log(`Using CORRECT broker address (${sepoliaBrokerFromEnv}): ${brokerTransfersCorrect.length} transfers`);

if (brokerTransfersWrong.length === 0) {
  console.log('\n❌ ROOT CAUSE: The transfers are FROM an intermediate contract (0x7dbed7af...), NOT from the broker contract (0x4c164af...)');
  console.log('\nThe broker contract (0x4c164af...) is the contract that receives the method call,');
  console.log('but the actual ERC20 transfers originate from an escrow contract (0x7dbed7af...).');
  console.log('\nThis is why getERC20Transfers() filtering by brokerAddress fails - the "from" addresses');
  console.log('in Transfer events are the escrow contract, not the broker contract.');
}

console.log('\n=== Transaction Details ===');
console.log('Transaction TO address: 0x4c164af901b7cdc1864c91e3ab873e5cf8dce808 (broker contract)');
console.log('Transfers FROM address: 0x7dbed7af42fc2505ae0d50ac9f40459fb0ff2eb7 (escrow contract)');
console.log('\nThis indicates the broker uses an escrow contract pattern where:');
console.log('1. User calls broker contract method (swapERC20, revertERC20, etc.)');
console.log('2. Broker contract delegates to escrow contract');
console.log('3. Escrow contract executes the actual ERC20 transfers');
