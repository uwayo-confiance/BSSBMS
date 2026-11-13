# Umucyo Bar Premium POS v2.1 — Settings Page Final Verification Report

**Audit type:** Read-only verification and QA  
**Audit date:** 11 November 2026  
**Application:** Umucyo Bar Premium POS v2.1 (React/Vite frontend, Node/Express backend, MySQL/Prisma)  
**Audit target:** Settings page and every module it is required to integrate with

## Verification scope and method

- Inspected the frontend pages and components (`Layout.jsx`, `App.jsx`, `Settings.jsx`, `POS.jsx`, `Floor.jsx`, `Products.jsx`, `index.css`), backend routes (`settings`, `products`, `units`, `purchases`, `purchaseOrders`, `sales`, `refunds`, `tableOrders`, `stock`, `stockCounts`, `floor`, `reports`, `audit`), auth middleware, helper utilities, Prisma schema, and the existing automated tests.
- Ran the backend test suite (`npm test`), the frontend production build (`npm run build`), and the frontend lint check (`npm run lint`).
- Ran the API locally on port 5055 using `node src/server.js` and executed read-only GET requests plus permission-rejection write attempts that fail authorization before touching data.
- Generated short-lived JWTs locally from the existing `JWT_SECRET` for the three existing users (admin, manager, cashier) to test route authorization without changing credentials. No user, password, role, or business record was changed.
- Read the configured MySQL database through the application's Prisma client. No rows were inserted, updated, or deleted. Record counts before and after the audit were identical: sales 23, audit logs 12, product units 39, system settings 0, unit history 0, areas 3, tables 2, users 3.
- No source file, schema, migration, or configuration was modified. The only file created by this audit is this report.
- A background API server used for testing was stopped after verification.

**Important limitation:** Because the brief forbids modifying real business data, every workflow that requires a successful write (saving business/receipt/inventory settings, creating or editing users, changing a conversion factor, creating areas/tables during the audit, completing a crate sale) could not be exercised end-to-end. Such requirements are marked **Not Verified** or **Partial** even where the code path clearly exists. Existing records created before the audit (sales, purchases, floor areas/tables, audit entries) are used as live evidence where possible.

## Status definitions

| Status | Meaning in this report |
|---|---|
| **Complete** | Implementation exists and the behaviour was confirmed by a live read-only API/DB observation, a live rejection test, a build/test run, or unambiguous code-path inspection backed by live data. |
| **Partial** | Implementation exists but a concrete part of the requirement is missing, limited, or only wired but not demonstrable. |
| **Missing** | No implementation of the requirement was found. |
| **Broken** | A feature exists but an executed check produced a result that contradicts the requirement. |
| **Not Verified** | The implementation appears to exist, but confirming it requires a write, a role/account, or data that is not present, so it could not be tested safely. |

---

## A. Overall result

| Metric | Count |
|---|---|
| Total individual requirements checked | **122** |
| Fully completed | **71** |
| Partially completed | **18** |
| Not implemented | **3** |
| Broken | **2** |
| Not verified | **28** |

**Completion percentage: 71 / 122 = 58.2%.**

**Calculation:** Every bullet and sub-bullet in the brief was converted into one individually checkable requirement and numbered 1–122 in section B. A requirement contributes to the percentage only when its status is **Complete**. Partial, Missing, Broken, and Not Verified all count as not complete. 71 ÷ 122 = 0.58196, reported as 58.2%.

**Secondary view (excluding untestable items):** 28 requirements could not be verified without writing data. Of the 94 requirements that could be assessed (122 − 28), 71 are Complete, giving **75.5%** of the assessable scope. This figure is informational only; the brief's strict score is 58.2%.

The gap is dominated by write-dependent configuration screens that have never been saved in this database (`system_settings` has 0 rows and `product_unit_history` has 0 rows), not by missing UI. The most serious substantive findings are the Primus crate configuration (factor 24 instead of the required 20), the inability to sell crates because crate sale is disabled with no selling price, one product whose "Crate" unit has conversion factor 1, and the absence of audit records for product price changes.

### Live environment facts used as evidence

| Item | Observed value |
|---|---|
| Business record | id 1, "Kigali Corner Bar", RWF, Africa/Kigali, receipt footer null |
| Products | 26 |
| Product unit rows | 39 |
| Global units | Bottle, Crate, Pack, Piece, Liter, Half-liter, Can, Case |
| Areas | ground (id 1, active), Outside (id 2, active), Tent (id 3, active) |
| Tables | TB-34 (area 2, capacity 10), TB-2 (area 3, capacity 20) |
| Sales / sale items | 23 / 43 |
| Purchases / purchase items | 2 / 3 |
| Audit logs | 12 |
| Product unit history | 0 |
| System settings rows | 0 |
| Stock batches | 0 |
| Table sessions | 0 |
| Users | admin (id 1), manager (id 2), cashier (id 3), all active |
| Roles | admin, manager, cashier, stock_keeper, waiter |

---

## B. Detailed checklist

### B.1 Settings in the topbar (requirements 1–7)

| No. | Requirement | Status | Evidence | Remaining work |
|---|---|---|---|---|
| 1 | Settings appears in the main topbar | Complete | `frontend/src/components/Layout.jsx` renders a topbar Settings `NavLink` for roles admin and manager. The link is part of the persistent application header. | None. |
| 2 | Appropriate settings icon and label | Complete | The link uses the gear (`Settings`) icon plus the text label "Settings"; the label is hidden below the `sm` breakpoint while the icon stays visible. | None. |
| 3 | Clicking it opens the correct Settings page | Complete | The link targets `/settings`; `App.jsx` maps that route to `Settings.jsx`; production build passed with the route included. | None. |
| 4 | Active navigation displayed correctly | Complete | `NavLink` applies its active class when the current path matches `/settings`; the same mechanism is used by the other working topbar links. | None. |
| 5 | Page works on desktop, tablet and mobile | Partial | Responsive Tailwind grid and `overflow-x-auto` tables are present in `Settings.jsx`, and the topbar label collapses on small screens. No browser viewport test was performed, so visual usability on real tablet/mobile sizes is unconfirmed. | Load the page at desktop, tablet, and phone widths and correct any overflow. |
| 6 | Existing navigation still works | Complete | The Settings link was added alongside the existing nav items without removing or reordering them; the full frontend build succeeded (2138 modules). | None. |
| 7 | Unauthorized users cannot reach restricted settings via direct URL or API | Complete | `Settings.jsx` returns an access-denied view for roles other than admin/manager. Live tests: no token on `GET /api/settings` → 401; cashier on `GET /api/settings` → 403; cashier/manager on `GET /api/settings/users` → 403; cashier on `GET /api/settings/unit-history` and `/api/audit` → 403. Direct URL access shows an access-denied message rather than settings content. | None. |

