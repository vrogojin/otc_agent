# Admin Dashboard Integration Guide

## Overview

Simple, clean admin dashboard UI for managing OTC Broker Engine. Features dark theme, Bootstrap 5 styling, and server-side rendered HTML pages.

## Files Created

1. `/packages/backend/src/api/admin-pages.ts` - HTML template renderers
2. `/packages/backend/src/api/admin-routes.ts` - Express route handlers

## Features

### 1. Login Page (`/admin/login`)
- Email + password authentication
- Error message display
- Session management (24-hour sessions)
- Dark theme with gradient background

### 2. Deals List (`/admin/deals`)
- Table view of all deals
- Shows: Deal ID, Name, Stage, Alice/Bob assets, Created date
- Color-coded stage badges
- Click row to view details
- Responsive table layout

### 3. Deal Details (`/admin/deals/:id`)
- Full deal information
- Alice and Bob details
- Escrow addresses with live balances
- Manual spend form for emergency operations
- Stage-based color coding

### 4. Accounts Page (`/admin/accounts`)
- Tank wallet balances (gas funding)
- Operator address balances
- Per-chain native and ERC20 balances
- Low balance warnings (highlighted in red)

## Integration Steps

### Step 1: Install Dependencies

```bash
npm install cookie-parser
npm install --save-dev @types/cookie-parser
```

### Step 2: Update RPC Server

In `/packages/backend/src/api/rpc-server.ts`, add cookie-parser and import admin routes:

```typescript
import cookieParser from 'cookie-parser';
import { setupAdminRoutes } from './admin-routes';

// In the constructor, add cookie-parser middleware:
constructor(private db: DB, pluginManager: PluginManager) {
  this.app = express();
  this.app.use(express.json());
  this.app.use(cookieParser()); // Add this line

  // ... existing code ...

  this.setupRoutes();
  setupAdminRoutes(this.app, this.db, this.pluginManager); // Add this line
  this.startRetryWorker();
}
```

### Step 3: Configure Environment Variables

Add to your `.env` file:

```bash
# Admin Dashboard Credentials
ADMIN_EMAIL=admin@example.com
ADMIN_PASSWORD=your-secure-password-here

# These are already in your config, but needed for accounts page:
TANK_WALLET_PRIVATE_KEY=0x...
ETH_LOW_GAS_THRESHOLD=0.1
POLYGON_LOW_GAS_THRESHOLD=5
ETH_OPERATOR_ADDRESS=0x...
POLYGON_OPERATOR_ADDRESS=0x...
UNICITY_OPERATOR_ADDRESS=...
```

### Step 4: Start the Server

```bash
npm run dev
```

Navigate to: `http://localhost:8080/admin/login`

## Usage

### Login
1. Go to `/admin/login`
2. Enter email and password
3. Session lasts 24 hours
4. Logout via the navbar button

### View Deals
1. After login, you'll see all deals in a table
2. Click any row to view details
3. Use the navbar to switch between Deals and Accounts

### Manual Spend (Emergency Operation)
1. Go to deal details page
2. Scroll to "Manual Spend from Escrow" form
3. Fill in:
   - Chain ID (select from dropdown)
   - Escrow Address (select from dropdown)
   - To Address (destination)
   - Asset (e.g., NATIVE, ERC20:0x...)
   - Amount
4. Click "Execute Spend"

⚠️ **Warning**: Manual spend is for emergency use only. It bypasses normal deal flow.

### View Account Balances
1. Click "Accounts" in navbar
2. View tank wallet balances per chain
3. View operator balances per chain
4. Red highlighting indicates low balances

## Security Considerations

### Current Implementation (Development)
- Simple in-memory session storage
- Plain text password comparison
- No rate limiting
- HTTP-only cookies

### Production Recommendations

1. **Use Environment Variables for Credentials**
   ```bash
   ADMIN_EMAIL=admin@yourdomain.com
   ADMIN_PASSWORD=$(openssl rand -base64 32)
   ```

2. **Enable HTTPS**
   - Use secure cookies: `secure: true`
   - Force HTTPS redirect

3. **Use Redis for Session Storage**
   ```typescript
   import RedisStore from 'connect-redis';
   import { createClient } from 'redis';

   const redisClient = createClient();
   const sessionStore = new RedisStore({ client: redisClient });
   ```

