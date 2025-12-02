/**
 * @fileoverview Admin dashboard page renderers for OTC Broker Engine.
 * Provides simple, clean HTML interfaces for administrative functions.
 */

import { Deal, DealStage } from '@otc-broker/core';

/**
 * Renders the admin login page
 */
export function renderAdminLoginPage(errorMessage?: string): string {
  return `
    <!DOCTYPE html>
    <html lang="en">
    <head>
      <meta charset="UTF-8">
      <meta name="viewport" content="width=device-width, initial-scale=1.0">
      <title>Admin Login - OTC Broker</title>
      <link href="https://cdn.jsdelivr.net/npm/bootstrap@5.3.0/dist/css/bootstrap.min.css" rel="stylesheet">
      <style>
        body {
          background: linear-gradient(135deg, #1a1a2e 0%, #16213e 100%);
          min-height: 100vh;
          display: flex;
          align-items: center;
          justify-content: center;
          color: #e0e0e0;
        }
        .login-container {
          background: #0f3460;
          border-radius: 12px;
          padding: 40px;
          box-shadow: 0 10px 40px rgba(0,0,0,0.3);
          max-width: 400px;
          width: 100%;
        }
        .login-header {
          text-align: center;
          margin-bottom: 30px;
        }
        .login-header h1 {
          color: #00d4ff;
          font-size: 28px;
          font-weight: 700;
          margin-bottom: 10px;
        }
        .login-header p {
          color: #a0a0a0;
          font-size: 14px;
        }
        .form-label {
          color: #e0e0e0;
          font-weight: 500;
          margin-bottom: 8px;
        }
        .form-control {
          background: #16213e;
          border: 1px solid #2a4563;
          color: #e0e0e0;
          padding: 12px;
          border-radius: 6px;
        }
        .form-control:focus {
          background: #1a2942;
          border-color: #00d4ff;
          color: #e0e0e0;
          box-shadow: 0 0 0 0.2rem rgba(0, 212, 255, 0.25);
        }
        .btn-primary {
          background: linear-gradient(135deg, #00d4ff 0%, #0099cc 100%);
          border: none;
          padding: 12px;
          font-weight: 600;
          border-radius: 6px;
          width: 100%;
          margin-top: 20px;
        }
        .btn-primary:hover {
          background: linear-gradient(135deg, #00bbee 0%, #0088bb 100%);
        }
        .alert {
          background: #4a1f1f;
          border: 1px solid #6b2c2c;
          color: #ff6b6b;
          border-radius: 6px;
          padding: 12px;
          margin-bottom: 20px;
        }
      </style>
    </head>
    <body>
      <div class="login-container">
        <div class="login-header">
          <h1>🔐 Admin Login</h1>
          <p>OTC Broker Engine Dashboard</p>
        </div>

        ${errorMessage ? `
          <div class="alert" role="alert">
            ${errorMessage}
          </div>
        ` : ''}

        <form method="POST" action="/admin/login">
          <div class="mb-3">
            <label for="email" class="form-label">Email</label>
            <input type="email" class="form-control" id="email" name="email" required autofocus>
          </div>

          <div class="mb-3">
            <label for="password" class="form-label">Password</label>
            <input type="password" class="form-control" id="password" name="password" required>
          </div>

          <button type="submit" class="btn btn-primary">Login</button>
        </form>
      </div>
    </body>
    </html>
  `;
}

/**
 * Renders the deals list page
 */