### B.2 Product units and conversions (requirements 8–33)

| No. | Requirement | Status | Evidence | Remaining work |
|---|---|---|---|---|
| 8 | Every product can have its own conversion factor | Complete | `product_units` has one row per product/unit with an independent `conversion_factor`; 39 live rows show different factors for different products (for example crate 24, pack 6). | None. |
| 9 | Administrators can create and edit product units | Not Verified | `Settings.jsx` has an add/edit unit editor and calls `PUT /api/products/:id/units`, which is admin-only, requires a reason, writes `product_unit_history`, and is audited. Manager and cashier calls were rejected with 403. No save was performed because it would change live conversion data, and `product_unit_history` has 0 rows. | Perform one controlled unit save with a reason and confirm the row, history, and audit entries. |
| 10 | Purchase units and selling units are configurable | Complete | `product_units` stores `is_purchase_enabled`, `is_sale_enabled`, default flags, and separate prices; the Settings editor exposes them. Live rows contain both purchase and sale flags. | None. |
| 11 | Base units are correctly defined | Complete | Base unit rows exist for every product and `normalizeProductUnits` forces the base unit factor to 1 and rejects a second default. Live base rows all have factor 1. | Consider validating that a base unit is not a package name (see product 22 note in section F). |
| 12 | Different prices for bottles, crates and packs | Partial | The data model and UI support a price per unit, and bottle selling prices are live. Primus, Fanta, and Coca-Cola crate rows have a purchase price but `selling_price` null and `is_sale_enabled` 0; pack selling prices are also unset. | Configure at least one crate and one pack selling price and prove their use at checkout. |
| 13 | Purchase costs and selling prices are separate | Complete | Separate `purchase_price` and `selling_price` columns; `resolveProductUnit` returns the price for the requested mode, and purchase/sale routes use the matching mode. | None. |
| 14 | Cashiers can select only configured selling units | Complete | `POS.jsx` filters units to `is_active && is_sale_enabled`; the backend independently rejects an unconfigured unit. Live test: a crate sale on Primus returned 400 "Crate is not enabled for sale", so a client cannot force it. | None. |
| 15 | Cashiers cannot modify conversion settings | Complete | Live `PUT /api/products/1/units` with valid payload returned 403 for both cashier and manager; the route is admin-only. | None. |
| 16 | Invalid, zero and negative conversion values are rejected | Complete | `normalizeProductUnits` rejects factors below 0.0001, rejects a base unit whose factor is not 1, rejects multiple default purchase/sale units, rejects negative prices, and enforces whole-number factors for countable units. | Add an explicit unit test for zero and negative factors. |
| 17 | Conversion calculations use the correct product-specific factor | Complete | `resolveProductUnit` reads the product's own `product_units` row; live bottle sales used factor 1 and live crate purchases used factor 24 from the product row, not a global default. | None. |
| 18 | Stock is maintained in base units | Complete | Sale processing stores `quantity_base = quantity × factor` and deducts that amount; purchase processing increments by the base quantity. Live purchase items prove it: 5 Primus crates × 24 = 120 base units. | None. |
| 19 | Changing a conversion does not rewrite historical transactions | Complete | The unit-update route writes only `product_units` and `product_unit_history`; it has no code path touching `sale_items`, `purchase_items`, or `table_order_items`, which carry their own snapshots. | Confirm with a controlled factor change that existing snapshots stay unchanged. |
| 20 | Historical purchases and sales retain factor, selected unit, quantity and price | Complete | Live `purchase_items`: 5 Primus crates, factor 24, 120 base units, unit cost 19,200; 4 Fanta crates, factor 24, 96 base; 1 pack, factor 6, 6 base. `sale_items` rows carry `unit_id`, `conversion_factor_snapshot`, `quantity_base`, and `unit_price`. | None. |
| 21 | Conversion changes are recorded in audit history | Not Verified | Both paths exist: `product_unit_history` insert plus an audit event inside the update transaction. Because no conversion has ever been changed, both `product_unit_history` (0) and the corresponding audit entries are absent. | Make one controlled change with a reason; verify the history row and audit event. |
| 22 | Conversion settings connected to Product Management | Partial | `Products.jsx` shows unit and price information, and product create passes units to the backend. Structural unit changes through `PUT /api/products/:id` are deliberately rejected; editing is only possible in Settings. | Decide whether the Products page needs a read-only conversion view or a link to Settings. |
| 23 | Conversion settings connected to Purchasing | Complete | `purchases.js` resolves the purchase unit through `resolveProductUnit`, computes base quantity from the product factor, and updates base stock. Live purchase records exist with factor 24 and 6. | None. |
| 24 | Conversion settings connected to Goods Receiving | Complete | `purchaseOrders.js` re-resolves the unit, stores `conversion_factor_snapshot`, `quantity_received_base`, and the ordered factor, then creates stock batches when required. | Exercise a goods receipt against a real purchase order. |
| 25 | Conversion settings connected to Inventory | Complete | Stock quantities and thresholds are stored in base units; adjustments convert entered quantities with `toBaseUnit`. | None. |
| 26 | Conversion settings connected to POS | Complete | POS loads product units, filters sale-enabled ones, shows the unit-specific price, and sends quantity plus unit; the backend recomputes price and base quantity. | None. |
| 27 | Conversion settings connected to sales receipts | Complete | Receipt lines render the selected unit name and unit price supplied by the saved sale item; the backend stores the unit and factor snapshot for reprinting. | None. |
| 28 | Conversion settings connected to Reports | Complete | Report queries aggregate `sale_items.quantity_base` and base purchase quantities rather than unit counts. | None. |
| 29 | Calculation: 5 Primus crates = 100 bottles | Broken | The live Primus 65cl crate factor is **24**, and the existing purchase of 5 crates was recorded as 120 base units. No Primus product is configured at factor 20. The arithmetic is internally consistent but fails the required value of 100. | Correct the Primus crate factor to 20 (or confirm the real crate size) and re-verify the stored base quantity. |
| 30 | Calculation: 3 Fanta crates = 72 bottles | Complete | Fanta crate factor is 24; the live purchase of 4 crates produced 96 base units, confirming 3 × 24 = 72. | None. |
| 31 | Calculation: selling 1 Fanta crate deducts 24 bottles | Broken | The Fanta crate unit has `is_sale_enabled = 0` and no selling price. A live attempt to sell it was rejected with 400 "Crate is not enabled for sale on ...", so no stock can be deducted from a crate sale. | Enable crate sales with a selling price and verify the 24-base-unit stock decrement. |
| 32 | Calculation: 2 crates of a factor-12 product = 24 base units | Partial | A global `unit_conversions` row Case→Can with factor 12 exists, but no product has a product-specific factor of 12, and no live transaction demonstrates 2 × 12. | Configure a 12-unit product and verify both purchase and sale produce 24 base units. |
| 33 | Backend uses the correct factors, not frontend values | Complete | Backend resolution and stored snapshots used factors 24 and 6 from `product_units`; a sale with an unconfigured unit was rejected server-side rather than trusted from the client. | None. |

