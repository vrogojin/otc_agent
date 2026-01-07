/**
 * INTEGRATION_EXAMPLE.ts
 *
 * This file shows exactly how to integrate the admin dashboard into rpc-server.ts
 * Copy the relevant sections into your actual rpc-server.ts file
 */

// ============================================
// 1. ADD THESE IMPORTS AT THE TOP OF THE FILE
// ============================================

import express from 'express';
import cookieParser from 'cookie-parser'; // NEW: Add this import
import { setupAdminRoutes } from './admin-routes'; // NEW: Add this import

// ... your other imports ...
import { Deal, DealAssetSpec, PartyDetails, DealStage } from '@otc-broker/core';
import { DealRepository, QueueRepository, PayoutRepository } from '../db/repositories';
import { DB } from '../db/database';
import { PluginManager, ChainPlugin } from '@otc-broker/chains';
import * as crypto from 'crypto';
import { EmailService } from '../services/email';

// ============================================
// 2. MODIFY THE CONSTRUCTOR
// ============================================

export class RpcServer {
  private app: express.Application;
  private dealRepo: DealRepository;
  private queueRepo: QueueRepository;
  private payoutRepo: PayoutRepository;
  private pluginManager: PluginManager;
  private emailService: EmailService;
  private server: any | null = null;

  constructor(private db: DB, pluginManager: PluginManager) {
    this.app = express();
    this.app.use(express.json());
    this.app.use(cookieParser()); // NEW: Add cookie parser middleware

    this.dealRepo = new DealRepository(db);
    this.queueRepo = new QueueRepository(db);
    this.payoutRepo = new PayoutRepository(db);
    this.pluginManager = pluginManager;
    this.emailService = new EmailService(db);

    this.setupRoutes(); // Existing routes
    setupAdminRoutes(this.app, this.db, this.pluginManager); // NEW: Setup admin routes
    this.startRetryWorker(); // If you have this
  }

  // ... rest of your RpcServer class ...
}

// ============================================
// 3. ADD TO YOUR .env FILE
// ============================================

/*
# Admin Dashboard Configuration
ADMIN_EMAIL=admin@example.com
ADMIN_PASSWORD=SecurePassword123!

# Existing configuration you already have:
PORT=8080
DB_PATH=./data/otc.db
BASE_URL=http://localhost:8080
HOT_WALLET_SEED=your-seed-phrase
TANK_WALLET_PRIVATE_KEY=0x...
ETH_OPERATOR_ADDRESS=0x...
POLYGON_OPERATOR_ADDRESS=0x...
UNICITY_OPERATOR_ADDRESS=unicity1...
*/

// ============================================
// 4. INSTALL DEPENDENCIES
// ============================================

/*
Run in your terminal:

npm install cookie-parser
npm install --save-dev @types/cookie-parser
*/

// ============================================
// 5. START THE SERVER AND TEST
// ============================================

/*
1. Start your server:
   npm run dev

2. Navigate to:
   http://localhost:8080/admin/login

3. Login with credentials from .env:
   Email: admin@example.com
   Password: SecurePassword123!

4. You should see the deals list page

5. Available routes:
   - /admin/login          (public)
   - /admin/deals          (requires auth)
   - /admin/deals/:id      (requires auth)
   - /admin/accounts       (requires auth)
*/

// ============================================
// 6. PRODUCTION DEPLOYMENT CHECKLIST
// ============================================

/*
Before deploying to production:

[ ] Change default admin credentials
[ ] Enable HTTPS
[ ] Set secure: true on cookies
[ ] Use Redis for session storage
[ ] Hash passwords with bcrypt
[ ] Add rate limiting on login endpoint
[ ] Add CSRF protection
[ ] Configure IP whitelist (optional)
[ ] Set up audit logging
[ ] Test all authentication flows
[ ] Test session expiration
[ ] Test logout functionality
[ ] Review manual spend implementation
[ ] Set up monitoring for low balances

See ADMIN_DASHBOARD_INTEGRATION.md for detailed instructions.
*/

// ============================================
// COMPLETE MINIMAL EXAMPLE
// ============================================

/**
 * This is a minimal complete example of rpc-server.ts with admin dashboard
 */