export function renderDealsListPage(deals: Deal[]): string {
  const getStageColor = (stage: DealStage): string => {
    const colors: Record<DealStage, string> = {
      'CREATED': '#6c757d',
      'COLLECTION': '#ffc107',
      'WAITING': '#0dcaf0',
      'SWAP': '#0d6efd',
      'CLOSED': '#198754',
      'REVERTED': '#dc3545'
    };
    return colors[stage] || '#6c757d';
  };

  const formatDate = (date: string | Date): string => {
    return new Date(date).toLocaleString();
  };

  return `
    <!DOCTYPE html>
    <html lang="en">
    <head>
      <meta charset="UTF-8">
      <meta name="viewport" content="width=device-width, initial-scale=1.0">
      <title>Deals - Admin Dashboard</title>
      <link href="https://cdn.jsdelivr.net/npm/bootstrap@5.3.0/dist/css/bootstrap.min.css" rel="stylesheet">
      <style>
        body {
          background: #1a1a2e;
          color: #e0e0e0;
          min-height: 100vh;
          padding: 20px;
        }
        .navbar {
          background: #0f3460 !important;
          margin-bottom: 30px;
          border-radius: 8px;
        }
        .navbar-brand {
          color: #00d4ff !important;
          font-weight: 700;
        }
        .nav-link {
          color: #a0a0a0 !important;
        }
        .nav-link:hover, .nav-link.active {
          color: #00d4ff !important;
        }
        .container-fluid {
          max-width: 1400px;
        }
        .page-header {
          margin-bottom: 30px;
        }
        .page-header h1 {
          color: #00d4ff;
          font-size: 32px;
          font-weight: 700;
        }
        .table-container {
          background: #0f3460;
          border-radius: 8px;
          padding: 20px;
          overflow-x: auto;
        }
        .table {
          color: #e0e0e0;
          margin-bottom: 0;
        }
        .table thead th {
          border-color: #2a4563;
          color: #00d4ff;
          font-weight: 600;
          border-top: none;
        }
        .table tbody td {
          border-color: #2a4563;
          vertical-align: middle;
        }
        .table tbody tr {
          cursor: pointer;
          transition: background 0.2s;
        }
        .table tbody tr:hover {
          background: rgba(0, 212, 255, 0.1);
        }
        .stage-badge {
          padding: 4px 12px;
          border-radius: 12px;
          font-size: 11px;
          font-weight: 600;
          text-transform: uppercase;
          display: inline-block;
        }
        .deal-id {
          font-family: 'Courier New', monospace;
          color: #00d4ff;
        }
        .asset-info {
          font-size: 13px;
        }
        .asset-chain {
          color: #a0a0a0;
          font-size: 11px;
        }
        .btn-logout {
          background: #dc3545;
          border: none;
          color: white;
        }
        .btn-logout:hover {
          background: #bb2d3b;
          color: white;
        }
      </style>
    </head>
    <body>
      <nav class="navbar navbar-expand-lg">
        <div class="container-fluid">
          <a class="navbar-brand" href="/admin/deals">🔧 OTC Admin</a>
          <div class="collapse navbar-collapse">
            <ul class="navbar-nav me-auto">
              <li class="nav-item">
                <a class="nav-link active" href="/admin/deals">Deals</a>
              </li>
              <li class="nav-item">
                <a class="nav-link" href="/admin/accounts">Accounts</a>
              </li>
            </ul>
            <form action="/admin/logout" method="POST" class="d-flex">
              <button class="btn btn-logout btn-sm" type="submit">Logout</button>
            </form>
          </div>
        </div>
      </nav>

      <div class="container-fluid">
        <div class="page-header">
          <h1>📋 All Deals</h1>
        </div>

        <div class="table-container">
          <table class="table table-hover">
            <thead>
              <tr>
                <th>Deal ID</th>
                <th>Name</th>
                <th>Stage</th>
                <th>Alice (A → B)</th>
                <th>Bob (B → A)</th>
                <th>Created</th>
              </tr>
            </thead>
            <tbody>
              ${deals.length === 0 ? `
                <tr>
                  <td colspan="6" class="text-center text-muted py-4">
                    No deals found
                  </td>
                </tr>
              ` : deals.map(deal => `
                <tr onclick="window.location.href='/admin/deals/${deal.id}'">
                  <td class="deal-id">${deal.id.substring(0, 8)}...</td>
                  <td>${deal.name || 'Unnamed'}</td>
                  <td>
                    <span class="stage-badge" style="background: ${getStageColor(deal.stage)};">
                      ${deal.stage}
                    </span>
                  </td>
                  <td>
                    <div class="asset-info">
                      ${deal.alice.amount} ${deal.alice.asset}
                    </div>
                    <div class="asset-chain">${deal.alice.chainId}</div>
                  </td>
                  <td>
                    <div class="asset-info">
                      ${deal.bob.amount} ${deal.bob.asset}
                    </div>
                    <div class="asset-chain">${deal.bob.chainId}</div>
                  </td>
                  <td>${formatDate(deal.createdAt)}</td>
                </tr>
              `).join('')}
            </tbody>
          </table>
        </div>
      </div>
    </body>
    </html>
  `;
}

