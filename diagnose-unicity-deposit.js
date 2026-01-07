#!/usr/bin/env node
/**
 * Diagnostic script for UNICITY deposit detection issues
 * Checks Electrum connection and queries blockchain for deposits
 */

const WebSocket = require('ws');
const crypto = require('crypto');

const ELECTRUM_URL = 'wss://fulcrum.unicity.network:50004';
const TARGET_ADDRESS = 'alpha1qtyxrv0mcmffz7yaf4309sxnu3885qw5alf9ptw';
const DEAL_ID = 'eb5248ae6bace537a952b6314073cac6';

let requestId = 1;
const pendingRequests = new Map();

/**
 * Convert bech32 address to scripthash for Electrum queries
 */
function addressToScriptHash(address) {
  try {
    const bech32 = require('bech32');

    // Decode the bech32 address
    const decoded = bech32.bech32.decode(address);

    if (!decoded) {
      throw new Error('Failed to decode bech32 address');
    }

    console.log('Decoded bech32:', decoded);

    // First word is the witness version
    const witnessVersion = decoded.words[0];

    // Convert remaining words from 5-bit to 8-bit
    const witnessProgram = bech32.bech32.fromWords(decoded.words.slice(1));

    console.log('Witness version:', witnessVersion);
    console.log('Witness program:', Buffer.from(witnessProgram).toString('hex'));

    // Create the scriptPubKey for P2WPKH
    const scriptPubKey = [];

    // Add witness version (OP_0 for version 0)
    if (witnessVersion === 0) {
      scriptPubKey.push(0x00); // OP_0
    } else if (witnessVersion <= 16) {
      scriptPubKey.push(0x50 + witnessVersion); // OP_1 through OP_16
    } else {
      throw new Error('Unsupported witness version');
    }

    // Add push opcode for witness program length
    scriptPubKey.push(witnessProgram.length);

    // Add witness program
    scriptPubKey.push(...witnessProgram);

    // Convert to Buffer and hash
    const script = Buffer.from(scriptPubKey);
    console.log('ScriptPubKey:', script.toString('hex'));

    const hash = crypto.createHash('sha256').update(script).digest();
    console.log('SHA256 hash:', hash.toString('hex'));

    // Reverse for Electrum (little-endian)
    const scriptHash = hash.reverse().toString('hex');
    console.log('Scripthash (reversed):', scriptHash);

    return scriptHash;
  } catch (error) {
    console.error('Error converting address to scripthash:', error);
    throw error;
  }
}

/**
 * Send Electrum request
 */
function electrumRequest(ws, method, params) {
  return new Promise((resolve, reject) => {
    const id = requestId++;
    pendingRequests.set(id, { resolve, reject });

    const request = { id, method, params };
    console.log('\n→ Sending request:', JSON.stringify(request, null, 2));
    ws.send(JSON.stringify(request));

    // Timeout after 30 seconds
    setTimeout(() => {
      if (pendingRequests.has(id)) {
        pendingRequests.delete(id);
        reject(new Error(`Request ${method} timed out`));
      }
    }, 30000);
  });
}

/**
 * Main diagnostic function
 */