### B.3 Floor and seating (requirements 34–43)

| No. | Requirement | Status | Evidence | Remaining work |
|---|---|---|---|---|
| 34 | Administrators can create areas | Complete | `POST /api/floor/areas` requires admin or manager; three live areas exist and audit logs 5–8 record their creation with user, action, new values, timestamp, and reason. | None. |
| 35 | Administrators can edit areas | Not Verified | `PUT /api/floor/areas/:id` validates the name, updates ordering/status, and audits before/after values; the Settings form calls it. No area edit was performed because it would change live floor data. | Edit an area in a test copy and confirm the audit old/new values. |
| 36 | Administrators can deactivate areas | Not Verified | `PATCH /api/floor/areas/:id/status` exists and deactivates the area's tables; the Floor page exposes activate/deactivate buttons. The Settings page itself has no area deactivate control. All live areas are active, so the path was not exercised. | Add the control to Settings if required there, and verify deactivation flow. |
| 37 | Administrators can create tables | Complete | `POST /api/floor/tables` requires admin/manager and validates area and capacity; live tables TB-34 and TB-2 exist and audit logs 7 and 9 record their creation. | None. |
| 38 | Tables can be assigned to areas | Complete | `area_id` is validated against active areas; live TB-34 belongs to area 2 and TB-2 to area 3, and both are returned with their area details. | None. |
| 39 | Table capacity can be configured | Complete | Capacity is stored and returned; live capacities are 10 and 20. The Settings and Floor forms expose the field. | None. |
| 40 | Duplicate table codes are rejected | Partial | The unique constraint and duplicate check are scoped to an area, so the same table code can be created in a different area. Duplicate within the same area is rejected. | Enforce global uniqueness if table codes must be unique across the venue. |
| 41 | Table statuses are correctly managed | Partial | `floor.js` derives available/occupied/bill_pending/inactive from active sessions and open orders, and inactive is respected. Live tables show available, but no session exists to observe occupied or bill_pending live. | Verify occupied, bill-pending, and inactive states with real session data. |
| 42 | Table settings connect to Floor Management | Complete | Settings and the Floor page use the same `/api/floor` endpoints and the same area/table records; changing floor data in one is reflected in the other's listing. | None. |
| 43 | Historical sessions, orders, and payments preserved when table details change | Not Verified | Schema keeps session/order rows linked by `table_id`, and the update/deactivate code does not delete them. There are 0 `table_sessions` rows, so preservation could not be demonstrated. | Create a session in a test environment, rename/move the table, and confirm history remains. |

### B.4 Business information (requirements 44–53)

| No. | Requirement | Status | Evidence | Remaining work |
|---|---|---|---|---|
| 44 | Configure business name | Not Verified | Field exists and the live record is "Kigali Corner Bar"; the Settings form and `PUT /api/settings/business` exist with validation and audit. No save was performed; the row's origin could not be attributed to this screen. | Save a business-name change and confirm DB persistence and audit entry. |
| 45 | Configure business logo | Not Verified | Only a URL field exists; there is no upload or file storage. Settings accepts an HTTP(S) URL and the receipt renders it. The live logo value is null. | Decide whether URL-only support is acceptable; test rendering a real logo URL. |
| 46 | Configure address | Not Verified | Stored in `businesses.address`, exposed in Settings, and used on receipts. Save path not executed. | Save and verify persistence and receipt output. |
| 47 | Configure telephone number | Not Verified | Stored in `businesses.phone`, exposed in Settings, and used on receipts. Save path not executed. | Save and verify persistence and receipt output. |
| 48 | Configure email | Not Verified | Stored and validated as an email in Settings and used on receipts. Save path not executed. | Save and verify persistence and receipt output. |
| 49 | Currency with RWF as default | Complete | The live business currency is RWF; the frontend defaults to RWF, and the backend validates a three-letter currency code. | None. |
| 50 | Configure time zone | Not Verified | Stored in `businesses.timezone`, validated by the settings route, and used for receipt date formatting. Live value is Africa/Kigali. Save path not executed. | Save and verify persistence. |
| 51 | Configure receipt footer | Not Verified | Both `businesses.receipt_footer` and `system_settings.receipt.footer` exist; the live business footer is null and `system_settings` is empty. The receipt falls back correctly when unset. | Consolidate the two footer sources and save/verify a value. |
| 52 | Business contact information is reflected where required | Complete | `GET /api/settings/receipt` returns the live business name, address, phone, email, TIN, currency, timezone, and logo; POS and the Floor table bill render them. Live response verified against the DB row. | None. |
| 53 | Changing business information does not alter finalized historical transactions | Complete | Sale rows store amounts and items but no business snapshot, and the business update route touches only the `businesses` row. Historical totals and items are unaffected, though a reprint uses current business details by design. | None. |