/**
 * Renders the deal details page
 */
export function renderDealDetailsPage(deal: Deal, balances: any): string {
  const getStageColor = (stage: DealStage): string => {
    const colors: Record<DealStage, string> = {
      'CREATED': '#6c757d',
      'COLLECTION': '#ffc107',
      'WAITING': '#0dcaf0',
      'SWAP': '#0d6efd',
      'CLOSED': '#198754',
      'REVERTED': '#dc3545'
    };
    return colors[stage] || '#6c757d';
  };

  const formatDate = (date: string | Date): string => {
    return new Date(date).toLocaleString();
  };

  return `
    <!DOCTYPE html>
    <html lang="en">
    <head>
      <meta charset="UTF-8">
      <meta name="viewport" content="width=device-width, initial-scale=1.0">
      <title>Deal ${deal.id.substring(0, 8)} - Admin Dashboard</title>
      <link href="https://cdn.jsdelivr.net/npm/bootstrap@5.3.0/dist/css/bootstrap.min.css" rel="stylesheet">
      <style>
        body {
          background: #1a1a2e;
          color: #e0e0e0;
          min-height: 100vh;
          padding: 20px;
        }
        .navbar {
          background: #0f3460 !important;
          margin-bottom: 30px;
          border-radius: 8px;
        }
        .navbar-brand {
          color: #00d4ff !important;
          font-weight: 700;
        }
        .nav-link {
          color: #a0a0a0 !important;
        }
        .nav-link:hover, .nav-link.active {
          color: #00d4ff !important;
        }
        .container-fluid {
          max-width: 1400px;
        }
        .page-header {
          margin-bottom: 30px;
        }
        .page-header h1 {
          color: #00d4ff;
          font-size: 32px;
          font-weight: 700;
        }
        .card {
          background: #0f3460;
          border: 1px solid #2a4563;
          border-radius: 8px;
          margin-bottom: 20px;
        }
        .card-header {
          background: #16213e;
          border-bottom: 1px solid #2a4563;
          color: #00d4ff;
          font-weight: 600;
          padding: 15px 20px;
        }
        .card-body {
          padding: 20px;
        }
        .info-row {
          display: flex;
          justify-content: space-between;
          padding: 10px 0;
          border-bottom: 1px solid #2a4563;
        }
        .info-row:last-child {
          border-bottom: none;
        }
        .info-label {
          color: #a0a0a0;
          font-weight: 500;
        }
        .info-value {
          color: #e0e0e0;
          font-family: 'Courier New', monospace;
        }
        .stage-badge {
          padding: 6px 14px;
          border-radius: 14px;
          font-size: 12px;
          font-weight: 600;
          text-transform: uppercase;
          display: inline-block;
        }
        .balance-display {
          background: #16213e;
          border: 1px solid #2a4563;
          border-radius: 6px;
          padding: 15px;
          margin: 10px 0;
        }
        .balance-label {
          color: #a0a0a0;
          font-size: 13px;
          margin-bottom: 5px;
        }
        .balance-amount {
          color: #00d4ff;
          font-size: 20px;
          font-weight: 700;
          font-family: 'Courier New', monospace;
        }
        .form-label {
          color: #e0e0e0;
          font-weight: 500;
          margin-bottom: 8px;
        }
        .form-control, .form-select {
          background: #16213e;
          border: 1px solid #2a4563;
          color: #e0e0e0;
          padding: 10px;
          border-radius: 6px;
        }
        .form-control:focus, .form-select:focus {
          background: #1a2942;
          border-color: #00d4ff;
          color: #e0e0e0;
          box-shadow: 0 0 0 0.2rem rgba(0, 212, 255, 0.25);
        }
        .form-control::placeholder {
          color: #6c757d;
        }
        .btn-primary {
          background: linear-gradient(135deg, #00d4ff 0%, #0099cc 100%);
          border: none;
          padding: 10px 20px;
          font-weight: 600;
          border-radius: 6px;
        }
        .btn-primary:hover {
          background: linear-gradient(135deg, #00bbee 0%, #0088bb 100%);
        }
        .btn-secondary {
          background: #6c757d;
          border: none;
          padding: 10px 20px;
          font-weight: 600;
          border-radius: 6px;
        }
        .btn-secondary:hover {
          background: #5c636a;
        }
        .btn-logout {
          background: #dc3545;
          border: none;
          color: white;
        }
        .btn-logout:hover {
          background: #bb2d3b;
          color: white;
        }
        .alert {
          border-radius: 6px;
          padding: 12px 16px;
        }
        .alert-success {
          background: #1f4a2f;
          border: 1px solid #2d6a3f;
          color: #75fb8a;
        }
        .alert-danger {
          background: #4a1f1f;
          border: 1px solid #6b2c2c;
          color: #ff6b6b;
        }
        code {
          background: #16213e;
          color: #00d4ff;
          padding: 2px 6px;
          border-radius: 3px;
          font-size: 13px;
        }
      </style>
    </head>
    <body>
      <nav class="navbar navbar-expand-lg">
        <div class="container-fluid">
          <a class="navbar-brand" href="/admin/deals">🔧 OTC Admin</a>
          <div class="collapse navbar-collapse">
            <ul class="navbar-nav me-auto">
              <li class="nav-item">
                <a class="nav-link active" href="/admin/deals">Deals</a>
              </li>
              <li class="nav-item">
                <a class="nav-link" href="/admin/accounts">Accounts</a>
              </li>
            </ul>
            <form action="/admin/logout" method="POST" class="d-flex">
              <button class="btn btn-logout btn-sm" type="submit">Logout</button>
            </form>
          </div>
        </div>
      </nav>

      <div class="container-fluid">
        <div class="page-header d-flex justify-content-between align-items-center">
          <div>
            <h1>📄 Deal Details</h1>
            <p style="color: #a0a0a0; margin: 0;">ID: <code>${deal.id}</code></p>
          </div>
          <a href="/admin/deals" class="btn btn-secondary">← Back to List</a>
        </div>

        <div class="row">
          <div class="col-lg-6">
            <div class="card">
              <div class="card-header">Deal Information</div>
              <div class="card-body">
                <div class="info-row">
                  <span class="info-label">Name:</span>
                  <span class="info-value">${deal.name || 'Unnamed'}</span>
                </div>
                <div class="info-row">
                  <span class="info-label">Stage:</span>
                  <span class="stage-badge" style="background: ${getStageColor(deal.stage)};">
                    ${deal.stage}
                  </span>
                </div>
                <div class="info-row">
                  <span class="info-label">Created:</span>
                  <span class="info-value">${formatDate(deal.createdAt)}</span>
                </div>
                ${deal.expiresAt ? `
                  <div class="info-row">
                    <span class="info-label">Expires:</span>
                    <span class="info-value">${formatDate(deal.expiresAt)}</span>
                  </div>
                ` : ''}
                <div class="info-row">
                  <span class="info-label">Timeout:</span>
                  <span class="info-value">${deal.timeoutSeconds}s</span>
                </div>
              </div>
            </div>

            <div class="card">
              <div class="card-header">🅰️ Alice Details</div>
              <div class="card-body">
                <div class="info-row">
                  <span class="info-label">Chain:</span>
                  <span class="info-value">${deal.alice.chainId}</span>
                </div>
                <div class="info-row">
                  <span class="info-label">Asset:</span>
                  <span class="info-value">${deal.alice.asset}</span>
                </div>
                <div class="info-row">
                  <span class="info-label">Amount:</span>
                  <span class="info-value">${deal.alice.amount}</span>
                </div>
                ${deal.aliceDetails?.paybackAddress ? `
                  <div class="info-row">
                    <span class="info-label">Payback Address:</span>
                    <span class="info-value" style="font-size: 11px;">${deal.aliceDetails.paybackAddress}</span>
                  </div>
                  <div class="info-row">
                    <span class="info-label">Recipient Address:</span>
                    <span class="info-value" style="font-size: 11px;">${deal.aliceDetails.recipientAddress}</span>
                  </div>
                ` : ''}
              </div>
            </div>

            <div class="card">
              <div class="card-header">🅱️ Bob Details</div>
              <div class="card-body">
                <div class="info-row">
                  <span class="info-label">Chain:</span>
                  <span class="info-value">${deal.bob.chainId}</span>
                </div>
                <div class="info-row">
                  <span class="info-label">Asset:</span>
                  <span class="info-value">${deal.bob.asset}</span>
                </div>
                <div class="info-row">
                  <span class="info-label">Amount:</span>
                  <span class="info-value">${deal.bob.amount}</span>
                </div>
                ${deal.bobDetails?.paybackAddress ? `
                  <div class="info-row">
                    <span class="info-label">Payback Address:</span>
                    <span class="info-value" style="font-size: 11px;">${deal.bobDetails.paybackAddress}</span>
                  </div>
                  <div class="info-row">
                    <span class="info-label">Recipient Address:</span>
                    <span class="info-value" style="font-size: 11px;">${deal.bobDetails.recipientAddress}</span>
                  </div>
                ` : ''}
              </div>
            </div>
          </div>

          <div class="col-lg-6">
            <div class="card">
              <div class="card-header">💰 Escrow Balances</div>
              <div class="card-body">
                <h6 style="color: #00d4ff; margin-bottom: 15px;">Alice Escrow</h6>
                <div class="balance-display">
                  <div class="balance-label">Address: <code style="font-size: 11px;">${deal.escrowA?.address || 'Not generated'}</code></div>
                  ${balances.alice ? `
                    ${balances.alice.error ? `
                      <div class="balance-label" style="color: #ff6b6b;">${balances.alice.error}</div>
                    ` : `
                      <div class="balance-amount">${balances.alice.totalConfirmed || '0'} ${deal.alice.asset}</div>
                      <div class="balance-label" style="margin-top: 5px;">Deposits: ${balances.alice.deposits?.length || 0}</div>
                    `}
                  ` : '<div class="balance-label" style="color: #6c757d;">Balance not available</div>'}
                </div>

                <h6 style="color: #00d4ff; margin: 20px 0 15px 0;">Bob Escrow</h6>
                <div class="balance-display">
                  <div class="balance-label">Address: <code style="font-size: 11px;">${deal.escrowB?.address || 'Not generated'}</code></div>
                  ${balances.bob ? `
                    ${balances.bob.error ? `
                      <div class="balance-label" style="color: #ff6b6b;">${balances.bob.error}</div>
                    ` : `
                      <div class="balance-amount">${balances.bob.totalConfirmed || '0'} ${deal.bob.asset}</div>
                      <div class="balance-label" style="margin-top: 5px;">Deposits: ${balances.bob.deposits?.length || 0}</div>
                    `}
                  ` : '<div class="balance-label" style="color: #6c757d;">Balance not available</div>'}
                </div>
              </div>
            </div>

            <div class="card">
              <div class="card-header">⚡ Manual Spend from Escrow</div>
              <div class="card-body">
                <p style="color: #ffc107; font-size: 13px; margin-bottom: 15px;">
                  ⚠️ Warning: This will manually spend funds from an escrow address. Use with caution.
                </p>

                <form method="POST" action="/admin/deals/${deal.id}/spend">
                  <div class="mb-3">
                    <label class="form-label">Chain ID</label>
                    <select class="form-select" name="chainId" required>
                      <option value="">Select chain...</option>
                      <option value="${deal.alice.chainId}">Alice Chain (${deal.alice.chainId})</option>
                      <option value="${deal.bob.chainId}">Bob Chain (${deal.bob.chainId})</option>
                    </select>
                  </div>

                  <div class="mb-3">
                    <label class="form-label">Escrow Address</label>
                    <select class="form-select" name="escrowAddress" required>
                      <option value="">Select escrow...</option>
                      ${deal.escrowA?.address ? `<option value="${deal.escrowA.address}">Alice Escrow (${deal.escrowA.address.substring(0, 10)}...)</option>` : ''}
                      ${deal.escrowB?.address ? `<option value="${deal.escrowB.address}">Bob Escrow (${deal.escrowB.address.substring(0, 10)}...)</option>` : ''}
                    </select>
                  </div>

                  <div class="mb-3">
                    <label class="form-label">To Address</label>
                    <input type="text" class="form-control" name="toAddress" placeholder="Destination address" required>
                  </div>

                  <div class="mb-3">
                    <label class="form-label">Asset</label>
                    <input type="text" class="form-control" name="asset" placeholder="e.g., NATIVE, ERC20:0x..." required>
                  </div>

                  <div class="mb-3">
                    <label class="form-label">Amount</label>
                    <input type="text" class="form-control" name="amount" placeholder="0.00" required>
                  </div>

                  <div class="mb-3">
                    <label class="form-label">Reason</label>
                    <input type="text" class="form-control" name="reason" placeholder="Manual intervention reason" required>
                  </div>

                  <button type="submit" class="btn btn-primary w-100">Execute Spend</button>
                </form>
              </div>
            </div>
          </div>
        </div>

        <!-- Event Log Section -->
        <div class="row mt-4">
          <div class="col-12">
            <div class="card">
              <div class="card-header">📜 Event Log</div>
              <div class="card-body">
                ${deal.events && deal.events.length > 0 ? `
                  <div style="max-height: 600px; overflow-y: auto;">
                    <table class="table table-sm" style="color: #e0e0e0; margin-bottom: 0;">
                      <thead style="position: sticky; top: 0; background: #0f3460; z-index: 1;">
                        <tr>
                          <th style="width: 200px; color: #00d4ff; border-color: #2a4563;">Timestamp</th>
                          <th style="color: #00d4ff; border-color: #2a4563;">Event</th>
                        </tr>
                      </thead>
                      <tbody>
                        ${deal.events.map((event: any) => `
                          <tr>
                            <td style="border-color: #2a4563; font-family: 'Courier New', monospace; font-size: 12px; color: #a0a0a0;">
                              ${formatDate(event.firstSeen || event.t)}
                            </td>
                            <td style="border-color: #2a4563; font-size: 13px;">
                              ${event.msg}
                              ${event.occurrences && event.occurrences > 1 ? `
                                <div style="margin-top: 6px;">
                                  <span style="display: inline-block; padding: 2px 8px; background: #ff6b6b; color: #fff; border-radius: 12px; font-size: 11px; font-weight: bold;">
                                    ${event.occurrences}× occurrences
                                  </span>
                                  <span style="margin-left: 10px; font-size: 11px; color: #a0a0a0;">
                                    Last: ${formatDate(event.lastSeen)}
                                  </span>
                                </div>
                              ` : ''}
                            </td>
                          </tr>
                        `).join('')}
                      </tbody>
                    </table>
                  </div>
                  <div style="margin-top: 15px; padding: 10px; background: #16213e; border-radius: 6px; font-size: 12px; color: #a0a0a0;">
                    <strong style="color: #00d4ff;">Total Events:</strong> ${deal.events.length}
                  </div>
                ` : `
                  <p style="color: #6c757d; text-align: center; margin: 20px 0;">
                    No events recorded for this deal yet.
                  </p>
                `}
              </div>
            </div>
          </div>
        </div>
      </div>
    </body>
    </html>
  `;
}

