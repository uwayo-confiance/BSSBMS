# Umucyo Bar Premium POS v2.1 — Feature Gap Analysis

**Review date:** 10 November 2026  
**Specification reviewed:** `Umucyo_Bar_Premium_POS_Specification_v2_1_Table_Management.pdf`  
**Review scope:** Current BSSBMS frontend routes/pages and backend API/schema in this workspace.

## 1. Executive summary

The current application provides a useful foundation for product and supplier management, purchases, stock levels, immediate POS sales, customer records, expenses, and basic sales reporting. It is not yet the premium table-service POS described in the specification.

The largest gap is not visual polish: the current POS records a completed sale in one checkout operation, while the specification requires a table/session/order lifecycle where draft drinks do not affect stock, served drinks deduct stock exactly once, and the table bill remains open for later additions and payments. The application has no table/floor screen or backend table, session, or order-round implementation.

Other important gaps include product-specific crate conversion history, supplier payment allocation and returns, stock counts and expiry/batch tracking, reliable shift cash reconciliation, sale refunds, idempotent transaction handling, audit events, and operational reports/exports.

### Overall assessment

| Area | Assessment |
|---|---|
| Core catalogue, one-step sales, purchases, stock, customers and expenses | **Partially implemented** |
| Table service, open tabs, anonymous table orders and serving workflow | **Not implemented** |
| Product-specific crate settings and historical conversion snapshots | **Partially implemented; key requirement missing** |
| Financial/cash accountability and reversals | **Partially implemented; material controls missing** |
| Reporting, security administration, audit and deployment evidence | **Partially implemented** |

“Not found” below means no corresponding working frontend or backend behavior was found in the reviewed source. It does not claim that an unreviewed deployment or external service cannot provide it.

## 2. What is already present

These features provide a starting point and should generally be extended rather than replaced:

- **Product catalogue:** product creation/editing, category, barcode/SKU, base unit, cost and selling price, initial stock, minimum stock level, activation/deactivation and restore.
- **Supplier and purchase screens:** supplier records can be created and edited. Purchases can be recorded with a supplier, invoice, date, product lines, costs and an initial amount paid. The purchase workflow updates stock. Recent purchase edit/cancel support adjusts stock and preserves cancellation history.
- **Stock page:** current product quantities, low-stock filtering, quantity adjustment, and active/inactive product actions. Backend stock movements are recorded for supported operations.
- **Immediate POS:** product search, cart editing, customer selection including walk-in, discount entry, cash/Mobile Money/credit choices, single sale completion and a printable invoice/receipt.
- **Customer and expense pages:** customer contact/credit-limit management and expense/category entry.
- **Reports and dashboard:** today’s sales summary, daily sales/product details, product performance, and basic profit figures, with browser printing.
- **Backend foundation:** authenticated routes, role checks, product/sale/purchase records, transaction-wrapped sale processing, base-unit quantities, and some cash-session, debt, and supplier-payment schema/API support.

The main UI entry points are [App.jsx](./frontend/src/App.jsx), [POS.jsx](./frontend/src/pages/POS.jsx), [Products.jsx](./frontend/src/pages/Products.jsx), [Purchases.jsx](./frontend/src/pages/Purchases.jsx), [Stock.jsx](./frontend/src/pages/Stock.jsx), and [Reports.jsx](./frontend/src/pages/Reports.jsx). Backend work is concentrated in `backend/src/routes/`, with the data model in `backend/prisma/schema.prisma`.

## 3. Feature-by-feature gaps