4. **Hash Passwords**
   ```typescript
   import bcrypt from 'bcrypt';

   const hashedPassword = await bcrypt.hash(password, 10);
   const isValid = await bcrypt.compare(password, hashedPassword);
   ```

5. **Add Rate Limiting**
   ```typescript
   import rateLimit from 'express-rate-limit';

   const loginLimiter = rateLimit({
     windowMs: 15 * 60 * 1000, // 15 minutes
     max: 5, // 5 attempts
   });

   app.post('/admin/login', loginLimiter, ...);
   ```

6. **Add CSRF Protection**
   ```typescript
   import csrf from 'csurf';

   app.use(csrf({ cookie: true }));
   ```

7. **IP Whitelist (Optional)**
   ```typescript
   const ALLOWED_IPS = ['127.0.0.1', '192.168.1.100'];

   function ipWhitelist(req, res, next) {
     if (!ALLOWED_IPS.includes(req.ip)) {
       return res.status(403).send('Forbidden');
     }
     next();
   }

   app.use('/admin', ipWhitelist);
   ```

## Styling

### Dark Theme Colors
- Background: `#1a1a2e`
- Card Background: `#0f3460`
- Secondary Background: `#16213e`
- Primary Accent: `#00d4ff`
- Text: `#e0e0e0`
- Muted Text: `#a0a0a0`

### Bootstrap Classes Used
- `container-fluid` - Responsive container
- `navbar` - Navigation bar
- `card` - Content cards
- `table` - Data tables
- `form-control` - Form inputs
- `btn` - Buttons
- `alert` - Messages

## Customization

### Change Theme Colors

Edit the `<style>` sections in `/packages/backend/src/api/admin-pages.ts`:

```css
body {
  background: #YOUR_BACKGROUND_COLOR;
  color: #YOUR_TEXT_COLOR;
}

.navbar-brand {
  color: #YOUR_ACCENT_COLOR !important;
}
```

### Add New Pages

1. Create renderer in `admin-pages.ts`:
   ```typescript
   export function renderMyCustomPage(): string {
     return `<!DOCTYPE html>...`;
   }
   ```

2. Add route in `admin-routes.ts`:
   ```typescript
   app.get('/admin/custom', requireAuth, (req, res) => {
     res.send(renderMyCustomPage());
   });
   ```

3. Add to navbar:
   ```html
   <li class="nav-item">
     <a class="nav-link" href="/admin/custom">Custom</a>
   </li>
   ```

## TODO for Production

- [ ] Implement actual spend logic in `/admin/deals/:id/spend`
- [ ] Add tank wallet address derivation from private key
- [ ] Query actual balances for tank and operators
- [ ] Add pagination for deals list
- [ ] Add search/filter functionality
- [ ] Add deal stage transition controls
- [ ] Add transaction queue viewer
- [ ] Add real-time updates via WebSocket or SSE
- [ ] Implement user management (multiple admin accounts)
- [ ] Add audit logging for admin actions
- [ ] Add deal creation from admin interface
- [ ] Add manual deal intervention controls

## Troubleshooting

### Cookie Not Set
- Check if `cookie-parser` middleware is loaded before routes
- Verify `res.cookie()` is called before `res.redirect()`

### Session Expires Immediately
- Check system time is correct
- Verify `SESSION_TIMEOUT` value
- Check if cookies are being sent (browser dev tools)

### Balance Not Showing
- Verify chain plugin is initialized
- Check escrow address exists
- Verify RPC endpoint is accessible
- Check console for error messages

### Styling Broken
- Verify Bootstrap CDN is accessible
- Check browser console for CSS errors
- Ensure HTML is valid (no unclosed tags)

## Screenshots

### Login Page
Clean, centered login form with dark gradient background.

### Deals List
Table view with color-coded stage badges, clickable rows.

### Deal Details
Split view: deal info on left, balances and spend form on right.

### Accounts Page
Tank and operator balances organized by chain, with low balance warnings.

## Support

For issues or questions, check:
1. Browser console for JavaScript errors
2. Server logs for backend errors
3. Network tab for failed requests
4. Environment variables are set correctly
