# Umucyo Bar Settings Implementation Report

## Summary

The Settings dashboard is available from the authenticated application at `/settings` and from the top-bar Settings link. Settings are persisted in MySQL and are applied to the product, floor, receipt, inventory, and user-management flows described below.

## Implemented features

### Business information

- Stores the business name, address, phone, email, TIN, currency, logo URL, time zone, and receipt footer.
- Validates the business name, ISO-style three-letter currency code, email, time zone, and HTTP(S) logo URL.
- Requires a reason for changes and writes before/after values to the audit log.
- Restricts editing to administrators.

### Product units and conversion history

- Administrators can configure product-specific purchase and sale units, conversion factors, unit prices, active status, and default units.
- Conversion factors are validated; countable units require whole-number conversions.
- Changes require a reason and confirmation, are recorded in `product_unit_history`, and are audited. Historical sales and purchases are not rewritten.
- Structural unit/conversion changes through the general product-update endpoint are rejected; the Settings unit editor is the authorized path.

### Floor and seating

- Supports creating and editing bar areas and dining tables, activating/deactivating them, and setting their display order.
- Floor listings use the configured area/table order.
- Settings floor forms request a reason, and floor changes include supplied reasons in the audit log.
- Database fields and APIs support optional table display coordinates.

### Receipt and POS

- Saves 80 mm or A4 paper format, cashier/table visibility, payment details visibility, open-table balance visibility, and a custom footer.
- Sales invoices use the configured business name, logo URL, contact details, TIN, currency, time zone, footer, and paper format.
- The Floor page can print a table bill using the same business and receipt settings. Its table identifier and open balance follow the corresponding visibility options.
- Receipt options are read through the authenticated `GET /api/settings/receipt` endpoint.

### Inventory configuration

- Applies the configured default low-stock threshold to new products when their threshold is left at zero.
- Uses the global threshold as the fallback for existing products without an individual threshold in stock listings and dashboard low-stock counts.
- Applies expiry-tracking and batch requirements as defaults for new products; explicit product values take precedence.
- When manager approval is enabled, stock keepers cannot directly change quantities or submit adjustments; an administrator or manager must perform the adjustment. Existing negative-stock protections remain in place.

### Users, permissions, and audit history

- Administrators can create users, change roles/status, and reset passwords. Passwords are hashed and require at least 12 characters.
- Prevents administrators from removing their own admin access or deactivating/demoting the last active administrator.
- Provides administrators with audit and product-unit conversion history views.
- Business, configuration, floor, product-unit, and user changes are recorded in the audit log.

## Backend and database

- Settings APIs are registered under `/api/settings`.
- Added `system_settings` and `product_unit_history` tables, business time-zone/footer fields, and floor ordering/coordinate fields.
- The pending Settings schema migration was applied to the configured MySQL database. The database reports all migrations up to date.
- The pending customer-debt migration directory had no schema changes; it now contains an explicit no-op migration so Prisma can apply the migration sequence consistently.

## Validation performed

- Frontend production build: passed.
- Focused frontend lint: passed with existing React hook warnings in the Settings and Products pages.
- Backend tests: 4 passed.
- Prisma schema validation: passed.
- Backend JavaScript syntax checks: passed.
- Prisma Client generation: passed.
- Database migration deployment and post-deployment status check: passed.
- Queried the database to confirm the Settings tables and columns were created.

## Limitations

- Logo support is URL-based; there is no logo upload or file-storage workflow.
- Manager approval is enforced as a permission gate, not a pending-adjustment approval queue. A manager must perform the adjustment directly.
- The floor UI supports ordered tables but does not yet provide a drag-and-drop editor for the optional display coordinates.
- Configured currency is used on printed POS invoices and table bills; other application screens still format amounts as RWF.
- Settings role and authorization flows were validated through schema/build checks and existing tests, but no authenticated browser end-to-end test was run.