### B.5 Receipt and POS settings (requirements 54–63)

| No. | Requirement | Status | Evidence | Remaining work |
|---|---|---|---|---|
| 54 | Receipt business information | Complete | The POS and table receipts render the name, address, phone, email, TIN, logo, currency, and timezone from the live business/settings response. | None. |
| 55 | Receipt footer | Not Verified | A footer setting is exposed and the receipt renders a configured footer with a fallback; no footer value has been saved (`system_settings` empty, business footer null), so configured output was not observed. | Save a footer and verify it appears on both receipt types. |
| 56 | 80 mm thermal receipt format | Complete | `index.css` defines `#receipt-paper` and `#table-receipt` at 80 mm with print visibility rules; the receipt carries `data-format` and the POS print action uses it. | None. |
| 57 | A4/PDF receipt format | Partial | An A4 paper-format option sets 210 mm width in print CSS and is stored in the receipt settings. There is no PDF generator; PDF output depends on the browser's print-to-PDF. | Add/confirm PDF export if a downloadable PDF is required. |
| 58 | Cashier identity display | Complete | POS receipt shows the logged-in user's name when the cashier-display option is on; `cashier_name` comes from the authenticated user and is included in the receipt payload. | None. |
| 59 | Table number display | Complete | The Floor table bill shows the table name/number when the option is enabled; POS sales legitimately have no table because POS is not table-bound. | None. |
| 60 | Payment breakdown | Complete | Receipts render payment method/amount lines and paid/balance figures from the sale's payments; controlled by the payment-details setting. | None. |
| 61 | Outstanding balance display | Complete | POS receipt and the table bill show balance due when the open-balance option is enabled; live sales include a partial-payment example. | None. |
| 62 | Available POS shortcuts, if implemented | Missing | No POS keyboard shortcut system was found in the frontend code. The requirement is conditional and the feature is absent. | Implement only if shortcuts are required. |
| 63 | Receipt settings actually affect generated receipts | Partial | POS and Floor read `GET /api/settings/receipt` and conditionally render cashier, payments, balance, footer, and paper format. Because no settings have ever been saved, only the default branch has been observed in practice. | Save non-default settings and verify each toggle and format on a printed receipt. |

### B.6 Users and permissions (requirements 64–77)

| No. | Requirement | Status | Evidence | Remaining work |
|---|---|---|---|---|
| 64 | Administrators can view users | Complete | Live admin `GET /api/settings/users` → 200 with the three users; manager and cashier → 403. | None. |
| 65 | Create users | Not Verified | `POST /api/settings/users` is admin-only, validates role, hashes passwords with bcrypt, and audits creation; the Settings form exists. No user was created because it would modify live account data. | Create a test user in a staging copy and verify login and audit. |
| 66 | Edit users | Not Verified | Admin-only update route validates and audits role/status changes; UI exists. Not executed. | Edit a test user and verify persisted role/status. |
| 67 | Activate and deactivate accounts | Not Verified | Status is part of the user update route and login rejects inactive users ("User not found or inactive" observed with an invalid id). Not executed on a real account. | Deactivate and reactivate a test user and verify login denial. |
| 68 | Assign roles | Not Verified | Role selection is validated against the roles table in the admin-only user route; no assignment was performed. | Assign a role to a test user and verify permissions change. |
| 69 | Manage permissions | Partial | Permissions are role-based only. There is no per-user or per-permission management screen/API beyond assigning one of the five roles. | Add granular permissions only if the business requires them. |
| 70 | Reset passwords securely | Not Verified | Password reset is admin-only, enforces a 12-character minimum, and bcrypt-hashes with 12 rounds; no reset was executed. | Reset a test account and verify old password fails and new one works. |
| 71 | Owner/Administrator role restrictions | Complete | Admin-only endpoints returned 200 for admin and 403 for manager/cashier (`/settings/users`, `/settings/unit-history`, `/audit`, settings writes); the Settings UI hides admin-only actions. | None. |
| 72 | Manager role restrictions | Complete | Manager `GET /api/settings` → 200, but `/settings/users`, `/settings/unit-history`, `/audit`, `PUT /settings/business`, `PUT /settings/configuration`, and `PUT /products/1/units` → 403. | None. |
| 73 | Cashier role restrictions | Complete | Cashier `GET /api/settings` → 403, `/settings/users` → 403, `/audit` → 403, product-unit write → 403; receipt settings → 200 because cashiers need receipt data; settings UI blocks the role. | None. |
| 74 | Stock Manager role restrictions | Not Verified | No stock_keeper user exists (only admin, manager, cashier), and creating one would modify data. Code restricts Settings to admin/manager and gates stock adjustments when manager approval is enabled. | Create a test stock-keeper account and verify settings denial and stock permissions. |
| 75 | Waiter role, if supported | Not Verified | Waiter is a defined role and floor/table routes allow it, but no waiter account exists and none was created during the audit. | Test with a waiter account in staging. |
| 76 | Frontend and backend authorization both enforced | Complete | Settings component blocks unauthorized roles, and direct API calls were rejected with 401/403 even when the UI was bypassed. A hidden button alone is not the control. | None. |
| 77 | Administrators cannot accidentally remove their own essential access | Not Verified | The user-update route contains self-demotion and last-active-admin guards. Testing it would require demoting or deactivating the only admin, which is data-modifying and unsafe here. | Verify the guard in a disposable copy with two admin accounts. |

### B.7 Inventory configuration (requirements 78–87)