| Requirement area | Frontend status | Backend/data status | Remaining work |
|---|---|---|---|
| **Floor areas, tables and seating** | No floor plan, areas, table list, availability states, capacity, or waiter assignment screen/route. | No bar-area, table, or table-session models or API routes were found. | Add manager configuration for areas/tables and a responsive floor overview; implement table status and one-active-session-per-table enforcement. |
| **Anonymous table service and open tabs** | POS selects a customer or walk-in, then completes the cart as a sale. There is no table context, open tab, or order-round history. | Sales are immediate completed transactions. No table sessions, orders, draft rounds, or served item records. | Add anonymous table sessions and walk-in channel. Keep unpaid served items as operational tabs, separate from registered customer debt. |
| **Draft → served → paid lifecycle** | No draft/hold/resume or “confirm served” workflow. | Sale completion deducts stock. There is no separate served event or exactly-once serving endpoint. | Add draft orders that do not change stock; confirm serving through a locked, transactional, idempotent backend action that posts each movement once. |
| **Table transfer, merge and closeout** | No actions or management views. | No corresponding data structures or APIs. | Add authorized transfer/merge/close actions with conflict checks and a permanent table/session history. Keep a table occupied until its bill is settled or validly transferred to approved credit. |
| **Per-product crates and selling units** | Product forms capture a base unit and prices. POS uses a configured sale unit if present but does not let the cashier select among product-configured units or show crate-specific prices. No settings page exists. | Products have base/purchase/sale unit IDs and there is a shared unit-to-unit conversion factor. Sale and purchase lines preserve quantities and base quantities, but not the conversion factor used. | Build authorized product-unit settings (for example, Primus crate=20, another brand crate=24), per-unit buy/sell prices, and immutable factor/name/price snapshots on each transaction line. |
| **Purchase orders and partial receipts** | Purchase form records a purchase/receipt in one step and adds stock immediately. No draft order or partial delivery UI. | Purchase creation marks the purchase received and increments stock. No staged delivery/receipt quantities or purchase-return workflow. | Distinguish ordered, partially received, received, and cancelled records. Only confirmed received quantities affect stock. Add supplier returns/credits as audited adjustments. |
| **Supplier balances and payment allocations** | Supplier page contains contact details; purchase page shows total, paid, balance and status. No supplier statement, later payment screen, or payment allocation UI. | Initial purchase payment can be recorded, but there is no later supplier-payment workflow or allocation model/API found. | Add supplier account statements and payments by cash/bank/Mobile Money, payment references, partial settlement, and allocations across invoices, including supplier credits. |
| **Stock counts and reasoned adjustments** | Stock page permits changing the total quantity; no count session, variance review, damage/waste form, or approval flow. | Stock adjustments and movement history exist. No count-session/count-item workflow found. | Add count sessions, counted quantities, variance reports, approval, and reasoned adjustment movements. Do not silently overwrite count differences. |
| **Batches, expiry and damaged/expired stock** | No batch, expiry, damage, expiry alert, or disposition UI. | Stock is maintained as an aggregate per product. No batch/expiry schema or FEFO picking was found. | Add optional batches/expiry dates and received cost. Add expired/damaged disposition and, if enabled, block expired sale and pick first-expiring stock. |
| **Payments, split bills and electronic confirmation** | POS supports one selected method per sale (cash, Mobile Money, or credit) and one amount-paid field. No split tender/item allocation or payment reference/status. | A sale creates one payment record. No payment allocation or provider confirmation workflow was found. | Support multiple payments per bill and allocations without overpayment/double counting. Treat Mobile Money as manual-reference/pending until confirmed; provider integration is separate scope. |
| **Cashier shifts and drawer movements** | No shift open/close, opening float, cash count, expected-cash display or variance review screen. | Cash-session model and open/close endpoints exist, but close calculates expected cash from opening balance alone. Cash movements exist in the schema but no route usage was found. | Build a ledger-backed shift view. Calculate expected cash from opening float plus cash receipts and repayments less refunds, expenses, payouts and drops; retain counted cash, variance, reason, and reviewer. Keep non-cash tenders separate. |
| **Refunds, returns and voids** | No refund/return/reprint workflow in POS. | Sale statuses include cancellation/refund values, but no sale refund/return endpoint or payment reversal workflow was found. Purchase cancellation is not a supplier return. | Add authorized, reasoned, original-sale-linked compensating transactions; capture refund channel and restock disposition. Never delete completed sales or served events. |
| **Retry and concurrency safety** | Checkout has a processing state but no transaction idempotency key or uncertain-result recovery. | No request deduplication/idempotency mechanism found; repeating a sale request can create another sale. | Add client-generated idempotency keys and status lookup for serve/payment/checkout. Use database constraints, row locks/conditional updates, ACID transactions, and explicit conflict responses. |
| **Credit accounts and repayments** | Customer records include credit limits and outstanding debt, but there is no evident repayment UI or explicit credit approval prompt. | Customer debts and payment-related APIs/models exist. Detailed server enforcement and repayment coverage should be verified before release. | Make authorized credit a distinct settlement path with server-side credit-limit checks, repayment records that do not create new revenue, and clear separation between customer debt and anonymous table tabs. |
| **Reports and exports** | Daily and product-performance views can be printed; no workbook export, dedicated PDF generation, table/tab/shift/refund reports, or broad period reporting UI. | Daily, product-performance, sales-summary, and profit routes exist. No table/tab/shift/refund reports or export endpoints found. | Add date/time and role-filtered reports for stock, purchases, supplier balances, credit, expenses, cash, tabs, turnover, waiter performance, payments, refunds and shift variances. Add consistent PDF/Excel exports. |
| **Settings, user administration and audit** | No Settings or user/role administration page. Roles are used to show/hide some navigation and actions. | Authentication and route-level role checks exist. Settings/user-management routes and audit-log writes were not found, although related schema models exist. | Add controlled business/product/table settings, user/role administration, and append-only audit events with actor, timestamp, reason and before/after details for sensitive actions. Keep authorization enforced by the API. |
| **Receipt and operational UX** | A sale receipt can be printed, but no receipt history/reprint screen. POS is not table-first and does not display shift/connectivity/table elapsed time. | Sale receipt references exist; no table/session context. | Add table/session, waiter/cashier, payment allocations and balance to receipts; support reprint. Validate 80-mm and A4/PDF output on chosen printers. |
| **Deployment, backup and offline policy** | Current UI submits sales online; no offline synchronization flow or clear connectivity/shift indicators. | No reviewed application feature demonstrates verified backup/restore, deployment checks, or offline reconciliation. | Keep final checkout online-only unless a separately designed offline system exists. Document staging, health checks, monitoring, rollback, protected secrets, and tested backup/restore. |

