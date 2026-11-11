ALTER TABLE `products`
  ADD COLUMN `track_expiry` TINYINT NOT NULL DEFAULT 0,
  ADD COLUMN `require_batch` TINYINT NOT NULL DEFAULT 0;

ALTER TABLE `stock_movements`
  ADD COLUMN `adjustment_reason` VARCHAR(50) NULL,
  ADD COLUMN `previous_quantity` DECIMAL(14,3) NULL,
  ADD COLUMN `new_quantity` DECIMAL(14,3) NULL,
  ADD COLUMN `approved_by` INT NULL,
  ADD COLUMN `approved_at` TIMESTAMP(0) NULL;

CREATE TABLE `purchase_orders` (
  `id` BIGINT NOT NULL AUTO_INCREMENT,
  `order_number` VARCHAR(40) NOT NULL,
  `supplier_id` INT NOT NULL,
  `status` VARCHAR(30) NOT NULL DEFAULT 'draft',
  `expected_date` DATE NULL,
  `subtotal` DECIMAL(14,2) NOT NULL DEFAULT 0,
  `total_amount` DECIMAL(14,2) NOT NULL DEFAULT 0,
  `notes` TEXT NULL,
  `cancel_reason` TEXT NULL,
  `created_by` INT NULL,
  `approved_by` INT NULL,
  `cancelled_by` INT NULL,
  `created_at` TIMESTAMP(0) NOT NULL DEFAULT CURRENT_TIMESTAMP(0),
  `updated_at` TIMESTAMP(0) NOT NULL DEFAULT CURRENT_TIMESTAMP(0),
  PRIMARY KEY (`id`),
  UNIQUE INDEX `purchase_orders_order_number_key` (`order_number`),
  INDEX `idx_purchase_order_supplier_status` (`supplier_id`, `status`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

CREATE TABLE `purchase_order_items` (
  `id` BIGINT NOT NULL AUTO_INCREMENT,
  `purchase_order_id` BIGINT NOT NULL,
  `product_id` INT NOT NULL,
  `product_name_snapshot` VARCHAR(150) NOT NULL,
  `quantity` DECIMAL(12,3) NOT NULL,
  `quantity_received_base` DECIMAL(14,3) NOT NULL DEFAULT 0,
  `unit_id` INT NOT NULL,
  `unit_name_snapshot` VARCHAR(50) NOT NULL,
  `conversion_factor_snapshot` DECIMAL(14,4) NOT NULL,
  `expected_unit_cost` DECIMAL(12,2) NOT NULL,
  `total_cost` DECIMAL(14,2) NOT NULL,
  PRIMARY KEY (`id`),
  INDEX `idx_purchase_order_item_order` (`purchase_order_id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

CREATE TABLE `goods_receipts` (
  `id` BIGINT NOT NULL AUTO_INCREMENT,
  `receipt_number` VARCHAR(40) NOT NULL,
  `purchase_order_id` BIGINT NOT NULL,
  `purchase_id` BIGINT NULL,
  `supplier_id` INT NOT NULL,
  `invoice_reference` VARCHAR(100) NULL,
  `delivery_note` VARCHAR(100) NULL,
  `received_at` TIMESTAMP(0) NOT NULL DEFAULT CURRENT_TIMESTAMP(0),
  `notes` TEXT NULL,
  `received_by` INT NULL,
  `created_at` TIMESTAMP(0) NOT NULL DEFAULT CURRENT_TIMESTAMP(0),
  PRIMARY KEY (`id`),
  UNIQUE INDEX `goods_receipts_receipt_number_key` (`receipt_number`),
  INDEX `idx_receipt_order_date` (`purchase_order_id`, `received_at`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

CREATE TABLE `goods_receipt_items` (
  `id` BIGINT NOT NULL AUTO_INCREMENT,
  `receipt_id` BIGINT NOT NULL,
  `purchase_order_item_id` BIGINT NOT NULL,
  `product_id` INT NOT NULL,
  `accepted_quantity` DECIMAL(12,3) NOT NULL,
  `damaged_quantity` DECIMAL(12,3) NOT NULL DEFAULT 0,
  `missing_quantity` DECIMAL(12,3) NOT NULL DEFAULT 0,
  `unit_id` INT NOT NULL,
  `conversion_factor_snapshot` DECIMAL(14,4) NOT NULL,
  `accepted_quantity_base` DECIMAL(14,3) NOT NULL,
  `unit_cost` DECIMAL(12,2) NOT NULL,
  `batch_number` VARCHAR(80) NULL,
  `manufactured_at` DATE NULL,
  `expires_at` DATE NULL,
  PRIMARY KEY (`id`),
  INDEX `idx_receipt_item_receipt` (`receipt_id`),
  INDEX `idx_receipt_item_order_item` (`purchase_order_item_id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

CREATE TABLE `supplier_payment_allocations` (
  `id` BIGINT NOT NULL AUTO_INCREMENT,
  `supplier_payment_id` BIGINT NOT NULL,
  `purchase_id` BIGINT NOT NULL,
  `amount` DECIMAL(14,2) NOT NULL,
  `created_at` TIMESTAMP(0) NOT NULL DEFAULT CURRENT_TIMESTAMP(0),
  PRIMARY KEY (`id`),
  UNIQUE INDEX `unique_supplier_payment_invoice` (`supplier_payment_id`, `purchase_id`),
  INDEX `idx_supplier_allocation_purchase` (`purchase_id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

CREATE TABLE `supplier_returns` (
  `id` BIGINT NOT NULL AUTO_INCREMENT,
  `credit_note` VARCHAR(40) NOT NULL,
  `supplier_id` INT NOT NULL,
  `purchase_id` BIGINT NULL,
  `receipt_id` BIGINT NULL,
  `reason` VARCHAR(100) NOT NULL,
  `settlement_type` VARCHAR(20) NOT NULL DEFAULT 'credit',
  `amount` DECIMAL(14,2) NOT NULL,
  `notes` TEXT NULL,
  `created_by` INT NULL,
  `created_at` TIMESTAMP(0) NOT NULL DEFAULT CURRENT_TIMESTAMP(0),
  PRIMARY KEY (`id`),
  UNIQUE INDEX `supplier_returns_credit_note_key` (`credit_note`),
  INDEX `idx_supplier_return_date` (`supplier_id`, `created_at`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

CREATE TABLE `supplier_return_items` (
  `id` BIGINT NOT NULL AUTO_INCREMENT,
  `supplier_return_id` BIGINT NOT NULL,
  `purchase_item_id` BIGINT NOT NULL,
  `product_id` INT NOT NULL,
  `product_name_snapshot` VARCHAR(150) NOT NULL,
  `quantity` DECIMAL(12,3) NOT NULL,
  `unit_id` INT NOT NULL,
  `unit_name_snapshot` VARCHAR(50) NOT NULL,
  `conversion_factor_snapshot` DECIMAL(14,4) NOT NULL,
  `quantity_base` DECIMAL(14,3) NOT NULL,
  `unit_cost` DECIMAL(12,2) NOT NULL,
  `total_cost` DECIMAL(14,2) NOT NULL,
  PRIMARY KEY (`id`),
  INDEX `idx_supplier_return_item_return` (`supplier_return_id`),
  INDEX `idx_supplier_return_item_purchase` (`purchase_item_id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

CREATE TABLE `stock_batches` (
  `id` BIGINT NOT NULL AUTO_INCREMENT,
  `product_id` INT NOT NULL,
  `supplier_id` INT NULL,
  `receipt_id` BIGINT NULL,
  `receipt_item_id` BIGINT NULL,
  `batch_number` VARCHAR(80) NULL,
  `received_quantity` DECIMAL(14,3) NOT NULL,
  `remaining_quantity` DECIMAL(14,3) NOT NULL,
  `manufactured_at` DATE NULL,
  `expires_at` DATE NULL,
  `unit_cost_base` DECIMAL(12,2) NOT NULL,
  `created_at` TIMESTAMP(0) NOT NULL DEFAULT CURRENT_TIMESTAMP(0),
  PRIMARY KEY (`id`),
  INDEX `idx_stock_batch_expiry` (`product_id`, `expires_at`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

CREATE TABLE `stock_count_sessions` (
  `id` BIGINT NOT NULL AUTO_INCREMENT,
  `count_number` VARCHAR(40) NOT NULL,
  `status` VARCHAR(20) NOT NULL DEFAULT 'draft',
  `category_id` INT NULL,
  `notes` TEXT NULL,
  `submitted_by` INT NULL,
  `submitted_at` TIMESTAMP(0) NULL,
  `reviewed_by` INT NULL,
  `reviewed_at` TIMESTAMP(0) NULL,
  `review_notes` TEXT NULL,
  `created_by` INT NULL,
  `created_at` TIMESTAMP(0) NOT NULL DEFAULT CURRENT_TIMESTAMP(0),
  `updated_at` TIMESTAMP(0) NOT NULL DEFAULT CURRENT_TIMESTAMP(0),
  PRIMARY KEY (`id`),
  UNIQUE INDEX `stock_count_sessions_count_number_key` (`count_number`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

CREATE TABLE `stock_count_items` (
  `id` BIGINT NOT NULL AUTO_INCREMENT,
  `count_session_id` BIGINT NOT NULL,
  `product_id` INT NOT NULL,
  `product_name_snapshot` VARCHAR(150) NOT NULL,
  `expected_quantity` DECIMAL(14,3) NOT NULL,
  `physical_quantity` DECIMAL(14,3) NULL,
  `variance` DECIMAL(14,3) NULL,
  `reason` VARCHAR(50) NULL,
  `notes` TEXT NULL,
  PRIMARY KEY (`id`),
  UNIQUE INDEX `unique_stock_count_product` (`count_session_id`, `product_id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

CREATE TABLE `bar_areas` (
  `id` INT NOT NULL AUTO_INCREMENT,
  `name` VARCHAR(100) NOT NULL,
  `is_active` TINYINT NOT NULL DEFAULT 1,
  `created_by` INT NULL,
  `created_at` TIMESTAMP(0) NOT NULL DEFAULT CURRENT_TIMESTAMP(0),
  `updated_at` TIMESTAMP(0) NOT NULL DEFAULT CURRENT_TIMESTAMP(0),
  PRIMARY KEY (`id`),
  UNIQUE INDEX `unique_bar_area_name` (`name`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

CREATE TABLE `dining_tables` (
  `id` INT NOT NULL AUTO_INCREMENT,
  `area_id` INT NOT NULL,
  `table_name` VARCHAR(50) NOT NULL,
  `capacity` INT NOT NULL DEFAULT 2,
  `description` TEXT NULL,
  `is_active` TINYINT NOT NULL DEFAULT 1,
  `created_by` INT NULL,
  `created_at` TIMESTAMP(0) NOT NULL DEFAULT CURRENT_TIMESTAMP(0),
  `updated_at` TIMESTAMP(0) NOT NULL DEFAULT CURRENT_TIMESTAMP(0),
  PRIMARY KEY (`id`),
  UNIQUE INDEX `unique_table_name_per_area` (`area_id`, `table_name`),
  INDEX `idx_table_area_active` (`area_id`, `is_active`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

CREATE TABLE `table_sessions` (
  `id` BIGINT NOT NULL AUTO_INCREMENT,
  `session_number` VARCHAR(40) NOT NULL,
  `dining_table_id` INT NOT NULL,
  `waiter_id` INT NULL,
  `guest_count` INT NULL,
  `status` VARCHAR(20) NOT NULL DEFAULT 'open',
  `opened_by` INT NULL,
  `opened_at` TIMESTAMP(0) NOT NULL DEFAULT CURRENT_TIMESTAMP(0),
  `closed_by` INT NULL,
  `closed_at` TIMESTAMP(0) NULL,
  `merged_into_session_id` BIGINT NULL,
  `notes` TEXT NULL,
  PRIMARY KEY (`id`),
  UNIQUE INDEX `table_sessions_session_number_key` (`session_number`),
  INDEX `idx_table_session_status` (`dining_table_id`, `status`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

CREATE TABLE `table_session_events` (
  `id` BIGINT NOT NULL AUTO_INCREMENT,
  `session_id` BIGINT NOT NULL,
  `event_type` VARCHAR(30) NOT NULL,
  `from_table_id` INT NULL,
  `to_table_id` INT NULL,
  `from_waiter_id` INT NULL,
  `to_waiter_id` INT NULL,
  `related_session_id` BIGINT NULL,
  `reason` TEXT NULL,
  `created_by` INT NULL,
  `created_at` TIMESTAMP(0) NOT NULL DEFAULT CURRENT_TIMESTAMP(0),
  PRIMARY KEY (`id`),
  INDEX `idx_table_event_session_date` (`session_id`, `created_at`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

CREATE TABLE `table_order_rounds` (
  `id` BIGINT NOT NULL AUTO_INCREMENT,
  `session_id` BIGINT NOT NULL,
  `round_number` INT NOT NULL,
  `status` VARCHAR(20) NOT NULL DEFAULT 'draft',
  `notes` TEXT NULL,
  `created_by` INT NULL,
  `served_by` INT NULL,
  `served_at` TIMESTAMP(0) NULL,
  `voided_by` INT NULL,
  `void_reason` TEXT NULL,
  `created_at` TIMESTAMP(0) NOT NULL DEFAULT CURRENT_TIMESTAMP(0),
  `updated_at` TIMESTAMP(0) NOT NULL DEFAULT CURRENT_TIMESTAMP(0),
  PRIMARY KEY (`id`),
  UNIQUE INDEX `unique_session_round` (`session_id`, `round_number`),
  INDEX `idx_table_round_status` (`session_id`, `status`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

CREATE TABLE `table_order_items` (
  `id` BIGINT NOT NULL AUTO_INCREMENT,
  `round_id` BIGINT NOT NULL,
  `product_id` INT NOT NULL,
  `product_name_snapshot` VARCHAR(150) NOT NULL,
  `quantity` DECIMAL(12,3) NOT NULL,
  `unit_id` INT NOT NULL,
  `unit_name_snapshot` VARCHAR(50) NOT NULL,
  `conversion_factor_snapshot` DECIMAL(14,4) NOT NULL,
  `quantity_base` DECIMAL(14,3) NOT NULL,
  `unit_price` DECIMAL(12,2) NOT NULL,
  `discount` DECIMAL(12,2) NOT NULL DEFAULT 0,
  `line_total` DECIMAL(14,2) NOT NULL,
  `cost_at_order` DECIMAL(12,2) NULL,
  `created_at` TIMESTAMP(0) NOT NULL DEFAULT CURRENT_TIMESTAMP(0),
  PRIMARY KEY (`id`),
  INDEX `idx_table_order_item_round` (`round_id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

CREATE TABLE `table_payments` (
  `id` BIGINT NOT NULL AUTO_INCREMENT,
  `session_id` BIGINT NOT NULL,
  `amount` DECIMAL(14,2) NOT NULL,
  `payment_method` VARCHAR(30) NOT NULL,
  `reference` VARCHAR(100) NULL,
  `notes` TEXT NULL,
  `received_by` INT NULL,
  `paid_at` TIMESTAMP(0) NOT NULL DEFAULT CURRENT_TIMESTAMP(0),
  PRIMARY KEY (`id`),
  INDEX `idx_table_payment_session_date` (`session_id`, `paid_at`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

CREATE TABLE `table_serve_requests` (
  `id` BIGINT NOT NULL AUTO_INCREMENT,
  `session_id` BIGINT NOT NULL,
  `round_id` BIGINT NOT NULL,
  `idempotency_key` VARCHAR(100) NOT NULL,
  `result` JSON NOT NULL,
  `created_by` INT NULL,
  `created_at` TIMESTAMP(0) NOT NULL DEFAULT CURRENT_TIMESTAMP(0),
  PRIMARY KEY (`id`),
  UNIQUE INDEX `table_serve_requests_idempotency_key_key` (`idempotency_key`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

INSERT IGNORE INTO `roles` (`name`, `description`)
VALUES ('waiter', 'Table service staff');
