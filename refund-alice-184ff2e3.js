const { ethers } = require('ethers');
const crypto = require('crypto');

// Derive escrow private key from seed
function deriveEscrowKey(seed, index, chainType = 'EVM') {
  const seedHash = crypto.createHash('sha256').update(seed).digest();
  const hdNode = ethers.HDNodeWallet.fromSeed(seedHash);
  
  // Use EVM derivation path: m/44'/60'/0'/0/{index}
  const path = `m/44'/60'/0'/0/${index}`;
  const derived = hdNode.derivePath(path);
  
  return derived.privateKey;
}

async function refundAlice() {
  const HOT_WALLET_SEED = process.env.HOT_WALLET_SEED || 'otc-broker-dev-seed-unicity-2024';
  const ESCROW_INDEX = 275414; // From logs: [DealIndex] Deal 184ff2e3... ALICE => index 275414
  const ALICE_ADDRESS = '0xf92f4beCa231dC805C5538cB0A94eee537a936FE'; // From transaction
  
  // Derive escrow private key
  const escrowPrivateKey = deriveEscrowKey(HOT_WALLET_SEED, ESCROW_INDEX);
  console.log('Escrow address derived from index', ESCROW_INDEX);
  
  // Connect to Polygon
  const provider = new ethers.JsonRpcProvider(process.env.POLYGON_RPC);
  const escrowWallet = new ethers.Wallet(escrowPrivateKey, provider);
  
  console.log('Escrow address:', escrowWallet.address);
  console.log('Refund to:', ALICE_ADDRESS);
  
  // Native USDC contract
  const nativeUSDC = '0x3c499c542cEF5E3811e1192ce70d8cC03d5c3359';
  const abi = [
    'function balanceOf(address) view returns (uint256)',
    'function transfer(address to, uint256 amount) returns (bool)'
  ];
  
  const usdcContract = new ethers.Contract(nativeUSDC, abi, escrowWallet);
  
  // Check balance
  const balance = await usdcContract.balanceOf(escrowWallet.address);
  console.log('Current Native USDC balance:', ethers.formatUnits(balance, 6), 'USDC');
  
  if (balance === 0n) {
    console.log('ERROR: No balance to refund!');
    return;
  }
  
  // Check MATIC balance for gas
  const maticBalance = await provider.getBalance(escrowWallet.address);
  console.log('MATIC balance for gas:', ethers.formatEther(maticBalance), 'MATIC');
  
  if (maticBalance < ethers.parseEther('0.001')) {
    console.log('WARNING: Low MATIC balance, may not have enough for gas!');
  }
  
  console.log('\n=== REFUND TRANSACTION ===');
  console.log('Amount to refund:', ethers.formatUnits(balance, 6), 'Native USDC');
  console.log('From:', escrowWallet.address);
  console.log('To:', ALICE_ADDRESS);
  console.log('\nExecuting refund...');
  
  // Execute transfer
  const tx = await usdcContract.transfer(ALICE_ADDRESS, balance);
  console.log('Transaction submitted:', tx.hash);
  console.log('Waiting for confirmation...');
  
  const receipt = await tx.wait();
  console.log('✅ Refund confirmed in block:', receipt.blockNumber);
  console.log('Gas used:', receipt.gasUsed.toString());
  console.log('Transaction: https://polygonscan.com/tx/' + receipt.hash);
}

refundAlice().catch(console.error);
