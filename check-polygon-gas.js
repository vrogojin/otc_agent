#!/usr/bin/env node
const ethers = require('ethers');

async function checkGasPrice() {
  const rpcUrl = 'https://bnb-mainnet.g.alchemy.com/v2/EsPVlwvLuUWGfCyqxssgkSqz-xPb9ZnC'; // From logs
  const provider = new ethers.JsonRpcProvider(rpcUrl);

  try {
    const feeData = await provider.getFeeData();
    console.log('\n=== Polygon Gas Prices ===');
    console.log(`Gas Price: ${ethers.formatUnits(feeData.gasPrice || 0n, 'gwei')} gwei`);
    console.log(`Max Fee: ${ethers.formatUnits(feeData.maxFeePerGas || 0n, 'gwei')} gwei`);
    console.log(`Max Priority Fee: ${ethers.formatUnits(feeData.maxPriorityFeePerGas || 0n, 'gwei')} gwei`);

    // Calculate needed for 60k gas approval
    const gasUnits = 60000n;
    const gasCost = gasUnits * (feeData.maxFeePerGas || feeData.gasPrice || 0n);
    const withBuffer = (gasCost * 150n) / 100n; // 50% buffer

    console.log(`\n=== Approval Transaction Cost (60k gas) ===`);
    console.log(`Base cost: ${ethers.formatEther(gasCost)} MATIC`);
    console.log(`With 50% buffer: ${ethers.formatEther(withBuffer)} MATIC`);

  } catch (error) {
    console.error('Error:', error.message);
  }
}

checkGasPrice();