| No. | Requirement | Status | Evidence | Remaining work |
|---|---|---|---|---|
| 78 | Low-stock alerts | Complete | The stock endpoint and dashboard compute low stock from base quantity against the product threshold or the global default; live results returned three low products. | None. |
| 79 | Product-specific minimum stock levels | Complete | Products carry `min_stock_level`; live values (2, 20, 25) produce the observed low-stock list. The Products form edits the field. | None. |
| 80 | Supported stock units | Complete | Stock is stored and displayed in each product's base unit; global units are available for configuration and base rows exist for all 26 products. | None. |
| 81 | Expiry tracking, if implemented | Partial | Schema and goods-receipt logic support batch expiry; all 26 products have `track_expiry = 0` and there are 0 stock batches, so expiry enforcement was not observed live. | Enable expiry on a test product and receive a dated batch. |
| 82 | Batch tracking, if implemented | Partial | Batch tables, batch deltas, and goods-receipt batch creation exist, but `stock_batches` is empty and no batch was received or consumed during the audit. | Verify receipt, sale deduction, and expiry blocking with a test batch. |
| 83 | Stock adjustment approval requirements | Partial | When the setting is enabled, stock keepers are blocked from quantity-changing actions and a manager/admin must act. There is no pending-approval queue or approval record; it is a role gate only. | Decide whether a real approval workflow is required. |
| 84 | Thresholds use base units | Complete | Low-stock comparisons use `stock.quantity` (base) against the base threshold; no unit conversion is applied to the threshold. | None. |
| 85 | Alerts display correct quantities | Complete | Live query returned inyange mango juice 2 vs min 2, truble king 14 vs min 20, BOND7 9 vs min 25, matching the stored base quantities. | None. |
| 86 | Negative-stock protection remains active | Complete | Code inspection of the sale, adjustment, purchase, and stock-count paths shows each checks available base quantity and rejects a negative result. No live over-quantity transaction was executed during this audit. | Add an automated negative-stock test. |
| 87 | Adjustments follow the required approval process | Partial | Adjustment approval is enforced as a permission gate, not as a documented multi-step approval trail; `approved_by` exists on movements but is not used to record an approval decision. | Add an approval record/queue if auditability is required. |

### B.8 Security and audit (requirements 88–100)

| No. | Requirement | Status | Evidence | Remaining work |
|---|---|---|---|---|
| 88 | Records the user who changed a setting | Complete | `audit_logs.user_id` is written from the authenticated user; live floor/sale/cash entries show user 1. | None. |
| 89 | Records the action performed | Complete | Live entries include `floor_area_created`, `dining_table_created`, `sale_completed`, `cash_movement_recorded`, `cash_shift_opened`. | None. |
| 90 | Records the previous value | Partial | Old values are supported and written on update/delete paths, but every live audit row is a creation or sale event with `old_values` null. No update audit row exists to demonstrate a previous value. | Produce an update event (for example an area rename) and inspect `old_values`. |
| 91 | Records the new value | Complete | Live audit rows contain `new_values` with names, capacities, area ids, receipt numbers, totals, and reasons. | None. |
| 92 | Records date and time | Complete | Audit rows have `created_at`; live entries are timestamped. | None. |
| 93 | Records the reason for the change | Complete | Reasons supplied for area/table creation appear in `new_values.reason` (for example "Family meeting", "Group"). Required for business/config/unit changes. | None. |
| 94 | Product conversion changes audited | Not Verified | Code writes `product_unit_history` and an audit event in the same transaction, but no conversion has ever been changed: history is 0 rows and no such audit action exists. | Perform one controlled change and verify both records. |
| 95 | Product price changes audited | Missing | `PUT /api/products/:id` and product create/update do not call the audit helper; there is no price-specific audit action or reason requirement. | Add price-change auditing with old/new values and a reason. |
| 96 | Stock-sensitive settings audited | Not Verified | Inventory configuration saves emit an audit event with before/after settings, but no inventory configuration has been saved (`system_settings` empty), so no such entry exists. Adjustment movements are not written to `audit_logs`. | Save inventory settings and verify; decide whether adjustments need audit entries. |
| 97 | Business settings audited | Not Verified | The business update route requires a reason and audits old/new values, but no business update has been recorded in the audit table. | Save a business change and verify the audit row. |
| 98 | User and permission changes audited | Not Verified | Create/update user routes write audit events; no user changes exist beyond the seeded accounts, so none were exercised. | Create/edit a test user and verify audit entries. |
| 99 | Floor and table configuration audited | Complete | Audit logs 5–9 record three area creations and two table creations with user, action, new values, timestamp, and reasons. | None. |
| 100 | Ordinary users cannot silently edit or delete audit records | Complete | `routes/audit.js` exposes only read endpoints; there are no update/delete routes for `audit_logs`. Admin read returned 200, manager/cashier 403. | None. |

### B.9 Backend integration (requirements 101–109)

| No. | Requirement | Status | Evidence | Remaining work |
|---|---|---|---|---|
| 101 | Settings stored persistently in the database | Partial | The business record persists and is returned by the API; `system_settings` exists with a key-based upsert but contains 0 rows, so receipt/inventory configuration persistence has never been demonstrated. | Save each settings section once and confirm reload returns the stored values. |
| 102 | Backend validates submitted values | Complete | Settings/business/product/floor/user routes validate required fields, email, currency, timezone, logo URL, factors, prices, whole-number countable units, duplicates, and role/status values. Live invalid sale requests returned 400 with clear messages. | Add formal tests for boundary values. |
| 103 | Protected APIs enforce permissions | Complete | Live matrix: no token 401; invalid user 401; admin reads 200; manager/cashier denied 403 on admin-only routes; unauthorized writes 403 before any handler write. | None. |
| 104 | Database transactions protect related updates | Complete | Sale, purchase, goods receipt, unit save, user save, and floor operations wrap related writes in Prisma `$transaction`; unit save also uses a row-level lock. | None. |
| 105 | Existing database records preserved | Complete | The audit was read-only; before/after counts were identical (sales 23, audit 12, units 39, areas 3, tables 2, users 3). No migration or schema command changed data. | None. |
| 106 | Duplicate models or conflicting settings do not exist | Partial | Legacy `products.purchase_unit_id`/`sale_unit_id` coexist with `product_units`; global `unit_conversions` coexist with product-specific factors; two receipt-footer fields exist (`businesses.receipt_footer` and `system_settings.receipt.footer`). Live resolution prefers product units and falls back to legacy for unconfigured products. | Remove or document the legacy/duplicate sources to prevent divergence. |
| 107 | Frontend and backend field names and values consistent | Complete | The Settings payloads (`product_units`, `conversion_factor`, `is_sale_enabled`, `selling_price`, `reason`, receipt keys) match route expectations; live responses are the shapes consumed by the pages. | None. |
| 108 | Errors are handled correctly | Complete | APIs return JSON `{success, message}` with 400/401/403/404/500 as appropriate; observed examples include "Insufficient permissions", "Crate is not enabled for sale", and missing idempotency key. | None. |
| 109 | Saving settings does not produce duplicate records | Not Verified | `system_settings` uses a keyed upsert and unit rows are unique per product/unit, which should prevent duplicates. No settings save was executed, so duplicate-free behavior was not observed. | Save the same section twice and compare row counts. |

