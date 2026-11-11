ALTER TABLE `table_payments`
  ADD COLUMN `status` VARCHAR(20) NOT NULL DEFAULT 'confirmed',
  ADD COLUMN `external_reference` VARCHAR(100) NULL,
  ADD COLUMN `idempotency_key` VARCHAR(100) NULL,
  ADD COLUMN `confirmed_by` INT NULL,
  ADD COLUMN `confirmed_at` TIMESTAMP(0) NULL,
  ADD UNIQUE INDEX `table_payments_idempotency_key_key` (`idempotency_key`);

ALTER TABLE `sale_payments`
  ADD COLUMN `external_reference` VARCHAR(100) NULL,
  ADD COLUMN `status` VARCHAR(20) NOT NULL DEFAULT 'confirmed',
  ADD COLUMN `idempotency_key` VARCHAR(100) NULL,
  ADD COLUMN `created_by` INT NULL,
  ADD COLUMN `confirmed_by` INT NULL,
  ADD COLUMN `confirmed_at` TIMESTAMP(0) NULL,
  ADD UNIQUE INDEX `sale_payments_idempotency_key_key` (`idempotency_key`);

ALTER TABLE `customer_payments`
  ADD COLUMN `status` VARCHAR(20) NOT NULL DEFAULT 'confirmed',
  ADD COLUMN `external_reference` VARCHAR(100) NULL,
  ADD COLUMN `idempotency_key` VARCHAR(100) NULL,
  ADD COLUMN `confirmed_by` INT NULL,
  ADD COLUMN `confirmed_at` TIMESTAMP(0) NULL,
  ADD UNIQUE INDEX `customer_payments_idempotency_key_key` (`idempotency_key`);

CREATE TABLE `customer_payment_allocations` (
  `id` BIGINT NOT NULL AUTO_INCREMENT,
  `customer_payment_id` BIGINT NOT NULL,
  `debt_id` BIGINT NOT NULL,
  `amount` DECIMAL(14, 2) NOT NULL,
  `created_at` TIMESTAMP(0) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  UNIQUE INDEX `unique_customer_payment_debt` (`customer_payment_id`, `debt_id`),
  INDEX `idx_customer_payment_allocation_debt` (`debt_id`),
  PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

ALTER TABLE `sales`
  MODIFY `payment_method` ENUM('cash', 'mobile_money', 'card', 'bank', 'other', 'credit', 'mixed') NULL DEFAULT 'cash',
  ADD COLUMN `idempotency_key` VARCHAR(100) NULL,
  ADD COLUMN `request_hash` CHAR(64) NULL,
  ADD UNIQUE INDEX `sales_idempotency_key_key` (`idempotency_key`);

ALTER TABLE `sale_payments`
  MODIFY `payment_method` ENUM('cash', 'mobile_money', 'card', 'bank', 'credit', 'other') NOT NULL;

ALTER TABLE `cash_sessions`
  ADD COLUMN `review_status` VARCHAR(20) NOT NULL DEFAULT 'not_required',
  ADD COLUMN `review_notes` TEXT NULL,
  ADD COLUMN `reviewed_by` INT NULL,
  ADD COLUMN `reviewed_at` TIMESTAMP(0) NULL,
  ADD COLUMN `close_idempotency_key` VARCHAR(100) NULL,
  ADD COLUMN `close_request_hash` CHAR(64) NULL,
  ADD UNIQUE INDEX `cash_sessions_close_idempotency_key_key` (`close_idempotency_key`);

ALTER TABLE `cash_movements`
  ADD COLUMN `idempotency_key` VARCHAR(100) NULL,
  ADD UNIQUE INDEX `cash_movements_idempotency_key_key` (`idempotency_key`),
  ADD INDEX `idx_cash_movement_session_date` (`session_id`, `created_at`);

ALTER TABLE `cash_movements`
  MODIFY `movement_type` ENUM(
    'sale',
    'purchase_payment',
    'expense',
    'customer_payment',
    'supplier_payment',
    'cash_in',
    'cash_out',
    'adjustment',
    'refund',
    'cash_drop',
    'cash_withdrawal',
    'cash_deposit',
    'cash_adjustment_in',
    'cash_adjustment_out'
  ) NOT NULL;