/**
 * Renders the accounts balance page
 */
export function renderAccountsPage(accountBalances: any): string {
  const formatBalance = (balance: number | string): string => {
    const num = typeof balance === 'string' ? parseFloat(balance) : balance;
    return num.toFixed(6);
  };

  const isLowBalance = (balance: number | string, threshold: number): boolean => {
    const num = typeof balance === 'string' ? parseFloat(balance) : balance;
    return num < threshold;
  };

  return `
    <!DOCTYPE html>
    <html lang="en">
    <head>
      <meta charset="UTF-8">
      <meta name="viewport" content="width=device-width, initial-scale=1.0">
      <title>Accounts - Admin Dashboard</title>
      <link href="https://cdn.jsdelivr.net/npm/bootstrap@5.3.0/dist/css/bootstrap.min.css" rel="stylesheet">
      <style>
        body {
          background: #1a1a2e;
          color: #e0e0e0;
          min-height: 100vh;
          padding: 20px;
        }
        .navbar {
          background: #0f3460 !important;
          margin-bottom: 30px;
          border-radius: 8px;
        }
        .navbar-brand {
          color: #00d4ff !important;
          font-weight: 700;
        }
        .nav-link {
          color: #a0a0a0 !important;
        }
        .nav-link:hover, .nav-link.active {
          color: #00d4ff !important;
        }
        .container-fluid {
          max-width: 1400px;
        }
        .page-header {
          margin-bottom: 30px;
        }
        .page-header h1 {
          color: #00d4ff;
          font-size: 32px;
          font-weight: 700;
        }
        .card {
          background: #0f3460;
          border: 1px solid #2a4563;
          border-radius: 8px;
          margin-bottom: 20px;
        }
        .card-header {
          background: #16213e;
          border-bottom: 1px solid #2a4563;
          color: #00d4ff;
          font-weight: 600;
          padding: 15px 20px;
        }
        .card-body {
          padding: 20px;
        }
        .account-section {
          margin-bottom: 30px;
        }
        .chain-balance {
          background: #16213e;
          border: 1px solid #2a4563;
          border-radius: 6px;
          padding: 15px;
          margin-bottom: 15px;
        }
        .chain-balance.low-balance {
          border-color: #dc3545;
          background: rgba(220, 53, 69, 0.1);
        }
        .chain-name {
          color: #00d4ff;
          font-weight: 600;
          font-size: 16px;
          margin-bottom: 10px;
        }
        .balance-row {
          display: flex;
          justify-content: space-between;
          padding: 8px 0;
          border-bottom: 1px solid #2a4563;
        }
        .balance-row:last-child {
          border-bottom: none;
        }
        .balance-label {
          color: #a0a0a0;
          font-size: 14px;
        }
        .balance-value {
          color: #e0e0e0;
          font-family: 'Courier New', monospace;
          font-size: 14px;
          font-weight: 600;
        }
        .balance-value.low {
          color: #ff6b6b;
        }
        .address-display {
          color: #6c757d;
          font-family: 'Courier New', monospace;
          font-size: 12px;
          margin-top: 5px;
        }
        .btn-logout {
          background: #dc3545;
          border: none;
          color: white;
        }
        .btn-logout:hover {
          background: #bb2d3b;
          color: white;
        }
        .warning-badge {
          background: #dc3545;
          color: white;
          padding: 2px 8px;
          border-radius: 10px;
          font-size: 11px;
          font-weight: 600;
          margin-left: 10px;
        }
      </style>
    </head>
    <body>
      <nav class="navbar navbar-expand-lg">
        <div class="container-fluid">
          <a class="navbar-brand" href="/admin/deals">🔧 OTC Admin</a>
          <div class="collapse navbar-collapse">
            <ul class="navbar-nav me-auto">
              <li class="nav-item">
                <a class="nav-link" href="/admin/deals">Deals</a>
              </li>
              <li class="nav-item">
                <a class="nav-link active" href="/admin/accounts">Accounts</a>
              </li>
            </ul>
            <form action="/admin/logout" method="POST" class="d-flex">
              <button class="btn btn-logout btn-sm" type="submit">Logout</button>
            </form>
          </div>
        </div>
      </nav>

      <div class="container-fluid">
        <div class="page-header">
          <h1>💼 Account Balances</h1>
        </div>

        <div class="row">
          <div class="col-lg-6">
            <div class="account-section">
              <div class="card">
                <div class="card-header">🏦 Tank Wallet (Gas Funding)</div>
                <div class="card-body">
                  ${accountBalances.tank ? `
                    <div class="address-display">Address: ${accountBalances.tank.address || 'Not configured'}</div>
                    <div style="margin-top: 20px;">
                      ${accountBalances.tank.chains ? Object.entries(accountBalances.tank.chains).map(([chainId, data]: [string, any]) => {
                        const isLow = data.native && data.lowThreshold && isLowBalance(data.native, data.lowThreshold);
                        return `
                          <div class="chain-balance ${isLow ? 'low-balance' : ''}">
                            <div class="chain-name">
                              ${chainId}
                              ${isLow ? '<span class="warning-badge">LOW</span>' : ''}
                            </div>
                            <div class="balance-row">
                              <span class="balance-label">Native Balance:</span>
                              <span class="balance-value ${isLow ? 'low' : ''}">
                                ${data.native !== undefined ? formatBalance(data.native) : 'N/A'}
                              </span>
                            </div>
                            ${data.lowThreshold ? `
                              <div class="balance-row">
                                <span class="balance-label">Low Threshold:</span>
                                <span class="balance-value">${formatBalance(data.lowThreshold)}</span>
                              </div>
                            ` : ''}
                          </div>
                        `;
                      }).join('') : '<p class="text-muted">No tank balances available</p>'}
                    </div>
                  ` : '<p class="text-muted">Tank wallet not configured</p>'}
                </div>
              </div>
            </div>
          </div>

          <div class="col-lg-6">
            <div class="account-section">
              <div class="card">
                <div class="card-header">⚙️ Operator Addresses</div>
                <div class="card-body">
                  ${accountBalances.operators ? Object.entries(accountBalances.operators).map(([chainId, data]: [string, any]) => `
                    <div class="chain-balance">
                      <div class="chain-name">${chainId}</div>
                      <div class="address-display">${data.address || 'Not configured'}</div>
                      ${data.native !== undefined ? `
                        <div class="balance-row">
                          <span class="balance-label">Native Balance:</span>
                          <span class="balance-value">${formatBalance(data.native)}</span>
                        </div>
                      ` : ''}
                      ${data.erc20 ? Object.entries(data.erc20).map(([token, balance]: [string, any]) => `
                        <div class="balance-row">
                          <span class="balance-label">${token}:</span>
                          <span class="balance-value">${formatBalance(balance)}</span>
                        </div>
                      `).join('') : ''}
                    </div>
                  `).join('') : '<p class="text-muted">No operator balances available</p>'}
                </div>
              </div>
            </div>
          </div>
        </div>
      </div>
    </body>
    </html>
  `;
}