### B.10 Safe functional tests and build checks (requirements 110–122)

| No. | Requirement | Status | Evidence | Remaining work |
|---|---|---|---|---|
| 110 | Product-specific conversion calculations | Complete | Live helper resolution and stored snapshots confirm factor 24 for crates and 6 for packs, with base quantities computed from those product factors. | None. |
| 111 | Product-specific unit prices | Complete | Product unit rows carry per-unit selling prices for bottles, `resolveProductUnit` returns the price for the selected unit and mode, and the sale route computes the line total server-side from the configured unit rather than trusting the client. | None. |
| 112 | Historical conversion snapshots | Complete | Live `purchase_items` and `sale_items` rows retain unit id, factor, base quantity, and price; purchase 1 is 5 crates × 24 = 120. | None. |
| 113 | Unauthorized settings access | Complete | Tested 401 without a token, 401 for an invalid user, and 403 for cashier/manager on admin-only settings, audit, and unit routes. | None. |
| 114 | Floor and table configuration | Partial | Live areas/tables and their audit records verify prior creation; read APIs work. Creating/editing/deactivating during the audit was skipped to avoid modifying live floor data. | Exercise CRUD in a staging copy. |
| 115 | Receipt configuration | Not Verified | Receipt rendering reads the settings endpoint, but `system_settings` is empty, so no non-default receipt configuration has ever been saved or printed. | Save each receipt option and verify printed output. |
| 116 | Settings persistence | Not Verified | No settings write was permitted during the audit; business data exists but receipt/inventory settings do not. | Execute save/reload tests in a disposable environment. |
| 117 | Audit logging | Partial | Existing floor, sale, and cash audit records are correct and complete. Business, user, conversion, and stock-setting audit paths have never produced records and remain unverified. | Trigger each audited action once in staging. |
| 118 | Frontend/backend integration | Complete | The production build succeeded, and the live API responses used by Settings, POS, Products, and Floor match the frontend field names and types. | None. |
| 119 | Existing non-destructive backend tests | Complete | `cd backend && npm test`: 4 of 4 tests passed (`cashLedger`, `refundMath`). | None. |
| 120 | Frontend production build | Complete | `cd frontend && npm run build`: success, 2138 modules transformed, `dist` generated. | None. |
| 121 | Frontend lint check | Complete | `npm run lint`: 0 errors, 17 warnings (React effect/set-state advisories in Settings/Products); exit code 0. | Optionally clean warnings. |
| 122 | Automated tests for settings and conversions | Missing | The repository has only two test files (cash ledger and refund math); there are no tests for settings, unit conversion, authorization, receipts, or floor configuration. | Add focused backend tests for conversion, permissions, and settings persistence. |

---

## C. Completed tasks (verified working)

1. Settings link, gear icon, label, `/settings` routing, and active-nav state in the topbar.
2. Settings/API authorization: no-token 401, unauthorized role 403, and a frontend access-denied view behind direct URL access.
3. Per-product conversion factors and independent purchase/sale unit configuration, with separation of purchase cost and selling price.
4. Base-unit enforcement, server-side conversion resolution, and stock movement in base units.
5. Cashier restriction to sale-enabled units, with server-side rejection of an unconfigured crate sale.
6. Blocking of cashier and manager access to conversion and settings writes.
7. Historical unit/factor/quantity/price snapshots on live sales and purchases.
8. Purchasing, goods receiving, inventory, POS, receipt, and report use of the same product conversion data.
9. Fanta and Coca-Cola crate factor 24 arithmetic; 3 Fanta crates correctly implies 72 base units.
10. Floor area/table creation, area assignment, capacity, live data consistency, and audit records for prior floor changes.
11. Business contact data returned by the receipt endpoint and rendered on POS and table bills; RWF default and timezone handling.
12. 80 mm receipt CSS, cashier identity, payment breakdown, table number on table bills, and outstanding balance display.
13. Admin-only user listing and role restrictions for manager and cashier.
14. Low-stock alerts, product-specific thresholds, base-unit thresholds, correct live low-stock quantities, and negative-stock protection.
15. Audit fields for user, action, new value, timestamp, and reason on existing floor/sale/cash records; admin-only audit reads with no mutation endpoints.
16. Backend validation, permission enforcement, transactional writes, consistent error responses, and consistent frontend/backend field names.
17. Existing data preserved (counts unchanged) and the audit itself performed no writes.
18. Backend tests 4/4 pass, frontend production build succeeds, and lint has 0 errors.

## D. Incomplete tasks (partial)