async function diagnose() {
  console.log('='.repeat(80));
  console.log('UNICITY DEPOSIT DETECTION DIAGNOSTIC');
  console.log('='.repeat(80));
  console.log(`Deal ID: ${DEAL_ID}`);
  console.log(`Target Address: ${TARGET_ADDRESS}`);
  console.log(`Electrum URL: ${ELECTRUM_URL}`);
  console.log('='.repeat(80));

  return new Promise((resolve, reject) => {
    const ws = new WebSocket(ELECTRUM_URL);

    ws.on('open', async () => {
      console.log('\n✓ Connected to Electrum server');

      try {
        // Step 1: Convert address to scripthash
        console.log('\n[STEP 1] Converting address to scripthash...');
        const scriptHash = addressToScriptHash(TARGET_ADDRESS);

        // Step 2: Get server info
        console.log('\n[STEP 2] Getting server info...');
        const serverVersion = await electrumRequest(ws, 'server.version', ['diagnostic-script', '1.4']);
        console.log('← Server version:', serverVersion);

        // Step 3: Get current block height
        console.log('\n[STEP 3] Getting current block height...');
        const headers = await electrumRequest(ws, 'blockchain.headers.subscribe', []);
        console.log('← Current block height:', headers.height);

        // Step 4: Get address history
        console.log('\n[STEP 4] Getting address history...');
        const history = await electrumRequest(ws, 'blockchain.scripthash.get_history', [scriptHash]);
        console.log('← Address history:', JSON.stringify(history, null, 2));

        if (history.length === 0) {
          console.log('\n⚠️  NO TRANSACTIONS FOUND FOR THIS ADDRESS');
          console.log('This means either:');
          console.log('  1. No funds have been sent to this address');
          console.log('  2. The address format is incorrect');
          console.log('  3. The scripthash calculation is wrong');
        } else {
          console.log(`\n✓ Found ${history.length} transaction(s)`);

          // Step 5: Get UTXOs
          console.log('\n[STEP 5] Getting UTXOs...');
          const utxos = await electrumRequest(ws, 'blockchain.scripthash.listunspent', [scriptHash]);
          console.log('← UTXOs:', JSON.stringify(utxos, null, 2));

          if (utxos.length === 0) {
            console.log('\n⚠️  NO UNSPENT UTXOs (all funds may have been spent)');
          } else {
            console.log(`\n✓ Found ${utxos.length} unspent UTXO(s)`);

            // Step 6: Get details for each UTXO
            for (let i = 0; i < utxos.length; i++) {
              const utxo = utxos[i];
              console.log(`\n[STEP 6.${i+1}] Getting transaction details for ${utxo.tx_hash}...`);

              const tx = await electrumRequest(ws, 'blockchain.transaction.get', [utxo.tx_hash, true]);

              const confirms = utxo.height > 0 ? headers.height - utxo.height + 1 : 0;
              const amountALPHA = utxo.value / 100000000;

              console.log('← Transaction details:');
              console.log(`   TXID: ${utxo.tx_hash}`);
              console.log(`   Output Index: ${utxo.tx_pos}`);
              console.log(`   Amount: ${amountALPHA} ALPHA (${utxo.value} satoshis)`);
              console.log(`   Block Height: ${utxo.height}`);
              console.log(`   Block Time: ${new Date(tx.time * 1000).toISOString()}`);
              console.log(`   Confirmations: ${confirms}`);
              console.log(`   Required Confirmations: 2 (from UNICITY_COLLECT_CONFIRMS)`);

              if (confirms >= 2) {
                console.log(`   ✓ SUFFICIENT CONFIRMATIONS - Should be detected`);
              } else {
                console.log(`   ⚠️  INSUFFICIENT CONFIRMATIONS - Need ${2 - confirms} more`);
              }
            }
          }
        }

        // Step 7: Get balance
        console.log('\n[STEP 7] Getting address balance...');
        const balance = await electrumRequest(ws, 'blockchain.scripthash.get_balance', [scriptHash]);
        console.log('← Balance:', JSON.stringify(balance, null, 2));
        console.log(`   Confirmed: ${balance.confirmed / 100000000} ALPHA`);
        console.log(`   Unconfirmed: ${balance.unconfirmed / 100000000} ALPHA`);

        console.log('\n' + '='.repeat(80));
        console.log('DIAGNOSTIC COMPLETE');
        console.log('='.repeat(80));

        ws.close();
        resolve();
      } catch (error) {
        console.error('\n❌ Error during diagnosis:', error);
        ws.close();
        reject(error);
      }
    });

    ws.on('message', (data) => {
      try {
        const response = JSON.parse(data.toString());
        const pending = pendingRequests.get(response.id);
        if (pending) {
          pendingRequests.delete(response.id);
          if (response.error) {
            pending.reject(new Error(response.error.message || response.error));
          } else {
            pending.resolve(response.result);
          }
        }
      } catch (error) {
        console.error('Failed to parse Electrum response:', error);
      }
    });

    ws.on('error', (error) => {
      console.error('\n❌ WebSocket error:', error);
      reject(error);
    });

    ws.on('close', () => {
      console.log('\n✓ Connection closed');
    });
  });
}

// Run diagnostic
diagnose()
  .then(() => process.exit(0))
  .catch((error) => {
    console.error('Fatal error:', error);
    process.exit(1);
  });