import express from 'express';
import cookieParser from 'cookie-parser';
import { setupAdminRoutes } from './admin-routes';
import { DB } from '../db/database';
import { PluginManager } from '@otc-broker/chains';
import { DealRepository } from '../db/repositories';

export class RpcServer {
  private app: express.Application;
  private dealRepo: DealRepository;
  private pluginManager: PluginManager;

  constructor(private db: DB, pluginManager: PluginManager) {
    // Setup Express
    this.app = express();
    this.app.use(express.json());
    this.app.use(express.urlencoded({ extended: true })); // For form submissions
    this.app.use(cookieParser()); // For session management

    // Setup repositories
    this.dealRepo = new DealRepository(db);
    this.pluginManager = pluginManager;

    // Setup routes
    this.setupRoutes(); // Your existing JSON-RPC and web routes
    setupAdminRoutes(this.app, this.db, this.pluginManager); // Admin dashboard routes
  }

  private setupRoutes() {
    // JSON-RPC endpoint
    this.app.post('/rpc', async (req, res) => {
      // ... your JSON-RPC handler ...
    });

    // Web interface pages
    this.app.get('/', (req, res) => {
      res.send(this.renderCreateDealPage());
    });

    this.app.get('/d/:dealId/a/:token', (req, res) => {
      const { dealId, token } = req.params;
      res.send(this.renderPartyPage(dealId, token, 'ALICE'));
    });

    this.app.get('/d/:dealId/b/:token', (req, res) => {
      const { dealId, token } = req.params;
      res.send(this.renderPartyPage(dealId, token, 'BOB'));
    });

    // Admin routes are added by setupAdminRoutes() call in constructor
  }

  public listen(port: number, callback?: () => void) {
    this.app.listen(port, callback);
  }

  // ... rest of your methods ...
}

// ============================================
// USAGE IN index.ts
// ============================================

/**
 * Example of how to use RpcServer in your main index.ts
 */

/*
import { DB } from './db/database';
import { PluginManager } from '@otc-broker/chains';
import { RpcServer } from './api/rpc-server';

const db = new DB(process.env.DB_PATH || './data/otc.db');
const pluginManager = new PluginManager();

// Initialize chain plugins
await pluginManager.initializePlugins();

// Create RPC server
const rpcServer = new RpcServer(db, pluginManager);

// Start listening
const port = parseInt(process.env.PORT || '8080');
rpcServer.listen(port, () => {
  console.log(`Server running on http://localhost:${port}`);
  console.log(`Admin dashboard: http://localhost:${port}/admin/login`);
});
*/

// ============================================
// TROUBLESHOOTING
// ============================================

/*
ISSUE: "Cannot find module 'cookie-parser'"
SOLUTION: Run `npm install cookie-parser`

ISSUE: "Cannot find module './admin-routes'"
SOLUTION: Make sure admin-routes.ts exists in the same directory as rpc-server.ts

ISSUE: Login page shows but can't login
SOLUTION: Check that ADMIN_EMAIL and ADMIN_PASSWORD are set in .env

ISSUE: Session expires immediately
SOLUTION: Check that cookie-parser is loaded BEFORE setupAdminRoutes()

ISSUE: Can't access /admin/deals (redirects to login)
SOLUTION: Make sure you logged in first and cookies are enabled in browser

ISSUE: Balances not showing on deal details page
SOLUTION: Check that chain plugins are initialized and RPC endpoints are accessible

ISSUE: Manual spend doesn't work
SOLUTION: This is a placeholder - needs implementation (see admin-routes.ts line ~160)
*/

// ============================================
// FILE STRUCTURE
// ============================================

/*
packages/backend/src/
├── api/
│   ├── rpc-server.ts        (your existing file - modify this)
│   ├── admin-routes.ts      (NEW - route handlers)
│   └── admin-pages.ts       (NEW - HTML renderers)
├── db/
│   ├── database.ts
│   └── repositories/
│       └── DealRepository.ts
└── index.ts

Root directory:
├── ADMIN_DASHBOARD_INTEGRATION.md   (NEW - full integration guide)
├── ADMIN_DASHBOARD_SUMMARY.md       (NEW - summary and overview)
├── INTEGRATION_EXAMPLE.ts           (NEW - this file)
└── admin-dashboard-preview.html     (NEW - visual preview)
*/