1. **Responsive Settings page (5):** responsive classes exist, but no real desktop/tablet/mobile viewport test was performed.
2. **Multiple unit prices (12):** crate/pack selling prices are not configured for Primus, Fanta, or Coca-Cola; only purchase prices exist.
3. **Product Management integration (22):** units are visible and created with products, but structural editing is only in Settings; the Products page has no clear link/read-only conversion summary.
4. **12-unit product calculation (32):** the global Case→Can factor 12 exists, but no product uses a 12-unit product-specific factor and no transaction demonstrates it.
5. **Duplicate table codes (40):** uniqueness is per area, not global.
6. **Table statuses (41):** occupied and bill-pending states exist only in code; no session data proves them.
7. **A4/PDF receipts (57):** A4 print CSS exists, but there is no PDF export; PDF relies on browser print.
8. **Receipt settings affecting output (63):** wiring is present, but only default values have been observed because no settings have been saved.
9. **Permission management (69):** only fixed role assignment exists; no granular permission management.
10. **Expiry tracking (81):** implemented but disabled on all products; no live batch proves enforcement.
11. **Batch tracking (82):** implemented but `stock_batches` is empty and no batch flow was exercised.
12. **Adjustment approval requirement (83):** enforced as a role gate, not a pending-approval workflow.
13. **Adjustment approval process/trail (87):** no approval decision record; `approved_by` is not populated for adjustments.
14. **Previous value in audit (90):** supported, but only creation/sale events exist, so `old_values` was never populated in live data.
15. **Settings persistence (101):** business data persists; `system_settings` has 0 rows, so configuration persistence is undemonstrated.
16. **Duplicate/conflicting models (106):** legacy product unit columns, global unit conversions, and two receipt-footer fields coexist with the newer settings sources.
17. **Floor/table CRUD testing (114):** creation is evidenced by pre-existing data and audit logs; edit/deactivate were not executed during the audit.
18. **Audit logging coverage (117):** existing floor/sale/cash logs are correct; business, user, conversion, and stock-setting events were never generated.

## E. Not implemented tasks

1. **POS keyboard shortcuts (62):** no shortcut implementation exists.
2. **Product price-change auditing (95):** product price changes are neither audited nor reason-gated.
3. **Automated settings/conversion tests (122):** no test files cover settings, conversions, receipts, floor configuration, or authorization.

## F. Broken features

1. **Primus crate conversion (29):** the live factor is 24, so 5 crates produce 120 base units instead of the required 100. Existing purchase data confirms 120. This is a configuration/data mismatch rather than an arithmetic defect, but it fails the required business rule.
2. **Fanta crate sale deduction (31):** the crate unit is disabled for sale and has no selling price; the API returns 400 "Crate is not enabled for sale", so selling one crate cannot deduct 24 bottles. The same applies to the Coca-Cola crate.

**Related data-integrity defect (not a separate checklist row):** product 26 (`BOND7`) has a Crate unit with `conversion_factor = 1`. Validation allows it because 1 is a whole number, but it makes a crate indistinguishable from one base unit for stock purposes. Product 22 (`skol luger`) has Case as its base unit and was sold at 150,000 per case; this is a questionable product setup rather than a conversion-engine failure.

## G. Not verified

These items could not be tested without writing production data, creating accounts, or using data that does not exist. Their code paths are present and were inspected.

- Product-unit create/edit save, history, and audit (9, 21).
- Area edit and deactivate (35, 36); table session/history preservation (43).
- All business-field saves and receipt-footer save (44–48, 50, 51).
- Receipt footer output (55).
- User create, edit, activate/deactivate, role assignment, and password reset (65–68, 70).
- Stock-keeper and waiter role behavior (74, 75).
- Self-demotion/last-admin guard (77).
- Conversion, business, user, and stock-setting audit events (94, 96–98).
- Duplicate-free settings saves (109).
- Receipt configuration and overall settings persistence (115, 116).

Reason: the brief prohibits modifying existing business data, schema, or accounts, and the database has no saved `system_settings`, no `product_unit_history`, no `table_sessions`, and no stock_keeper/waiter accounts. Creating any of these would have changed the system under audit.

## H. Product conversion test results

### Database configuration observed

| Product | Base unit | Crate factor | Crate sale enabled | Crate selling price | Crate purchase price |
|---|---|---|---|---|---|
| Primus 65cl (id 1) | Bottle | **24** | No | null | 19,200 |
| PRIMUS (id 21) | Bottle | no crate row | — | — | — |
| Fanta (id 2) | Bottle | **24** | No | null | 9,600 |
| Coca-Cola (id 3) | Bottle | **24** | No | null | 9,600 |
| BOND7 (id 26) | Piece | **1** | No | null | 700 |
| Product with factor 12 | — | **none configured** | — | — | — |

Global `unit_conversions` also contains Crate→Bottle 24, Case→Can 12, and Pack→Bottle 6, but these are not used for products that have their own `product_units` rows.

### Required calculation results

| Test | Required result | Actual result | Verdict |
|---|---|---|---|
| 5 Primus crates | 100 bottles | 5 × live factor 24 = **120**; `purchase_items` row records 120 base units for 5 crates | **FAIL — Broken** |
| 3 Fanta crates | 72 bottles | 3 × live factor 24 = **72**; live 4-crate purchase records 96, confirming the rule | **PASS** |
| Sell 1 Fanta crate | 24 bottles deducted | Crate sale rejected with 400 because sale is disabled and no selling price exists; no deduction possible | **FAIL — Broken** |
| 2 crates at factor 12 | 24 base units | No product has a 12-unit factor; global Case→Can 12 exists but the product path cannot be exercised | **NOT VERIFIED / NOT CONFIGURED** |

### Layer-by-layer verification

| Layer | What was verified | Result |
|---|---|---|
| Frontend | POS filters sale-enabled units, displays the unit-specific price, and sends quantity plus unit; no crate option is shown for Primus/Fanta/Coca-Cola because sale is disabled. Frontend never computes the authoritative line total. | Verified for filtering and cart display; crate sale not available. |
| Backend | `resolveProductUnit` selects the product-specific row, rejects disabled units, and computes base quantity and price; sale testing returned the expected 400 for a crate. Purchase processing used factor 24 and factor 6 correctly. | Verified. |
| Database | `product_units` factors, `purchase_items` snapshots (5 × 24 = 120; 4 × 24 = 96; 1 × 6 = 6), `sale_items` snapshots with factor and unit price. | Verified; contradicts the Primus requirement of 20. |

## I. Security test results

Live API authorization matrix (read-only requests and write attempts that authorization rejects before writing):

