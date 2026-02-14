/**
 * @fileoverview Main entry point for the OTC Broker Engine backend server.
 * Initializes the database, plugin manager, RPC server, and processing engine.
 * Manages the lifecycle of all backend components including graceful shutdown.
 */

import * as dotenv from 'dotenv';
import * as path from 'path';

// Load .env from project root
dotenv.config({ path: path.resolve(__dirname, '../../../.env') });
import { DB, initDatabase } from './db/database';
import { runMigrations } from './db/migrate';
import { RpcServer } from './api/rpc-server';
import { Engine } from './engine/Engine';
import { PluginManager, ChainConfig } from '@otc-broker/chains';
import { RecoveryManager } from './services/RecoveryManager';

/**
 * Main entry point for the backend server.
 * Initializes all components in the correct order:
 * 1. Database with migrations
 * 2. Plugin manager with chain configurations
 * 3. Processing engine
 * 4. RPC API server
 */
async function main() {
  console.log('Starting OTC Broker Engine... (v2)'); // Force reload
  console.log('Electrum URL:', process.env.UNICITY_ELECTRUM || 'not set, using default');

  // Show production mode status
  const productionConfig = await import('./config/production-config');
  const restrictions = productionConfig.getProductionRestrictions();
  if (restrictions.enabled) {
    console.log('=====================================');
    console.log('🔐 PRODUCTION MODE ENABLED');
    console.log('-------------------------------------');
    console.log('Allowed Chains:', restrictions.allowedChains === 'ALL' ? 'ALL CHAINS' : restrictions.allowedChains);
    console.log('Allowed Assets:', restrictions.allowedAssets === 'ALL' ? 'ALL ASSETS' :
      Array.isArray(restrictions.allowedAssets) && restrictions.allowedAssets.length > 10 ?
        `${restrictions.allowedAssets.slice(0, 10).join(', ')}... (${restrictions.allowedAssets.length} total)` :
        restrictions.allowedAssets);
    console.log('Max Amounts:', restrictions.maxAmounts === 'NO LIMITS' ? 'NO LIMITS' : restrictions.maxAmounts);
    console.log('=====================================');
  } else {
    console.log('🔓 Development mode - no production restrictions');
  }

  // Determine database path: production uses separate database
  // This prevents dev and production from interfering with each other
  let dbPath = process.env.DB_PATH || './data/otc.db';
  if (restrictions.enabled) {
    // In production mode, use separate database unless explicitly overridden
    const prodDbPath = process.env.DB_PATH_PRODUCTION || './data/otc-production.db';
    // Only use production DB if DB_PATH wasn't explicitly set
    if (!process.env.DB_PATH) {
      dbPath = prodDbPath;
    }
    console.log(`Using production database: ${dbPath}`);
  } else {
    console.log(`Using development database: ${dbPath}`);
  }

  // Override DB_PATH for initialization
  process.env.DB_PATH = dbPath;

  // Initialize database
  const db = initDatabase();
  runMigrations(db);
  
  // Initialize plugin manager with database for wallet index persistence
  const pluginManager = new PluginManager(db);
  
  // Register Unicity plugin (mandatory)
  await pluginManager.registerPlugin({
    chainId: 'UNICITY',
    electrumUrl: process.env.UNICITY_ELECTRUM || 'wss://fulcrum.unicity.network:50004',
    confirmations: parseInt(process.env.UNICITY_CONFIRMATIONS || '6'),
    collectConfirms: parseInt(process.env.UNICITY_COLLECT_CONFIRMS || '6'),
    operator: { address: process.env.UNICITY_OPERATOR_ADDRESS || 'UNI_OPERATOR_ADDRESS' },
    hotWalletSeed: process.env.HOT_WALLET_SEED,
  });
  
  // Register ETH plugin (always enabled with default or configured RPC)
  await pluginManager.registerPlugin({
    chainId: 'ETH',
    rpcUrl: process.env.ETH_RPC || 'https://ethereum-rpc.publicnode.com',
    confirmations: parseInt(process.env.ETH_CONFIRMATIONS || '12'),
    collectConfirms: parseInt(process.env.ETH_COLLECT_CONFIRMS || '12'),
    operator: { address: process.env.ETH_OPERATOR_ADDRESS || '0x0000000000000000000000000000000000000000' },
    operatorPrivateKey: process.env.ETH_OPERATOR_PRIVATE_KEY,
    hotWalletSeed: process.env.HOT_WALLET_SEED,
    brokerAddress: process.env.ETH_BROKER_ADDRESS, // UnicitySwapBroker contract
    etherscanApiKey: process.env.ETHERSCAN_API_KEY,
  });
  
  // Register Polygon plugin (always enabled with default or configured RPC)
  await pluginManager.registerPlugin({
    chainId: 'POLYGON',
    rpcUrl: process.env.POLYGON_RPC || 'https://polygon-mainnet.g.alchemy.com/v2/9LkJ1e22_qxEBFxOQ4pD3',
    confirmations: parseInt(process.env.POLYGON_CONFIRMATIONS || '30'),
    collectConfirms: parseInt(process.env.POLYGON_COLLECT_CONFIRMS || '30'),
    operator: { address: process.env.POLYGON_OPERATOR_ADDRESS || '0x0000000000000000000000000000000000000000' },
    operatorPrivateKey: process.env.POLYGON_OPERATOR_PRIVATE_KEY,
    hotWalletSeed: process.env.HOT_WALLET_SEED,
    brokerAddress: process.env.POLYGON_BROKER_ADDRESS, // UnicitySwapBroker contract
    etherscanApiKey: process.env.POLYGONSCAN_API_KEY,
  });

  // Register Base plugin (always enabled with default or configured RPC)
  await pluginManager.registerPlugin({
    chainId: 'BASE',
    rpcUrl: process.env.BASE_RPC || 'https://base-rpc.publicnode.com',
    confirmations: parseInt(process.env.BASE_CONFIRMATIONS || '12'),
    collectConfirms: parseInt(process.env.BASE_COLLECT_CONFIRMS || '12'),
    operator: { address: process.env.BASE_OPERATOR_ADDRESS || '0x0000000000000000000000000000000000000000' },
    operatorPrivateKey: process.env.BASE_OPERATOR_PRIVATE_KEY,
    hotWalletSeed: process.env.HOT_WALLET_SEED,
    brokerAddress: process.env.BASE_BROKER_ADDRESS, // UnicitySwapBroker contract
    etherscanApiKey: process.env.BASESCAN_API_KEY,
  });

  // Register Sepolia testnet plugin (if configured)
  if (process.env.SEPOLIA_RPC) {
    await pluginManager.registerPlugin({
      chainId: 'SEPOLIA',
      rpcUrl: process.env.SEPOLIA_RPC,
      confirmations: parseInt(process.env.SEPOLIA_CONFIRMATIONS || '3'),
      collectConfirms: parseInt(process.env.SEPOLIA_COLLECT_CONFIRMS || '3'),
      operator: { address: process.env.SEPOLIA_OPERATOR_ADDRESS || process.env.ETH_OPERATOR_ADDRESS || '0x0000000000000000000000000000000000000000' },
      operatorPrivateKey: process.env.SEPOLIA_OPERATOR_PRIVATE_KEY || process.env.ETH_OPERATOR_PRIVATE_KEY,
      hotWalletSeed: process.env.HOT_WALLET_SEED,
      brokerAddress: process.env.SEPOLIA_BROKER_ADDRESS, // UnicitySwapBroker contract
      etherscanApiKey: process.env.SEPOLIASCAN_API_KEY || process.env.ETHERSCAN_API_KEY,
    });
    console.log('Sepolia testnet enabled');
  }

  // Register BSC plugin (if configured)
  if (process.env.BSC_RPC) {
    await pluginManager.registerPlugin({
      chainId: 'BSC',
      rpcUrl: process.env.BSC_RPC,
      confirmations: parseInt(process.env.BSC_CONFIRMATIONS || '12'),
      collectConfirms: parseInt(process.env.BSC_COLLECT_CONFIRMS || '12'),
      operator: { address: process.env.BSC_OPERATOR_ADDRESS || process.env.ETH_OPERATOR_ADDRESS || '0x0000000000000000000000000000000000000000' },
      operatorPrivateKey: process.env.BSC_OPERATOR_PRIVATE_KEY,
      hotWalletSeed: process.env.HOT_WALLET_SEED,
      brokerAddress: process.env.BSC_BROKER_ADDRESS, // UnicitySwapBroker contract
      etherscanApiKey: process.env.BSCSCAN_API_KEY,
    });
    console.log('BSC enabled');
  }

  // Initialize engine
  const engine = new Engine(db, pluginManager);

  // Initialize Recovery Manager
  const recoveryManager = new RecoveryManager({
    db,
    chainPlugins: pluginManager.getAllPlugins(),
    // Gas funding: Automatically uses TANK_WALLET_PRIVATE_KEY from env if available
    // Falls back to TankManager if provided, or operates without gas funding
    recoveryInterval: parseInt(process.env.RECOVERY_INTERVAL || '300000'), // 5 minutes default
    maxAttempts: parseInt(process.env.RECOVERY_MAX_ATTEMPTS || '3'),
    stuckThreshold: parseInt(process.env.RECOVERY_STUCK_THRESHOLD || '300000'), // 5 minutes
    failedTxThreshold: parseInt(process.env.RECOVERY_FAILED_TX_THRESHOLD || '600000'), // 10 minutes
  });

  // Start RPC server
  const rpcServer = new RpcServer(db, pluginManager);

  // Determine port: production mode defaults to 80, dev mode defaults to 8080
  const defaultPort = restrictions.enabled ? '80' : '8080';
  const port = parseInt(process.env.PORT || defaultPort);

  console.log(`Starting server on port ${port} (${restrictions.enabled ? 'production' : 'development'} mode)`);
  rpcServer.start(port);

  // Start engine loop
  await engine.start();

  // Start recovery manager
  await recoveryManager.start();
  console.log('Recovery Manager started');

  // Graceful shutdown
  process.on('SIGINT', async () => {
    console.log('Shutting down...');
    await recoveryManager.stop();
    engine.stop();
    db.close();
    process.exit(0);
  });

  process.on('SIGTERM', async () => {
    console.log('Received SIGTERM, shutting down gracefully...');
    await recoveryManager.stop();
    engine.stop();
    db.close();
    process.exit(0);
  });
}

main().catch(error => {
  console.error('Fatal error:', error);
  process.exit(1);
});