## 4. Recommended implementation order

The specification calls for a staged implementation and treats table management and correctly timed stock deduction as core behavior. A practical sequence is:

### Phase 1 — Data integrity and product configuration

- Confirm product base units and introduce product-specific buy/sell unit mappings and crate factors.
- Preserve conversion factor, selected unit, unit price, and cost snapshots on each purchase/sale/order line.
- Add migrations and tests before changing historical records; never reinterpret old transactions with a new crate factor.
- Add permission checks and audit events for unit, price, and stock-sensitive changes.

### Phase 2 — Purchasing and inventory accountability

- Separate purchase orders from goods receipts; support partial deliveries and only post received quantities to stock.
- Add supplier statements, payment entry and invoice allocations, supplier credits, and purchase returns.
- Add stock counts, approved adjustments, and optional batches/expiry handling.
- Preserve the current purchase/stock workflows while migrating them to the new transaction model.

### Phase 3 — Table and order lifecycle

- Add area/table settings, a responsive floor dashboard, table sessions, and a waiter assignment history.
- Add anonymous table and walk-in orders with multiple order rounds.
- Implement draft, served, paid/closed, void/return states. Deduct stock when service is confirmed, not when the table bill is later settled.
- Add row-level concurrency control, event IDs, idempotent serve requests, and audited transfer/merge actions.

### Phase 4 — Settlement and cash controls

- Add open-tab balances and payment allocations for cash, manual-confirmed Mobile Money, bank and split payments.
- Add cashier shifts, opening float, drawer movements, expected/count reconciliation, review reasons, and shift summaries.
- Complete customer-credit approval and repayment while keeping tabs separate from customer debt.
- Add refund/return/void workflows with approvals and compensating stock/payment movements.

### Phase 5 — Reporting, release readiness and operations

- Add table, tab, shift, refund, supplier, purchase, count, and cash reconciliation reports plus PDF/Excel exports.
- Test role permissions and audit history end-to-end.
- Verify backup restoration, deployment procedures, network-loss behavior, thermal printing, scanner compatibility, and responsive tablet/mobile use.

Optional or separately scoped items in the specification include reservations, kitchen/bar preparation tickets, multi-branch support, and offline sales synchronization. The initial system is intended to be online-first; these should not be confused with the core table/session workflow.

## 5. Minimum acceptance checks before calling the premium POS complete

1. Configure three products with distinct crate sizes (20, 24 and 12 base units); purchase and sell each in both base and crate units and verify stock math.
2. Change a conversion and confirm that past transaction lines still show their original unit, factor, price and base quantity.
3. Open a table without creating a customer; save a draft and confirm that stock is unchanged.
4. Confirm service for a round and verify that each line reduces stock once. Retry the same request and verify no duplicate item or movement.
5. Add a second round to the same table and verify one correct open balance.
6. Accept two tenders on one bill; prevent overpayment/double settlement and keep the table occupied until fully settled.
7. Transfer and merge open sessions with authorization; retain the original table/order/payment history and never orphan the bill.
8. Complete a walk-in without customer identity or table; separately demonstrate approved registered-customer credit and a repayment without duplicate revenue.
9. Reject insufficient-stock and concurrent last-unit service attempts without allowing negative stock.
10. Receive a partial supplier delivery/payment and verify supplier balance and payment allocations.
11. Record a stock count, damage, expiry, and return with approved movement history; verify no silent quantity overwrite.
12. Refund a sale with approval; preserve the original transaction and verify payment reversal and correct restock disposition.
13. Close a shift with a short/over amount and verify expected cash includes all drawer events, with a reason and review record.
14. Verify daily financial and stock figures reconcile across sales, discounts, returns, cost, expenses, customer debts, supplier balances and cash.
15. Demonstrate that a cashier cannot change crate settings or access restricted profit reports, and that retries, failures and sensitive actions are auditable.

## 6. Source and method

This comparison is based on a static review of the provided **Umucyo Bar Premium POS Specification v2.1**, especially sections 3–7A (POS, units, purchasing, inventory and table service), sections 8–12 (customers, finance, reports, security and data model), and sections 14–18 (deployment, phases, acceptance and completion checklist), and the current frontend/backend source tree.

It is a feature-gap assessment, not a penetration test, accounting validation, legal/tax review, or runtime acceptance test. Before production, verify local fiscalization and tax requirements, payment-provider behavior, age/licensing rules, and the selected hardware.