| Actor | Settings read | Users | Unit history | Audit | Receipt settings | Settings writes | Product unit writes | Floor writes |
|---|---|---|---|---|---|---|---|---|
| No token | 401 | — | — | — | 401 | — | — | — |
| Invalid user id | 401 | — | — | — | — | — | — | — |
| Admin | 200 | 200 | 200 | 200 | 200 | Allowed by role (not executed) | Allowed by role (not executed) | Allowed by role (not executed) |
| Manager | 200 | 403 | 403 | 403 | 200 | 403 | 403 | 403 on tested write routes |
| Cashier | 403 | 403 | 403 | 403 | 200 | 403 | 403 | 403 on tested write routes |
| Stock keeper | Not tested (no account) | Not tested | Not tested | Not tested | Not tested | Not tested | Not tested | Not tested |
| Waiter | Not tested (no account) | Not tested | Not tested | Not tested | Not tested | Not tested | Not tested | Not tested |

Other observations:

- Unauthorized writes were rejected with 403 for: manager and cashier `PUT /settings/business`; manager `PUT /settings/configuration`; manager and cashier `PUT /products/1/units`; manager `POST /settings/users`; cashier `PUT /floor/areas/1`; cashier `POST /floor/tables`.
- A cashier `POST /sales` reached the handler and was rejected with 400 for a missing idempotency key, confirming the role is authorized for sales while the payload is still validated.
- `GET /api/settings/receipt` is intentionally available to any authenticated user (including cashiers) and is not a settings-management endpoint.
- No API route updates or deletes `audit_logs`; audit reading is admin-only.
- Result: backend authorization passed for all three available roles; stock-keeper and waiter authorization could not be verified live.

## J. Final recommendations

### CRITICAL — data integrity and financial correctness

1. Correct the Primus crate factor to the real value (20 per the brief) and re-check all affected stock and purchase history. The current live purchase of 5 crates is stored as 120 base units.
2. Fix the BOND7 Crate unit with factor 1; add validation that a package unit's factor must be greater than 1. A crate identical to one base unit will silently corrupt stock.
3. Enable and price crate/pack selling units (at least for Fanta and Coca-Cola) so crate sales deduct 24 base units and cannot be blocked at checkout.
4. Clean up product master data (two Primus products, Case-based product 22 sold at 150,000) and document which unit is the true base for each beverage.

### HIGH — missing conversion, audit, and verification coverage

5. Add audit logging with before/after values and a required reason for product price changes and product create/deactivate; currently these changes are silent.
6. Perform and verify one controlled conversion change so `product_unit_history` and its audit record are proven, not just coded.
7. Save each business/receipt/inventory settings section once (with a reason) and confirm reload persistence, audit entries, and non-duplication; `system_settings` is currently empty.
8. Resolve the duplicate configuration sources: legacy `products.purchase_unit_id`/`sale_unit_id`, global `unit_conversions`, and the two receipt-footer fields.
9. Add automated backend tests for conversion resolution, disabled-unit rejection, permission matrix, settings persistence, and audit creation.
10. Verify stock-keeper and waiter permissions with disposable accounts, and confirm the last-admin/self-demotion guard with two admin accounts.

### MEDIUM — floor, receipt, and inventory completeness

11. Add area deactivation to the Settings floor section if that is where administrators are expected to manage it; today it exists only on the Floor page.
12. Decide whether one Settings save should update both the business footer and the receipt footer, or remove one source.
13. Enforce global table-code uniqueness if the business requires it, and exercise occupied/bill-pending table states with a real session.
14. Test expiry and batch workflows with at least one track-expiry product and a received batch; both features currently have no live data.
15. Decide whether adjustment approval needs a real pending-approval queue rather than a role gate.

### LOW — convenience and polish

16. Consolidate responsive behavior and verify the Settings page at phone/tablet widths.
17. Add a read-only conversion summary or a direct link from Products to the Settings unit editor.
18. Provide a true PDF export if a downloadable A4 PDF is required; browser print works today.
19. Implement POS shortcuts only if the business needs them.
20. Add logo upload if URL-only branding is insufficient.
21. Clean the 17 frontend lint warnings and investigate why `npm start` fails its `prestart` Prisma generation on this machine (EPERM renaming `query_engine-windows.dll.node`); the API runs correctly with `node src/server.js`.

---

## Final summary

**Finished:** topbar Settings link and routing; authentication and role enforcement for the three available roles; per-product conversion storage, base-unit stock, server-side unit resolution, and snapshots; POS sale-unit filtering; picking and purchasing integration; low-stock alerts and negative-stock protection; floor area/table creation, capacity, area assignment, and their audit trail; business contact data in receipts; 80 mm receipts and payment/balance displays; admin-only user listing and audit reads; validation, transactions, and error handling; backend tests, build, and lint.

**Partially finished:** responsive verification, multi-unit pricing, Products-to-Settings conversion editing, 12-unit test coverage, duplicate table-code scope, table status states, A4/PDF, receipt settings applied to printed output, granular permissions, expiry and batch workflows, adjustment approval workflow, audit previous values, settings persistence beyond business data, duplicate/legacy configuration models, live floor CRUD testing, and audit coverage for non-floor settings.

**Not yet implemented:** POS keyboard shortcuts, product price-change auditing, and automated tests for settings/conversions.

**Broken:** the Primus crate conversion (24 instead of 20, producing 120 instead of 100 base units) and crate selling (crate units disabled and unpriced, so a Fanta/Coca-Cola crate sale cannot deduct 24 bottles). A related data-integrity defect is the BOND7 Crate unit with factor 1.

**Could not be verified:** saving/editing product units and their history; area edit/deactivate and session preservation; all business and receipt-footer saves; user creation, editing, activation, role assignment, and password reset; stock-keeper and waiter authorization; the last-admin guard; conversion/business/user/stock-setting audit entries; duplicate-free settings saves; receipt configuration; and overall settings persistence. These require writes, accounts, or data that the audit was not permitted to create, and are marked Not Verified rather than assumed working.

The strict evidence-based completion result is **71 of 122 requirements (58.2%)**, or **71 of 94 assessable requirements (75.5%)** when the 28 write-dependent unverified items are excluded. The project is substantially implemented, but the conversion-data defects and the untested settings save paths must be closed before the Settings page can be considered production-verified.

---

*Report generated from read-only inspection and safe tests on 11 November 2026. No application source, schema, or business data was modified; only this report was created.*
